//! 状態遷移の図（StateTransitionView、8.2.3.18）の状態と遷移を、モデルの状態遷移の図（`model::states`）から探す（ADR-0016）。
//!
//! 要素のキー（`s:名前`・`s:外.中`・`s:頭#start`・`s:頭#done`）と線の ID は、モデルが決めたものをそのまま使う。

use super::ops::EdgeAt;
use super::{Doc, Refusal};

use crate::model::StateMachine;

/// 状態定義の、状態遷移の図。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：状態定義の宣言の番号
///
/// # 戻り値
///
/// その状態定義の図。状態定義でなければ `None`。
///
/// # 例
///
/// ```text
/// // d.text = "package P { state def S { state a; } part def B; }" のとき
/// machine_of(d, S の番号) → Some(StateMachine { key: "S", … })
/// machine_of(d, B の番号) → None
/// ```
pub(super) fn machine_of<'d>(d: &'d Doc<'_>, c: usize) -> Option<&'d StateMachine> {
    d.m.state_machines.iter().find(|f| f.entry == c)
}

/// 状態遷移の図の要素（`s:…`）の宣言の番号。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：状態定義の宣言の番号
/// - `key`：要素のキー
///
/// # 戻り値
///
/// 状態の宣言の番号。要素が無ければ `Ok(None)`。開始・終了の記号（宣言を持たない）なら、操作できない理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P { state def S { entry; then a; state a; } }" のとき
/// entry_of(d, S の番号, "s:a")      → Ok(Some(a の番号))
/// entry_of(d, S の番号, "s:x")      → Ok(None)
/// entry_of(d, S の番号, "s:#start") → Err("開始と終了の記号は、遷移から決まります。…")
/// ```
pub(super) fn entry_of(d: &Doc<'_>, c: usize, key: &str) -> Result<Option<usize>, Refusal> {
    let Some(n) = machine_of(d, c).and_then(|f| f.nodes.iter().find(|n| n.key == key)) else {
        return Ok(None);
    };
    n.entry.map(Some).ok_or_else(|| {
        "開始と終了の記号は、遷移から決まります。記号を消すときは、つながる遷移を削除してください".to_owned()
    })
}

/// 状態遷移の図の線（遷移）の ID と、消す範囲（遷移の文）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：状態定義の宣言の番号
///
/// # 戻り値
///
/// （ID, 範囲）の列（モデルの線の順）。状態定義でなければ空。
///
/// # 例
///
/// ```text
/// // d.text = "package P { state def S { state a; accept Go then b; state b; } }" のとき
/// edges(d, S の番号) → [("transition|s:a|s:b|Go#1", EdgeAt { src: "accept Go then b;" の範囲, rel: None })]
/// ```
pub(super) fn edges(d: &Doc<'_>, c: usize) -> Vec<(String, EdgeAt)> {
    machine_of(d, c)
        .map(|f| {
            f.edges
                .iter()
                .map(|e| {
                    (
                        e.id.clone(),
                        EdgeAt {
                            src: e.src,
                            rel: None,
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}
