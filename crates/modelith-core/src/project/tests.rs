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
                usage: i,
                ends: vec!["a.p".to_owned(), "b.q".to_owned()],
            },
            RelKind::Satisfy {
                req: "R".to_owned(),
                by: "A".to_owned(),
                negated: false
            },
            RelKind::Verify {
                req: "R".to_owned()
            },
        ]
    );
}

/// 関係のうち、接続（`Connect`）の端と、接続の使用の番号。
fn connections(r: &ParseResult) -> Vec<(Vec<&str>, usize)> {
    r.rels
        .iter()
        .filter_map(|x| match &x.kind {
            RelKind::Connect { ends, usage, .. } => {
                Some((ends.iter().map(String::as_str).collect(), *usage))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn standalone_connect_is_an_anonymous_connection() {
    // Arrange（`connection` の無い `connect a to b;`、8.2.2.13.1）
    let text = "part def H { part a; part b; connect a.p to b.q; }";
    // Act
    let r = run(text);
    // Assert
    let c = r
        .entries
        .iter()
        .find(|e| e.kind == "connection")
        .expect("名前の無い接続");
    assert_eq!(
        (c.name.as_str(), c.head.as_str()),
        ("", "connect a.p to b.q")
    );
    assert_eq!(c.pe, Some(entry(&r, "H").idx));
    assert_eq!(connections(&r), [(vec!["a.p", "b.q"], c.idx)]);
    assert!(r.unsupported.is_empty());
}

#[test]
fn nary_connection_keeps_every_end() {
    // Arrange（NaryConnectorPart、8.2.2.13.1。境界値：端が 3 つ）
    let text = "part def H { connection c : C connect (a.p, b, [1] e ::> c.r); connect (x, y); }";
    // Act
    let r = run(text);
    // Assert
    let c = entry(&r, "c").idx;
    let found = connections(&r);
    assert_eq!(found[0], (vec!["a.p", "b", "c.r"], c));
    assert_eq!(found[1].0, ["x", "y"]);
    assert!(matches!(&r.rels[0].kind, RelKind::Connect { a, b, .. } if a == "a.p" && b == "b"));
}

#[test]
fn connection_without_two_ends_has_no_relation() {
    // Arrange（異常系：端が 1 つしかない）
    let text = "part def H { connection c connect (a); }";
    // Act
    let r = run(text);
    // Assert
    assert!(connections(&r).is_empty());
    assert_eq!(entry(&r, "c").kind, "connection");
}

#[test]
fn bind_is_a_binding_usage_and_not_an_expression_of_its_owner() {
    // Arrange（同値分割：名前の無い `bind`・名前付きの `binding`、8.2.2.13.2）
    let text = "part def H { part a; part b; bind a.x = b.y; binding bb bind a.z = b.w; }";
    // Act
    let r = run(text);
    // Assert
    let h = entry(&r, "H");
    assert!(h.exprs.is_empty(), "{:?}", h.exprs);
    let bindings: Vec<(&str, usize)> = r
        .entries
        .iter()
        .filter(|e| e.kind == "binding")
        .map(|e| (e.name.as_str(), e.idx))
        .collect();
    assert_eq!(bindings.iter().map(|b| b.0).collect::<Vec<_>>(), ["", "bb"]);
    let rels: Vec<RelKind> = r.rels.iter().map(|x| x.kind.clone()).collect();
    assert_eq!(
        rels,
        [
            RelKind::Bind {
                a: "a.x".to_owned(),
                b: "b.y".to_owned(),
                usage: bindings[0].1
            },
            RelKind::Bind {
                a: "a.z".to_owned(),
                b: "b.w".to_owned(),
                usage: bindings[1].1
            },
        ]
    );
}

#[test]
fn binding_without_its_second_end_has_no_relation() {
    // Arrange（異常系：`=` の右が無い）
    let text = "part def H { bind a.x; }";
    // Act
    let r = run(text);
    // Assert
    assert!(r.rels.is_empty());
    assert_eq!(r.errors.len(), 1);
}

#[test]
fn allocation_definitions_and_usages_are_entries_with_their_bodies() {
    // Arrange（AllocationDefinition・AllocationUsage、8.2.2.15。本体は読む）
    let text = "package P { allocation def AD { end f : F; } allocation a : AD allocate s.f to h.c { doc /* d */ } }";
    // Act
    let r = run(text);
    // Assert
    let (ad, a) = (entry(&r, "AD"), entry(&r, "a"));
    assert_eq!((ad.kind.as_str(), ad.is_def), ("allocation def", true));
    assert_eq!(entry(&r, "f").pe, Some(ad.idx));
    assert_eq!((a.kind.as_str(), a.ty.as_str()), ("allocation", "AD"));
    assert_eq!(a.doc.as_deref(), Some("d"));
    assert_eq!(
        r.rels.iter().map(|x| x.kind.clone()).collect::<Vec<_>>(),
        [RelKind::Allocate {
            a: "s.f".to_owned(),
            b: "h.c".to_owned(),
            usage: a.idx
        }]
    );
    assert!(r.unsupported.is_empty());
}

#[test]
fn standalone_allocate_is_an_anonymous_allocation() {
    // Arrange（`allocation` の無い `allocate x to y;`。同値分割：2 項・n 項）
    let text = "package P { allocate x to y; allocate (x, y, z); }";
    // Act
    let r = run(text);
    // Assert
    let anonymous: Vec<&str> = r
        .entries
        .iter()
        .filter(|e| e.kind == "allocation")
        .map(|e| e.name.as_str())
        .collect();
    assert_eq!(anonymous, ["", ""]);
    // n 項の割り当ては、まだ関係にしない
    assert_eq!(r.rels.len(), 1);
    assert!(matches!(&r.rels[0].kind, RelKind::Allocate { a, b, .. } if a == "x" && b == "y"));
}

#[test]
fn flow_definitions_and_named_flows_are_entries() {
    // Arrange（FlowDefinition・FlowUsage、8.2.2.16。同値分割：型付き・of 付き・名前の無いフロー）
    let text = "part def H { flow def FD { end x : W; } flow f : FD from a.o to b.i; \
                flow g of Water from a.o to b.i { } flow of Heat from a.o to b.i; }";
    // Act
    let r = run(text);
    // Assert
    let (fd, f, g) = (entry(&r, "FD"), entry(&r, "f"), entry(&r, "g"));
    assert_eq!((fd.kind.as_str(), fd.is_def), ("flow def", true));
    assert_eq!(entry(&r, "x").pe, Some(fd.idx));
    assert_eq!((f.kind.as_str(), f.ty.as_str()), ("flow", "FD"));
    let flows: Vec<(&str, &str, &str, Option<usize>)> = r
        .rels
        .iter()
        .filter_map(|x| match &x.kind {
            RelKind::Flow {
                item,
                name,
                ty,
                usage,
                ..
            } => Some((item.as_str(), name.as_str(), ty.as_str(), *usage)),
            _ => None,
        })
        .collect();
    assert_eq!(
        flows,
        [
            ("", "f", "FD", Some(f.idx)),
            ("Water", "g", "", Some(g.idx)),
            ("Heat", "", "", None)
        ]
    );
    assert_eq!(r.entries.iter().filter(|e| e.kind == "flow").count(), 2);
    assert!(r.unsupported.is_empty());
}

#[test]
fn named_flow_without_ends_has_no_relation() {
    // Arrange（境界値：端の無いフローの宣言）
    let text = "flow def FD { } part def H { flow f : FD; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(entry(&r, "f").kind, "flow");
    assert!(r.rels.is_empty());
}

#[test]
fn unknown_keyword_statement_is_unsupported_and_trailing_statement_is_ignored() {
    // Arrange（異常系: 末尾の「;」の無い文は、暫定コアと同じく読まない）
    let text = "package P { until s; }\npart def Tail";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        r.unsupported
            .iter()
            .map(|u| u.head.as_str())
            .collect::<Vec<_>>(),
        vec!["until s"]
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
fn textual_representation_does_not_hide_the_next_declaration() {
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
    // Arrange（同値分割：まだ扱えない定義・使用）
    for text in [
        "package P { until u { part x; } }",
        "package P { after a { part x; } }",
        "package P { part def H { until u { part x; } } }",
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

// ---- alpha.7 で読むようにした形（SysML 2.1 Beta 2 の 8.2.2） ----

/// 宣言の (種類, 名前, 型, 修飾) を、書いた順に並べる。
fn decls(r: &ParseResult) -> Vec<(&str, &str, &str, &str)> {
    r.entries
        .iter()
        .map(|e| {
            (
                e.kind.as_str(),
                e.name.as_str(),
                e.ty.as_str(),
                e.mods.as_deref().unwrap_or(""),
            )
        })
        .collect()
}

#[test]
fn case_definition_and_usage_are_entries_whose_body_is_read() {
    // Arrange（CaseDefinition・CaseUsage、8.2.2.22。objective の中身はこれまでどおり持ち主へ）
    let text = "case def CS { subject v : V; actor a : A; objective { require constraint { t < 1 } } } case c : CS;";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        decls(&r),
        [
            ("case def", "CS", "", ""),
            ("subject", "v", "V", ""),
            ("actor", "a", "A", ""),
            ("case", "c", "CS", ""),
        ]
    );
    let cs = entry(&r, "CS");
    assert!(cs.is_def);
    assert_eq!(cs.children.len(), 2);
    assert_eq!(cs.exprs[0].text, "t < 1");
    assert!(r.unsupported.is_empty(), "{:?}", r.unsupported);
}

#[test]
fn include_use_case_is_an_entry_in_both_forms() {
    // Arrange（IncludeUseCaseUsage、8.2.2.25。同値クラス: 宣言の形・参照の形）
    let text = "use case def U { include use case uc : U2; include other; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        decls(&r)[1..],
        [
            ("include use case", "uc", "U2", ""),
            ("include use case", "other", "", ""),
        ]
    );
}

#[test]
fn enumeration_usage_is_an_entry_but_enum_values_stay_values() {
    // Arrange（EnumerationUsage・EnumeratedValue、8.2.2.7。境界値: enum def の中の enum）
    let text = "enum def E { enum a; } part def H { enum e : E; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(entry(&r, "E").enum_values, Some(vec!["a".to_owned()]));
    assert_eq!(entry(&r, "e").kind, "enum");
    assert_eq!(entry(&r, "e").ty, "E");
}

#[test]
fn event_occurrence_timeslice_and_snapshot_are_usages() {
    // Arrange（EventOccurrenceUsage・PortionUsage、8.2.2.9）
    let text = "occurrence def O { event occurrence eo : E; event other; timeslice t : T; \
                snapshot occurrence s; timeslice part p : P; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        decls(&r)[1..],
        [
            ("event occurrence", "eo", "E", ""),
            ("event occurrence", "other", "", ""),
            ("timeslice", "t", "T", "timeslice"),
            ("snapshot", "s", "", "snapshot"),
            ("part", "p", "P", "timeslice"),
        ]
    );
}

#[test]
fn typed_by_sets_the_type() {
    // Arrange（TYPED_BY、KerML 8.2.4。`: A` と同じ）
    let text = "part p typed by Q::A;";
    // Act
    let r = run(text);
    // Assert
    let p = entry(&r, "p");
    assert_eq!((p.ty.as_str(), p.ty_path.as_str()), ("A", "Q::A"));
}

#[test]
fn constant_and_variant_are_recorded_as_modifiers() {
    // Arrange（UsagePrefix の isConstant・VariantUsageMember・VariationDefinition、8.2.2.6）
    let text = "part def H { constant attribute k : Real = 1; } \
                variation part def V { variant part a : A; variant b; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        decls(&r),
        [
            ("part def", "H", "", ""),
            ("attribute", "k", "Real", "constant"),
            ("part def", "V", "", "variation"),
            ("part", "a", "A", "variant"),
            ("variant", "b", "", "variant"),
        ]
    );
    assert_eq!(entry(&r, "k").value.as_deref(), Some("1"));
    assert!(entry(&r, "H").exprs.is_empty());
}

#[test]
fn viewpoint_and_rendering_are_entries_distinct_from_view() {
    // Arrange（ViewpointDefinition・RenderingDefinition、8.2.2.26。境界値: view と viewpoint の語の違い）
    let text = "viewpoint def VP { frame concern c : C; } viewpoint vp : VP; view v : VP; \
                rendering def RD; rendering r : RD;";
    // Act
    let r = run(text);
    // Assert
    let kinds: Vec<&str> = r.entries.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(
        kinds,
        [
            "viewpoint def",
            "viewpoint",
            "view",
            "rendering def",
            "rendering"
        ]
    );
    assert!(matches!(&r.rels[0].kind, RelKind::Frame { ty, .. } if ty == "C"));
    assert_eq!(r.rels[0].pe, Some(entry(&r, "VP").idx));
}

#[test]
fn metadata_about_writes_fields_to_each_annotated_element() {
    // Arrange（MetadataUsage の about、8.2.2.27。修飾名と特徴の連鎖の相手）
    let text = "package P { package Q { part def A; } part def B { part c; } \
                metadata Safety about Q::A, B.c { level = 1 + 2; kind = K::High; } }";
    // Act
    let r = run(text);
    // Assert
    for name in ["A", "c"] {
        let meta = entry(&r, name).meta.clone().unwrap_or_default();
        assert_eq!(
            meta.0,
            [(
                "Safety".to_owned(),
                OrderedMap(vec![
                    ("level".to_owned(), "1 + 2".to_owned()),
                    ("kind".to_owned(), "High".to_owned()),
                ])
            )],
            "{name}"
        );
        assert_eq!(entry(&r, name).phase_val, None);
    }
    assert!(entry(&r, "P").meta.is_none());
    assert!(r.missing_about.is_empty());
}

#[test]
fn metadata_without_about_annotates_the_owner_even_without_body() {
    // Arrange（`metadata M;`・`@M;`・`@M { … }`。同値クラス: 本体なし・本体あり）
    let text = "part def A { metadata M; @N; @Phase { stage = K::a; } }";
    // Act
    let r = run(text);
    // Assert
    let a = entry(&r, "A");
    let keys: Vec<&str> = a
        .meta
        .iter()
        .flat_map(|m| m.0.iter().map(|(k, _)| k.as_str()))
        .collect();
    assert_eq!(keys, ["M", "N", "Phase"]);
    assert!(a.phase_val.is_some());
}

#[test]
fn metadata_about_missing_target_is_recorded() {
    // Arrange（異常系: 相手が無い）
    let text = "package P { part def A; metadata M about A, Nope; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        r.missing_about
            .iter()
            .map(|m| m.name.as_str())
            .collect::<Vec<_>>(),
        ["Nope"]
    );
    assert!(entry(&r, "A").meta.is_some());
}

#[test]
fn extended_definition_and_usage_fall_back_to_generic_kinds() {
    // Arrange（ExtendedDefinition・ExtendedUsage、8.2.2.27。基の型を宣言しないメタデータ）
    let text = "metadata def X; #X def H; #X h : H; in #X x : T;";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        decls(&r)[1..],
        [
            ("def", "H", "", ""),
            ("usage", "h", "H", ""),
            ("param", "x", "T", ""),
        ]
    );
    assert!(entry(&r, "H").is_def);
    assert!(
        entry(&r, "h")
            .meta
            .as_ref()
            .is_some_and(|m| m.0[0].0 == "X")
    );
}

#[test]
fn extended_definition_takes_its_kind_from_the_semantic_metadata_base_type() {
    // Arrange（SemanticMetadata の baseType、8.2.2.27）
    let text = "metadata def Cmd :> SemanticMetadata { :>> baseType = commands meta SysML::ActionUsage; } \
                #Cmd def Start; #Cmd stop : Start;";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(entry(&r, "Start").kind, "action def");
    assert_eq!(entry(&r, "stop").kind, "action");
}

#[test]
fn satisfy_variants_are_relations() {
    // Arrange（SatisfyRequirementUsage、8.2.2.21。by なし・assert・not）
    let text = "part def A { satisfy R1; } assert satisfy R2 by A; assert not satisfy R3 by A; not satisfy R4 by A;";
    // Act
    let r = run(text);
    // Assert
    let got: Vec<(String, String, bool)> = r
        .rels
        .iter()
        .filter_map(|x| match &x.kind {
            RelKind::Satisfy { req, by, negated } => Some((req.clone(), by.clone(), *negated)),
            _ => None,
        })
        .collect();
    let want = [
        ("R1", "", false),
        ("R2", "A", false),
        ("R3", "A", true),
        ("R4", "A", true),
    ]
    .map(|(a, b, c)| (a.to_owned(), b.to_owned(), c));
    assert_eq!(got, want);
    assert!(r.unsupported.is_empty(), "{:?}", r.unsupported);
}

#[test]
fn named_constraint_without_body_is_kept_as_an_owner_expression() {
    // Arrange（AssertConstraintUsage・RequirementConstraintMember、8.2.2.20〜21）
    let text = "requirement def R { require c1 : CD; require constraint c2 : CD; assume constraint c3; } \
                part def H { assert constraint c4 : CD; assert not constraint c5 : CD; }";
    // Act
    let r = run(text);
    // Assert
    let texts = |name: &str| -> Vec<(String, String)> {
        entry(&r, name)
            .exprs
            .iter()
            .map(|x| (x.text.clone(), x.via.clone()))
            .collect()
    };
    let pairs = |v: &[(&str, &str)]| -> Vec<(String, String)> {
        v.iter()
            .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
            .collect()
    };
    assert_eq!(
        texts("R"),
        pairs(&[
            ("c1 : CD", "require"),
            ("c2 : CD", "require"),
            ("c3", "assume")
        ])
    );
    assert_eq!(
        texts("H"),
        pairs(&[("c4 : CD", "assert"), ("not c5 : CD", "assert")])
    );
}

#[test]
fn imports_are_recorded_by_their_package_path() {
    // Arrange（Import、8.2.2.5）
    let text = "package P { private import ISQ::*; import ScalarValues::Real; import all SI::**; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(r.imports, ["ISQ", "ScalarValues::Real", "SI"]);
}

#[test]
fn value_written_on_the_element_wins_over_metadata_about() {
    // Arrange（境界値: 同じメタデータの同じ名前を、要素自身と about の両方に書く）
    let text = "package P { part def A { @Phase { stage = K::a; } } metadata Phase about A { stage = K::b; } }";
    // Act
    let r = run(text);
    // Assert
    let meta = entry(&r, "A").meta.clone().unwrap_or_default();
    assert_eq!(
        meta.0,
        [(
            "Phase".to_owned(),
            OrderedMap(vec![("stage".to_owned(), "a".to_owned())])
        )]
    );
}

/// 宣言の `specs` を（種類, 相手, 修飾名, 消す範囲の文字列）の組にする。
fn specs_of(text: &str, name: &str) -> Vec<(&'static str, String, String, String)> {
    let r = run(text);
    entry(&r, name)
        .specs
        .iter()
        .map(|s| {
            (
                s.op,
                s.target.clone(),
                s.path.clone(),
                text[s.start..s.end].to_owned(),
            )
        })
        .collect()
}

#[test]
fn definition_keeps_every_supertype_and_first_one_as_type() {
    // Arrange（SubclassificationPart、8.2.2.6：`:>` と `specializes` の相手をすべて）
    let text = "part def B :> A, 'Q 1'::C specializes D;";
    // Act
    let specs = specs_of(text, "B");
    // Assert
    assert_eq!(
        specs,
        [
            ("specializes", "A".into(), "A".into(), "A, ".into()),
            (
                "specializes",
                "'Q 1'::C".into(),
                "Q 1::C".into(),
                ", 'Q 1'::C".into()
            ),
            (
                "specializes",
                "D".into(),
                "D".into(),
                " specializes D".into()
            ),
        ]
    );
    assert_eq!(entry(&run(text), "B").ty, "A");
}

#[test]
fn usage_records_subsetting_redefinition_and_reference_by_kind() {
    // Arrange（FeatureSpecializationPart、8.2.2.6：記号とキーワードの両方）
    let text = "part def W { part b : B :> a subsets c; attribute :>> m redefines n; part x ::> y.z; part w references v; }";
    // Act
    let (b, m, x, w) = (
        specs_of(text, "b"),
        specs_of(text, "m"),
        specs_of(text, "x"),
        specs_of(text, "w"),
    );
    // Assert（名前の無い `:>> m` も再定義として残す。型は部分集合と取り違えない）
    let ops = |v: &[(&'static str, String, String, String)]| -> Vec<(&'static str, String)> {
        v.iter().map(|s| (s.0, s.1.clone())).collect()
    };
    assert_eq!(ops(&b), [("subsets", "a".into()), ("subsets", "c".into())]);
    assert_eq!(
        ops(&m),
        [("redefines", "m".into()), ("redefines", "n".into())]
    );
    assert_eq!(ops(&x), [("references", "y.z".into())]);
    assert_eq!(ops(&w), [("references", "v".into())]);
    assert_eq!(entry(&run(text), "b").ty, "B");
}

#[test]
fn declaration_without_relations_has_no_specs() {
    // Arrange（境界値：関係の無い宣言と、パラメータ）
    let text = "constraint def C { in x : Real; } part def A { part p : P; }";
    // Act
    let r = run(text);
    // Assert
    assert!(r.entries.iter().all(|e| e.specs.is_empty()));
}

#[test]
fn multiplicity_keeps_range_and_order_keywords() {
    // Arrange（MultiplicityPart、8.2.2.6：範囲・`*`・`ordered`・`nonunique`、名前の後ろの多重度）
    let text = "part def V { part w : W[ 0 .. 4 ] ordered nonunique; part s[*] : S; part n : N nonunique; part p : P; }";
    // Act
    let r = run(text);
    // Assert
    let m = |name: &str| entry(&r, name).multiplicity.clone();
    assert_eq!(
        m("w"),
        Some(Multiplicity {
            range: "0..4".into(),
            ordered: true,
            nonunique: true
        })
    );
    assert_eq!(m("s").map(|x| x.range), Some("*".into()));
    assert_eq!(
        m("n"),
        Some(Multiplicity {
            range: String::new(),
            ordered: false,
            nonunique: true
        })
    );
    assert_eq!(m("p"), None);
    assert_eq!(entry(&r, "s").ty, "S");
}

/// `RelKind::Dependency` を短く作る。
fn dependency(a: &str, b: &str, name: &str, meta: &str) -> RelKind {
    RelKind::Dependency {
        a: a.to_owned(),
        b: b.to_owned(),
        name: name.to_owned(),
        meta: meta.to_owned(),
    }
}

#[test]
fn dependency_becomes_one_relation_per_client_and_supplier() {
    // Arrange（Dependency、8.2.2.3：メタデータの無い依存と、複数の依存する側・される側）
    let text = "package P { dependency A, B to C, D; }";
    // Act
    let r = run(text);
    // Assert（組ごと。宣言にはしない）
    let kinds: Vec<_> = r.rels.iter().map(|x| x.kind.clone()).collect();
    assert_eq!(
        kinds,
        [
            dependency("A", "C", "", ""),
            dependency("A", "D", "", ""),
            dependency("B", "C", "", ""),
            dependency("B", "D", "", ""),
        ]
    );
    assert_eq!(r.entries.len(), 1);
}

#[test]
fn dependency_keeps_name_and_metadata_and_derivation_stays_derive() {
    // Arrange（名前とメタデータ付き・#derivation）
    let text =
        "package P { #trace dependency d from x.y to B; #derivation dependency from R2 to R1; }";
    // Act
    let r = run(text);
    // Assert
    let kinds: Vec<_> = r.rels.iter().map(|x| x.kind.clone()).collect();
    assert_eq!(
        kinds,
        [
            dependency("x.y", "B", "d", "trace"),
            RelKind::Derive {
                a: "R2".to_owned(),
                b: "R1".to_owned()
            },
        ]
    );
}

#[test]
fn dependency_without_supplier_makes_no_relation() {
    // Arrange（異常系：to が無い。構文エラーはパーサが出す）
    let text = "package P { dependency from A; }";
    // Act
    let r = run(text);
    // Assert
    assert!(r.rels.is_empty());
    assert_eq!(r.errors.len(), 1);
}

#[test]
fn feature_value_keeps_how_the_value_is_given() {
    // Arrange（FeatureValue、8.2.2.6。同値クラス: 束縛 `=`・初期値 `:=`・既定値 `default`・`default =`・`default :=`）
    let text = "part def A { attribute b = 1; attribute i := 2; attribute d default 3; \
                attribute de default = 4; attribute di default  := 5; attribute n; }";
    // Act
    let r = run(text);
    // Assert
    let op = |name: &str| entry(&r, name).value_op.clone();
    let value = |name: &str| entry(&r, name).value.clone();
    assert_eq!(op("b"), None);
    assert_eq!(op("i").as_deref(), Some(":="));
    assert_eq!(op("d").as_deref(), Some("default"));
    assert_eq!(op("de").as_deref(), Some("default ="));
    assert_eq!(op("di").as_deref(), Some("default :="));
    assert_eq!(op("n"), None);
    assert_eq!(
        ["b", "i", "d", "de", "di"].map(value),
        ["1", "2", "3", "4", "5"].map(|v| Some(v.to_owned()))
    );
}

#[test]
fn default_without_expression_has_no_value_kind() {
    // Arrange（異常系・境界値: `default` の後に式が無い）
    let text = "part def A { attribute d default; }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(entry(&r, "d").value, None);
    assert_eq!(entry(&r, "d").value_op, None);
}

// ---- コメント（Comment、8.2.2.4） ----

#[test]
fn comment_about_keeps_its_body_and_annotated_elements() {
    // Arrange（`about` の相手が 2 つ。修飾名と特徴の連鎖）
    let text = "package P { package Q { part def A; } part def B { part c; } \
                comment note about Q::A, B.c /* 安全のため\n * 二重にする */ }";
    // Act
    let r = run(text);
    // Assert
    let note = entry(&r, "note");
    assert_eq!(note.kind, "comment");
    assert_eq!(note.body.as_deref(), Some("安全のため\n二重にする"));
    assert_eq!(note.about, [entry(&r, "A").idx, entry(&r, "c").idx]);
    assert_eq!(note.pe, Some(entry(&r, "P").idx));
    assert_eq!(note.head, "comment note about Q::A, B.c");
    assert!(r.missing_comment_about.is_empty());
}

#[test]
fn comment_without_about_annotates_its_owner() {
    // Arrange（`about` の無い `comment /* … */`・`comment c locale "ja" /* … */`、名前の無いもの）
    let text = "part def A { comment /* 1 つ目 */ comment c locale \"ja\" /* 2 つ目 */ }";
    // Act
    let r = run(text);
    // Assert
    let a = entry(&r, "A").idx;
    let comments: Vec<(&str, Option<&str>, &[usize])> = r
        .entries
        .iter()
        .filter(|e| e.kind == "comment")
        .map(|e| (e.name.as_str(), e.body.as_deref(), e.about.as_slice()))
        .collect();
    assert_eq!(
        comments,
        [
            ("", Some("1 つ目"), &[a][..]),
            ("c", Some("2 つ目"), &[a][..])
        ]
    );
    assert_eq!(entry(&r, "A").children.len(), 2);
}

#[test]
fn plain_comment_and_top_level_comment_without_about_annotate_nothing() {
    // Arrange（境界値: キーワードの無い `/* … */` は読み飛ばす。ファイルの直下の `comment` は持ち主が無い）
    let text = "/* 見出し */ comment /* ファイルのメモ */ part def A { /* 注記 */ }";
    // Act
    let r = run(text);
    // Assert
    let comments: Vec<(&str, &[usize])> = r
        .entries
        .iter()
        .filter(|e| e.kind == "comment")
        .map(|e| (e.body.as_deref().unwrap_or(""), e.about.as_slice()))
        .collect();
    assert_eq!(comments, [("ファイルのメモ", &[][..])]);
    assert!(entry(&r, "A").children.is_empty());
}

#[test]
fn comment_about_missing_target_is_recorded() {
    // Arrange（異常系: 相手の 1 つが無い）
    let text = "package P { part def A; comment about A, Nope /* x */ }";
    // Act
    let r = run(text);
    // Assert
    let names: Vec<&str> = r
        .missing_comment_about
        .iter()
        .map(|m| m.name.as_str())
        .collect();
    assert_eq!(names, ["Nope"]);
    let c = r.entries.iter().find(|e| e.kind == "comment");
    assert_eq!(c.map(|c| c.about.clone()), Some(vec![entry(&r, "A").idx]));
}

// ---- 別の言語での表し方（TextualRepresentation、8.2.2.4） ----

#[test]
fn textual_representation_keeps_language_and_body_on_the_owner() {
    // Arrange（名前のある `rep`・名前の無い `language` だけの形）
    let text = "part def A {\n  rep inOCL language \"OCL\"\n    /* self.mass > 0 */\n  language \"Python\" /*\n    if a:\n        b()\n  */\n}";
    // Act
    let r = run(text);
    // Assert
    let reps: Vec<(&str, &str, &str)> = entry(&r, "A")
        .reps
        .iter()
        .map(|x| (x.name.as_str(), x.language.as_str(), x.body.as_str()))
        .collect();
    assert_eq!(
        reps,
        [
            ("inOCL", "OCL", "self.mass > 0"),
            ("", "Python", "if a:\n    b()")
        ]
    );
}

#[test]
fn textual_representation_without_owner_or_body_is_dropped() {
    // Arrange（境界値: ファイルの直下。異常系: 本文が無い）
    let text = "rep r language \"x\" /* a */\npart def A { rep s language \"y\"; }";
    // Act
    let r = run(text);
    // Assert
    assert!(r.entries.iter().all(|e| e.reps.is_empty()));
    assert_eq!(entry(&r, "A").children.len(), 0);
}

#[test]
fn individual_is_kept_as_a_modifier_of_occurrences() {
    // Arrange（8.2.2.9。同値クラス: 種類のキーワードあり・なし、定義・使用）
    let text = "package P { individual part def Car; individual part c : Car; individual def Earth; individual earth : Earth; }";
    // Act
    let r = run(text);
    // Assert
    let got: Vec<(&str, &str, bool, &str, Option<&str>)> = ["Car", "c", "Earth", "earth"]
        .map(|n| entry(&r, n))
        .iter()
        .map(|e| {
            (
                e.name.as_str(),
                e.kind.as_str(),
                e.is_def,
                e.ty.as_str(),
                e.mods.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        got,
        [
            ("Car", "part def", true, "", Some("individual")),
            ("c", "part", false, "Car", Some("individual")),
            ("Earth", "occurrence def", true, "", Some("individual")),
            ("earth", "occurrence", false, "Earth", Some("individual")),
        ]
    );
    assert!(r.unsupported.is_empty());
}

#[test]
fn action_nodes_are_usages_of_the_kind_as_written() {
    // Arrange（同値分割：制御の節・send・accept・assign・terminate、then の後の節、8.2.2.17）
    let text = "action def A { fork f; join j; merge m; decide d; send S() to b; then accept e : E via p; \
                action s send x; assign a.x := 1; terminate; }";
    // Act
    let r = run(text);
    // Assert
    let got: Vec<(&str, &str, &str)> = entry(&r, "A")
        .children
        .iter()
        .map(|&i| {
            let e = &r.entries[i];
            (e.kind.as_str(), e.name.as_str(), e.head.as_str())
        })
        .collect();
    assert_eq!(
        got,
        [
            ("fork", "f", "fork f"),
            ("join", "j", "join j"),
            ("merge", "m", "merge m"),
            ("decide", "d", "decide d"),
            ("send", "", "send S() to b"),
            ("accept", "", "accept e : E via p"),
            ("send", "s", "action s send x"),
            ("assign", "", "assign a.x := 1"),
            ("terminate", "", "terminate"),
        ]
    );
    assert!(r.unsupported.is_empty());
    assert!(entry(&r, "A").exprs.is_empty());
}

#[test]
fn body_of_a_control_node_belongs_to_the_node() {
    // Arrange（正常系：制御の節の本体の中身は、その節の中身）
    let text = "package P { join j { part x; } }";
    // Act
    let r = run(text);
    // Assert
    assert_eq!(
        entry(&r, "x").pe,
        Some(r.entries.iter().position(|e| e.name == "j").unwrap_or(0))
    );
    assert!(r.unsupported.is_empty());
}

#[test]
fn accept_shorthand_transition_is_still_skipped() {
    // Arrange（境界値：状態の中の省略形の遷移 accept E then b; は、アクションの節にしない）
    let text = "state def S { state a; accept Go then a; }";
    // Act
    let r = run(text);
    // Assert
    assert!(r.entries.iter().all(|e| e.kind != "accept"));
    assert!(r.unsupported.is_empty());
}
