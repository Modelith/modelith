//! 検査の単体テスト（F-PLUG-1：チェックルールでモデルを検査し、どのプラグインのどのルールかを添えて示す）。
//! 条件ごとに、当たる・当たらない（同値クラス）と、数の境界を確かめる。

use super::super::check::fill_message;
use super::super::{DiagnosticSeverity, LoadedPlugin, Place, check, check_text};
use super::{ID, load_yaml, one_rule};
use crate::model::Node;

/// 検査に使うモデル。要素とその線（「元 → 先」）：
///
/// - Top（要求・工程 concept）← derivation ← Low
/// - Low（要求・工程 detail）← satisfy ← Pump、← verify ← CheckLow、→ frame → Cost
/// - Lonely（要求・工程なし・線なし）
/// - Pump（部品定義・ポート 2）→ flow → Tank（部品定義・ポート 0）
/// - Plant（部品定義）、car（package 直下の部品）
const MODEL: &str = "package P {
  enum def Stage { enum concept; enum detail; }
  metadata def Phase { attribute stage : Stage; }
  requirement def Top { @Phase { stage = concept; } }
  requirement def Low { @Phase { stage = detail; } frame concern c : Cost; }
  requirement def Lonely;
  concern def Cost;
  part def Pump { port inlet; port outlet; }
  part def Tank;
  part def Plant { part p : Pump; part t : Tank; flow from p to t; }
  verification def CheckLow { objective { verify Low; } }
  satisfy Low by Pump;
  #derivation dependency from Low to Top;
  part car;
}
";

/// ルール 1 つのプラグインで `MODEL` を検査し、結果の要素のキーを返す。
fn flagged(target: &str, require: &str) -> Vec<String> {
    let plugin = rule(target, require);
    check_text(MODEL, &[plugin])
        .into_iter()
        .map(|l| l.finding.element)
        .collect()
}

/// ルール 1 つのプラグインを読み込む（問題があれば失敗させる）。
fn rule(target: &str, require: &str) -> LoadedPlugin {
    let plugin = load_yaml(&one_rule(target, require));
    assert!(plugin.problems.is_empty(), "{:?}", plugin.problems);
    plugin
}

// ---- match ---------------------------------------------------------------------

#[test]
fn match_kind_selects_elements_of_that_kind() {
    // Arrange（not: {} は当たった要素すべてに結果を出す）
    let (target, require) = ("kind: requirement def", "not: {}");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Top", "Low", "Lonely"]);
}

#[test]
fn match_kind_list_selects_any_of_them() {
    // Arrange（定義と、package 直下の使用）
    let (target, require) = ("kind: [concern def, part]", "not: {}");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Cost", "car"]);
}

#[test]
fn match_kind_with_no_such_element_flags_nothing() {
    // Arrange（書ける種類だが、モデルに無い）
    let (target, require) = ("kind: state def", "not: {}");
    // Act
    let got = flagged(target, require);
    // Assert
    assert!(got.is_empty(), "{got:?}");
}

#[test]
fn match_phase_selects_elements_in_that_phase_only() {
    // Arrange（工程の無い Lonely と、別の工程の Top は当たらない）
    let (target, require) = ("kind: requirement def\n      phase: detail", "not: {}");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Low"]);
}

#[test]
fn match_name_regex_selects_matching_names() {
    // Arrange（名前のどこかに当たればよい。^ で先頭に固定）
    let (target, require) = ("kind: requirement def\n      name: \"^L\"", "not: {}");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Low", "Lonely"]);
}

#[test]
fn match_conditions_must_all_hold() {
    // Arrange（種類・工程・名前のすべて）
    let (target, require) = (
        "kind: requirement def\n      phase: concept\n      name: \"^L\"",
        "not: {}",
    );
    // Act
    let got = flagged(target, require);
    // Assert（Top は名前、Low は工程が合わない）
    assert!(got.is_empty(), "{got:?}");
}

// ---- require：関係 ---------------------------------------------------------------

#[test]
fn incoming_satisfy_flags_unsatisfied_requirements() {
    // Arrange（ADR-0018 の例）
    let (target, require) = ("kind: requirement def", "incoming: satisfy");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Top", "Lonely"]);
}

#[test]
fn incoming_list_accepts_any_of_the_relations() {
    // Arrange（Top は導出の先、Low は満たされている）
    let (target, require) = ("kind: requirement def", "incoming: [satisfy, derivation]");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Lonely"]);
}

#[test]
fn outgoing_derivation_follows_the_direction_from_derived_to_original() {
    // Arrange（Low → Top。Top は出していない）
    let (target, require) = ("kind: requirement def", "outgoing: derivation");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Top", "Lonely"]);
}

#[test]
fn verify_frame_and_flow_relations_are_seen() {
    // Arrange（verify・frame は要求の側、flow は部品定義の側）
    let cases = [
        ("kind: requirement def", "incoming: verify"),
        ("kind: requirement def", "outgoing: frame"),
        ("kind: part def", "outgoing: flow"),
        ("kind: part def", "incoming: flow"),
    ];
    // Act
    let got: Vec<Vec<String>> = cases.iter().map(|(t, r)| flagged(t, r)).collect();
    // Assert
    assert_eq!(
        got,
        [
            vec!["Top", "Lonely"],
            vec!["Top", "Lonely"],
            vec!["Tank", "Plant"],
            vec!["Pump", "Plant"],
        ]
    );
}

#[test]
fn incoming_and_outgoing_are_not_confused() {
    // Arrange（Pump は満たす側＝出す側。受けてはいない）
    let (target, require) = ("kind: part def\n      name: Pump", "incoming: satisfy");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Pump"]);
}

// ---- require：名前・工程・ポート -------------------------------------------------------

#[test]
fn require_name_flags_names_that_do_not_match() {
    // Arrange（名前は大文字で始まる。car は当たらない）
    let (target, require) = ("kind: [part def, part]", "name: \"^[A-Z]\"");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["car"]);
}

#[test]
fn require_phase_true_flags_elements_without_phase() {
    // Arrange
    let (target, require) = ("kind: requirement def", "phase: true");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Lonely"]);
}

#[test]
fn require_phase_false_flags_elements_with_phase() {
    // Arrange
    let (target, require) = ("kind: requirement def", "phase: false");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Top", "Low"]);
}

#[test]
fn ports_min_boundary() {
    // Arrange（Pump は 2 つ。min = 2 は良し、min = 3 は足りない）
    let target = "kind: part def\n      name: Pump";
    // Act
    let got = [
        flagged(target, "ports: { min: 2 }"),
        flagged(target, "ports: { min: 3 }"),
    ];
    // Assert
    assert_eq!(got, [vec![], vec!["Pump"]]);
}

#[test]
fn ports_max_boundary() {
    // Arrange（Pump は 2 つ。max = 2 は良し、max = 1 は多すぎる）
    let target = "kind: part def\n      name: Pump";
    // Act
    let got = [
        flagged(target, "ports: { max: 2 }"),
        flagged(target, "ports: { max: 1 }"),
    ];
    // Assert
    assert_eq!(got, [vec![], vec!["Pump"]]);
}

#[test]
fn ports_zero_is_within_an_open_range_but_not_min_one() {
    // Arrange（境界値：ポート 0 の Tank。上下とも省いた範囲・min = 0・min = 1）
    let target = "kind: part def\n      name: Tank";
    // Act
    let got = [
        flagged(target, "ports: {}"),
        flagged(target, "ports: { min: 0, max: 0 }"),
        flagged(target, "ports: { min: 1 }"),
    ];
    // Assert
    assert_eq!(got, [vec![], vec![], vec!["Tank"]]);
}

// ---- require：not・空・組み合わせ ------------------------------------------------------

#[test]
fn not_negates_the_nested_requirement() {
    // Arrange（満たされている要求を禁じる）
    let (target, require) = ("kind: requirement def", "not: { incoming: satisfy }");
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Low"]);
}

#[test]
fn double_not_is_the_requirement_itself() {
    // Arrange
    let (target, require) = (
        "kind: requirement def",
        "not: { not: { incoming: satisfy } }",
    );
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Top", "Lonely"]);
}

#[test]
fn empty_requirement_always_holds() {
    // Arrange（境界値：何も書かない require）
    let (target, require) = ("kind: requirement def", "{}");
    // Act
    let got = flagged(target, require);
    // Assert
    assert!(got.is_empty(), "{got:?}");
}

#[test]
fn require_conditions_must_all_hold() {
    // Arrange（工程を持ち、かつ満たされている。Top は満たされず、Lonely は工程が無い）
    let (target, require) = (
        "kind: requirement def",
        "phase: true\n      incoming: satisfy",
    );
    // Act
    let got = flagged(target, require);
    // Assert
    assert_eq!(got, ["Top", "Lonely"]);
}

// ---- 結果の形 -------------------------------------------------------------------

#[test]
fn finding_carries_plugin_rule_severity_message_and_place() {
    // Arrange
    let plugin = rule(
        "kind: requirement def\n      name: Lonely",
        "incoming: satisfy",
    );
    // Act
    let got = check_text(MODEL, &[plugin]);
    // Assert（宣言の始まり：6 行目の 3 列目）
    assert_eq!(got.len(), 1);
    let l = &got[0];
    assert_eq!(
        (
            l.place,
            l.finding.plugin.as_str(),
            l.finding.rule.as_str(),
            l.finding.severity,
            l.finding.message.as_str(),
        ),
        (
            Place { line: 6, column: 3 },
            ID,
            "r1",
            DiagnosticSeverity::Warning,
            "requirement def「Lonely」",
        )
    );
}

#[test]
fn place_column_counts_utf16_units() {
    // Arrange（2 行目の宣言の前のコメントに、UTF-16 で 2 単位の文字と 1 単位の文字）
    let text = "package P {\n/* 🚀日 */ part def A;\n}\n";
    let plugin = rule("kind: part def", "not: {}");
    // Act
    let got = check_text(text, &[plugin]);
    // Assert（「/* 」= 3、🚀 = 2、日 = 1、「 */ 」= 4 の後。バイトなら 17 列目）
    assert_eq!(
        got[0].place,
        Place {
            line: 2,
            column: 11
        }
    );
}

#[test]
fn every_rule_of_every_plugin_is_applied_in_order() {
    // Arrange（プラグイン 2 つ。1 つ目はルール 2 つ）
    let yaml = "rules:\n  - id: a\n    severity: error\n    message: m\n    match: { kind: concern def }\n    require: { not: {} }\n  - id: b\n    severity: hint\n    message: m\n    match: { kind: part }\n    require: { not: {} }\n";
    let first = load_yaml(yaml);
    let mut second = rule("kind: concern def", "not: {}");
    second.id = "jp.example.second".to_owned();
    // Act
    let got: Vec<(String, String, String)> = check_text(MODEL, &[first, second])
        .into_iter()
        .map(|l| (l.finding.plugin, l.finding.rule, l.finding.element))
        .collect();
    // Assert
    let row = |p: &str, r: &str, e: &str| (p.to_owned(), r.to_owned(), e.to_owned());
    assert_eq!(
        got,
        [
            row(ID, "a", "Cost"),
            row(ID, "b", "car"),
            row("jp.example.second", "r1", "Cost"),
        ]
    );
}

#[test]
fn no_plugins_or_empty_text_give_no_findings() {
    // Arrange（境界値：プラグイン 0 個、テキストが空）
    let plugin = rule("kind: part def", "not: {}");
    // Act
    let got = (
        check_text(MODEL, &[]).len(),
        check_text("", &[plugin]).len(),
    );
    // Assert
    assert_eq!(got, (0, 0));
}

#[test]
fn check_works_on_an_already_built_model() {
    // Arrange（画面は解析結果とモデルを持っているので、それを渡す）
    let p = crate::project::project(MODEL, &crate::syntax::parse(MODEL));
    let m = crate::model::build(&p);
    let plugin = rule("kind: requirement def", "incoming: satisfy");
    // Act
    let got: Vec<String> = check(&[plugin], &p, &m)
        .into_iter()
        .map(|f| f.element)
        .collect();
    // Assert
    assert_eq!(got, ["Top", "Lonely"]);
}

/// `fill_message` に渡す要素（名前と種類だけを使う）。
fn node(name: &str, kind: &str) -> Node {
    Node {
        key: name.to_owned(),
        name: name.to_owned(),
        short: String::new(),
        kind: kind.to_owned(),
        is_def: true,
        entry: 0,
        fam: "part",
        trans: vec![],
        ports: vec![],
        phase: None,
        phase_own: false,
        file: None,
    }
}

#[test]
fn fill_message_substitutes_name_and_kind() {
    // Arrange（くり返し・知らない差し込み・閉じない「{」）
    let n = node("A", "part def");
    let templates = ["{kind}「{name}」", "{name}{name}", "{other} {", ""];
    // Act
    let got: Vec<String> = templates.iter().map(|t| fill_message(t, &n)).collect();
    // Assert
    assert_eq!(got, ["part def「A」", "AA", "{other} {", ""]);
}

#[test]
fn fill_message_does_not_expand_inside_substituted_values() {
    // Arrange（名前そのものが「{kind}」）
    let n = node("{kind}", "part def");
    // Act
    let got = fill_message("{name}", &n);
    // Assert
    assert_eq!(got, "{kind}");
}
