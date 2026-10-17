//! プロジェクトの設定ファイル（`modelith.json`）の単体テスト（F-PROJ-1、ADR-0019 §2）。
//! 画面からの振る舞いは e2e テスト（web/e2e/project.spec.ts）で確かめる。

use super::*;
use serde_json::json;

/// 読み取れた設定（読み取れなければ失敗にする）。
fn project_of(text: &str) -> ProjectFile {
    let parsed = parse(text);
    parsed
        .project
        .unwrap_or_else(|| panic!("読み取れない: {:?}", parsed.problems))
}

/// 問題を「重さ 行:列 文」の 1 行ずつにする。
fn problems_of(text: &str) -> Vec<String> {
    parse(text)
        .problems
        .iter()
        .map(|p| format!("{:?} {}:{} {}", p.severity, p.line, p.column, p.message))
        .collect()
}

// --- parse: 正常系 ---

#[test]
fn parse_empty_object_has_no_name_and_no_plugins() {
    // Arrange（境界値: 項目が 1 つも無い）
    let text = "{}";
    // Act
    let parsed = parse(text);
    // Assert
    assert_eq!(parsed.project, Some(ProjectFile::default()));
    assert_eq!(parsed.problems, vec![]);
}

#[test]
fn parse_reads_the_name() {
    // Arrange
    let text = r#"{ "name": "給水システム" }"#;
    // Act
    let project = project_of(text);
    // Assert
    assert_eq!(project.name.as_deref(), Some("給水システム"));
    assert!(project.plugins.is_empty());
}

#[test]
fn parse_treats_null_name_as_missing() {
    // Arrange（境界値: null）
    let text = r#"{ "name": null }"#;
    // Act
    let parsed = parse(text);
    // Assert
    assert_eq!(parsed.project, Some(ProjectFile::default()));
    assert_eq!(parsed.problems, vec![]);
}

#[test]
fn parse_fills_plugin_defaults() {
    // Arrange（同値クラス: 中身の無いプラグインと、すべて書いたプラグイン）
    let text = r#"{
  "plugins": {
    "jp.a": {},
    "jp.b": { "version": "0.2.0", "enabled": false, "settings": { "rating": "rpn" } }
  }
}"#;
    // Act
    let project = project_of(text);
    // Assert
    let a = &project.plugins["jp.a"];
    assert_eq!(
        (a.version.as_deref(), a.enabled, &a.settings),
        (None, true, &Value::Null)
    );
    let b = &project.plugins["jp.b"];
    assert_eq!(
        (b.version.as_deref(), b.enabled, &b.settings),
        (Some("0.2.0"), false, &json!({ "rating": "rpn" }))
    );
}

#[test]
fn parse_keeps_unknown_keys_and_warns_with_their_positions() {
    // Arrange（知らない項目: 一番外側と、プラグインの設定の中）
    let text = r#"{
  "name": "A",
  "rules": ["x"],
  "plugins": { "jp.a": { "color": 1 } }
}"#;
    // Act
    let parsed = parse(text);
    // Assert
    let project = parsed.project.clone().unwrap_or_default();
    assert_eq!(project.extra.get("rules"), Some(&json!(["x"])));
    assert_eq!(project.plugins["jp.a"].extra.get("color"), Some(&json!(1)));
    assert_eq!(
        problems_of(text),
        vec![
            "Warning 3:3 知らない項目「rules」があります。消さずに残します",
            "Warning 4:26 プラグイン「jp.a」の設定に、知らない項目「color」があります。消さずに残します",
        ]
    );
}

#[test]
fn parse_then_to_text_round_trips_unknown_keys() {
    // Arrange
    let text =
        r#"{"zeta":{"deep":[1,2]},"name":"A","plugins":{"jp.a":{"enabled":false,"x":true}}}"#;
    // Act
    let written = to_text(&project_of(text));
    // Assert（書き戻しても、知らない項目は消えない）
    assert_eq!(project_of(&written), project_of(text));
    assert_eq!(
        written,
        "{\n  \"name\": \"A\",\n  \"plugins\": {\n    \"jp.a\": {\n      \"enabled\": false,\n      \"x\": true\n    }\n  },\n  \"zeta\": {\n    \"deep\": [\n      1,\n      2\n    ]\n  }\n}\n"
    );
}

// --- parse: 異常系 ---

#[test]
fn parse_rejects_empty_text() {
    // Arrange（境界値: 空文字列と空白だけ）
    let inputs = ["", " \n\t"];
    // Act
    let results: Vec<Vec<String>> = inputs.iter().map(|t| problems_of(t)).collect();
    // Assert
    for r in results {
        assert_eq!(
            r,
            vec!["Error 1:1 中身が空です。少なくとも { } と書いてください"]
        );
    }
    assert_eq!(parse("").project, None);
}

#[test]
fn parse_reports_invalid_json_at_its_line_and_column() {
    // Arrange（行の途中の誤り。前に多バイト文字がある）
    let text = "{\n  \"name\": \"給水\" \"x\"\n}";
    // Act
    let parsed = parse(text);
    // Assert（列は UTF-16 の単位で数える：「給水」は 2 単位）
    assert_eq!(parsed.project, None);
    assert_eq!(
        problems_of(text),
        vec!["Error 2:16 書き方に誤りがあるため読み取れません（JSON：expected `,` or `}`）"]
    );
}

#[test]
fn parse_reports_unclosed_object() {
    // Arrange（境界値: 開いただけ）
    let text = "{";
    // Act
    let problems = problems_of(text);
    // Assert
    assert_eq!(
        problems,
        vec!["Error 1:1 書き方に誤りがあるため読み取れません（JSON：EOF while parsing an object）"]
    );
}

#[test]
fn parse_rejects_a_top_level_that_is_not_an_object() {
    // Arrange
    let text = r#"["name"]"#;
    // Act
    let parsed = parse(text);
    // Assert
    assert_eq!(parsed.project, None);
    assert_eq!(
        problems_of(text),
        vec!["Error 1:1 一番外側を { } で囲んでください（JSON のオブジェクト）"]
    );
}

#[test]
fn parse_reports_wrong_types_at_the_keys() {
    // Arrange（同値クラス: 名前が数・プラグインの一覧が配列）
    let text = "{\n  \"name\": 3,\n  \"plugins\": []\n}";
    // Act
    let parsed = parse(text);
    // Assert
    assert_eq!(parsed.project, None);
    assert_eq!(
        problems_of(text),
        vec![
            "Error 2:3 プロジェクト名（name）は、文字を \" \" で囲んで書いてください",
            "Error 3:3 使うプラグインの一覧（plugins）は { } で囲んで書いてください",
        ]
    );
}

#[test]
fn parse_reports_wrong_types_inside_a_plugin() {
    // Arrange（同値クラス: プラグインが { } でない・版が数・有効が文字）
    let text = r#"{"plugins": {"a": 1, "b": {"version": 2, "enabled": "yes"}}}"#;
    // Act
    let problems = problems_of(text);
    // Assert
    assert_eq!(
        problems,
        vec![
            "Error 1:14 プラグイン「a」の設定は { } で囲んで書いてください",
            "Error 1:28 プラグイン「b」の版（version）は、文字を \" \" で囲んで書いてください（例：\"0.2.0\"）",
            "Error 1:42 プラグイン「b」を使うかどうか（enabled）は true か false で書いてください",
        ]
    );
}

// --- create ---

#[test]
fn create_writes_pretty_json_with_the_name() {
    // Arrange
    let name = "給水システム";
    // Act
    let text = create(name);
    // Assert
    assert_eq!(
        text,
        "{\n  \"name\": \"給水システム\",\n  \"plugins\": {}\n}\n"
    );
    assert_eq!(project_of(&text).name.as_deref(), Some(name));
}

#[test]
fn create_trims_the_name_and_omits_an_empty_one() {
    // Arrange（境界値: 前後の空白・空白だけ）
    let names = [" A ", "  "];
    // Act
    let texts: Vec<String> = names.iter().map(|n| create(n)).collect();
    // Assert
    assert_eq!(
        texts,
        vec![
            "{\n  \"name\": \"A\",\n  \"plugins\": {}\n}\n",
            "{\n  \"plugins\": {}\n}\n"
        ]
    );
}

// --- key_offsets ---

#[test]
fn key_offsets_follow_nesting_arrays_and_escapes() {
    // Arrange（値の文字列に括弧、配列の中のオブジェクト、エスケープしたキー）
    let text = r#"{"a": "{[", "b": [{"c": 1}], "d": 2}"#;
    // Act
    let keys = key_offsets(text);
    // Assert
    let path = |p: &[&str]| p.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    assert_eq!(keys.get(&path(&["a"])), Some(&1));
    assert_eq!(keys.get(&path(&["b", "[]", "c"])), Some(&19));
    assert_eq!(keys.get(&path(&["d"])), Some(&29));
    assert_eq!(keys.len(), 4);
}

#[test]
fn key_offsets_of_empty_text_is_empty() {
    // Arrange（境界値）
    let text = "";
    // Act
    let keys = key_offsets(text);
    // Assert
    assert!(keys.is_empty());
}

// --- update_plugin（画面からプラグインを加える・使う／止める・外す。F-PLUG-8・F-PLUG-9） ---

/// 変更を当てて、読み取り直した設定を返す（書き換えに失敗すれば失敗にする）。
fn updated(text: &str, id: &str, change: PluginChange) -> ProjectFile {
    let out = update_plugin(text, id, &change).unwrap_or_else(|e| panic!("書き換えられない: {e}"));
    project_of(&out)
}

#[test]
fn update_plugin_adds_an_enabled_entry_with_the_version() {
    // Arrange（境界値: plugins の無い設定）
    let text = r#"{ "name": "給水" }"#;
    // Act
    let out = update_plugin(
        text,
        "jp.x",
        &PluginChange::Add {
            version: "0.1.0".to_owned(),
        },
    );
    // Assert
    assert_eq!(
        out.as_deref(),
        Ok(
            "{\n  \"name\": \"給水\",\n  \"plugins\": {\n    \"jp.x\": {\n      \"version\": \"0.1.0\",\n      \"enabled\": true\n    }\n  }\n}\n"
        )
    );
}

#[test]
fn update_plugin_add_keeps_settings_and_unknown_keys_of_an_existing_entry() {
    // Arrange（止めてあり、版の違う既存の項目。知らない項目は外側にもある）
    let text = r#"{ "plugins": { "jp.x": { "version": "0.0.9", "enabled": false, "settings": { "a": 1 }, "note": "keep" } }, "color": "red" }"#;
    // Act
    let project = updated(
        text,
        "jp.x",
        PluginChange::Add {
            version: "0.1.0".to_owned(),
        },
    );
    // Assert
    let plugin = &project.plugins["jp.x"];
    assert_eq!(plugin.version.as_deref(), Some("0.1.0"));
    assert!(plugin.enabled);
    assert_eq!(plugin.settings, json!({ "a": 1 }));
    assert_eq!(plugin.extra.get("note"), Some(&json!("keep")));
    assert_eq!(project.extra.get("color"), Some(&json!("red")));
}

#[test]
fn update_plugin_sets_enabled_off_and_on() {
    // Arrange
    let text = r#"{ "plugins": { "jp.x": { "version": "0.1.0" } } }"#;
    // Act
    let off = updated(text, "jp.x", PluginChange::SetEnabled { enabled: false });
    let on = updated(text, "jp.x", PluginChange::SetEnabled { enabled: true });
    // Assert
    assert_eq!(
        (off.plugins["jp.x"].enabled, on.plugins["jp.x"].enabled),
        (false, true)
    );
}

#[test]
fn update_plugin_removes_only_that_entry() {
    // Arrange
    let text = r#"{ "plugins": { "jp.x": {}, "jp.y": {} } }"#;
    // Act
    let project = updated(text, "jp.x", PluginChange::Remove);
    // Assert
    assert_eq!(
        project.plugins.keys().collect::<Vec<_>>(),
        vec![&"jp.y".to_owned()]
    );
}

#[test]
fn update_plugin_refuses_to_change_an_entry_that_is_not_there() {
    // Arrange（異常系: 無い項目を止める・外す）
    let text = "{}";
    // Act
    let off = update_plugin(text, "jp.x", &PluginChange::SetEnabled { enabled: false });
    let removed = update_plugin(text, "jp.x", &PluginChange::Remove);
    // Assert
    let expected =
        Err("プロジェクトの設定（modelith.json）に、プラグイン「jp.x」がありません".to_owned());
    assert_eq!((off, removed), (expected.clone(), expected));
}

#[test]
fn update_plugin_refuses_a_broken_file_with_its_line() {
    // Arrange（異常系: 読み取れない設定ファイルは書き換えない）
    let text = "{\n  \"name\": 3\n}";
    // Act
    let out = update_plugin(text, "jp.x", &PluginChange::Remove);
    // Assert
    assert_eq!(
        out,
        Err("プロジェクトの設定（modelith.json）に誤りがあるため、書き換えられません。2 行目：プロジェクト名（name）は、文字を \" \" で囲んで書いてください".to_owned())
    );
}

#[test]
fn update_plugin_refuses_to_add_a_malformed_id() {
    // Arrange（異常系: フォルダの名前にできない ID）
    let text = "{}";
    // Act
    let out = update_plugin(
        text,
        "../x",
        &PluginChange::Add {
            version: "0.1.0".to_owned(),
        },
    );
    // Assert
    assert_eq!(
        out,
        Err("プラグインの ID「../x」の形が正しくありません".to_owned())
    );
}

#[test]
fn plugin_change_reads_the_op_tag() {
    // Arrange（画面から JSON で届く形）
    let texts = [
        r#"{"op":"add","version":"1.0.0"}"#,
        r#"{"op":"setEnabled","enabled":false}"#,
        r#"{"op":"remove"}"#,
    ];
    // Act
    let changes: Vec<PluginChange> = texts
        .iter()
        .map(|t| serde_json::from_str(t).unwrap())
        .collect();
    // Assert
    assert_eq!(
        changes,
        [
            PluginChange::Add {
                version: "1.0.0".to_owned()
            },
            PluginChange::SetEnabled { enabled: false },
            PluginChange::Remove
        ]
    );
}
