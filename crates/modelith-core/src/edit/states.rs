//! 状態遷移の図（StateTransitionView、8.2.3.18）の状態と遷移を、モデルの状態遷移の図（`model::states`）から探す（ADR-0016）。
//!
//! 要素のキー（`s:名前`・`s:外.中`・`s:頭#start`・`s:頭#done`）と線の ID は、モデルが決めたものをそのまま使う。

use super::Change;
use super::more::sysml_name;
use super::ops::{EdgeAt, missing};
use super::text::insert_into;
use super::{Doc, Refusal};

use crate::model::{StateMachine, StateNode};

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

/// 状態遷移の図で、from の状態から to の状態への遷移を書く（TransitionUsage、8.2.2.18）。
/// 2 つが同じ本体の中にあれば、その本体の終わりに `transition first a then b;` を足す。本体が違えば、状態定義の本体の終わりに、
/// 状態定義からの名前の道のり（`on.low`）で書く。終了の記号へは `then done` と書く（同じ本体の中の状態からだけ）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `from`・`to`：線の元と先の要素のキー（`s:名前`・`s:外.中`・`s:頭#done`）
/// - `ctx`：状態定義のキー
///
/// # 戻り値
///
/// 書いた後のテキストと、光らせる範囲（足した文）。要素が無いとき・名前の無い状態のとき・開始の記号から始まるとき・
/// 開始の記号へ向かうとき・終了の記号から始まるとき・別の本体の終了の記号へ向かうときは、理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P {\n    state def S {\n        state a;\n        state b;\n    }\n}\n" のとき
/// add_transition(d, "s:a", "s:b", Some("S"))
///   → Ok(text に "        state b;\n        transition first a then b;\n    }")
/// add_transition(d, "s:a", "s:#start", Some("S")) → Err("開始の記号へ向かう遷移は引けません")
/// ```
pub(super) fn add_transition(
    d: &Doc<'_>,
    from: &str,
    to: &str,
    ctx: Option<&str>,
) -> Result<Change, Refusal> {
    let c = d.context(ctx.unwrap_or_default())?;
    let machine = machine_of(d, c).ok_or_else(|| missing(ctx.unwrap_or_default()))?;
    let node = |key: &str| -> Result<&StateNode, Refusal> {
        machine
            .nodes
            .iter()
            .find(|n| n.key == key)
            .ok_or_else(|| missing(key))
    };
    let (a, b) = (node(from)?, node(to)?);
    if b.kind == "start" {
        return Err("開始の記号へ向かう遷移は引けません".to_owned());
    }
    if a.kind == "done" {
        return Err("終了の記号から始まる遷移は引けません".to_owned());
    }
    if a.kind == "start" {
        return Err(
            "開始の記号からの遷移は、本体ごとに 1 つです。行き先を変えるときは、テキストの「entry; then …;」を書き換えてください"
                .to_owned(),
        );
    }
    let same_body = a.container == b.container;
    if b.kind == "done" && !same_body {
        return Err("終了の記号へは、同じ状態の中の状態からだけ遷移を引けます".to_owned());
    }
    let (body, source, target) = if same_body {
        let body = match &a.container {
            Some(k) => node(k)?.entry.ok_or_else(|| missing(k))?,
            None => c,
        };
        (body, reference(a, false)?, reference(b, false)?)
    } else {
        (c, reference(a, true)?, reference(b, true)?)
    };
    let snippet = format!("transition first {source} then {target};");
    let (text, start, end) = insert_into(d.text, d.target(body), &snippet);
    Ok(Change {
        text,
        select: None,
        flash: Some((start, end)),
    })
}

/// 遷移の端に書く参照。同じ本体の中なら名前（終了の記号は `done`）、そうでなければ状態定義からの名前の道のり（`on.low`）。
///
/// # 引数
///
/// - `n`：状態遷移の図の要素
/// - `path`：状態定義からの名前の道のりで書くか
///
/// # 戻り値
///
/// 参照（名前は必要なら `'…'` で囲む）。名前の無い状態（キーに `#` を含む状態）なら、理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// reference(s:on.low, true)  → Ok("on.low")
/// reference(s:on.low, false) → Ok("low")
/// reference(s:#done, false)  → Ok("done")
/// reference(s:#1, false)     → Err("名前の無い状態は、図から遷移でつなげません。…")
/// ```
fn reference(n: &StateNode, path: bool) -> Result<String, Refusal> {
    if n.kind == "done" {
        return Ok("done".to_owned());
    }
    let walk = n.key.strip_prefix("s:").unwrap_or(&n.key);
    if n.name.is_empty() || walk.contains('#') {
        return Err(
            "名前の無い状態は、図から遷移でつなげません。テキストで名前を付けてから線を引いてください"
                .to_owned(),
        );
    }
    if !path {
        return Ok(sysml_name(&n.name));
    }
    Ok(walk
        .split('.')
        .map(sysml_name)
        .collect::<Vec<_>>()
        .join("."))
}
