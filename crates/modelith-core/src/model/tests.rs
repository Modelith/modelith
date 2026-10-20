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
    let text = format!("package P {{ allocation def {name}; }}");
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
