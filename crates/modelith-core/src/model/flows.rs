//! アクション定義ごとに、アクションの流れの図（ActionFlowView、8.2.3.17）に描く要素と線を作る。
//!
//! 要素は、アクション定義の直下のアクションの流れの要素（アクション・制御の節・送受信などのアクションの節）と、
//! 継起が指す暗黙の開始（`start`）・終了（`done`）。線は、アクション定義の直下に書いた継起と順序付きの流れ。
//! 要素のキーと線の ID は、図の操作（`edit`）が同じものを探し直せるよう、ここで決める（ADR-0016）。

use std::collections::HashMap;

use super::{ActionFlow, Builder, Edge, FlowNode, flow_label};
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

/// 図の要素のキーの表（宣言の番号・名前から）と、開始・終了を使ったか。
#[derive(Default)]
struct Keys {
    by_entry: HashMap<usize, String>,
    by_name: HashMap<String, String>,
    start: bool,
    done: bool,
}

impl Keys {
    /// 継起の端の、図の要素のキー。宣言の番号があればその要素、無ければ参照の最初の段の名前の要素。
    /// `start`・`done` は、同じ名前の要素が無ければ暗黙の開始・終了にする（使ったことを覚える）。
    ///
    /// # 引数
    ///
    /// - `end`：継起の端
    ///
    /// # 戻り値
    ///
    /// 要素のキー。図に無ければ `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 要素 a:a がある
    /// find(End { reference: "a.out", entry: None }) → Some("a:a")
    /// find(End { reference: "done", entry: None })  → Some("a:done")（done を使ったことを覚える）
    /// find(End { reference: "x", entry: None })     → None
    /// ```
    fn find(&mut self, end: &End<'_>) -> Option<String> {
        if let Some(e) = end.entry {
            return self.by_entry.get(&e).cloned();
        }
        let head = end.reference.split('.').next().unwrap_or("");
        if let Some(k) = self.by_name.get(head) {
            return Some(k.clone());
        }
        match head {
            "start" => self.start = true,
            "done" => self.done = true,
            _ => return None,
        }
        Some(format!("a:{head}"))
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
    /// 要素は `flow_nodes` で作り、継起が `start`・`done` を指せば、開始を先頭・終了を末尾に足す。
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
    /// ```
    fn action_flow(&mut self, key: String, def: usize) -> ActionFlow {
        let (mut nodes, mut keys) = flow_nodes(self.entries, def);
        let mut edges: Vec<Edge> = Vec::new();
        let p = self.p;
        for r in p.rels.iter().filter(|r| r.pe == Some(def)) {
            let Some(line) = line_of(r, &p.entries) else {
                continue;
            };
            let (from, to) = (keys.find(&line.a), keys.find(&line.b));
            let (Some(from), Some(to)) = (from.clone(), to.clone()) else {
                self.missing_ends(r.start, &line, [from.is_some(), to.is_some()], def);
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
                from_port: None,
                to_port: None,
                end_label: None,
            });
        }
        if keys.start {
            nodes.insert(0, implicit("start"));
        }
        if keys.done {
            nodes.push(implicit("done"));
        }
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
            edges,
        }
    }

    /// 図に無い継起の端のうち、アクション定義の中からも名前が見つからないものを問題にする（モデルの `problems` を書き換える）。
    /// 宣言の番号で決まる端（直前の要素）と、空の参照（直前の要素の無い `then b;` の元）は問題にしない。
    ///
    /// # 引数
    ///
    /// - `pos`：関係の文の位置（UTF-16）
    /// - `line`：線の形にした関係
    /// - `found`：元・先が図の要素に見つかったか
    /// - `def`：アクション定義の宣言の番号（名前を探し始める場所）
    fn missing_ends(&mut self, pos: usize, line: &Line<'_>, found: [bool; 2], def: usize) {
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
                || self.resolve(head, Some(def)).is_some()
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

/// アクション定義の直下の、アクションの流れの要素（`ACTION_FLOW_KINDS`。書いた順）と、そのキーの表。
/// キーは `a:名前`。名前の無い要素は `a:#番号`（1 から）、同じ名前の 2 つ目からは `a:名前#2`。
///
/// # 引数
///
/// - `entries`：解析結果の宣言
/// - `def`：アクション定義の宣言の番号
///
/// # 戻り値
///
/// 要素と、キーの表（宣言の番号・名前から。同じ名前は最初の要素）。
///
/// # 例
///
/// ```text
/// // "action def A { action a; attribute x; send s; fork f; }" のとき
/// flow_nodes(entries, A の番号) → キー ["a:a", "a:#1", "a:f"]（属性は要素にしない）
/// ```
fn flow_nodes(entries: &[Entry], def: usize) -> (Vec<FlowNode>, Keys) {
    let mut nodes: Vec<FlowNode> = Vec::new();
    let mut keys = Keys::default();
    let mut unnamed = 0;
    for &c in &entries[def].children {
        let e = &entries[c];
        if !ACTION_FLOW_KINDS.contains(&e.kind.as_str()) {
            continue;
        }
        let key = if e.name.is_empty() {
            unnamed += 1;
            format!("a:#{unnamed}")
        } else if keys.by_name.contains_key(&e.name) {
            let mut n = 2;
            while nodes.iter().any(|x| x.key == format!("a:{}#{n}", e.name)) {
                n += 1;
            }
            format!("a:{}#{n}", e.name)
        } else {
            let k = format!("a:{}", e.name);
            keys.by_name.insert(e.name.clone(), k.clone());
            k
        };
        keys.by_entry.insert(c, key.clone());
        nodes.push(FlowNode {
            key,
            name: e.name.clone(),
            kind: e.kind.clone(),
            entry: Some(c),
        });
    }
    (nodes, keys)
}

/// 関係を、アクションの流れの図の線の形にする。継起は種類 `succession`（ラベルは名前と `[ガード]`、範囲は文）、
/// 順序付きの流れは種類 `successionFlow`（ラベルは名前・型・アイテム、範囲は名前付きなら使用、名前の無いものは文）。
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
        } => Some(Line {
            kind: "successionFlow",
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
/// - `which`：`start` か `done`
///
/// # 戻り値
///
/// キー `a:start`・`a:done`、名前と種類が `which` の要素。
///
/// # 例
///
/// ```text
/// implicit("start") → FlowNode { key: "a:start", name: "start", kind: "start", entry: None }
/// ```
fn implicit(which: &str) -> FlowNode {
    FlowNode {
        key: format!("a:{which}"),
        name: which.to_owned(),
        kind: which.to_owned(),
        entry: None,
    }
}
