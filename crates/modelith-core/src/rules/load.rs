//! プラグインのマニフェストとルールのファイルを読み、使える形にする。問題は黙って捨てず、位置つきで返す（F-PLUG-3）。

use std::collections::{BTreeMap, HashSet};

use modelith_plugin_protocol::{
    API_VERSION, ElementMatch, OneOrMany, PluginId, PluginManifest, Requirement, Rule, RuleSet,
    Runtime,
};
use regex_lite::Regex;

use super::{
    CheckRule, Condition, LoadProblem, LoadedPlugin, MANIFEST_FILE, ManifestInfo, PLUGINS_DIR,
    Place, RELATIONS, ReadError, Target, element_kinds,
};
use crate::LineIndex;

/// プロジェクトに入れたプラグイン 1 つを読み込む。マニフェストを読み、`contributes.rules` のファイルを順に読む。
///
/// ファイルの読み込みは `read` に任せる（ブラウザと CLI で読み方が違うため）。問題のあるルールは使わず、
/// 問題として返す。マニフェストが使えなければ、ルールのファイルは読まない。
///
/// # 引数
///
/// - `id`：プラグインの ID（`modelith.json` の `plugins` のキー）
/// - `read`：プロジェクトのフォルダからの相対パス（`/` 区切り）を受け取り、ファイルのテキストを返す関数
///
/// # 戻り値
///
/// 読み込んだプラグイン（使えるルールと、読み込みの問題）。失敗しない。
///
/// # 例
///
/// ```text
/// load_plugin("jp.x", マニフェストと rules.yaml を返す read)  → rules: [rules.yaml のルール]、problems: []
/// load_plugin("jp.x", いつも NotFound を返す read)            → rules: []、problems: [「…プラグイン「jp.x」を使っていますが、入っていません…」]
/// load_plugin("../x", …)                                      → problems: [「プラグインの ID「../x」の形が正しくありません…」]（read は呼ばない）
/// ```
pub fn load_plugin(
    id: &str,
    mut read: impl FnMut(&str) -> Result<String, ReadError>,
) -> LoadedPlugin {
    let mut plugin = LoadedPlugin {
        id: id.to_owned(),
        installed: false,
        manifest: None,
        rules: Vec::new(),
        problems: Vec::new(),
    };
    // ID はフォルダの名前になるので、形を確かめてから読む（`..` などでフォルダの外を指させない）
    if id.parse::<PluginId>().is_err() {
        plugin.problems.push(problem(
            "modelith.json",
            None,
            format!(
                "プラグインの ID「{id}」の形が正しくありません。英小文字・数字・「-」を「.」で区切って書いてください（例：jp.example.rules）"
            ),
        ));
        return plugin;
    }
    let dir = format!("{PLUGINS_DIR}/{id}");
    let manifest_path = format!("{dir}/{MANIFEST_FILE}");
    let text = match read(&manifest_path) {
        Ok(text) => text,
        Err(e) => {
            plugin.installed = e != ReadError::NotFound;
            plugin
                .problems
                .push(manifest_read_problem(id, &manifest_path, &e));
            return plugin;
        }
    };
    plugin.installed = true;
    plugin.manifest = describe_manifest(&manifest_path, &text).ok();
    let (rule_paths, problems) = read_manifest(id, &manifest_path, &text);
    plugin.problems.extend(problems);
    let mut seen = HashSet::new();
    for path in rule_paths {
        let file = format!("{dir}/{path}");
        match read(&file) {
            Ok(text) => {
                let (rules, problems) = load_rule_file(&file, &text, &mut seen);
                plugin.rules.extend(rules);
                plugin.problems.extend(problems);
            }
            Err(e) => plugin.problems.push(rule_file_read_problem(&file, &e)),
        }
    }
    plugin
}

/// 画面から渡された、プラグインのフォルダの中のファイルから、プラグイン 1 つを読み込む（ブラウザで使う。ADR-0018 §1）。
///
/// [`load_plugin`] と同じ手順で読む。`load_plugin` が読もうとするパス（`.modelith/plugins/<id>/…`）を、
/// プラグインのフォルダからの相対パスに直して `files` から引く。
///
/// # 引数
///
/// - `id`：プラグインの ID（`modelith.json` の `plugins` のキー）
/// - `files`：プラグインのフォルダからの相対パス（`/` 区切り）→ ファイルのテキスト。入っていなければ空
///
/// # 戻り値
///
/// 読み込んだプラグイン。`files` に無いファイルは「見つからない」として扱う。
///
/// # 例
///
/// ```text
/// load_plugin_files("jp.x", { "modelith-plugin.json": …, "rules.yaml": … }) → rules: [rules.yaml のルール]、installed: true
/// load_plugin_files("jp.x", {})                                            → rules: []、installed: false、problems: [「…入っていません…」]
/// ```
pub fn load_plugin_files(id: &str, files: &BTreeMap<String, String>) -> LoadedPlugin {
    let prefix = format!("{PLUGINS_DIR}/{id}/");
    load_plugin(id, |path| {
        path.strip_prefix(&prefix)
            .and_then(|rel| files.get(rel))
            .cloned()
            .ok_or(ReadError::NotFound)
    })
}

/// マニフェストのテキストを読み、プラグインを画面に示すための情報（名前・版・実行方式）を返す（「追加」で使う）。
///
/// 使えるかどうか（`apiVersion`・`runtime`・ルールのファイル）は確かめない。それは読み込み（[`load_plugin`]）が行う。
///
/// # 引数
///
/// - `path`：マニフェストのパス（問題に書く）
/// - `text`：マニフェストのテキスト（JSON）
///
/// # 戻り値
///
/// マニフェストの情報。JSON として読めない・項目が足りない・知らない項目があるときは、位置つきの問題 1 件を `Err` で返す。
///
/// # 例
///
/// ```text
/// describe_manifest(p, r#"{"id":"jp.x","name":"例","version":"0.1.0","apiVersion":"0","runtime":"rules","license":"MIT"}"#)
///   → Ok(ManifestInfo { id: "jp.x", name: "例", version: "0.1.0", runtime: Rules, description: None })
/// describe_manifest(p, "{") → Err(誤り 1:2「書き方に誤りがあるため読み取れません（JSON：…）」)
/// ```
pub fn describe_manifest(path: &str, text: &str) -> Result<ManifestInfo, LoadProblem> {
    match serde_json::from_str::<PluginManifest>(text) {
        Ok(m) => Ok(ManifestInfo {
            id: m.id.to_string(),
            name: m.name,
            version: m.version,
            runtime: m.runtime,
            description: m.description,
        }),
        Err(e) => Err(problem(
            path,
            json_error_place(text, &e),
            describe_serde_error(&e.to_string(), "JSON"),
        )),
    }
}

/// 問題を作る。
///
/// # 引数
///
/// - `path`：ファイルのパス
/// - `place`：ファイルの中の位置（無ければ `None`）
/// - `message`：画面に出す文
///
/// # 戻り値
///
/// 問題 1 件。
///
/// # 例
///
/// ```text
/// problem("a.yaml", None, "x".into()) → LoadProblem { path: "a.yaml", place: None, message: "x" }
/// ```
fn problem(path: &str, place: Option<Place>, message: String) -> LoadProblem {
    LoadProblem {
        path: path.to_owned(),
        place,
        message,
    }
}

/// マニフェストを読めなかったことを、問題にする。無いときは、足りないプラグインとして案内する（F-PLUG-9）。
///
/// # 引数
///
/// - `id`：プラグインの ID
/// - `path`：マニフェストのパス
/// - `e`：読めなかった理由
///
/// # 戻り値
///
/// 問題 1 件（位置なし）。
///
/// # 例
///
/// ```text
/// manifest_read_problem("jp.x", "…/modelith-plugin.json", NotFound)
///   → 「このプロジェクトはプラグイン「jp.x」を使っていますが、入っていません…」
/// manifest_read_problem("jp.x", "…/modelith-plugin.json", Other("権限がありません"))
///   → 「プラグイン「jp.x」のマニフェストを読み取れません（権限がありません）」
/// ```
fn manifest_read_problem(id: &str, path: &str, e: &ReadError) -> LoadProblem {
    let message = match e {
        ReadError::NotFound => format!(
            "このプロジェクトはプラグイン「{id}」を使っていますが、入っていません。プラグインを {PLUGINS_DIR}/{id}/ に追加してください（{MANIFEST_FILE} が見つかりません）"
        ),
        ReadError::Other(reason) => {
            format!("プラグイン「{id}」のマニフェストを読み取れません（{reason}）")
        }
    };
    problem(path, None, message)
}

/// ルールのファイルを読めなかったことを、問題にする。
///
/// # 引数
///
/// - `path`：ルールのファイルのパス
/// - `e`：読めなかった理由
///
/// # 戻り値
///
/// 問題 1 件（位置なし）。
///
/// # 例
///
/// ```text
/// rule_file_read_problem("…/rules.yaml", NotFound) → 「マニフェストに書かれたルールのファイルが見つかりません（contributes.rules）」
/// ```
fn rule_file_read_problem(path: &str, e: &ReadError) -> LoadProblem {
    let message = match e {
        ReadError::NotFound => {
            "マニフェストに書かれたルールのファイルが見つかりません（contributes.rules）".to_owned()
        }
        ReadError::Other(reason) => format!("ルールのファイルを読み取れません（{reason}）"),
    };
    problem(path, None, message)
}

/// マニフェストを読み、使えるかを確かめ、ルールのファイルのパスを返す。
///
/// # 引数
///
/// - `id`：プラグインの ID（マニフェストの `id` と同じでなければならない）
/// - `path`：マニフェストのパス（問題に書く）
/// - `text`：マニフェストのテキスト
///
/// # 戻り値
///
/// ルールのファイルの、プラグインのフォルダからの相対パス（`/` 区切りに整えたもの）と、問題の一覧。
/// JSON の誤り・対応しない `apiVersion`・`runtime` が `rules` でない・ID の食い違いがあれば、パスは空。
///
/// # 例
///
/// ```text
/// read_manifest("jp.x", p, r#"{"id":"jp.x",…,"runtime":"rules","contributes":{"rules":["rules.yaml"]}}"#) → (["rules.yaml"], [])
/// read_manifest("jp.x", p, r#"{… "apiVersion": "1" …}"#) → ([], [「対応していない版（apiVersion「1」）です…」])
/// read_manifest("jp.x", p, "{") → ([], [誤り 1:2「書き方に誤りがあるため読み取れません（JSON：…）」])
/// ```
fn read_manifest(id: &str, path: &str, text: &str) -> (Vec<String>, Vec<LoadProblem>) {
    let manifest: PluginManifest = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            let place = json_error_place(text, &e);
            return (
                vec![],
                vec![problem(
                    path,
                    place,
                    describe_serde_error(&e.to_string(), "JSON"),
                )],
            );
        }
    };
    let mut problems = Vec::new();
    if manifest.api_version != API_VERSION {
        problems.push(problem(
            path,
            key_place(text, "apiVersion"),
            format!(
                "対応していない版（apiVersion「{}」）のプラグインです。この Modelith が読めるのは「{API_VERSION}」です",
                manifest.api_version
            ),
        ));
    }
    if manifest.runtime != Runtime::Rules {
        problems.push(problem(
            path,
            key_place(text, "runtime"),
            "検査ルールのプラグイン（runtime: rules）ではないため、ここでは使えません".to_owned(),
        ));
    }
    if manifest.id.as_str() != id {
        problems.push(problem(
            path,
            key_place(text, "id"),
            format!(
                "マニフェストの ID「{}」が、プロジェクトに書かれた ID「{id}」と違います",
                manifest.id
            ),
        ));
    }
    if !problems.is_empty() {
        return (vec![], problems);
    }
    let mut paths = Vec::new();
    for rule_path in &manifest.contributes.rules {
        match inside_plugin(rule_path) {
            Some(p) => paths.push(p),
            None => problems.push(problem(
                path,
                string_place(text, rule_path),
                format!(
                    "ルールのファイル「{rule_path}」は、プラグインのフォルダの中を、そこからの相対パスで指してください"
                ),
            )),
        }
    }
    (paths, problems)
}

/// プラグインのフォルダからの相対パスが、フォルダの中を指すなら、`/` 区切りに整えて返す。
///
/// # 引数
///
/// - `path`：マニフェストに書かれたパス（`/` か `\` 区切り）
///
/// # 戻り値
///
/// 整えたパス（`.` の区切りを除く）。空・絶対パス・ドライブ名つき・`..` を含むときは `None`。
///
/// # 例
///
/// ```text
/// inside_plugin("rules/a.yaml")   → Some("rules/a.yaml")
/// inside_plugin("./a.yaml")       → Some("a.yaml")
/// inside_plugin("rules\\a.yaml")  → Some("rules/a.yaml")
/// inside_plugin("../a.yaml")      → None
/// inside_plugin("/etc/a.yaml")    → None
/// inside_plugin("C:/a.yaml")      → None
/// inside_plugin("")               → None
/// ```
pub(super) fn inside_plugin(path: &str) -> Option<String> {
    if path.starts_with(['/', '\\']) || path.contains(':') {
        return None;
    }
    let parts: Vec<&str> = path
        .split(['/', '\\'])
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    if parts.is_empty() || parts.contains(&"..") {
        return None;
    }
    Some(parts.join("/"))
}

/// ルールのファイル 1 つを読み、使える形にする。
///
/// # 引数
///
/// - `path`：ファイルのパス（問題に書く）
/// - `text`：ファイルのテキスト（YAML）
/// - `seen`：同じプラグインの中で、すでに読んだルールの ID（読んだ ID を足す）
///
/// # 戻り値
///
/// 使えるルールと、問題の一覧。YAML として読めなければ、ルールは空で問題が 1 件。
///
/// # 例
///
/// ```text
/// load_rule_file(p, "rules:\n  - id: a\n    …", {}) → ([a], [])
/// load_rule_file(p, "rules:\n  - id: a\n    …", {"a"}) → ([], [誤り 2:5「ルールの ID「a」が重複しています…」])
/// load_rule_file(p, "rules: [", {}) → ([], [誤り「書き方に誤りがあるため読み取れません（YAML：…）」])
/// ```
fn load_rule_file(
    path: &str,
    text: &str,
    seen: &mut HashSet<String>,
) -> (Vec<CheckRule>, Vec<LoadProblem>) {
    let set: RuleSet = match serde_norway::from_str(text) {
        Ok(set) => set,
        Err(e) => {
            let place = e.location().map(|l| byte_place(text, l.index()));
            return (
                vec![],
                vec![problem(
                    path,
                    place,
                    describe_serde_error(&e.to_string(), "YAML"),
                )],
            );
        }
    };
    let places = rule_places(text);
    let places = (places.len() == set.rules.len()).then_some(places);
    let mut rules = Vec::new();
    let mut problems = Vec::new();
    for (i, rule) in set.rules.into_iter().enumerate() {
        let place = places.as_ref().and_then(|p| p.get(i).copied());
        let id = rule.id.to_string();
        if !seen.insert(id.clone()) {
            problems.push(problem(
                path,
                place,
                format!("ルールの ID「{id}」が重複しています。プラグインの中で 1 つにしてください"),
            ));
            continue;
        }
        match compile_rule(rule) {
            Ok(rule) => rules.push(rule),
            Err(messages) => problems.extend(
                messages
                    .into_iter()
                    .map(|m| problem(path, place, format!("ルール「{id}」：{m}"))),
            ),
        }
    }
    (rules, problems)
}

/// ルール 1 つの意味を確かめ、使える形にする（正規表現を組み立て、関係の種類をモデルの線の種類に直す）。
///
/// # 引数
///
/// - `rule`：YAML から読んだルール
///
/// # 戻り値
///
/// 使える形のルール。問題があれば、問題の文の一覧（1 つ以上）。
///
/// # 例
///
/// ```text
/// compile_rule(match.kind: "part def", require.incoming: "satisfy") → Ok(…)
/// compile_rule(match.kind: [])                                       → Err(["要素の種類（match.kind）が空です…"])
/// compile_rule(match.name: "[a", require.ports: {min: 2, max: 1})    → Err([正規表現の誤り, 数の範囲の誤り])
/// ```
fn compile_rule(rule: Rule) -> Result<CheckRule, Vec<String>> {
    let mut errors = Vec::new();
    let target = compile_target(&rule.target, &mut errors);
    let require = compile_condition(&rule.require, "require", &mut errors);
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(CheckRule {
        id: rule.id.to_string(),
        severity: rule.severity,
        message: rule.message,
        target,
        require,
    })
}

/// `match` を使える形にする。問題は `errors` に足す。
///
/// # 引数
///
/// - `m`：YAML から読んだ `match`
/// - `errors`：問題の文を足す先
///
/// # 戻り値
///
/// 使える形の `match`（問題があっても形は返す。使うかどうかは `errors` で決める）。
///
/// # 例
///
/// ```text
/// compile_target(kind: "part def")  → Target { kinds: ["part def"], … }、errors は増えない
/// compile_target(kind: "port")      → errors に「知らない要素の種類「port」です…」
/// compile_target(kind: [])          → errors に「要素の種類（match.kind）が空です…」
/// ```
fn compile_target(m: &ElementMatch, errors: &mut Vec<String>) -> Target {
    let kinds = m.kind.as_slice();
    if kinds.is_empty() {
        errors.push(
            "ルールを当てる要素の種類（match.kind）が空です。1 つ以上書いてください".to_owned(),
        );
    }
    let known = element_kinds();
    for kind in kinds {
        if !known.contains(&kind.as_str()) {
            errors.push(format!(
                "知らない要素の種類「{kind}」です（match.kind）。書ける種類：{}",
                known.join("・")
            ));
        }
    }
    Target {
        kinds: kinds.to_vec(),
        phase: m.phase.clone(),
        name: m
            .name
            .as_deref()
            .and_then(|p| compile_regex(p, "match.name", errors)),
    }
}

/// `require`（と、その中の `not`）を使える形にする。問題は `errors` に足す。
///
/// # 引数
///
/// - `r`：YAML から読んだ条件
/// - `at`：条件の場所（`require`・`require.not` など。問題の文に書く）
/// - `errors`：問題の文を足す先
///
/// # 戻り値
///
/// 使える形の条件（問題があっても形は返す）。
///
/// # 例
///
/// ```text
/// compile_condition(incoming: "derivation", "require", …) → Condition { incoming: Some(["derive"]), … }
/// compile_condition(ports: {min: 2, max: 1}, "require", …) → errors に「ポートの数の下限（2）が上限（1）より大きいです（require.ports）」
/// compile_condition(not: {name: "["}, "require", …)       → errors に「…（require.not.name「[」…）」
/// ```
fn compile_condition(r: &Requirement, at: &str, errors: &mut Vec<String>) -> Condition {
    if let Some(ports) = r.ports
        && let (Some(min), Some(max)) = (ports.min, ports.max)
        && min > max
    {
        errors.push(format!(
            "ポートの数の下限（{min}）が上限（{max}）より大きいです（{at}.ports）"
        ));
    }
    Condition {
        incoming: r
            .incoming
            .as_ref()
            .map(|k| compile_relations(k, &format!("{at}.incoming"), errors)),
        outgoing: r
            .outgoing
            .as_ref()
            .map(|k| compile_relations(k, &format!("{at}.outgoing"), errors)),
        name: r
            .name
            .as_deref()
            .and_then(|p| compile_regex(p, &format!("{at}.name"), errors)),
        phase: r.phase,
        ports: r.ports.map(|p| (p.min, p.max)),
        not: r
            .not
            .as_ref()
            .map(|n| Box::new(compile_condition(n, &format!("{at}.not"), errors))),
    }
}

/// 関係の種類の並びを、モデルの線の種類に直す。問題は `errors` に足す。
///
/// # 引数
///
/// - `kinds`：ルールに書いた関係の種類（1 つか並び）
/// - `at`：書いた場所（`require.incoming` など。問題の文に書く）
/// - `errors`：問題の文を足す先
///
/// # 戻り値
///
/// モデルの線の種類（知らない種類は除く）。
///
/// # 例
///
/// ```text
/// compile_relations("derivation", …)        → ["derive"]
/// compile_relations(["satisfy", "verify"], …) → ["satisfy", "verify"]
/// compile_relations("refinement", …)        → []、errors に「知らない関係の種類「refinement」です…」
/// compile_relations([], …)                  → []、errors に「関係の種類（require.incoming）が空です…」
/// ```
fn compile_relations(kinds: &OneOrMany, at: &str, errors: &mut Vec<String>) -> Vec<&'static str> {
    let kinds = kinds.as_slice();
    if kinds.is_empty() {
        errors.push(format!(
            "関係の種類（{at}）が空です。1 つ以上書いてください"
        ));
    }
    kinds
        .iter()
        .filter_map(|k| {
            let found = RELATIONS
                .iter()
                .find(|(name, _)| name == k)
                .map(|(_, e)| *e);
            if found.is_none() {
                let names: Vec<&str> = RELATIONS.iter().map(|(n, _)| *n).collect();
                errors.push(format!(
                    "知らない関係の種類「{k}」です（{at}）。書ける種類：{}",
                    names.join("・")
                ));
            }
            found
        })
        .collect()
}

/// 正規表現を組み立てる。誤りは `errors` に足す。
///
/// # 引数
///
/// - `pattern`：正規表現（`regex-lite` の書き方）
/// - `at`：書いた場所（`match.name` など。問題の文に書く）
/// - `errors`：問題の文を足す先
///
/// # 戻り値
///
/// 組み立てた正規表現。誤りがあれば `None`。
///
/// # 例
///
/// ```text
/// compile_regex("^[A-Z]", "match.name", …) → Some(…)
/// compile_regex("[a", "match.name", …)     → None、errors に「名前の正規表現に誤りがあります（match.name「[a」：…）」
/// ```
fn compile_regex(pattern: &str, at: &str, errors: &mut Vec<String>) -> Option<Regex> {
    match Regex::new(pattern) {
        Ok(re) => Some(re),
        Err(e) => {
            let reason = e.to_string().replace('\n', " ");
            errors.push(format!(
                "名前の正規表現に誤りがあります（{at}「{pattern}」：{}）",
                reason.trim()
            ));
            None
        }
    }
}

/// serde の読み取りの失敗の文を、画面の言葉にする。よくある失敗は意味を先に書き、元の文を括弧に添える。
///
/// # 引数
///
/// - `raw`：serde_json・serde_norway の失敗の文（末尾の ` at line … column …` は除く）
/// - `format`：ファイルの形式（`JSON`・`YAML`。分からない失敗のときに書く）
///
/// # 戻り値
///
/// 画面に出す文。
///
/// # 例
///
/// ```text
/// describe_serde_error("rules[0].require: unknown field `x`, expected one of … at line 8 column 7", "YAML")
///   → "知らない項目「x」があります（rules[0].require: unknown field `x`, expected one of …）"
/// describe_serde_error("missing field `severity`", "YAML") → "必要な項目「severity」がありません（missing field `severity`）"
/// describe_serde_error("unknown variant `fatal`, …", "YAML") → "使えない値「fatal」です（unknown variant `fatal`, …）"
/// describe_serde_error("EOF while parsing an object at line 1 column 1", "JSON")
///   → "書き方に誤りがあるため読み取れません（JSON：EOF while parsing an object）"
/// ```
pub(super) fn describe_serde_error(raw: &str, format: &str) -> String {
    let raw = raw.rfind(" at line ").map_or(raw, |i| &raw[..i]);
    let quoted = |after: &str| {
        let rest = &raw[raw.find(after)? + after.len()..];
        rest.find('`').map(|end| rest[..end].to_owned())
    };
    if let Some(key) = quoted("unknown field `") {
        format!("知らない項目「{key}」があります（{raw}）")
    } else if let Some(key) = quoted("missing field `") {
        format!("必要な項目「{key}」がありません（{raw}）")
    } else if let Some(value) = quoted("unknown variant `") {
        format!("使えない値「{value}」です（{raw}）")
    } else if raw.contains("invalid rule id") {
        format!(
            "ルールの ID は、英小文字・数字・「-」で書いてください（例：req-has-satisfier。{raw}）"
        )
    } else if raw.contains("invalid plugin id") {
        format!(
            "プラグインの ID は、英小文字・数字・「-」を「.」で区切って書いてください（例：jp.example.rules。{raw}）"
        )
    } else {
        format!("書き方に誤りがあるため読み取れません（{format}：{raw}）")
    }
}

/// バイトの位置を、1 始まりの行・列（UTF-16 コード単位）にする。
///
/// # 引数
///
/// - `text`：テキスト全体
/// - `offset`：バイトの位置。文字の途中ならその文字の先頭、範囲外ならテキストの末尾として扱う
///
/// # 戻り値
///
/// 1 始まりの行と列。
///
/// # 例
///
/// ```text
/// byte_place("日\nab", 5)  → Place { line: 2, column: 2 }
/// byte_place("日\nab", 1)  → Place { line: 1, column: 1 }   // 「日」の途中は、その先頭
/// byte_place("日\nab", 99) → Place { line: 2, column: 3 }   // 範囲外は末尾
/// ```
pub(crate) fn byte_place(text: &str, offset: usize) -> Place {
    let index = LineIndex::new(text);
    let pos = (0..=offset.min(text.len()))
        .rev()
        .find_map(|o| index.line_col(o))
        .unwrap_or(crate::LineCol { line: 0, col: 0 });
    Place {
        line: pos.line + 1,
        column: pos.col + 1,
    }
}

/// serde_json の失敗の位置を、1 始まりの行・列にする。
///
/// # 引数
///
/// - `text`：JSON のテキスト全体
/// - `e`：serde_json の失敗（行は 1 始まり、列は行頭からのバイト数）
///
/// # 戻り値
///
/// 1 始まりの行と列（UTF-16）。位置の無い失敗（行が 0）は `None`。
///
/// # 例
///
/// ```text
/// json_error_place("{\n  \"a\": 1,\n}", e) → Some(Place { line: 3, column: 1 })
/// ```
fn json_error_place(text: &str, e: &serde_json::Error) -> Option<Place> {
    if e.line() == 0 {
        return None;
    }
    let line_start: usize = text
        .split_inclusive('\n')
        .take(e.line() - 1)
        .map(str::len)
        .sum();
    Some(byte_place(text, line_start + e.column().saturating_sub(1)))
}

/// JSON のテキストで、キー `"key"` が最初に現れる位置。
///
/// # 引数
///
/// - `text`：JSON のテキスト
/// - `key`：探すキー（エスケープの要らない名前）
///
/// # 戻り値
///
/// キーの `"` の位置（1 始まり）。見つからなければ `None`。
///
/// # 例
///
/// ```text
/// key_place("{\n  \"runtime\": \"browser\"\n}", "runtime") → Some(Place { line: 2, column: 3 })
/// key_place("{}", "runtime")                                → None
/// ```
fn key_place(text: &str, key: &str) -> Option<Place> {
    let needle = format!("\"{key}\"");
    text.find(&needle).map(|i| byte_place(text, i))
}

/// JSON のテキストで、文字列の値 `value` が最初に現れる位置。
///
/// # 引数
///
/// - `text`：JSON のテキスト
/// - `value`：探す文字列（JSON の書き方に直して探す）
///
/// # 戻り値
///
/// 文字列の `"` の位置（1 始まり）。見つからなければ `None`。
///
/// # 例
///
/// ```text
/// string_place("{\"rules\": [\"../a.yaml\"]}", "../a.yaml") → Some(Place { line: 1, column: 12 })
/// string_place("{}", "a")                                   → None
/// ```
fn string_place(text: &str, value: &str) -> Option<Place> {
    let needle = serde_json::to_string(value).ok()?;
    text.find(&needle).map(|i| byte_place(text, i))
}

/// ルールのファイル（ブロック形式の YAML）で、各ルールの `id:` の位置を、書いた順に集める。
///
/// `id` のキーを持つのはルールだけなので、行頭（字下げと `- ` の後）の `id:` をルールの始まりとみなす。
/// フロー形式（`{ id: a, … }`）で書いたルールは見つからない（呼び出し側は数が合わなければ位置を使わない）。
///
/// # 引数
///
/// - `text`：ルールのファイルのテキスト
///
/// # 戻り値
///
/// `id` のキーの位置（1 始まり）の一覧。
///
/// # 例
///
/// ```text
/// rule_places("rules:\n  - id: a\n  - severity: x\n    id: b\n") → [Place { 2, 5 }, Place { 4, 5 }]
/// rule_places("rules: []\n")                                     → []
/// ```
pub(super) fn rule_places(text: &str) -> Vec<Place> {
    let mut places = Vec::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let body = line.trim_start_matches([' ', '\t']);
        let body = body
            .strip_prefix('-')
            .map_or(body, |rest| rest.trim_start_matches([' ', '\t']));
        if body.starts_with("id:") || body.starts_with("\"id\":") || body.starts_with("'id':") {
            places.push(byte_place(text, offset + (line.len() - body.len())));
        }
        offset += line.len();
    }
    places
}
