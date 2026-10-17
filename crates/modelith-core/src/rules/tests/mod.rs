//! v0 の検査ルール（ADR-0018 §2）の単体テスト。読み込み（F-PLUG-3）は `load.rs`、検査（F-PLUG-1）は `check.rs`。

mod check;
mod load;

use std::collections::HashMap;

use super::{LoadedPlugin, ReadError, load_plugin};

/// テストのプラグインの ID。
const ID: &str = "jp.example.rules";

/// プラグインのフォルダ（プロジェクトのフォルダからの相対パス）。
const DIR: &str = ".modelith/plugins/jp.example.rules";

/// 検査ルールのプラグインのマニフェスト（ルールのファイルは `rules`）。
fn manifest(rules: &[&str]) -> String {
    let list: Vec<String> = rules.iter().map(|r| format!("\"{r}\"")).collect();
    format!(
        "{{\n  \"id\": \"{ID}\",\n  \"name\": \"例\",\n  \"version\": \"0.1.0\",\n  \"apiVersion\": \"0\",\n  \"runtime\": \"rules\",\n  \"license\": \"MIT\",\n  \"contributes\": {{ \"rules\": [{}] }}\n}}\n",
        list.join(", ")
    )
}

/// 偽のファイル（プロジェクトのフォルダからの相対パス → テキスト）から読み込む。
fn load_files(id: &str, files: &[(&str, &str)]) -> LoadedPlugin {
    let files: HashMap<String, String> = files
        .iter()
        .map(|(p, t)| ((*p).to_owned(), (*t).to_owned()))
        .collect();
    load_plugin(id, |path| {
        files.get(path).cloned().ok_or(ReadError::NotFound)
    })
}

/// マニフェストと `rules.yaml`（中身は `yaml`）だけのプラグインを読み込む。
fn load_yaml(yaml: &str) -> LoadedPlugin {
    let m = manifest(&["rules.yaml"]);
    load_files(
        ID,
        &[
            (&format!("{DIR}/modelith-plugin.json"), &m),
            (&format!("{DIR}/rules.yaml"), yaml),
        ],
    )
}

/// ルール 1 つだけの YAML（`match` と `require` の中身を差し込む。字下げは 6）。
fn one_rule(target: &str, require: &str) -> String {
    format!(
        "rules:\n  - id: r1\n    severity: warning\n    message: \"{{kind}}「{{name}}」\"\n    match:\n      {target}\n    require:\n      {require}\n"
    )
}
