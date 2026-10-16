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
        [(at.unwrap_or_default(), "@layout コメントが読み取れません")]
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
