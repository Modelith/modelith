//! 図の操作の単体テスト。テキストに意図を当て、編集後のテキストを比べる（ADR-0016）。
//! 画面からの振る舞いは e2e テストで確かめる。

use super::more::sysml_name;
use super::text::{Target, diff, indent_at, insert_into, line_start, remove_range, utf16_of};
use super::*;

/// UTF-16 の位置の編集を適用する。
fn apply(text: &str, edits: &[TextEdit]) -> String {
    let mut u: Vec<u16> = text.encode_utf16().collect();
    for e in edits.iter().rev() {
        u.splice(e.start..e.end, e.text.encode_utf16());
    }
    String::from_utf16_lossy(&u)
}

fn run(text: &str, json: &str) -> (String, Outcome) {
    let intent: Intent = serde_json::from_str(json).unwrap_or_else(|e| panic!("{json}: {e}"));
    let out = edit(text, &intent).unwrap_or_else(|e| panic!("{json}: {e}"));
    (apply(text, &out.edits), out)
}

fn refused(text: &str, json: &str) -> String {
    let intent: Intent = serde_json::from_str(json).unwrap_or_else(|e| panic!("{json}: {e}"));
    edit(text, &intent).expect_err(json)
}

/// 光らせる範囲の文字列（編集後のテキストの UTF-16 の位置）。
fn flashed(text: &str, out: &Outcome) -> String {
    let [a, b] = out.flash.expect("光らせる範囲");
    String::from_utf16_lossy(&text.encode_utf16().collect::<Vec<_>>()[a..b])
}

// ---- 要素の追加 ----

#[test]
fn add_node_puts_definition_in_package_of_same_kind() {
    // Arrange（同じ種類が最後に置かれた package に入れる）
    let text = "package A {\n    part def X;\n}\npackage B {\n    requirement def R;\n}\n";
    // Act
    let (after, out) = run(text, r#"{"op":"addNode","kind":"requirement def"}"#);
    // Assert
    assert_eq!(
        after,
        "package A {\n    part def X;\n}\npackage B {\n    requirement def R;\n    requirement def NewRequirement {\n        doc /* ここに要求文を書く */\n    }\n}\n"
    );
    assert_eq!(out.select.as_deref(), Some("NewRequirement"));
    assert!(flashed(&after, &out).contains("requirement def NewRequirement {"));
}

#[test]
fn add_node_picks_unused_name() {
    // Arrange（境界値：NewPart も NewPart2 も使われている）
    let text = "package P { part def NewPart; part def NewPart2; }";
    // Act
    let (_, out) = run(text, r#"{"op":"addNode","kind":"part def"}"#);
    // Assert
    assert_eq!(out.select.as_deref(), Some("NewPart3"));
}

#[test]
fn add_node_writes_phase_only_when_not_inherited() {
    // Arrange
    let defs = "enum def K { enum a; enum b; } metadata def Phase { attribute stage : K; }";
    let text =
        format!("package P {{ {defs} }}\npackage Q {{ @Phase {{ stage = K::a; }} part def X; }}\n");
    // Act（Q は a を継いでいる。a を書かず、b なら書く）
    let (same, _) = run(&text, r#"{"op":"addNode","kind":"part def","phase":"a"}"#);
    let (other, _) = run(&text, r#"{"op":"addNode","kind":"part def","phase":"b"}"#);
    // Assert
    assert!(
        same.contains("part def X; part def NewPart {\n    } }"),
        "{same}"
    );
    assert!(
        other.contains("part def X; part def NewPart {\n        @Phase { stage = K::b; }\n    } }"),
        "{other}"
    );
}

#[test]
fn add_node_without_package_creates_one_before_layout_comment() {
    // Arrange（package が無いファイル。配置の @layout コメントは末尾に残す）
    let text = "// メモ\n/* @layout {} */\n";
    // Act
    let (after, out) = run(
        text,
        r#"{"op":"addNode","kind":"part def","newPackage":"Model"}"#,
    );
    // Assert
    assert_eq!(
        after,
        "// メモ\n\npackage Model {\n    part def NewPart {\n    }\n}\n\n/* @layout {} */\n"
    );
    assert_eq!(out.select.as_deref(), Some("NewPart"));
}

#[test]
fn add_node_without_package_is_refused_unless_asked_to_create_one() {
    // 異常系：package が無く、作る名前も無い・作る名前が使えない
    assert!(refused("part def A;", r#"{"op":"addNode","kind":"part def"}"#).contains("パッケージ"));
    assert!(
        refused(
            "",
            r#"{"op":"addNode","kind":"part def","newPackage":"1x"}"#
        )
        .contains("英字")
    );
}

#[test]
fn add_usage_adds_part_with_lowercase_unique_name() {
    // Arrange
    let text = "package P { part def E; part def C { part e : E; } }";
    // Act
    let (after, out) = run(text, r#"{"op":"addUsage","ctx":"C","type":"E"}"#);
    // Assert
    assert_eq!(
        after,
        "package P { part def E; part def C { part e : E; part e2 : E; } }"
    );
    assert_eq!(out.select.as_deref(), Some("e2"));
}

// ---- 名前の変更 ----

#[test]
fn rename_definition_changes_every_reference_but_not_comments_or_longer_names() {
    // Arrange
    let text = "package P {\n    part def Engine; // Engine の説明\n    part def Car { part e : Engine; }\n    part def EngineX;\n    part def 'Q' { part q : 'Engine'; }\n}";
    // Act
    let (after, out) = run(text, r#"{"op":"rename","key":"Engine","name":"Motor"}"#);
    // Assert
    assert_eq!(
        after,
        "package P {\n    part def Motor; // Engine の説明\n    part def Car { part e : Motor; }\n    part def EngineX;\n    part def 'Q' { part q : 'Motor'; }\n}"
    );
    assert_eq!(out.select.as_deref(), Some("Motor"));
    assert_eq!(flashed(&after, &out), "part def Motor");
}

#[test]
fn rename_definition_keeps_value_operators_and_renames_comment_targets() {
    // Arrange（FeatureValue の `:=`・`default`、Comment の `about`。本文の中の名前は変えない）
    let text = "package P {\n    part def T;\n    part def C { attribute m : T := 1; attribute d : T default 2; }\n    comment about T /* T の説明 */\n}";
    // Act
    let (after, _) = run(text, r#"{"op":"rename","key":"T","name":"U"}"#);
    // Assert
    assert_eq!(
        after,
        "package P {\n    part def U;\n    part def C { attribute m : U := 1; attribute d : U default 2; }\n    comment about U /* T の説明 */\n}"
    );
}

#[test]
fn rename_usage_keeps_initial_and_default_operators() {
    // Arrange（境界値: 名前のすぐ後が `default`。初期値の式の中の参照も変える）
    let text = "package P { part def E; part def C { part e := f; part f : E default e; } }";
    // Act
    let (after, _) = run(text, r#"{"op":"rename","key":"u:f","ctx":"C","name":"g"}"#);
    // Assert
    assert_eq!(
        after,
        "package P { part def E; part def C { part e := g; part g : E default e; } }"
    );
}

#[test]
fn rename_usage_changes_declaration_and_paths_only() {
    // Arrange（使用の名前は、宣言と「名前.」の参照だけを変える。型の名前や a.e の e は変えない）
    let text = "package P { part def E { port e; } part def C { part e : E; part f : E; flow from e.e to f.e; } }";
    // Act
    let (after, _) = run(text, r#"{"op":"rename","key":"u:e","ctx":"C","name":"g"}"#);
    // Assert
    assert_eq!(
        after,
        "package P { part def E { port e; } part def C { part g : E; part f : E; flow from g.e to f.e; } }"
    );
}

#[test]
fn rename_flash_follows_earlier_renamed_references() {
    // Arrange（境界値：宣言より前に参照がある。光らせる範囲が、ずれた後の宣言を指す）
    let text = "package P { part def C { part a : Long; } part def Long; }";
    // Act
    let (after, out) = run(text, r#"{"op":"rename","key":"Long","name":"L"}"#);
    // Assert
    assert_eq!(flashed(&after, &out), "part def L");
}

#[test]
fn rename_writes_non_basic_names_as_quoted_names() {
    // Arrange（同値分割：日本語・空白を含む・数字で始まる・予約語。引用名の参照は引用符の中だけを変える。短い名前は変えない）
    let text = "package P {\n    requirement def <'Kettle'> Kettle;\n    part def C { part k : Kettle; part q : 'Kettle'; }\n}";
    // Act
    let (jp, out) = run(
        text,
        r#"{"op":"rename","key":"Kettle","name":" 電気 ケトル "}"#,
    );
    let (num, _) = run(text, r#"{"op":"rename","key":"Kettle","name":"1A"}"#);
    let (kw, _) = run(text, r#"{"op":"rename","key":"Kettle","name":"part"}"#);
    // Assert
    assert_eq!(
        jp,
        "package P {\n    requirement def <'Kettle'> '電気 ケトル';\n    part def C { part k : '電気 ケトル'; part q : '電気 ケトル'; }\n}"
    );
    assert_eq!(out.select.as_deref(), Some("電気 ケトル"));
    assert_eq!(
        flashed(&jp, &out),
        "requirement def <'Kettle'> '電気 ケトル'"
    );
    assert!(num.contains("part k : '1A'; part q : '1A';"), "{num}");
    assert!(kw.contains("part k : 'part';"), "{kw}");
}

#[test]
fn rename_from_a_quoted_name_back_to_a_basic_name() {
    // Arrange（引用名の定義と使用を、基本名に戻す。宣言は基本名で書き、ほかの引用名の参照は引用符の中だけを変える）
    let text = "package P { part def '電気 ケトル'; part def C { part '中の 部品' : '電気 ケトル'; flow from '中の 部品'.p to x.q; } }";
    // Act
    let (def, _) = run(
        text,
        r#"{"op":"rename","key":"電気 ケトル","name":"Kettle"}"#,
    );
    let (usage, _) = run(
        text,
        r#"{"op":"rename","key":"u:中の 部品","ctx":"C","name":"inner"}"#,
    );
    // Assert
    assert_eq!(
        def,
        "package P { part def Kettle; part def C { part '中の 部品' : 'Kettle'; flow from '中の 部品'.p to x.q; } }"
    );
    assert_eq!(
        usage,
        "package P { part def '電気 ケトル'; part def C { part inner : '電気 ケトル'; flow from 'inner'.p to x.q; } }"
    );
}

#[test]
fn rename_is_refused_for_bad_or_used_names_and_noop_for_same_name() {
    // 同値分割：使えない名前・既にある名前・同じ名前
    let text = "package P { part def A; part def B; }";
    assert!(refused(text, r#"{"op":"rename","key":"A","name":"it's"}"#).contains("使えません"));
    assert!(refused(text, r#"{"op":"rename","key":"A","name":"a\nb"}"#).contains("使えません"));
    assert!(refused(text, r#"{"op":"rename","key":"A","name":"  "}"#).contains("名前を入力"));
    assert!(
        refused(text, r#"{"op":"rename","key":"A","name":"B"}"#).contains("既に使われています")
    );
    let (after, out) = run(text, r#"{"op":"rename","key":"A","name":"A"}"#);
    assert_eq!((after.as_str(), out.edits.len()), (text, 0));
}

#[test]
fn unknown_key_is_refused() {
    // 異常系：テキストが先に変わって、要素が無くなった
    let text = "package P { part def A; }";
    assert!(refused(text, r#"{"op":"rename","key":"Gone","name":"X"}"#).contains("Gone"));
    assert!(refused(text, r#"{"op":"delete","keys":["u:x"],"ctx":"Gone"}"#).contains("Gone"));
}

// ---- 削除 ----

#[test]
fn delete_removes_whole_line_of_definition() {
    // Arrange
    let text = "package P {\n    part def A;\n    part def B;\n}\n";
    // Act
    let (after, _) = run(text, r#"{"op":"delete","keys":["A"]}"#);
    // Assert
    assert_eq!(after, "package P {\n    part def B;\n}\n");
}

#[test]
fn delete_note_removes_the_comment_and_keeps_the_annotated_element() {
    // Arrange（メモのキー。名前の無いメモ `note:#1` と、名前のあるメモ `note:c`）
    let text = "package P {\n    part def A;\n    comment about A /* 1 つ目 */\n    comment c about A /* 2 つ目 */\n}";
    // Act
    let (unnamed, _) = run(text, r#"{"op":"delete","keys":["note:#1"]}"#);
    let (named, _) = run(text, r#"{"op":"delete","keys":["note:c"]}"#);
    // Assert
    assert_eq!(
        unnamed,
        "package P {\n    part def A;\n    comment c about A /* 2 つ目 */\n}"
    );
    assert_eq!(
        named,
        "package P {\n    part def A;\n    comment about A /* 1 つ目 */\n}"
    );
}

#[test]
fn delete_unknown_note_is_refused() {
    // Arrange（異常系: 図に描かないメモ（相手が package）のキーは無い）
    let text = "package P { comment /* p */ }";
    // Act
    let msg = refused(text, r#"{"op":"delete","keys":["note:#1"]}"#);
    // Assert
    assert!(msg.contains("note:#1"), "{msg}");
}

#[test]
fn delete_many_skips_elements_inside_other_selected_elements() {
    // Arrange（C の中の部品と C を両方選ぶ。外側だけ消す）
    let text = "package P {\n    part def A;\n    part def C {\n        part def D;\n    }\n    part def B;\n}\n";
    // Act
    let (after, _) = run(text, r#"{"op":"delete","keys":["D","C","A"]}"#);
    // Assert
    assert_eq!(after, "package P {\n    part def B;\n}\n");
}

#[test]
fn delete_edge_removes_relation_statement() {
    // Arrange
    let text = "package P {\n    part def A;\n    requirement def R;\n    satisfy R by A;\n}\n";
    let id = Doc::new(text)
        .m
        .edges
        .iter()
        .find(|e| e.kind == "satisfy")
        .map(|e| e.id.clone())
        .unwrap_or_default();
    // Act
    let (after, _) = run(text, &format!(r#"{{"op":"deleteEdge","id":"{id}"}}"#));
    // Assert
    assert_eq!(
        after,
        "package P {\n    part def A;\n    requirement def R;\n}\n"
    );
}

#[test]
fn delete_edge_in_internal_block_diagram_uses_context_ids() {
    // Arrange（内部ブロック図の流れと、シーケンス図のメッセージ。ID は UI の views.ts と同じ）
    let text = "package P { part def E; part def C { part a : E; part b : E; flow from a to b; } \
                occurrence def S { part x : E; message m1 from x to x; } }";
    // Act
    let (ibd, _) = run(
        text,
        r#"{"op":"deleteEdge","id":"flow|u:a|u:b|#1","ctx":"C"}"#,
    );
    let (seq, _) = run(text, r#"{"op":"deleteEdge","id":"msg|0|m1","ctx":"S"}"#);
    // Assert
    assert!(
        !ibd.contains("flow from") && ibd.contains("message m1"),
        "{ibd}"
    );
    assert!(
        !seq.contains("message m1") && seq.contains("flow from"),
        "{seq}"
    );
}

/// 内部ブロック図の線の ID（図の対象 `ctx` の中）。
fn ibd_ids(text: &str, ctx: &str) -> Vec<String> {
    let d = Doc::new(text);
    let c = d.context(ctx).expect("図の対象");
    ops::context_edges(&d, c)
        .into_iter()
        .map(|(id, _)| id)
        .collect()
}

#[test]
fn internal_block_diagram_ids_cover_bindings_nary_connections_and_named_flows() {
    // Arrange（結び付け 8.2.2.13.2・n 項の接続 8.2.3.13・名前付きのフロー 8.2.2.16。ID は UI の views.ts と同じ）
    let text = "package P { part def E { port p; } flow def FD; part def C { part a : E; part b : E; part e : E; \
                bind a.p = b.p; connect (a.p, b.p, e.p); connection k connect (a, b, e); \
                flow f : FD from a.p to b.p; connect a.p to z.p; } }";
    // Act
    let ids = ibd_ids(text, "C");
    // Assert（見つからない端 z の線は除く）
    assert_eq!(
        ids,
        [
            "bind|u:a|u:b|=#1",
            "connect|j:#1|u:a|#1",
            "connect|j:#1|u:b|#1",
            "connect|j:#1|u:e|#1",
            "connect|j:k|u:a|#1",
            "connect|j:k|u:b|#1",
            "connect|j:k|u:e|#1",
            "flow|u:a|u:b|f : FD#1",
        ]
    );
}

#[test]
fn internal_block_diagram_ids_reach_parts_one_level_deeper() {
    // Arrange（入れ子の 2 段目：型の中の部品へ `a.x.p` で届く線と、部品の本体に書いた線）
    let text = "package P { part def X { port p; } part def A { port q; part x : X; part z : X; connect q to z.p; } \
                part def C { part a : A { part y : X; connect x.p to y.p; connect p to y.p; } part b : X; \
                part d : A; connect a.x.p to b.p; } }";
    // Act
    let ids = ibd_ids(text, "C");
    // Assert（型の中の接続は、同じ型の部品 a・d のそれぞれに描く）
    assert_eq!(
        ids,
        [
            "flow|u:a|u:a.z|#1",
            "flow|u:d|u:d.z|#1",
            "flow|u:a.x|u:a.y|#1",
            "flow|u:a|u:a.y|#1",
            "flow|u:a.x|u:b|#1"
        ]
    );
}

#[test]
fn delete_edge_removes_a_binding_and_a_whole_nary_connection() {
    // Arrange
    let text = "package P { part def E { port p; } part def C { part a : E; part b : E; part e : E; \
                bind a.p = b.p; connect (a.p, b.p, e.p) { } } }";
    // Act
    let (no_bind, _) = run(
        text,
        r#"{"op":"deleteEdge","id":"bind|u:a|u:b|=#1","ctx":"C"}"#,
    );
    let (no_nary, _) = run(
        text,
        r#"{"op":"deleteEdge","id":"connect|j:#1|u:e|#1","ctx":"C"}"#,
    );
    // Assert（n 項の接続は、どの端の線を消しても接続ごと消す）
    assert!(
        !no_bind.contains("bind") && no_bind.contains("connect ("),
        "{no_bind}"
    );
    assert!(
        !no_nary.contains("connect (") && no_nary.contains("bind"),
        "{no_nary}"
    );
}

#[test]
fn nested_part_and_junction_keys_are_found_in_the_context() {
    // Arrange（`u:a.x` は型の中の部品、`j:k` は n 項の接続の使用）
    let text = "package P { part def X; part def A { part x : X; } part def C { part a : A; part b : X; \
                part e : X; connection k connect (a, b, e); } }";
    // Act
    let (renamed, _) = run(
        text,
        r#"{"op":"rename","key":"u:a.x","name":"w","ctx":"C"}"#,
    );
    let (deleted, _) = run(text, r#"{"op":"delete","keys":["j:k"],"ctx":"C"}"#);
    // Assert
    assert!(renamed.contains("part w : X;"), "{renamed}");
    assert!(!deleted.contains("connection k"), "{deleted}");
    assert!(refused(text, r#"{"op":"delete","keys":["u:a.zz"],"ctx":"C"}"#).contains("u:a.zz"));
}

#[test]
fn connect_flow_to_a_nested_part_writes_its_path() {
    // Arrange（入れ子の部品 `u:a.x` へ、内部ブロック図で流れを引く）
    let text = "package P { part def X { port i; } part def A { part x : X; } part def B { port o; } \
                part def C { part a : A; part b : B; } }";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"connect","rel":"flow","from":"u:b","to":"u:a.x","fromPort":"o","toPort":"i","ctx":"C"}"#,
    );
    // Assert
    assert!(after.contains("flow from b.o to a.x.i;"), "{after}");
}

#[test]
fn ibd_ids_follow_chains_of_three_levels_into_nested_parts() {
    // Arrange（特徴の連鎖 a.x.v.p（8.2.2.6）の端は、型の中をたどった部品 u:a.x.v）
    let text = "package P { part def V { port p; } part def X { part v : V; } part def A { part x : X; } \
                part def C { part a : A; part b : V; connect a.x.v.p to b.p; } }";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"deleteEdge","id":"flow|u:a.x.v|u:b|#1","ctx":"C"}"#,
    );
    let (renamed, _) = run(
        text,
        r#"{"op":"rename","key":"u:a.x.v","name":"valve","ctx":"C"}"#,
    );
    // Assert
    assert!(!after.contains("connect a.x.v.p to b.p;"), "{after}");
    assert!(renamed.contains("part valve : V;"), "{renamed}");
}

#[test]
fn delete_edge_with_unknown_id_is_refused() {
    assert!(refused("package P { }", r#"{"op":"deleteEdge","id":"x"}"#).contains("関係"));
}

// ---- 関係の追加 ----

#[test]
fn connect_writes_each_relation_kind() {
    // Arrange
    let text = "package P {\n    part def A;\n    part def B;\n    requirement def R;\n    requirement def S;\n    concern def K;\n    verification def V;\n}\n";
    let cases = [
        (
            r#"{"op":"connect","rel":"comp","from":"A","to":"B"}"#,
            "part def A {\n        part b : B;\n    }",
        ),
        (
            r#"{"op":"connect","rel":"satisfy","from":"A","to":"R"}"#,
            "    satisfy R by A;\n}",
        ),
        (
            r#"{"op":"connect","rel":"verify","from":"V","to":"R"}"#,
            "verification def V {\n        objective { verify R; }\n    }",
        ),
        (
            r#"{"op":"connect","rel":"frame","from":"R","to":"K"}"#,
            "requirement def R {\n        frame concern k : K;\n    }",
        ),
        (
            r#"{"op":"connect","rel":"derive","from":"R","to":"S"}"#,
            "    #derivation dependency from R to S;\n}",
        ),
    ];
    for (json, want) in cases {
        // Act
        let (after, out) = run(text, json);
        // Assert
        assert!(after.contains(want), "{json}\n{after}");
        assert!(out.flash.is_some(), "{json}");
    }
}

#[test]
fn connect_verify_adds_to_existing_objective() {
    // Arrange
    let text = "package P { requirement def R; requirement def S; verification def V { objective { verify R; } } }";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"connect","rel":"verify","from":"V","to":"S"}"#,
    );
    // Assert
    assert_eq!(
        after,
        "package P { requirement def R; requirement def S; verification def V { objective { verify R; verify S; } } }"
    );
}

#[test]
fn connect_flow_between_parts_and_ports() {
    // Arrange
    let text = "package P { part def E; part def F; part def C { part e : E; part f : F; } }";
    // Act（定義どうし：両方を部品に持つ定義に書く。内部ブロック図の部品どうし：ポートつき）
    let (defs, _) = run(text, r#"{"op":"connect","rel":"flow","from":"E","to":"F"}"#);
    let (usages, _) = run(
        text,
        r#"{"op":"connect","rel":"flow","from":"u:e","to":"u:f","fromPort":"o","toPort":"i","ctx":"C"}"#,
    );
    // Assert
    assert!(defs.contains("part f : F; flow from e to f; }"), "{defs}");
    assert!(usages.contains("flow from e.o to f.i;"), "{usages}");
}

#[test]
fn connect_is_refused_when_flow_has_no_place_or_kind_is_unknown() {
    // 異常系
    let text = "package P { part def E; part def F; }";
    assert!(refused(text, r#"{"op":"connect","rel":"flow","from":"E","to":"F"}"#).contains("流れ"));
    assert!(
        refused(
            text,
            r#"{"op":"connect","rel":"bogus","from":"E","to":"F"}"#
        )
        .contains("bogus")
    );
}

// ---- 位置 ----

#[test]
fn edits_and_flash_are_utf16_positions() {
    // Arrange（境界値：前に多バイト文字とサロゲートペアがある）
    let text = "package P {\n    // 日本語 🚀\n    part def A;\n}\n";
    // Act
    let (after, out) = run(text, r#"{"op":"rename","key":"A","name":"Bb"}"#);
    // Assert
    assert_eq!(
        after,
        "package P {\n    // 日本語 🚀\n    part def Bb;\n}\n"
    );
    assert_eq!(flashed(&after, &out), "part def Bb");
}

#[test]
fn diff_keeps_surrogate_pairs_whole() {
    // 境界値：同じ上位サロゲートを持つ 2 つの絵文字
    let (s, e, t) = diff("a😀b", "a😁b").unwrap_or_default();
    assert_eq!((s, e, t.as_str()), (1, 3, "😁"));
    assert_eq!(diff("same", "same"), None);
}

#[test]
fn remove_range_keeps_text_on_same_line() {
    // 同値分割：行全体・行の一部
    assert_eq!(remove_range("a\n  b;\nc", 4, 6), ("a\nc".to_owned(), 2));
    assert_eq!(remove_range("x; b; y", 3, 5), ("x; y".to_owned(), 3));
}

#[test]
fn utf16_of_counts_up_to_the_start_of_the_character() {
    // 同値分割：文字の境目・サロゲートペアの文字の途中・範囲外。境界値：0 と末尾
    assert_eq!(utf16_of("a🚀b", 0), 0);
    assert_eq!(utf16_of("a🚀b", 5), 3);
    assert_eq!(utf16_of("a🚀b", 6), 4);
    assert_eq!(utf16_of("a🚀b", 2), 1, "文字の途中は文字の先頭");
    assert_eq!(utf16_of("a🚀b", 9), 4, "範囲外は全体の長さ");
}

#[test]
fn line_start_clamps_to_the_text_like_the_ts_core() {
    // 同値分割：行の中・文字の途中・範囲外。境界値：改行の直後と末尾
    assert_eq!(line_start("ab\ncd", 4), 3);
    assert_eq!(line_start("ab\ncd", 3), 3);
    assert_eq!(line_start("ab\ncd", 5), 3);
    assert_eq!(line_start("x\né", 3), 2, "文字の途中は、その文字の行");
    assert_eq!(
        line_start("ab\ncd", 9),
        3,
        "範囲外は最後の行（web の lineStart と同じ）"
    );
    assert_eq!(indent_at("x\n  y", 99), "  ");
}

#[test]
fn indent_at_keeps_spaces_and_tabs_of_the_line() {
    // 同値分割：空白とタブの混じった字下げ・字下げなし
    assert_eq!(indent_at("x\n \t  y", 5), " \t  ");
    assert_eq!(indent_at("x", 0), "");
}

#[test]
fn insert_into_puts_the_line_in_the_block_or_turns_the_declaration_into_one() {
    // 同値分割：閉じ括弧だけの行がある・閉じ括弧が同じ行にある・`;` で終わる宣言
    let block = |close| Target {
        start: 0,
        head_end: 11,
        close: Some(close),
    };
    assert_eq!(
        insert_into("part def A {\n}\n", block(13), "part b : B;").0,
        "part def A {\n    part b : B;\n}\n"
    );
    assert_eq!(
        insert_into("part def A {}", block(12), "part b : B;"),
        ("part def A { part b : B; }".to_owned(), 12, 25)
    );
    let decl = Target {
        start: 2,
        head_end: 12,
        close: None,
    };
    assert_eq!(
        insert_into("  part def A;", decl, "part b : B;").0,
        "  part def A {\n      part b : B;\n  }"
    );
}

#[test]
fn bad_intent_json_is_rejected_by_serde() {
    // 異常系：知らない操作・欠けた項目
    assert!(serde_json::from_str::<Intent>(r#"{"op":"explode"}"#).is_err());
    assert!(serde_json::from_str::<Intent>(r#"{"op":"rename","key":"A"}"#).is_err());
}

#[test]
fn random_intents_never_panic() {
    // Arrange（ファジング：いろいろなテキストに、いろいろなキーで操作を当てる。断るのはよいが panic しない）
    let texts = [
        "",
        "package P {",
        "package P { part def A { part b : B; } part def B; requirement def R; satisfy R by A; }",
        "package P { part def C { part a : A; part b : A; flow from a.x to b.y; } occurrence def S { part l : A; message m from l to l; } }",
        "part def A; /* @layout {} */ 'q'",
        "package 🚀 { part def 日本語; }",
    ];
    let keys = ["A", "B", "R", "C", "S", "u:a", "l:l", "", "u:", "日本語"];
    for text in texts {
        for k in keys {
            for op in [
                format!(r#"{{"op":"rename","key":"{k}","name":"Z","ctx":"C"}}"#),
                format!(r#"{{"op":"delete","keys":["{k}","A"],"ctx":"S"}}"#),
                format!(r#"{{"op":"deleteEdge","id":"{k}","ctx":"C"}}"#),
                format!(r#"{{"op":"addUsage","ctx":"{k}","type":"A"}}"#),
                format!(r#"{{"op":"addNode","kind":"{k}","phase":"x","newPackage":"N"}}"#),
                format!(r#"{{"op":"connect","rel":"flow","from":"{k}","to":"B","ctx":"C"}}"#),
                format!(r#"{{"op":"connect","rel":"verify","from":"{k}","to":"R"}}"#),
                format!(r#"{{"op":"addMessage","ctx":"{k}","from":"l:l","to":"l:{k}"}}"#),
                format!(r#"{{"op":"moveMessage","ctx":"S","id":"{k}","dir":1}}"#),
                format!(r#"{{"op":"setPhase","keys":["{k}","A"],"value":"{k}"}}"#),
                format!(r#"{{"op":"initPhases","newPackage":"{k}"}}"#),
                format!(
                    r#"{{"op":"makePort","key":"{k}","name":"p","dir":"in","flows":[{{"id":"{k}","from":true}}],"ctx":"C"}}"#
                ),
                format!(r#"{{"op":"setPortDir","key":"{k}","port":"x","dir":"out","ctx":"C"}}"#),
                format!(
                    r#"{{"op":"saveView","name":"{k}","kind":"general","targets":["A","{k}"]}}"#
                ),
                format!(r#"{{"op":"removeFromView","view":"{k}","key":"A"}}"#),
            ] {
                let intent: Intent =
                    serde_json::from_str(&op).unwrap_or_else(|e| panic!("{op}: {e}"));
                // Act・Assert（panic しない。編集は古いテキストの範囲に収まる）
                if let Ok(out) = edit(text, &intent) {
                    let len = text.encode_utf16().count();
                    assert!(
                        out.edits.iter().all(|e| e.start <= e.end && e.end <= len),
                        "{text} {op}"
                    );
                }
            }
        }
    }
}

// ---- メッセージ ----

const SEQ: &str = "package P { part def E; occurrence def S {\n    part a : E; part b : E;\n    message m1 from a to b;\n    then message m2 of Sig from b to a;\n} }";

#[test]
fn add_message_names_next_number_and_keeps_then() {
    // Act
    let (after, out) = run(
        SEQ,
        r#"{"op":"addMessage","ctx":"S","from":"l:b","to":"l:a"}"#,
    );
    // Assert（前のメッセージが then で始まるので then を付ける）
    assert!(
        after
            .contains("then message m2 of Sig from b to a;\n    then message msg3 from b to a;\n}"),
        "{after}"
    );
    assert_eq!(out.select.as_deref(), Some("msg3"));
}

#[test]
fn update_message_rewrites_name_and_type_keeping_then() {
    // Act（名前と型を変える・型を外す）
    let (typed, _) = run(
        SEQ,
        r#"{"op":"updateMessage","ctx":"S","id":"msg|1|m2","name":"go","type":"Cmd"}"#,
    );
    let (bare, _) = run(
        SEQ,
        r#"{"op":"updateMessage","ctx":"S","id":"msg|1|m2","name":"","type":""}"#,
    );
    // Assert
    assert!(
        typed.contains("then message go of Cmd from b to a;"),
        "{typed}"
    );
    assert!(bare.contains("then message from b to a;"), "{bare}");
    assert!(
        refused(
            SEQ,
            r#"{"op":"updateMessage","ctx":"S","id":"msg|1|m2","name":"1x","type":""}"#
        )
        .contains("英字")
    );
}

#[test]
fn move_message_swaps_statements_but_keeps_then_in_place() {
    // Act
    let (after, _) = run(
        SEQ,
        r#"{"op":"moveMessage","ctx":"S","id":"msg|1|m2","dir":-1}"#,
    );
    // Assert
    assert!(
        after.contains("    message m2 of Sig from b to a;\n    then message m1 from a to b;\n"),
        "{after}"
    );
    // 境界値：先頭より上・末尾より下には動かせない
    assert!(
        refused(
            SEQ,
            r#"{"op":"moveMessage","ctx":"S","id":"msg|0|m1","dir":-1}"#
        )
        .contains("動かせません")
    );
    assert!(
        refused(
            SEQ,
            r#"{"op":"moveMessage","ctx":"S","id":"msg|1|m2","dir":1}"#
        )
        .contains("動かせません")
    );
}

#[test]
fn delete_edge_removes_a_succession_between_events_of_the_sequence() {
    // Arrange（シーケンス図のイベントの間の順序の線、8.2.3.9 の sq-succession）
    let text = "package P { occurrence def S {\n    part a { event occurrence e; }\n    part b { event occurrence r; }\n    first a.e then b.r;\n} }";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"deleteEdge","id":"succession|e:a.e|e:b.r|#1","ctx":"S"}"#,
    );
    // Assert
    assert!(!after.contains("first a.e then b.r;"), "{after}");
    assert!(
        after.contains("part b { event occurrence r; }\n} }"),
        "{after}"
    );
}

// ---- フェーズ ----

const PH: &str = "package P {\n    enum def K { enum a; enum b; }\n    metadata def Phase { attribute stage : K; }\n    part def A { @Phase { stage = K::a; } }\n    part def B;\n}\npackage Q { @Phase { stage = K::b; } part def C; }\n";

#[test]
fn set_phase_replaces_value_or_adds_block() {
    // Act
    let (replaced, _) = run(PH, r#"{"op":"setPhase","keys":["A"],"value":"b"}"#);
    let (added, _) = run(PH, r#"{"op":"setPhase","keys":["B"],"value":"a"}"#);
    // Assert
    assert!(
        replaced.contains("part def A { @Phase { stage = K::b; } }"),
        "{replaced}"
    );
    assert!(
        added.contains("part def B {\n        @Phase { stage = K::a; }\n    }"),
        "{added}"
    );
}

#[test]
fn set_phase_empty_removes_own_block_but_not_inherited_one() {
    // Act・Assert（自分に書いた指定は外せる。継承しているものは外せない・同じ値は書かない）
    let (removed, _) = run(PH, r#"{"op":"setPhase","keys":["A"],"value":""}"#);
    assert!(removed.contains("part def A { }"), "{removed}");
    assert!(refused(PH, r#"{"op":"setPhase","keys":["C"],"value":""}"#).contains("継承"));
    assert!(refused(PH, r#"{"op":"setPhase","keys":["C"],"value":"b"}"#).contains("継承"));
}

#[test]
fn set_phase_many_sets_each_definition() {
    // Act
    let (after, _) = run(PH, r#"{"op":"setPhase","keys":["A","B"],"value":"b"}"#);
    // Assert
    assert!(
        after.contains("part def A { @Phase { stage = K::b; } }"),
        "{after}"
    );
    assert!(
        after.contains("part def B {\n        @Phase { stage = K::b; }\n    }"),
        "{after}"
    );
}

#[test]
fn set_phase_without_phase_definition_is_refused() {
    assert!(
        refused(
            "package P { part def A; }",
            r#"{"op":"setPhase","keys":["A"],"value":"x"}"#
        )
        .contains("フェーズ")
    );
}

#[test]
fn init_phases_adds_definitions_to_first_package_or_new_one() {
    // Act
    let (after, _) = run(
        "package P {\n    part def A;\n}\n",
        r#"{"op":"initPhases"}"#,
    );
    let (fresh, _) = run("", r#"{"op":"initPhases","newPackage":"M"}"#);
    // Assert（足した定義でフェーズが使えるようになる）
    for t in [&after, &fresh] {
        assert_eq!(Doc::new(t).m.phases.map(|p| p.len()), Some(4), "{t}");
    }
    assert!(fresh.starts_with("package M {\n"), "{fresh}");
    assert!(refused("package P;", r#"{"op":"initPhases"}"#).contains("{ }"));
}

// ---- ポート ----

const PORTS: &str = "package P {\n    part def E { out port o; }\n    part def C {\n        part a : E;\n        part b : E;\n        flow from a to b;\n    }\n}\n";

#[test]
fn make_port_adds_declaration_and_rewires_flows() {
    // Act（内部ブロック図の部品 b に、線の行き先の接続点からポートを作る。宣言は型の定義 E に書く）
    let (after, out) = run(
        PORTS,
        r#"{"op":"makePort","key":"u:b","ctx":"C","name":"i","dir":"in","type":"Sig","flows":[{"id":"flow|u:a|u:b|#1","to":true}]}"#,
    );
    // Assert
    assert!(
        after.contains("part def E { out port o; in port i : Sig; }"),
        "{after}"
    );
    assert!(after.contains("flow from a to b.i;"), "{after}");
    assert_eq!(flashed(&after, &out).trim(), "in port i : Sig;");
}

#[test]
fn make_port_is_refused_for_used_or_bad_names() {
    assert!(
        refused(
            PORTS,
            r#"{"op":"makePort","key":"E","name":"o","dir":"in"}"#
        )
        .contains("既に使われています")
    );
    assert!(
        refused(
            PORTS,
            r#"{"op":"makePort","key":"E","name":"x y","dir":"in"}"#
        )
        .contains("英字")
    );
    assert!(
        refused(
            PORTS,
            r#"{"op":"makePort","key":"E","name":"x","dir":"up"}"#
        )
        .contains("up")
    );
}

#[test]
fn set_port_dir_and_delete_port() {
    // Act
    let (dir, _) = run(
        PORTS,
        r#"{"op":"setPortDir","key":"E","port":"o","dir":"inout"}"#,
    );
    let (del, _) = run(
        PORTS,
        r#"{"op":"deletePort","key":"u:a","ctx":"C","port":"o"}"#,
    );
    // Assert
    assert!(dir.contains("part def E { inout port o; }"), "{dir}");
    assert!(del.contains("part def E { }"), "{del}");
}

// ---- 保存された図 ----

#[test]
fn sysml_name_quotes_non_basic_names_and_keywords() {
    // 同値分割：基本名・日本語・空白・予約語・引用符（境界値）
    assert_eq!(sysml_name("Kettle_1"), "Kettle_1");
    assert_eq!(
        ["全体図", "my view", "part"].map(sysml_name),
        ["'全体図'", "'my view'", "'part'"]
    );
    assert_eq!(sysml_name("it's"), "'it\\'s'");
}

#[test]
fn save_view_writes_view_with_one_expose_per_element() {
    // Arrange
    let text = "package P {\n    part def A;\n    part def '電気 ケトル';\n}\n";
    // Act
    let (after, out) = run(
        text,
        r#"{"op":"saveView","name":"全体","kind":"general","targets":["A","電気 ケトル"]}"#,
    );
    // Assert（書いた view を読むと、同じ要素を出す）
    assert!(after.contains("    view '全体' : GeneralView {\n        expose P::A;\n        expose P::'電気 ケトル';\n    }\n}"), "{after}");
    assert_eq!(out.select.as_deref(), Some("全体"));
    assert_eq!(Doc::new(&after).m.views[0].node_keys, ["A", "電気 ケトル"]);
}

#[test]
fn save_action_flow_writes_an_action_flow_view() {
    // Arrange（アクションの流れの図は、対象のアクション定義を expose する ActionFlowView）
    let text = "package P {\n    action def A {\n        action a;\n    }\n}\n";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"saveView","name":"流れ","kind":"actionFlow","targets":["A"]}"#,
    );
    // Assert
    assert!(
        after.contains("    view '流れ' : ActionFlowView {\n        expose P::A;\n    }\n}"),
        "{after}"
    );
    assert_eq!(Doc::new(&after).m.views[0].kind, "actionFlow");
}

#[test]
fn save_state_machine_writes_a_state_transition_view() {
    // Arrange（状態遷移の図は、対象の状態定義を expose する StateTransitionView）
    let text = "package P {\n    state def S {\n        state a;\n    }\n}\n";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"saveView","name":"遷移","kind":"stateTransition","targets":["S"]}"#,
    );
    // Assert
    assert!(
        after.contains("    view '遷移' : StateTransitionView {\n        expose P::S;\n    }\n}"),
        "{after}"
    );
    assert_eq!(Doc::new(&after).m.views[0].kind, "stateTransition");
}

#[test]
fn save_view_is_refused_without_name_targets_or_with_used_name() {
    let text = "package P { part def A; view v; }";
    assert!(
        refused(
            text,
            r#"{"op":"saveView","name":" ","kind":"general","targets":["A"]}"#
        )
        .contains("名前")
    );
    assert!(
        refused(
            text,
            r#"{"op":"saveView","name":"v","kind":"general","targets":["A"]}"#
        )
        .contains("既にあります")
    );
    assert!(
        refused(
            text,
            r#"{"op":"saveView","name":"w","kind":"actionFlow","targets":[]}"#
        )
        .contains("対象を選んで")
    );
    assert!(
        refused(
            "part def A;",
            r#"{"op":"saveView","name":"w","kind":"general","targets":[]}"#
        )
        .contains("パッケージがありません")
    );
}

#[test]
fn save_view_makes_an_empty_general_view() {
    // Arrange：一般の図は、要素の無い空の図も作れる（F-VIEW-8）
    let text = "package P {\n    part def A;\n}\n";
    // Act
    let (after, _) = run(
        text,
        r#"{"op":"saveView","name":"新しい図","kind":"general","targets":[]}"#,
    );
    // Assert
    assert!(
        after.contains("    view '新しい図' : GeneralView {\n    }\n}"),
        "{after}"
    );
    let m = Doc::new(&after).m;
    assert_eq!(m.views[0].name, "新しい図");
    assert!(m.views[0].node_keys.is_empty());
}

#[test]
fn rename_view_rewrites_only_the_view_name() {
    // Arrange：基本名から引用名へ・引用名から基本名へ（同値分割）
    let text = "package P {\n    part def v;\n    view v : GeneralView {\n        expose P::v;\n    }\n    view 'その他' { }\n}\n";
    // Act
    let (to_quoted, _) = run(text, r#"{"op":"renameView","view":"v","name":"全体"}"#);
    let (to_basic, _) = run(
        text,
        r#"{"op":"renameView","view":"その他","name":" Other "}"#,
    );
    let (same, out) = run(text, r#"{"op":"renameView","view":"v","name":"v"}"#);
    // Assert：同じ名前の部品定義 v と expose の P::v は変えない
    assert!(
        to_quoted
            .contains("    part def v;\n    view '全体' : GeneralView {\n        expose P::v;"),
        "{to_quoted}"
    );
    assert!(to_basic.contains("    view Other { }"), "{to_basic}");
    assert_eq!(same, text);
    assert!(out.edits.is_empty());
    let names: Vec<String> = Doc::new(&to_quoted)
        .m
        .views
        .iter()
        .map(|v| v.name.clone())
        .collect();
    assert_eq!(names, ["全体", "その他"]);
}

#[test]
fn rename_view_is_refused_for_empty_used_or_missing_names() {
    let text = "package P { view v; view w; }";
    assert!(refused(text, r#"{"op":"renameView","view":"v","name":"w"}"#).contains("既にあります"));
    assert!(refused(text, r#"{"op":"renameView","view":"v","name":" "}"#).contains("名前を入力"));
    assert!(refused(text, r#"{"op":"renameView","view":"gone","name":"x"}"#).contains("gone"));
}

#[test]
fn delete_view_keeps_the_exposed_elements() {
    // Arrange
    let text = "package P {\n    part def A;\n    view v {\n        expose P::A;\n    }\n}\n";
    // Act
    let (after, _) = run(text, r#"{"op":"deleteView","view":"v"}"#);
    // Assert
    assert_eq!(after, "package P {\n    part def A;\n}\n");
    assert!(refused(text, r#"{"op":"deleteView","view":"gone"}"#).contains("gone"));
}

#[test]
fn add_to_and_remove_from_view() {
    // Arrange
    let text = "package P {\n    part def A;\n    part def B;\n    view v {\n        expose P::A;\n    }\n}\n";
    // Act
    let (added, _) = run(text, r#"{"op":"addToView","view":"v","key":"B"}"#);
    let (removed, _) = run(text, r#"{"op":"removeFromView","view":"v","key":"A"}"#);
    // Assert
    assert!(
        added.contains("        expose P::A;\n        expose P::B;\n    }"),
        "{added}"
    );
    assert!(removed.contains("    view v {\n    }"), "{removed}");
    assert!(refused(text, r#"{"op":"addToView","view":"v","key":"A"}"#).contains("既に"));
    assert!(refused(text, r#"{"op":"removeFromView","view":"v","key":"B"}"#).contains("まとめて"));
    assert!(refused(text, r#"{"op":"addToView","view":"gone","key":"B"}"#).contains("gone"));
}

// ---- アクションの流れの図（ActionFlowView、8.2.3.17） ----

const FLOW: &str = "package P {\n    action def A {\n        first start;\n        then action a;\n        then decide d;\n        if x > 0 then b;\n        else c;\n        action b;\n        action c;\n        first b then done;\n    }\n}\n";

#[test]
fn delete_succession_line_removes_its_statement() {
    // Arrange（同値分割：ガード付きの継起の文・first … then の文）
    let guarded = r#"{"op":"deleteEdge","id":"succession|a:d|a:b|[x > 0]#1","ctx":"A"}"#;
    let to_done = r#"{"op":"deleteEdge","id":"succession|a:b|a:done|#1","ctx":"A"}"#;
    // Act
    let (after_guarded, _) = run(FLOW, guarded);
    let (after_done, _) = run(FLOW, to_done);
    // Assert
    assert!(!after_guarded.contains("if x > 0 then b;"));
    assert!(after_guarded.contains("        else c;\n        action b;"));
    assert!(!after_done.contains("first b then done;"));
}

#[test]
fn delete_succession_written_with_then_keeps_the_action() {
    // Arrange（then action a; の継起は then だけを消す）
    let id = r#"{"op":"deleteEdge","id":"succession|a:start|a:a|#1","ctx":"A"}"#;
    // Act
    let (after, _) = run(FLOW, id);
    // Assert
    assert!(
        after.contains("        first start;\n        action a;\n"),
        "{after}"
    );
}

#[test]
fn delete_and_rename_action_in_the_flow() {
    // Arrange（a: のキーの要素は、アクション定義の中の宣言）
    let del = r#"{"op":"delete","keys":["a:c"],"ctx":"A"}"#;
    let ren = r#"{"op":"rename","key":"a:d","name":"check","ctx":"A"}"#;
    // Act
    let (deleted, _) = run(FLOW, del);
    let (renamed, _) = run(FLOW, ren);
    // Assert
    assert!(!deleted.contains("action c;"));
    assert!(renamed.contains("then decide check;"), "{renamed}");
}

#[test]
fn start_and_done_cannot_be_deleted_on_their_own() {
    // Arrange（異常系：暗黙の開始は宣言を持たない）
    let del = r#"{"op":"delete","keys":["a:start"],"ctx":"A"}"#;
    // Act
    let why = refused(FLOW, del);
    // Assert
    assert!(why.contains("開始と終了の記号"), "{why}");
}

#[test]
fn unknown_flow_line_or_element_is_refused() {
    // Arrange（異常系：無い ID・無い要素）
    let line = r#"{"op":"deleteEdge","id":"succession|a:x|a:y|#1","ctx":"A"}"#;
    let node = r#"{"op":"delete","keys":["a:x"],"ctx":"A"}"#;
    // Act / Assert
    assert!(refused(FLOW, line).contains("関係"));
    assert!(refused(FLOW, node).contains("a:x"));
}

#[test]
fn connect_succession_writes_first_then_in_the_definition() {
    // Arrange（同値分割：アクションどうし・終了へ、8.2.2.14）
    let to_c = r#"{"op":"connect","rel":"succession","from":"a:a","to":"a:c","ctx":"A"}"#;
    let to_done = r#"{"op":"connect","rel":"succession","from":"a:c","to":"a:done","ctx":"A"}"#;
    // Act
    let (after, out) = run(FLOW, to_c);
    let (done, _) = run(FLOW, to_done);
    // Assert
    assert!(
        after.ends_with("        first b then done;\n        first a then c;\n    }\n}\n"),
        "{after}"
    );
    assert_eq!(flashed(&after, &out).trim(), "first a then c;");
    assert!(done.contains("        first c then done;\n    }"), "{done}");
}

#[test]
fn connect_succession_refuses_start_targets_and_unnamed_elements() {
    // Arrange（異常系：開始へ・終了から・名前の無い要素）
    let text =
        "package P {\n    action def A {\n        action a;\n        send x to y;\n    }\n}\n";
    let into_start = r#"{"op":"connect","rel":"succession","from":"a:b","to":"a:start","ctx":"A"}"#;
    let from_done = r#"{"op":"connect","rel":"succession","from":"a:done","to":"a:b","ctx":"A"}"#;
    let unnamed = r#"{"op":"connect","rel":"succession","from":"a:a","to":"a:#1","ctx":"A"}"#;
    // Act / Assert
    assert!(refused(FLOW, into_start).contains("開始の記号"));
    assert!(refused(FLOW, from_done).contains("終了の記号"));
    assert!(refused(text, unnamed).contains("名前の無い要素"));
}

// ---- 状態遷移の図（StateTransitionView、8.2.3.18） ----

const STATES: &str = "package P {\n    state def S {\n        entry; then off;\n        state off;\n        accept Go then on;\n        state on {\n            entry; then low;\n            state low;\n            state high;\n        }\n        transition t first on accept Stop if ready do beep then off;\n    }\n}\n";

#[test]
fn delete_transition_line_removes_its_statement() {
    // Arrange（同値分割：transition の文・状態の中の省略形の遷移・最初の遷移）
    let full =
        r#"{"op":"deleteEdge","id":"transition|s:on|s:off|Stop [ready] / beep#1","ctx":"S"}"#;
    let shorthand = r#"{"op":"deleteEdge","id":"transition|s:off|s:on|Go#1","ctx":"S"}"#;
    let initial = r#"{"op":"deleteEdge","id":"transition|s:on#start|s:on.low|#1","ctx":"S"}"#;
    // Act
    let (after_full, _) = run(STATES, full);
    let (after_shorthand, _) = run(STATES, shorthand);
    let (after_initial, _) = run(STATES, initial);
    // Assert
    assert!(!after_full.contains("transition t"), "{after_full}");
    assert!(
        after_shorthand.contains("        state off;\n        state on {"),
        "{after_shorthand}"
    );
    assert!(
        after_initial.contains("            entry; \n            state low;"),
        "{after_initial}"
    );
}

#[test]
fn delete_and_rename_nested_state() {
    // Arrange（s: のキーの要素は、状態定義の中の状態。入れ子は s:外.中）
    let del = r#"{"op":"delete","keys":["s:on.high"],"ctx":"S"}"#;
    let ren = r#"{"op":"rename","key":"s:off","name":"idle","ctx":"S"}"#;
    // Act
    let (deleted, _) = run(STATES, del);
    let (renamed, _) = run(STATES, ren);
    // Assert
    assert!(!deleted.contains("state high;"));
    assert!(renamed.contains("state idle;"), "{renamed}");
}

#[test]
fn start_symbol_of_a_state_machine_cannot_be_deleted() {
    // Arrange（異常系：開始の記号は宣言を持たない）
    let del = r#"{"op":"delete","keys":["s:#start"],"ctx":"S"}"#;
    // Act
    let why = refused(STATES, del);
    // Assert
    assert!(why.contains("開始と終了の記号"), "{why}");
}

#[test]
fn unknown_transition_or_state_is_refused() {
    // Arrange（異常系：無い ID・無い状態）
    let line = r#"{"op":"deleteEdge","id":"transition|s:x|s:y|#1","ctx":"S"}"#;
    let node = r#"{"op":"delete","keys":["s:x"],"ctx":"S"}"#;
    // Act / Assert
    assert!(refused(STATES, line).contains("関係"));
    assert!(refused(STATES, node).contains("s:x"));
}

#[test]
fn connect_transition_writes_it_in_the_body_of_both_states() {
    // Arrange（同値分割：状態定義の直下どうし・同じ状態の中どうし・終了へ、8.2.2.18）
    let top = r#"{"op":"connect","rel":"transition","from":"s:off","to":"s:on","ctx":"S"}"#;
    let inner =
        r#"{"op":"connect","rel":"transition","from":"s:on.low","to":"s:on.high","ctx":"S"}"#;
    // Act
    let (after_top, out) = run(STATES, top);
    let (after_inner, _) = run(STATES, inner);
    // Assert
    assert!(
        after_top.ends_with("then off;\n        transition first off then on;\n    }\n}\n"),
        "{after_top}"
    );
    assert_eq!(
        flashed(&after_top, &out).trim(),
        "transition first off then on;"
    );
    assert!(
        after_inner.contains(
            "            state high;\n            transition first low then high;\n        }"
        ),
        "{after_inner}"
    );
}

#[test]
fn connect_transition_between_bodies_uses_the_path_from_the_definition() {
    // Arrange（境界値：入れ子の状態から外の状態へ。名前の道のりで書く）
    let id = r#"{"op":"connect","rel":"transition","from":"s:on.high","to":"s:off","ctx":"S"}"#;
    // Act
    let (after, _) = run(STATES, id);
    // Assert
    assert!(
        after.contains("        transition first on.high then off;\n    }\n}\n"),
        "{after}"
    );
}

#[test]
fn connect_transition_refuses_start_and_done_misuse_and_unnamed_states() {
    // Arrange（異常系：開始へ・開始から・別の本体の終了へ・名前の無い状態）
    let text = "package P {\n    state def S {\n        state a;\n        state;\n        state b { state x; transition first x then done; }\n    }\n}\n";
    let into_start =
        r#"{"op":"connect","rel":"transition","from":"s:off","to":"s:#start","ctx":"S"}"#;
    let from_start =
        r#"{"op":"connect","rel":"transition","from":"s:#start","to":"s:on","ctx":"S"}"#;
    let other_done =
        r#"{"op":"connect","rel":"transition","from":"s:a","to":"s:b#done","ctx":"S"}"#;
    let unnamed = r#"{"op":"connect","rel":"transition","from":"s:a","to":"s:#1","ctx":"S"}"#;
    // Act / Assert
    assert!(refused(STATES, into_start).contains("開始の記号へ"));
    assert!(refused(STATES, from_start).contains("開始の記号から"));
    assert!(refused(text, other_done).contains("終了の記号へは"));
    assert!(refused(text, unnamed).contains("名前の無い状態"));
}

// ---- 説明（doc）の編集（F-EDIT-12） ----

#[test]
fn set_doc_replaces_the_first_doc_of_the_element_only() {
    // Arrange（入れ子の要素の説明は変えない）
    let text = "package P {\n    requirement def R {\n        doc /* 古い文 */\n        requirement def S { doc /* 中 */ }\n    }\n}\n";
    // Act
    let (after, out) = run(
        text,
        r#"{"op":"setDoc","key":"R","text":" 3 分以内に沸かす "}"#,
    );
    // Assert
    assert_eq!(
        after,
        "package P {\n    requirement def R {\n        doc /* 3 分以内に沸かす */\n        requirement def S { doc /* 中 */ }\n    }\n}\n"
    );
    assert_eq!(flashed(&after, &out), "doc /* 3 分以内に沸かす */");
    assert_eq!(
        Doc::new(&after)
            .p
            .entries
            .iter()
            .find(|e| e.name == "R")
            .and_then(|e| e.doc.clone())
            .as_deref(),
        Some("3 分以内に沸かす")
    );
}

#[test]
fn set_doc_adds_a_doc_when_missing_and_keeps_line_breaks() {
    // Arrange（同値分割：; で終わる宣言・本体のある宣言。2 行の文は字下げを揃える）
    let semi = "package P {\n    requirement def R;\n}\n";
    let body = "package P {\n    part def A {\n        attribute m : Real;\n    }\n}\n";
    // Act
    let (a, _) = run(semi, r#"{"op":"setDoc","key":"R","text":"沸かす"}"#);
    let (b, _) = run(
        body,
        r#"{"op":"setDoc","key":"A","text":"1 行目\n2 行目 */ の後"}"#,
    );
    // Assert
    assert_eq!(
        a,
        "package P {\n    requirement def R {\n        doc /* 沸かす */\n    }\n}\n"
    );
    assert_eq!(
        b,
        "package P {\n    part def A {\n        attribute m : Real;\n        doc /* 1 行目\n           2 行目 * / の後 */\n    }\n}\n"
    );
}

#[test]
fn set_doc_with_empty_text_removes_the_doc() {
    // Arrange（境界値：空の文。説明が無ければ何も変えない）
    let text = "package P {\n    requirement def R {\n        doc /* 古い */\n    }\n    requirement def S;\n}\n";
    // Act
    let (after, _) = run(text, r#"{"op":"setDoc","key":"R","text":"  "}"#);
    let (same, out) = run(text, r#"{"op":"setDoc","key":"S","text":""}"#);
    // Assert
    assert_eq!(
        after,
        "package P {\n    requirement def R {\n    }\n    requirement def S;\n}\n"
    );
    assert_eq!(same, text);
    assert!(out.edits.is_empty());
}
