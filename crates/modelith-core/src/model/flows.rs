//! アクション定義ごとに、アクションの流れの図（ActionFlowView、8.2.3.17）に描く要素と線を作る。
//!
//! 要素は、アクション定義の直下のアクションの流れの要素（アクション・制御の節・送受信などのアクションの節）と、
//! 継起が指す暗黙の開始（`start`）・終了（`done`）。要素のパラメータと、アクション定義そのもののパラメータ（枠の上に描く）も持つ。
//! 線は、アクション定義の直下に書いた継起・順序付きの流れ・流れ（パラメータの間）。
//! 要素のキーと線の ID は、図の操作（`edit`）が同じものを探し直せるよう、ここで決める（ADR-0016）。

use std::collections::HashMap;
use std::collections::hash_map::Entry as Slot;

use super::{ActionFlow, Builder, Edge, FlowNode, Port, flow_label, has_word};
use crate::project::{ACTION_FLOW_KINDS, Entry, Rel, RelKind, Span};

/// 継起の端（元か先）。
struct End<'r> {
    /// 書いた参照（直前の要素から引く継起では、その要素の名前）。
    reference: &'r str,
    /// 宣言の番号（直前の要素から引く継起の元、`then action b;` の先）。
    entry: Option<usize>,
}

/// 線 1 本のもとになる関係（継起か順序付きの流れ）を、線の形にしたもの。
struct Line<'r> {
    kind: &'static str,
    a: End<'r>,
    b: End<'r>,
    label: String,
    src: Span,
}

/// 図の要素のキーの表（宣言の番号・本体ごとの名前から）と、開始・終了を使った本体。
/// 本体は、アクション定義そのものと、中にアクションの流れを書いたアクションの使用（入れ子の本体）。
#[derive(Default)]
struct Keys {
    by_entry: HashMap<usize, String>,
    /// 要素のキーから宣言の番号（入れ子の本体をたどるため）。
    entry_by_key: HashMap<String, usize>,
    /// （本体の宣言の番号, 名前）から要素のキー（同じ名前は最初の要素）。
    by_name: HashMap<(usize, String), String>,
    /// 本体の宣言の番号から、その中の要素のキーの頭（アクション定義は `a:`、入れ子の本体は `a:外.`）。
    prefix: HashMap<usize, String>,
    /// 開始（`start`）を使った本体（使った順）。
    start: Vec<usize>,
    /// 終了（`done`）を使った本体（使った順）。
    done: Vec<usize>,
}

impl Keys {
    /// 線の端の、図の要素のキーと、その後ろの段（パラメータの候補）。宣言の番号があればその要素、無ければ参照を本体の中から段ごとにたどる
    /// （`boil.heat.x` は、本体の要素 boil の中の要素 heat までたどり、`x` を残す）。
    /// `start`・`done` は、同じ名前の要素が無ければ、その本体の暗黙の開始・終了にする（使ったことを覚える）。
    ///
    /// # 引数
    ///
    /// - `end`：線の端
    /// - `body`：線を書いた本体の宣言の番号
    ///
    /// # 戻り値
    ///
    /// （要素のキー, たどった後の次の段）。図に無ければ `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // アクション定義 A の本体に要素 a:a、a の中に要素 a:a.b がある
    /// find(End { reference: "a.out", entry: None }, A)  → Some(("a:a", Some("out")))
    /// find(End { reference: "a.b.x", entry: None }, A)  → Some(("a:a.b", Some("x")))
    /// find(End { reference: "done", entry: None }, A)   → Some(("a:done", None))（done を使ったことを覚える）
    /// find(End { reference: "start", entry: None }, a)  → Some(("a:a.start", None))（入れ子の本体の開始）
    /// find(End { reference: "x", entry: None }, A)      → None
    /// ```
    fn find<'r>(&mut self, end: &End<'r>, body: usize) -> Option<(String, Option<&'r str>)> {
        if let Some(e) = end.entry {
            return self.by_entry.get(&e).map(|k| (k.clone(), None));
        }
        let mut segs = end.reference.split('.');
        let head = segs.next().unwrap_or("");
        if let Some(k) = self.by_name.get(&(body, head.to_owned())) {
            let mut key = k.clone();
            let mut rest = segs.next();
            while let Some(seg) = rest {
                let inner = self
                    .entry_by_key
                    .get(&key)
                    .and_then(|&e| self.by_name.get(&(e, seg.to_owned())));
                let Some(inner) = inner else { break };
                key = inner.clone();
                rest = segs.next();
            }
            return Some((key, rest));
        }
        let used = match head {
            "start" => &mut self.start,
            "done" => &mut self.done,
            _ => return None,
        };
        if !used.contains(&body) {
            used.push(body);
        }
        let prefix = self.prefix.get(&body).map_or("a:", String::as_str);
        Some((format!("{prefix}{head}"), None))
    }
}

impl Builder<'_> {
    /// アクション定義ごとの、アクションの流れの図（モデルの `action_flows` を書き換える）。見つからない端は問題にする。
    pub(super) fn action_flows(&mut self) {
        let defs: Vec<(String, usize)> = self
            .model
            .nodes
            .iter()
            .filter(|n| n.kind == "action def")
            .map(|n| (n.key.clone(), n.entry))
            .collect();
        for (key, entry) in defs {
            let flow = self.action_flow(key, entry);
            self.model.action_flows.push(flow);
        }
    }

    /// アクション定義 1 つの、アクションの流れの図。
    ///
    /// 要素は `flow_nodes` で作り（入れ子の本体の要素も）、継起が `start`・`done` を指せば、その本体の開始・終了を足す（`add_pseudo`）。
    /// 線は、直下に書いた継起（種類 `succession`）と順序付きの流れ（種類 `successionFlow`）で、ID は `種類|元|先|ラベル#番号`。
    /// 端が要素に無いときは線にせず、アクション定義の中からも名前が見つからなければ問題にする（直前の要素の無い `then b;` の元は問題にしない）。
    ///
    /// # 引数
    ///
    /// - `key`：アクション定義の、図の要素のキー
    /// - `def`：アクション定義の宣言の番号
    ///
    /// # 戻り値
    ///
    /// アクションの流れの図。要素も線も無ければ、空の一覧を持つ図。
    ///
    /// # 例
    ///
    /// ```text
    /// // "action def A { first start; then action a; then decide d; if x then b; action b; }" のとき
    /// action_flow("A", A の番号)
    ///   → nodes のキー: ["a:start", "a:a", "a:d", "a:b"]
    ///     edges の ID: ["succession|a:start|a:a|#1", "succession|a:a|a:d|#1", "succession|a:d|a:b|[x]#1"]
    /// // "action def A { first a then nope; action a; }" のとき
    /// action_flow("A", A の番号) → edges は空、problems に「「順序」の相手「nope」が見つかりません（succession）」
    /// // "action def A { action a { first start then b; action b; } }" のとき（入れ子の本体）
    /// action_flow("A", A の番号)
    ///   → nodes のキー: ["a:a", "a:a.start", "a:a.b"]（a:a.start・a:a.b の container は "a:a"）
    ///     edges の ID: ["succession|a:a.start|a:a.b|#1"]
    /// ```
    fn action_flow(&mut self, key: String, def: usize) -> ActionFlow {
        let (mut nodes, mut keys) = flow_nodes(self.entries, def);
        for n in &mut nodes {
            if let Some(e) = n.entry {
                n.ports = self.action_params(e);
            }
        }
        let own = params(self.entries, def);
        let mut edges: Vec<Edge> = Vec::new();
        let p = self.p;
        for r in &p.rels {
            // アクション定義そのものと、入れ子の本体に書いた線
            let Some(body) = r.pe.filter(|b| keys.prefix.contains_key(b)) else {
                continue;
            };
            let Some(line) = line_of(r, &p.entries) else {
                continue;
            };
            // 本体そのもののパラメータ：アクション定義なら枠の上（`b:名前`）、入れ子の本体ならその本体を持つアクションの縁
            let holder = (body != def)
                .then(|| keys.by_entry.get(&body).cloned())
                .flatten();
            let body_params = if body == def {
                own.clone()
            } else {
                params(self.entries, body)
            };
            let at = Body {
                entry: body,
                holder: holder.as_deref(),
                params: &body_params,
            };
            let (from, to) = (
                end_key(&mut keys, &line.a, line.kind, &at),
                end_key(&mut keys, &line.b, line.kind, &at),
            );
            let (Some((from, from_port)), Some((to, to_port))) = (from.clone(), to.clone()) else {
                // 流れの見つからない端は、関係の確かめ（`relations`）が知らせる
                if line.kind != "flow" {
                    self.missing_ends(r.start, &line, [from.is_some(), to.is_some()], body);
                }
                continue;
            };
            edges.push(Edge {
                id: String::new(),
                kind: line.kind,
                from,
                to,
                label: line.label,
                src: line.src,
                rel: None,
                from_port,
                to_port,
                end_label: None,
            });
        }
        add_pseudo(&mut nodes, &keys, def);
        let mut seen: HashMap<String, usize> = HashMap::new();
        for e in &mut edges {
            let base = format!("{}|{}|{}|{}", e.kind, e.from, e.to, e.label);
            let k = seen.entry(base.clone()).or_insert(0);
            *k += 1;
            e.id = format!("{base}#{k}");
        }
        ActionFlow {
            key,
            entry: def,
            nodes,
            params: own,
            edges,
        }
    }

    /// アクションの使用のパラメータ。本体に書いたパラメータが無く型があれば、型の定義のパラメータ（8.2.3.17 の parameter）。
    ///
    /// # 引数
    ///
    /// - `e`：アクションの使用（流れの要素）の宣言の番号
    ///
    /// # 戻り値
    ///
    /// パラメータ（書いた順）。無ければ空。
    ///
    /// # 例
    ///
    /// ```text
    /// // "action def Boil { in item w; out item hot; } action def A { action b : Boil; action c { in x; } }" のとき
    /// action_params(b の番号) → [w（in）, hot（out）]（型の定義から）
    /// action_params(c の番号) → [x（in）]
    /// ```
    fn action_params(&self, e: usize) -> Vec<Port> {
        let own = params(self.entries, e);
        let u = &self.entries[e];
        if !own.is_empty() || u.ty.is_empty() {
            return own;
        }
        self.def_of(&u.ty_path, u.pe)
            .map(|t| params(self.entries, t))
            .unwrap_or_default()
    }

    /// 図に無い継起の端のうち、アクション定義の中からも名前が見つからないものを問題にする（モデルの `problems` を書き換える）。
    /// 宣言の番号で決まる端（直前の要素）と、空の参照（直前の要素の無い `then b;` の元）は問題にしない。
    ///
    /// # 引数
    ///
    /// - `pos`：関係の文の位置（UTF-16）
    /// - `line`：線の形にした関係
    /// - `found`：元・先が図の要素に見つかったか
    /// - `body`：線を書いた本体の宣言の番号（名前を探し始める場所）
    fn missing_ends(&mut self, pos: usize, line: &Line<'_>, found: [bool; 2], body: usize) {
        let (what, rel) = if line.kind == "succession" {
            ("「順序」", "succession")
        } else {
            ("「順序付きの流れ」", "succession flow")
        };
        for (end, found) in [&line.a, &line.b].into_iter().zip(found) {
            let head = end.reference.split('.').next().unwrap_or("");
            if found
                || end.entry.is_some()
                || head.is_empty()
                || self.resolve(head, Some(body)).is_some()
            {
                continue;
            }
            self.problem(
                pos,
                format!("{what}の相手「{}」が見つかりません（{rel}）", end.reference),
                None,
            );
        }
    }
}

/// 中にアクションの流れ（入れ子の本体）を描く要素の種類。if・while などの本体は、区画の行に書く（`flowBodyLines`）。
const NESTING_KINDS: &[&str] = &["action", "perform action"];

/// 入れ子の本体をたどる深さの上限。
const NEST_DEPTH: usize = 8;

/// アクション定義の、アクションの流れの要素（`ACTION_FLOW_KINDS`）と、そのキーの表。
/// 中にアクションの流れを書いたアクションの使用は入れ子の本体とし、その要素も、外の要素の直後に書いた順で並べる（`container` は外の要素）。
/// キーは `a:名前`（入れ子は `a:外.名前`）。名前の無い要素は `a:#番号`（1 から、本体ごと）、同じ名前の 2 つ目からは `a:名前#2`。
///
/// # 引数
///
/// - `entries`：解析結果の宣言
/// - `def`：アクション定義の宣言の番号
///
/// # 戻り値
///
/// 要素と、キーの表（宣言の番号・本体ごとの名前から。同じ名前は最初の要素）。
///
/// # 例
///
/// ```text
/// // "action def A { action a; attribute x; send s; fork f; }" のとき
/// flow_nodes(entries, A の番号) → キー ["a:a", "a:#1", "a:f"]（属性は要素にしない）
/// // "action def A { action boil { action heat; then action wait; } action c; }" のとき
/// flow_nodes(entries, A の番号) → キー ["a:boil", "a:boil.heat", "a:boil.wait", "a:c"]
/// ```
fn flow_nodes(entries: &[Entry], def: usize) -> (Vec<FlowNode>, Keys) {
    let mut nodes: Vec<FlowNode> = Vec::new();
    let mut keys = Keys::default();
    body_nodes(entries, def, None, &mut nodes, &mut keys, 0);
    (nodes, keys)
}

/// 本体 1 つの、アクションの流れの要素を足す（`flow_nodes` の中身）。入れ子の本体は、その要素の直後にたどる。
///
/// # 引数
///
/// - `entries`：解析結果の宣言
/// - `body`：本体の宣言の番号
/// - `container`：本体を持つ要素のキー（アクション定義そのものなら `None`）
/// - `nodes`：要素を足す先
/// - `keys`：キーの表を足す先
/// - `depth`：たどった深さ
fn body_nodes(
    entries: &[Entry],
    body: usize,
    container: Option<&str>,
    nodes: &mut Vec<FlowNode>,
    keys: &mut Keys,
    depth: usize,
) {
    let prefix = container.map_or_else(|| "a:".to_owned(), |c| format!("{c}."));
    keys.prefix.insert(body, prefix.clone());
    let mut unnamed = 0;
    for &c in &entries[body].children {
        let e = &entries[c];
        if !ACTION_FLOW_KINDS.contains(&e.kind.as_str()) {
            continue;
        }
        let key = if e.name.is_empty() {
            unnamed += 1;
            format!("{prefix}#{unnamed}")
        } else {
            match keys.by_name.entry((body, e.name.clone())) {
                // 同じ名前の 2 つ目から
                Slot::Occupied(_) => {
                    let mut n = 2;
                    while nodes
                        .iter()
                        .any(|x| x.key == format!("{prefix}{}#{n}", e.name))
                    {
                        n += 1;
                    }
                    format!("{prefix}{}#{n}", e.name)
                }
                Slot::Vacant(v) => v.insert(format!("{prefix}{}", e.name)).clone(),
            }
        };
        keys.by_entry.insert(c, key.clone());
        keys.entry_by_key.insert(key.clone(), c);
        nodes.push(FlowNode {
            key: key.clone(),
            name: e.name.clone(),
            kind: e.kind.clone(),
            entry: Some(c),
            ports: Vec::new(),
            container: container.map(str::to_owned),
        });
        let nests = NESTING_KINDS.contains(&e.kind.as_str())
            && e.children
                .iter()
                .any(|&g| ACTION_FLOW_KINDS.contains(&entries[g].kind.as_str()));
        if nests && depth < NEST_DEPTH {
            body_nodes(entries, c, Some(&key), nodes, keys, depth + 1);
        }
    }
}

/// 使った本体ごとに、暗黙の開始（`start`）・終了（`done`）の要素を足す。アクション定義そのものの開始は先頭、終了は末尾に、
/// 入れ子の本体の開始は本体を持つ要素の直後、終了はその本体の最後の要素の後ろに置く。
///
/// # 引数
///
/// - `nodes`：要素（書き換える）
/// - `keys`：キーの表（開始・終了を使った本体）
/// - `def`：アクション定義の宣言の番号
///
/// # 例
///
/// ```text
/// // 要素 [a:a, a:a.b, a:c] で、アクション定義と a の本体が start を、a の本体が done を使った
/// add_pseudo(nodes, keys, A) → [a:start, a:a, a:a.start, a:a.b, a:a.done, a:c]
/// ```
fn add_pseudo(nodes: &mut Vec<FlowNode>, keys: &Keys, def: usize) {
    for (which, bodies) in [("start", &keys.start), ("done", &keys.done)] {
        for &body in bodies {
            let prefix = keys.prefix.get(&body).map_or("a:", String::as_str);
            let container = (body != def).then(|| prefix.trim_end_matches('.').to_owned());
            let made = implicit(&format!("{prefix}{which}"), which, container.clone());
            let at = match (&container, which) {
                (None, "start") => 0,
                (None, _) => nodes.len(),
                (Some(c), "start") => nodes
                    .iter()
                    .position(|n| &n.key == c)
                    .map_or(nodes.len(), |i| i + 1),
                (Some(_), _) => nodes
                    .iter()
                    .rposition(|n| n.key.starts_with(prefix))
                    .map_or(nodes.len(), |i| i + 1),
            };
            nodes.insert(at, made);
        }
    }
}

/// 関係を、アクションの流れの図の線の形にする。継起は種類 `succession`（ラベルは名前と `[ガード]`、範囲は文）、
/// 順序付きの流れは種類 `successionFlow`、流れは種類 `flow`（ラベルは名前・型・アイテム、範囲は名前付きなら使用、名前の無いものは文）。
///
/// # 引数
///
/// - `r`：関係
/// - `entries`：解析結果の宣言（名前付きの順序付きの流れの使用の範囲に使う）
///
/// # 戻り値
///
/// 線の形。継起・順序付きの流れでなければ `None`。
///
/// # 例
///
/// ```text
/// line_of(if x > 0 then b; の継起)       → Some(Line { kind: "succession", label: "[x > 0]", … })
/// line_of(succession s first a then b;)  → Some(Line { kind: "succession", label: "s", … })
/// line_of(succession flow of W from a to b;) → Some(Line { kind: "successionFlow", label: "W", … })
/// line_of(flow a.o to b.i;)              → Some(Line { kind: "flow", label: "", … })
/// line_of(satisfy の関係)                → None
/// ```
fn line_of<'r>(r: &'r Rel, entries: &[Entry]) -> Option<Line<'r>> {
    let stmt = Span {
        start: r.start,
        end: r.end + 1,
    };
    match &r.kind {
        RelKind::Succession {
            a,
            b,
            a_entry,
            b_entry,
            guard,
            name,
        } => {
            let guard = (!guard.is_empty()).then(|| format!("[{guard}]"));
            let label = [Some(name.clone()).filter(|n| !n.is_empty()), guard]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            Some(Line {
                kind: "succession",
                a: End {
                    reference: a,
                    entry: *a_entry,
                },
                b: End {
                    reference: b,
                    entry: *b_entry,
                },
                label,
                src: stmt,
            })
        }
        RelKind::SuccessionFlow {
            item,
            a,
            b,
            name,
            ty,
            usage,
        }
        | RelKind::Flow {
            item,
            a,
            b,
            name,
            ty,
            usage,
        } => Some(Line {
            kind: if matches!(r.kind, RelKind::Flow { .. }) {
                "flow"
            } else {
                "successionFlow"
            },
            a: End {
                reference: a,
                entry: None,
            },
            b: End {
                reference: b,
                entry: None,
            },
            label: flow_label(name, ty, item),
            src: usage.map_or(stmt, |u| Span {
                start: entries[u].start,
                end: entries[u].end,
            }),
        }),
        _ => None,
    }
}

/// 暗黙の開始（`start`）か終了（`done`）の要素（8.2.3.17 の start-node・done-node）。宣言を持たない。
///
/// # 引数
///
/// - `key`：要素のキー（`a:start`、入れ子の本体なら `a:外.start`）
/// - `which`：`start` か `done`
/// - `container`：入れ子の本体なら、その本体を持つ要素のキー
///
/// # 戻り値
///
/// 名前と種類が `which` の要素。
///
/// # 例
///
/// ```text
/// implicit("a:start", "start", None) → FlowNode { key: "a:start", name: "start", kind: "start", entry: None, ports: [], container: None }
/// implicit("a:b.done", "done", Some("a:b")) → FlowNode { key: "a:b.done", …, container: Some("a:b") }
/// ```
fn implicit(key: &str, which: &str, container: Option<String>) -> FlowNode {
    FlowNode {
        key: key.to_owned(),
        name: which.to_owned(),
        kind: which.to_owned(),
        entry: None,
        ports: Vec::new(),
        container,
    }
}

/// 線を書いた本体（`end_key` に渡す）。
struct Body<'a> {
    /// 本体の宣言の番号。
    entry: usize,
    /// 入れ子の本体なら、その本体を持つ要素のキー。アクション定義そのものなら `None`。
    holder: Option<&'a str>,
    /// 本体そのもののパラメータ。
    params: &'a [Port],
}

/// 線の端の、図の要素のキーとパラメータ。流れ・順序付きの流れの端の、要素をたどった後の段（`a.o` の `o`）はパラメータ（`port:o`）にする。
/// 要素に無い 1 段だけの端が本体そのもののパラメータなら、アクション定義では枠の上のパラメータ（`b:名前`）、
/// 入れ子の本体ではその本体を持つ要素の縁のパラメータにする。
///
/// # 引数
///
/// - `keys`：図の要素のキーの表
/// - `end`：線の端
/// - `kind`：線の種類（`succession`・`successionFlow`・`flow`）
/// - `at`：線を書いた本体
///
/// # 戻り値
///
/// （要素のキー, パラメータ）。図に無ければ `None`。
///
/// # 例
///
/// ```text
/// // アクション定義の本体に要素 a:boil があり、アクション定義のパラメータ cold がある
/// end_key(keys, "boil.hot", "flow", 定義)       → Some(("a:boil", Some("port:hot")))
/// end_key(keys, "boil.hot", "succession", 定義) → Some(("a:boil", None))
/// end_key(keys, "cold", "flow", 定義)           → Some(("b:cold", None))
/// // boil の本体（パラメータ w）の中で
/// end_key(keys, "w", "flow", boil の本体)       → Some(("a:boil", Some("port:w")))
/// end_key(keys, "nope", "flow", 定義)           → None
/// ```
fn end_key(
    keys: &mut Keys,
    end: &End<'_>,
    kind: &str,
    at: &Body<'_>,
) -> Option<(String, Option<String>)> {
    let flowing = kind != "succession";
    if let Some((k, rest)) = keys.find(end, at.entry) {
        let port = rest
            .filter(|_| flowing && end.entry.is_none())
            .map(|p| format!("port:{p}"));
        return Some((k, port));
    }
    let name = end.reference;
    if !flowing || name.contains('.') || !at.params.iter().any(|p| p.name == name) {
        return None;
    }
    Some(match at.holder {
        None => (format!("b:{name}"), None),
        Some(h) => (h.to_owned(), Some(format!("port:{name}"))),
    })
}

/// 宣言の直下の、名前のあるパラメータ（向き `in`・`out`・`inout` の付いた特徴量。書いた順）。
///
/// # 引数
///
/// - `entries`：解析結果の宣言
/// - `owner`：アクション定義かアクションの使用の宣言の番号
///
/// # 戻り値
///
/// パラメータ。向きの無い特徴量・アクションの流れの要素は含めない。
///
/// # 例
///
/// ```text
/// // "action def A { in item cold : Water; out tea : Water; attribute n; action b; }" のとき
/// params(entries, A の番号) → [cold（in, Water）, tea（out, Water）]
/// ```
fn params(entries: &[Entry], owner: usize) -> Vec<Port> {
    entries[owner]
        .children
        .iter()
        .copied()
        .filter_map(|c| {
            let e = &entries[c];
            let dir = param_dir(e)?;
            (!e.name.is_empty() && !ACTION_FLOW_KINDS.contains(&e.kind.as_str())).then(|| Port {
                name: e.name.clone(),
                ty: e.ty.clone(),
                conj: e.conj.unwrap_or(false),
                dir,
                entry: c,
            })
        })
        .collect()
}

/// 特徴量の向き（修飾の `in`・`out`・`inout`、無ければ書いた向き）。
///
/// # 引数
///
/// - `e`：特徴量の宣言
///
/// # 戻り値
///
/// `in`・`out`・`inout` のいずれか。向きが無ければ `None`。
///
/// # 例
///
/// ```text
/// param_dir(in item w;)  → Some("in")
/// param_dir(out t : W;)  → Some("out")
/// param_dir(attribute n;) → None
/// ```
fn param_dir(e: &Entry) -> Option<&'static str> {
    let m = e
        .mods
        .as_deref()
        .filter(|m| !m.is_empty())
        .or(e.dir.as_deref())
        .unwrap_or("");
    ["inout", "out", "in"].into_iter().find(|d| has_word(m, d))
}
