//! 内部ブロック図（InterconnectionView）の要素のキーと線の ID。UI の `web/src/app/views.ts` の `ibdContent` と同じ決め方にする
//! （UI が描いた線や要素を、操作の意図のキーと ID から探し直すため。ADR-0016）。
//!
//! - 部品：対象の直下の部品は `u:a`。その中の部品（入れ子の 2 段目）は `u:a.b`。2 段目は、部品の本体に書いたものと、
//!   線の端（`a.b.p`）が指す、部品の型の中の部品。
//! - 線：対象と、直下の部品の本体と、その型の定義の中に書いた流れ・接続・結び付け。2 項は `flow|端|端|ラベル#番号`・`bind|端|端|=#番号`、
//!   n 項の接続（8.2.3.13 の n-ary-connection）は、点 `j:名前`（名前が無ければ `j:#番号`）から端ごとに `connect|点|端|#番号`。

use super::Doc;
use super::ops::EdgeAt;
use crate::model::flow_label;
use crate::project::{Rel, RelKind, Span};

/// 線の端を探す範囲（対象そのものか、直下の部品の本体か、その部品の型の定義の中）。
#[derive(Debug, Clone, Copy)]
struct Scope {
    /// 関係を書いた宣言（関係の `pe`）。
    owner: usize,
    /// 直下の部品の本体か型の定義の中なら、その部品。対象そのものなら `None`。
    part: Option<usize>,
}

/// 部品の中の部品（入れ子の 2 段目）になりうるもの。部品の本体に書いた部品、続けて型の定義の中の部品（同じ名前は本体を優先）。
///
/// 型の定義は、図の要素のうち、名前が部品の型と同じ定義（UI の `typeNode` と同じ）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `u`：対象の直下の部品の宣言の番号
///
/// # 戻り値
///
/// 名前のある部品の宣言の番号（本体の順、続けて型の定義の順）。無ければ空。
///
/// # 例
///
/// ```text
/// // "part def A { part x; } part def C { part a : A { part y; } }" のとき
/// inner_parts(d, a の番号) → [y の番号, x の番号]
/// // "part def C { part b; }" のとき
/// inner_parts(d, b の番号) → []
/// ```
pub(super) fn inner_parts(d: &Doc<'_>, u: usize) -> Vec<usize> {
    let parts = |i: usize| -> Vec<usize> {
        d.e(i)
            .children
            .iter()
            .copied()
            .filter(|&c| d.e(c).kind == "part" && !d.e(c).name.is_empty())
            .collect()
    };
    let mut out = parts(u);
    let ty = &d.e(u).ty;
    if let Some(t) = d.m.nodes.iter().find(|n| n.is_def && n.name == *ty) {
        for c in parts(t.entry) {
            if out.iter().all(|&o| d.e(o).name != d.e(c).name) {
                out.push(c);
            }
        }
    }
    out
}

/// 対象の直下の部品（名前のあるもの）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
///
/// # 戻り値
///
/// 部品の宣言の番号（書いた順）。無ければ空。
///
/// # 例
///
/// ```text
/// // "part def C { part a; port p; part b; }" のとき
/// parts(d, C の番号) → [a の番号, b の番号]
/// ```
fn parts(d: &Doc<'_>, c: usize) -> Vec<usize> {
    d.e(c)
        .children
        .iter()
        .copied()
        .filter(|&i| d.e(i).kind == "part" && !d.e(i).name.is_empty())
        .collect()
}

/// 名前 `nm` の、部品の中の部品（入れ子の 2 段目）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `u`：対象の直下の部品の宣言の番号
/// - `nm`：探す名前
///
/// # 戻り値
///
/// 見つかった部品の宣言の番号（本体に書いたものを優先）。無ければ None。
///
/// # 例
///
/// ```text
/// // "part def A { part x; } part def C { part a : A; }" のとき
/// inner_named(d, a の番号, "x") → Some(x の番号)
/// inner_named(d, a の番号, "z") → None
/// ```
fn inner_named(d: &Doc<'_>, u: usize, nm: &str) -> Option<usize> {
    inner_parts(d, u).into_iter().find(|&i| d.e(i).name == nm)
}

/// 線の端の参照（`a.p`・`a.b.p` など）を、図の要素のキーにする。
///
/// 対象そのものに書いた関係では、最初の段は直下の部品で、2 段目が入れ子の部品ならその部品（`u:a.b`）、
/// そうでなければ直下の部品（`u:a`）。部品の本体・型の定義の中に書いた関係では、最初の段が入れ子の部品ならその部品、
/// 1 段だけなら部品そのもの（部品のポート）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
/// - `scope`：関係を書いた範囲
/// - `path`：端の参照
///
/// # 戻り値
///
/// 要素のキー。図に描く部品に当たらなければ None。
///
/// # 例
///
/// ```text
/// // "part def A { part x; } part def C { part a : A; part b; connect a.x.p to b.q; }" の C で
/// end_key(d, C, 対象, "a.x.p") → Some("u:a.x")
/// end_key(d, C, 対象, "b.q")   → Some("u:b")
/// end_key(d, C, 対象, "z.q")   → None
/// // a の本体に書いた関係なら
/// end_key(d, C, a の本体, "x.p") → Some("u:a.x")
/// end_key(d, C, a の本体, "p")   → Some("u:a")
/// ```
fn end_key(d: &Doc<'_>, c: usize, scope: Scope, path: &str) -> Option<String> {
    let segs: Vec<&str> = path.split('.').collect();
    let first = segs.first().copied().unwrap_or("");
    match scope.part {
        None => {
            let u = parts(d, c).into_iter().find(|&i| d.e(i).name == first)?;
            let nested = segs
                .get(1)
                .and_then(|s| inner_named(d, u, s).map(|_| format!("u:{first}.{s}")));
            Some(nested.unwrap_or_else(|| format!("u:{first}")))
        }
        Some(u) => {
            let un = &d.e(u).name;
            if inner_named(d, u, first).is_some() {
                Some(format!("u:{un}.{first}"))
            } else if segs.len() == 1 {
                Some(format!("u:{un}"))
            } else {
                None
            }
        }
    }
}

/// 線の ID の番号を数える（同じ形の線は、出てきた順に 1, 2, …）。
#[derive(Default)]
struct Counter(Vec<(String, usize)>);

impl Counter {
    /// `base` の次の番号を付けた ID を返す。
    ///
    /// # 引数
    ///
    /// - `base`：線の種類・両端・ラベル（`flow|u:a|u:b|` など）
    ///
    /// # 戻り値
    ///
    /// `base#番号`。
    ///
    /// # 例
    ///
    /// ```text
    /// id("flow|u:a|u:b|") → "flow|u:a|u:b|#1"
    /// id("flow|u:a|u:b|") → "flow|u:a|u:b|#2"
    /// ```
    fn id(&mut self, base: String) -> String {
        let k = match self.0.iter_mut().find(|(b, _)| *b == base) {
            Some((_, k)) => {
                *k += 1;
                *k
            }
            None => {
                self.0.push((base.clone(), 1));
                1
            }
        };
        format!("{base}#{k}")
    }
}

/// 関係の範囲。接続・結び付け・名前付きのフローは使用（本体を含む）、名前の無いフローは文。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `r`：関係
///
/// # 戻り値
///
/// 範囲（UTF-16）。
///
/// # 例
///
/// ```text
/// // "flow from a to b;" → 文の範囲（「;」まで）
/// // "connect a to b { }" → 使用の範囲（本体の「}」まで）
/// ```
fn rel_span(d: &Doc<'_>, r: &Rel) -> Span {
    let usage = match &r.kind {
        RelKind::Connect { usage, .. } | RelKind::Bind { usage, .. } => Some(*usage),
        RelKind::Flow { usage, .. } => *usage,
        _ => None,
    };
    usage.map_or(
        Span {
            start: r.start,
            end: r.end + 1,
        },
        |u| Span {
            start: d.e(u).start,
            end: d.e(u).end,
        },
    )
}

/// 内部ブロック図の線を探す範囲（対象そのものと、直下の部品の本体と、その型の定義の中）。
///
/// 型の定義は、図の要素のうち、名前が部品の型と同じ定義（`inner_parts` と同じ）。対象そのものや部品自身なら除く。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
///
/// # 戻り値
///
/// 範囲の一覧（対象そのもの、続けて部品ごとに本体・型の定義の順）。
///
/// # 例
///
/// ```text
/// // "part def A; part def C { part a : A; part b; }" のとき
/// scopes(d, C) → [{ owner: C, part: None }, { owner: a, part: Some(a) }, { owner: A, part: Some(a) }, { owner: b, part: Some(b) }]
/// ```
fn scopes(d: &Doc<'_>, c: usize) -> Vec<Scope> {
    let mut out = vec![Scope {
        owner: c,
        part: None,
    }];
    for u in parts(d, c) {
        out.push(Scope {
            owner: u,
            part: Some(u),
        });
        let ty = &d.e(u).ty;
        if let Some(t) =
            d.m.nodes
                .iter()
                .find(|n| n.is_def && n.name == *ty)
                .map(|n| n.entry)
                .filter(|&t| t != c && t != u)
        {
            out.push(Scope {
                owner: t,
                part: Some(u),
            });
        }
    }
    out
}

/// 内部ブロック図の線 1 本（ID・範囲と関係）、または n 項の接続の点（キーと使用）。
pub(super) enum Item {
    Edge(String, EdgeAt),
    Junction(String, usize),
}

/// 内部ブロック図の線と、n 項の接続の点を、関係を書いた順に集める（UI の `ibdContent` と同じ順・同じ ID）。
///
/// 両端（n 項では 2 つ以上の端）が図の部品に当たらない関係は除く。名前の無い n 項の接続の番号は、
/// 除いたものも含めて数える。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
///
/// # 戻り値
///
/// 線（ID と、範囲・関係の番号）と点（キーと、接続の使用の番号）。無ければ空。
///
/// # 例
///
/// ```text
/// // "part def C { part a; part b; part e; flow from a to b; bind a.x = b.y; connect (a, b, e); }" のとき
/// items(d, C) → [Edge("flow|u:a|u:b|#1"), Edge("bind|u:a|u:b|=#1"), Junction("j:#1"),
///                Edge("connect|j:#1|u:a|#1"), Edge("connect|j:#1|u:b|#1"), Edge("connect|j:#1|u:e|#1")]
/// ```
pub(super) fn items(d: &Doc<'_>, c: usize) -> Vec<Item> {
    let mut out = Vec::new();
    let mut ids = Counter::default();
    let mut anonymous = 0;
    let scopes = scopes(d, c);
    for (ri, r) in d.p.rels.iter().enumerate() {
        // 同じ型の部品が 2 つあれば、型の中の関係は部品ごとに描く
        for &scope in scopes.iter().filter(|s| r.pe == Some(s.owner)) {
            let key = |path: &str| end_key(d, c, scope, path);
            let at = EdgeAt {
                src: rel_span(d, r),
                rel: Some(ri),
            };
            let (kind, a, b, label) = match &r.kind {
                RelKind::Connect { ends, usage, .. } if ends.len() > 2 => {
                    let name = &d.e(*usage).name;
                    let j = if name.is_empty() {
                        anonymous += 1;
                        format!("j:#{anonymous}")
                    } else {
                        let prefix = scope
                            .part
                            .map_or(String::new(), |u| format!("{}.", d.e(u).name));
                        format!("j:{prefix}{name}")
                    };
                    let found: Vec<String> = ends.iter().filter_map(|x| key(x)).collect();
                    if found.len() < 2 {
                        continue;
                    }
                    out.push(Item::Junction(j.clone(), *usage));
                    for k in found {
                        out.push(Item::Edge(ids.id(format!("connect|{j}|{k}|")), at));
                    }
                    continue;
                }
                RelKind::Flow {
                    a,
                    b,
                    item,
                    name,
                    ty,
                    ..
                } => ("flow", a, b, flow_label(name, ty, item)),
                RelKind::Connect { a, b, item, .. } => ("flow", a, b, item.clone()),
                RelKind::Bind { a, b, .. } => ("bind", a, b, "=".to_owned()),
                _ => continue,
            };
            let (Some(ka), Some(kb)) = (key(a), key(b)) else {
                continue;
            };
            out.push(Item::Edge(ids.id(format!("{kind}|{ka}|{kb}|{label}")), at));
        }
    }
    out
}

/// 内部ブロック図の線（ID と、範囲・関係の番号）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
///
/// # 戻り値
///
/// 線の一覧（`items` の線だけ）。
///
/// # 例
///
/// ```text
/// // "part def C { part a; part b; flow from a to b; }" のとき
/// edges(d, C) → [("flow|u:a|u:b|#1", …)]
/// ```
pub(super) fn edges(d: &Doc<'_>, c: usize) -> Vec<(String, EdgeAt)> {
    items(d, c)
        .into_iter()
        .filter_map(|x| match x {
            Item::Edge(id, at) => Some((id, at)),
            Item::Junction(..) => None,
        })
        .collect()
}

/// 内部ブロック図の要素のキー（`u:a`・`u:a.b`・`j:…`）の宣言。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
/// - `key`：要素のキー（`u:` か `j:` で始まる）
///
/// # 戻り値
///
/// 部品の宣言、n 項の接続の点なら接続の使用の宣言。見つからなければ None。
///
/// # 例
///
/// ```text
/// // "part def A { part x; } part def C { part a : A; part b; part e; connect (a, b, e); }" のとき
/// entry_of(d, C, "u:a")   → Some(a の番号)
/// entry_of(d, C, "u:a.x") → Some(A の中の x の番号)
/// entry_of(d, C, "j:#1")  → Some(接続の使用の番号)
/// entry_of(d, C, "u:z")   → None
/// ```
pub(super) fn entry_of(d: &Doc<'_>, c: usize, key: &str) -> Option<usize> {
    if key.starts_with("j:") {
        return items(d, c).into_iter().find_map(|x| match x {
            Item::Junction(j, usage) if j == key => Some(usage),
            _ => None,
        });
    }
    let path = key.strip_prefix("u:")?;
    let (head, rest) = path.split_once('.').unwrap_or((path, ""));
    let u = parts(d, c).into_iter().find(|&i| d.e(i).name == head)?;
    if rest.is_empty() {
        Some(u)
    } else {
        inner_named(d, u, rest)
    }
}

/// 内部ブロック図の部品を、対象の中から指す参照（直下の部品は `a`、入れ子の部品は `a.b`）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義）の宣言の番号
/// - `u`：部品の宣言の番号
///
/// # 戻り値
///
/// 参照。直下の部品でも、直下の部品の中の部品でもなければ、その部品の名前。
///
/// # 例
///
/// ```text
/// // "part def A { part x; } part def C { part a : A; }" のとき
/// path_of(d, C, a の番号) → "a"
/// path_of(d, C, x の番号) → "a.x"
/// ```
pub(super) fn path_of(d: &Doc<'_>, c: usize, u: usize) -> String {
    let name = &d.e(u).name;
    if d.e(c).children.contains(&u) {
        return name.clone();
    }
    parts(d, c)
        .into_iter()
        .find(|&p| inner_parts(d, p).contains(&u))
        .map_or_else(|| name.clone(), |p| format!("{}.{name}", d.e(p).name))
}
