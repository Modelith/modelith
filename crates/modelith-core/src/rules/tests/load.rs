//! プラグインの読み込みの単体テスト（F-PLUG-3：読めないマニフェストやルールを黙って無視せず、どのファイルの何が悪いかを示す）。

use std::collections::BTreeMap;

use super::super::load::{describe_serde_error, inside_plugin, rule_places};
use super::super::{
    ManifestInfo, Place, ReadError, Runtime, describe_manifest, element_kinds, load_plugin,
    load_plugin_files,
};
use super::{DIR, ID, load_files, load_yaml, manifest, one_rule};

/// 読み込みの問題を「パス:行:列 文」の形にする（位置が無ければ「パス 文」）。
fn problems(plugin: &super::LoadedPlugin) -> Vec<String> {
    plugin
        .problems
        .iter()
        .map(|p| match p.place {
            Some(Place { line, column }) => format!("{}:{line}:{column} {}", p.path, p.message),
            None => format!("{} {}", p.path, p.message),
        })
        .collect()
}

/// ルール 1 つの YAML を読み、問題の文だけを返す。
fn rule_problems(target: &str, require: &str) -> Vec<String> {
    load_yaml(&one_rule(target, require))
        .problems
        .into_iter()
        .map(|p| p.message)
        .collect()
}

// ---- 正常系 ----------------------------------------------------------------

#[test]
fn loads_rules_listed_in_the_manifest() {
    // Arrange
    let yaml = "rules:\n  - id: a\n    severity: error\n    message: m\n    match: { kind: part def }\n    require: { incoming: satisfy }\n  - id: b\n    severity: information\n    message: m\n    match: { kind: [requirement def, requirement] }\n    require: {}\n";
    // Act
    let plugin = load_yaml(yaml);
    // Assert
    let ids: Vec<&str> = plugin.rules.iter().map(|r| r.id.as_str()).collect();
    assert_eq!((ids, problems(&plugin)), (vec!["a", "b"], vec![]));
}

#[test]
fn loads_every_rule_file_in_order() {
    // Arrange（ファイル 2 つ。./ で始まるパスと、下のフォルダのパス）
    let m = manifest(&["./a.yaml", "more/b.yaml"]);
    let a = one_rule("kind: part def", "{}");
    let b = one_rule("kind: part def", "{}").replace("r1", "r2");
    // Act
    let plugin = load_files(
        ID,
        &[
            (&format!("{DIR}/modelith-plugin.json"), &m),
            (&format!("{DIR}/a.yaml"), &a),
            (&format!("{DIR}/more/b.yaml"), &b),
        ],
    );
    // Assert
    let ids: Vec<&str> = plugin.rules.iter().map(|r| r.id.as_str()).collect();
    assert_eq!((ids, problems(&plugin)), (vec!["r1", "r2"], vec![]));
}

#[test]
fn empty_rule_list_loads_no_rules_without_problems() {
    // Arrange（境界値：ルール 0 件）
    let yaml = "rules: []\n";
    // Act
    let plugin = load_yaml(yaml);
    // Assert
    assert_eq!((plugin.rules.len(), problems(&plugin)), (0, vec![]));
}

#[test]
fn manifest_without_rule_files_loads_no_rules() {
    // Arrange（境界値：contributes.rules が空）
    let m = manifest(&[]);
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), &m)]);
    // Assert
    assert_eq!((plugin.rules.len(), problems(&plugin)), (0, vec![]));
}

#[test]
fn every_documented_condition_loads() {
    // Arrange（require の語彙をすべて使う。ports の min = max は境界値）
    let yaml = one_rule(
        "kind: part def\n      phase: detail\n      name: \"^[A-Z]\"",
        "incoming: [satisfy, verify]\n      outgoing: derivation\n      name: \"\\\\w$\"\n      phase: true\n      ports: { min: 2, max: 2 }\n      not: { outgoing: [frame, flow] }",
    );
    // Act
    let plugin = load_yaml(&yaml);
    // Assert
    assert_eq!((plugin.rules.len(), problems(&plugin)), (1, vec![]));
}

#[test]
fn element_kinds_are_the_kinds_drawn_as_elements() {
    // Arrange（docs/reference/check-rules.md とモジュールの説明に書いた一覧）
    let documented = [
        "occurrence def",
        "part def",
        "requirement def",
        "constraint def",
        "port def",
        "item def",
        "attribute def",
        "concern def",
        "verification def",
        "analysis def",
        "state def",
        "action def",
        "interface def",
        "calc def",
        "connection def",
        "use case def",
        "enum def",
        "part",
        "requirement",
    ];
    // Act
    let kinds = element_kinds();
    // Assert
    assert_eq!(kinds, documented);
}

// ---- 異常系：マニフェスト ------------------------------------------------------

#[test]
fn malformed_plugin_id_is_reported_without_reading() {
    // Arrange（フォルダの外を指す ID）
    let mut reads = 0;
    // Act
    let plugin = load_plugin("../evil", |_| {
        reads += 1;
        Err(ReadError::NotFound)
    });
    // Assert
    assert_eq!(reads, 0);
    assert_eq!(
        problems(&plugin),
        [
            "modelith.json プラグインの ID「../evil」の形が正しくありません。英小文字・数字・「-」を「.」で区切って書いてください（例：jp.example.rules）"
        ]
    );
}

#[test]
fn missing_plugin_tells_which_plugin_to_add() {
    // Arrange（F-PLUG-9：入っていないプラグイン）
    let files: [(&str, &str); 0] = [];
    // Act
    let plugin = load_files(ID, &files);
    // Assert
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/modelith-plugin.json このプロジェクトで使うプラグイン「{ID}」が追加されていません。プラグインを {DIR}/ に追加してください（modelith-plugin.json が見つかりません）"
        )]
    );
}

#[test]
fn unreadable_manifest_is_reported_with_the_reason() {
    // Arrange
    let read = |_: &str| Err(ReadError::Other("UTF-8 ではありません".to_owned()));
    // Act
    let plugin = load_plugin(ID, read);
    // Assert
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/modelith-plugin.json プラグイン「{ID}」のマニフェストを読み込めません（UTF-8 ではありません）"
        )]
    );
}

#[test]
fn manifest_json_syntax_error_has_line_and_column() {
    // Arrange（3 行目の閉じかっこの前に余計な「,」）
    let text = "{\n  \"id\": \"jp.example.rules\",\n}";
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), text)]);
    // Assert
    let all = problems(&plugin);
    assert_eq!(all.len(), 1, "{all:?}");
    assert!(
        all[0].starts_with(&format!(
            "{DIR}/modelith-plugin.json:3:1 書式にエラーがあるため読み込めません（JSON："
        )),
        "{all:?}"
    );
}

#[test]
fn unknown_key_in_manifest_is_named() {
    // Arrange（deny_unknown_fields）
    let text = manifest(&[]).replace("\"license\"", "\"licence\": \"MIT\",\n  \"license\"");
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), &text)]);
    // Assert
    let all = problems(&plugin);
    assert_eq!(all.len(), 1, "{all:?}");
    assert!(
        all[0].contains("不明な項目「licence」があります（unknown field `licence`"),
        "{all:?}"
    );
}

#[test]
fn unsupported_api_version_is_reported_at_the_key_and_rules_are_not_read() {
    // Arrange
    let text = manifest(&["rules.yaml"]).replace("\"apiVersion\": \"0\"", "\"apiVersion\": \"1\"");
    let mut read_rules = false;
    // Act
    let plugin = load_plugin(ID, |path| {
        if path.ends_with("modelith-plugin.json") {
            Ok(text.clone())
        } else {
            read_rules = true;
            Ok(String::new())
        }
    });
    // Assert
    assert!(!read_rules);
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/modelith-plugin.json:5:3 対応していないバージョン（apiVersion「1」）のプラグインです。この Modelith が対応しているのは「0」です"
        )]
    );
}

#[test]
fn runtime_other_than_rules_is_reported() {
    // Arrange（v1 の TypeScript のプラグイン）
    let text = manifest(&[]).replace("\"runtime\": \"rules\"", "\"runtime\": \"browser\"");
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), &text)]);
    // Assert
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/modelith-plugin.json:6:3 チェックルールのプラグイン（runtime: rules）ではないため、ここでは使用できません"
        )]
    );
}

#[test]
fn manifest_id_must_match_the_project_entry() {
    // Arrange
    let text = manifest(&[]).replace(ID, "jp.example.other");
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), &text)]);
    // Assert
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/modelith-plugin.json:2:3 マニフェストの ID「jp.example.other」が、プロジェクトに書かれた ID「{ID}」と違います"
        )]
    );
}

#[test]
fn rule_paths_outside_the_plugin_folder_are_rejected_but_others_load() {
    // Arrange
    let m = manifest(&["../secret.yaml", "rules.yaml"]);
    let yaml = one_rule("kind: part def", "{}");
    // Act
    let plugin = load_files(
        ID,
        &[
            (&format!("{DIR}/modelith-plugin.json"), &m),
            (&format!("{DIR}/rules.yaml"), &yaml),
        ],
    );
    // Assert
    assert_eq!(plugin.rules.len(), 1);
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/modelith-plugin.json:8:30 ルールのファイル「../secret.yaml」は、プラグインのフォルダの中を、そこからの相対パスで指してください"
        )]
    );
}

#[test]
fn missing_rule_file_is_reported() {
    // Arrange
    let m = manifest(&["rules.yaml"]);
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), &m)]);
    // Assert
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/rules.yaml マニフェストに書かれたルールのファイルが見つかりません（contributes.rules）"
        )]
    );
}

#[test]
fn inside_plugin_accepts_relative_paths_in_the_folder() {
    // Arrange（同値クラス：そのまま・./ つき・\ 区切り・空の区切り）
    let paths = ["rules.yaml", "./a/b.yaml", "a\\b.yaml", "a//b.yaml"];
    // Act
    let got: Vec<Option<String>> = paths.iter().map(|p| inside_plugin(p)).collect();
    // Assert
    assert_eq!(
        got,
        [
            Some("rules.yaml".to_owned()),
            Some("a/b.yaml".to_owned()),
            Some("a/b.yaml".to_owned()),
            Some("a/b.yaml".to_owned()),
        ]
    );
}

#[test]
fn inside_plugin_rejects_paths_that_leave_the_folder() {
    // Arrange（異常系：..・途中の ..・絶対パス・ドライブ名・空・. だけ）
    let paths = [
        "../a.yaml",
        "a/../../b.yaml",
        "/etc/a.yaml",
        "\\a.yaml",
        "C:/a.yaml",
        "",
        ".",
    ];
    // Act
    let accepted: Vec<&str> = paths
        .iter()
        .copied()
        .filter(|p| inside_plugin(p).is_some())
        .collect();
    // Assert
    assert!(accepted.is_empty(), "{accepted:?}");
}

// ---- 異常系：ルールのファイル ---------------------------------------------------

#[test]
fn yaml_syntax_error_has_line_and_column() {
    // Arrange（閉じない「[」）
    let yaml = "rules:\n  - id: a\n    match: { kind: [part def\n";
    // Act
    let plugin = load_yaml(yaml);
    // Assert
    let all = problems(&plugin);
    assert_eq!(all.len(), 1, "{all:?}");
    assert!(
        all[0].starts_with(&format!(
            "{DIR}/rules.yaml:4:1 書式にエラーがあるため読み込めません（YAML："
        )),
        "{all:?}"
    );
}

#[test]
fn empty_rule_file_is_reported() {
    // Arrange（境界値：空のファイル）
    let yaml = "";
    // Act
    let plugin = load_yaml(yaml);
    // Assert
    assert_eq!(plugin.problems.len(), 1, "{:?}", problems(&plugin));
}

#[test]
fn unknown_key_in_require_is_named_at_its_line() {
    // Arrange（incoming の書き損じ）
    let yaml = one_rule("kind: part def", "incomin: satisfy");
    // Act
    let plugin = load_yaml(&yaml);
    // Assert
    assert_eq!(
        problems(&plugin),
        [format!(
            "{DIR}/rules.yaml:8:7 不明な項目「incomin」があります（rules[0].require: unknown field `incomin`, expected one of `incoming`, `outgoing`, `name`, `phase`, `ports`, `not`）"
        )]
    );
}

#[test]
fn unknown_key_at_each_level_is_reported() {
    // Arrange（ルールセット・ルール・match・ports・not の各階層）
    let cases = [
        "rules: []\nextra: 1\n".to_owned(),
        one_rule("kind: part def", "{}").replace("    match:", "    extra: 1\n    match:"),
        one_rule("kind: part def\n      extra: 1", "{}"),
        one_rule("kind: part def", "ports: { min: 1, extra: 1 }"),
        one_rule("kind: part def", "not: { extra: 1 }"),
    ];
    // Act
    let messages: Vec<String> = cases
        .iter()
        .flat_map(|c| load_yaml(c).problems)
        .map(|p| p.message)
        .collect();
    // Assert
    assert_eq!(messages.len(), cases.len(), "{messages:?}");
    assert!(
        messages
            .iter()
            .all(|m| m.starts_with("不明な項目「extra」があります")),
        "{messages:?}"
    );
}

#[test]
fn missing_field_and_unknown_severity_are_explained() {
    // Arrange
    let missing =
        "rules:\n  - id: a\n    message: m\n    match: { kind: part def }\n    require: {}\n";
    let fatal = one_rule("kind: part def", "{}").replace("warning", "fatal");
    // Act
    let got: Vec<String> = [missing.to_owned(), fatal]
        .iter()
        .flat_map(|y| load_yaml(y).problems)
        .map(|p| p.message)
        .collect();
    // Assert
    assert!(
        got[0].starts_with("必要な項目「severity」がありません"),
        "{got:?}"
    );
    assert!(got[1].starts_with("指定できない値「fatal」です"), "{got:?}");
}

#[test]
fn malformed_rule_id_is_explained() {
    // Arrange（大文字と「_」）
    let yaml = one_rule("kind: part def", "{}").replace("id: r1", "id: Bad_Id");
    // Act
    let got = rule_problems_of(&yaml);
    // Assert
    assert_eq!(got.len(), 1);
    assert!(
        got[0].starts_with("ルールの ID は、英小文字・数字・「-」で書いてください"),
        "{got:?}"
    );
}

/// YAML 全体を読み、問題の文だけを返す。
fn rule_problems_of(yaml: &str) -> Vec<String> {
    load_yaml(yaml)
        .problems
        .into_iter()
        .map(|p| p.message)
        .collect()
}

#[test]
fn regex_errors_are_reported_for_match_and_nested_require() {
    // Arrange（match.name と require.not.name の両方に閉じない「[」）
    let yaml = one_rule("kind: part def\n      name: \"[a\"", "not: { name: \"(\" }");
    // Act
    let plugin = load_yaml(&yaml);
    // Assert（ルールは使わず、位置はルールの id の行）
    let all = problems(&plugin);
    assert_eq!(plugin.rules.len(), 0);
    assert_eq!(all.len(), 2, "{all:?}");
    assert!(
        all[0].starts_with(&format!(
            "{DIR}/rules.yaml:2:5 ルール「r1」：名前の正規表現にエラーがあります（match.name「[a」："
        )),
        "{all:?}"
    );
    assert!(all[1].contains("（require.not.name「(」："), "{all:?}");
}

#[test]
fn ports_min_greater_than_max_is_reported() {
    // Arrange（境界値：min = max + 1）
    let require = "ports: { min: 3, max: 2 }";
    // Act
    let got = rule_problems("kind: part def", require);
    // Assert
    assert_eq!(
        got,
        ["ルール「r1」：ポートの数の下限（3）が上限（2）より大きいです（require.ports）"]
    );
}

#[test]
fn empty_kind_list_is_reported() {
    // Arrange（境界値：kind が空の並び）
    let target = "kind: []";
    // Act
    let got = rule_problems(target, "{}");
    // Assert
    assert_eq!(
        got,
        ["ルール「r1」：ルールを当てる要素の種類（match.kind）が空です。1 つ以上書いてください"]
    );
}

#[test]
fn unknown_element_kind_is_reported() {
    // Arrange（図に描かない種類：view def・port）
    let target = "kind: [view def, port]";
    // Act
    let got = rule_problems(target, "{}");
    // Assert
    assert_eq!(got.len(), 2, "{got:?}");
    assert!(
        got[0].starts_with("ルール「r1」：不明な要素の種類「view def」です（match.kind）。指定できる種類：occurrence def・part def"),
        "{got:?}"
    );
}

#[test]
fn unknown_and_empty_relation_lists_are_reported() {
    // Arrange（model の線の名前 derive は書けない。書くのは derivation）
    let require = "incoming: [derive]\n      outgoing: []";
    // Act
    let got = rule_problems("kind: part def", require);
    // Assert
    assert_eq!(
        got,
        [
            "ルール「r1」：不明な関係の種類「derive」です（require.incoming）。指定できる種類：satisfy・verify・frame・derivation・flow",
            "ルール「r1」：関係の種類（require.outgoing）が空です。1 つ以上書いてください",
        ]
    );
}

#[test]
fn duplicate_rule_ids_are_reported_at_the_second_one() {
    // Arrange（同じファイルの中と、別のファイル）
    let m = manifest(&["a.yaml", "b.yaml"]);
    let rule = |id: &str| {
        format!(
            "  - id: {id}\n    severity: hint\n    message: m\n    match: {{ kind: part def }}\n    require: {{}}\n"
        )
    };
    let a = format!("rules:\n{}{}", rule("x"), rule("x"));
    let b = format!("rules:\n{}{}", rule("y"), rule("x"));
    // Act
    let plugin = load_files(
        ID,
        &[
            (&format!("{DIR}/modelith-plugin.json"), &m),
            (&format!("{DIR}/a.yaml"), &a),
            (&format!("{DIR}/b.yaml"), &b),
        ],
    );
    // Assert
    let ids: Vec<&str> = plugin.rules.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, ["x", "y"]);
    let message = "ルールの ID「x」が重複しています。プラグインの中で 1 つにしてください";
    assert_eq!(
        problems(&plugin),
        [
            format!("{DIR}/a.yaml:7:5 {message}"),
            format!("{DIR}/b.yaml:7:5 {message}"),
        ]
    );
}

#[test]
fn a_broken_rule_does_not_hide_the_good_ones() {
    // Arrange
    let yaml = "rules:\n  - id: bad\n    severity: error\n    message: m\n    match: { kind: part def, name: \"[\" }\n    require: {}\n  - id: good\n    severity: error\n    message: m\n    match: { kind: part def }\n    require: {}\n";
    // Act
    let plugin = load_yaml(yaml);
    // Assert
    let ids: Vec<&str> = plugin.rules.iter().map(|r| r.id.as_str()).collect();
    assert_eq!((ids, plugin.problems.len()), (vec!["good"], 1));
}

// ---- 補助の関数 ----------------------------------------------------------------

#[test]
fn describe_serde_error_puts_the_meaning_first() {
    // Arrange（同値クラス：不明な項目・欠けた項目・知らない値・その他）
    let raws = [
        "a: unknown field `x`, expected `y` at line 2 column 3",
        "missing field `rules`",
        "unknown variant `fatal`, expected one of `error`",
        "EOF while parsing a value at line 1 column 0",
    ];
    // Act
    let got: Vec<String> = raws
        .iter()
        .map(|r| describe_serde_error(r, "JSON"))
        .collect();
    // Assert
    assert_eq!(
        got,
        [
            "不明な項目「x」があります（a: unknown field `x`, expected `y`）",
            "必要な項目「rules」がありません（missing field `rules`）",
            "指定できない値「fatal」です（unknown variant `fatal`, expected one of `error`）",
            "書式にエラーがあるため読み込めません（JSON：EOF while parsing a value）",
        ]
    );
}

#[test]
fn rule_places_finds_block_style_ids_only() {
    // Arrange（- の後の id、字下げした id、フロー形式は見つけない）
    let text = "rules:\n  - id: a\n  - severity: x\n    id: b\n  - { id: c }\n";
    // Act
    let places = rule_places(text);
    // Assert
    assert_eq!(
        places,
        [Place { line: 2, column: 5 }, Place { line: 4, column: 5 }]
    );
}

#[test]
fn rule_places_falls_back_to_no_place_when_counts_differ() {
    // Arrange（フロー形式のルールは位置を決められないので、位置なしで知らせる）
    let yaml =
        "rules:\n  - { id: a, severity: hint, message: m, match: { kind: nope }, require: {} }\n";
    // Act
    let plugin = load_yaml(yaml);
    // Assert
    assert_eq!(plugin.problems.len(), 1);
    assert_eq!(plugin.problems[0].place, None);
}

// ---- 画面から渡されたファイルで読む・マニフェストの情報 -----------------------------------

#[test]
fn load_plugin_files_reads_paths_relative_to_the_plugin_folder() {
    // Arrange（画面は、プラグインのフォルダからの相対パスで渡す）
    let files: BTreeMap<String, String> = [
        (
            "modelith-plugin.json".to_owned(),
            manifest(&["rules/a.yaml"]),
        ),
        ("rules/a.yaml".to_owned(), one_rule("kind: part def", "{}")),
    ]
    .into();
    // Act
    let plugin = load_plugin_files(ID, &files);
    // Assert
    let ids: Vec<&str> = plugin.rules.iter().map(|r| r.id.as_str()).collect();
    assert_eq!((ids, problems(&plugin)), (vec!["r1"], vec![]));
    assert!(plugin.installed);
    assert_eq!(
        plugin.manifest,
        Some(ManifestInfo {
            id: ID.to_owned(),
            name: "例".to_owned(),
            version: "0.1.0".to_owned(),
            runtime: Runtime::Rules,
            description: None,
        })
    );
}

#[test]
fn load_plugin_files_without_files_is_not_installed() {
    // Arrange（境界値: 空のフォルダ。F-PLUG-9）
    let files = BTreeMap::new();
    // Act
    let plugin = load_plugin_files(ID, &files);
    // Assert
    assert_eq!(
        (plugin.installed, plugin.manifest, plugin.problems.len()),
        (false, None, 1)
    );
}

#[test]
fn unreadable_manifest_counts_as_installed() {
    // Arrange（異常系: ファイルはあるが読めない）
    let read = |_: &str| Err(ReadError::Other("権限がありません".to_owned()));
    // Act
    let plugin = load_plugin(ID, read);
    // Assert
    assert!(plugin.installed);
}

#[test]
fn manifest_info_is_kept_even_when_the_plugin_cannot_be_used() {
    // Arrange（対応しない apiVersion でも、名前と版は画面に示す）
    let m = manifest(&[]).replace("\"apiVersion\": \"0\"", "\"apiVersion\": \"9\"");
    // Act
    let plugin = load_files(ID, &[(&format!("{DIR}/modelith-plugin.json"), &m)]);
    // Assert
    assert_eq!(plugin.manifest.map(|m| m.name), Some("例".to_owned()));
    assert_eq!(plugin.problems.len(), 1);
}

#[test]
fn describe_manifest_returns_name_version_and_runtime() {
    // Arrange（TypeScript のプラグイン。追加の前に種類を示す）
    let text = r#"{"id":"jp.ts","name":"図の書き出し","version":"1.2.0","apiVersion":"0","runtime":"browser","description":"説明","license":"MIT","main":"main.js"}"#;
    // Act
    let info = describe_manifest("modelith-plugin.json", text);
    // Assert
    assert_eq!(
        info,
        Ok(ManifestInfo {
            id: "jp.ts".to_owned(),
            name: "図の書き出し".to_owned(),
            version: "1.2.0".to_owned(),
            runtime: Runtime::Browser,
            description: Some("説明".to_owned()),
        })
    );
}

#[test]
fn describe_manifest_reports_broken_json_and_bad_ids_with_place() {
    // Arrange（異常系: JSON の誤り・ID の形の誤り）
    let broken = "{\n  \"id\": ";
    let bad_id = r#"{"id":"../x","name":"n","version":"0.1.0","apiVersion":"0","runtime":"rules","license":"MIT"}"#;
    // Act
    let a = describe_manifest("m.json", broken).map_err(|p| (p.place.is_some(), p.message));
    let b = describe_manifest("m.json", bad_id).map_err(|p| p.message);
    // Assert
    assert!(
        matches!(a, Err((true, ref m)) if m.starts_with("書式にエラーがあるため読み込めません（JSON：")),
        "{a:?}"
    );
    assert!(
        matches!(b, Err(ref m) if m.starts_with("プラグインの ID は")),
        "{b:?}"
    );
}
