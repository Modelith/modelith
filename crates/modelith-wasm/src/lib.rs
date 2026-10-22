//! ブラウザ向けの wasm バインディング。Web Worker 内で読み込まれ、
//! UI とは LSP と同じ形のメッセージでやり取りする（ADR-0003）。

use std::cell::RefCell;
use std::collections::BTreeMap;

use modelith_core::project::ParseResult;
use modelith_core::project::merge::Files;
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

/// テキストを解析してモデルを作り、画面の型（`web/src/core/types.ts`）と同じ形の `{ parse, model }` を JSON で返す（ADR-0015・ADR-0016）。
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

/// テキストを解析し、v1 のプラグインに渡すモデル（plugin-sdk の `ModelSnapshot`）を JSON で返す（ADR-0018 §3 の `didChange`）。
///
/// 中身は `model_snapshot_json` に任せる。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
///
/// # 戻り値
///
/// `{ "elements": [...], "relations": [...] }` の JSON 文字列（位置は 0 始まりの行・列。列は UTF-16）。
///
/// # 例
///
/// ```text
/// modelSnapshot("package P { part def A; }") → r#"{"elements":[{"key":"A","name":"A","kind":"part def","ports":[],"range":{…}}],"relations":[]}"#
/// modelSnapshot("")                          → r#"{"elements":[],"relations":[]}"#
/// ```
#[wasm_bindgen(js_name = modelSnapshot)]
pub fn model_snapshot(text: &str) -> String {
    model_snapshot_json(text)
}

/// v1 のプラグインから届いたメッセージを、plugin-sdk の型で読み、宣言した権限で許されるかを確かめ、
/// 変更案と診断の範囲を今のテキストの位置に直して、JSON で返す（ADR-0018 §3・§4）。
///
/// 中身は `check_plugin_message_json` に任せる。
///
/// # 引数
///
/// - `text`：今のテキスト全体
/// - `message`：プラグインから届いたメッセージの JSON
/// - `permissions`：マニフェストで宣言した権限の JSON（`["model:read","edits:propose"]` など）
///
/// # 戻り値
///
/// `{ "message": …, "edits"?: [{ start, end, text }], "diagnostics"?: [{ pos, end, severity, message, code? }] }`（位置は UTF-16）。
/// 使えないときは `{ "refused": "プラグインの一覧に出す理由" }`。
///
/// # 例
///
/// ```text
/// checkPluginMessage("ab", r#"{"type":"ready"}"#, "[]") → r#"{"message":{"type":"ready"}}"#
/// checkPluginMessage("ab", r#"{"type":"proposeEdits",…}"#, "[]") → r#"{"refused":"宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした"}"#
/// ```
#[wasm_bindgen(js_name = checkPluginMessage)]
pub fn check_plugin_message(text: &str, message: &str, permissions: &str) -> String {
    check_plugin_message_json(text, message, permissions)
}

thread_local! {
    /// プロジェクトのファイルごとの解析結果（ADR-0021 §3）。Worker が 1 つ持ち、解析と編集でつなぐ。
    static FILES: RefCell<Files> = RefCell::new(Files::default());
    /// 表示中のファイルのパス（プロジェクトのフォルダからの）。フォルダの外のファイルなら None。
    static FOCUS: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// プロジェクトのファイルを覚える（同じパスなら解析し直して置き換える。ADR-0021 §3）。
/// 表示中のファイルも覚えてよい（解析のときは、覚えたものではなく今のテキストを使う）。
///
/// # 引数
///
/// - `path`：プロジェクトのフォルダからのパス
/// - `text`：ファイルのテキスト
///
/// # 例
///
/// ```text
/// setProjectFile("parts.sysml", "package Parts { part def Car; }") → 以後の analyze で Parts::Car が見える
/// ```
#[wasm_bindgen(js_name = setProjectFile)]
pub fn set_project_file(path: &str, text: &str) {
    FILES.with(|f| f.borrow_mut().set(path, text));
}

/// プロジェクトのファイルを忘れる（消した・名前を変えたとき）。
///
/// # 引数
///
/// - `path`：プロジェクトのフォルダからのパス
///
/// # 例
///
/// ```text
/// removeProjectFile("parts.sysml") → 以後の analyze で Parts::Car が見えない
/// ```
#[wasm_bindgen(js_name = removeProjectFile)]
pub fn remove_project_file(path: &str) {
    FILES.with(|f| f.borrow_mut().remove(path));
}

/// プロジェクトのファイルをすべて忘れる（フォルダを閉じた・別のフォルダを開いたとき）。
///
/// # 例
///
/// ```text
/// clearProjectFiles() → 以後の analyze は表示中のファイルだけ
/// ```
#[wasm_bindgen(js_name = clearProjectFiles)]
pub fn clear_project_files() {
    FILES.with(|f| f.borrow_mut().clear());
}

/// 表示中のファイルのパスを決める（そのパスの覚えたファイルは、ほかのファイルとしてつながない）。
///
/// # 引数
///
/// - `path`：プロジェクトのフォルダからのパス。フォルダの外のファイル・無題のファイルなら undefined
///
/// # 例
///
/// ```text
/// setFocusFile("app.sysml") → analyze は app.sysml 以外の覚えたファイルをつなぐ
/// setFocusFile(undefined)   → analyze は覚えたファイルをすべてつなぐ
/// ```
#[wasm_bindgen(js_name = setFocusFile)]
pub fn set_focus_file(path: Option<String>) {
    FOCUS.with(|f| *f.borrow_mut() = path);
}

/// 表示中のファイルの今のテキストをつないで、覚えたほかのファイルごとの問題とチェックルールの結果を JSON で返す（ADR-0021 §6）。
///
/// # 引数
///
/// - `text`：表示中のファイルの今のテキスト
///
/// # 戻り値
///
/// `[{ "path", "problems": [{ pos, msg, kind? }], "findings": [...] }]`（パスの順。位置はそのファイルの UTF-16）。
///
/// # 例
///
/// ```text
/// projectProblems("package App;") → r#"[{"path":"parts.sysml","problems":[{"pos":33,"msg":"型「Wheel」が見つかりません（w）"}],"findings":[]}]"#
/// ```
#[wasm_bindgen(js_name = projectProblems)]
pub fn project_problems(text: &str) -> String {
    project_problems_json(text, &[])
}

/// `projectProblems` の本体。覚えたファイルと表示中のファイルのパスを読み、ファイルごとに数える。
///
/// # 引数
///
/// - `text`：表示中のファイルの今のテキスト
/// - `plugins`：当てるプラグイン
///
/// # 戻り値
///
/// ファイルごとの問題と結果の JSON（`project_problems` と同じ形）。覚えたファイルが無ければ `[]`。
///
/// # 例
///
/// ```text
/// project_problems_json("package App;", &[]) → "[]"   // 覚えたファイルが無い
/// ```
fn project_problems_json(text: &str, plugins: &[LoadedPlugin]) -> String {
    let focus = FOCUS.with(|f| f.borrow().clone());
    let now = modelith_core::project::merge::parse_file(text);
    let open = focus.as_deref().zip(now.as_ref());
    let reports = FILES.with(|f| rules::check_files(&f.borrow(), open, plugins));
    serde_json::to_string(&reports).unwrap_or_else(|_| "[]".to_owned())
}

/// 表示中のファイルを除いた、覚えたほかのファイルのパスと解析結果（`Files::others`）。
///
/// # 戻り値
///
/// （パスの並び、解析結果の並び）。i 番目のパスのファイルは、モデルでファイルの番号 i + 1 になる。
///
/// # 例
///
/// ```text
/// // parts.sysml・app.sysml を覚え、表示中が app.sysml のとき
/// others() → (["parts.sysml"], [parts の解析結果])
/// ```
fn others() -> (Vec<String>, Vec<ParseResult>) {
    let focus = FOCUS.with(|f| f.borrow().clone());
    FILES.with(|f| f.borrow().others(focus.as_deref()))
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

    /// 覚えたほかのファイルごとの問題に、使う（有効な）プラグインのルールの結果を添えて JSON で返す（`projectProblems` と同じ形。ADR-0021 §6）。
    ///
    /// # 引数
    ///
    /// - `text`：表示中のファイルの今のテキスト
    ///
    /// # 戻り値
    ///
    /// `[{ "path", "problems", "findings" }]` の JSON。
    ///
    /// # 例
    ///
    /// ```text
    /// plugins.projectProblems("package App;") → r#"[{"path":"parts.sysml","problems":[],"findings":[{"plugin":"jp.x",…}]}]"#
    /// ```
    #[wasm_bindgen(js_name = projectProblems)]
    pub fn project_problems(&self, text: &str) -> String {
        project_problems_json(text, &self.set.active)
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

/// テキストを解析し、プラグインに渡すモデルを JSON にする（`model_snapshot` の中身）。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
///
/// # 戻り値
///
/// `ModelSnapshot` の JSON 文字列。JSON への変換に失敗したときは `{"elements":[],"relations":[]}`
/// （文字列のキーだけの構造なので、実際には起きない）。
///
/// # 例
///
/// ```text
/// model_snapshot_json("package P { part def A; }") → "{\"elements\":[{\"key\":\"A\",…}],\"relations\":[]}"
/// model_snapshot_json("")                          → "{\"elements\":[],\"relations\":[]}"
/// ```
fn model_snapshot_json(text: &str) -> String {
    let parse = modelith_core::project::project(text, &modelith_core::syntax::parse(text));
    let model = modelith_core::model::build(&parse);
    serde_json::to_string(&modelith_core::plugin_host::snapshot(text, &parse, &model))
        .unwrap_or_else(|_| r#"{"elements":[],"relations":[]}"#.to_owned())
}

/// プラグインのメッセージを確かめ、結果か断りを JSON にする（`check_plugin_message` の中身）。
///
/// # 引数
///
/// - `text`：今のテキスト全体
/// - `message`：プラグインから届いたメッセージの JSON
/// - `permissions`：宣言した権限の JSON の並び
///
/// # 戻り値
///
/// `{ "message": …, "edits"?, "diagnostics"? }`。権限の並びが読めない・メッセージが使えないときは `{ "refused": "理由" }`。
///
/// # 例
///
/// ```text
/// check_plugin_message_json("", r#"{"type":"ready"}"#, "[]")       → r#"{"message":{"type":"ready"}}"#
/// check_plugin_message_json("", r#"{"type":"ready"}"#, r#"["fs"]"#) → r#"{"refused":"権限の並びを読み込めませんでした（…）"}"#
/// ```
fn check_plugin_message_json(text: &str, message: &str, permissions: &str) -> String {
    let result = serde_json::from_str::<Vec<rules::Permission>>(permissions)
        .map_err(|e| format!("権限の並びを読み込めませんでした（{e}）"))
        .and_then(|p| modelith_core::plugin_host::check_message(text, message, &p));
    let json = match result {
        Ok(checked) => serde_json::to_string(&checked),
        Err(refused) => Ok(refused_json(&refused)),
    };
    json.unwrap_or_else(|e| refused_json(&e.to_string()))
}

/// 断りの JSON（`{ "refused": 理由 }`）を作る。理由に `"` や `\` があっても、JSON として壊れない。
///
/// # 引数
///
/// - `reason`：画面に出す理由の文
///
/// # 戻り値
///
/// `{"refused":"理由"}` の JSON 文字列（理由は JSON の決まりで逃がす）。失敗しない。
///
/// # 例
///
/// ```text
/// refused_json("使えません")      → r#"{"refused":"使えません"}"#
/// refused_json(r#"名前 "a\b""#) → r#"{"refused":"名前 \"a\\b\""}"#
/// ```
fn refused_json(reason: &str) -> String {
    serde_json::json!({ "refused": reason }).to_string()
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
    let (paths, parsed) = others();
    edit_json_in(text, &paths, parsed, intent)
}

/// `edit_json` の本体。ほかのファイルとつないだモデルで意図を当て、ほかのファイルの要素を書き換えようとしたら、
/// そのファイルのパスを添えて断る（ADR-0021 §5）。
///
/// # 引数
///
/// - `text`：表示中のファイルの今のテキスト全体
/// - `paths`：ほかのファイルのパス（`parsed` と同じ順）
/// - `parsed`：ほかのファイルの解析結果
/// - `intent`：図の操作の意図の JSON
///
/// # 戻り値
///
/// 編集の結果の JSON。断るときは `{"refused":"…"}`、ほかのファイルの要素なら `{"refused":"…","file":"parts.sysml"}`。
///
/// # 例
///
/// ```text
/// edit_json_in("package App { part c : Parts::Car; }", ["parts.sysml"], [parts], r#"{"op":"rename","key":"Car","name":"Bus"}"#)
///   → r#"{"refused":"この要素はほかのファイルにあります。…","file":"parts.sysml"}"#
/// ```
fn edit_json_in(text: &str, paths: &[String], parsed: Vec<ParseResult>, intent: &str) -> String {
    let intent = match serde_json::from_str::<modelith_core::edit::Intent>(intent) {
        Ok(i) => i,
        Err(e) => return refused_json(&format!("操作を読み込めませんでした（{e}）")),
    };
    let json = match modelith_core::edit::edit_in(text, parsed, &intent) {
        Ok(out) => serde_json::to_string(&out),
        Err(r) => {
            let file = r.file.and_then(|f| paths.get(f - 1));
            Ok(match file {
                Some(path) => serde_json::json!({ "refused": r.reason, "file": path }).to_string(),
                None => refused_json(&r.reason),
            })
        }
    };
    json.unwrap_or_else(|e| refused_json(&e.to_string()))
}

#[derive(Serialize)]
struct Analysis {
    parse: modelith_core::project::ParseResult,
    model: modelith_core::model::Model,
    findings: Vec<rules::Finding>,
    /// つないだほかのファイルのパス（`Node.file` が i なら i - 1 番目。ADR-0021）。
    files: Vec<String>,
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
    let (paths, parsed) = others();
    analysis_json_in(text, paths, parsed, plugins)
}

/// `analysis_json` の本体。ほかのファイルとつないだモデルを作り、ルールはファイルをまたぐ関係も数えて当てる（ADR-0021）。
///
/// # 引数
///
/// - `text`：表示中のファイルのテキスト全体
/// - `paths`：ほかのファイルのパス（`parsed` と同じ順）
/// - `parsed`：ほかのファイルの解析結果
/// - `plugins`：当てるプラグイン
///
/// # 戻り値
///
/// `{ parse, model, findings, files }` の JSON。`model` は表示中のファイルの要素と、それが参照するほかのファイルの要素だけ。
///
/// # 例
///
/// ```text
/// analysis_json_in("package App { part c : Parts::Car; }", ["parts.sysml"], [parts], [])
///   → "…"nodes":[{"key":"c",…},{"key":"Car",…,"file":1}]…"files":["parts.sysml"]}"
/// ```
fn analysis_json_in(
    text: &str,
    paths: Vec<String>,
    parsed: Vec<ParseResult>,
    plugins: &[LoadedPlugin],
) -> String {
    let parse = modelith_core::project::merge::join(text, parsed);
    let whole = modelith_core::model::build_whole(&parse);
    let findings = rules::check(plugins, &parse, &whole);
    let model = modelith_core::model::narrow(whole, &parse);
    // 文字列のキーだけの構造なので、JSON への変換は失敗しない
    serde_json::to_string(&Analysis {
        parse,
        model,
        findings,
        files: paths,
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
    fn refused_json_escapes_quotes_and_backslashes() {
        // Arrange（JSON を壊しうる文字：二重引用符・バックスラッシュ）
        let reason = r#"ファイル "a\b" を読み込めません"#;
        // Act
        let json = refused_json(reason);
        // Assert（JSON として読め、理由がそのまま戻る）
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["refused"], reason);
    }

    #[test]
    fn check_plugin_message_json_refusal_is_valid_json() {
        // Arrange（読めない権限の並び。理由に serde の文が入る）
        let permissions = r#"["not-a-permission"]"#;
        // Act
        let json = check_plugin_message_json("", r#"{"type":"ready"}"#, permissions);
        // Assert
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert!(
            parsed["refused"]
                .as_str()
                .is_some_and(|r| r.starts_with("権限の並びを読み込めませんでした")),
            "{json}"
        );
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
            json.ends_with(r#""findings":[{"plugin":"jp.x","rule":"req-sat","severity":"warning","message":"「R」を満たす要素がありません","element":"R","pos":19}],"files":[]}"#),
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
        assert!(json.ends_with(r#""findings":[],"files":[]}"#), "{json}");
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
    fn model_snapshot_json_lists_elements() {
        // Arrange
        let text = "package P { part def A; }";
        // Act
        let json = model_snapshot_json(text);
        // Assert
        assert!(
            json.starts_with(r#"{"elements":[{"key":"A","name":"A","kind":"part def","ports":[],"range":{"start":{"line":0,"character":12}"#),
            "{json}"
        );
    }

    #[test]
    fn check_plugin_message_json_returns_the_message_or_a_refusal() {
        // Arrange
        let edits = r#"{"type":"proposeEdits","version":1,"edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}},"newText":"A"}]}"#;
        // Act
        let ok = check_plugin_message_json("ab", edits, r#"["edits:propose"]"#);
        let denied = check_plugin_message_json("ab", edits, "[]");
        let bad_permissions = check_plugin_message_json("ab", r#"{"type":"ready"}"#, r#"["fs"]"#);
        // Assert
        assert!(
            ok.ends_with(r#""edits":[{"start":0,"end":1,"text":"A"}]}"#),
            "{ok}"
        );
        assert!(
            denied.starts_with(r#"{"refused":"宣言していない権限（edits:propose）"#),
            "{denied}"
        );
        assert!(
            bad_permissions.starts_with(r#"{"refused":"権限の並びを読み込めませんでした"#),
            "{bad_permissions}"
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

    /// ほかのファイル parts.sysml の解析結果。
    fn parts() -> (Vec<String>, Vec<ParseResult>) {
        let p = modelith_core::project::merge::parse_file("package Parts { part def Car; }")
            .expect("短い");
        (vec!["parts.sysml".to_owned()], vec![p])
    }

    #[test]
    fn analysis_names_the_files_of_other_elements() {
        // Arrange
        let (paths, parsed) = parts();
        // Act
        let json = analysis_json_in("package App { part c : Parts::Car; }", paths, parsed, &[]);
        // Assert（ほかのファイルの要素は、ファイルの番号と、その番号のパスを持つ）
        let v: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(v["files"], serde_json::json!(["parts.sysml"]));
        let car = v["model"]["nodes"]
            .as_array()
            .and_then(|ns| ns.iter().find(|n| n["key"] == "Car"))
            .expect("Car");
        assert_eq!(car["file"], 1);
    }

    #[test]
    fn edit_of_another_file_is_refused_with_its_path() {
        // Arrange（異常系：ほかのファイルの要素の名前を変える）
        let (paths, parsed) = parts();
        // Act
        let json = edit_json_in(
            "package App { part c : Parts::Car; }",
            &paths,
            parsed,
            r#"{"op":"rename","key":"Car","name":"Bus"}"#,
        );
        // Assert
        let v: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(v["file"], "parts.sysml");
        assert_eq!(v["refused"], modelith_core::edit::IN_OTHER_FILE);
    }

    #[test]
    fn project_problems_are_counted_for_each_remembered_file() {
        // Arrange（parts.sysml は表示中の app.sysml の Wheel を import している）
        clear_project_files();
        set_project_file(
            "parts.sysml",
            "package Parts { import App::*; part def Car { part w : Wheel; part x : Nope; } }",
        );
        set_focus_file(Some("app.sysml".to_owned()));
        // Act
        let json = project_problems("package App { part def Wheel; }");
        // Assert
        let v: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(v[0]["path"], "parts.sysml");
        let msgs: Vec<&str> = v[0]["problems"]
            .as_array()
            .expect("problems")
            .iter()
            .filter_map(|p| p["msg"].as_str())
            .collect();
        assert_eq!(msgs, ["型「Nope」が見つかりません（x）"]);
        clear_project_files();
        set_focus_file(None);
    }
}
