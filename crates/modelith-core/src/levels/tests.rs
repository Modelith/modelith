//! 知らせの重さ（F-EDIT-11）の単体テスト。

use super::*;
use crate::model::Problem;

/// 種類と文から問題を作る。
fn problem(code: Option<&'static str>, kind: Option<&'static str>, msg: &str) -> Problem {
    Problem {
        pos: 0,
        msg: msg.to_owned(),
        kind,
        code,
        level: None,
    }
}

/// ルールの結果を作る。
fn finding(rule: &str, severity: DiagnosticSeverity) -> Finding {
    Finding {
        plugin: "jp.x".to_owned(),
        rule: rule.to_owned(),
        severity,
        message: rule.to_owned(),
        element: "A".to_owned(),
        pos: 0,
    }
}

/// 種類ごとの重さの表を作る。
fn levels(pairs: &[(&str, Level)]) -> Levels {
    pairs.iter().map(|(k, l)| ((*k).to_owned(), *l)).collect()
}

#[test]
fn kinds_are_trace_gaps_and_unsupported_with_their_defaults() {
    // Act
    let shown: Vec<(&str, Level)> = KINDS.iter().map(|k| (k.code, k.default)).collect();
    // Assert
    assert_eq!(
        shown,
        vec![
            ("trace.derive", Level::Warning),
            ("trace.satisfy", Level::Warning),
            ("trace.verify", Level::Warning),
            ("unsupported", Level::Info),
        ]
    );
}

#[test]
fn known_kinds_are_the_model_kinds_and_plugin_rules() {
    // Assert（同値分割: モデルの種類・ルール・形の崩れたルール・知らない名前）
    assert!(is_known_kind("trace.verify"));
    assert!(is_known_kind("jp.x/req-has-id"));
    assert!(!is_known_kind("jp.x/"));
    assert!(!is_known_kind("/r1"));
    assert!(!is_known_kind("color"));
}

#[test]
fn apply_problems_drops_off_and_marks_chosen_levels() {
    // Arrange
    let problems = vec![
        problem(None, None, "構文エラー"),
        problem(Some("trace.verify"), Some("gap"), "検証の抜け"),
        problem(Some("trace.satisfy"), Some("gap"), "満たす要素の抜け"),
        problem(
            Some("unsupported"),
            Some("unsupported"),
            "まだ扱えない書き方",
        ),
    ];
    let levels = levels(&[("trace.verify", Level::Error), ("unsupported", Level::Off)]);
    // Act
    let out = apply_problems(problems, &levels);
    // Assert（構文エラーと、選んでいない種類はそのまま）
    let shown: Vec<(&str, Option<&str>)> = out.iter().map(|p| (p.msg.as_str(), p.level)).collect();
    assert_eq!(
        shown,
        vec![
            ("構文エラー", None),
            ("検証の抜け", Some("error")),
            ("満たす要素の抜け", None)
        ]
    );
}

#[test]
fn apply_problems_without_levels_changes_nothing() {
    // Arrange（境界値: 何も選んでいない）
    let problems = vec![problem(Some("trace.verify"), Some("gap"), "検証の抜け")];
    // Act
    let out = apply_problems(problems.clone(), &Levels::new());
    // Assert
    assert_eq!(out, problems);
}

#[test]
fn apply_findings_replaces_severities_and_drops_off() {
    // Arrange
    let findings = vec![
        finding("r1", DiagnosticSeverity::Warning),
        finding("r2", DiagnosticSeverity::Warning),
        finding("r3", DiagnosticSeverity::Hint),
        finding("r4", DiagnosticSeverity::Error),
    ];
    let levels = levels(&[
        ("jp.x/r1", Level::Error),
        ("jp.x/r2", Level::Off),
        ("jp.x/r4", Level::Info),
    ]);
    // Act
    let out = apply_findings(findings, &levels);
    // Assert（r3 は選んでいないのでそのまま）
    let shown: Vec<(&str, DiagnosticSeverity)> =
        out.iter().map(|f| (f.rule.as_str(), f.severity)).collect();
    assert_eq!(
        shown,
        vec![
            ("r1", DiagnosticSeverity::Error),
            ("r3", DiagnosticSeverity::Hint),
            ("r4", DiagnosticSeverity::Information),
        ]
    );
}

#[test]
fn trace_gaps_carry_their_kind() {
    // Arrange（Need は最初のフェーズ、FlowReq は 2 つ目のフェーズ。どちらも抜けがある）
    let text = "package P { enum def Stage { enum concept; enum detail; } \
         metadata def Phase { attribute stage : Stage; } \
         requirement def Need { @Phase { stage = concept; } } \
         requirement def FlowReq { @Phase { stage = detail; } } \
         #derivation dependency from Need to FlowReq; }";
    let model = crate::model::build(&crate::project::project(text, &crate::syntax::parse(text)));
    // Act
    let codes: Vec<Option<&str>> = model
        .problems
        .iter()
        .filter(|p| p.kind == Some("gap"))
        .map(|p| p.code)
        .collect();
    // Assert
    assert_eq!(
        codes,
        vec![
            Some("trace.derive"),
            Some("trace.derive"),
            Some("trace.satisfy"),
            Some("trace.verify")
        ]
    );
}
