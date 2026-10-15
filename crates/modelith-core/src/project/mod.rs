//! 構文木から、暫定コアと同じ形の解析結果（`ParseResult`）を作る（ADR-0015 の `project` 層）。
//!
//! alpha.3 では、モデル構築（TS）を変えずにパーサだけを差し替えるため、暫定コアの読み方
//! （どの文を宣言・関係・式・まだ扱えない文とするか）に合わせる。構造（種類・名前・型・関係の相手）は
//! 構文木から取り、文の頭の文字列（`head`・式）は、コメントを空白にして空白をまとめたテキストから取る。
//! alpha.4 でモデル構築を Rust に移すときに、この層は置き換える。

mod text;
mod types;

pub use types::*;

use crate::syntax::{Parse, SyntaxKind, SyntaxKind::*, SyntaxNode, SyntaxToken};
use text::*;

/// 構文木を、暫定コアと同じ形の解析結果にする。
pub fn project(source: &str, parse: &Parse) -> ParseResult {
    let mut c = Ctx::new(source, parse);
    c.members(&parse.syntax(), None, None);
    c.out.errors = parse
        .errors()
        .iter()
        .map(|e| ParseError {
            pos: c.utf16(e.offset),
            msg: e.message.clone(),
        })
        .collect();
    c.out
}

/// 暫定コアの宣言の種類（DEF_KINDS・"package"・USAGE_KINDS の順。長いものを先に当てる）。
const DECL_KINDS: &[&str] = &[
    "metadata def",
    "occurrence def",
    "part def",
    "requirement def",
    "constraint def",
    "port def",
    "item def",
    "attribute def",
    "concern def",
    "verification def",
    "analysis def",
    "state def",
    "action def",
    "interface def",
    "calc def",
    "connection def",
    "use case def",
    "enum def",
    "view def",
    "package",
    "perform action",
    "occurrence",
    "exhibit state",
    "use case",
    "part",
    "requirement",
    "constraint",
    "port",
    "item",
    "attribute",
    "concern",
    "analysis",
    "verification",
    "state",
    "action",
    "interface",
    "calc",
    "connection",
    "subject",
    "stakeholder",
    "view",
];

/// 文の終わり。
#[derive(Clone, Copy, PartialEq, Eq)]
enum Term {
    Semi,
    Open,
    Close,
}

struct Ctx {
    /// コメントと注記を空白にしたテキスト（バイトの位置は元と同じ）。
    masked: String,
    /// バイトの位置ごとの UTF-16 の位置。
    utf16: Vec<usize>,
    out: ParseResult,
}

impl Ctx {
    fn new(text: &str, parse: &Parse) -> Self {
        let mut masked = text.as_bytes().to_vec();
        for &(start, end) in parse.comments() {
            for b in &mut masked[start..end] {
                if *b != b'\n' {
                    *b = b' ';
                }
            }
        }
        // コメントの中の多バイト文字は、バイトごとに空白にしたので、常に正しい UTF-8 になる
        let masked = String::from_utf8(masked)
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
        let mut utf16 = Vec::with_capacity(text.len() + 1);
        let mut at = 0;
        for ch in text.chars() {
            for _ in 0..ch.len_utf8() {
                utf16.push(at);
            }
            at += ch.len_utf16();
        }
        utf16.push(at);
        Self {
            masked,
            utf16,
            out: ParseResult::default(),
        }
    }

    fn utf16(&self, byte: usize) -> usize {
        self.utf16
            .get(byte)
            .copied()
            .unwrap_or_else(|| self.utf16.last().copied().unwrap_or(0))
    }

    /// テキストの範囲を、コメントを除いて空白をまとめた文字列にする。
    fn head_text(&self, start: usize, end: usize) -> String {
        normalize(self.masked.get(start..end).unwrap_or(""))
    }

    fn node_head(&self, n: &SyntaxNode) -> String {
        let r = n.text_range();
        self.head_text(r.start().into(), r.end().into())
    }

    fn members(&mut self, container: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        for n in container.children() {
            self.statement(&n, owner, pe);
        }
    }

    /// 要素 1 つを、宣言・関係・式・まだ扱えない文・無名ブロックのどれかにする（暫定コアの stmt と同じ順で判定する）。
    fn statement(&mut self, n: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        match n.kind() {
            COMMENT => return,
            DOCUMENTATION => {
                if let (Some(pe), Some(body)) = (
                    pe,
                    n.children_with_tokens()
                        .filter_map(|e| e.into_token())
                        .find(|t| t.kind() == REGULAR_COMMENT),
                ) {
                    let t = body.text();
                    let inner = t.strip_prefix("/*").unwrap_or(t);
                    let inner = inner.strip_suffix("*/").unwrap_or(inner);
                    self.out.entries[pe].doc = Some(normalize(inner));
                }
                return;
            }
            ERROR if child(n, BODY).is_none() => return,
            _ => {}
        }
        let Some((term, end_pos)) = terminator(n) else {
            return;
        };
        let hs: usize = n.text_range().start().into();
        let raw = self.head_text(hs, end_pos);
        let entry = if raw.is_empty() {
            None
        } else {
            self.classify(n, owner, pe, &raw, hs, end_pos, term)
        };
        if term != Term::Open {
            return;
        }
        let Some(body) = child(n, BODY) else { return };
        let open = self.utf16(body.text_range().start().into());
        let close = body
            .last_token()
            .filter(|t| t.kind() == R_BRACE)
            .map(|t| self.utf16(t.text_range().start().into()));
        match entry {
            Some(i) => {
                self.out.entries[i].open = Some(open);
                self.members(&body, Some(Scope::Entry(i)), Some(i));
                let e = &mut self.out.entries[i];
                if let Some(c) = close {
                    e.close = Some(c);
                    e.end = c + 1;
                }
            }
            None => {
                let b = self.out.blocks.len();
                self.out.blocks.push(Block {
                    kw: first_word_space(&raw).to_owned(),
                    head: raw.clone(),
                    start: self.utf16(hs),
                    owner,
                    open: Some(open),
                    close: None,
                    end: None,
                });
                self.members(&body, Some(Scope::Block(b)), pe);
                if let Some(c) = close {
                    let blk = &mut self.out.blocks[b];
                    blk.close = Some(c);
                    blk.end = Some(c + 1);
                }
            }
        }
    }

    /// 文を読み、宣言を作ったらその番号を返す。
    #[allow(clippy::too_many_arguments)]
    fn classify(
        &mut self,
        n: &SyntaxNode,
        owner: Option<Scope>,
        pe: Option<usize>,
        raw: &str,
        hs: usize,
        end_pos: usize,
        term: Term,
    ) -> Option<usize> {
        let (mods, h) = strip_mods(raw);
        let (start, end) = (self.utf16(hs), self.utf16(end_pos));

        // メタデータの本体（@Phase { stage = PhaseKind::X; }）
        if let (Some(Scope::Block(b)), Some(pe)) = (owner, pe)
            && self.out.blocks[b].kw.starts_with('@')
            && let Some((key, val)) = meta_assignment(h)
        {
            let md = self.out.blocks[b].kw[1..].to_owned();
            let at = self
                .masked
                .get(hs..)
                .and_then(|s| s.find(val))
                .map_or(hs, |i| hs + i);
            let s = self.utf16(at);
            let e = &mut self.out.entries[pe];
            *e.meta
                .get_or_insert_with(OrderedMap::default)
                .entry(&md, OrderedMap::default)
                .entry(key, String::new) = last_segment(val).to_owned();
            if md == "Phase" {
                e.phase_val = Some(Span {
                    start: s,
                    end: s + val.len(),
                });
                e.phase_block = Some(Scope::Block(b));
            }
            return None;
        }
        // 列挙値
        if let Some(pe) = pe
            && self.out.entries[pe].kind == "enum def"
            && let Some(v) = enum_value(h)
        {
            self.out.entries[pe]
                .enum_values
                .get_or_insert_with(Vec::new)
                .push(v.to_owned());
            return None;
        }
        // 関係
        if let Some(kind) = relation(n, h) {
            self.out.rels.push(Rel {
                kind,
                pe,
                start,
                end,
            });
            return None;
        }
        // view・view def の中の expose・filter・render（8.2.2.26）
        if let Some(pe) = pe
            && matches!(self.out.entries[pe].kind.as_str(), "view" | "view def")
        {
            match n.kind() {
                EXPOSE => {
                    if let Some(x) = self.expose(n, start, end) {
                        self.out.entries[pe]
                            .exposes
                            .get_or_insert_with(Vec::new)
                            .push(x);
                        return None;
                    }
                }
                ELEMENT_FILTER_MEMBER => {
                    if let Some(f) = h.strip_prefix("filter ") {
                        self.out.entries[pe]
                            .filters
                            .get_or_insert_with(Vec::new)
                            .push(f.trim().to_owned());
                        return None;
                    }
                }
                VIEW_RENDERING_USAGE => {
                    if let Some(r) = h
                        .strip_prefix("render ")
                        .filter(|r| is_qualified_basic_name(r))
                    {
                        self.out.entries[pe].render = Some(last_segment(r).to_owned());
                        return None;
                    }
                }
                _ => {}
            }
        }
        // 前置メタデータは、続く宣言のメタデータとして読む（ADR-0013）
        let (prefix_meta, h) = strip_prefix_metadata(h);
        let h = strip_then_return(h);
        if is_skipped(h) {
            return None;
        }
        if let Some(kind) = decl_kind(n, h) {
            let idx = self.out.entries.len();
            let is_def = kind.ends_with(" def");
            let parts = decl_parts(n, is_def);
            let mut e = Entry {
                kind: kind.to_owned(),
                is_def,
                short: parts.short,
                name: parts.name,
                conj: Some(parts.typed.as_ref().is_some_and(|t| t.1)),
                ty: parts.typed.map(|t| t.0).unwrap_or_default(),
                owner,
                pe,
                start,
                head_end: end,
                end: end + 1,
                head: h.to_owned(),
                mods: Some(mods.clone()),
                dir: None,
                exprs: Vec::new(),
                children: Vec::new(),
                idx,
                value: child(n, FEATURE_VALUE)
                    .and_then(|v| child(&v, EXPRESSION))
                    .map(|x| self.node_head(&x))
                    .filter(|v| !v.is_empty()),
                doc: None,
                meta: None,
                phase_val: None,
                phase_block: None,
                enum_values: None,
                exposes: None,
                filters: None,
                render: None,
                open: None,
                close: None,
            };
            if !prefix_meta.is_empty() {
                let meta = e.meta.get_or_insert_with(OrderedMap::default);
                for md in prefix_meta {
                    meta.entry(md, OrderedMap::default);
                }
            }
            if let Some((a, b)) = connect_ends(n) {
                self.out.rels.push(Rel {
                    kind: RelKind::Connect {
                        a,
                        b,
                        item: e.ty.clone(),
                        usage: idx,
                    },
                    pe,
                    start,
                    end,
                });
            }
            self.push_entry(e, pe);
            return Some(idx);
        }
        if !mods.is_empty()
            && let Some((name, ty)) = param(n)
        {
            let idx = self.out.entries.len();
            let e = Entry {
                kind: "param".to_owned(),
                is_def: false,
                short: String::new(),
                name,
                conj: None,
                ty,
                owner,
                pe,
                start,
                head_end: end,
                end: end + 1,
                head: h.to_owned(),
                mods: None,
                dir: Some(mods),
                exprs: Vec::new(),
                children: Vec::new(),
                idx,
                value: None,
                doc: None,
                meta: None,
                phase_val: None,
                phase_block: None,
                enum_values: None,
                exposes: None,
                filters: None,
                render: None,
                open: None,
                close: None,
            };
            self.push_entry(e, pe);
            return Some(idx);
        }
        if let Some(pe) = pe
            && (term == Term::Close || h.contains(['=', '<', '>']))
        {
            let via = match owner {
                Some(Scope::Block(b)) => self.out.blocks[b].kw.clone(),
                _ => String::new(),
            };
            self.out.entries[pe].exprs.push(Expr {
                text: h.to_owned(),
                via,
            });
        } else if crate::syntax::is_keyword(first_word(h)) {
            self.out.unsupported.push(Unsupported {
                start,
                end,
                head: h.to_owned(),
            });
        }
        None
    }

    fn push_entry(&mut self, e: Entry, pe: Option<usize>) {
        let idx = e.idx;
        self.out.entries.push(e);
        if let Some(pe) = pe {
            self.out.entries[pe].children.push(idx);
        }
    }

    /// `expose A`・`A::*`・`A::**`・`A::*::**` と、後ろの `[式]`。
    fn expose(&self, n: &SyntaxNode, start: usize, end: usize) -> Option<Expose> {
        let qn = child(n, QUALIFIED_NAME)?;
        let mut target = Vec::new();
        let (mut members, mut recursive) = (false, false);
        for t in tokens(&qn) {
            match t.kind() {
                IDENT | QUOTED_NAME => target.push(unquote(t.text()).to_owned()),
                STAR => members = true,
                STAR2 => recursive = true,
                _ => {}
            }
        }
        let filter = child(n, EXPRESSION).map(|x| {
            let s = self.node_head(&x);
            let inner = s.strip_prefix('[').unwrap_or(&s);
            inner.strip_suffix(']').unwrap_or(inner).trim().to_owned()
        });
        Some(Expose {
            target: target.join("::"),
            members,
            recursive,
            filter: filter.filter(|f| !f.is_empty()),
            start,
            end,
        })
    }
}

/// 子の節のうち、最初の `kind`。
fn child(n: &SyntaxNode, kind: SyntaxKind) -> Option<SyntaxNode> {
    n.children().find(|c| c.kind() == kind)
}

/// 節の中の、空白・注記・コメントを除いたトークン。
fn tokens(n: &SyntaxNode) -> impl Iterator<Item = SyntaxToken> {
    n.descendants_with_tokens()
        .filter_map(|e| e.into_token())
        .filter(|t| !t.kind().is_trivia() && t.kind() != REGULAR_COMMENT)
}

/// 参照（修飾名・特徴の連鎖）を、空白を除いた文字列にする。
fn compact(n: &SyntaxNode) -> String {
    tokens(n).map(|t| t.text().to_owned()).collect()
}

/// 文の終わりの種類と位置（バイト）。末尾の終わっていない文は、暫定コアと同じく読まない。
fn terminator(n: &SyntaxNode) -> Option<(Term, usize)> {
    if let Some(body) = child(n, BODY) {
        return Some((Term::Open, body.text_range().start().into()));
    }
    let last = n.last_token();
    if let Some(t) = last.as_ref().filter(|t| t.kind() == SEMI) {
        return Some((Term::Semi, t.text_range().start().into()));
    }
    let mut next = last.and_then(|t| t.next_token());
    while let Some(t) = next
        .as_ref()
        .filter(|t| t.kind().is_trivia() || t.kind() == REGULAR_COMMENT)
    {
        next = t.next_token();
    }
    match next {
        Some(t) if t.kind() == R_BRACE => Some((Term::Close, t.text_range().start().into())),
        Some(_) => Some((Term::Semi, n.text_range().end().into())),
        None => None,
    }
}

/// 宣言の種類（暫定コアの種類名）。文の頭が宣言の種類で始まるときだけ。
fn decl_kind(n: &SyntaxNode, h: &str) -> Option<&'static str> {
    if n.kind() == LIBRARY_PACKAGE {
        return Some("package");
    }
    DECL_KINDS.iter().copied().find(|k| {
        let mut rest = h;
        k.split(' ').all(|w| match rest.strip_prefix(w) {
            Some(r) if !r.starts_with(is_word) => {
                rest = r.trim_start();
                true
            }
            _ => false,
        })
    })
}

/// 宣言の名前・短い名前・型（型付け、または定義の特殊化）。
struct DeclParts {
    short: String,
    name: String,
    /// （型の名前, 共役 `~` か）
    typed: Option<(String, bool)>,
}

fn decl_parts(n: &SyntaxNode, is_def: bool) -> DeclParts {
    let mut short = String::new();
    let mut name: Option<String> = None;
    let mut typed = None;
    let mut first_element = true;
    for c in n.children() {
        match c.kind() {
            PREFIX_METADATA => continue,
            SHORT_NAME => {
                if let Some(t) = tokens(&c).find(|t| matches!(t.kind(), IDENT | QUOTED_NAME)) {
                    short = unquote(t.text()).to_owned();
                }
                continue;
            }
            NAME => {
                if name.is_none() {
                    name = tokens(&c).next().map(|t| unquote(t.text()).to_owned());
                }
            }
            // 名前の無い再定義（:>> mass）は、再定義する特徴の名前を名前にする
            REDEFINITION | SUBSETTING | REFERENCE_SUBSETTING | SUBCLASSIFICATION
                if first_element && name.is_none() =>
            {
                name = tokens(&c)
                    .find(|t| matches!(t.kind(), IDENT | QUOTED_NAME))
                    .map(|t| unquote(t.text()).to_owned());
                if is_def && c.kind() == SUBCLASSIFICATION {
                    typed = typed.or_else(|| type_of(&c));
                }
            }
            FEATURE_TYPING => typed = typed.or_else(|| type_of(&c)),
            SUBCLASSIFICATION if is_def => typed = typed.or_else(|| type_of(&c)),
            _ => {}
        }
        first_element = false;
    }
    DeclParts {
        short,
        name: name.unwrap_or_default(),
        typed,
    }
}

/// 関係の相手の型の名前（最後の修飾名の最後の部分）と、共役か。
fn type_of(rel: &SyntaxNode) -> Option<(String, bool)> {
    let conj = rel.children_with_tokens().any(|e| e.kind() == TILDE);
    let target = rel
        .children()
        .find(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))?;
    let last = tokens(&target)
        .filter(|t| matches!(t.kind(), IDENT | QUOTED_NAME))
        .last()?;
    Some((unquote(last.text()).to_owned(), conj))
}

/// キーワード `kw` の後ろの最初の参照。
fn ref_after(n: &SyntaxNode, kw: &str) -> Option<String> {
    let mut seen = false;
    for e in n.children_with_tokens() {
        match e {
            rowan::NodeOrToken::Token(t) if t.kind() == KEYWORD && t.text() == kw => seen = true,
            rowan::NodeOrToken::Node(c)
                if seen && matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN) =>
            {
                return Some(compact(&c));
            }
            _ => {}
        }
    }
    None
}

/// 最初の参照（名前として読んだ NAME も含む）。
fn first_ref(n: &SyntaxNode) -> Option<String> {
    n.children()
        .find(|c| matches!(c.kind(), NAME | QUALIFIED_NAME | FEATURE_CHAIN))
        .map(|c| unquote(&compact(&c)).to_owned())
}

/// `interface i : I connect a to b` の両端。
fn connect_ends(n: &SyntaxNode) -> Option<(String, String)> {
    Some((ref_after(n, "connect")?, ref_after(n, "to")?))
}

/// 関係を表す文（依存・メッセージ・満たす・検証する・扱う・流れ・遷移）。
fn relation(n: &SyntaxNode, h: &str) -> Option<RelKind> {
    let name = || child(n, NAME).map(|c| unquote(&compact(&c)).to_owned());
    match n.kind() {
        DEPENDENCY => {
            let pm = child(n, PREFIX_METADATA)?;
            if !h.starts_with('#') {
                return None;
            }
            let md = tokens(&pm).find(|t| t.kind() == IDENT || t.kind() == QUOTED_NAME)?;
            let (a, b) = (ref_after(n, "from")?, ref_after(n, "to")?);
            Some(if md.text() == "derivation" {
                RelKind::Derive { a, b }
            } else {
                RelKind::Dependency { a, b }
            })
        }
        MESSAGE_USAGE => Some(RelKind::Message {
            name: name().unwrap_or_default(),
            item: ref_after(n, "of")
                .map(|s| last_segment(&s).to_owned())
                .unwrap_or_default(),
            a: ref_after(n, "from")?,
            b: ref_after(n, "to")?,
        }),
        SATISFY_REQUIREMENT_USAGE if starts_with_word(h, "satisfy") => {
            let req = name().or_else(|| {
                n.children()
                    .find(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
                    .map(|c| compact(&c))
            })?;
            Some(RelKind::Satisfy {
                req,
                by: ref_after(n, "by")?,
            })
        }
        REQUIREMENT_VERIFICATION_USAGE => Some(RelKind::Verify { req: first_ref(n)? }),
        FRAMED_CONCERN_USAGE => {
            let t = child(n, FEATURE_TYPING).and_then(|c| type_of(&c))?;
            Some(RelKind::Frame {
                name: name()?,
                ty: t.0,
            })
        }
        FLOW_USAGE if child(n, NAME).is_none() => Some(RelKind::Flow {
            item: ref_after(n, "of")
                .map(|s| last_segment(&s).to_owned())
                .unwrap_or_default(),
            a: ref_after(n, "from")?,
            b: ref_after(n, "to")?,
        }),
        TRANSITION_USAGE => Some(RelKind::Transition {
            from: ref_after(n, "first")?,
            ev: ref_after(n, "accept").unwrap_or_default(),
            to: ref_after(n, "then")?,
        }),
        _ => None,
    }
}

/// 修飾の付いた `name : Type`（パラメータ）。
fn param(n: &SyntaxNode) -> Option<(String, String)> {
    let mut cs = n.children().filter(|c| c.kind() != PREFIX_METADATA);
    let name = cs.next().filter(|c| c.kind() == NAME)?;
    let name = tokens(&name)
        .next()
        .filter(|t| t.kind() == IDENT)?
        .text()
        .to_owned();
    let typing = cs.next().filter(|c| c.kind() == FEATURE_TYPING)?;
    Some((name, type_of(&typing)?.0))
}

/// 空白で区切った最初の語。
fn first_word_space(s: &str) -> &str {
    s.split(' ').next().unwrap_or("")
}

#[cfg(test)]
mod tests;
