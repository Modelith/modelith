//! アクションの流れの図（ActionFlowView、8.2.3.17）の要素と線を、モデルのアクションの流れ（`model::flows`）から探す（ADR-0016）。
//!
//! 要素のキー（`a:名前`・`a:#番号`・`a:start`・`a:done`）と線の ID は、モデルが決めたものをそのまま使う。

use super::Change;
use super::more::sysml_name;
use super::ops::{EdgeAt, missing};
use super::text::insert_into;
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

/// アクションの流れの図で、from の要素から to の要素への順序の線（継起）を書く。アクション定義の本体の終わりに
/// `first a then b;`（SuccessionAsUsage、8.2.2.14）を足す。開始・終了は `start`・`done` と書く。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `from`・`to`：線の元と先の要素のキー（`a:名前`・`a:start`・`a:done`）
/// - `ctx`：アクション定義のキー
///
/// # 戻り値
///
/// 書いた後のテキストと、光らせる範囲（足した文）。入れ子の本体の要素どうしなら、その本体に書く。
/// 要素が無いとき・名前の無い要素のとき・終了から始まるとき・開始へ向かうとき・本体の違う要素どうしのときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P {\n    action def A {\n        action a;\n        action b;\n    }\n}\n" のとき
/// add_succession(d, "a:a", "a:b", Some("A")) → Ok(text に "        action b;\n        first a then b;\n    }")
/// add_succession(d, "a:b", "a:start", Some("A")) → Err("開始の記号へ向かう順序の線は引けません")
/// // a の中に入れ子の本体（要素 a:a.x・a:a.y）があるとき
/// add_succession(d, "a:a.x", "a:a.y", Some("A")) → Ok(a の本体に "first x then y;")
/// add_succession(d, "a:a.x", "a:b", Some("A"))   → Err("順序の線は、同じアクションの中の要素どうしにだけ引けます")
/// ```
pub(super) fn add_succession(
    d: &Doc<'_>,
    from: &str,
    to: &str,
    ctx: Option<&str>,
) -> Result<Change, Refusal> {
    let c = d.context(ctx.unwrap_or_default())?;
    let flow = flow_of(d, c).ok_or_else(|| missing(ctx.unwrap_or_default()))?;
    let node = |key: &str| {
        flow.nodes
            .iter()
            .find(|n| n.key == key)
            .ok_or_else(|| missing(key))
    };
    // 開始・終了の記号（入れ子の本体のものも、暗黙の要素は宣言を持たない）
    if node(to)?.kind == "start" && node(to)?.entry.is_none() {
        return Err("開始の記号へ向かう順序の線は引けません".to_owned());
    }
    if node(from)?.kind == "done" && node(from)?.entry.is_none() {
        return Err("終了の記号から始まる順序の線は引けません".to_owned());
    }
    // 順序は同じ本体の中の要素どうしにだけ引き、その本体（入れ子なら、本体を持つアクション）に書く
    let container = node(from)?.container.clone();
    if node(to)?.container != container {
        return Err("順序の線は、同じアクションの中の要素どうしにだけ引けます".to_owned());
    }
    let host = match &container {
        Some(k) => node(k)?.entry.ok_or_else(|| missing(k))?,
        None => c,
    };
    let name_of = |key: &str| -> Result<String, Refusal> {
        let n = node(key)?;
        if n.name.is_empty() {
            return Err(
                "名前の無い要素は、図から順序の線でつなげません。テキストで名前を付けてから線を引いてください"
                    .to_owned(),
            );
        }
        Ok(sysml_name(&n.name))
    };
    let snippet = format!("first {} then {};", name_of(from)?, name_of(to)?);
    let (text, a, b) = insert_into(d.text, d.target(host), &snippet);
    Ok(Change {
        text,
        select: None,
        flash: Some((a, b)),
    })
}
