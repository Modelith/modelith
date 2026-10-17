//! ブラウザ向けの wasm バインディング。Web Worker 内で読み込まれ、
//! UI とは LSP と同じ形のメッセージでやり取りする（ADR-0003）。

use std::collections::BTreeMap;

use modelith_core::rules::{self, LoadedPlugin};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// コアのバージョンを返す。
///
/// # 戻り値
///
/// `modelith-core` の版（Cargo のワークスペースの版）。
///
/// # 例
///
/// ```text
/// version() → "0.1.0-alpha.4"（Cargo.toml の版。版を上げるとこの値も変わる）
/// ```
#[wasm_bindgen]
pub fn version() -> String {
    modelith_core::VERSION.to_owned()
}

/// テキストを解析してモデルを作り、暫定コアと同じ形の `{ parse, model }` を JSON で返す（ADR-0015・ADR-0016）。
///
/// 中身は `analyze_json` に任せる（wasm の境界を薄く保ち、テストを wasm なしで動かすため）。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
///
/// # 戻り値
///
/// `{ "parse": …, "model": … }` の JSON 文字列。位置はすべて UTF-16 のオフセット。書き誤りがあっても
/// 失敗せず、エラーは `parse.errors` に入る。
///
/// # 例
///
/// ```text
/// analyze("// 日本語\npart def A;") → "{\"parse\":{\"entries\":[{\"kind\":\"part def\",…,\"start\":7,…}],…},\"model\":{…}}"
/// ```
#[wasm_bindgen]
pub fn analyze(text: &str) -> String {
    analyze_json(text)
}

/// 図の操作の意図（JSON）を今のテキストに当て、テキストの編集を JSON で返す（ADR-0016）。
/// 返すのは `{ edits, select?, flash? }`、操作できなければ `{ refused }`（画面に出す文）。
///
/// 中身は `edit_json` に任せる。
///
/// # 引数
///
/// - `text`：今のテキスト全体
/// - `intent`：図の操作の意図の JSON（`{"op":"rename","key":"A","name":"B"}` など。形は `edit::Intent`）
///
/// # 戻り値
///
/// テキストの編集の JSON 文字列（位置は UTF-16 のオフセット）。意図が読めないときや操作できないときは
/// `{"refused":"…"}`。
///
/// # 例
///
/// ```text
/// edit("// 日本語\npackage P { part def A; }", r#"{"op":"rename","key":"A","name":"B"}"#)
///   → "{\"edits\":[{\"start\":28,\"end\":29,\"text\":\"B\"}],…}"
/// edit(…, r#"{"op":"rename"}"#) → "{\"refused\":\"操作を読み込めませんでした（…）\"}"
/// ```
#[wasm_bindgen]
pub fn edit(text: &str, intent: &str) -> String {
    edit_json(text, intent)
}

/// プロジェクトの設定ファイル（`modelith.json`）のテキストを読み取り、`{ project, problems }` を JSON で返す（ADR-0019、F-PROJ-1）。
///
/// 中身は `parse_project_file_json` に任せる。
///
/// # 引数
///
/// - `text`：`modelith.json` のテキスト全体
///
/// # 戻り値
///
/// `{ "project": … | null, "problems": [{ "severity", "line", "column", "message" }] }` の JSON 文字列。
/// 行・列は 1 始まり（列は UTF-16 コード単位）。読み取れなくても失敗せず、理由は `problems` に入る。
///
/// # 例
///
/// ```text
/// parseProjectFile(r#"{"name":"A"}"#) → "{\"project\":{\"name\":\"A\",\"plugins\":{}},\"problems\":[]}"
/// parseProjectFile("{")              → "{\"project\":null,\"problems\":[{\"severity\":\"error\",\"line\":1,\"column\":1,…}]}"
/// ```
#[wasm_bindgen(js_name = parseProjectFile)]
pub fn parse_project_file(text: &str) -> String {
    parse_project_file_json(text)
}

/// 新しいプロジェクトの設定ファイルのテキストを作り、`{ text }` を JSON で返す（「プロジェクトにする」、F-PROJ-1）。
///
/// 中身は `create_project_file_json` に任せる。
///
/// # 引数
///
/// - `name`：プロジェクト名（前後の空白は除く。空なら名前を書かない）
///
/// # 戻り値
///
/// `{ "text": "modelith.json のテキスト" }` の JSON 文字列。
///
/// # 例
///
/// ```text
/// createProjectFile("A")  → r#"{"text":"{\n  \"name\": \"A\",\n  \"plugins\": {}\n}\n"}"#
/// createProjectFile("  ") → r#"{"text":"{\n  \"plugins\": {}\n}\n"}"#   // 空の名前は書かない
/// ```
#[wasm_bindgen(js_name = createProjectFile)]
pub fn create_project_file(name: &str) -> String {
    create_project_file_json(name)
}

/// 設定ファイルの使うプラグインの項目を書き換え、`{ text }` か `{ refused }` を JSON で返す
/// （画面の「追加」・使う／止める・「削除」。ADR-0018 §1）。不明な項目は残す。
///
/// 中身は `update_project_plugin_json` に任せる。
///
/// # 引数
///
/// - `text`：今の `modelith.json` のテキスト全体
/// - `id`：プラグインの ID
/// - `change`：変更の JSON（`{"op":"add","version":"0.1.0"}`・`{"op":"setEnabled","enabled":false}`・`{"op":"remove"}`）
///
/// # 戻り値
///
/// `{ "text": "書き換えた後のテキスト" }`。書き換えられなければ `{ "refused": "画面に出す文" }`。
///
/// # 例
///
/// ```text
/// updateProjectPlugin("{}", "jp.x", r#"{"op":"add","version":"0.1.0"}"#) → r#"{"text":"{\n  \"plugins\": {\n    \"jp.x\": {…}\n  }\n}\n"}"#
/// updateProjectPlugin("{}", "jp.x", r#"{"op":"remove"}"#) → r#"{"refused":"プロジェクトの設定（modelith.json）に、プラグイン「jp.x」がありません"}"#
/// ```
#[wasm_bindgen(js_name = updateProjectPlugin)]
pub fn update_project_plugin(text: &str, id: &str, change: &str) -> String {
    update_project_plugin_json(text, id, change)
}

/// プラグインのマニフェスト（`modelith-plugin.json`）を読み、名前・版・種類を `{ plugin }` の JSON で返す（「追加」の確認に使う）。
///
/// 中身は `describe_plugin_json` に任せる。
///
/// # 引数
///
/// - `text`：マニフェストのテキスト（JSON）
///
/// # 戻り値
///
/// `{ "plugin": { "id", "name", "version", "runtime", "description"? } }`。読めなければ `{ "refused": "…の 2 行目：理由" }`。
///
/// # 例
///
/// ```text
/// describePlugin(r#"{"id":"jp.x","name":"例","version":"0.1.0","apiVersion":"0","runtime":"rules","license":"MIT"}"#)
///   → r#"{"plugin":{"id":"jp.x","name":"例","version":"0.1.0","runtime":"rules"}}"#
/// describePlugin("{") → r#"{"refused":"modelith-plugin.json の 1 行目：書式にエラーがあるため読み込めません（JSON：…）"}"#
/// ```
#[wasm_bindgen(js_name = describePlugin)]
pub fn describe_plugin(text: &str) -> String {
    describe_plugin_json(text)
}

/// 読み込んだチェックルールのプラグイン（ADR-0018 §2）。Worker が持ち続け、解析のたびにルールを当てる。
#[wasm_bindgen]
pub struct RulePlugins {
    set: PluginSet,
}

#[wasm_bindgen]
impl RulePlugins {
    /// 画面から渡されたプラグインのファイルを読み込む。
    ///
    /// # 引数
    ///
    /// - `json`：`[{ "id", "enabled", "files": { "プラグインのフォルダからの相対パス": "テキスト" } }]` の JSON
    ///
    /// # 戻り値
    ///
    /// 読み込んだプラグイン。JSON が読めなくても失敗せず、そのことを `summary` の `error` に入れる。
    ///
    /// # 例
    ///
    /// ```text
    /// new RulePlugins(r#"[{"id":"jp.x","enabled":true,"files":{}}]"#).summary() → r#"{"plugins":[{"id":"jp.x",…,"installed":false,…}]}"#
    /// new RulePlugins("[").summary() → r#"{"error":"…"}"#
    /// ```
    #[wasm_bindgen(constructor)]
    pub fn new(json: &str) -> RulePlugins {
        RulePlugins {
            set: load_plugin_set(json),
        }
    }

    /// 読み込んだプラグインごとのまとめ（名前・版・ルールの数・読み込みの問題）を JSON で返す。
    ///
    /// # 戻り値
    ///
    /// `{ "plugins": [{ "id", "enabled", "installed", "manifest", "rules", "problems" }] }`。入力が読めなかったときは `{ "error": "理由" }`。
    ///
    /// # 例
    ///
    /// ```text
    /// plugins.summary() → r#"{"plugins":[{"id":"jp.x","enabled":true,"installed":true,"manifest":{…},"rules":2,"problems":[]}]}"#
    /// ```
    pub fn summary(&self) -> String {
        self.set.summary.clone()
    }

    /// テキストを解析してモデルを作り、使う（有効な）プラグインのルールを当て、`{ parse, model, findings }` を JSON で返す。
    ///
    /// # 引数
    ///
    /// - `text`：SysML v2 のテキスト全体
    ///
    /// # 戻り値
    ///
    /// `analyze` と同じ `{ parse, model }` に、検査の結果 `findings`（`{ plugin, rule, severity, message, element, pos }`。`pos` は UTF-16）を足した JSON。
    ///
    /// # 例
    ///
    /// ```text
    /// plugins.analyze("package P { part def A; }") → "{\"parse\":…,\"model\":…,\"findings\":[{\"plugin\":\"jp.x\",\"rule\":\"r1\",…,\"pos\":12}]}"
    /// ```
    pub fn analyze(&self, text: &str) -> String {
        analysis_json(text, &self.set.active)
    }
}

/// 画面から渡されたプラグイン 1 つ（ID・使うか・ファイル）。
#[derive(Deserialize)]
struct PluginInput {
    id: String,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    #[serde(default)]
    files: BTreeMap<String, String>,
}

/// 読み込んだプラグインの集まり。ルールを当てるのは使う（有効な）ものだけ。
struct PluginSet {
    active: Vec<LoadedPlugin>,
    /// `summary` が返す JSON（読み込んだときに作っておく）。
    summary: String,
}

/// 画面に返す、プラグイン 1 つのまとめ。
#[derive(Serialize)]
struct PluginSummary<'a> {
    id: &'a str,
    enabled: bool,
    installed: bool,
    manifest: Option<&'a rules::ManifestInfo>,
    rules: usize,
    problems: &'a [rules::LoadProblem],
}

/// `enabled` を書いていないプラグインは使う（serde の既定値）。
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

/// プラグインのファイルの JSON を読み、すべて読み込んで、使うものとまとめの JSON を作る（`RulePlugins::new` の中身）。
///
/// # 引数
///
/// - `json`：`[{ "id", "enabled", "files" }]` の JSON
///
/// # 戻り値
///
/// 使う（有効な）プラグインと、`{ "plugins": [...] }` のまとめ。JSON が読めなければ、使うものは空で、まとめは `{ "error": "理由" }`。
///
/// # 例
///
/// ```text
/// load_plugin_set(r#"[{"id":"jp.x","enabled":false,"files":{…}}]"#) → active: []、summary: {"plugins":[{"id":"jp.x","enabled":false,…}]}
/// load_plugin_set("[") → active: []、summary: {"error":"…"}
/// ```
fn load_plugin_set(json: &str) -> PluginSet {
    let inputs: Vec<PluginInput> = match serde_json::from_str(json) {
        Ok(i) => i,
        Err(e) => {
            return PluginSet {
                active: vec![],
                summary: serde_json::json!({ "error": format!("プラグインを読み込めませんでした（{e}）") }).to_string(),
            };
        }
    };
    let loaded: Vec<(bool, LoadedPlugin)> = inputs
        .iter()
        .map(|i| (i.enabled, rules::load_plugin_files(&i.id, &i.files)))
        .collect();
    let summaries: Vec<PluginSummary> = loaded
        .iter()
        .map(|(enabled, p)| PluginSummary {
            id: &p.id,
            enabled: *enabled,
            installed: p.installed,
            manifest: p.manifest.as_ref(),
            rules: p.rules.len(),
            problems: &p.problems,
        })
        .collect();
    // 文字列のキーと値だけの構造なので、JSON への変換は失敗しない
    let summary = serde_json::to_string(&serde_json::json!({ "plugins": summaries }))
        .unwrap_or_else(|e| format!(r#"{{"error":"{e}"}}"#));
    let active = loaded
        .into_iter()
        .filter_map(|(enabled, p)| enabled.then_some(p))
        .collect();
    PluginSet { active, summary }
}

/// 設定ファイルの使うプラグインを書き換え、`{ text }` か `{ refused }` の JSON にする（`update_project_plugin` の中身）。
///
/// # 引数
///
/// - `text`：今の `modelith.json` のテキスト全体
/// - `id`：プラグインの ID
/// - `change`：変更の JSON（形は `project_file::PluginChange`）
///
/// # 戻り値
///
/// `{ "text": … }`。変更の JSON が読めない・書き換えられないときは `{ "refused": "画面に出す文" }`。
///
/// # 例
///
/// ```text
/// update_project_plugin_json("{}", "jp.x", r#"{"op":"add","version":"0.1.0"}"#) → r#"{"text":"{…}"}"#
/// update_project_plugin_json("{}", "jp.x", r#"{"op":"x"}"#) → r#"{"refused":"変更を読み込めませんでした（…）"}"#
/// ```
fn update_project_plugin_json(text: &str, id: &str, change: &str) -> String {
    let result = serde_json::from_str::<modelith_core::project_file::PluginChange>(change)
        .map_err(|e| format!("変更を読み込めませんでした（{e}）"))
        .and_then(|c| modelith_core::project_file::update_plugin(text, id, &c));
    match result {
        Ok(text) => serde_json::json!({ "text": text }),
        Err(refused) => serde_json::json!({ "refused": refused }),
    }
    .to_string()
}

/// マニフェストを読み、`{ plugin }` か `{ refused }` の JSON にする（`describe_plugin` の中身）。
///
/// # 引数
///
/// - `text`：マニフェストのテキスト（JSON）
///
/// # 戻り値
///
/// `{ "plugin": … }`。読めなければ `{ "refused": "modelith-plugin.json の 行 行目：理由" }`（位置が無ければ行を書かない）。
///
/// # 例
///
/// ```text
/// describe_plugin_json(マニフェスト) → r#"{"plugin":{"id":"jp.x",…,"runtime":"rules"}}"#
/// describe_plugin_json("{")         → r#"{"refused":"modelith-plugin.json の 1 行目：書式にエラーがあるため読み込めません（JSON：…）"}"#
/// ```
fn describe_plugin_json(text: &str) -> String {
    let file = rules::MANIFEST_FILE;
    match rules::describe_manifest(file, text) {
        Ok(info) => serde_json::json!({ "plugin": info }),
        Err(p) => {
            let at = p
                .place
                .map_or(String::new(), |pl| format!(" の {} 行目", pl.line));
            serde_json::json!({ "refused": format!("{file}{at}：{}", p.message) })
        }
    }
    .to_string()
}

/// 設定ファイルを読み取り、結果を JSON にする（`parse_project_file` の中身）。
///
/// # 引数
///
/// - `text`：`modelith.json` のテキスト全体
///
/// # 戻り値
///
/// `{ "project": …, "problems": … }` の JSON 文字列。JSON への変換に失敗したときは `{"error":"理由"}`
/// （文字列のキーと JSON の値だけの構造なので、実際には起きない）。
///
/// # 例
///
/// ```text
/// parse_project_file_json("{}") → "{\"project\":{\"plugins\":{}},\"problems\":[]}"
/// parse_project_file_json("")   → "{\"project\":null,\"problems\":[{\"severity\":\"error\",…}]}"
/// ```
fn parse_project_file_json(text: &str) -> String {
    serde_json::to_string(&modelith_core::project_file::parse(text))
        .unwrap_or_else(|e| format!(r#"{{"error":"{e}"}}"#))
}

/// 新しい設定ファイルのテキストを作り、`{ text }` の JSON にする（`create_project_file` の中身）。
///
/// # 引数
///
/// - `name`：プロジェクト名
///
/// # 戻り値
///
/// `{ "text": … }` の JSON 文字列（文字列 1 つだけなので、変換は失敗しない）。
///
/// # 例
///
/// ```text
/// create_project_file_json("A") → r#"{"text":"{\n  \"name\": \"A\",\n  \"plugins\": {}\n}\n"}"#
/// create_project_file_json("")  → r#"{"text":"{\n  \"plugins\": {}\n}\n"}"#
/// ```
fn create_project_file_json(name: &str) -> String {
    serde_json::json!({ "text": modelith_core::project_file::create(name) }).to_string()
}

#[derive(Serialize)]
struct Refused {
    refused: String,
}

/// 意図の JSON を読み、`edit::edit` でテキストの編集を作って JSON にする（`edit` の中身）。
///
/// # 引数
///
/// - `text`：今のテキスト全体
/// - `intent`：図の操作の意図の JSON（形は `edit::Intent`）
///
/// # 戻り値
///
/// 編集の結果の JSON 文字列。意図が JSON として読めなければ `{"refused":"操作を読み込めませんでした（理由）"}`、
/// 操作できなければ `{"refused":"画面に出す文"}`。
///
/// # 例
///
/// ```text
/// edit_json("// 日本語\npackage P { part def A; }", r#"{"op":"rename","key":"A","name":"B"}"#)
///   → "{\"edits\":[{\"start\":28,\"end\":29,\"text\":\"B\"}],…}"
/// edit_json(…, r#"{"op":"rename"}"#) → "{\"refused\":\"操作を読み込めませんでした（…）\"}"
/// ```
fn edit_json(text: &str, intent: &str) -> String {
    let result = serde_json::from_str::<modelith_core::edit::Intent>(intent)
        .map_err(|e| format!("操作を読み込めませんでした（{e}）"))
        .and_then(|i| modelith_core::edit::edit(text, &i));
    let json = match result {
        Ok(out) => serde_json::to_string(&out),
        Err(refused) => serde_json::to_string(&Refused { refused }),
    };
    json.unwrap_or_else(|e| format!(r#"{{"refused":"{e}"}}"#))
}

#[derive(Serialize)]
struct Analysis {
    parse: modelith_core::project::ParseResult,
    model: modelith_core::model::Model,
    findings: Vec<rules::Finding>,
}

/// テキストを解析・投影してモデルを作り、`{ parse, model }` を JSON にする（`analyze` の中身）。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
///
/// # 戻り値
///
/// `{ "parse": …, "model": … }` の JSON 文字列（位置は UTF-16 のオフセット）。JSON への変換に失敗したときは
/// `{"error":"理由"}`（文字列のキーだけの構造なので、実際には起きない）。
///
/// # 例
///
/// ```text
/// analyze_json("// 日本語\npart def A;") → "…\"kind\":\"part def\"…\"start\":7…"
/// analyze_json("")                      → "{\"parse\":{\"entries\":[],…},\"model\":{…}}"
/// ```
fn analyze_json(text: &str) -> String {
    analysis_json(text, &[])
}

/// テキストを解析・投影してモデルを作り、プラグインのルールを当て、`{ parse, model, findings }` を JSON にする。
/// 解析は 1 回だけ行い、モデルと検査で同じ結果を使う。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
/// - `plugins`：当てるプラグイン（空なら `findings` は空）
///
/// # 戻り値
///
/// `{ "parse": …, "model": …, "findings": [...] }` の JSON 文字列（位置は UTF-16 のオフセット）。
/// JSON への変換に失敗したときは `{"error":"理由"}`（文字列のキーだけの構造なので、実際には起きない）。
///
/// # 例
///
/// ```text
/// analysis_json("package P { requirement def R; }", [要求を満たす要素を求めるルール]) → "…\"findings\":[{…\"element\":\"R\",…}]}"
/// analysis_json("", [])                                                              → "…\"findings\":[]}"
/// ```
fn analysis_json(text: &str, plugins: &[LoadedPlugin]) -> String {
    let parse = modelith_core::project::project(text, &modelith_core::syntax::parse(text));
    let model = modelith_core::model::build(&parse);
    let findings = rules::check(plugins, &parse, &model);
    // 文字列のキーだけの構造なので、JSON への変換は失敗しない
    serde_json::to_string(&Analysis {
        parse,
        model,
        findings,
    })
    .unwrap_or_else(|e| format!(r#"{{"error":"{e}"}}"#))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyze_json_returns_entries_with_utf16_positions() {
        // Arrange（境界値: 位置の前に多バイト文字がある）
        let text = "// 日本語\npart def A;";
        // Act
        let json = analyze_json(text);
        // Assert
        assert!(json.contains(r#""kind":"part def""#), "{json}");
        assert!(json.contains(r#""start":7"#), "{json}");
    }

    #[test]
    fn edit_json_returns_utf16_edits_or_refusal() {
        // Arrange
        let text = "// 日本語\npackage P { part def A; }";
        // Act
        let ok = edit_json(text, r#"{"op":"rename","key":"A","name":"B"}"#);
        let bad = edit_json(text, r#"{"op":"rename"}"#);
        // Assert（正常系と、読み取れない意図の異常系）
        assert!(
            ok.contains(r#""edits":[{"start":28,"end":29,"text":"B"}]"#),
            "{ok}"
        );
        assert!(
            bad.starts_with(r#"{"refused":"操作を読み込めませんでした"#),
            "{bad}"
        );
    }

    #[test]
    fn parse_project_file_json_returns_project_and_problems() {
        // Arrange
        let ok = r#"{"name":"A","x":1}"#;
        // Act
        let good = parse_project_file_json(ok);
        let bad = parse_project_file_json("{");
        // Assert（正常系と、読み取れないテキストの異常系）
        assert!(
            good.starts_with(r#"{"project":{"name":"A","plugins":{},"x":1},"problems":[{"severity":"warning","line":1,"column":13,"#),
            "{good}"
        );
        assert!(
            bad.starts_with(
                r#"{"project":null,"problems":[{"severity":"error","line":1,"column":1,"#
            ),
            "{bad}"
        );
    }

    #[test]
    fn create_project_file_json_wraps_the_text() {
        // Arrange
        let name = "A";
        // Act
        let json = create_project_file_json(name);
        // Assert
        assert_eq!(
            json,
            r#"{"text":"{\n  \"name\": \"A\",\n  \"plugins\": {}\n}\n"}"#
        );
    }

    /// チェックルールのプラグイン 1 つ（要求に「満たす」関係が無ければ注意）の入力の JSON。
    fn plugin_input(enabled: bool) -> String {
        let manifest = r#"{"id":"jp.x","name":"トレーサビリティのチェック","version":"0.1.0","apiVersion":"0","runtime":"rules","license":"MIT","contributes":{"rules":["rules.yaml"]}}"#;
        let rules = "rules:\n  - id: req-sat\n    severity: warning\n    message: \"「{name}」を満たす要素がありません\"\n    match: { kind: requirement def }\n    require: { incoming: satisfy }\n";
        serde_json::json!([{ "id": "jp.x", "enabled": enabled, "files": { "modelith-plugin.json": manifest, "rules.yaml": rules } }]).to_string()
    }

    #[test]
    fn plugin_set_summarizes_and_checks_enabled_plugins() {
        // Arrange（日本語のコメントの後ろの要求。位置は UTF-16）
        let set = load_plugin_set(&plugin_input(true));
        // Act
        let json = analysis_json("// 日本語\npackage P { requirement def R; }", &set.active);
        // Assert
        assert_eq!(
            set.summary,
            r#"{"plugins":[{"enabled":true,"id":"jp.x","installed":true,"manifest":{"id":"jp.x","name":"トレーサビリティのチェック","runtime":"rules","version":"0.1.0"},"problems":[],"rules":1}]}"#
        );
        assert!(
            json.ends_with(r#""findings":[{"plugin":"jp.x","rule":"req-sat","severity":"warning","message":"「R」を満たす要素がありません","element":"R","pos":19}]}"#),
            "{json}"
        );
    }

    #[test]
    fn disabled_plugins_are_summarized_but_not_checked() {
        // Arrange
        let set = load_plugin_set(&plugin_input(false));
        // Act
        let json = analysis_json("package P { requirement def R; }", &set.active);
        // Assert
        assert!(
            set.summary.contains(r#""enabled":false"#),
            "{}",
            set.summary
        );
        assert!(json.ends_with(r#""findings":[]}"#), "{json}");
    }

    #[test]
    fn plugin_set_reports_missing_plugins_and_unreadable_input() {
        // Arrange（入っていないプラグインと、壊れた入力）
        let missing = r#"[{"id":"jp.none","files":{}}]"#;
        // Act
        let none = load_plugin_set(missing);
        let broken = load_plugin_set("[");
        // Assert
        assert!(
            none.summary.contains(r#""installed":false"#),
            "{}",
            none.summary
        );
        assert!(
            none.summary.contains(
                r#""path":".modelith/plugins/jp.none/modelith-plugin.json","place":null"#
            ),
            "{}",
            none.summary
        );
        assert_eq!(none.active.len(), 1); // 有効のまま（問題は summary に出す）
        assert!(
            broken
                .summary
                .starts_with(r#"{"error":"プラグインを読み込めませんでした"#),
            "{}",
            broken.summary
        );
        assert!(broken.active.is_empty());
    }

    #[test]
    fn update_project_plugin_json_returns_text_or_refusal() {
        // Arrange
        let text = "{}";
        // Act
        let added = update_project_plugin_json(text, "jp.x", r#"{"op":"add","version":"0.1.0"}"#);
        let missing = update_project_plugin_json(text, "jp.x", r#"{"op":"remove"}"#);
        let unreadable = update_project_plugin_json(text, "jp.x", r#"{"op":"rename"}"#);
        // Assert
        assert_eq!(
            added,
            r#"{"text":"{\n  \"plugins\": {\n    \"jp.x\": {\n      \"version\": \"0.1.0\",\n      \"enabled\": true\n    }\n  }\n}\n"}"#
        );
        assert_eq!(
            missing,
            r#"{"refused":"プロジェクトの設定（modelith.json）に、プラグイン「jp.x」がありません"}"#
        );
        assert!(
            unreadable.starts_with(r#"{"refused":"変更を読み込めませんでした"#),
            "{unreadable}"
        );
    }

    #[test]
    fn describe_plugin_json_returns_the_plugin_or_where_it_is_broken() {
        // Arrange
        let good = r#"{"id":"jp.x","name":"例","version":"0.1.0","apiVersion":"0","runtime":"browser","license":"MIT"}"#;
        // Act
        let ok = describe_plugin_json(good);
        let bad = describe_plugin_json("{\n  \"id\": 1\n}");
        // Assert
        assert_eq!(
            ok,
            r#"{"plugin":{"id":"jp.x","name":"例","runtime":"browser","version":"0.1.0"}}"#
        );
        assert!(
            bad.starts_with(r#"{"refused":"modelith-plugin.json の 2 行目："#),
            "{bad}"
        );
    }
}
