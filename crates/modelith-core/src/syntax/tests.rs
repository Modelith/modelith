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
fn statement_without_grammar_is_kept_as_unsupported() {
    // Arrange（F-EDIT-8：黙って捨てない）
    let text = "action def A { send x via p; }";
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
#[ignore = "調査用"]
fn dump() {
    let path = std::env::var("DUMP").unwrap_or_default();
    let text = std::fs::read_to_string(path).unwrap_or_default();
    println!("{}", parse(&text).debug_tree());
}
