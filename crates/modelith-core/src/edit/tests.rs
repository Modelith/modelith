//! 図の操作の単体テスト。テキストに意図を当て、編集後のテキストを比べる（ADR-0016）。
//! 画面からの振る舞いは e2e テストで確かめる。

use super::more::sysml_name;
use super::text::{diff, indent_at, line_start, remove_range, utf16_of};
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
fn rename_is_refused_for_bad_or_used_names_and_noop_for_same_name() {
    // 同値分割：使えない名前・既にある名前・同じ名前
    let text = "package P { part def A; part def B; }";
    assert!(refused(text, r#"{"op":"rename","key":"A","name":"1A"}"#).contains("英字"));
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
    let text = "package P { part def X { port p; } part def A { part x : X; } \
                part def C { part a : A { part y : X; connect x.p to y.p; connect p to y.p; } part b : X; \
                connect a.x.p to b.p; } }";
    // Act
    let ids = ibd_ids(text, "C");
    // Assert
    assert_eq!(
        ids,
        [
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
        "範囲外は最後の行（暫定コアの lineStart と同じ）"
    );
    assert_eq!(indent_at("x\n  y", 99), "  ");
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
            r#"{"op":"saveView","name":"w","kind":"general","targets":[]}"#
        )
        .contains("要素が無い")
    );
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
