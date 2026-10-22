//! `modelith check <フォルダ>` の結合テスト（F-PLUG-2：プロジェクトに入れたチェックルールを CLI で実行し、誤りがあれば 0 以外で終わる）。
//! ビルドした `modelith` を、一時的なフォルダに作ったプロジェクトに対して動かし、終了コードと出力を確かめる。

// テストの準備（一時的なフォルダ・プロセスの起動）に失敗したら、その場で落とす
#![allow(clippy::unwrap_used)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

/// テストごとの一時的なフォルダ。落とすときに消す。
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("modelith-cli-check-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    /// フォルダの中にファイルを書く（途中のフォルダも作る）。
    fn write(&self, rel: &str, text: &str) {
        let path = self.0.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// フォルダの中に、`target`（フォルダからの相対パス）を指すシンボリックリンクを作る。
    /// 作れない環境（権限の無い Windows など）なら false を返す（そのテストは飛ばす）。
    fn symlink(&self, target: &str, rel: &str) -> bool {
        let link = self.0.join(rel);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink_file(&self.0.join(target), &link).is_ok()
    }
}

#[cfg(unix)]
fn symlink_file(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink_file(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

#[cfg(not(any(unix, windows)))]
fn symlink_file(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const PLUGIN: &str = "jp.example.trace";

const MODELITH_JSON: &str = r#"{
  "name": "給水システム",
  "plugins": { "jp.example.trace": { "version": "0.1.0", "enabled": true } }
}
"#;

const MANIFEST: &str = r#"{
  "id": "jp.example.trace",
  "name": "トレーサビリティのチェック",
  "version": "0.1.0",
  "apiVersion": "0",
  "runtime": "rules",
  "license": "MIT",
  "contributes": { "rules": ["rules.yaml"] }
}
"#;

const RULES: &str = "rules:
  - id: req-has-satisfier
    severity: error
    message: \"要求「{name}」を満たす要素がありません\"
    match:
      kind: requirement def
    require:
      incoming: satisfy
  - id: part-has-ports
    severity: warning
    message: \"{kind}「{name}」にポートがありません\"
    match:
      kind: part def
    require:
      ports: { min: 1 }
";

const MODEL: &str = "package WaterSupply {
  requirement def SupplyWater;
  requirement def KeepPressure;
  part def Pump { port inlet; }
  part def Tank;
  satisfy SupplyWater by Pump;
}
";

/// プロジェクトの設定・プラグイン・ルールだけを置いたフォルダを作る（モデルは置かない）。
fn project() -> TempDir {
    let dir = TempDir::new();
    dir.write("modelith.json", MODELITH_JSON);
    dir.write(
        &format!(".modelith/plugins/{PLUGIN}/modelith-plugin.json"),
        MANIFEST,
    );
    dir.write(&format!(".modelith/plugins/{PLUGIN}/rules.yaml"), RULES);
    dir
}

/// ビルドした `modelith` を、引数を付けて動かす。
fn modelith(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_modelith"))
        .args(args)
        .output()
        .unwrap()
}

/// フォルダを検査する。
fn check(dir: &TempDir) -> Output {
    modelith(&["check", dir.path().to_str().unwrap()])
}

fn stdout(o: &Output) -> String {
    String::from_utf8(o.stdout.clone()).unwrap()
}

fn stderr(o: &Output) -> String {
    String::from_utf8(o.stderr.clone()).unwrap()
}

// ---- 正常系 ----------------------------------------------------------------

#[test]
fn error_findings_are_printed_and_exit_with_1() {
    // Arrange
    let dir = project();
    dir.write("model.sysml", MODEL);
    // Act
    let out = check(&dir);
    // Assert
    assert_eq!(
        stdout(&out),
        "model.sysml:3:3: エラー: 要求「KeepPressure」を満たす要素がありません [jp.example.trace/req-has-satisfier]\n\
         model.sysml:5:3: 警告: part def「Tank」にポートがありません [jp.example.trace/part-has-ports]\n\
         ファイル 1 件をチェックしました：エラー 1 件・警告 1 件・情報 0 件・ヒント 0 件\n"
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn chosen_levels_change_or_hide_rule_findings() {
    // Arrange（要求の抜けを警告に下げ、ポートの抜けは出さない。F-EDIT-11）
    let dir = project();
    dir.write(
        "modelith.json",
        &MODELITH_JSON.replace(
            "\n}\n",
            ",\n  \"levels\": { \"jp.example.trace/req-has-satisfier\": \"warning\", \"jp.example.trace/part-has-ports\": \"off\" }\n}\n",
        ),
    );
    dir.write("model.sysml", MODEL);
    // Act
    let out = check(&dir);
    // Assert（エラーが無くなるので 0 で終わる）
    assert_eq!(
        stdout(&out),
        "model.sysml:3:3: 警告: 要求「KeepPressure」を満たす要素がありません [jp.example.trace/req-has-satisfier]\n\
         ファイル 1 件をチェックしました：エラー 0 件・警告 1 件・情報 0 件・ヒント 0 件\n"
    );
    assert_eq!(out.status.code(), Some(0));
}

#[test]
fn warnings_only_exit_with_0() {
    // Arrange（要求はすべて満たされ、ポートの無い部品だけが残る）
    let dir = project();
    dir.write(
        "model.sysml",
        &MODEL.replace("  requirement def KeepPressure;\n", ""),
    );
    // Act
    let out = check(&dir);
    // Assert
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    assert!(stdout(&out).ends_with("エラー 0 件・警告 1 件・情報 0 件・ヒント 0 件\n"));
}

#[test]
fn findings_are_sorted_by_path_line_and_column_across_files() {
    // Arrange（下のフォルダと .kerml も読む）
    let dir = project();
    dir.write("b.sysml", "package B {\n  part def Bare;\n}\n");
    dir.write("a/z.kerml", "package Z {\n\n  part def Zed;\n}\n");
    dir.write("a/y.sysml", "package Y { part def Yet; }\n");
    // Act
    let out = check(&dir);
    // Assert
    let places: Vec<String> = stdout(&out)
        .lines()
        .map(|l| l.split(": ").next().unwrap_or("").to_owned())
        .collect();
    assert_eq!(
        places,
        [
            "a/y.sysml:1:13",
            "a/z.kerml:3:3",
            "b.sysml:2:3",
            "ファイル 3 件をチェックしました：エラー 0 件・警告 3 件・情報 0 件・ヒント 0 件"
        ]
    );
    assert_eq!(out.status.code(), Some(0));
}

#[test]
fn files_of_the_folder_are_checked_as_one_model() {
    // Arrange（要求を満たす関係を、ほかのファイルに書く。ADR-0021）
    let dir = project();
    dir.write(
        "reqs.sysml",
        "package Reqs {\n  requirement def SupplyWater;\n  requirement def KeepPressure;\n}\n",
    );
    dir.write(
        "parts.sysml",
        "package Parts {\n  import Reqs::*;\n  part def Pump { port inlet; }\n  satisfy SupplyWater by Pump;\n}\n",
    );
    // Act
    let out = check(&dir);
    // Assert（満たされていない KeepPressure だけを、書いたファイルで知らせる）
    assert_eq!(
        stdout(&out),
        "reqs.sysml:3:3: エラー: 要求「KeepPressure」を満たす要素がありません [jp.example.trace/req-has-satisfier]\n\
         ファイル 2 件をチェックしました：エラー 1 件・警告 0 件・情報 0 件・ヒント 0 件\n"
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn hidden_build_and_dependency_folders_are_not_checked() {
    // Arrange（どれも、検査すれば注意が出る部品定義）
    let dir = project();
    for folder in [".hidden", "target", "node_modules", ".modelith"] {
        dir.write(&format!("{folder}/m.sysml"), "package Q { part def Q1; }\n");
    }
    // Act
    let out = check(&dir);
    // Assert
    assert_eq!(
        stdout(&out),
        "ファイル 0 件をチェックしました：エラー 0 件・警告 0 件・情報 0 件・ヒント 0 件\n"
    );
    assert_eq!(out.status.code(), Some(0));
}

#[test]
fn disabled_plugins_are_not_loaded() {
    // Arrange（無効にしたプラグインは、入っていなくても誤りにしない）
    let dir = TempDir::new();
    dir.write(
        "modelith.json",
        r#"{ "plugins": { "jp.example.gone": { "enabled": false } } }"#,
    );
    dir.write("model.sysml", MODEL);
    // Act
    let out = check(&dir);
    // Assert
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    assert!(stdout(&out).starts_with("ファイル 1 件をチェックしました：エラー 0 件"));
}

#[test]
fn version_is_still_printed() {
    // Arrange
    let args = ["--version"];
    // Act
    let out = modelith(&args);
    // Assert
    assert_eq!(out.status.code(), Some(0));
    assert!(stdout(&out).starts_with("modelith "), "{}", stdout(&out));
}

// ---- 異常系 ----------------------------------------------------------------

#[test]
fn broken_rule_file_is_reported_with_its_place_and_exits_with_1() {
    // Arrange（incoming の書き損じ）
    let dir = project();
    dir.write(
        &format!(".modelith/plugins/{PLUGIN}/rules.yaml"),
        &RULES.replace("incoming:", "incomin:"),
    );
    dir.write("model.sysml", "package P { part def A { port p; } }\n");
    // Act
    let out = check(&dir);
    // Assert
    let text = stdout(&out);
    assert!(
        text.starts_with(&format!(
            ".modelith/plugins/{PLUGIN}/rules.yaml:8:7: エラー: 不明な項目「incomin」があります（rules[0].require: unknown field `incomin`"
        )),
        "{text}"
    );
    assert!(
        text.trim_end().ends_with(&format!(
            "[{PLUGIN}]\nファイル 1 件をチェックしました：エラー 1 件・警告 0 件・情報 0 件・ヒント 0 件"
        )),
        "{text}"
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn missing_plugin_is_named_and_exits_with_1() {
    // Arrange（modelith.json に書いてあるが、フォルダに無い）
    let dir = TempDir::new();
    dir.write("modelith.json", MODELITH_JSON);
    // Act
    let out = check(&dir);
    // Assert
    assert_eq!(
        stdout(&out),
        format!(
            ".modelith/plugins/{PLUGIN}/modelith-plugin.json: エラー: このプロジェクトで使うプラグイン「{PLUGIN}」が追加されていません。プラグインを .modelith/plugins/{PLUGIN}/ に追加してください（modelith-plugin.json が見つかりません） [{PLUGIN}]\n\
             ファイル 0 件をチェックしました：エラー 1 件・警告 0 件・情報 0 件・ヒント 0 件\n"
        )
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn rule_path_outside_the_plugin_is_rejected() {
    // Arrange（プラグインのフォルダの外を指す）
    let dir = project();
    dir.write(
        &format!(".modelith/plugins/{PLUGIN}/modelith-plugin.json"),
        &MANIFEST.replace("\"rules.yaml\"", "\"../../../modelith.json\""),
    );
    // Act
    let out = check(&dir);
    // Assert
    assert!(
        stdout(&out)
            .contains("ルールのファイル「../../../modelith.json」は、プラグインのフォルダの中を"),
        "{}",
        stdout(&out)
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn symlinked_rule_file_is_not_followed_and_exits_with_1() {
    // Arrange（rules.yaml がプロジェクトの外のファイルを指すシンボリックリンク。本物は real.yaml に置く）
    let dir = project();
    dir.write("real.yaml", RULES);
    let rules = format!(".modelith/plugins/{PLUGIN}/rules.yaml");
    fs::remove_file(dir.path().join(&rules)).unwrap();
    if !dir.symlink("real.yaml", &rules) {
        eprintln!("シンボリックリンクを作れない環境なので飛ばす");
        return;
    }
    dir.write("model.sysml", "package P { part def A { port p; } }\n");
    // Act
    let out = check(&dir);
    // Assert（リンクはたどらず、読めないファイルとして知らせる。ルールは当てない）
    assert_eq!(
        stdout(&out),
        format!(
            "{rules}: エラー: ルールのファイルを読み込めません（シンボリックリンクは読みません） [{PLUGIN}]\n\
             ファイル 1 件をチェックしました：エラー 1 件・警告 0 件・情報 0 件・ヒント 0 件\n"
        )
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn symlinked_project_file_is_not_followed() {
    // Arrange（modelith.json がシンボリックリンク）
    let dir = TempDir::new();
    dir.write("real.json", MODELITH_JSON);
    if !dir.symlink("real.json", "modelith.json") {
        eprintln!("シンボリックリンクを作れない環境なので飛ばす");
        return;
    }
    // Act
    let out = check(&dir);
    // Assert
    assert_eq!(
        stderr(&out),
        "modelith: modelith.json を読み込めません（シンボリックリンクは読みません）\n"
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn broken_project_file_is_reported_and_nothing_is_checked() {
    // Arrange（JSON の誤り）
    let dir = TempDir::new();
    dir.write("modelith.json", "{");
    dir.write("model.sysml", MODEL);
    // Act
    let out = check(&dir);
    // Assert
    let text = stdout(&out);
    assert!(
        text.starts_with("modelith.json:1:1: エラー: 書式にエラーがあるため読み込めません"),
        "{text}"
    );
    assert!(
        text.ends_with(
            "ファイル 0 件をチェックしました：エラー 1 件・警告 0 件・情報 0 件・ヒント 0 件\n"
        ),
        "{text}"
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn unknown_project_keys_are_warnings_only() {
    // Arrange（不明な項目は注意。結果は変わらない）
    let dir = TempDir::new();
    dir.write("modelith.json", "{ \"color\": \"red\" }");
    // Act
    let out = check(&dir);
    // Assert
    assert!(
        stdout(&out).starts_with("modelith.json:1:3: 警告: 不明な項目「color」があります"),
        "{}",
        stdout(&out)
    );
    assert_eq!(out.status.code(), Some(0));
}

#[test]
fn folder_without_project_file_is_an_error() {
    // Arrange
    let dir = TempDir::new();
    // Act
    let out = check(&dir);
    // Assert
    assert!(
        stderr(&out)
            .contains("に modelith.json がありません。プロジェクトのフォルダを指定してください"),
        "{}",
        stderr(&out)
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn missing_folder_is_an_error() {
    // Arrange
    let dir = TempDir::new();
    let missing = dir.path().join("none");
    // Act
    let out = modelith(&["check", missing.to_str().unwrap()]);
    // Assert
    assert!(
        stderr(&out).starts_with("modelith: フォルダ「"),
        "{}",
        stderr(&out)
    );
    assert_eq!(out.status.code(), Some(1));
}

#[test]
fn wrong_usage_prints_the_usage_and_exits_with_2() {
    // Arrange（引数なし・フォルダなし・多すぎる・知らないコマンド）
    let cases: [&[&str]; 4] = [&[], &["check"], &["check", "a", "b"], &["lint", "a"]];
    // Act
    let outs: Vec<Output> = cases.iter().map(|a| modelith(a)).collect();
    // Assert
    for out in &outs {
        assert_eq!(out.status.code(), Some(2));
        assert_eq!(
            stderr(out),
            "使い方: modelith check <フォルダ> | modelith --version\n"
        );
    }
}
