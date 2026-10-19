//! v1 のプラグインとのやり取りの単体テスト（F-PLUG-5：変更案の範囲、F-PLUG-7：形と権限、ModelSnapshot）。

use modelith_plugin_protocol::{
    Diagnostic, DiagnosticSeverity, Permission, PluginMessage, PortDirection, Position, Range,
    RelationKind, TextEdit,
};

use super::position::Positions;
use super::{
    PlacedEdit, check_message, place_diagnostics, required_permission, resolve_edits, snapshot,
};

/// 行・列の範囲を作る。
fn range(sl: u32, sc: u32, el: u32, ec: u32) -> Range {
    Range {
        start: Position {
            line: sl,
            character: sc,
        },
        end: Position {
            line: el,
            character: ec,
        },
    }
}

/// 変更案 1 つを作る。
fn edit(sl: u32, sc: u32, el: u32, ec: u32, text: &str) -> TextEdit {
    TextEdit {
        range: range(sl, sc, el, ec),
        new_text: text.to_owned(),
    }
}

/// 変更案のメッセージの JSON（版 1）。
fn propose_json(edits: &[TextEdit]) -> String {
    serde_json::json!({ "type": "proposeEdits", "version": 1, "edits": edits }).to_string()
}

// ---- 位置の変換 -------------------------------------------------------------------

#[test]
fn offset_counts_utf16_units_after_multibyte_text() {
    // Arrange（2 行目は 3 バイトの文字。UTF-16 では 1 単位ずつ）
    let p = Positions::new("a\n日本");
    // Act
    let got = p.offset(Position {
        line: 1,
        character: 1,
    });
    // Assert
    assert_eq!(got, Some(3));
}

#[test]
fn offset_accepts_line_end_and_rejects_one_past() {
    // Arrange（境界値: 行の長さ・行の長さ + 1）
    let p = Positions::new("ab\ncd");
    // Act
    let at_end = p.offset(Position {
        line: 0,
        character: 2,
    });
    let past = p.offset(Position {
        line: 0,
        character: 3,
    });
    // Assert
    assert_eq!((at_end, past), (Some(2), None));
}

#[test]
fn offset_rejects_middle_of_surrogate_pair() {
    // Arrange（🚀 は UTF-16 で 2 単位。その間は文字の途中）
    let p = Positions::new("a🚀b");
    // Act
    let got = p.offset(Position {
        line: 0,
        character: 2,
    });
    // Assert
    assert_eq!(got, None);
}

#[test]
fn position_converts_utf16_offset_to_line_and_character() {
    // Arrange
    let p = Positions::new("a\n日本");
    // Act
    let got = p.position(3);
    // Assert
    assert_eq!(
        got,
        Position {
            line: 1,
            character: 1
        }
    );
}

// ---- 変更案 -----------------------------------------------------------------------

#[test]
fn resolve_edits_sorts_edits_by_start() {
    // Arrange（届いた順は後ろから）
    let edits = [edit(0, 2, 0, 3, "C"), edit(0, 0, 0, 1, "A")];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert_eq!(
        got,
        Ok(vec![
            PlacedEdit {
                start: 0,
                end: 1,
                text: "A".to_owned()
            },
            PlacedEdit {
                start: 2,
                end: 3,
                text: "C".to_owned()
            },
        ])
    );
}

#[test]
fn resolve_edits_accepts_an_empty_list() {
    // Arrange（境界値: 0 件）
    let edits: [TextEdit; 0] = [];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert_eq!(got, Ok(vec![]));
}

#[test]
fn resolve_edits_accepts_edits_that_touch() {
    // Arrange（境界値: 前の終わり = 次の始まり）
    let edits = [edit(0, 0, 0, 1, "A"), edit(0, 1, 0, 2, "B")];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert!(got.is_ok(), "{got:?}");
}

#[test]
fn resolve_edits_accepts_an_insert_at_text_end() {
    // Arrange（境界値: テキストの末尾への挿入）
    let edits = [edit(1, 1, 1, 1, "\n")];
    // Act
    let got = resolve_edits("a\nb", &edits);
    // Assert
    assert_eq!(
        got,
        Ok(vec![PlacedEdit {
            start: 3,
            end: 3,
            text: "\n".to_owned()
        }])
    );
}

#[test]
fn resolve_edits_refuses_overlapping_edits() {
    // Arrange（境界値: 1 文字だけ重なる）
    let edits = [edit(0, 0, 0, 2, "X"), edit(0, 1, 0, 3, "Y")];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert_eq!(
        got,
        Err("変更案の範囲が重なっているため、適用しませんでした".to_owned())
    );
}

#[test]
fn resolve_edits_refuses_two_edits_at_the_same_start() {
    // Arrange（当てる順が決まらない）
    let edits = [edit(0, 1, 0, 1, "X"), edit(0, 1, 0, 2, "Y")];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert!(got.is_err());
}

#[test]
fn resolve_edits_refuses_a_range_past_the_text() {
    // Arrange（境界値: 最終行 + 1）
    let edits = [edit(1, 0, 1, 0, "X")];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert_eq!(
        got,
        Err("変更案の範囲がテキストの外を指しているため、適用しませんでした".to_owned())
    );
}

#[test]
fn resolve_edits_refuses_a_reversed_range() {
    // Arrange
    let edits = [edit(0, 2, 0, 1, "X")];
    // Act
    let got = resolve_edits("abc", &edits);
    // Assert
    assert!(got.is_err());
}

// ---- 診断 -------------------------------------------------------------------------

#[test]
fn place_diagnostics_converts_ranges_to_offsets() {
    // Arrange
    let items = [Diagnostic {
        range: range(1, 0, 1, 1),
        severity: DiagnosticSeverity::Warning,
        message: "m".to_owned(),
        code: Some("c1".to_owned()),
        source: None,
    }];
    // Act
    let got = place_diagnostics("a\nb", &items).unwrap();
    // Assert
    assert_eq!(
        (got[0].pos, got[0].end, got[0].code.as_deref()),
        (2, 3, Some("c1"))
    );
}

#[test]
fn place_diagnostics_refuses_a_range_outside_the_text() {
    // Arrange
    let items = [Diagnostic {
        range: range(3, 0, 3, 0),
        severity: DiagnosticSeverity::Error,
        message: "m".to_owned(),
        code: None,
        source: None,
    }];
    // Act
    let got = place_diagnostics("a", &items);
    // Assert
    assert!(got.is_err());
}

// ---- 形と権限 ---------------------------------------------------------------------

#[test]
fn required_permission_follows_the_adr_table() {
    // Arrange（権限の要るもの 3 種と、要らないもの）
    let messages = [
        r#"{"type":"diagnostics","version":1,"items":[]}"#,
        r#"{"type":"proposeEdits","version":1,"edits":[]}"#,
        r#"{"type":"storageSet","requestId":1,"key":"k","value":1}"#,
        r#"{"type":"notify","level":"info","message":"m"}"#,
    ];
    // Act
    let got: Vec<Option<Permission>> = messages
        .iter()
        .map(|m| required_permission(&serde_json::from_str::<PluginMessage>(m).unwrap()))
        .collect();
    // Assert
    assert_eq!(
        got,
        [
            Some(Permission::ModelRead),
            Some(Permission::EditsPropose),
            Some(Permission::Storage),
            None
        ]
    );
}

#[test]
fn check_message_accepts_messages_that_need_no_permission() {
    // Arrange
    let json = r#"{"type":"ready"}"#;
    // Act
    let got = check_message("", json, &[]).unwrap();
    // Assert
    assert_eq!(got.message, PluginMessage::Ready);
}

#[test]
fn check_message_refuses_edits_without_the_permission() {
    // Arrange
    let json = propose_json(&[edit(0, 0, 0, 1, "A")]);
    // Act
    let got = check_message("abc", &json, &[Permission::ModelRead]);
    // Assert
    assert_eq!(
        got,
        Err(
            "宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした"
                .to_owned()
        )
    );
}

#[test]
fn check_message_places_edits_with_the_permission() {
    // Arrange
    let json = propose_json(&[edit(0, 0, 0, 1, "A")]);
    // Act
    let got = check_message("abc", &json, &[Permission::EditsPropose]).unwrap();
    // Assert
    assert_eq!(
        got.edits,
        Some(vec![PlacedEdit {
            start: 0,
            end: 1,
            text: "A".to_owned()
        }])
    );
}

#[test]
fn check_message_refuses_diagnostics_without_model_read() {
    // Arrange
    let json = r#"{"type":"diagnostics","version":1,"items":[]}"#;
    // Act
    let got = check_message("abc", json, &[Permission::EditsPropose]);
    // Assert
    assert!(got.is_err());
}

#[test]
fn check_message_refuses_malformed_messages() {
    // Arrange（知らない種類・欠けた項目・負の番号）
    let bad = [
        r#"{"type":"shutdown"}"#,
        r#"{"type":"failed","requestId":1}"#,
        r#"{"type":"commandDone","requestId":-1}"#,
        "[]",
    ];
    // Act
    let got: Vec<bool> = bad
        .iter()
        .map(|j| check_message("", j, &[]).is_err())
        .collect();
    // Assert
    assert_eq!(got, [true, true, true, true]);
}

#[test]
fn check_message_refuses_edits_outside_the_text() {
    // Arrange
    let json = propose_json(&[edit(5, 0, 5, 0, "A")]);
    // Act
    let got = check_message("abc", &json, &[Permission::EditsPropose]);
    // Assert
    assert_eq!(
        got,
        Err("変更案の範囲がテキストの外を指しているため、適用しませんでした".to_owned())
    );
}

#[test]
fn checked_message_serializes_with_placed_edits() {
    // Arrange
    let json = propose_json(&[edit(0, 0, 0, 1, "A")]);
    let checked = check_message("abc", &json, &[Permission::EditsPropose]).unwrap();
    // Act
    let out = serde_json::to_string(&checked).unwrap();
    // Assert
    assert!(
        out.ends_with(r#""edits":[{"start":0,"end":1,"text":"A"}]}"#),
        "{out}"
    );
}

// ---- ModelSnapshot ----------------------------------------------------------------

/// テキストを解析して ModelSnapshot を作る。
fn snapshot_of(text: &str) -> modelith_plugin_protocol::ModelSnapshot {
    let parse = crate::project::project(text, &crate::syntax::parse(text));
    let model = crate::model::build(&parse);
    snapshot(text, &parse, &model)
}

#[test]
fn snapshot_lists_elements_with_line_ranges() {
    // Arrange（R は 2 行目の 3 文字目から）
    let text = "package P {\n  requirement def R;\n  part def A;\n  satisfy R by A;\n}\n";
    // Act
    let s = snapshot_of(text);
    // Assert
    let r = s.elements.iter().find(|e| e.key == "R").unwrap();
    assert_eq!(
        (r.kind.as_str(), r.range.start),
        (
            "requirement def",
            Position {
                line: 1,
                character: 2
            }
        )
    );
}

#[test]
fn snapshot_maps_relation_kinds_and_skips_others() {
    // Arrange（satisfy と derivation、契約に無い部品の持ち方）
    let text = "package P {\n  requirement def R;\n  requirement def S;\n  part def A { part b : B; }\n  part def B;\n  satisfy R by A;\n  #derivation dependency from S to R;\n}\n";
    // Act
    let s = snapshot_of(text);
    // Assert
    let kinds: Vec<RelationKind> = s.relations.iter().map(|r| r.kind).collect();
    assert_eq!(kinds, [RelationKind::Satisfy, RelationKind::Derivation]);
}

#[test]
fn snapshot_includes_ports_with_type_and_direction() {
    // Arrange
    let text = "package P {\n  port def Power;\n  part def A { out port p : Power; }\n}\n";
    // Act
    let s = snapshot_of(text);
    // Assert
    let a = s.elements.iter().find(|e| e.key == "A").unwrap();
    assert_eq!(
        (a.ports[0].port_type.as_deref(), a.ports[0].direction),
        (Some("Power"), Some(PortDirection::Out))
    );
}

#[test]
fn snapshot_of_empty_text_is_empty() {
    // Arrange（境界値: 空のテキスト）
    let text = "";
    // Act
    let s = snapshot_of(text);
    // Assert
    assert!(s.elements.is_empty() && s.relations.is_empty());
}
