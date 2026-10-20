//! モデル構築の単体テスト。暫定コアとの一致そのものは、web の golden.test.ts・spec.test.ts・model-diff.test.ts が確かめる（ADR-0016）。
//! ここでは、番号での参照・キーと ID の付け方・問題の種類など、モデル構築に固有の約束と、どんな入力でも止まらないことを確かめる。

use super::*;
use crate::project::project;
use crate::syntax::parse;

fn run(text: &str) -> (ParseResult, Model) {
    let p = project(text, &parse(text));
    let m = build(&p);
    (p, m)
}

fn node<'a>(m: &'a Model, key: &str) -> &'a Node {
    m.nodes
        .iter()
        .find(|n| n.key == key)
        .unwrap_or_else(|| panic!("{key} がありません"))
}

#[test]
fn definitions_become_nodes_that_point_to_their_entries() {
    // Arrange
    let text = "package P { part def A; attribute def B; metadata def M; view def V; }";
    // Act
    let (p, m) = run(text);
    // Assert（メタデータとビューの定義は図に描かない）
    let keys: Vec<&str> = m.nodes.iter().map(|n| n.key.as_str()).collect();
    assert_eq!(keys, ["A", "B"]);
    let a = node(&m, "A");
    assert_eq!(p.entries[a.entry].name, "A");
    assert_eq!(
        (a.kind.as_str(), a.is_def, a.fam),
        ("part def", true, "part")
    );
}

#[test]
fn same_name_in_another_package_gets_owner_in_key() {
    // Arrange（境界値：2 つ目の同じ名前）
    let text = "package P { part def A; } package Q { part def A; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let keys: Vec<&str> = m.nodes.iter().map(|n| n.key.as_str()).collect();
    assert_eq!(keys, ["A", "A@Q"]);
}

#[test]
fn ports_take_direction_from_their_definition() {
    // Arrange
    let text =
        "package P { port def Pt { in item x : Real; } part def H { port a : Pt; port b : ~Pt; } }";
    // Act
    let (_, m) = run(text);
    // Assert（~ で向きが逆になる）
    let h = node(&m, "H");
    let dirs: Vec<(&str, bool, &str)> = h
        .ports
        .iter()
        .map(|p| (p.name.as_str(), p.conj, p.dir))
        .collect();
    assert_eq!(dirs, [("a", false, "in"), ("b", true, "out")]);
}

#[test]
fn usage_with_unknown_type_is_an_error_but_library_type_is_not() {
    // Arrange（異常系と、標準ライブラリの型の境界）
    let text = "package P { part def A { attribute x : Real; part y : Nope; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<&str> = m.problems.iter().map(|p| p.msg.as_str()).collect();
    assert_eq!(msgs.len(), 1, "{msgs:?}");
    assert!(msgs[0].contains("Nope"), "{msgs:?}");
    assert_eq!(m.problems[0].kind, None);
}

#[test]
fn edges_get_unique_ids_even_when_written_twice() {
    // Arrange（同じ関係を 2 回書く）
    let text = "package P { part def A { part b : B; part c : B; } part def B; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let ids: Vec<&str> = m.edges.iter().map(|e| e.id.as_str()).collect();
    let unique: std::collections::HashSet<&&str> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len(), "{ids:?}");
}

#[test]
fn flow_edge_points_to_its_relation_by_index() {
    // Arrange
    let text = "package P { port def Pt { out item y : Real; in item x : Real; } \
                part def S { port o : Pt; } part def T { port i : Pt; } \
                part def H { part s : S; part t : T; flow from s.o.y to t.i.x; } }";
    // Act
    let (p, m) = run(text);
    // Assert
    let flow = m.edges.iter().find(|e| e.kind == "flow").expect("流れの線");
    let rel = flow.rel.expect("関係の番号");
    assert!(
        matches!(p.rels[rel].kind, crate::project::RelKind::Flow { .. }),
        "{:?}",
        p.rels[rel]
    );
}

#[test]
fn unsupported_statement_head_is_shortened_to_40_utf16_units() {
    // Arrange（境界値：41 文字の頭）
    let name = "あ".repeat(41);
    let text = format!("package P {{ until {name}; }}");
    // Act
    let (_, m) = run(&text);
    // Assert
    let info = m
        .problems
        .iter()
        .find(|p| p.kind == Some("unsupported"))
        .expect("まだ扱えない構文");
    assert!(info.msg.contains('…'), "{}", info.msg);
    assert!(!info.msg.contains(&name), "{}", info.msg);
    let shown = info
        .msg
        .split('「')
        .nth(1)
        .and_then(|m| m.split('」').next())
        .unwrap_or_default();
    assert_eq!(shown.encode_utf16().count(), 41, "{shown}"); // 40 単位と「…」
}

#[test]
fn phases_come_from_the_phase_metadata_and_report_trace_gaps() {
    // Arrange
    let text = "package P { enum def Stage { enum concept; enum detail; } \
                metadata def Phase { attribute stage : Stage; } \
                requirement def R1 { @Phase { stage = concept; } } \
                requirement def R2 { @Phase { stage = detail; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        m.phases.as_deref(),
        Some(&["concept".to_owned(), "detail".to_owned()][..])
    );
    assert_eq!(m.phase_enum.as_deref(), Some("Stage"));
    assert_eq!(node(&m, "R2").phase.as_deref(), Some("detail"));
    assert!(node(&m, "R2").phase_own);
    let gaps = m.problems.iter().filter(|p| p.kind == Some("gap")).count();
    // R1：展開先が無い。R2：導出元・満たす要素・検証が無い
    assert_eq!(gaps, 4);
}

#[test]
fn no_phase_metadata_means_no_phases() {
    // Arrange（異常系：Phase はあるが stage の型が列挙でない）
    let text = "package P { metadata def Phase { attribute stage : Real; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(m.phases, None);
    assert_eq!(m.phase_enum, None);
}

#[test]
fn view_exposes_members_and_filters_by_metaclass() {
    // Arrange
    let text = "package P { part def A; part a : A; attribute def B; \
                view v { expose P::*; filter @PartDefinition; } }";
    // Act
    let (p, m) = run(text);
    // Assert
    let v = &m.views[0];
    assert_eq!((v.name.as_str(), v.kind, v.std), ("v", "general", None));
    assert_eq!(v.node_keys, ["A"]);
    assert_eq!(
        v.targets
            .iter()
            .map(|&t| p.entries[t].name.as_str())
            .collect::<Vec<_>>(),
        ["P"]
    );
}

#[test]
fn view_reports_missing_target_and_unsupported_rendering() {
    // Arrange（異常系：見つからない expose と、図にできない render）
    let text = "package P { view v : GridView { expose Nope::X; render asElementTable; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let kinds: Vec<Option<&str>> = m.problems.iter().map(|p| p.kind).collect();
    assert_eq!(
        kinds,
        [Some("unsupported"), Some("unsupported"), None],
        "{:?}",
        m.problems
    );
    assert_eq!(m.views[0].std, Some("GridView"));
    assert_eq!(m.views[0].kind, "general");
}

#[test]
fn action_flow_view_is_drawn_without_a_notice() {
    // Arrange（同値分割：名前・短い名前の ActionFlowView、9.2.20 の Table 34）
    let text = "package P { action def A { action a; } view v : ActionFlowView { expose A; } view w : afv { expose A; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let kinds: Vec<(&str, Option<&str>)> = m.views.iter().map(|v| (v.kind, v.std)).collect();
    assert_eq!(
        kinds,
        [
            ("actionFlow", Some("ActionFlowView")),
            ("actionFlow", Some("ActionFlowView"))
        ]
    );
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn standard_view_names_and_labels() {
    // 同値分割：名前・短い名前・標準でない名前
    assert!(views::is_standard_view("InterconnectionView"));
    assert!(views::is_standard_view("iv"));
    assert!(!views::is_standard_view("MyView"));
    assert_eq!(views::std_view_label(Some("SequenceView")), "シーケンス図");
    assert_eq!(views::std_view_label(None), "一般の図");
}

#[test]
fn family_and_library_types() {
    // 同値分割：種類ごとの系統
    assert_eq!(family("requirement def"), "req");
    assert_eq!(family("verification"), "ver");
    assert_eq!(family("calc def"), "con");
    assert_eq!(family("state"), "beh");
    assert_eq!(family("part"), "part");
    assert_eq!(family("item def"), "other");
}

#[test]
fn library_types_are_an_explicit_list_and_value_suffix_needs_a_quantity_import() {
    // Arrange（同値クラス: 一覧にある名前・一覧に無い名前・…Value で終わる名前（import の有無・修飾の有無）、境界値: 空の名前）
    let cases = [
        ("Real", false, true),
        ("Positive", false, true),
        ("Iso8601DateTime", false, true),
        ("ScalarValues::Rational", false, true),
        ("Engine", false, false),
        ("MassValue", false, false),
        ("MyTypoValue", false, false),
        ("MassValue", true, true),
        ("ISQ::MassValue", false, true),
        ("MyLib::MassValue", false, false),
        ("", false, false),
    ];
    // Act
    let got: Vec<bool> = cases.iter().map(|(t, q, _)| is_lib(t, *q)).collect();
    // Assert
    let want: Vec<bool> = cases.iter().map(|(_, _, w)| *w).collect();
    assert_eq!(got, want, "{cases:?}");
}

/// 決まった種から作る乱数（xorshift。テストを毎回同じにする）。
struct Rng(u64);

impl Rng {
    fn next(&mut self, n: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % n as u64) as usize
    }
}

/// 乱数で並べる字句。キーワード・記号・名前・壊れた形（閉じない括弧やコメント・多バイト文字）を混ぜる。
const TOKENS: &[&str] = &[
    "package",
    "part",
    "def",
    "attribute",
    "port",
    "item",
    "in",
    "out",
    "inout",
    "requirement",
    "satisfy",
    "by",
    "verify",
    "verification",
    "objective",
    "concern",
    "frame",
    "state",
    "action",
    "transition",
    "first",
    "then",
    "accept",
    "do",
    "entry",
    "exit",
    "flow",
    "from",
    "to",
    "connect",
    "connection",
    "interface",
    "end",
    "enum",
    "metadata",
    "view",
    "expose",
    "filter",
    "render",
    "doc",
    "subject",
    "message",
    "of",
    "perform",
    "exhibit",
    "calc",
    "constraint",
    "use",
    "case",
    "occurrence",
    "abstract",
    "ref",
    "derived",
    "#Phase",
    "@Phase",
    "@",
    "#",
    "{",
    "}",
    "(",
    ")",
    "[",
    "]",
    ";",
    ":",
    "::",
    ":>",
    ":>>",
    "~",
    ".",
    ",",
    "=",
    "*",
    "**",
    "<'R1'>",
    "/*",
    "*/",
    "//",
    "\"s\"",
    "1.5",
    "A",
    "B",
    "Pt",
    "Phase",
    "stage",
    "Stage",
    "Real",
    "GeneralView",
    "iv",
    "asTreeDiagram",
    "日本語",
    "\n",
    "/* @layout {\"A\":{\"x\":1}} */",
    "/* @layout {",
];

#[test]
fn random_input_never_panics_and_positions_stay_in_text() {
    // Arrange（ファジング：乱数で並べた字句を、解析とモデル構築に通す。ADR-0016）
    let mut rng = Rng(0x2026_1016);
    for _ in 0..2000 {
        let len = 1 + rng.next(60);
        let text: String = (0..len)
            .map(|_| TOKENS[rng.next(TOKENS.len())])
            .collect::<Vec<_>>()
            .join(" ");
        let utf16_len = text.encode_utf16().count();
        // Act
        let (p, m) = run(&text);
        // Assert
        assert!(m.problems.iter().all(|x| x.pos <= utf16_len), "{text}");
        assert!(m.nodes.iter().all(|n| n.entry < p.entries.len()), "{text}");
        assert!(
            m.edges
                .iter()
                .all(|e| e.rel.is_none_or(|r| r < p.rels.len())),
            "{text}"
        );
        assert!(
            m.views.iter().all(
                |v| v.entry < p.entries.len() && v.targets.iter().all(|&t| t < p.entries.len())
            ),
            "{text}"
        );
        let keys: std::collections::HashSet<&str> =
            m.nodes.iter().map(|n| n.key.as_str()).collect();
        assert!(
            m.edges
                .iter()
                .all(|e| keys.contains(e.from.as_str()) && keys.contains(e.to.as_str())),
            "{text}"
        );
    }
}

#[test]
fn random_bytes_never_panic() {
    // Arrange（ファジング：字句の形を持たない入力。制御文字・サロゲートの外の文字を含む）
    let mut rng = Rng(0x5eed);
    let chars = [
        '{', '}', ';', ':', '@', '#', '/', '*', '"', '\'', '<', '>', 'a', ' ', '\n', '\0', 'あ',
        '🚀', '\u{feff}',
    ];
    for _ in 0..2000 {
        let text: String = (0..rng.next(80))
            .map(|_| chars[rng.next(chars.len())])
            .collect();
        // Act・Assert（panic しない）
        let _ = run(&text);
    }
}

#[test]
fn exposed_package_becomes_frame_with_its_nested_elements() {
    // Arrange（F-VIEW-9：package そのものを出すと枠になり、入れ子の要素も図に出る）
    let text = "package P { part def A; package Q { part def B; package R { part def C; } } view v { expose P::Q; } }";
    // Act
    let (p, m) = run(text);
    // Assert
    let v = &m.views[0];
    assert_eq!(v.node_keys, ["B", "C"]);
    let frames: Vec<(&str, &str, Vec<&str>)> = v
        .frames
        .iter()
        .map(|f| {
            (
                f.name.as_str(),
                p.entries[f.entry].name.as_str(),
                f.node_keys.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(frames, [("Q", "Q", vec!["B", "C"])]);
}

fn errors(m: &Model) -> Vec<&str> {
    m.problems
        .iter()
        .filter(|p| p.kind.is_none())
        .map(|p| p.msg.as_str())
        .collect()
}

fn edge_ids(m: &Model) -> Vec<&str> {
    m.edges.iter().map(|e| e.id.as_str()).collect()
}

// ---- 取り違えの修正（F-EDIT-8、alpha.7） ----

/// 同じ名前 A が、ファイルの直下の X と、P の中の Q にある。
const TWO_AS: &str =
    "package X { part def A; } package P { package Q { part def A; } part def H { ";

#[test]
fn qualified_type_walks_the_path_from_the_referencing_scope() {
    // Arrange（QualifiedName、8.2.2.1〜2・8.2.2.5：Q は H の外側の P から見える）
    let text = format!("{TWO_AS}part a : Q::A; }} }}");
    // Act
    let (_, m) = run(&text);
    // Assert（X の A ではなく、Q の A につなぐ）
    assert_eq!(edge_ids(&m), ["comp|H|A@Q|a#1"]);
    assert!(errors(&m).is_empty());
}

#[test]
fn qualified_type_from_the_top_level_and_nested_path_resolve() {
    // Arrange（境界値：ファイルの直下から・3 段の修飾名）
    let text = format!("{TWO_AS}part x : X::A; part q : P::Q::A; }} }}");
    // Act
    let (_, m) = run(&text);
    // Assert
    assert_eq!(edge_ids(&m), ["comp|H|A|x#1", "comp|H|A@Q|q#1"]);
    assert!(errors(&m).is_empty());
}

#[test]
fn qualified_type_with_a_missing_segment_is_not_found() {
    // Arrange（異常系：最初の段が無い・最後の段が無い・見えない名前空間）
    let text = "package X { package Q { part def A; } } package P { part def A; part def H { part b : Nope::A; part c : X::Z; part d : Q::A; } }";
    // Act
    let (_, m) = run(text);
    // Assert（最後の名前が同じ A でも、別の A にはつながない）
    assert_eq!(
        errors(&m),
        [
            "型「Nope::A」が見つかりません（b）",
            "型「X::Z」が見つかりません（c）",
            "型「Q::A」が見つかりません（d）",
        ]
    );
    assert!(m.edges.is_empty());
}

#[test]
fn qualified_library_type_is_not_reported() {
    // Arrange（標準ライブラリの名前：最初の段がファイルに無い）
    let text = "package P { part def H { attribute m : ISQ::MassValue; attribute r : ScalarValues::Real; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert!(m.problems.is_empty());
}

#[test]
fn qualified_relation_end_resolves_by_path() {
    // Arrange（satisfy の相手の修飾名）
    let text = "package X { requirement def R; } package P { requirement def R; part def A; satisfy X::R by A; satisfy Nope::R by A; }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(edge_ids(&m), ["satisfy|A|R|«satisfy»#1"]);
    assert_eq!(
        errors(&m),
        ["「満たす」関係の相手「Nope::R」が見つかりません（satisfy）"]
    );
}

#[test]
fn alias_in_the_same_file_resolves_to_its_target() {
    // Arrange（AliasMember、8.2.2.5：修飾名の指す先・別名の別名・修飾名の中の別名）
    let text = "package P { package Q { part def A; } alias B for Q::A; alias C for B; part def H { part b : B; part c : C; part d : P::B; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        edge_ids(&m),
        ["comp|H|A|b#1", "comp|H|A|c#1", "comp|H|A|d#1"]
    );
    assert!(m.problems.is_empty());
}

#[test]
fn alias_cycle_or_missing_target_is_not_found() {
    // Arrange（異常系：自分を指す別名・指す先の無い別名）
    let text =
        "package P { alias L for L; alias M for Nope; part def H { part l : L; part m : M; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        errors(&m),
        [
            "型「L」が見つかりません（l）",
            "型「M」が見つかりません（m）"
        ]
    );
}

#[test]
fn verify_inside_a_package_level_usage_draws_from_its_type() {
    // Arrange（RequirementVerificationUsage、8.2.2.24）
    let text = "package P { requirement def RD; verification def VD; verification v : VD { objective { verify RD; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(edge_ids(&m), ["verify|VD|RD|«verify»#1"]);
    assert!(m.problems.is_empty());
}

#[test]
fn verify_inside_an_untyped_usage_is_not_reported_as_missing() {
    // Arrange（境界値：線を引く元が図に無い）
    let text = "package P { requirement def RD; verification v { objective { verify RD; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert!(m.edges.is_empty());
    assert!(m.problems.is_empty());
}

#[test]
fn verify_of_a_missing_requirement_is_still_reported() {
    // Arrange（異常系）
    let text =
        "package P { verification def VD; verification v : VD { objective { verify Nope; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        errors(&m),
        ["「検証する」関係の相手「Nope」が見つかりません（verify）"]
    );
}

#[test]
fn frame_inside_a_viewpoint_is_recorded_without_a_line_or_problem() {
    // Arrange（ViewpointDefinition・ViewpointUsage、8.2.2.26：視点は図に描かない）
    let text = "package P { concern def C; viewpoint def VP { frame concern c : C; } viewpoint vp { frame concern c : C; } }";
    // Act
    let (p, m) = run(text);
    // Assert
    assert!(m.problems.is_empty(), "{:?}", m.problems);
    assert!(m.edges.is_empty(), "{:?}", m.edges);
    assert_eq!(p.rels.len(), 2);
}

#[test]
fn frame_inside_a_viewpoint_nested_in_a_part_def_does_not_draw_from_the_part() {
    // Arrange（境界値：視点の外側に図の要素がある）
    let text =
        "package P { concern def C; part def H { viewpoint def VP { frame concern c : C; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert!(m.edges.is_empty(), "{:?}", m.edges);
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn case_viewpoint_rendering_and_extended_definitions_are_not_drawn() {
    // Arrange（8.2.2.22・8.2.2.26・8.2.2.27：ツリーにだけ出す定義）
    let text = "package P { metadata def X; case def CS; viewpoint def VP; rendering def RD; #X def H; part def A; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let keys: Vec<&str> = m.nodes.iter().map(|n| n.key.as_str()).collect();
    assert_eq!(keys, ["A"]);
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn satisfy_without_by_is_drawn_from_the_owner() {
    // Arrange（RequirementSatisfaction、8.2.2.21：by の無い satisfy は持ち主が満たす。使用は型の定義から）
    let text = "package P { requirement def R; part def H { satisfy R; } part def E; part def V { part e : E { satisfy R; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let edges: Vec<(&str, &str, &str)> = m
        .edges
        .iter()
        .filter(|e| e.kind == "satisfy")
        .map(|e| (e.kind, e.from.as_str(), e.to.as_str()))
        .collect();
    assert_eq!(edges, [("satisfy", "H", "R"), ("satisfy", "E", "R")]);
    assert!(errors(&m).is_empty(), "{:?}", m.problems);
}

#[test]
fn satisfy_without_by_reports_only_a_missing_requirement() {
    // Arrange（異常系：満たす相手の要求が無い。持ち主が図に無いだけなら知らせない）
    let text = "package P { requirement def R; part def H { satisfy Nope; } satisfy R; }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        errors(&m),
        ["「満たす」関係の相手「Nope」が見つかりません（satisfy）"]
    );
}

#[test]
fn assert_satisfy_draws_a_line_and_not_satisfy_does_not_count_as_satisfying() {
    // Arrange（SatisfyRequirementUsage の isNegated、8.2.2.21。フェーズで抜けを調べる）
    let text = "package P { enum def K { enum a; enum b; } metadata def Phase { attribute stage : K; } \
                requirement def R1 { @Phase { stage = K::b; } } requirement def R2 { @Phase { stage = K::b; } } \
                part def A; assert satisfy R1 by A; not satisfy R2 by A; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let satisfies: Vec<&str> = m
        .edges
        .iter()
        .filter(|e| e.kind == "satisfy")
        .map(|e| e.to.as_str())
        .collect();
    assert_eq!(satisfies, ["R1"]);
    let gaps: Vec<&str> = m
        .problems
        .iter()
        .filter(|p| p.kind == Some("gap") && p.msg.contains("満たす"))
        .map(|p| p.msg.as_str())
        .collect();
    assert_eq!(gaps.len(), 1, "{gaps:?}");
    assert!(gaps[0].contains("R2"), "{gaps:?}");
}

#[test]
fn value_suffix_types_warn_unless_a_quantity_package_is_imported() {
    // Arrange（同値クラス：import なし・ISQ の import・量のパッケージで修飾）
    let without = "package P { part def A { attribute m : MassValue; attribute t : MyTypoValue; attribute p : Positive; } }";
    let with_import =
        "package P { private import ISQ::*; part def A { attribute m : MassValue; } }";
    let qualified = "package P { part def A { attribute m : ISQ::MassValue; } }";
    // Act
    let (_, a) = run(without);
    let (_, b) = run(with_import);
    let (_, c) = run(qualified);
    // Assert
    assert_eq!(
        errors(&a),
        [
            "型「MassValue」が見つかりません（m）",
            "型「MyTypoValue」が見つかりません（t）"
        ]
    );
    assert!(errors(&b).is_empty(), "{:?}", b.problems);
    assert!(errors(&c).is_empty(), "{:?}", c.problems);
}

#[test]
fn metadata_about_sets_the_phase_of_each_annotated_element() {
    // Arrange（MetadataUsage の about、8.2.2.27）
    let text = "package P { enum def K { enum a; enum b; } metadata def Phase { attribute stage : K; } \
                part def A; part def B; metadata Phase about A, B { stage = K::b; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(node(&m, "A").phase.as_deref(), Some("b"));
    assert_eq!(node(&m, "B").phase.as_deref(), Some("b"));
}

#[test]
fn metadata_about_a_missing_element_is_reported() {
    // Arrange（異常系：about の相手が無い）
    let text = "package P { metadata def M; part def A; metadata M about A, Nope; }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        errors(&m),
        ["メタデータを付ける相手「Nope」が見つかりません（metadata about）"]
    );
}

#[test]
fn qualified_frame_type_resolves_by_path() {
    // Arrange（FramedConcernMember、8.2.2.21：関心事の型の修飾名）
    let text = "package P { package Q { concern def C; } concern def C; requirement def R { frame concern c : Q::C; frame concern d : Nope::C; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(edge_ids(&m), ["frame|R|C|«frame»#1"]);
    assert_eq!(
        errors(&m),
        ["扱う関心事「Nope::C」が見つかりません（frame）"]
    );
}

#[test]
fn expose_with_a_qualified_name_looks_outward_from_the_view() {
    // Arrange（Expose、8.2.2.26.2：Q は view の外側の P から見える。X の中の Q は見えない）
    let text = "package X { package Q { part def Z; } } package P { package Q { part def D; } view v { expose Q::D; expose Q::Z; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let v = &m.views[0];
    assert_eq!(v.node_keys, ["D"]);
    assert_eq!(
        errors(&m),
        ["図「v」に出す要素「Q::Z」が見つかりません（expose）"]
    );
}

/// 線を「種類|元|先」の文字列にする（書いた順）。
fn edge_list(m: &Model) -> Vec<String> {
    m.edges
        .iter()
        .map(|e| format!("{}|{}|{}", e.kind, e.from, e.to))
        .collect()
}

#[test]
fn specialization_draws_a_line_to_every_supertype() {
    // Arrange（SubclassificationPart、8.2.2.6・8.2.3 の subclassification：`:> A, Q::C` と `specializes`）
    let text = "package P { part def A; package Q { part def C; } part def D; part def B :> A, Q::C specializes D; }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        edge_list(&m),
        ["specialize|B|A", "specialize|B|C", "specialize|B|D"]
    );
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn specialization_line_removes_only_its_target() {
    // Arrange（線の範囲は、その相手だけを消す範囲）
    let text = "package P { part def A; part def C; part def B :> A, C; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let srcs: Vec<&str> = m
        .edges
        .iter()
        .map(|e| &text[e.src.start..e.src.end])
        .collect();
    assert_eq!(srcs, ["A, ", ", C"]);
    assert_eq!(m.edges[0].id, "specialize|B|A|#1");
}

#[test]
fn specialization_of_an_undrawn_or_missing_definition_is_not_a_problem() {
    // Arrange（異常系：標準ライブラリ・見つからない相手・図に描かない定義・自分自身）
    let text = "package P { part def A :> Part; part def B :> Nope; view def V :> GeneralView; part def S :> S; }";
    // Act
    let (_, m) = run(text);
    // Assert（線も問題も出さない）
    assert!(m.edges.is_empty(), "{:?}", m.edges);
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn subsetting_redefinition_and_reference_draw_lines_between_drawn_usages() {
    // Arrange（8.2.2.6・8.2.3 の subsetting・redefinition・reference-subsetting。package の直下の部品と要求は図の要素）
    let text = "package P { part def A; part a : A; part b :> a; part c :>> a; part d ::> a; \
                requirement r1; requirement r2 subsets r1; }";
    // Act
    let (_, m) = run(text);
    // Assert（型付けの線はこれまでどおり）
    assert_eq!(
        edge_list(&m),
        [
            "defined|a|A",
            "subset|b|a",
            "redefine|c|a",
            "reference|d|a",
            "subset|r2|r1"
        ]
    );
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn feature_relations_inside_a_definition_are_not_lines_nor_problems() {
    // Arrange（定義の中の特性は図の要素ではない。継承した特性・見つからない相手も知らせない）
    let text = "package P { part def A { attribute m; } part def B :> A { attribute :>> m = 1; part x; part y :> x; part z :> nope; } part e :> missing; }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(edge_list(&m), ["specialize|B|A"]);
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn composite_line_shows_multiplicity_and_adornments_at_the_part_end() {
    // Arrange（8.2.3 の composite-feature-membership の multiplicity・c-adornment）
    let text = "package P { part def W; part def V { part w : W[4]; part s : W[0..*] ordered nonunique :>> w; part t : W; } }";
    // Act
    let (_, m) = run(text);
    // Assert（ラベルは名前のまま。線の ID も変わらない）
    let ends: Vec<(&str, Option<&str>)> = m
        .edges
        .iter()
        .map(|e| (e.label.as_str(), e.end_label.as_deref()))
        .collect();
    assert_eq!(
        ends,
        [
            ("w", Some("[4]")),
            ("s", Some("[0..*] ordered nonunique redefines w")),
            ("t", None)
        ]
    );
    assert_eq!(m.edges[0].id, "comp|V|W|w#1");
}

#[test]
fn dependency_draws_a_line_per_client_and_supplier_with_its_label() {
    // Arrange（Dependency、8.2.2.3・8.2.3.3 の binary-dependency：名前・メタデータ・複数の相手）
    let text = "package P { part def A; part def B; part def C; metadata def trace; \
                dependency A, B to C; #trace dependency d from A to B; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let lines: Vec<String> = m
        .edges
        .iter()
        .map(|e| format!("{}|{}|{}|{}", e.kind, e.from, e.to, e.label))
        .collect();
    assert_eq!(
        lines,
        [
            "dependency|A|C|",
            "dependency|B|C|",
            "dependency|A|B|«trace» d"
        ]
    );
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn dependency_with_a_missing_end_is_a_problem_but_undrawn_ends_are_not() {
    // Arrange（異常系：見つからない相手。package どうしの依存は、相手があるので知らせない）
    let text = "package P { part def A; dependency A to Nope; dependency from Q to P; package Q; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<&str> = m.problems.iter().map(|p| p.msg.as_str()).collect();
    assert_eq!(
        msgs,
        ["「依存」関係の相手「Nope」が見つかりません（dependency）"]
    );
    assert!(m.edges.is_empty(), "{:?}", m.edges);
}

#[test]
fn allocation_draws_a_line_between_drawn_elements() {
    // Arrange（AllocationUsage 8.2.2.15・8.2.3.15 の allocate-relationship：名前の無い割り当てと名前付きの割り当て）
    let text = "package P { part def L; part def Ph; allocation def AD; \
                allocate L to Ph; allocation a : AD allocate L to Ph { } }";
    // Act
    let (p, m) = run(text);
    // Assert
    let lines: Vec<String> = m
        .edges
        .iter()
        .filter(|e| e.kind == "allocate")
        .map(|e| format!("{}|{}|{}", e.from, e.to, e.label))
        .collect();
    assert_eq!(lines, ["L|Ph|«allocate»", "L|Ph|«allocate» a"]);
    let a = p.entries.iter().find(|e| e.name == "a").expect("a");
    let named = m
        .edges
        .iter()
        .filter(|e| e.kind == "allocate")
        .nth(1)
        .expect("線");
    assert_eq!((named.src.start, named.src.end), (a.start, a.end));
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn allocation_with_a_missing_end_is_a_problem_but_undrawn_ends_are_not() {
    // Arrange（異常系：見つからない相手。部品の中の特性への割り当ては、相手があるので知らせない）
    let text = "package P { part def L { part f; } part def Ph; part l : L; \
                allocate l.f to Ph; allocate L to Nope; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<&str> = m.problems.iter().map(|p| p.msg.as_str()).collect();
    assert_eq!(
        msgs,
        ["「割り当て」関係の相手「Nope」が見つかりません（allocate）"]
    );
    assert!(m.edges.iter().all(|e| e.kind != "allocate"));
}

#[test]
fn named_flow_is_labelled_with_its_declaration_and_points_to_its_usage() {
    // Arrange（FlowUsage 8.2.2.16・8.2.3.16 の flow-label。同値分割：型付き・of 付き・名前の無いフロー）
    let text = "package P { part def S { port o; } part def T { port i; } item def Water; flow def FD; \
                part def H { part s : S; part t : T; flow f : FD from s.o to t.i { } \
                flow g of Water from s.o to t.i; flow of Water from s.o to t.i; } }";
    // Act
    let (p, m) = run(text);
    // Assert
    let flows: Vec<&Edge> = m.edges.iter().filter(|e| e.kind == "flow").collect();
    let labels: Vec<&str> = flows.iter().map(|e| e.label.as_str()).collect();
    assert_eq!(labels, ["f : FD", "g of Water", "Water"]);
    let f = p.entries.iter().find(|e| e.name == "f").expect("f");
    assert_eq!((flows[0].src.start, flows[0].src.end), (f.start, f.end));
    assert_eq!(flows[0].from_port.as_deref(), Some("port:o"));
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn nary_connection_and_binding_are_not_lines_of_the_general_view() {
    // Arrange（n 項の接続 8.2.3.13・結び付け 8.2.2.13.2 は内部ブロック図だけに描く）
    let text = "package P { part def A { port p; } part def H { part a : A; part b : A; part c : A; \
                connect (a.p, b.p, c.p); bind a.p = b.p; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert!(m.edges.iter().all(|e| e.kind == "comp"), "{:?}", m.edges);
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn nary_connection_and_binding_report_a_missing_end() {
    // Arrange（異常系：端の最初の段が見つからない）
    let text =
        "package P { part def H { part a; part b; connect (a, b, nope.p); bind a = gone; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<&str> = m.problems.iter().map(|p| p.msg.as_str()).collect();
    assert_eq!(
        msgs,
        [
            "線の接続先「nope.p」が見つかりません（connect）",
            "「結び付け」の相手「gone」が見つかりません（bind）"
        ]
    );
}

// ---- メモ（Comment、8.2.2.4・8.2.3.4） ----

#[test]
fn comment_about_drawn_elements_becomes_a_note_with_targets() {
    // Arrange（名前のあるメモ・名前の無いメモ 2 つ・`about` の無いメモ（持ち主が注釈の相手））
    let text = "package P { part def A { comment /* A の中 */ } part def B; \
                comment c about A, B /* 両方 */ comment about B /* 1 */ comment about A /* 2 */ }";
    // Act
    let (p, m) = run(text);
    // Assert
    let notes: Vec<(&str, &str, Vec<&str>)> = m
        .notes
        .iter()
        .map(|n| {
            let body = p.entries[n.entry].body.as_deref().unwrap_or("");
            (
                n.key.as_str(),
                body,
                n.targets.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(
        notes,
        [
            ("note:#1", "A の中", vec!["A"]),
            ("note:c", "両方", vec!["A", "B"]),
            ("note:#2", "1", vec!["B"]),
            ("note:#3", "2", vec!["A"]),
        ]
    );
}

#[test]
fn comment_about_undrawn_elements_has_no_note() {
    // Arrange（境界値: 相手が package・定義の中の特性だけ。名前が同じメモは 2 つ目に番号を付ける）
    let text = "package P { part def A { part x; } comment about P /* p */ comment about A.x /* x */ \
                comment n about A /* 1 */ comment n about A /* 2 */ }";
    // Act
    let (_, m) = run(text);
    // Assert
    let keys: Vec<&str> = m.notes.iter().map(|n| n.key.as_str()).collect();
    assert_eq!(keys, ["note:n", "note:n#2"]);
}

#[test]
fn comment_about_missing_target_is_a_problem() {
    // Arrange（異常系: 相手が無い）
    let text = "package P { part def A; comment about A, Nope /* x */ }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<(&str, Option<&str>)> = m
        .problems
        .iter()
        .map(|p| (p.msg.as_str(), p.kind))
        .collect();
    assert_eq!(
        msgs,
        [(
            "メモを付ける相手「Nope」が見つかりません（comment about）",
            None
        )]
    );
    assert_eq!(m.notes.len(), 1);
}

/// アクション定義の、アクションの流れの図。
fn flow<'a>(m: &'a Model, key: &str) -> &'a ActionFlow {
    m.action_flows
        .iter()
        .find(|f| f.key == key)
        .unwrap_or_else(|| panic!("{key} の流れがありません"))
}

#[test]
fn action_flow_draws_actions_control_nodes_and_successions() {
    // Arrange（8.2.3.17：開始・アクション・判断・ガード付きの継起・else・終了）
    let text = "package P { action def A { first start; then action a; then decide d; if x > 0 then b; else c; \
                action b; action c; first b then done; first c then done; attribute n; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let f = flow(&m, "A");
    let keys: Vec<&str> = f.nodes.iter().map(|n| n.key.as_str()).collect();
    assert_eq!(keys, ["a:start", "a:a", "a:d", "a:b", "a:c", "a:done"]);
    let ids: Vec<&str> = f.edges.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "succession|a:start|a:a|#1",
            "succession|a:a|a:d|#1",
            "succession|a:d|a:b|[x > 0]#1",
            "succession|a:d|a:c|[else]#1",
            "succession|a:b|a:done|#1",
            "succession|a:c|a:done|#1",
        ]
    );
    assert_eq!(f.nodes[0].entry, None);
    assert!(m.problems.is_empty(), "{:?}", m.problems);
}

#[test]
fn unnamed_action_nodes_get_numbered_keys() {
    // Arrange（境界値：名前の無いアクションの節は、書いた順に番号を付ける）
    let text = "package P { action def A { send S() to b; then accept e : E; then terminate; } part def E; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let f = flow(&m, "A");
    let nodes: Vec<(&str, &str)> = f
        .nodes
        .iter()
        .map(|n| (n.key.as_str(), n.kind.as_str()))
        .collect();
    assert_eq!(
        nodes,
        [("a:#1", "send"), ("a:#2", "accept"), ("a:#3", "terminate")]
    );
    let ends: Vec<(&str, &str)> = f
        .edges
        .iter()
        .map(|e| (e.from.as_str(), e.to.as_str()))
        .collect();
    assert_eq!(ends, [("a:#1", "a:#2"), ("a:#2", "a:#3")]);
}

#[test]
fn succession_line_points_to_its_statement_or_then() {
    // Arrange（線を消す範囲：first … then の文全体・then action の then だけ）
    let text = "package P { action def A { action a; then action b; first a then b; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let srcs: Vec<&str> = flow(&m, "A")
        .edges
        .iter()
        .map(|e| &text[e.src.start..e.src.end])
        .collect();
    assert_eq!(srcs, ["then ", "first a then b;"]);
}

#[test]
fn succession_flow_is_a_labelled_line() {
    // Arrange（SuccessionFlowUsage、8.2.3.17：名前の無いものはアイテム、名前付きは名前と型）
    let text = "package P { item def W; action def A { action a; action b; succession flow of W from a.o to b.i; \
                succession flow f : FD from a to b; } flow def FD; }";
    // Act
    let (_, m) = run(text);
    // Assert
    let lines: Vec<(&str, &str, &str)> = flow(&m, "A")
        .edges
        .iter()
        .map(|e| (e.kind, e.label.as_str(), &text[e.src.start..e.src.end]))
        .collect();
    assert_eq!(
        lines,
        [
            (
                "successionFlow",
                "W",
                "succession flow of W from a.o to b.i;"
            ),
            (
                "successionFlow",
                "f : FD",
                "succession flow f : FD from a to b;"
            ),
        ]
    );
}

#[test]
fn succession_to_a_missing_action_is_a_problem() {
    // Arrange（異常系：見つからない名前。比較：アクション定義の中の別の要素（属性）は問題にしない）
    let text = "package P { action def A { action a; first a then nope; first a then n; attribute n; then x; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<&str> = m.problems.iter().map(|p| p.msg.as_str()).collect();
    assert_eq!(
        msgs,
        [
            "「順序」の相手「nope」が見つかりません（succession）",
            "「順序」の相手「x」が見つかりません（succession）"
        ]
    );
    assert!(flow(&m, "A").edges.is_empty());
}

#[test]
fn successions_outside_action_definitions_are_not_drawn() {
    // Arrange（境界値：状態定義の中の then は、アクションの流れの図にしない。問題にもしない）
    let text = "package P { state def S { entry; then idle; state idle; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert!(m.action_flows.is_empty());
    assert!(m.problems.is_empty());
}

fn machine<'a>(m: &'a Model, key: &str) -> &'a StateMachine {
    m.state_machines
        .iter()
        .find(|f| f.key == key)
        .unwrap_or_else(|| panic!("{key} の状態遷移の図がありません"))
}

fn machine_keys(m: &Model, key: &str) -> Vec<String> {
    machine(m, key)
        .nodes
        .iter()
        .map(|n| n.key.clone())
        .collect()
}

fn machine_edges(m: &Model, key: &str) -> Vec<String> {
    machine(m, key).edges.iter().map(|e| e.id.clone()).collect()
}

#[test]
fn state_machine_draws_states_with_the_entry_transition_and_the_done() {
    // Arrange（8.2.3.18：開始は entry; then s; から、終了は done へ向かう遷移から）
    let text = "package P { state def S { entry; then off; state off; state on; \
                transition first off accept Go then on; transition first on then done; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert_eq!(
        machine_keys(&m, "S"),
        ["s:#start", "s:off", "s:on", "s:#done"]
    );
    assert_eq!(
        machine_edges(&m, "S"),
        [
            "transition|s:#start|s:off|#1",
            "transition|s:off|s:on|Go#1",
            "transition|s:on|s:#done|#1"
        ]
    );
    assert!(m.problems.is_empty());
}

#[test]
fn transition_label_is_trigger_guard_and_effect() {
    // Arrange（8.2.3.18 の transition-label：トリガ [ガード] / 効果。無い部分は書かない）
    let text = "package P { state def S { state a; state b; \
                transition first a accept Go via p if x > 0 do beep then b; \
                transition first b if y then a; transition first b do send S() to q then a; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let labels: Vec<&str> = machine(&m, "S")
        .edges
        .iter()
        .map(|e| e.label.as_str())
        .collect();
    assert_eq!(
        labels,
        ["Go via p [x > 0] / beep", "[y]", "/ send S() to q"]
    );
}

#[test]
fn nested_states_are_drawn_inside_their_composite_state() {
    // Arrange（入れ子の状態と、その本体の開始。外の状態への遷移は外側の本体から探す）
    let text = "package P { state def S { state on { entry; then low; state low; \
                accept Up then high; state high; transition first high then off; } state off; transition first off then on.low; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let nodes: Vec<(String, Option<String>)> = machine(&m, "S")
        .nodes
        .iter()
        .map(|n| (n.key.clone(), n.container.clone()))
        .collect();
    let inside = |k: &str| (k.to_owned(), Some("s:on".to_owned()));
    assert_eq!(
        nodes,
        [
            ("s:on".to_owned(), None),
            inside("s:on#start"),
            inside("s:on.low"),
            inside("s:on.high"),
            ("s:off".to_owned(), None),
        ]
    );
    assert_eq!(
        machine_edges(&m, "S"),
        [
            "transition|s:on#start|s:on.low|#1",
            "transition|s:on.low|s:on.high|Up#1",
            "transition|s:on.high|s:off|#1",
            "transition|s:off|s:on.low|#1"
        ]
    );
    assert!(m.problems.is_empty());
}

#[test]
fn parallel_states_are_marked_in_the_state_machine() {
    // Arrange（StateDefBody の isParallel、8.2.3.18：並行の状態の中の状態は、破線で区切った領域）
    let text = "package P { state def S parallel { state a; state b parallel { state x; } } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let sm = machine(&m, "S");
    assert!(sm.parallel);
    let parallel: Vec<(&str, bool)> = sm
        .nodes
        .iter()
        .map(|n| (n.key.as_str(), n.parallel))
        .collect();
    assert_eq!(parallel, [("s:a", false), ("s:b", true), ("s:b.x", false)]);
}

#[test]
fn transition_to_a_missing_state_is_a_problem() {
    // Arrange（異常系：遷移の相手が無い。直前の状態から引く遷移の、名前の無い元は問題にしない）
    let text = "package P { state def S { state a; transition first a then nope; transition first gone then a; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    let msgs: Vec<&str> = m.problems.iter().map(|p| p.msg.as_str()).collect();
    assert_eq!(
        msgs,
        [
            "「遷移」の相手「nope」が見つかりません（transition）",
            "「遷移」の相手「gone」が見つかりません（transition）"
        ]
    );
    assert!(machine(&m, "S").edges.is_empty());
}

#[test]
fn transitions_outside_state_definitions_are_not_drawn() {
    // Arrange（境界値：状態定義の外の遷移は、状態遷移の図にしない。問題にもしない）
    let text = "package P { part def H { state s1; state s2; transition first s1 then s2; } }";
    // Act
    let (_, m) = run(text);
    // Assert
    assert!(m.state_machines.is_empty());
    assert!(m.problems.is_empty());
}
