//! シナリオ（`occurrence def`）ごとに、シーケンス図（SequenceView、9.2.20.2.7・8.2.3.9）に描くライフライン・イベント・メッセージ・順序を作る。
//!
//! ライフラインは、シナリオの直下の名前のある部品と出来事。イベントは、ライフラインの本体（入れ子の部品の本体も）に書いた
//! `event occurrence` と、メッセージ・順序の端（`a.ev`・`a.sub.ev`）が指すもの。時間は上から下へ進み、メッセージと、
//! メッセージの端でないイベントが 1 段ずつ使う。段は、順序（`first x then y`・`then event occurrence y`）を守り、
//! 順序の決まらないものは書いた位置の順にする。要素のキーと線の ID は、図の操作（`edit`）が同じものを探し直せるよう、ここで決める（ADR-0016）。

use std::collections::HashMap;

use super::chains::ChainEnd;
use super::{Builder, Edge, Lifeline, Sequence, SequenceEvent, SequenceMessage};
use crate::project::{RelKind, Span};

/// ライフラインになる使用の種類（シナリオの直下に書いたもの）。
const LIFELINE_KINDS: &[&str] = &["part", "occurrence"];

/// イベントを探す本体になる使用の種類（ライフラインと、その中の部品・出来事・アイテム）。
const HOLDER_KINDS: &[&str] = &["part", "occurrence", "item"];

/// 段に並べるもの（メッセージか、メッセージの端でないイベント）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Item {
    /// メッセージ（`Msg` の並びの添字）。
    Message(usize),
    /// イベント（`Events` の添字）。
    Event(usize),
}

/// 作りかけのイベントの表。
#[derive(Default)]
struct Events {
    /// イベント（段は後で決める）と、段を決めるときの位置（宣言か、最初に指した文の位置。UTF-16）。
    list: Vec<(SequenceEvent, usize)>,
    /// キー → 添字。
    by_key: HashMap<String, usize>,
    /// 宣言の番号 → 添字。
    by_entry: HashMap<usize, usize>,
}

impl Events {
    /// イベントを足す（同じキーがあれば、それを返す）。
    ///
    /// # 引数
    ///
    /// - `lifeline`：ライフラインの名前
    /// - `rest`：ライフラインから先の連鎖（`ev`・`sub.ev`。空でない）
    /// - `entry`：イベントの宣言の番号（分からなければ None）
    /// - `pos`：段を決めるときの位置（UTF-16）
    ///
    /// # 戻り値
    ///
    /// イベントの添字。
    ///
    /// # 例
    ///
    /// ```text
    /// add("a", "sub.ev", Some(3), 10) → 0（キー "e:a.sub.ev"、札 ".sub.ev"、ライフライン "l:a"）
    /// add("a", "sub.ev", None, 50)    → 0（同じキー）
    /// ```
    fn add(&mut self, lifeline: &str, rest: &str, entry: Option<usize>, pos: usize) -> usize {
        let key = format!("e:{lifeline}.{rest}");
        if let Some(&i) = self.by_key.get(&key) {
            return i;
        }
        let i = self.list.len();
        self.by_key.insert(key.clone(), i);
        if let Some(e) = entry {
            self.by_entry.insert(e, i);
        }
        self.list.push((
            SequenceEvent {
                key,
                lifeline: format!("l:{lifeline}"),
                label: format!(".{rest}"),
                entry,
                row: 0,
            },
            pos,
        ));
        i
    }
}

/// 作りかけのメッセージ。
struct Msg {
    /// 書いた順の番号（シナリオの中のメッセージすべてで数える。線の ID に使う）。
    index: usize,
    /// メッセージの関係の番号。
    rel: usize,
    /// 送り手・受け手のライフラインの名前。
    from: String,
    to: String,
    /// 送り手・受け手のイベントの添字（端がライフラインそのものなら None）。
    from_event: Option<usize>,
    to_event: Option<usize>,
}

/// 順序の端。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Point {
    /// メッセージ（`Msg` の並びの添字）。
    Message(usize),
    /// イベント（`Events` の添字）。
    Event(usize),
}

/// 順序の端を探した結果。
enum EndAt {
    /// メッセージかイベント。
    Found(Point),
    /// 図に描かないもの（端の無い `then` の元、イベントでない宣言、確かめられない連鎖）。
    Skip,
    /// 見つからない（問題にする）。
    Missing,
}

/// シナリオの中の順序 1 つ。
struct Link {
    a: Point,
    b: Point,
    /// 名前（`succession s first …` の `s`）。無ければ空。
    name: String,
    /// 文の範囲（UTF-16。`end` は含まない）。
    src: Span,
}

impl Builder<'_> {
    /// シナリオごとの、シーケンス図（モデルの `sequences` を書き換える）。見つからない順序の相手と、循環する順序は問題にする。
    pub(super) fn sequences(&mut self) {
        let defs: Vec<(String, usize)> = self
            .model
            .nodes
            .iter()
            .filter(|n| n.kind == "occurrence def")
            .map(|n| (n.key.clone(), n.entry))
            .collect();
        for (key, entry) in defs {
            let sequence = self.sequence(key, entry);
            self.model.sequences.push(sequence);
        }
    }

    /// シナリオ 1 つの、シーケンス図。
    ///
    /// イベントは、ライフラインの本体のものを先に、続けてメッセージ・順序の端が指すものを足す。段は、順序の端がメッセージか
    /// イベントならその前後を守り、順序の決まらないものは書いた位置の順に決める（`order_rows`）。メッセージの端のイベントは、そのメッセージの段に描く。
    /// 別のライフラインのイベントの間の順序は、線（種類 `succession`、ID は `succession|元|先|名前#番号`）にする。
    ///
    /// # 引数
    ///
    /// - `key`：シナリオの、図の要素のキー
    /// - `def`：シナリオの宣言の番号
    ///
    /// # 戻り値
    ///
    /// シーケンス図。ライフラインもメッセージも無ければ、空の一覧を持つ図。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { event occurrence e; } part b { event occurrence r; }
    /// //   message m2 from b to a; message m1 from a.e to b.r; first m1 then m2; }" のとき
    /// sequence("S", S の番号)
    ///   → lifelines: ["l:a", "l:b"]、messages: [m1（段 0、端 e:a.e・e:b.r）, m2（段 1）]、rows: 2
    /// // 順序が循環するとき（first m1 then m2; first m2 then m1;）
    /// sequence("S", S の番号) → 書いた順に並べ、problems に「シナリオ「S」の順序が循環しています（succession）」
    /// ```
    fn sequence(&mut self, key: String, def: usize) -> Sequence {
        let lifelines = lifelines(self.entries, def);
        let mut events = Events::default();
        for l in &lifelines {
            self.declared_events(l.entry, &l.name, "", &mut events);
        }
        let messages = self.sequence_messages(def, &lifelines, &mut events);
        let links = self.sequence_links(def, &lifelines, &messages, &mut events);
        // メッセージの端のイベントは、そのメッセージの段に描く（2 つのメッセージの端なら、先に書いたもの）
        let mut attached: HashMap<usize, usize> = HashMap::new();
        for (mi, m) in messages.iter().enumerate() {
            for ev in [m.from_event, m.to_event].into_iter().flatten() {
                attached.entry(ev).or_insert(mi);
            }
        }
        let item = |p: Point| match p {
            Point::Message(m) => Item::Message(m),
            Point::Event(e) => attached
                .get(&e)
                .map_or(Item::Event(e), |&m| Item::Message(m)),
        };
        let mut items: Vec<(Item, usize)> = messages
            .iter()
            .enumerate()
            .map(|(i, m)| (Item::Message(i), self.p.rels[m.rel].start))
            .collect();
        items.extend(
            events
                .list
                .iter()
                .enumerate()
                .filter(|(i, _)| !attached.contains_key(i))
                .map(|(i, (_, pos))| (Item::Event(i), *pos)),
        );
        // 同じメッセージの両端のイベントの間の順序（first a.send then b.recv）は、同じ段のまま
        let before: Vec<(Item, Item)> = links
            .iter()
            .map(|l| (item(l.a), item(l.b)))
            .filter(|(x, y)| x != y)
            .collect();
        let (rows, cyclic) = order_rows(&items, &before);
        if cyclic {
            let name = &self.e(def).name;
            let msg = format!("シナリオ「{name}」の順序が循環しています（succession）");
            self.problem(self.e(def).start, msg, None);
        }
        let row = |it: Item| rows.get(&it).copied().unwrap_or(0);
        let mut seq_events: Vec<SequenceEvent> = events
            .list
            .iter()
            .enumerate()
            .map(|(i, (ev, _))| SequenceEvent {
                row: row(item(Point::Event(i))),
                ..ev.clone()
            })
            .collect();
        seq_events.sort_by_key(|e| e.row);
        let mut seq_messages: Vec<SequenceMessage> = messages
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let name = match &self.p.rels[m.rel].kind {
                    RelKind::Message { name, .. } => name.as_str(),
                    _ => "",
                };
                let ev_key = |e: Option<usize>| e.map(|e| events.list[e].0.key.clone());
                SequenceMessage {
                    id: format!("msg|{}|{name}", m.index),
                    from: format!("l:{}", m.from),
                    to: format!("l:{}", m.to),
                    from_event: ev_key(m.from_event),
                    to_event: ev_key(m.to_event),
                    row: row(Item::Message(i)),
                    rel: m.rel,
                }
            })
            .collect();
        seq_messages.sort_by_key(|m| m.row);
        Sequence {
            key,
            entry: def,
            lifelines,
            events: seq_events,
            messages: seq_messages,
            successions: succession_lines(&links, &events),
            rows: items.len(),
        }
    }

    /// ライフラインの本体（入れ子の部品・出来事・アイテムの本体も）に書いた、名前のある `event occurrence` を、イベントとして足す。
    ///
    /// # 引数
    ///
    /// - `holder`：本体を探す宣言の番号
    /// - `lifeline`：ライフラインの名前
    /// - `path`：ライフラインから `holder` までの連鎖（ライフラインそのものなら空、`sub`・`sub.inner` など）
    /// - `events`：イベントを足す表
    fn declared_events(&self, holder: usize, lifeline: &str, path: &str, events: &mut Events) {
        for &c in &self.e(holder).children {
            let e = self.e(c);
            if e.name.is_empty() {
                continue;
            }
            let rest = if path.is_empty() {
                e.name.clone()
            } else {
                format!("{path}.{}", e.name)
            };
            if e.kind == "event occurrence" {
                events.add(lifeline, &rest, Some(c), e.start);
            } else if HOLDER_KINDS.contains(&e.kind.as_str()) {
                self.declared_events(c, lifeline, &rest, events);
            }
        }
    }

    /// シナリオの直下のメッセージ（書いた順）。両端のライフラインが見つからないものは描かない（`relations` が問題にする）。
    /// 端が `a.ev` なら、そのイベントを（無ければ足して）端にする。
    ///
    /// # 引数
    ///
    /// - `def`：シナリオの宣言の番号
    /// - `lifelines`：ライフライン
    /// - `events`：イベントの表（端のイベントを足す）
    ///
    /// # 戻り値
    ///
    /// 描くメッセージ（書いた順）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { event occurrence e; } part b; attribute x; message m1 from a.e to b; message m2 from a to x; }" のとき
    /// sequence_messages(S の番号, …) → [Msg { index: 0, from: "a", to: "b", from_event: Some(e:a.e の添字), to_event: None, … }]
    ///                                   // m2 は受け手がライフラインでないので描かない
    /// ```
    fn sequence_messages(
        &self,
        def: usize,
        lifelines: &[Lifeline],
        events: &mut Events,
    ) -> Vec<Msg> {
        let mut rels: Vec<usize> = (0..self.p.rels.len())
            .filter(|&i| {
                self.p.rels[i].pe == Some(def)
                    && matches!(self.p.rels[i].kind, RelKind::Message { .. })
            })
            .collect();
        rels.sort_by_key(|&i| self.p.rels[i].start);
        let mut out = Vec::new();
        for (index, ri) in rels.into_iter().enumerate() {
            let r = &self.p.rels[ri];
            let RelKind::Message { a, b, .. } = &r.kind else {
                continue;
            };
            let head = |x: &str| x.split('.').next().unwrap_or("").to_owned();
            let (from, to) = (head(a), head(b));
            if !lifelines.iter().any(|l| l.name == from) || !lifelines.iter().any(|l| l.name == to)
            {
                continue;
            }
            out.push(Msg {
                index,
                rel: ri,
                from,
                to,
                from_event: self.event_ref(a, lifelines, events, r.start).ok().flatten(),
                to_event: self.event_ref(b, lifelines, events, r.start).ok().flatten(),
            });
        }
        out
    }

    /// ライフラインから先の連鎖（`a.ev`・`a.sub.ev`）のイベント。宣言のあるイベントはその宣言の、無ければ連鎖の名前で足す。
    ///
    /// # 引数
    ///
    /// - `chain`：書いた連鎖（最初の段がライフライン）
    /// - `lifelines`：ライフライン
    /// - `events`：イベントの表（無ければ足す）
    /// - `pos`：段を決めるときの位置（UTF-16。書いた文の位置）
    ///
    /// # 戻り値
    ///
    /// イベントの添字。1 段だけの連鎖（ライフラインそのもの）なら `Ok(None)`。
    /// 最初の段がライフラインでないか、2 段目から先が見つからなければ `Err(())`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { part sub { event occurrence ev; } } part b; }" のとき
    /// event_ref("a.sub.ev", …) → Ok(Some(e:a.sub.ev の添字))
    /// event_ref("b.x", …)      → Ok(Some(e:b.x の添字))   // b の中は確かめられない
    /// event_ref("a", …)        → Ok(None)
    /// event_ref("a.nope", …)   → Err(())
    /// event_ref("z.ev", …)     → Err(())
    /// ```
    fn event_ref(
        &self,
        chain: &str,
        lifelines: &[Lifeline],
        events: &mut Events,
        pos: usize,
    ) -> Result<Option<usize>, ()> {
        let Some((head, rest)) = chain.split_once('.') else {
            return Ok(None);
        };
        let l = lifelines.iter().find(|l| l.name == head).ok_or(())?;
        let segs: Vec<&str> = rest.split('.').collect();
        match self.follow_chain(l.entry, &segs) {
            ChainEnd::Found(i) => Ok(Some(match events.by_entry.get(&i) {
                Some(&e) => e,
                None => events.add(head, rest, Some(i), pos),
            })),
            ChainEnd::Unknown => Ok(Some(events.add(head, rest, None, pos))),
            ChainEnd::Missing(_) => Err(()),
        }
    }

    /// シナリオの直下と、ライフラインの本体（入れ子も）に書いた順序（継起）を、メッセージ・イベントの間の順序にする。
    /// 見つからない端は問題にする（モデルの `problems` を書き換える）。
    ///
    /// # 引数
    ///
    /// - `def`：シナリオの宣言の番号
    /// - `lifelines`：ライフライン
    /// - `messages`：描くメッセージ
    /// - `events`：イベントの表（端のイベントを足す）
    ///
    /// # 戻り値
    ///
    /// 両端がメッセージかイベントの順序（書いた順）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { event occurrence e1; then event occurrence e2; } part b; message m from a to b; first m then a.e2; first m then nope; }" のとき
    /// sequence_links(S の番号, …) → [Link { a: Event(e1), b: Event(e2) }, Link { a: Message(0), b: Event(e2) }]
    ///                                // problems に「「順序」の相手「nope」が見つかりません（succession）」
    /// ```
    fn sequence_links(
        &mut self,
        def: usize,
        lifelines: &[Lifeline],
        messages: &[Msg],
        events: &mut Events,
    ) -> Vec<Link> {
        let mut out = Vec::new();
        let p = self.p;
        for r in &p.rels {
            let RelKind::Succession {
                a,
                b,
                a_entry,
                b_entry,
                name,
                ..
            } = &r.kind
            else {
                continue;
            };
            let Some(body) = r.pe.filter(|&pe| self.in_scenario(pe, def)) else {
                continue;
            };
            let mut found = Vec::new();
            for (reference, entry) in [(a, *a_entry), (b, *b_entry)] {
                let at = if let Some(e) = entry {
                    events
                        .by_entry
                        .get(&e)
                        .map_or(EndAt::Skip, |&i| EndAt::Found(Point::Event(i)))
                } else if body == def {
                    self.scenario_end(reference, def, (lifelines, messages), events, r.start)
                } else {
                    self.body_end(reference, body, events)
                };
                match at {
                    EndAt::Found(pt) => found.push(pt),
                    EndAt::Skip => {}
                    EndAt::Missing => {
                        let msg =
                            format!("「順序」の相手「{reference}」が見つかりません（succession）");
                        self.problem(r.start, msg, None);
                    }
                }
            }
            if let [a, b] = found[..] {
                out.push(Link {
                    a,
                    b,
                    name: name.clone(),
                    src: Span {
                        start: r.start,
                        end: r.end + 1,
                    },
                });
            }
        }
        out
    }

    /// シナリオの直下に書いた順序の端（メッセージの名前か、`a.ev` の連鎖）。
    ///
    /// # 引数
    ///
    /// - `reference`：書いた端
    /// - `def`：シナリオの宣言の番号
    /// - `lifelines`：ライフライン
    /// - `messages`：描くメッセージ
    /// - `events`：イベントの表（無ければ足す）
    /// - `pos`：段を決めるときの位置（UTF-16）
    ///
    /// # 戻り値
    ///
    /// メッセージかイベント。空の端と、シナリオの中のほかの要素（ライフラインそのものなど）は `Skip`、
    /// 見つからない名前と、ライフラインの中に見つからない連鎖は `Missing`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { event occurrence e; } message m from a to a; }" のとき
    /// scenario_end("m", …)      → Found(Message(0))
    /// scenario_end("a.e", …)    → Found(Event(e の添字))
    /// scenario_end("a", …)      → Skip
    /// scenario_end("a.nope", …) → Missing
    /// scenario_end("nope", …)   → Missing
    /// ```
    fn scenario_end(
        &self,
        reference: &str,
        def: usize,
        (lifelines, messages): (&[Lifeline], &[Msg]),
        events: &mut Events,
        pos: usize,
    ) -> EndAt {
        if reference.is_empty() {
            return EndAt::Skip;
        }
        let named = |m: &Msg| matches!(&self.p.rels[m.rel].kind, RelKind::Message { name, .. } if name == reference);
        if let Some(i) = messages.iter().position(named) {
            return EndAt::Found(Point::Message(i));
        }
        let head = reference.split('.').next().unwrap_or("");
        match self.event_ref(reference, lifelines, events, pos) {
            Ok(Some(e)) => EndAt::Found(Point::Event(e)),
            Err(()) if lifelines.iter().any(|l| l.name == head) => EndAt::Missing,
            _ if self.lookup(head, Some(def)).is_some() => EndAt::Skip,
            _ => EndAt::Missing,
        }
    }

    /// ライフラインの本体（入れ子も）に書いた順序の端。本体から外へ最初の段を探し、残りの段をたどる。
    ///
    /// # 引数
    ///
    /// - `reference`：書いた端（`e1`・`sub.e`）
    /// - `body`：順序を書いた本体の宣言の番号
    /// - `events`：イベントの表
    ///
    /// # 戻り値
    ///
    /// ライフラインの上のイベントなら `Found`。空の端・イベントでない要素・確かめられない連鎖は `Skip`、見つからなければ `Missing`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { event occurrence e1; part sub { event occurrence d; } } }" の a の本体で
    /// body_end("e1", a の番号, …)     → Found(Event(e:a.e1 の添字))
    /// body_end("sub.d", a の番号, …)  → Found(Event(e:a.sub.d の添字))
    /// body_end("sub", a の番号, …)    → Skip      // イベントでない
    /// body_end("nope", a の番号, …)   → Missing
    /// ```
    fn body_end(&self, reference: &str, body: usize, events: &Events) -> EndAt {
        if reference.is_empty() {
            return EndAt::Skip;
        }
        let mut segs = reference.split('.');
        let Some(head) = self.lookup(segs.next().unwrap_or(""), Some(body)) else {
            return EndAt::Missing;
        };
        let rest: Vec<&str> = segs.collect();
        match self.follow_chain(head, &rest) {
            ChainEnd::Found(i) => events
                .by_entry
                .get(&i)
                .map_or(EndAt::Skip, |&e| EndAt::Found(Point::Event(e))),
            ChainEnd::Unknown => EndAt::Skip,
            ChainEnd::Missing(_) => EndAt::Missing,
        }
    }

    /// 宣言 `pe` が、シナリオ `def` そのものか、そのライフラインの本体（部品・出来事・アイテムの入れ子）の中か。
    ///
    /// # 引数
    ///
    /// - `pe`：順序を書いた本体の宣言の番号
    /// - `def`：シナリオの宣言の番号
    ///
    /// # 戻り値
    ///
    /// シナリオか、シナリオまで部品・出来事・アイテムだけをたどって着くなら true。アクションの本体などの中なら false。
    ///
    /// # 例
    ///
    /// ```text
    /// // "occurrence def S { part a { part sub; } action x; }" のとき
    /// in_scenario(sub の番号, S の番号) → true
    /// in_scenario(x の番号, S の番号)   → false
    /// ```
    fn in_scenario(&self, pe: usize, def: usize) -> bool {
        let mut cur = pe;
        loop {
            if cur == def {
                return true;
            }
            let e = self.e(cur);
            match e.pe {
                Some(up) if HOLDER_KINDS.contains(&e.kind.as_str()) => cur = up,
                _ => return false,
            }
        }
    }
}

/// シナリオの直下の、名前のある部品と出来事（`LIFELINE_KINDS`。書いた順）を、ライフラインにする。
///
/// # 引数
///
/// - `entries`：解析結果の宣言
/// - `def`：シナリオの宣言の番号
///
/// # 戻り値
///
/// ライフライン（キーは `l:名前`）。
///
/// # 例
///
/// ```text
/// // "occurrence def S { part a; attribute x; occurrence o; part; }" のとき
/// lifelines(entries, S の番号) → キー ["l:a", "l:o"]
/// ```
fn lifelines(entries: &[crate::project::Entry], def: usize) -> Vec<Lifeline> {
    entries[def]
        .children
        .iter()
        .copied()
        .filter(|&c| {
            LIFELINE_KINDS.contains(&entries[c].kind.as_str()) && !entries[c].name.is_empty()
        })
        .map(|c| Lifeline {
            key: format!("l:{}", entries[c].name),
            name: entries[c].name.clone(),
            entry: c,
        })
        .collect()
}

/// 段の順を決める。`before` の前後を守り、同じときに並べられるものは位置の小さい順に、1 つずつ段に置く（トポロジカル順）。
/// 前後が循環していれば、残りを位置の小さい順に置く。
///
/// # 引数
///
/// - `items`：並べるものと、その位置（UTF-16。書いた位置）
/// - `before`：（前, 後）の組
///
/// # 戻り値
///
/// 並べるものごとの段（0 から）と、前後が循環していたか。
///
/// # 例
///
/// ```text
/// order_rows([(M0, 10), (M1, 20), (E0, 5)], [(M0, M1), (M1, E0)]) → ({M0: 0, M1: 1, E0: 2}, false)
/// order_rows([(M0, 10), (E0, 5)], [])                             → ({E0: 0, M0: 1}, false)   // 位置の順
/// order_rows([(M0, 10), (M1, 20)], [(M0, M1), (M1, M0)])          → ({M0: 0, M1: 1}, true)    // 循環
/// ```
fn order_rows(items: &[(Item, usize)], before: &[(Item, Item)]) -> (HashMap<Item, usize>, bool) {
    let mut indegree: HashMap<Item, usize> = items.iter().map(|(it, _)| (*it, 0)).collect();
    for (_, b) in before {
        if let Some(d) = indegree.get_mut(b) {
            *d += 1;
        }
    }
    let mut rows: HashMap<Item, usize> = HashMap::new();
    let mut cyclic = false;
    while rows.len() < items.len() {
        let pending = items.iter().filter(|(it, _)| !rows.contains_key(it));
        let ready = pending
            .clone()
            .filter(|(it, _)| indegree[it] == 0)
            .min_by_key(|(_, pos)| *pos);
        let next = match ready {
            Some((it, _)) => *it,
            None => {
                cyclic = true;
                let Some((it, _)) = pending.min_by_key(|(_, pos)| *pos) else {
                    break;
                };
                *it
            }
        };
        rows.insert(next, rows.len());
        for (a, b) in before {
            if *a == next
                && let Some(d) = indegree.get_mut(b)
            {
                *d = d.saturating_sub(1);
            }
        }
    }
    (rows, cyclic)
}

/// 別のライフラインのイベントの間の順序を、線（種類 `succession`、8.2.3.9 の sq-succession）にする。
/// 同じライフラインの上の順序は、上下の位置で分かるので線にしない。ラベルは順序の名前。ID は `succession|元|先|名前#番号`。
///
/// # 引数
///
/// - `links`：順序
/// - `events`：イベントの表
///
/// # 戻り値
///
/// 線（書いた順）。
///
/// # 例
///
/// ```text
/// // first a.e then b.r;（ライフラインが違う）と then event occurrence e2;（同じライフライン）
/// succession_lines(…) → [Edge { id: "succession|e:a.e|e:b.r|#1", from: "e:a.e", to: "e:b.r", … }]
/// ```
fn succession_lines(links: &[Link], events: &Events) -> Vec<Edge> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();
    for l in links {
        let (Point::Event(a), Point::Event(b)) = (l.a, l.b) else {
            continue;
        };
        let (ea, eb) = (&events.list[a].0, &events.list[b].0);
        if ea.lifeline == eb.lifeline {
            continue;
        }
        let base = format!("succession|{}|{}|{}", ea.key, eb.key, l.name);
        let k = seen.entry(base.clone()).or_insert(0);
        *k += 1;
        out.push(Edge {
            id: format!("{base}#{k}"),
            kind: "succession",
            from: ea.key.clone(),
            to: eb.key.clone(),
            label: l.name.clone(),
            src: l.src,
            rel: None,
            from_port: None,
            to_port: None,
            end_label: None,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_rows_keeps_before_and_then_written_position() {
        // Arrange（正常系：前後の組と、組の無いものは位置の順）
        let items = [
            (Item::Message(0), 10),
            (Item::Message(1), 20),
            (Item::Event(0), 5),
        ];
        let before = [
            (Item::Message(0), Item::Message(1)),
            (Item::Message(1), Item::Event(0)),
        ];
        // Act
        let (rows, cyclic) = order_rows(&items, &before);
        // Assert
        assert_eq!(
            [
                rows[&Item::Message(0)],
                rows[&Item::Message(1)],
                rows[&Item::Event(0)]
            ],
            [0, 1, 2]
        );
        assert!(!cyclic);
    }

    #[test]
    fn order_rows_without_before_is_the_written_position() {
        // Arrange（境界値：前後の組が無い）
        let items = [(Item::Message(0), 10), (Item::Event(0), 5)];
        // Act
        let (rows, cyclic) = order_rows(&items, &[]);
        // Assert
        assert_eq!((rows[&Item::Event(0)], rows[&Item::Message(0)]), (0, 1));
        assert!(!cyclic);
    }

    #[test]
    fn order_rows_reports_a_cycle_and_still_places_everything() {
        // Arrange（異常系：循環）
        let items = [(Item::Message(0), 10), (Item::Message(1), 20)];
        let before = [
            (Item::Message(0), Item::Message(1)),
            (Item::Message(1), Item::Message(0)),
        ];
        // Act
        let (rows, cyclic) = order_rows(&items, &before);
        // Assert
        assert_eq!((rows[&Item::Message(0)], rows[&Item::Message(1)]), (0, 1));
        assert!(cyclic);
    }

    #[test]
    fn order_rows_of_nothing_is_empty() {
        // Arrange（境界値：空）
        // Act
        let (rows, cyclic) = order_rows(&[], &[]);
        // Assert
        assert!(rows.is_empty());
        assert!(!cyclic);
    }
}
