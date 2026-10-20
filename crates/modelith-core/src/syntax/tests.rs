//! 構文木の単体テスト（ADR-0015）。木の形は `expect-test` で文字列にして比べる。
//! 期待値を直すときは `UPDATE_EXPECT=1 cargo test -p modelith-core` で書き換え、差分を目で確かめる。

use super::*;
use SyntaxKind::*;
use expect_test::{Expect, expect};

/// ゴールデンのケースと公開サンプル（エラーの無い入力）。
const VALID: &[(&str, &str)] = &[
    (
        "basic-parts",
        include_str!("../../../../reference/golden/cases/basic-parts.sysml"),
    ),
    (
        "requirements",
        include_str!("../../../../reference/golden/cases/requirements.sysml"),
    ),
    (
        "electric-kettle",
        include_str!("../../../../web/src/samples/electric-kettle.sysml"),
    ),
];
const SYNTAX_ERRORS: &str = include_str!("../../../../reference/golden/cases/syntax-errors.sysml");

fn check(text: &str, expected: Expect) {
    expected.assert_eq(&parse(text).debug_tree());
}

/// 節の種類だけを、出てくる順に並べる（トークンは除く）。
fn node_kinds(text: &str) -> Vec<SyntaxKind> {
    parse(text)
        .syntax()
        .descendants()
        .map(|n| n.kind())
        .collect()
}

fn errors(text: &str) -> Vec<(usize, String)> {
    parse(text)
        .errors()
        .iter()
        .map(|e| (e.offset, e.message.clone()))
        .collect()
}

// ---- 木の形（正常系） ----

#[test]
fn part_definition_with_short_name_typed_port_and_body() {
    check(
        "part def <P1> Engine :> Base { port p : ~Fuel[1]; }",
        expect![[r#"
            SOURCE_FILE@0..51
              PART_DEFINITION@0..51
                KEYWORD@0..4 "part"
                WHITESPACE@4..5 " "
                KEYWORD@5..8 "def"
                WHITESPACE@8..9 " "
                SHORT_NAME@9..13
                  LT@9..10 "<"
                  IDENT@10..12 "P1"
                  GT@12..13 ">"
                WHITESPACE@13..14 " "
                NAME@14..20
                  IDENT@14..20 "Engine"
                WHITESPACE@20..21 " "
                SUBCLASSIFICATION@21..28
                  COLON_GT@21..23 ":>"
                  WHITESPACE@23..24 " "
                  QUALIFIED_NAME@24..28
                    IDENT@24..28 "Base"
                WHITESPACE@28..29 " "
                BODY@29..51
                  L_BRACE@29..30 "{"
                  WHITESPACE@30..31 " "
                  PORT_USAGE@31..49
                    KEYWORD@31..35 "port"
                    WHITESPACE@35..36 " "
                    NAME@36..37
                      IDENT@36..37 "p"
                    WHITESPACE@37..38 " "
                    FEATURE_TYPING@38..45
                      COLON@38..39 ":"
                      WHITESPACE@39..40 " "
                      TILDE@40..41 "~"
                      QUALIFIED_NAME@41..45
                        IDENT@41..45 "Fuel"
                    MULTIPLICITY@45..48
                      L_BRACK@45..46 "["
                      NUMBER@46..47 "1"
                      R_BRACK@47..48 "]"
                    SEMI@48..49 ";"
                  WHITESPACE@49..50 " "
                  R_BRACE@50..51 "}"
        "#]],
    );
}

#[test]
fn usage_subsets_redefines_and_references_are_distinct_relationships() {
    // Arrange（8.2.2.6：使用の :> は部分集合、:>> は再定義、::> は参照）
    let text = "part a :> b; part :>> c; part d ::> e; part def F :> G;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    for k in [
        SUBSETTING,
        REDEFINITION,
        REFERENCE_SUBSETTING,
        SUBCLASSIFICATION,
    ] {
        assert!(kinds.contains(&k), "{k:?} がありません");
    }
}

#[test]
fn keyword_relationships_match_symbol_relationships() {
    // Arrange（同値クラス: 記号とキーワード。SysML の型付けのキーワードは DEFINED_BY の `defined by`）
    let symbols = node_kinds("part a : T :> b :>> c ::> d;");
    let words = node_kinds("part a defined by T subsets b redefines c references d;");
    // Act / Assert
    assert_eq!(symbols, words);
}

#[test]
fn feature_chain_and_qualified_name_are_references() {
    check(
        "satisfy R::k1 by kettle.heater;",
        expect![[r#"
            SOURCE_FILE@0..31
              SATISFY_REQUIREMENT_USAGE@0..31
                KEYWORD@0..7 "satisfy"
                WHITESPACE@7..8 " "
                QUALIFIED_NAME@8..13
                  IDENT@8..9 "R"
                  COLON2@9..11 "::"
                  IDENT@11..13 "k1"
                WHITESPACE@13..14 " "
                KEYWORD@14..16 "by"
                WHITESPACE@16..17 " "
                FEATURE_CHAIN@17..30
                  QUALIFIED_NAME@17..23
                    IDENT@17..23 "kettle"
                  DOT@23..24 "."
                  QUALIFIED_NAME@24..30
                    IDENT@24..30 "heater"
                SEMI@30..31 ";"
        "#]],
    );
}

#[test]
fn perform_with_kind_declares_name_and_without_kind_references() {
    // Arrange（BNF: UsageDeclaration と OwnedReferenceSubsetting）
    let declared = parse("perform action a : A;");
    let referenced = parse("perform a;");
    // Act
    let has_name = |p: &Parse| p.syntax().descendants().any(|n| n.kind() == NAME);
    // Assert
    assert!(has_name(&declared));
    assert!(!has_name(&referenced));
}

#[test]
fn documentation_takes_the_following_comment_as_its_body() {
    check(
        "part def A { doc /* 説明 */ }",
        expect![[r#"
            SOURCE_FILE@0..31
              PART_DEFINITION@0..31
                KEYWORD@0..4 "part"
                WHITESPACE@4..5 " "
                KEYWORD@5..8 "def"
                WHITESPACE@8..9 " "
                NAME@9..10
                  IDENT@9..10 "A"
                WHITESPACE@10..11 " "
                BODY@11..31
                  L_BRACE@11..12 "{"
                  WHITESPACE@12..13 " "
                  DOCUMENTATION@13..29
                    KEYWORD@13..16 "doc"
                    WHITESPACE@16..17 " "
                    REGULAR_COMMENT@17..29 "/* 説明 */"
                  WHITESPACE@29..30 " "
                  R_BRACE@30..31 "}"
        "#]],
    );
}

#[test]
fn comment_inside_a_declaration_is_skipped_but_kept_in_the_tree() {
    // Arrange（宣言の途中のコメントは、要素にしない）
    let text = "part /* 途中 */ a : T;";
    // Act
    let p = parse(text);
    // Assert
    assert!(p.errors().is_empty());
    assert!(!p.syntax().descendants().any(|n| n.kind() == COMMENT));
    assert_eq!(p.syntax().text().to_string(), text);
}

#[test]
fn standalone_comment_is_a_comment_element() {
    // Arrange
    let text = "/* 見出し */ package P;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds, vec![SOURCE_FILE, COMMENT, PACKAGE, NAME]);
}

#[test]
fn prefix_metadata_and_visibility_belong_to_the_declaration() {
    // Arrange（8.2.2.27 PrefixMetadataMember）
    let text = "private #M #N part def A;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(
        kinds,
        vec![
            SOURCE_FILE,
            PART_DEFINITION,
            PREFIX_METADATA,
            QUALIFIED_NAME,
            PREFIX_METADATA,
            QUALIFIED_NAME,
            NAME
        ]
    );
}

#[test]
fn import_and_expose_keep_wildcards_and_filter_in_the_target() {
    check(
        "import A::*::**; expose 'B c'::*[@F];",
        expect![[r#"
            SOURCE_FILE@0..37
              IMPORT@0..16
                KEYWORD@0..6 "import"
                WHITESPACE@6..7 " "
                QUALIFIED_NAME@7..15
                  IDENT@7..8 "A"
                  COLON2@8..10 "::"
                  STAR@10..11 "*"
                  COLON2@11..13 "::"
                  STAR2@13..15 "**"
                SEMI@15..16 ";"
              WHITESPACE@16..17 " "
              EXPOSE@17..37
                KEYWORD@17..23 "expose"
                WHITESPACE@23..24 " "
                QUALIFIED_NAME@24..32
                  QUOTED_NAME@24..29 "'B c'"
                  COLON2@29..31 "::"
                  STAR@31..32 "*"
                EXPRESSION@32..36
                  L_BRACK@32..33 "["
                  AT@33..34 "@"
                  IDENT@34..35 "F"
                  R_BRACK@35..36 "]"
                SEMI@36..37 ";"
        "#]],
    );
}

#[test]
fn name_led_statement_is_a_usage_or_an_expression() {
    // Arrange（同値クラス: 値の付いた使用・式・向きの付いたパラメータ）
    let usage = node_kinds("stage = K::X;");
    let expr = node_kinds("constraint def C { a * b == c }");
    let param = node_kinds("in c : Real;");
    // Act / Assert
    assert_eq!(usage[1], REFERENCE_USAGE);
    assert!(expr.contains(&EXPRESSION_MEMBER));
    assert_eq!(param[1], REFERENCE_USAGE);
}

#[test]
fn state_body_reads_entry_successions_and_transitions() {
    // Arrange
    let text = "state def S { entry; then idle; state idle; transition t first idle accept Go then idle; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    for k in [
        STATE_SUBACTION_MEMBER,
        SUCCESSION_AS_USAGE,
        STATE_USAGE,
        TRANSITION_USAGE,
    ] {
        assert!(kinds.contains(&k), "{k:?} がありません");
    }
    assert!(parse(text).errors().is_empty());
}

#[test]
fn then_with_kind_is_a_usage_of_that_kind() {
    // Arrange
    let text = "action def A { action a; then action b; then message m of T from x to y; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds.iter().filter(|k| **k == ACTION_USAGE).count(), 2);
    assert!(kinds.contains(&MESSAGE_USAGE));
}

#[test]
fn then_event_reference_is_one_event_usage() {
    // Arrange（同値分割：then event occurrence e（宣言の形）・then event a.e（参照の形）、8.2.2.9。
    // 以前は参照の形が、端の無い then と別のイベントの 2 つに分かれていた）
    let text = "part a { event occurrence e1; then event occurrence e2; then event b.e3; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds.iter().filter(|k| **k == OCCURRENCE_USAGE).count(), 3);
    assert!(!kinds.contains(&SUCCESSION_AS_USAGE));
    assert!(parse(text).errors().is_empty());
}

#[test]
fn composite_render_names_its_rendering_and_reference_render_does_not() {
    // Arrange（ViewRenderingUsage、8.2.2.26：合成形 render rendering r … と参照形 render asTreeDiagram …）
    let text = "view v { render rendering r :> asTreeDiagram { doc /* x */ } render asTreeDiagram :> base; }";
    // Act
    let p = parse(text);
    // Assert
    let renders: Vec<(bool, String)> = p
        .syntax()
        .descendants()
        .filter(|n| n.kind() == VIEW_RENDERING_USAGE)
        .map(|n| {
            let name = n.children().find(|c| c.kind() == NAME);
            (
                name.is_some(),
                name.map(|c| c.text().to_string()).unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(renders, [(true, "r".to_owned()), (false, String::new())]);
    assert!(p.errors().is_empty());
}

#[test]
fn statement_without_grammar_is_kept_as_unsupported() {
    // Arrange（F-EDIT-8：黙って捨てない）
    let text = "action def A { until x; }";
    // Act
    let p = parse(text);
    // Assert
    assert!(
        p.syntax()
            .descendants()
            .any(|n| n.kind() == UNSUPPORTED_MEMBER)
    );
    assert!(p.errors().is_empty());
}

// ---- 取り違えの修正（F-EDIT-8、alpha.7） ----

#[test]
fn textual_representation_ends_at_its_body_comment_at_package_level() {
    // Arrange（TextualRepresentation、8.2.2.4：本文のコメントで文が終わる）
    let text = "package P { rep r language \"x\" /* body */ part def B; }";
    // Act
    let p = parse(text);
    // Assert
    let kinds = node_kinds(text);
    assert!(kinds.contains(&TEXTUAL_REPRESENTATION));
    assert!(kinds.contains(&PART_DEFINITION));
    assert!(p.errors().is_empty());
}

#[test]
fn textual_representation_inside_a_body_is_followed_by_the_next_line() {
    // Arrange（定義の本体の中、次の行に宣言）
    let text = "part def A {\n    rep language \"x\" /* b */\n    part def B;\n}";
    // Act
    let p = parse(text);
    // Assert
    assert!(p.errors().is_empty());
    assert!(node_kinds(text).contains(&PART_DEFINITION));
}

#[test]
fn bare_language_form_is_a_textual_representation() {
    // Arrange（境界値：rep と名前の無い形）
    let text = "language \"x\" /* b */ part def B;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(
        kinds,
        vec![SOURCE_FILE, TEXTUAL_REPRESENTATION, PART_DEFINITION, NAME]
    );
    assert!(errors(text).is_empty());
}

#[test]
fn comment_before_the_language_name_is_not_the_body() {
    // Arrange（境界値：言語の名前の前のコメントは読み飛ばす）
    let text = "rep /* note */ r language \"x\" /* b */";
    // Act
    let p = parse(text);
    // Assert
    assert!(p.errors().is_empty());
    let rep = p
        .syntax()
        .children()
        .find(|n| n.kind() == TEXTUAL_REPRESENTATION);
    assert!(rep.is_some_and(|n| n.children().any(|c| c.kind() == NAME)));
}

#[test]
fn textual_representation_without_body_or_language_is_an_error() {
    // Arrange（異常系：本文が無い・language が無い）
    let no_body = "rep r language \"x\";";
    let no_language = "rep r;";
    // Act
    let a = errors(no_body);
    let b = errors(no_language);
    // Assert
    assert_eq!(a, vec![(18, "本文（/* … */）がありません".to_owned())]);
    assert_eq!(b, vec![(5, "「language」がありません".to_owned())]);
}

#[test]
fn less_than_after_a_name_is_a_comparison_not_a_declaration() {
    // Arrange（AssertConstraintUsage・RequirementConstraintMember、8.2.2.20〜21：本体の式）
    let texts = [
        "part def A { assert not constraint d { x < 0 } }",
        "part def A { assume constraint { y < 1 } }",
        "part def A { assume constraint c { y < 1 } }",
        "part def A { require constraint r { y < 1 } }",
        "constraint def C { x < 0 }",
    ];
    for text in texts {
        // Act
        let actual = errors(text);
        // Assert
        assert_eq!(actual, vec![], "{text}");
        assert!(node_kinds(text).contains(&EXPRESSION_MEMBER), "{text}");
    }
}

#[test]
fn result_expression_may_start_with_a_keyword() {
    // Arrange（同値分割：真偽値・null・単項の not・new。ResultExpressionMember、8.2.2.19〜20、KerML 8.2.5）
    let texts = [
        "constraint def C { true }",
        "constraint def C { false }",
        "calc def F { null }",
        "requirement def R { require constraint { not x } }",
        "constraint c { not (a and b) }",
        "calc def G { new T() }",
        "constraint def D { true; }",
    ];
    for text in texts {
        // Act
        let actual = errors(text);
        // Assert
        assert_eq!(actual, vec![], "{text}");
        assert!(node_kinds(text).contains(&EXPRESSION_MEMBER), "{text}");
    }
}

#[test]
fn not_before_satisfy_is_still_a_negated_satisfy() {
    // Arrange（境界値：`not satisfy` は式ではなく否定の充足、8.2.2.21）
    let text = "part def A { not satisfy R by B; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert!(kinds.contains(&SATISFY_REQUIREMENT_USAGE));
    assert!(!kinds.contains(&EXPRESSION_MEMBER));
}

#[test]
fn keyword_led_expression_without_its_semicolon_is_an_error() {
    // Arrange（異常系：「;」を書かずに、改行の後に次の宣言が続く）
    let text = "constraint def C { true\n part p; }";
    // Act
    let actual = errors(text);
    // Assert
    assert_eq!(actual, vec![(23, "「;」がありません".to_owned())]);
    assert!(node_kinds(text).contains(&PART_USAGE));
}

#[test]
fn name_followed_by_short_name_is_still_a_declaration() {
    // Arrange（境界値：`x <s> …` は宣言のまま）
    let text = "part def A { x <s> : T; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert!(kinds.contains(&REFERENCE_USAGE));
    assert!(!kinds.contains(&EXPRESSION_MEMBER));
}

// ---- エラーからの立ち直り（異常系） ----

#[test]
fn golden_syntax_error_case_reports_missing_semicolon_and_stray_brace() {
    // Arrange
    let text = SYNTAX_ERRORS;
    // Act
    let actual = errors(text);
    // Assert
    let after_b = text.find("part b : B").map(|i| i + "part b : B".len());
    let stray = text.rfind('}');
    assert_eq!(
        actual,
        vec![
            (after_b.unwrap_or_default(), "「;」がありません".to_owned()),
            (
                stray.unwrap_or_default(),
                "対応する「{」がない「}」があります".to_owned()
            ),
        ]
    );
}

#[test]
fn missing_semicolon_before_next_line_member_keeps_both_declarations() {
    // Arrange
    let text = "part def A {\n    part b : B\n    part c : C;\n}";
    // Act
    let p = parse(text);
    // Assert
    let parts = p
        .syntax()
        .descendants()
        .filter(|n| n.kind() == PART_USAGE)
        .count();
    assert_eq!(parts, 2);
    assert_eq!(p.errors().len(), 1);
}

#[test]
fn unclosed_block_reports_at_the_owner_declaration() {
    // Arrange
    let text = "package P {\n  part def A {\n";
    // Act
    let actual = errors(text);
    // Assert
    assert_eq!(
        actual,
        vec![
            (0, "「P」のブロックが閉じていません".to_owned()),
            (14, "「A」のブロックが閉じていません".to_owned()),
        ]
    );
}

#[test]
fn stray_closing_paren_does_not_stop_the_parser() {
    // Arrange
    let text = "package P { ) part a; }";
    // Act
    let p = parse(text);
    // Assert
    assert!(p.syntax().descendants().any(|n| n.kind() == PART_USAGE));
    assert!(!p.errors().is_empty());
}

#[test]
fn doc_without_body_is_an_error() {
    // Arrange
    let text = "part def A { doc }";
    // Act
    let actual = errors(text);
    // Assert
    assert_eq!(actual, vec![(17, "本文（/* … */）がありません".to_owned())]);
}

// ---- ロスレスとエラーへの強さ（ADR-0015） ----

#[test]
fn deep_nesting_stops_at_the_limit_without_overflowing_the_stack() {
    // Arrange（境界値: 上限ちょうど・上限を超える・とても深い）
    for (n, expect_error) in [
        (grammar::MAX_DEPTH, false),
        (grammar::MAX_DEPTH + 1, true),
        (100_000, true),
    ] {
        let text = format!("{}{}", "part a {".repeat(n), "}".repeat(n));
        // Act
        let p = parse(&text);
        // Assert
        assert_eq!(p.syntax().text().to_string(), text, "{n}");
        let too_deep = p
            .errors()
            .iter()
            .any(|e| e.message.starts_with("入れ子が深すぎる"));
        assert_eq!(too_deep, expect_error, "{n}");
    }
}

#[test]
fn deep_nesting_without_closing_braces_is_lossless() {
    // Arrange（異常系: 閉じない「{」が続く）
    let text = "{".repeat(50_000);
    // Act
    let p = parse(&text);
    // Assert
    assert_eq!(p.syntax().text().to_string(), text);
    assert!(!p.errors().is_empty());
}

#[test]
fn valid_cases_parse_without_errors() {
    for (name, text) in VALID {
        // Act
        let p = parse(text);
        // Assert
        assert_eq!(p.errors(), &[], "{name}");
        assert!(
            !p.syntax().descendants().any(|n| n.kind() == ERROR),
            "{name}"
        );
    }
}

#[test]
fn tree_text_equals_input_for_every_prefix_of_every_case() {
    // Arrange（途中まで書いた入力のすべて。どこで切っても panic せず、ロスレス）
    // サンプルは長いので、7 バイトおきに切る（デバッグビルドで数秒に収める）
    let cases = VALID.iter().map(|(_, t)| *t).chain([SYNTAX_ERRORS]);
    for text in cases {
        let step = if text.len() > 1000 { 7 } else { 1 };
        for end in (0..=text.len())
            .filter(|&i| text.is_char_boundary(i))
            .step_by(step)
        {
            let prefix = &text[..end];
            // Act
            let p = parse(prefix);
            // Assert
            assert_eq!(p.syntax().text().to_string(), prefix);
            assert!(p.errors().iter().all(|e| e.offset <= prefix.len()));
        }
    }
}

#[test]
fn every_suffix_parses_losslessly() {
    // Arrange（途中から始まる入力。閉じの「}」が先に来るなど、頭が欠けた形）
    let text = VALID[2].1;
    for start in (0..=text.len())
        .filter(|&i| text.is_char_boundary(i))
        .step_by(7)
    {
        let suffix = &text[start..];
        // Act
        let p = parse(suffix);
        // Assert
        assert_eq!(p.syntax().text().to_string(), suffix);
    }
}

// ---- alpha.7 で読むようにした形 ----

#[test]
fn typed_by_is_a_feature_typing_like_colon() {
    // Arrange（KerML の TYPED_BY。同値クラス: 名前あり・名前なし（境界値））
    let named = node_kinds("part p typed by A;");
    let unnamed = node_kinds("part typed by A;");
    // Act / Assert
    assert!(
        named.contains(&NAME) && named.contains(&FEATURE_TYPING),
        "{named:?}"
    );
    assert!(
        !unnamed.contains(&NAME) && unnamed.contains(&FEATURE_TYPING),
        "{unnamed:?}"
    );
    assert!(errors("part p typed by A;").is_empty());
}

#[test]
fn metadata_usage_reads_type_about_targets_and_body() {
    // Arrange（MetadataUsage・MetadataUsageDeclaration、8.2.2.27）
    let text = "metadata Safety about A, b.c { k = 1 + 2; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(
        kinds,
        [
            SOURCE_FILE,
            METADATA_KEYWORD_USAGE,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            FEATURE_CHAIN,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            BODY,
            REFERENCE_USAGE,
            NAME,
            FEATURE_VALUE,
            EXPRESSION,
        ]
    );
    assert!(errors(text).is_empty());
}

#[test]
fn named_metadata_usage_has_name_and_typing() {
    // Arrange（`m : M`・`m typed by M` の形）
    let colon = node_kinds("@s : Safety;");
    let typed = node_kinds("metadata s typed by Safety about A;");
    // Act / Assert
    assert_eq!(
        colon,
        [
            SOURCE_FILE,
            METADATA_USAGE,
            NAME,
            FEATURE_TYPING,
            QUALIFIED_NAME
        ]
    );
    assert_eq!(
        typed,
        [
            SOURCE_FILE,
            METADATA_KEYWORD_USAGE,
            NAME,
            FEATURE_TYPING,
            QUALIFIED_NAME,
            QUALIFIED_NAME
        ]
    );
}

#[test]
fn metadata_about_without_target_is_an_error() {
    // Arrange（異常系: about の後に相手が無い）
    let text = "metadata Safety about ;";
    // Act
    let es = errors(text);
    // Assert
    assert_eq!(es, [(22, "関係の相手の名前がありません".to_owned())]);
}

#[test]
fn prefix_metadata_followed_by_def_is_an_extended_definition() {
    // Arrange（ExtendedDefinition、8.2.2.27。境界値: abstract と 2 つの #）
    let one = node_kinds("#X def H;");
    let two = node_kinds("abstract #X #Y def H :> B;");
    // Act / Assert
    assert_eq!(
        one,
        [
            SOURCE_FILE,
            EXTENDED_DEFINITION,
            PREFIX_METADATA,
            QUALIFIED_NAME,
            NAME
        ]
    );
    assert_eq!(two[1], EXTENDED_DEFINITION);
    assert!(two.contains(&SUBCLASSIFICATION), "{two:?}");
}

#[test]
fn not_satisfy_and_event_reference_are_read() {
    // Arrange（SatisfyRequirementUsage の isNegated・EventOccurrenceUsage の参照の形）
    let not_satisfy = node_kinds("not satisfy R by A;");
    let event = node_kinds("event e;");
    // Act / Assert
    assert_eq!(not_satisfy[1], SATISFY_REQUIREMENT_USAGE);
    assert_eq!(event, [SOURCE_FILE, OCCURRENCE_USAGE, QUALIFIED_NAME]);
}

#[test]
fn variant_is_a_prefix() {
    // Arrange（VariantUsageMember、8.2.2.6）
    let usage = node_kinds("variant part a : A;");
    let reference = node_kinds("variant b;");
    // Act / Assert
    assert_eq!(usage[1], PART_USAGE);
    assert_eq!(reference, [SOURCE_FILE, REFERENCE_USAGE, NAME]);
}

#[test]
fn dependency_reads_its_name_only_before_from() {
    // Arrange（DependencyDeclaration、8.2.2.3：名前は `from` の前だけ）
    let named = node_kinds("dependency d from A, b.c to C;");
    let unnamed = node_kinds("dependency A, B to C, D;");
    // Act / Assert
    assert_eq!(
        named,
        [
            SOURCE_FILE,
            DEPENDENCY,
            NAME,
            QUALIFIED_NAME,
            FEATURE_CHAIN,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            QUALIFIED_NAME
        ]
    );
    assert_eq!(
        unnamed,
        [
            SOURCE_FILE,
            DEPENDENCY,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            QUALIFIED_NAME
        ]
    );
}

#[test]
fn dependency_with_short_name_and_body_is_read() {
    // Arrange（境界値：短い名前と、名前の無い from）
    let short = node_kinds("dependency <D1> d from A to B { }");
    let bare_from = node_kinds("dependency from A to B;");
    // Act / Assert
    assert_eq!(
        short,
        [
            SOURCE_FILE,
            DEPENDENCY,
            SHORT_NAME,
            NAME,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            BODY
        ]
    );
    assert_eq!(
        bare_from,
        [SOURCE_FILE, DEPENDENCY, QUALIFIED_NAME, QUALIFIED_NAME]
    );
    assert!(errors("dependency <D1> d from A to B { }").is_empty());
}

#[test]
fn dependency_without_to_or_ends_is_an_error() {
    // Arrange（異常系：to が無い・相手の名前が無い）
    let no_to = errors("dependency from A;");
    let no_client = errors("dependency to B;");
    // Act / Assert
    assert_eq!(no_to, [(17, "「to」がありません".to_owned())]);
    assert_eq!(no_client, [(11, "関係の相手の名前がありません".to_owned())]);
}

#[test]
fn connect_reads_binary_and_nary_connector_ends() {
    // Arrange（同値分割：2 項（BinaryConnectorPart）・n 項（NaryConnectorPart）、8.2.2.13.1）
    let binary = node_kinds("connection c : C connect a.p to b;");
    let nary = node_kinds("connect (a.p, b, c.r);");
    // Act / Assert
    assert_eq!(
        binary,
        [
            SOURCE_FILE,
            CONNECTION_USAGE,
            NAME,
            FEATURE_TYPING,
            QUALIFIED_NAME,
            CONNECTOR_END,
            FEATURE_CHAIN,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME
        ]
    );
    assert_eq!(
        nary,
        [
            SOURCE_FILE,
            CONNECTION_USAGE,
            CONNECTOR_END,
            FEATURE_CHAIN,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME,
            CONNECTOR_END,
            FEATURE_CHAIN,
            QUALIFIED_NAME,
            QUALIFIED_NAME
        ]
    );
    assert!(errors("connect (a.p, b, c.r);").is_empty());
}

#[test]
fn connector_end_may_have_multiplicity_and_a_name() {
    // Arrange（境界値：ConnectorEnd の多重度と `名前 ::>`・`名前 references`）
    let kinds = node_kinds("connect [1] e ::> a to [*] f references b;");
    // Act / Assert
    assert_eq!(
        kinds,
        [
            SOURCE_FILE,
            CONNECTION_USAGE,
            CONNECTOR_END,
            MULTIPLICITY,
            NAME,
            QUALIFIED_NAME,
            CONNECTOR_END,
            MULTIPLICITY,
            NAME,
            QUALIFIED_NAME
        ]
    );
    assert!(errors("connect [1] e ::> a to [*] f references b;").is_empty());
}

#[test]
fn bind_reads_both_ends_instead_of_a_value() {
    // Arrange（BindingConnectorAsUsage、8.2.2.13.2：`=` の右は値ではなく端）
    let bare = node_kinds("bind a.x = b;");
    let named = node_kinds("binding bb bind a = b;");
    // Act / Assert
    assert_eq!(
        bare,
        [
            SOURCE_FILE,
            BINDING_CONNECTOR_AS_USAGE,
            CONNECTOR_END,
            FEATURE_CHAIN,
            QUALIFIED_NAME,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME
        ]
    );
    assert_eq!(
        named,
        [
            SOURCE_FILE,
            BINDING_CONNECTOR_AS_USAGE,
            NAME,
            CONNECTOR_END,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME
        ]
    );
}

#[test]
fn allocate_after_a_line_break_continues_the_allocation() {
    // Arrange（AllocationUsageDeclaration、8.2.2.15：`allocate` は新しい文の頭にもなる語）
    let text = "allocation a : A\n    allocate x to y;\nallocate z to w;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(
        kinds,
        [
            SOURCE_FILE,
            ALLOCATION_USAGE,
            NAME,
            FEATURE_TYPING,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME,
            ALLOCATION_USAGE,
            CONNECTOR_END,
            QUALIFIED_NAME,
            CONNECTOR_END,
            QUALIFIED_NAME
        ]
    );
    assert!(errors(text).is_empty());
}

#[test]
fn connector_without_its_separator_or_end_is_an_error() {
    // Arrange（異常系：to・=・閉じ括弧・端の名前が無い）
    let no_to = errors("connect a;");
    let no_eq = errors("bind a;");
    let unclosed = errors("connect (a, b;");
    let no_end = errors("connect a to ;");
    // Act / Assert
    assert_eq!(no_to, [(9, "「to」がありません".to_owned())]);
    assert_eq!(no_eq, [(6, "「=」がありません".to_owned())]);
    assert_eq!(unclosed, [(13, "「)」がありません".to_owned())]);
    assert_eq!(no_end, [(13, "関係の相手の名前がありません".to_owned())]);
}

#[test]
#[ignore = "調査用"]
fn dump() {
    let path = std::env::var("DUMP").unwrap_or_default();
    let text = std::fs::read_to_string(path).unwrap_or_default();
    println!("{}", parse(&text).debug_tree());
}

#[test]
fn individual_without_kind_keyword_is_an_occurrence() {
    // Arrange（IndividualDefinition・IndividualUsage、8.2.2.9。比較: 種類のキーワードのある形）
    let texts = [
        "individual def Earth;",
        "individual earth : Earth;",
        "individual part def Car;",
    ];
    // Act
    let kinds: Vec<Vec<SyntaxKind>> = texts.iter().map(|t| node_kinds(t)).collect();
    // Assert
    assert_eq!(
        kinds,
        [
            vec![SOURCE_FILE, OCCURRENCE_DEFINITION, NAME],
            vec![
                SOURCE_FILE,
                OCCURRENCE_USAGE,
                NAME,
                FEATURE_TYPING,
                QUALIFIED_NAME
            ],
            vec![SOURCE_FILE, PART_DEFINITION, NAME],
        ]
    );
    assert!(texts.iter().all(|t| errors(t).is_empty()));
}

// ---- alpha.9 で読むようにした形（アクションの流れ、8.2.2.14・8.2.2.17） ----

#[test]
fn successions_read_both_ends() {
    // Arrange（同値分割：first … then（SuccessionAsUsage）・名前付きの succession・then だけ（TargetSuccessionMember）・
    // 境界値：then の無い first（InitialNodeMember））
    let texts = [
        "first a then b;",
        "succession s first a then b;",
        "then b;",
        "first start;",
    ];
    // Act
    let kinds: Vec<Vec<SyntaxKind>> = texts.iter().map(|t| node_kinds(t)).collect();
    // Assert
    assert_eq!(
        kinds,
        [
            vec![
                SOURCE_FILE,
                SUCCESSION_AS_USAGE,
                CONNECTOR_END,
                QUALIFIED_NAME,
                CONNECTOR_END,
                QUALIFIED_NAME
            ],
            vec![
                SOURCE_FILE,
                SUCCESSION_AS_USAGE,
                NAME,
                CONNECTOR_END,
                QUALIFIED_NAME,
                CONNECTOR_END,
                QUALIFIED_NAME
            ],
            vec![
                SOURCE_FILE,
                SUCCESSION_AS_USAGE,
                CONNECTOR_END,
                QUALIFIED_NAME
            ],
            vec![
                SOURCE_FILE,
                SUCCESSION_AS_USAGE,
                CONNECTOR_END,
                QUALIFIED_NAME
            ],
        ]
    );
    assert!(texts.iter().all(|t| errors(t).is_empty()));
}

#[test]
fn guarded_successions_keep_the_guard_expression() {
    // Arrange（GuardedSuccession・GuardedTargetSuccession・DefaultTargetSuccession、8.2.2.17）
    let text = "first d if x > 0 and y then a; if x <= 0 then b; else c;";
    // Act
    let p = parse(text);
    // Assert
    let guards: Vec<String> = p
        .syntax()
        .descendants()
        .filter(|n| n.kind() == GUARD_EXPRESSION)
        .map(|n| n.text().to_string())
        .collect();
    assert_eq!(guards, ["if x > 0 and y", "if x <= 0"]);
    assert_eq!(
        node_kinds(text)
            .iter()
            .filter(|k| **k == SUCCESSION_AS_USAGE)
            .count(),
        3
    );
    assert!(p.errors().is_empty());
}

#[test]
fn guarded_succession_tree() {
    // ガードの式は then の手前まで（括弧の中は式として読む）
    check(
        "first d if f(x) then a;",
        expect![[r#"
            SOURCE_FILE@0..23
              SUCCESSION_AS_USAGE@0..23
                KEYWORD@0..5 "first"
                WHITESPACE@5..6 " "
                CONNECTOR_END@6..7
                  QUALIFIED_NAME@6..7
                    IDENT@6..7 "d"
                WHITESPACE@7..8 " "
                GUARD_EXPRESSION@8..15
                  KEYWORD@8..10 "if"
                  WHITESPACE@10..11 " "
                  EXPRESSION@11..15
                    IDENT@11..12 "f"
                    L_PAREN@12..13 "("
                    IDENT@13..14 "x"
                    R_PAREN@14..15 ")"
                WHITESPACE@15..16 " "
                KEYWORD@16..20 "then"
                WHITESPACE@20..21 " "
                CONNECTOR_END@21..22
                  QUALIFIED_NAME@21..22
                    IDENT@21..22 "a"
                SEMI@22..23 ";"
        "#]],
    );
}

#[test]
fn succession_flow_is_one_kind_of_two_words() {
    // Arrange（SuccessionFlowUsage、8.2.2.16）
    let text = "succession flow f of T from a.x to b.y;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds[1], SUCCESSION_FLOW_USAGE);
    assert!(kinds.contains(&NAME));
    assert!(errors(text).is_empty());
}

#[test]
fn succession_without_first_or_guard_is_an_error() {
    // Arrange（異常系：first が無い・ガードの式が無い）
    let no_first = errors("succession s : S;");
    let no_guard = errors("first a if then b;");
    let bare_if = errors("if then b;");
    // Act / Assert
    assert_eq!(no_first, [(16, "「first」がありません".to_owned())]);
    assert_eq!(no_guard, [(11, "条件の式がありません".to_owned())]);
    assert_eq!(bare_if, [(3, "条件の式がありません".to_owned())]);
}

#[test]
fn if_without_then_is_kept_as_unsupported() {
    // Arrange（境界値：then の無い if は、継起ではない）
    let text = "if x;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds[1], UNSUPPORTED_MEMBER);
}

#[test]
fn control_nodes_are_named_usages() {
    // Arrange（同値分割：ForkNode・JoinNode・MergeNode・DecisionNode、8.2.2.17）
    let text = "fork f; join j; merge m; decide d { doc /* x */ }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(
        kinds,
        [
            SOURCE_FILE,
            FORK_NODE,
            NAME,
            JOIN_NODE,
            NAME,
            MERGE_NODE,
            NAME,
            DECISION_NODE,
            NAME,
            BODY,
            DOCUMENTATION
        ]
    );
    assert!(errors(text).is_empty());
}

#[test]
fn send_accept_assign_and_terminate_read_their_parameters() {
    // Arrange（同値分割：SendNode（via・to）・AcceptNode（名前と型・型だけ・時間の経過・via）・AssignmentNode・TerminateNode、
    // 境界値：引数の無い terminate）
    let texts = [
        "send S(1) via p to b;",
        "accept e : E via p;",
        "accept Go;",
        "accept after 5 [s];",
        "assign a.x := x + 1;",
        "terminate;",
    ];
    // Act
    let kinds: Vec<Vec<SyntaxKind>> = texts.iter().map(|t| node_kinds(t)).collect();
    // Assert
    let params: Vec<usize> = kinds
        .iter()
        .map(|k| k.iter().filter(|x| **x == NODE_PARAMETER).count())
        .collect();
    let heads: Vec<SyntaxKind> = kinds.iter().map(|k| k[1]).collect();
    assert_eq!(
        heads,
        [
            SEND_NODE,
            ACCEPT_NODE,
            ACCEPT_NODE,
            ACCEPT_NODE,
            ASSIGNMENT_NODE,
            TERMINATE_NODE
        ]
    );
    assert_eq!(params, [3, 2, 1, 1, 2, 0]);
    assert!(texts.iter().all(|t| errors(t).is_empty()));
}

#[test]
fn accept_payload_tree() {
    // 受けるものの名前は、節の名前ではなく引数の中に置く
    check(
        "action a accept e : E;",
        expect![[r#"
        SOURCE_FILE@0..22
          ACCEPT_NODE@0..22
            KEYWORD@0..6 "action"
            WHITESPACE@6..7 " "
            NAME@7..8
              IDENT@7..8 "a"
            WHITESPACE@8..9 " "
            KEYWORD@9..15 "accept"
            WHITESPACE@15..16 " "
            NODE_PARAMETER@16..21
              NAME@16..17
                IDENT@16..17 "e"
              WHITESPACE@17..18 " "
              FEATURE_TYPING@18..21
                COLON@18..19 ":"
                WHITESPACE@19..20 " "
                QUALIFIED_NAME@20..21
                  IDENT@20..21 "E"
            SEMI@21..22 ";"
    "#]],
    );
}

#[test]
fn action_nodes_follow_then_and_a_named_action() {
    // Arrange（SourceSuccessionMember の後の節・ActionNodeUsageDeclaration、8.2.2.17）
    let texts = [
        "then fork f;",
        "then send x to y;",
        "action s send x;",
        "then action t terminate;",
    ];
    // Act
    let heads: Vec<SyntaxKind> = texts.iter().map(|t| node_kinds(t)[1]).collect();
    // Assert
    assert_eq!(heads, [FORK_NODE, SEND_NODE, SEND_NODE, TERMINATE_NODE]);
    assert!(texts.iter().all(|t| errors(t).is_empty()));
}

#[test]
fn accept_shorthand_transition_reads_its_target() {
    // Arrange（状態の中の省略形の遷移 `accept E then b;`、8.2.2.18。エラーにしない）
    let text = "state def S { state a; accept Go then b; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert!(kinds.contains(&ACCEPT_NODE));
    assert!(kinds.contains(&CONNECTOR_END));
    assert!(errors(text).is_empty());
}

#[test]
fn transition_reads_source_trigger_guard_effect_and_target() {
    check(
        "transition t first a accept E via p if x > 0 do beep then b;",
        expect![[r#"
            SOURCE_FILE@0..60
              TRANSITION_USAGE@0..60
                KEYWORD@0..10 "transition"
                WHITESPACE@10..11 " "
                NAME@11..12
                  IDENT@11..12 "t"
                WHITESPACE@12..13 " "
                KEYWORD@13..18 "first"
                WHITESPACE@18..19 " "
                CONNECTOR_END@19..20
                  QUALIFIED_NAME@19..20
                    IDENT@19..20 "a"
                WHITESPACE@20..21 " "
                TRIGGER_ACTION@21..35
                  KEYWORD@21..27 "accept"
                  WHITESPACE@27..28 " "
                  NODE_PARAMETER@28..29
                    QUALIFIED_NAME@28..29
                      IDENT@28..29 "E"
                  WHITESPACE@29..30 " "
                  KEYWORD@30..33 "via"
                  WHITESPACE@33..34 " "
                  NODE_PARAMETER@34..35
                    EXPRESSION@34..35
                      IDENT@34..35 "p"
                WHITESPACE@35..36 " "
                GUARD_EXPRESSION@36..44
                  KEYWORD@36..38 "if"
                  WHITESPACE@38..39 " "
                  EXPRESSION@39..44
                    IDENT@39..40 "x"
                    WHITESPACE@40..41 " "
                    GT@41..42 ">"
                    WHITESPACE@42..43 " "
                    NUMBER@43..44 "0"
                WHITESPACE@44..45 " "
                EFFECT_BEHAVIOR@45..52
                  KEYWORD@45..47 "do"
                  WHITESPACE@47..48 " "
                  EXPRESSION@48..52
                    IDENT@48..52 "beep"
                WHITESPACE@52..53 " "
                KEYWORD@53..57 "then"
                WHITESPACE@57..58 " "
                CONNECTOR_END@58..59
                  QUALIFIED_NAME@58..59
                    IDENT@58..59 "b"
                SEMI@59..60 ";"
        "#]],
    );
}

#[test]
fn transition_without_first_is_a_target_transition() {
    // Arrange（TargetTransitionUsage、8.2.2.18：元は直前の状態）
    let text = "state def S { state a; transition accept E then b; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert!(kinds.contains(&TRIGGER_ACTION));
    assert_eq!(kinds.iter().filter(|k| **k == CONNECTOR_END).count(), 1);
    assert!(errors(text).is_empty());
}

#[test]
fn transition_trigger_expression_stops_before_then() {
    // Arrange（境界値：after の時間の式は、then の手前で止まる）
    let text = "transition first a accept after 5 [s] then b;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds.iter().filter(|k| **k == CONNECTOR_END).count(), 2);
    assert!(errors(text).is_empty());
}

#[test]
fn transition_effect_may_have_a_body() {
    // Arrange（EffectBehaviorUsage の TransitionPerformActionUsage、8.2.2.18）
    let text = "transition first a do action e { action x; } then b;";
    // Act
    let tree = parse(text);
    // Assert
    let effect = tree
        .syntax()
        .descendants()
        .find(|n| n.kind() == EFFECT_BEHAVIOR);
    assert!(effect.is_some_and(|e| e.children().any(|c| c.kind() == BODY)));
    assert!(tree.errors().is_empty());
}

#[test]
fn transition_without_then_is_an_error() {
    // Arrange（異常系：行き先が無い）
    let text = "transition t first a;";
    // Act
    let errs = errors(text);
    // Assert
    assert_eq!(errs, [(20, "「then」がありません".to_owned())]);
}

#[test]
fn shorthand_transitions_read_their_guard_and_effect() {
    // Arrange（状態の中の省略形の遷移、8.2.2.18：accept … if … do … then・if … do … then）
    let text = "state def S { state a; accept E via p if g do beep then b; if x do send S() to y then c; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert!(kinds.contains(&ACCEPT_NODE));
    assert_eq!(kinds.iter().filter(|k| **k == GUARD_EXPRESSION).count(), 2);
    assert_eq!(kinds.iter().filter(|k| **k == EFFECT_BEHAVIOR).count(), 2);
    assert_eq!(kinds.iter().filter(|k| **k == CONNECTOR_END).count(), 2);
    assert!(errors(text).is_empty());
}

#[test]
fn parallel_state_reads_its_substates() {
    // Arrange（StateDefBody の isParallel、8.2.2.18）
    let text = "state def S parallel { state a; state b; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds.iter().filter(|k| **k == STATE_USAGE).count(), 2);
    assert!(errors(text).is_empty());
}

#[test]
fn action_node_without_its_parameter_is_an_error() {
    // Arrange（異常系：受けるもの・送る先・:= が無い）
    let no_payload = errors("accept;");
    let no_target = errors("send x to;");
    let no_assign = errors("assign a 1;");
    // Act / Assert
    assert_eq!(no_payload, [(6, "受けるものがありません".to_owned())]);
    assert_eq!(no_target, [(9, "値の式がありません".to_owned())]);
    assert_eq!(no_assign, [(8, "「:=」がありません".to_owned())]);
}

#[test]
fn action_node_keyword_after_a_line_break_starts_a_new_statement() {
    // Arrange（「;」の書き忘れ：改行の後の fork は新しい文の頭）
    let text = "action a\nfork f;";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(kinds, [SOURCE_FILE, ACTION_USAGE, NAME, FORK_NODE, NAME]);
    assert_eq!(errors(text), [(8, "「;」がありません".to_owned())]);
}

#[test]
fn if_node_reads_both_branches_and_else_if() {
    // Arrange（IfNode、8.2.2.17：else の本体と、else if の中の IfNode）
    let text = "if x > 0 { action a; } else if y { action b; } else { action c; }";
    // Act
    let kinds = node_kinds(text);
    // Assert
    assert_eq!(
        kinds,
        [
            SOURCE_FILE,
            IF_NODE,
            EXPRESSION,
            BODY,
            ACTION_USAGE,
            NAME,
            IF_NODE,
            EXPRESSION,
            BODY,
            ACTION_USAGE,
            NAME,
            BODY,
            ACTION_USAGE,
            NAME
        ]
    );
    assert!(errors(text).is_empty());
}

#[test]
fn loops_read_their_condition_variable_and_body() {
    // Arrange（同値分割：while … until・loop・for、名前付きの action w while、8.2.2.17）
    let texts = [
        "while i < 3 { action a; } until done;",
        "loop { action a; }",
        "for x : T in xs { action a; }",
        "action w while c { }",
    ];
    // Act
    let heads: Vec<SyntaxKind> = texts.iter().map(|t| node_kinds(t)[1]).collect();
    // Assert
    assert_eq!(
        heads,
        [
            WHILE_LOOP_NODE,
            WHILE_LOOP_NODE,
            FOR_LOOP_NODE,
            WHILE_LOOP_NODE
        ]
    );
    assert!(node_kinds(texts[2]).contains(&NODE_PARAMETER));
    assert!(texts.iter().all(|t| errors(t).is_empty()));
}

#[test]
fn loop_without_its_body_or_in_is_an_error() {
    // Arrange（異常系：本体が無い・for の in が無い）
    let no_body = errors("while x; part p;");
    let no_in = errors("for x xs { }");
    // Act / Assert
    assert_eq!(no_body, [(7, "「{」がありません".to_owned())]);
    assert_eq!(no_in, [(6, "「in」がありません".to_owned())]);
    assert_eq!(
        node_kinds("while x; part p;"),
        [SOURCE_FILE, WHILE_LOOP_NODE, EXPRESSION, PART_USAGE, NAME]
    );
}
