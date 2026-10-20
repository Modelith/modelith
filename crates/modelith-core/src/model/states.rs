//! 状態定義ごとに、状態遷移の図（StateTransitionView、8.2.3.18）に描く状態と遷移を作る。
//!
//! 要素は、状態定義の中の状態（入れ子の状態は、外の状態の中に描く）と、最初の遷移（`entry; then s;`）の元になる
//! 開始の記号・`done` へ向かう遷移の先になる終了の記号（本体ごとに 1 つ）。線は、状態定義と中の状態の本体に書いた遷移。
//! 要素のキーと線の ID は、図の操作（`edit`）が同じものを探し直せるよう、ここで決める（ADR-0016）。

use std::collections::HashMap;

use super::{Builder, Edge, StateMachine, StateNode};
use crate::project::{Entry, Rel, RelKind, Span};

/// 状態の使用の種類（StateUsage・ExhibitStateUsage、8.2.2.18）。
const STATE_KINDS: &[&str] = &["state", "exhibit state"];

/// 状態定義 1 つの、図の要素のキーの表。
#[derive(Default)]
struct Keys {
    /// 状態の宣言の番号 → キー。
    by_entry: HashMap<usize, String>,
    /// 本体（状態定義か状態の宣言の番号）→ 中の状態のキーの頭（`s:`・`s:on.`）。
    prefix: HashMap<usize, String>,
}

impl Builder<'_> {
    /// 状態定義ごとの、状態遷移の図（モデルの `state_machines` を書き換える）。見つからない遷移の相手は問題にする。
    pub(super) fn state_machines(&mut self) {
        let defs: Vec<(String, usize)> = self
            .model
            .nodes
            .iter()
            .filter(|n| n.kind == "state def")
            .map(|n| (n.key.clone(), n.entry))
            .collect();
        for (key, entry) in defs {
            let machine = self.state_machine(key, entry);
            self.model.state_machines.push(machine);
        }
    }

    /// 状態定義 1 つの、状態遷移の図。
    ///
    /// 要素は `state_nodes` で作り、本体に最初の遷移があれば開始の記号を、`done` へ向かう遷移があれば終了の記号を、
    /// その本体の要素として足す（開始は本体の状態の前、終了は後ろ）。線は種類 `transition` で、ラベルは
    /// `トリガ [ガード] / 効果`（8.2.3.18）、ID は `transition|元|先|ラベル#番号`。端が見つからない遷移は線にせず、問題にする。
    ///
    /// # 引数
    ///
    /// - `key`：状態定義の、図の要素のキー
    /// - `def`：状態定義の宣言の番号
    ///
    /// # 戻り値
    ///
    /// 状態遷移の図。状態も遷移も無ければ、空の一覧を持つ図。
    ///
    /// # 例
    ///
    /// ```text
    /// // "state def S { entry; then off; state off; state on; transition first off accept Go then on; }" のとき
    /// state_machine("S", S の番号)
    ///   → nodes のキー: ["s:#start", "s:off", "s:on"]
    ///     edges の ID: ["transition|s:#start|s:off|#1", "transition|s:off|s:on|Go#1"]
    /// // "state def S { state a; transition first a then nope; }" のとき
    /// state_machine("S", S の番号) → edges は空、problems に「「遷移」の相手「nope」が見つかりません（transition）」
    /// ```
    fn state_machine(&mut self, key: String, def: usize) -> StateMachine {
        let (states, keys) = state_nodes(self.entries, def);
        let mut pseudo: Vec<StateNode> = Vec::new();
        let mut edges: Vec<Edge> = Vec::new();
        let p = self.p;
        for r in p.rels.iter() {
            let Some(body) = r.pe.filter(|b| keys.prefix.contains_key(b)) else {
                continue;
            };
            let Some((from, to, label)) = self.transition_ends(r, body, &keys, &mut pseudo) else {
                continue;
            };
            edges.push(Edge {
                id: String::new(),
                kind: "transition",
                from,
                to,
                label,
                src: Span {
                    start: r.start,
                    end: r.end + 1,
                },
                rel: None,
                from_port: None,
                to_port: None,
                end_label: None,
            });
        }
        let mut seen: HashMap<String, usize> = HashMap::new();
        for e in &mut edges {
            let base = format!("{}|{}|{}|{}", e.kind, e.from, e.to, e.label);
            let k = seen.entry(base.clone()).or_insert(0);
            *k += 1;
            e.id = format!("{base}#{k}");
        }
        StateMachine {
            key,
            entry: def,
            parallel: self.entries[def].parallel,
            nodes: with_pseudo_states(states, pseudo),
            edges,
        }
    }

    /// 遷移の関係の、元と先のキーとラベル。開始・終了の記号を使ったら `pseudo` に足す（同じ本体には 1 つだけ）。
    /// 端が見つからなければ問題にして `None` を返す（直前の状態から引く遷移で、その状態に名前が無いときは問題にしない）。
    ///
    /// # 引数
    ///
    /// - `r`：関係（遷移と最初の遷移のほかは `None`）
    /// - `body`：関係を書いた本体（状態定義か状態の宣言の番号）
    /// - `keys`：要素のキーの表
    /// - `pseudo`：使った開始・終了の記号（足していく）
    ///
    /// # 戻り値
    ///
    /// （元のキー, 先のキー, ラベル）。遷移でないか、端が見つからなければ `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 本体 S（キーの頭 "s:"）に状態 a・b がある
    /// transition_ends(transition first a accept Go if x do e then b;) → Some(("s:a", "s:b", "Go [x] / e"))
    /// transition_ends(entry; then a;)                                 → Some(("s:#start", "s:a", ""))（pseudo に開始を足す）
    /// transition_ends(transition first a then done;)                  → Some(("s:a", "s:#done", ""))（pseudo に終了を足す）
    /// transition_ends(satisfy の関係)                                 → None
    /// ```
    fn transition_ends(
        &mut self,
        r: &Rel,
        body: usize,
        keys: &Keys,
        pseudo: &mut Vec<StateNode>,
    ) -> Option<(String, String, String)> {
        let (from, to, label) = match &r.kind {
            RelKind::Transition {
                from,
                ev,
                to,
                via,
                guard,
                effect,
                from_entry,
                ..
            } => {
                let source = match from_entry {
                    Some(e) => keys.by_entry.get(e).cloned(),
                    None => self.state_key(from, body, keys),
                };
                let Some(source) = source else {
                    if from_entry.is_none() && !from.is_empty() {
                        self.missing_state(r.start, from);
                    }
                    return None;
                };
                (source, to, transition_label(ev, via, guard, effect))
            }
            RelKind::EntryTransition { to, guard } => (
                pseudo_key(keys, body, pseudo, "start"),
                to,
                if guard.is_empty() {
                    String::new()
                } else {
                    format!("[{guard}]")
                },
            ),
            _ => return None,
        };
        let target = if to == "done" {
            Some(pseudo_key(keys, body, pseudo, "done"))
        } else {
            self.state_key(to, body, keys)
        };
        let Some(target) = target else {
            self.missing_state(r.start, to);
            return None;
        };
        Some((from, target, label))
    }

    /// 遷移の端の参照（`a`・`on.low`）を、状態遷移の図の状態のキーにする。最初の段は、書いた本体の中の状態から探し、
    /// 無ければ外側の本体へ順に探す（状態定義の本体まで）。2 段目からは、その状態の中の状態を探す。
    ///
    /// # 引数
    ///
    /// - `reference`：端の参照
    /// - `body`：遷移を書いた本体（状態定義か状態の宣言の番号）
    /// - `keys`：要素のキーの表
    ///
    /// # 戻り値
    ///
    /// 状態のキー。見つからなければ `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // state def S { state on { state low; } state off; } の on の本体で
    /// state_key("off", on, keys)    → Some("s:off")      // 外側の本体で見つかる
    /// state_key("on.low", S, keys)  → Some("s:on.low")
    /// state_key("nope", S, keys)    → None
    /// ```
    fn state_key(&self, reference: &str, body: usize, keys: &Keys) -> Option<String> {
        let mut segments = reference.split('.');
        let head = segments.next().unwrap_or("");
        let mut scope = Some(body);
        let mut found = None;
        while let Some(b) = scope.filter(|b| keys.prefix.contains_key(b)) {
            found = self.child_state(b, head, keys);
            if found.is_some() {
                break;
            }
            scope = self.entries[b].pe;
        }
        let mut at = found?;
        for s in segments {
            at = self.child_state(at, s, keys)?;
        }
        keys.by_entry.get(&at).cloned()
    }

    /// 本体の直下の、名前が `name` の状態の宣言の番号（図の要素になっているもの）。
    ///
    /// # 引数
    ///
    /// - `body`：本体（状態定義か状態の宣言の番号）
    /// - `name`：状態の名前
    /// - `keys`：要素のキーの表
    ///
    /// # 戻り値
    ///
    /// 最初に書いた、その名前の状態の宣言の番号。無ければ `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // state def S { state a; part a; } の S で
    /// child_state(S, "a", keys) → Some(state a の番号)
    /// child_state(S, "b", keys) → None
    /// ```
    fn child_state(&self, body: usize, name: &str, keys: &Keys) -> Option<usize> {
        self.entries[body]
            .children
            .iter()
            .copied()
            .find(|c| self.entries[*c].name == name && keys.by_entry.contains_key(c))
    }

    /// 見つからない遷移の相手を問題にする（モデルの `problems` を書き換える）。
    ///
    /// # 引数
    ///
    /// - `pos`：関係の文の位置（UTF-16）
    /// - `who`：見つからない参照
    fn missing_state(&mut self, pos: usize, who: &str) {
        self.problem(
            pos,
            format!("「遷移」の相手「{who}」が見つかりません（transition）"),
            None,
        );
    }
}

/// 状態定義の中の状態を、入れ子の外から順に（書いた順に）集め、キーの表を作る。
/// キーは `s:` に、状態定義からの名前の道のり（`s:on.low`）。名前の無い状態は `s:頭#番号`、同じ本体の同じ名前の 2 つ目からは `#2`。
///
/// # 引数
///
/// - `entries`：解析結果の宣言
/// - `def`：状態定義の宣言の番号
///
/// # 戻り値
///
/// 要素（本体ごとに書いた順。外の本体の状態が先）と、キーの表。
///
/// # 例
///
/// ```text
/// // "state def S { state on parallel { state a; state b; } state off; attribute x; }" のとき
/// state_nodes(entries, S の番号) → キー ["s:on", "s:on.a", "s:on.b", "s:off"]（s:on.a の container は "s:on"）
/// ```
fn state_nodes(entries: &[Entry], def: usize) -> (Vec<StateNode>, Keys) {
    let mut nodes = Vec::new();
    let mut keys = Keys::default();
    let mut stack = vec![(def, None::<String>, "s:".to_owned())];
    while let Some((body, container, prefix)) = stack.pop() {
        keys.prefix.insert(body, prefix.clone());
        let mut unnamed = 0;
        let mut inner = Vec::new();
        for &c in &entries[body].children {
            let e = &entries[c];
            if !STATE_KINDS.contains(&e.kind.as_str()) {
                continue;
            }
            let key = if e.name.is_empty() {
                unnamed += 1;
                format!("{prefix}#{unnamed}")
            } else if nodes
                .iter()
                .any(|n: &StateNode| n.key == format!("{prefix}{}", e.name))
            {
                let mut n = 2;
                while nodes
                    .iter()
                    .any(|x: &StateNode| x.key == format!("{prefix}{}#{n}", e.name))
                {
                    n += 1;
                }
                format!("{prefix}{}#{n}", e.name)
            } else {
                format!("{prefix}{}", e.name)
            };
            keys.by_entry.insert(c, key.clone());
            nodes.push(StateNode {
                key: key.clone(),
                name: e.name.clone(),
                kind: e.kind.clone(),
                entry: Some(c),
                container: container.clone(),
                parallel: e.parallel,
            });
            inner.push((c, Some(key.clone()), format!("{key}.")));
        }
        // 書いた順に読むため、後ろから積む
        stack.extend(inner.into_iter().rev());
    }
    (nodes, keys)
}

/// 要素を、外の状態の直後にその中の状態が続く順（深さ優先・書いた順）に並べ、開始・終了の記号を、
/// その本体の要素の前（開始）と後ろ（終了）に入れる。
///
/// # 引数
///
/// - `states`：状態（`state_nodes` の順）
/// - `pseudo`：開始・終了の記号（`container` で本体を指す）
///
/// # 戻り値
///
/// 記号を入れた要素の一覧。
///
/// # 例
///
/// ```text
/// with_pseudo_states([s:a, s:b], [s:#done, s:#start]) → [s:#start, s:a, s:b, s:#done]
/// with_pseudo_states([s:on, s:off, s:on.a], [])       → [s:on, s:on.a, s:off]
/// ```
fn with_pseudo_states(states: Vec<StateNode>, pseudo: Vec<StateNode>) -> Vec<StateNode> {
    let mut out = Vec::with_capacity(states.len() + pseudo.len());
    nest(None, &states, &pseudo, &mut out);
    out
}

/// 本体 1 つの要素を `out` に足す（開始の記号、書いた順の状態とその中の要素、終了の記号の順）。中の状態の本体にも同じことをする。
///
/// # 引数
///
/// - `at`：本体の状態のキー（状態定義の本体は `None`）
/// - `states`：状態
/// - `pseudo`：開始・終了の記号
/// - `out`：並べた要素（足していく）
///
/// # 例
///
/// ```text
/// nest(None, [s:on, s:on.a], [s:#start], out) → out に [s:#start, s:on, s:on.a] を足す
/// ```
fn nest(at: Option<&str>, states: &[StateNode], pseudo: &[StateNode], out: &mut Vec<StateNode>) {
    let marks = |kind: &'static str| {
        pseudo
            .iter()
            .filter(move |p| p.container.as_deref() == at && p.kind == kind)
            .cloned()
    };
    out.extend(marks("start"));
    for n in states.iter().filter(|n| n.container.as_deref() == at) {
        out.push(n.clone());
        nest(Some(&n.key), states, pseudo, out);
    }
    out.extend(marks("done"));
}

/// 本体の開始（`start`）か終了（`done`）の記号のキー。まだ無ければ `pseudo` に足す。
/// キーは、状態定義の本体なら `s:#start`・`s:#done`、状態 `on` の本体なら `s:on#start`・`s:on#done`。
///
/// # 引数
///
/// - `keys`：要素のキーの表
/// - `body`：本体（状態定義か状態の宣言の番号）
/// - `pseudo`：使った開始・終了の記号（足していく）
/// - `which`：`start` か `done`
///
/// # 戻り値
///
/// 記号のキー。
///
/// # 例
///
/// ```text
/// pseudo_key(keys, S, pseudo, "start") → "s:#start"（pseudo に足す）
/// pseudo_key(keys, on, pseudo, "done") → "s:on#done"（container は "s:on"）
/// ```
fn pseudo_key(keys: &Keys, body: usize, pseudo: &mut Vec<StateNode>, which: &str) -> String {
    let container = keys.by_entry.get(&body).cloned();
    let head = container.as_deref().unwrap_or("s:");
    let key = format!("{head}#{which}");
    if !pseudo.iter().any(|p| p.key == key) {
        pseudo.push(StateNode {
            key: key.clone(),
            name: which.to_owned(),
            kind: which.to_owned(),
            entry: None,
            container,
            parallel: false,
        });
    }
    key
}

/// 遷移のラベル（8.2.3.18 の transition-label）。`トリガ [ガード] / 効果` の形で、無い部分は書かない。
///
/// # 引数
///
/// - `ev`：トリガの受けるもの
/// - `via`：トリガの `via` の後
/// - `guard`：ガード
/// - `effect`：効果
///
/// # 戻り値
///
/// ラベル。どれも無ければ空文字列。
///
/// # 例
///
/// ```text
/// transition_label("Go", "", "x > 0", "beep") → "Go [x > 0] / beep"
/// transition_label("Go", "p", "", "")         → "Go via p"
/// transition_label("", "", "", "beep")        → "/ beep"
/// transition_label("", "", "", "")            → ""
/// ```
fn transition_label(ev: &str, via: &str, guard: &str, effect: &str) -> String {
    let trigger = match (ev.is_empty(), via.is_empty()) {
        (false, false) => format!("{ev} via {via}"),
        (false, true) => ev.to_owned(),
        _ => String::new(),
    };
    let guard = (!guard.is_empty()).then(|| format!("[{guard}]"));
    let effect = (!effect.is_empty()).then(|| format!("/ {effect}"));
    [Some(trigger).filter(|t| !t.is_empty()), guard, effect]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ")
}
