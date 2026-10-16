//! 解析結果から、図に描く要素・関係・問題・フェーズ・保存された図を作る（ADR-0016 の手順 A）。
//!
//! alpha.4 では、暫定コア（`web/src/core/model.ts`・`views.ts`）の振る舞いをそのまま移す。
//! 一致は web の golden.test.ts・spec.test.ts が TS と Rust の両方で確かめる。
//! SysML v2 の意味（名前解決・継承など）に沿った作り直しは、0.1.0 の後に行う。

mod types;
mod views;

pub use types::*;
pub use views::{is_standard_view, std_view_label};

use std::collections::{HashMap, HashSet};

use crate::project::{Entry, ParseResult, RelKind, Span};

/// 部品として持つ（comp の線を引く）使用の種類。
const COMP_KINDS: &[&str] = &[
    "part",
    "requirement",
    "constraint",
    "perform action",
    "exhibit state",
    "analysis",
    "verification",
    "attribute",
    "calc",
    "concern",
    "use case",
    "item",
    "port",
];

/// 標準ライブラリの型か（未定義でも問題にしない）。
pub fn is_lib(t: &str) -> bool {
    t.ends_with("Value")
        || t.ends_with("Kind")
        || matches!(
            t,
            "Real"
                | "Integer"
                | "Boolean"
                | "String"
                | "Natural"
                | "Number"
                | "Complex"
                | "Anything"
        )
}

/// 種類から色分けの系統を決める。
pub fn family(kind: &str) -> &'static str {
    let starts = |p: &str| kind.starts_with(p);
    if starts("requirement") {
        "req"
    } else if starts("concern") {
        "concern"
    } else if starts("verification") || starts("analysis") {
        "ver"
    } else if starts("constraint") || starts("calc") {
        "con"
    } else if starts("state") || starts("action") || starts("use case") {
        "beh"
    } else if starts("part") {
        "part"
    } else {
        "other"
    }
}

/// 修飾の並び（`private in` など）に、語 `w` があるか（`\bw\b`）。
fn has_word(mods: &str, w: &str) -> bool {
    mods.split_whitespace().any(|x| x == w)
}

/// 解析結果からモデルを作る。
pub fn build(p: &ParseResult) -> Model {
    let mut b = Builder::new(p);
    b.nodes();
    b.ports();
    b.usages();
    b.relations();
    b.edge_ids();
    b.parse_problems();
    b.phases();
    views::build_views(&mut b);
    b.model
}

pub(crate) struct Builder<'a> {
    pub(crate) entries: &'a [Entry],
    p: &'a ParseResult,
    /// 名前ごとの宣言（書いた順）。
    pub(crate) by_name: HashMap<&'a str, Vec<usize>>,
    /// 宣言の番号 → 図の要素の番号。
    pub(crate) node_of: HashMap<usize, usize>,
    pub(crate) model: Model,
}

impl<'a> Builder<'a> {
    fn new(p: &'a ParseResult) -> Self {
        let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, e) in p.entries.iter().enumerate() {
            if !e.name.is_empty() {
                by_name.entry(e.name.as_str()).or_default().push(i);
            }
        }
        Self {
            entries: &p.entries,
            p,
            by_name,
            node_of: HashMap::new(),
            model: Model::default(),
        }
    }

    fn e(&self, i: usize) -> &'a Entry {
        &self.entries[i]
    }

    pub(crate) fn problem(&mut self, pos: usize, msg: String, kind: Option<&'static str>) {
        self.model.problems.push(Problem { pos, msg, kind });
    }

    /// 図に描く要素（定義と、package の直下の部品・要求）。
    fn nodes(&mut self) {
        let mut keys = HashSet::new();
        let entries = self.entries;
        for (i, e) in entries.iter().enumerate() {
            if e.name.is_empty() {
                continue;
            }
            // メタデータとビューの定義は、図に描く要素ではない
            let def = e.is_def && e.kind != "metadata def" && e.kind != "view def";
            let top = matches!(e.kind.as_str(), "part" | "requirement")
                && e.pe.is_some_and(|pe| self.entries[pe].kind == "package");
            if !(def || top) {
                continue;
            }
            let mut key = e.name.clone();
            if keys.contains(&key) {
                key = format!(
                    "{}@{}",
                    e.name,
                    e.pe.map_or("", |pe| self.entries[pe].name.as_str())
                );
            }
            keys.insert(key.clone());
            self.node_of.insert(i, self.model.nodes.len());
            self.model.nodes.push(Node {
                key,
                name: e.name.clone(),
                short: e.short.clone(),
                kind: e.kind.clone(),
                is_def: e.is_def,
                entry: i,
                fam: family(&e.kind),
                trans: Vec::new(),
                ports: Vec::new(),
                phase: None,
                phase_own: false,
            });
        }
    }

    /// 名前 `nm` の最初の定義。
    pub(crate) fn def_named(&self, nm: &str) -> Option<usize> {
        self.by_name
            .get(nm)?
            .iter()
            .copied()
            .find(|&i| self.e(i).is_def)
    }

    /// 宣言の中身を探す範囲（定義はそれ自身、使用は型の定義）。
    fn type_scope(&self, i: usize) -> Option<usize> {
        let e = self.e(i);
        if e.is_def {
            Some(i)
        } else if e.ty.is_empty() {
            None
        } else {
            self.def_named(&e.ty)
        }
    }

    fn child_named(&self, i: usize, nm: &str) -> Option<usize> {
        self.e(i)
            .children
            .iter()
            .copied()
            .find(|&c| self.e(c).name == nm)
    }

    /// 文の持ち主から外へ向かって名前を探し、無ければ全体から探す（図の要素を優先する）。
    fn find_first(&self, nm: &str, ctx: Option<usize>) -> Option<usize> {
        let mut a = ctx;
        while let Some(i) = a {
            if let Some(c) = self.child_named(i, nm) {
                return Some(c);
            }
            if self.e(i).name == nm {
                return Some(i);
            }
            a = self.e(i).pe;
        }
        let list = self.by_name.get(nm)?;
        list.iter()
            .copied()
            .find(|i| self.node_of.contains_key(i))
            .or_else(|| list.first().copied())
    }

    /// `a.b.c` の参照をたどる。
    fn resolve(&self, chain: &str, ctx: Option<usize>) -> Option<usize> {
        let mut segs = chain.split('.');
        let first = segs.next().unwrap_or("");
        let mut cur = self.find_first(first.rsplit("::").next().unwrap_or(first), ctx);
        for seg in segs {
            let c = cur?;
            cur = self
                .child_named(c, seg)
                .or_else(|| self.type_scope(c).and_then(|s| self.child_named(s, seg)));
        }
        cur
    }

    /// 宣言を描く図の要素（使用なら型の定義の要素）。
    fn node_for(&self, i: Option<usize>) -> Option<usize> {
        let i = i?;
        self.node_of.get(&i).copied().or_else(|| {
            self.type_scope(i)
                .and_then(|d| self.node_of.get(&d).copied())
        })
    }

    /// 宣言を含む、いちばん近い図の要素。
    fn node_ancestor(&self, i: Option<usize>) -> Option<usize> {
        let mut a = i;
        while let Some(x) = a {
            if let Some(&n) = self.node_of.get(&x) {
                return Some(n);
            }
            a = self.e(x).pe;
        }
        None
    }

    fn add_edge(
        &mut self,
        kind: &'static str,
        from: usize,
        to: usize,
        label: String,
        src: Span,
    ) -> usize {
        let (from, to) = (
            self.model.nodes[from].key.clone(),
            self.model.nodes[to].key.clone(),
        );
        self.model.edges.push(Edge {
            id: String::new(),
            kind,
            from,
            to,
            label,
            src,
            rel: None,
            from_port: None,
            to_port: None,
        });
        self.model.edges.len() - 1
    }

    /// ポートの向き。修飾の向きを優先し、無ければポートの定義の中身から決め、共役なら反転する。
    fn port_dir(&self, c: usize) -> &'static str {
        let e = self.e(c);
        let m = e.mods.as_deref().unwrap_or("");
        if has_word(m, "inout") {
            return "inout";
        }
        if has_word(m, "out") {
            return "out";
        }
        if has_word(m, "in") {
            return "in";
        }
        let Some(pd) = self.def_named(&e.ty) else {
            return "inout";
        };
        let ds: Vec<&str> = self
            .e(pd)
            .children
            .iter()
            .map(|&x| {
                let x = self.e(x);
                x.mods
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .or(x.dir.as_deref())
                    .unwrap_or("")
            })
            .collect();
        let has_o = ds.iter().any(|d| has_word(d, "out"));
        let has_i = ds.iter().any(|d| has_word(d, "in"));
        let base = if has_o && !has_i {
            "out"
        } else if has_i && !has_o {
            "in"
        } else {
            "inout"
        };
        match (e.conj.unwrap_or(false), base) {
            (true, "out") => "in",
            (true, "in") => "out",
            _ => base,
        }
    }

    fn ports(&mut self) {
        for n in 0..self.model.nodes.len() {
            let entry = self.model.nodes[n].entry;
            let ports = self
                .e(entry)
                .children
                .iter()
                .copied()
                .filter(|&c| self.e(c).kind == "port" && !self.e(c).name.is_empty())
                .map(|c| {
                    let e = self.e(c);
                    Port {
                        name: e.name.clone(),
                        ty: e.ty.clone(),
                        conj: e.conj.unwrap_or(false),
                        dir: self.port_dir(c),
                        entry: c,
                    }
                })
                .collect();
            self.model.nodes[n].ports = ports;
        }
    }

    /// 型付けの線（defined）と、部品として持つ線（comp）。見つからない型は問題にする。
    fn usages(&mut self) {
        let entries = self.entries;
        for (i, u) in entries.iter().enumerate() {
            if u.is_def || u.ty.is_empty() || u.kind == "package" {
                continue;
            }
            let Some(t) = self.def_named(&u.ty) else {
                if !is_lib(&u.ty)
                    && u.kind != "subject"
                    && !(u.kind == "view" && is_standard_view(&u.ty))
                {
                    let who = if u.name.is_empty() { &u.kind } else { &u.name };
                    self.problem(
                        u.start,
                        format!("型「{}」が見つかりません（{who}）", u.ty),
                        None,
                    );
                }
                continue;
            };
            let tn = self.node_of.get(&t).copied();
            let un = self.node_of.get(&i).copied();
            let pn = u.pe.and_then(|pe| self.node_of.get(&pe).copied());
            let src = Span {
                start: u.start,
                end: u.end,
            };
            if let Some(un) = un {
                if let Some(tn) = tn {
                    self.add_edge("defined", un, tn, String::new(), src);
                }
            } else if let (true, Some(pn), Some(tn)) =
                (COMP_KINDS.contains(&u.kind.as_str()), pn, tn)
                && u.pe != Some(t)
            {
                self.add_edge("comp", pn, tn, u.name.clone(), src);
            }
        }
    }

    fn relations(&mut self) {
        let p = self.p;
        for (ri, r) in p.rels.iter().enumerate() {
            let src = Span {
                start: r.start,
                end: r.end + 1,
            };
            let pe = r.pe;
            match &r.kind {
                RelKind::Satisfy { req, by } => {
                    let a = self.node_for(self.resolve(by, pe));
                    let b = self.node_for(self.resolve(req, pe));
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            self.add_edge("satisfy", a, b, "«satisfy»".into(), src);
                        }
                        _ => {
                            let who = if b.is_none() { req } else { by };
                            self.problem(
                                r.start,
                                format!("「満たす」関係の相手「{who}」が見つかりません（satisfy）"),
                                None,
                            );
                        }
                    }
                }
                RelKind::Verify { req } => {
                    let a = self.node_ancestor(pe);
                    let b = self.node_for(self.resolve(req, pe));
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            self.add_edge("verify", a, b, "«verify»".into(), src);
                        }
                        _ => self.problem(
                            r.start,
                            format!("「検証する」関係の相手「{req}」が見つかりません（verify）"),
                            None,
                        ),
                    }
                }
                RelKind::Frame { ty, .. } => {
                    let a = self.node_ancestor(pe);
                    let tn = self
                        .def_named(ty)
                        .and_then(|t| self.node_of.get(&t).copied());
                    match (a, tn) {
                        (Some(a), Some(tn)) => {
                            self.add_edge("frame", a, tn, "«frame»".into(), src);
                        }
                        _ => self.problem(
                            r.start,
                            format!("扱う関心事「{ty}」が見つかりません（frame）"),
                            None,
                        ),
                    }
                }
                RelKind::Flow { item, a: ra, b: rb }
                | RelKind::Connect {
                    item, a: ra, b: rb, ..
                } => {
                    let rel = if matches!(r.kind, RelKind::Connect { .. }) {
                        "connect"
                    } else {
                        "flow"
                    };
                    let pa: Vec<&str> = ra.split('.').collect();
                    let pb: Vec<&str> = rb.split('.').collect();
                    let a = self.node_for(self.resolve(pa[0], pe));
                    let b = self.node_for(self.resolve(pb[0], pe));
                    let s = match &r.kind {
                        RelKind::Connect { usage, .. } => Span {
                            start: p.entries[*usage].start,
                            end: p.entries[*usage].end,
                        },
                        _ => src,
                    };
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            let ed = self.add_edge("flow", a, b, item.clone(), s);
                            self.model.edges[ed].rel = Some(ri);
                            self.port_end(ed, a, pa.get(1).copied(), true, r.start);
                            self.port_end(ed, b, pb.get(1).copied(), false, r.start);
                        }
                        _ => {
                            let who = if a.is_none() { ra } else { rb };
                            self.problem(
                                r.start,
                                format!("線の接続先「{who}」が見つかりません（{rel}）"),
                                None,
                            );
                        }
                    }
                }
                RelKind::Derive { a: ra, b: rb } => {
                    let a = self.node_for(self.resolve(ra, pe));
                    let b = self.node_for(self.resolve(rb, pe));
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            self.add_edge("derive", a, b, "«derive»".into(), src);
                        }
                        _ => {
                            let who = if a.is_none() { ra } else { rb };
                            self.problem(
                                r.start,
                                format!(
                                    "「導出」関係の相手「{who}」が見つかりません（derivation）"
                                ),
                                None,
                            );
                        }
                    }
                }
                RelKind::Message { a: ra, b: rb, .. } => {
                    for x in [ra, rb] {
                        let seg = x.split('.').next().unwrap_or("");
                        if pe.and_then(|pe| self.child_named(pe, seg)).is_none() {
                            let owner = pe.map_or("", |pe| self.e(pe).name.as_str());
                            self.problem(r.start, format!("メッセージの相手「{seg}」が「{owner}」の中にありません（message）"), None);
                        }
                    }
                }
                RelKind::Transition { from, ev, to } => {
                    if let Some(a) = self.node_ancestor(pe) {
                        let ev = if ev.is_empty() {
                            String::new()
                        } else {
                            format!("  [{ev}]")
                        };
                        self.model.nodes[a].trans.push(format!("{from} → {to}{ev}"));
                    }
                }
                RelKind::Dependency { .. } => {}
            }
        }
    }

    /// 流れの端のポート（`a.p` の `p`）。要素にポートがあればそこにつなぎ、ポートでも中身でもなければ問題にする。
    fn port_end(&mut self, ed: usize, nd: usize, seg: Option<&str>, from: bool, pos: usize) {
        let Some(seg) = seg else { return };
        let node = &self.model.nodes[nd];
        if node.ports.iter().any(|p| p.name == seg) {
            let port = Some(format!("port:{seg}"));
            if from {
                self.model.edges[ed].from_port = port;
            } else {
                self.model.edges[ed].to_port = port;
            }
        } else if self.child_named(node.entry, seg).is_none() {
            let msg = format!("ポート「{seg}」が {} にありません", node.name);
            self.problem(pos, msg, None);
        }
    }

    /// 線の ID（種類・両端・ラベルが同じ線には、出てきた順に番号を付ける）。
    fn edge_ids(&mut self) {
        let mut seen: HashMap<String, usize> = HashMap::new();
        for e in &mut self.model.edges {
            let base = format!("{}|{}|{}|{}", e.kind, e.from, e.to, e.label);
            let k = seen.entry(base.clone()).or_insert(0);
            *k += 1;
            e.id = format!("{base}#{k}");
        }
    }

    fn parse_problems(&mut self) {
        let p = self.p;
        for e in &p.errors {
            self.problem(e.pos, e.msg.clone(), None);
        }
        // 黙って捨てず、まだ扱えない構文があることを知らせる（ADR-0013）
        for u in &p.unsupported {
            let head = truncate_utf16(&u.head, 40);
            self.problem(
                u.start,
                format!("「{head}」は Modelith ではまだ扱えないため、図とツリーに出ません"),
                Some("unsupported"),
            );
        }
    }

    /// フェーズ（`metadata def Phase { attribute stage : K; }` と列挙 K）と、要素ごとのフェーズ、トレースの抜け。
    fn phases(&mut self) {
        let pmd = self.by_name.get("Phase").and_then(|l| {
            l.iter()
                .copied()
                .find(|&i| self.e(i).kind == "metadata def")
        });
        let en = pmd
            .and_then(|m| self.child_named(m, "stage"))
            .and_then(|st| self.def_named(&self.e(st).ty));
        if let Some(en) = en {
            let e = self.e(en);
            if let Some(vs) = e.enum_values.as_ref().filter(|v| !v.is_empty()) {
                self.model.phases = Some(vs.clone());
                self.model.phase_enum = Some(e.name.clone());
            }
        }
        for n in 0..self.model.nodes.len() {
            let entry = self.model.nodes[n].entry;
            if let Some((value, holder)) = self.phase_of(entry) {
                self.model.nodes[n].phase = Some(value);
                self.model.nodes[n].phase_own = holder == entry;
            }
        }
        if let Some(phases) = self.model.phases.clone() {
            self.trace_gaps(&phases);
        }
    }

    /// 宣言のフェーズと、それを書いた宣言（自分か、外側の宣言から受け継ぐ）。
    fn phase_of(&self, i: usize) -> Option<(String, usize)> {
        let mut a = Some(i);
        while let Some(x) = a {
            let stage = self
                .e(x)
                .meta
                .as_ref()
                .and_then(|m| m.0.iter().find(|(k, _)| k == "Phase"))
                .and_then(|(_, v)| v.0.iter().find(|(k, _)| k == "stage"))
                .map(|(_, v)| v.as_str())
                .filter(|s| !s.is_empty());
            if let Some(s) = stage {
                return Some((s.to_owned(), x));
            }
            a = self.e(x).pe;
        }
        None
    }

    /// フェーズに沿った要求のトレースの抜け（導出・充足・検証）を問題として加える。
    fn trace_gaps(&mut self, phases: &[String]) {
        let has = |edges: &[Edge], kind: &str, from: bool, key: &str| {
            edges
                .iter()
                .any(|e| e.kind == kind && if from { e.from == key } else { e.to == key })
        };
        let mut gaps = Vec::new();
        for n in &self.model.nodes {
            let Some(phase) = n.phase.as_ref().filter(|_| n.kind == "requirement def") else {
                continue;
            };
            let Some(i) = phases.iter().position(|p| p == phase) else {
                continue;
            };
            let label = if n.short.is_empty() {
                n.name.clone()
            } else {
                format!("<'{}'>", n.short)
            };
            let pos = self.e(n.entry).start;
            let mut gap = |msg: &str| gaps.push((pos, format!("{label} {}：{msg}", n.name)));
            let edges = &self.model.edges;
            if i == 0 {
                if !has(edges, "derive", false, &n.key) {
                    gap("どの下位の要求にも展開されていません（derivation）");
                }
            } else {
                if !has(edges, "derive", true, &n.key) {
                    gap("導出元の上位の要求がありません（derivation）");
                }
                if !has(edges, "satisfy", false, &n.key) {
                    gap("この要求を満たす要素がありません（satisfy）");
                }
                if !has(edges, "verify", false, &n.key) {
                    gap("この要求を確かめる検証がありません（verify）");
                }
            }
        }
        for (pos, msg) in gaps {
            self.problem(pos, msg, Some("gap"));
        }
    }
}

/// UTF-16 で `max` 単位を超える文字列を切り、「…」を付ける（JS の `slice(0, max) + "…"` と同じ）。
fn truncate_utf16(s: &str, max: usize) -> String {
    if s.encode_utf16().count() <= max {
        return s.to_owned();
    }
    let mut n = 0;
    let mut out = String::new();
    for c in s.chars() {
        n += c.len_utf16();
        if n > max {
            break;
        }
        out.push(c);
    }
    out.push('…');
    out
}

#[cfg(test)]
mod tests;
