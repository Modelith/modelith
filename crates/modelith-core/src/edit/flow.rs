//! アクションの流れの図（ActionFlowView、8.2.3.17）の要素と線を、モデルのアクションの流れ（`model::flows`）から探す（ADR-0016）。
//!
//! 要素のキー（`a:名前`・`a:#番号`・`a:start`・`a:done`）と線の ID は、モデルが決めたものをそのまま使う。

use super::ops::EdgeAt;
use super::{Doc, Refusal};

use crate::model::ActionFlow;

/// アクション定義の、アクションの流れの図。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：アクション定義の宣言の番号
///
/// # 戻り値
///
/// そのアクション定義の図。アクション定義でなければ `None`。
///
/// # 例
///
/// ```text
/// // d.text = "package P { action def A { action a; } part def B; }" のとき
/// flow_of(d, A の番号) → Some(ActionFlow { key: "A", … })
/// flow_of(d, B の番号) → None
/// ```
pub(super) fn flow_of<'d>(d: &'d Doc<'_>, c: usize) -> Option<&'d ActionFlow> {
    d.m.action_flows.iter().find(|f| f.entry == c)
}

/// アクションの流れの図の要素（`a:…`）の宣言の番号。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：アクション定義の宣言の番号
/// - `key`：要素のキー
///
/// # 戻り値
///
/// 要素の宣言の番号。要素が無ければ `Ok(None)`。暗黙の開始・終了（宣言を持たない）なら、操作できない理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P { action def A { first start; then action a; } }" のとき
/// entry_of(d, A の番号, "a:a")     → Ok(Some(a の番号))
/// entry_of(d, A の番号, "a:x")     → Ok(None)
/// entry_of(d, A の番号, "a:start") → Err("開始と終了の記号は、順序の線から決まります。…")
/// ```
pub(super) fn entry_of(d: &Doc<'_>, c: usize, key: &str) -> Result<Option<usize>, Refusal> {
    let Some(n) = flow_of(d, c).and_then(|f| f.nodes.iter().find(|n| n.key == key)) else {
        return Ok(None);
    };
    n.entry.map(Some).ok_or_else(|| {
        "開始と終了の記号は、順序の線から決まります。記号を消すときは、つながる線を削除してください".to_owned()
    })
}

/// アクションの流れの図の線（継起・順序付きの流れ）の ID と、消す範囲。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：アクション定義の宣言の番号
///
/// # 戻り値
///
/// （ID, 範囲）の列（モデルの線の順）。アクション定義でなければ空。
///
/// # 例
///
/// ```text
/// // d.text = "package P { action def A { action a; then action b; } }" のとき
/// edges(d, A の番号) → [("succession|a:a|a:b|#1", EdgeAt { src: "then " の範囲, rel: None })]
/// ```
pub(super) fn edges(d: &Doc<'_>, c: usize) -> Vec<(String, EdgeAt)> {
    flow_of(d, c)
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
