//! プロジェクトの設定ファイル（`modelith.json`、ADR-0019 §2）の読み取りと作成。
//!
//! ファイルの形はこのモジュールの型だけで決める（画面と CLI は、ここを通して読み書きする）。
//! 知らない項目は消さずに `extra` に残し、書き戻しても失わない。読み取りの問題は、
//! SysML v2 や JSON を知らない人にも分かる言葉（ADR-0014）と、1 始まりの行・列で返す。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::LineIndex;

#[cfg(test)]
mod tests;

/// プロジェクトの設定ファイル（`modelith.json`）の中身。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectFile {
    /// 画面に出すプロジェクト名。無ければ画面はフォルダ名を出す。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// プロジェクトが使うプラグイン（プラグインの ID ごと。ADR-0018）。
    #[serde(default)]
    pub plugins: BTreeMap<String, PluginUse>,
    /// 知らない項目。書き戻すときもそのまま残す。
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// プロジェクトが使うプラグイン 1 つの設定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginUse {
    /// 使う版（`"0.2.0"` など）。無ければ版を問わない。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// 有効か。書いていなければ有効。
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    /// プラグインごとの設定。中身はプラグインが決め、ホストはそのまま渡す。
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub settings: Value,
    /// 知らない項目。書き戻すときもそのまま残す。
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 問題の重さ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// 読み取れない（設定を使わない）。
    Error,
    /// 読み取れるが、知らせることがある。
    Warning,
}

/// 設定ファイルの問題 1 件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Problem {
    pub severity: Severity,
    /// 1 始まりの行。
    pub line: u32,
    /// 1 始まりの列（UTF-16 コード単位）。
    pub column: u32,
    /// 画面にそのまま出す文（画面の言葉の手引きに従う）。
    pub message: String,
}

/// 設定ファイルを読み取った結果。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Parsed {
    /// 読み取れた設定。誤り（`Severity::Error`）が 1 件でもあれば `None`。
    pub project: Option<ProjectFile>,
    /// 問題（行・列の順）。
    pub problems: Vec<Problem>,
}

/// `enabled` を書いていないプラグインは有効にする（serde の既定値）。
///
/// # 戻り値
///
/// 常に `true`。
///
/// # 例
///
/// ```text
/// enabled_by_default() → true
/// ```
fn enabled_by_default() -> bool {
    true
}

/// 設定ファイルのテキストを読み取る。失敗しない（問題は `problems` に入れる）。
///
/// JSON として読めない・項目の型が違うときは、設定を使わずに誤りを返す。知らない項目は設定に残し、
/// 1 つずつ注意を返す（F-EDIT-8 と同じく、黙って捨てない）。
///
/// # 引数
///
/// - `text`：`modelith.json` のテキスト全体
///
/// # 戻り値
///
/// 読み取れた設定（誤りがあれば `None`）と、問題の一覧（行・列は 1 始まり、列は UTF-16 コード単位）。
///
/// # 例
///
/// ```text
/// parse(r#"{ "name": "給水" }"#)   → project: { name: "給水", plugins: {} }、problems: []
/// parse(r#"{ "color": "red" }"#)  → project: { extra: { color: "red" } }、problems: [注意 1:3「知らない項目「color」があります…」]
/// parse(r#"{ "name": 3 }"#)       → project: None、problems: [誤り 1:3「プロジェクト名（name）は…」]
/// parse("{")                      → project: None、problems: [誤り 1:1「書き方に誤りがあるため読み取れません（…）」]
/// parse("")                       → project: None、problems: [誤り 1:1「中身が空です…」]
/// ```
pub fn parse(text: &str) -> Parsed {
    let locator = Locator::new(text);
    if text.trim().is_empty() {
        return failed(error(
            locator.of_offset(0),
            "中身が空です。少なくとも { } と書いてください",
        ));
    }
    let value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return failed(syntax_problem(&locator, text, &e)),
    };
    let mut problems = type_problems(&value, &locator);
    if !problems.is_empty() {
        return Parsed {
            project: None,
            problems,
        };
    }
    // 型は上で確かめたので、ここで失敗するのは想定外（そのときも誤りとして返す）
    let project = match serde_json::from_value::<ProjectFile>(value) {
        Ok(p) => p,
        Err(e) => {
            return failed(error(
                locator.of_offset(0),
                &format!("設定を読み取れませんでした（{e}）"),
            ));
        }
    };
    problems.extend(unknown_key_problems(&project, &locator));
    problems.sort_by_key(|p| (p.line, p.column));
    Parsed {
        project: Some(project),
        problems,
    }
}

/// 新しい設定ファイルのテキストを作る（「プロジェクトにする」で使う。F-PROJ-1）。
///
/// # 引数
///
/// - `name`：プロジェクト名。前後の空白は除く。空なら名前を書かない（画面はフォルダ名を出す）
///
/// # 戻り値
///
/// 字下げ 2 つの空白・末尾に改行のある JSON のテキスト。使うプラグインは空。
///
/// # 例
///
/// ```text
/// create("給水システム") → "{\n  \"name\": \"給水システム\",\n  \"plugins\": {}\n}\n"
/// create("  ")          → "{\n  \"plugins\": {}\n}\n"   // 空の名前は書かない
/// ```
pub fn create(name: &str) -> String {
    let name = name.trim();
    to_text(&ProjectFile {
        name: (!name.is_empty()).then(|| name.to_owned()),
        ..ProjectFile::default()
    })
}

/// プロジェクトが使うプラグインの変更（画面の「追加」・使う／止めるの切り替え・「削除」。ADR-0018 §1）。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum PluginChange {
    /// 使うプラグインに加える（既にあれば版を書き換えて有効にする。プラグインごとの設定と知らない項目は残す）。
    Add {
        /// 入れたプラグインの版。
        version: String,
    },
    /// 使うか止めるかを書く。
    SetEnabled {
        /// 使うなら true。
        enabled: bool,
    },
    /// 使うプラグインから外す。
    Remove,
}

/// 設定ファイルのテキストの、使うプラグインの項目を書き換える（知らない項目は残す）。
///
/// # 引数
///
/// - `text`：今の `modelith.json` のテキスト全体
/// - `id`：プラグインの ID（`plugins` のキー）
/// - `change`：変更（加える・使う／止める・外す）
///
/// # 戻り値
///
/// 書き換えた後のテキスト（[`to_text`] の形）。設定ファイルに誤りがある・変える項目が無い・
/// 加える ID の形が正しくないときは、画面に出す理由の文を `Err` で返す。
///
/// # 例
///
/// ```text
/// update_plugin("{}", "jp.x", Add { version: "0.1.0" })
///   → Ok("{\n  \"plugins\": {\n    \"jp.x\": {\n      \"version\": \"0.1.0\",\n      \"enabled\": true\n    }\n  }\n}\n")
/// update_plugin(r#"{"plugins":{"jp.x":{}}}"#, "jp.x", SetEnabled { enabled: false }) → Ok(… "enabled": false …)
/// update_plugin("{}", "jp.x", Remove) → Err("プロジェクトの設定（modelith.json）に、プラグイン「jp.x」がありません")
/// update_plugin("{", "jp.x", Remove)  → Err("プロジェクトの設定（modelith.json）に誤りがあるため、書き換えられません。1 行目：…")
/// ```
pub fn update_plugin(text: &str, id: &str, change: &PluginChange) -> Result<String, String> {
    let parsed = parse(text);
    let Some(mut project) = parsed.project else {
        let reason = parsed
            .problems
            .iter()
            .find(|p| p.severity == Severity::Error)
            .map(|p| format!("{} 行目：{}", p.line, p.message))
            .unwrap_or_default();
        return Err(format!(
            "プロジェクトの設定（modelith.json）に誤りがあるため、書き換えられません。{reason}"
        ));
    };
    let missing =
        || format!("プロジェクトの設定（modelith.json）に、プラグイン「{id}」がありません");
    match change {
        PluginChange::Add { version } => {
            if id.parse::<modelith_plugin_protocol::PluginId>().is_err() {
                return Err(format!("プラグインの ID「{id}」の形が正しくありません"));
            }
            let entry = project.plugins.entry(id.to_owned()).or_insert(PluginUse {
                version: None,
                enabled: true,
                settings: Value::Null,
                extra: Map::new(),
            });
            entry.version = Some(version.clone());
            entry.enabled = true;
        }
        PluginChange::SetEnabled { enabled } => {
            project.plugins.get_mut(id).ok_or_else(missing)?.enabled = *enabled;
        }
        PluginChange::Remove => {
            project.plugins.remove(id).ok_or_else(missing)?;
        }
    }
    Ok(to_text(&project))
}

/// 設定をファイルのテキストにする（知らない項目も書く）。
///
/// # 引数
///
/// - `project`：書く設定
///
/// # 戻り値
///
/// 字下げ 2 つの空白・末尾に改行のある JSON のテキスト。項目は `name`・`plugins`、その後に知らない項目を名前順に書く。
///
/// # 例
///
/// ```text
/// to_text(&ProjectFile::default()) → "{\n  \"plugins\": {}\n}\n"
/// to_text(parse(r#"{"x":1,"name":"A"}"#) の設定) → "{\n  \"name\": \"A\",\n  \"plugins\": {},\n  \"x\": 1\n}\n"
/// ```
pub fn to_text(project: &ProjectFile) -> String {
    // 文字列のキーと JSON の値だけの構造なので、JSON への変換は失敗しない
    let mut text = serde_json::to_string_pretty(project).unwrap_or_else(|_| "{}".to_owned());
    text.push('\n');
    text
}

/// 誤り 1 件だけの、設定を使わない結果を作る。
///
/// # 引数
///
/// - `problem`：誤り
///
/// # 戻り値
///
/// `project` が `None`、`problems` が `[problem]` の結果。
///
/// # 例
///
/// ```text
/// failed(誤り 1:1「…」) → Parsed { project: None, problems: [誤り 1:1「…」] }
/// ```
fn failed(problem: Problem) -> Parsed {
    Parsed {
        project: None,
        problems: vec![problem],
    }
}

/// 誤りを作る。
///
/// # 引数
///
/// - `at`：1 始まりの行と列
/// - `message`：画面に出す文
///
/// # 戻り値
///
/// 重さが `Error` の問題。
///
/// # 例
///
/// ```text
/// error((2, 3), "x") → Problem { severity: Error, line: 2, column: 3, message: "x" }
/// ```
fn error(at: (u32, u32), message: &str) -> Problem {
    problem(Severity::Error, at, message)
}

/// 問題を作る。
///
/// # 引数
///
/// - `severity`：重さ
/// - `at`：1 始まりの行と列
/// - `message`：画面に出す文
///
/// # 戻り値
///
/// 問題 1 件。
///
/// # 例
///
/// ```text
/// problem(Warning, (1, 3), "x") → Problem { severity: Warning, line: 1, column: 3, message: "x" }
/// ```
fn problem(severity: Severity, at: (u32, u32), message: &str) -> Problem {
    Problem {
        severity,
        line: at.0,
        column: at.1,
        message: message.to_owned(),
    }
}

/// JSON として読めなかったことを、serde_json が示した位置の誤りにする。
///
/// # 引数
///
/// - `locator`：`text` の位置の変換
/// - `text`：設定ファイルのテキスト全体
/// - `e`：serde_json の読み取りの失敗（行は 1 始まり、列は行頭からのバイト数）
///
/// # 戻り値
///
/// 誤り 1 件。位置は UTF-16 の列に直し、文の最後の括弧に serde_json の理由（位置を除く）を添える。
///
/// # 例
///
/// ```text
/// syntax_problem(…, "{\n  \"a\": 1,\n}", e) → 誤り 3:1「書き方に誤りがあるため読み取れません（JSON：trailing comma）」
/// ```
fn syntax_problem(locator: &Locator, text: &str, e: &serde_json::Error) -> Problem {
    let line_start: usize = text
        .split_inclusive('\n')
        .take(e.line().saturating_sub(1))
        .map(str::len)
        .sum();
    let at = locator.of_offset(line_start + e.column().saturating_sub(1));
    let full = e.to_string();
    let reason = full
        .strip_suffix(&format!(" at line {} column {}", e.line(), e.column()))
        .unwrap_or(&full);
    error(
        at,
        &format!("書き方に誤りがあるため読み取れません（JSON：{reason}）"),
    )
}

/// 決まった項目の型を確かめ、違うものを誤りにする（`name` は文字、`plugins` は `{ }` など）。
///
/// # 引数
///
/// - `value`：JSON として読んだ設定ファイル全体
/// - `locator`：テキストの位置の変換
///
/// # 戻り値
///
/// 型の誤りの一覧（項目の位置。無ければ空）。
///
/// # 例
///
/// ```text
/// type_problems(json!({"name": "A"}), …)  → []
/// type_problems(json!([1]), …)            → [誤り 1:1「一番外側を { } で囲んでください…」]
/// type_problems(json!({"plugins": 1}), …) → [誤り「使うプラグインの一覧（plugins）は…」]
/// ```
fn type_problems(value: &Value, locator: &Locator) -> Vec<Problem> {
    let Some(root) = value.as_object() else {
        return vec![error(
            locator.of_offset(0),
            "一番外側を { } で囲んでください（JSON のオブジェクト）",
        )];
    };
    let mut problems = Vec::new();
    if root
        .get("name")
        .is_some_and(|v| !(v.is_string() || v.is_null()))
    {
        problems.push(error(
            locator.of_key(&["name"]),
            "プロジェクト名（name）は、文字を \" \" で囲んで書いてください",
        ));
    }
    match root.get("plugins") {
        None => {}
        Some(Value::Object(plugins)) => {
            for (id, plugin) in plugins {
                problems.extend(plugin_type_problems(id, plugin, locator));
            }
        }
        Some(_) => problems.push(error(
            locator.of_key(&["plugins"]),
            "使うプラグインの一覧（plugins）は { } で囲んで書いてください",
        )),
    }
    problems
}

/// プラグイン 1 つの設定の型を確かめる（`{ }` であること、`version` は文字、`enabled` は true か false）。
///
/// # 引数
///
/// - `id`：プラグインの ID（`plugins` のキー）
/// - `plugin`：そのプラグインの設定
/// - `locator`：テキストの位置の変換
///
/// # 戻り値
///
/// 型の誤りの一覧（無ければ空）。`settings` の中身はプラグインが決めるので確かめない。
///
/// # 例
///
/// ```text
/// plugin_type_problems("p", json!({"version": "1.0.0"}), …) → []
/// plugin_type_problems("p", json!(true), …)                 → [誤り「プラグイン「p」の設定は { } で…」]
/// plugin_type_problems("p", json!({"enabled": "yes"}), …)   → [誤り「…（enabled）は true か false で…」]
/// ```
fn plugin_type_problems(id: &str, plugin: &Value, locator: &Locator) -> Vec<Problem> {
    let Some(fields) = plugin.as_object() else {
        return vec![error(
            locator.of_key(&["plugins", id]),
            &format!("プラグイン「{id}」の設定は {{ }} で囲んで書いてください"),
        )];
    };
    let mut problems = Vec::new();
    if fields
        .get("version")
        .is_some_and(|v| !(v.is_string() || v.is_null()))
    {
        problems.push(error(
            locator.of_key(&["plugins", id, "version"]),
            &format!(
                "プラグイン「{id}」の版（version）は、文字を \" \" で囲んで書いてください（例：\"0.2.0\"）"
            ),
        ));
    }
    if fields.get("enabled").is_some_and(|v| !v.is_boolean()) {
        problems.push(error(
            locator.of_key(&["plugins", id, "enabled"]),
            &format!(
                "プラグイン「{id}」を使うかどうか（enabled）は true か false で書いてください"
            ),
        ));
    }
    problems
}

/// 知らない項目を、1 つずつ注意にする（消さずに残すことを伝える）。
///
/// # 引数
///
/// - `project`：読み取った設定
/// - `locator`：テキストの位置の変換
///
/// # 戻り値
///
/// 知らない項目ごとの注意（一番外側と、各プラグインの設定の中）。無ければ空。
///
/// # 例
///
/// ```text
/// unknown_key_problems(parse(r#"{"color":1}"#) の設定, …) → [注意 1:2「知らない項目「color」があります。消さずに残します」]
/// unknown_key_problems(&ProjectFile::default(), …)        → []
/// ```
fn unknown_key_problems(project: &ProjectFile, locator: &Locator) -> Vec<Problem> {
    let top = project.extra.keys().map(|key| {
        problem(
            Severity::Warning,
            locator.of_key(&[key]),
            &format!("知らない項目「{key}」があります。消さずに残します"),
        )
    });
    let in_plugins = project.plugins.iter().flat_map(|(id, plugin)| {
        plugin.extra.keys().map(move |key| {
            problem(
                Severity::Warning,
                locator.of_key(&["plugins", id, key]),
                &format!(
                    "プラグイン「{id}」の設定に、知らない項目「{key}」があります。消さずに残します"
                ),
            )
        })
    });
    top.chain(in_plugins).collect()
}

/// テキストの位置（バイト）と、JSON のキーの位置を、1 始まりの行・列にする。
struct Locator {
    index: LineIndex,
    /// キーの道筋（外側のキーから順）ごとの、キーの `"` の位置（バイト）。
    keys: BTreeMap<Vec<String>, usize>,
}

impl Locator {
    /// テキストの行の表と、キーの位置の表を作る。
    ///
    /// # 引数
    ///
    /// - `text`：設定ファイルのテキスト全体（JSON として読めなくてもよい。そのときキーの表は途中まで）
    ///
    /// # 戻り値
    ///
    /// 位置の変換。失敗しない。
    ///
    /// # 例
    ///
    /// ```text
    /// Locator::new("{\"a\": 1}").of_key(&["a"]) → (1, 2)
    /// Locator::new("").of_offset(0)              → (1, 1)
    /// ```
    fn new(text: &str) -> Self {
        Self {
            index: LineIndex::new(text),
            keys: key_offsets(text),
        }
    }

    /// バイトの位置を、1 始まりの行・列（UTF-16 コード単位）にする。
    ///
    /// # 引数
    ///
    /// - `offset`：バイトの位置。文字の途中ならその文字の先頭、範囲外ならテキストの末尾として扱う
    ///
    /// # 戻り値
    ///
    /// 1 始まりの行と列。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "日\nab"
    /// of_offset(5) → (2, 2)
    /// of_offset(1) → (1, 1)   // 「日」の途中は、その先頭
    /// of_offset(99) → (2, 3)  // 範囲外は末尾
    /// ```
    fn of_offset(&self, offset: usize) -> (u32, u32) {
        let pos = (0..=offset)
            .rev()
            .find_map(|o| self.index.line_col(o))
            .unwrap_or(crate::LineCol { line: 0, col: 0 });
        (pos.line + 1, pos.col + 1)
    }

    /// キーの位置（キーの `"`）を、1 始まりの行・列にする。
    ///
    /// # 引数
    ///
    /// - `path`：外側から順のキーの道筋（`["plugins", "jp.x", "enabled"]` など）
    ///
    /// # 戻り値
    ///
    /// 1 始まりの行と列。キーが見つからなければ `(1, 1)`。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "{\n  \"name\": 3\n}"
    /// of_key(&["name"]) → (2, 3)
    /// of_key(&["none"]) → (1, 1)
    /// ```
    fn of_key(&self, path: &[&str]) -> (u32, u32) {
        let path: Vec<String> = path.iter().map(|s| (*s).to_owned()).collect();
        self.of_offset(self.keys.get(&path).copied().unwrap_or(0))
    }
}

/// JSON の入れ物の種類と、オブジェクトなら今のキー。
enum Frame {
    Object { key: Option<String>, want_key: bool },
    Array,
}

/// JSON のテキストを先頭から読み、オブジェクトのキーの位置を、キーの道筋ごとに集める。
///
/// 配列の中は道筋に `"[]"` を入れる。同じ道筋のキーが 2 つあれば、後のものの位置にする（serde_json の読み方と同じ）。
///
/// # 引数
///
/// - `text`：JSON のテキスト
///
/// # 戻り値
///
/// キーの道筋（外側のキーから順）→ キーの `"` の位置（バイト）。JSON として読めないところから先は集めない。
///
/// # 例
///
/// ```text
/// key_offsets(r#"{"a": {"b": 1}}"#) → { ["a"]: 1, ["a", "b"]: 7 }
/// key_offsets("")                    → {}
/// ```
fn key_offsets(text: &str) -> BTreeMap<Vec<String>, usize> {
    let mut found = BTreeMap::new();
    let mut stack: Vec<Frame> = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while let Some(&b) = bytes.get(i) {
        match b {
            b'{' => stack.push(Frame::Object {
                key: None,
                want_key: true,
            }),
            b'[' => stack.push(Frame::Array),
            b'}' | b']' => {
                stack.pop();
            }
            b',' | b':' => {
                if let Some(Frame::Object { want_key, .. }) = stack.last_mut() {
                    *want_key = b == b',';
                }
            }
            b'"' => {
                let end = string_end(bytes, i);
                if matches!(stack.last(), Some(Frame::Object { want_key: true, .. })) {
                    // キーの文字列はエスケープを戻して比べる（"a" も "a" として扱う）
                    let Ok(k) = serde_json::from_str::<String>(&text[i..end]) else {
                        break;
                    };
                    if let Some(Frame::Object { key, .. }) = stack.last_mut() {
                        *key = Some(k);
                    }
                    if let Some(path) = key_path(&stack) {
                        found.insert(path, i);
                    }
                }
                i = end;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    found
}

/// 文字列の終わり（閉じる `"` の次）の位置を探す。
///
/// # 引数
///
/// - `bytes`：JSON のテキストのバイト列
/// - `start`：開く `"` の位置
///
/// # 戻り値
///
/// 閉じる `"` の次の位置。閉じていなければテキストの長さ。
///
/// # 例
///
/// ```text
/// string_end(br#""a\"b" x"#, 0) → 6
/// string_end(br#""abc"#, 0)     → 4   // 閉じていない
/// ```
fn string_end(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while let Some(&b) = bytes.get(i) {
        match b {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// 入れ物の重なりから、今のキーの道筋を作る。
///
/// # 引数
///
/// - `stack`：外側から順の入れ物（一番内側がオブジェクトで、そのキーを読んだところ）
///
/// # 戻り値
///
/// 外側から順のキー（配列は `"[]"`）。キーをまだ持たないオブジェクトがあれば `None`。
///
/// # 例
///
/// ```text
/// key_path([Object{key: "plugins"}, Object{key: "p"}]) → Some(["plugins", "p"])
/// key_path([Array, Object{key: "a"}])                  → Some(["[]", "a"])
/// key_path([Object{key: None}])                        → None
/// ```
fn key_path(stack: &[Frame]) -> Option<Vec<String>> {
    stack
        .iter()
        .map(|f| match f {
            Frame::Object { key, .. } => key.clone(),
            Frame::Array => Some("[]".to_owned()),
        })
        .collect()
}
