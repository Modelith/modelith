//! 投影の単体テスト。暫定コアとの一致そのものは、web の golden.test.ts・spec.test.ts が TS と Rust の両方で確かめる（ADR-0015）。
//! ここでは、番号での参照・UTF-16 の位置・書いた順など、投影に固有の約束を確かめる。

use super::*;
use crate::syntax::parse;

fn run(text: &str) -> ParseResult {
    project(text, &parse(text))
}

fn entry<'a>(r: &'a ParseResult, name: &str) -> &'a Entry {
    r.entries
        .iter()
        .find(|e| e.name == name)
        .unwrap_or_else(|| panic!("{name} がありません"))
}

#[test]
fn positions_are_utf16_offsets() {
    // Arrange（境界値: 前に 3 バイトの文字と、4 バイト（UTF-16 で 2 単位）の文字がある）
    let text = "/* 日本 😀 */ part def A;";
    // Act
    let r = run(text);
    // Assert
    let a = entry(&r, "A");
    let expected = text
        .split("part")
        .next()
        .map_or(0, |s| s.encode_utf16().count());
    assert_eq!(a.start, expected);
    assert_eq!(a.head_end, expected + "part def A".len());
}

#[test]
fn children_and_parents_are_linked_by_index() {
    // Arrange
    let text = "package P { part def A { part b : B; } }";
    // Act
    let r = run(text);
    // Assert
    let (p, a, b) = (entry(&r, "P"), entry(&r, "A"), entry(&r, "b"));
    assert_eq!(p.children, vec![a.idx]);
    assert_eq!(a.children, vec![b.idx]);
    assert_eq!(b.pe, Some(a.idx));
    assert_eq!(b.owner, Some(Scope::Entry(a.idx)));
    assert_eq!(b.ty, "B");
}

#[test]
fn block_end_is_after_closing_brace_and_unclosed_block_keeps_head_end() {
    // Arrange（正常系と異常系）
    let closed = run("part def A { }");
    let open = run("part def A {");
    // Act
    let (c, o) = (entry(&closed, "A"), entry(&open, "A"));
    // Assert
    assert_eq!((c.open, c.close, c.end), (Some(11), Some(13), 14));
    assert_eq!((o.open, o.close, o.end), (Some(11), None, 12));
}

#[test]
fn anonymous_block_owns_its_members_and_names_expressions() {
    // Arrange
    let text = "requirement def R { require constraint { a <= b } }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(r.blocks.len(), 1);
    assert_eq!(r.blocks[0].kw, "require");
    assert_eq!(
        entry(&r, "R").exprs,
        vec![Expr {
            text: "a <= b".to_owned(),
            via: "require".to_owned()
        }]
    );
}

#[test]
fn metadata_keeps_written_order_and_phase_value_position() {
    // Arrange
    let text = "package P { metadata def M; metadata def N; #N #M part def A { @Phase { stage = K::Design; } } }";
    // Act
    let r = run(text);
    // Assert
    let a = entry(&r, "A");
    let names: Vec<_> = a
        .meta
        .as_ref()
        .map(|m| m.0.iter().map(|(k, _)| k.as_str()).collect())
        .unwrap_or_default();
    assert_eq!(names, vec!["N", "M", "Phase"]);
    let at = text.find("K::Design").unwrap_or_default();
    assert_eq!(
        a.phase_val,
        Some(Span {
            start: at,
            end: at + "K::Design".len()
        })
    );
}

#[test]
fn modifier_with_typed_name_is_a_parameter() {
    // Arrange（同値クラス: 修飾あり・なし）
    let r = run("constraint def C { in x : Real; y : Real; }");
    // Act
    let x = entry(&r, "x");
    // Assert
    assert_eq!(
        (x.kind.as_str(), x.dir.as_deref(), x.ty.as_str()),
        ("param", Some("in"), "Real")
    );
    assert!(r.entries.iter().all(|e| e.name != "y"));
}

#[test]
fn relations_read_their_ends_from_the_tree() {
    // Arrange
    let text = "package P { part def A { interface i : I connect a.p to b.q; } satisfy R by A; verify R; }";
    // Act
    let r = run(text);
    // Assert
    let kinds: Vec<_> = r.rels.iter().map(|x| x.kind.clone()).collect();
    let i = entry(&r, "i").idx;
    assert_eq!(
        kinds,
        vec![
            RelKind::Connect {
                a: "a.p".to_owned(),
                b: "b.q".to_owned(),
                item: "I".to_owned(),
                usage: i
            },
            RelKind::Satisfy {
                req: "R".to_owned(),
                by: "A".to_owned()
            },
            RelKind::Verify {
                req: "R".to_owned()
            },
        ]
    );
}

#[test]
fn unknown_keyword_statement_is_unsupported_and_trailing_statement_is_ignored() {
    // Arrange（異常系: 末尾の「;」の無い文は、暫定コアと同じく読まない）
    let text = "package P { case def C; }\npart def Tail";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        r.unsupported
            .iter()
            .map(|u| u.head.as_str())
            .collect::<Vec<_>>(),
        vec!["case def C"]
    );
    assert!(r.entries.iter().all(|e| e.name != "Tail"));
    assert_eq!(r.errors.len(), 1);
}

#[test]
fn broken_layout_comment_is_an_error_at_its_utf16_position() {
    // Arrange（異常系：JSON として読めない。前に多バイト文字を置く）
    let text = "// 日本語\n/* note */ /* @layout {\"A\": */\npart def A;";
    // Act
    let r = run(text);
    // Assert
    let at = text
        .find("/* @layout")
        .map(|b| text[..b].encode_utf16().count());
    assert_eq!(
        r.errors
            .iter()
            .map(|e| (e.pos, e.msg.as_str()))
            .collect::<Vec<_>>(),
        [(at.unwrap_or_default(), "@layout コメントを読み込めません")]
    );
}

#[test]
fn readable_or_missing_layout_comment_is_not_an_error() {
    // 同値分割：読める・閉じていない・無い
    for text in [
        "/* @layout {\"A\":{\"x\":1}} */ part def A;",
        "/* @layout {",
        "part def A;",
    ] {
        // Act
        let r = run(text);
        // Assert
        assert!(
            r.errors.iter().all(|e| !e.msg.contains("@layout")),
            "{text}"
        );
    }
}

// ---- 取り違えの修正（F-EDIT-8、alpha.7） ----

#[test]
fn textual_representation_is_dropped_without_hiding_the_next_declaration() {
    // Arrange（TextualRepresentation、8.2.2.4：package の直下と、定義の本体の中）
    let text = "package P { rep r language \"x\" /* a */ part def B;\n part def A { rep language \"y\" /* b */\n part c; } }";
    // Act
    let r = run(text);
    // Assert
    let (p, a) = (entry(&r, "P"), entry(&r, "A"));
    assert_eq!(entry(&r, "B").pe, Some(p.idx));
    assert_eq!(entry(&r, "c").pe, Some(a.idx));
    assert!(r.errors.is_empty());
    assert!(r.unsupported.is_empty());
}

#[test]
fn assert_not_and_assume_constraint_put_their_expressions_on_the_owner() {
    // Arrange（AssertConstraintUsage・RequirementConstraintMember、8.2.2.20〜21）
    let text = "part def A { assert not constraint d { x < 0 } assume constraint { y < 1 } }";
    // Act
    let r = run(text);
    // Assert
    let via: Vec<(&str, &str)> = entry(&r, "A")
        .exprs
        .iter()
        .map(|x| (x.text.as_str(), x.via.as_str()))
        .collect();
    assert_eq!(via, [("x < 0", "assert"), ("y < 1", "assume")]);
    assert!(r.errors.is_empty());
}

#[test]
fn body_of_an_unsupported_statement_is_not_read_into_the_owner() {
    // Arrange（同値分割：まだ扱えない定義・使用・メタデータ・列挙の使用・variant）
    for text in [
        "package P { case def CS { part x; } }",
        "package P { allocation def AD { part x; } }",
        "package P { viewpoint vp { part x; } }",
        "package P { rendering def R { part x; } }",
        "package P { flow def F { part x; } }",
        "package P { metadata M about A { part x; } }",
        "package P { part def H { enum e : E { part x; } } }",
        "package P { part def H { variant part v : V { part x; } } }",
    ] {
        // Act
        let r = run(text);
        // Assert
        assert!(r.entries.iter().all(|e| e.name != "x"), "{text}");
        assert_eq!(r.unsupported.len(), 1, "{text}");
        assert!(r.blocks.is_empty(), "{text}");
    }
}

#[test]
fn body_of_a_supported_anonymous_block_is_still_read() {
    // Arrange（正常系：objective と @メタデータの本体は、これまでどおり読む）
    let text = "requirement def R; verification def V { objective { verify R; } @Phase { stage = K::a; } }";
    // Act
    let r = run(text);
    // Assert
    let kws: Vec<&str> = r.blocks.iter().map(|b| b.kw.as_str()).collect();
    assert_eq!(kws, ["objective", "@Phase"]);
    assert_eq!(r.rels.len(), 1);
    assert!(entry(&r, "V").meta.is_some());
}

#[test]
fn qualified_type_keeps_its_path() {
    // Arrange（QualifiedName、8.2.2.1〜2：引用名の段も外して残す）
    let text = "part def H { part a : Q::'A b'; part c : C; }";
    // Act
    let r = run(text);
    // Assert
    let (a, c) = (entry(&r, "a"), entry(&r, "c"));
    assert_eq!((a.ty.as_str(), a.ty_path.as_str()), ("A b", "Q::A b"));
    assert_eq!((c.ty.as_str(), c.ty_path.as_str()), ("C", "C"));
}

#[test]
fn alias_is_recorded_with_its_owner_and_qualified_target() {
    // Arrange（AliasMember、8.2.2.5）
    let text = "package P { alias B for Q::A; alias <s> C for D; alias E; }";
    // Act
    let r = run(text);
    // Assert（指す先の無い alias E は記録しない）
    let p = entry(&r, "P").idx;
    assert_eq!(
        r.aliases,
        vec![
            Alias {
                name: "B".to_owned(),
                target: "Q::A".to_owned(),
                pe: Some(p),
            },
            Alias {
                name: "C".to_owned(),
                target: "D".to_owned(),
                pe: Some(p),
            },
        ]
    );
    assert!(r.unsupported.is_empty());
}
