//! 構文木から、暫定コアと同じ形の解析結果（`ParseResult`）を作る（ADR-0015 の `project` 層）。
//!
//! alpha.3 では、モデル構築（TS）を変えずにパーサだけを差し替えるため、暫定コアの読み方
//! （どの文を宣言・関係・式・まだ扱えない文とするか）に合わせる。構造（種類・名前・型・関係の相手）は
//! 構文木から取り、文の頭の文字列（`head`・式）は、コメントを空白にして空白をまとめたテキストから取る。
//! alpha.4 でモデル構築を Rust に移すときに、この層は置き換える。

pub(crate) mod text;
mod types;

pub use types::*;

use std::collections::HashMap;

use crate::syntax::{Parse, SyntaxKind, SyntaxKind::*, SyntaxNode, SyntaxToken};
use text::*;

/// 構文木を、暫定コアと同じ形の解析結果にする。
///
/// 位置はすべて UTF-16 のオフセットにする。構文のエラーに加え、読めない `@layout` コメントもエラーに入れる。
/// 末尾の、`;` も `}` も無い文は（暫定コアと同じく）読まない。
///
/// # 引数
///
/// - `source`：解析したテキスト全体
/// - `parse`：`source` を `syntax::parse` で解析した結果（別のテキストの結果を渡さないこと）
///
/// # 戻り値
///
/// 宣言・無名ブロック・関係・エラー・まだ扱えない文をまとめた `ParseResult`。失敗しない。
///
/// # 例
///
/// ```text
/// project("package P { part def A { part b : B; } }", …)
///   → entries: P・A・b（P.children = [A]、A.children = [b]、b.ty = "B"）
/// project("package P { allocation def C; }\npart def Tail", …)
///   → unsupported の head: ["allocation def C"]、Tail は entries に無い、errors は 1 件
/// ```
pub fn project(source: &str, parse: &Parse) -> ParseResult {
    let mut c = Ctx::new(source, parse);
    c.members(&parse.syntax(), None, None);
    c.apply_about_annotations();
    c.resolve_extended_kinds();
    c.out.errors = parse
        .errors()
        .iter()
        .map(|e| ParseError {
            pos: c.utf16(e.offset),
            msg: e.message.clone(),
        })
        .collect();
    if let Some(at) = broken_layout_comment(source) {
        c.out.errors.push(ParseError {
            pos: c.utf16(at),
            msg: "@layout コメントを読み込めません".to_owned(),
        });
    }
    c.out
}

/// 配置情報を埋め込んだ移行期のコメント（`/* @layout {…} */`、ADR-0005）が JSON として読めなければ、その位置。
/// 中身は TS の境界で読む。暫定コアの LAYOUT_RE と同じく、最初の 1 つだけを見る。
///
/// # 引数
///
/// - `source`：テキスト全体
///
/// # 戻り値
///
/// 最初の `@layout` コメントの `/*` の位置（バイトオフセット）。そのコメントが JSON として読めるとき、
/// 閉じていないとき、`@layout` コメントが無いときは `None`。
///
/// # 例
///
/// ```text
/// broken_layout_comment("/* note */ /* @layout {\"A\": */") → Some(11)
/// broken_layout_comment("/* @layout {\"A\":{\"x\":1}} */")   → None   // 読める
/// broken_layout_comment("/* @layout {")                      → None   // 閉じていない
/// broken_layout_comment("part def A;")                       → None
/// ```
fn broken_layout_comment(source: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = source[from..].find("/*") {
        let start = from + i;
        let body = &source[start + 2..];
        let rest = body.trim_start();
        if let Some(json) = rest.strip_prefix("@layout") {
            let end = json.find("*/")?;
            return serde_json::from_str::<serde_json::Value>(json[..end].trim())
                .is_err()
                .then_some(start);
        }
        from = start + 2;
    }
    None
}

/// 暫定コアの宣言の種類（DEF_KINDS・"package"・USAGE_KINDS の順。長いものを先に当てる）。
pub(crate) const DECL_KINDS: &[&str] = &[
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
    "case def",
    "viewpoint def",
    "rendering def",
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
    "include use case",
    "event occurrence",
    "case",
    "actor",
    "enum",
    "viewpoint",
    "rendering",
];

/// 利用者定義のキーワード（`#X def H;`・`#X h;`、8.2.2.27）で書いた宣言の、基の種類が決まらないときの種類。
/// 定義は `"def"`、使用は `"usage"` にする（ツリーにだけ出す）。
const EXTENDED_DEF_KIND: &str = "def";
const EXTENDED_USAGE_KIND: &str = "usage";

/// メタデータを付ける先（`@M { … }`・`metadata M about A { … }` の本体の `key = 値` を書き込む先）。
#[derive(Clone, Copy)]
enum MetaTarget {
    /// 持ち主の宣言（`about` の無いメタデータ）。ファイルの直下なら None。
    Owner(Option<usize>),
    /// `about` の相手（`Ctx::annotations` の番号。相手は読み終えてから解決する）。
    About(usize),
}

/// 本体を持つメタデータの使用（本体の無名ブロックに結び付ける）。
#[derive(Clone)]
struct MetaBlock {
    /// メタデータの定義の名前（修飾名なら最後の名前）。
    md: String,
    target: MetaTarget,
}

/// `metadata M about A, B { … }`（相手は読み終えてから、書いた場所から解決する）。
struct Annotation {
    md: String,
    /// 相手の参照（修飾名・特徴の連鎖）。
    about: Vec<String>,
    /// 文を書いた宣言の番号（名前を探し始める場所）。
    pe: Option<usize>,
    /// 文の位置（UTF-16 のオフセット。相手が見つからないときの問題の位置）。
    pos: usize,
    /// 本体の `key = 値`（書いた順）。
    fields: Vec<(String, String)>,
}

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
    /// 無名ブロックの番号 → そのブロックを本体にするメタデータの使用。
    meta_blocks: HashMap<usize, MetaBlock>,
    /// 直前に読んだメタデータの使用（本体のブロックを作るときに `meta_blocks` へ移す）。
    open_meta: Option<MetaBlock>,
    /// `about` の付いたメタデータの使用（書いた順）。
    annotations: Vec<Annotation>,
    /// 利用者定義のキーワードで書いた宣言の番号（基の種類を読み終えてから決める）。
    extended: Vec<usize>,
}

impl Ctx {
    /// テキストから、コメントを空白にしたテキストと、バイトから UTF-16 への位置の表を作る。
    ///
    /// コメントと注記の中は、改行を残してバイトごとに半角空白にする（バイトの位置は元と同じ）。
    ///
    /// # 引数
    ///
    /// - `text`：解析したテキスト全体
    /// - `parse`：`text` の解析結果（コメントの範囲を使う）
    ///
    /// # 戻り値
    ///
    /// 解析結果が空の `Ctx`。
    ///
    /// # 例
    ///
    /// ```text
    /// Ctx::new("a /*x*/", …)  → masked: "a      "、utf16: [0, 1, 2, 3, 4, 5, 6, 7]
    /// Ctx::new("a😀b", …)    → utf16: [0, 1, 1, 1, 1, 3, 4]   // 😀 は 4 バイト、UTF-16 で 2 単位
    /// Ctx::new("", …)        → utf16: [0]
    /// ```
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
            meta_blocks: HashMap::new(),
            open_meta: None,
            annotations: Vec::new(),
            extended: Vec::new(),
        }
    }

    /// バイトオフセットを UTF-16 のオフセットにする。
    ///
    /// # 引数
    ///
    /// - `byte`：テキストの先頭からのバイトオフセット
    ///
    /// # 戻り値
    ///
    /// UTF-16 のオフセット。多バイト文字の途中なら、その文字の先頭の位置。テキストの長さを超えるなら、
    /// テキストの末尾の位置。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "a😀b"
    /// utf16(5)   → 3
    /// utf16(2)   → 1     // 😀 の途中
    /// utf16(100) → 4     // 範囲外はテキストの末尾
    /// ```
    fn utf16(&self, byte: usize) -> usize {
        self.utf16
            .get(byte)
            .copied()
            .unwrap_or_else(|| self.utf16.last().copied().unwrap_or(0))
    }

    /// テキストの範囲を、コメントを除いて空白をまとめた文字列にする。
    ///
    /// # 引数
    ///
    /// - `start`・`end`：範囲（バイトオフセット。`end` は含まない）
    ///
    /// # 戻り値
    ///
    /// コメントを空白にし、空白をまとめて前後を除いた文字列。範囲がテキストの外か文字境界でなければ空文字列。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "part /* c */ a ;"
    /// head_text(0, 15)   → "part a"
    /// head_text(0, 100)  → ""   // 範囲外
    /// ```
    fn head_text(&self, start: usize, end: usize) -> String {
        normalize(self.masked.get(start..end).unwrap_or(""))
    }

    /// 節の範囲を、コメントを除いて空白をまとめた文字列にする（`head_text` を節の範囲で呼ぶ）。
    ///
    /// # 引数
    ///
    /// - `n`：構文木の節
    ///
    /// # 戻り値
    ///
    /// 節のテキストを整えた文字列。
    ///
    /// # 例
    ///
    /// ```text
    /// // "expose A::*[@F];" の EXPRESSION の節
    /// node_head(EXPRESSION) → "[@F]"
    /// // "part a = /* c */ 1;" の値の EXPRESSION の節
    /// node_head(EXPRESSION) → "1"
    /// ```
    fn node_head(&self, n: &SyntaxNode) -> String {
        let r = n.text_range();
        self.head_text(r.start().into(), r.end().into())
    }

    /// 節の子の要素を、書いた順に `statement` で読む。解析結果に宣言・ブロック・関係などを足す。
    ///
    /// # 引数
    ///
    /// - `container`：要素を並べた節（`SOURCE_FILE` か `BODY`）
    /// - `owner`：子の持ち主（宣言か無名ブロックの番号）。ファイルの直下なら `None`
    /// - `pe`：子を含む、いちばん近い宣言の番号。無ければ `None`
    fn members(&mut self, container: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        for n in container.children() {
            self.statement(&n, owner, pe);
        }
    }

    /// 要素 1 つを、宣言・関係・式・まだ扱えない文・無名ブロックのどれかにする（暫定コアの stmt と同じ順で判定する）。
    ///
    /// `doc` は `pe` の宣言の `doc` に入れる。本体 `{ … }` があれば、宣言ならその中を、宣言でなければ
    /// 無名ブロックを作ってその中を読み、`open`・`close`・`end` を記録する。まだ扱えない文の本体は読まない
    /// （中の宣言を、外側の宣言の中身にしない）。終わっていない末尾の文と、`rep` の文は読まない。
    ///
    /// # 引数
    ///
    /// - `n`：要素の節
    /// - `owner`：要素の持ち主（宣言か無名ブロックの番号）。ファイルの直下なら `None`
    /// - `pe`：要素を含む、いちばん近い宣言の番号。無ければ `None`
    fn statement(&mut self, n: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        match n.kind() {
            // テキストでの表し方（rep）は、まだ図にもツリーにも出さない（本文を残すのは後の版）
            COMMENT | TEXTUAL_REPRESENTATION => return,
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
        let unsupported_before = self.out.unsupported.len();
        let entry = if raw.is_empty() {
            None
        } else {
            self.classify(n, owner, pe, &raw, hs, end_pos, term)
        };
        let meta = self.open_meta.take();
        // まだ扱えない文の本体は読まない（中の宣言を、外側の宣言の中身と取り違えないように。F-EDIT-8）
        let is_unsupported = self.out.unsupported.len() > unsupported_before;
        if term != Term::Open || is_unsupported {
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
                if let Some(mb) = meta {
                    self.meta_blocks.insert(b, mb);
                }
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
    ///
    /// メタデータの本体の `key = 値`、メタデータの使用（`@M`・`metadata M about …`）、列挙値、関係、
    /// view の `expose`・`filter`・`render`、別名、`import`、本体の無い名前付きの制約（`assert constraint c : CD`）、
    /// 読み飛ばす文、宣言、パラメータ、式、まだ扱えない文の順に判定し、解析結果の該当する表に足す。
    ///
    /// # 引数
    ///
    /// - `n`：文の節
    /// - `owner`：文の持ち主（宣言か無名ブロックの番号）。ファイルの直下なら `None`
    /// - `pe`：文を含む、いちばん近い宣言の番号。無ければ `None`
    /// - `raw`：文の頭（`hs` から `end_pos` まで。コメントを除き空白をまとめたもの。空でない）
    /// - `hs`：文の始まり（バイトオフセット）
    /// - `end_pos`：文の頭の終わり（バイトオフセット。`;`・`{`・`}` の位置）
    /// - `term`：文の終わりの種類（`;`・本体の `{`・持ち主の `}`）
    ///
    /// # 戻り値
    ///
    /// 宣言かパラメータを `entries` に足したら、その番号。それ以外（関係・式・読み飛ばし・まだ扱えない文など）は `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // ファイルの直下の "part def A;"（entries が空）
    /// classify(…, "part def A", …, Semi)   → Some(0)（kind "part def"、name "A"）
    /// // "constraint def C { in x : Real; }" の中の文（C が 0 番）
    /// classify(…, "in x : Real", …, Semi)  → Some(1)（kind "param"、dir "in"、ty "Real"）
    /// // "satisfy R by A;"
    /// classify(…, "satisfy R by A", …)     → None（rels に Satisfy { req: "R", by: "A" }）
    /// // "allocation def C;"
    /// classify(…, "allocation def C", …)   → None（unsupported に "allocation def C"）
    /// ```
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

        // メタデータの本体（@Phase { stage = PhaseKind::X; }・metadata M about A { k = 1 + 2; }）
        if let Some(Scope::Block(b)) = owner
            && let Some(mb) = self.meta_blocks.get(&b).cloned()
            && let Some((key, val)) = meta_assignment(h)
        {
            match mb.target {
                MetaTarget::Owner(Some(pe)) => self.set_owner_meta(pe, b, &mb.md, key, val, hs),
                MetaTarget::Owner(None) => {}
                MetaTarget::About(a) => self.annotations[a]
                    .fields
                    .push((key.to_owned(), meta_value(val).to_owned())),
            }
            return None;
        }
        // メタデータの使用（`@M`・`metadata M`、about 付きを含む。8.2.2.27）
        if matches!(n.kind(), METADATA_USAGE | METADATA_KEYWORD_USAGE) {
            self.metadata_usage(n, pe, start);
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
        if n.kind() == ALIAS {
            if let Some(a) = alias(n, pe) {
                self.out.aliases.push(a);
            }
            return None;
        }
        if n.kind() == IMPORT {
            if let Some(q) = child(n, QUALIFIED_NAME) {
                self.out.imports.push(path_of(&q));
            }
            return None;
        }
        // 本体の無い `assert constraint c : CD;`・`require c : CD;` は、持ち主の式として残す（8.2.2.20〜21）
        if matches!(
            n.kind(),
            ASSERT_CONSTRAINT_USAGE | REQUIREMENT_CONSTRAINT_USAGE
        ) && term != Term::Open
        {
            if let Some(pe) = pe {
                let text = constraint_reference_text(h);
                if !text.is_empty() {
                    self.out.entries[pe].exprs.push(Expr {
                        text,
                        via: first_word(h).to_owned(),
                    });
                }
            }
            return None;
        }
        if is_skipped(h) {
            return None;
        }
        if let Some((kind, is_def)) = entry_kind(n, h, &mods, !prefix_meta.is_empty()) {
            let idx = self.out.entries.len();
            let parts = decl_parts(n, is_def);
            let name = if parts.name.is_empty()
                && matches!(n.kind(), INCLUDE_USE_CASE_USAGE | OCCURRENCE_USAGE)
            {
                // `include U;`・`event e;` は、参照した特徴の名前を名前にする（OwnedReferenceSubsetting）
                first_ref(n)
                    .map(|r| last_segment(r.rsplit('.').next().unwrap_or(&r)).to_owned())
                    .unwrap_or_default()
            } else {
                parts.name
            };
            if matches!(kind, EXTENDED_DEF_KIND | EXTENDED_USAGE_KIND) {
                self.extended.push(idx);
            }
            let mut e = Entry {
                kind: kind.to_owned(),
                is_def,
                short: parts.short,
                name,
                conj: Some(parts.typed.as_ref().is_some_and(|t| t.conj)),
                ty: parts
                    .typed
                    .as_ref()
                    .map(|t| t.name.clone())
                    .unwrap_or_default(),
                ty_path: parts.typed.map(|t| t.path).unwrap_or_default(),
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
            && let Some((name, typed)) = param(n)
        {
            let idx = self.out.entries.len();
            let e = Entry {
                kind: "param".to_owned(),
                is_def: false,
                short: String::new(),
                name,
                conj: None,
                ty: typed.name,
                ty_path: typed.path,
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

    /// 宣言を `entries` の末尾に足し、`pe` の宣言の `children` にその番号を足す。
    ///
    /// # 引数
    ///
    /// - `e`：足す宣言（`idx` は足した後の番号と等しいこと）
    /// - `pe`：親の宣言の番号。無ければ `None`（`children` は変えない）
    fn push_entry(&mut self, e: Entry, pe: Option<usize>) {
        let idx = e.idx;
        self.out.entries.push(e);
        if let Some(pe) = pe {
            self.out.entries[pe].children.push(idx);
        }
    }

    /// メタデータの使用（`@M`・`metadata M`・`metadata m : M about A, B`、8.2.2.27）を読む。
    ///
    /// `about` が無ければ持ち主の宣言 `pe` の `meta` に `M` を足し（本体が無くても足す）、あれば相手を読み終えてから
    /// 解決するよう `annotations` に足す。どちらも、本体の `key = 値` を書き込む先を `open_meta` に置く。
    ///
    /// # 引数
    ///
    /// - `n`：`METADATA_USAGE` か `METADATA_KEYWORD_USAGE` の節
    /// - `pe`：文を含む、いちばん近い宣言の番号。無ければ `None`
    /// - `pos`：文の始まり（UTF-16 のオフセット）
    fn metadata_usage(&mut self, n: &SyntaxNode, pe: Option<usize>, pos: usize) {
        let mut md = None;
        let mut about = Vec::new();
        let mut after_about = false;
        for e in n.children_with_tokens() {
            match e {
                rowan::NodeOrToken::Token(t) if t.kind() == KEYWORD && t.text() == "about" => {
                    after_about = true;
                }
                rowan::NodeOrToken::Node(c) if after_about => {
                    if matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN) {
                        about.push(compact(&c));
                    }
                }
                rowan::NodeOrToken::Node(c) if md.is_none() => match c.kind() {
                    FEATURE_TYPING => md = type_of(&c).map(|t| t.name),
                    QUALIFIED_NAME => md = Some(last_segment(&path_of(&c)).to_owned()),
                    _ => {}
                },
                _ => {}
            }
        }
        let Some(md) = md.filter(|m| !m.is_empty()) else {
            return;
        };
        let target = if about.is_empty() {
            if let Some(pe) = pe {
                self.out.entries[pe]
                    .meta
                    .get_or_insert_with(OrderedMap::default)
                    .entry(&md, OrderedMap::default);
            }
            MetaTarget::Owner(pe)
        } else {
            self.annotations.push(Annotation {
                md: md.clone(),
                about,
                pe,
                pos,
                fields: Vec::new(),
            });
            MetaTarget::About(self.annotations.len() - 1)
        };
        self.open_meta = Some(MetaBlock { md, target });
    }

    /// 持ち主の宣言のメタデータに `key = 値` を書き込む。メタデータが `Phase` なら、値の位置と本体のブロックも記録する
    /// （フェーズの書き換えに使う）。
    ///
    /// # 引数
    ///
    /// - `pe`：書き込む宣言の番号
    /// - `b`：メタデータの本体の無名ブロックの番号
    /// - `md`：メタデータの定義の名前
    /// - `key`・`val`：本体の文の名前と値の式（`meta_assignment` の結果）
    /// - `hs`：本体の文の始まり（バイトオフセット。値の位置を探し始める所）
    fn set_owner_meta(&mut self, pe: usize, b: usize, md: &str, key: &str, val: &str, hs: usize) {
        let at = self
            .masked
            .get(hs..)
            .and_then(|s| s.find(val))
            .map_or(hs, |i| hs + i);
        let s = self.utf16(at);
        let e = &mut self.out.entries[pe];
        *e.meta
            .get_or_insert_with(OrderedMap::default)
            .entry(md, OrderedMap::default)
            .entry(key, String::new) = meta_value(val).to_owned();
        if md == "Phase" {
            e.phase_val = Some(Span {
                start: s,
                end: s + val.len(),
            });
            e.phase_block = Some(Scope::Block(b));
        }
    }

    /// `metadata M about A, B { … }` の相手を、文を書いた場所から解決し（`model` の名前の解決、修飾名と別名を含む）、
    /// 見つかった宣言の `meta` に `M` と本体の `key = 値` を書き込む。見つからない相手は `missing_about` に足す。
    ///
    /// 要素自身に同じメタデータの同じ名前の値があれば、それを優先する（書き換えない）。
    /// フェーズの値の位置（`phase_val`）は記録しない（複数の相手で共有する文を、1 つの要素のフェーズの変更で書き換えないため）。
    fn apply_about_annotations(&mut self) {
        if self.annotations.is_empty() {
            return;
        }
        let refs: Vec<(String, Option<usize>)> = self
            .annotations
            .iter()
            .flat_map(|a| a.about.iter().map(|r| (r.clone(), a.pe)))
            .collect();
        let mut found = crate::model::resolve_refs(&self.out, &refs).into_iter();
        for a in std::mem::take(&mut self.annotations) {
            for r in &a.about {
                let Some(i) = found.next().flatten() else {
                    self.out.missing_about.push(MissingRef {
                        pos: a.pos,
                        name: r.clone(),
                    });
                    continue;
                };
                let meta = self.out.entries[i]
                    .meta
                    .get_or_insert_with(OrderedMap::default)
                    .entry(&a.md, OrderedMap::default);
                for (k, v) in &a.fields {
                    // 要素自身に書いた値（`@M { k = … }`）を優先する
                    meta.entry(k, || v.clone());
                }
            }
        }
    }

    /// 利用者定義のキーワードで書いた宣言（`#X def H;`・`#X h;`）の種類を、メタデータの定義 `X` の基の型
    /// （`:>> baseType = … meta SysML::PartUsage;`、SemanticMetadata、8.2.2.27）から決める。
    /// 決まらなければ `"def"`・`"usage"` のままにする。
    fn resolve_extended_kinds(&mut self) {
        if self.extended.is_empty() {
            return;
        }
        let mut refs = Vec::new();
        for &i in &self.extended {
            let e = &self.out.entries[i];
            for (md, _) in e.meta.iter().flat_map(|m| m.0.iter()) {
                refs.push((i, md.clone(), e.pe));
            }
        }
        let query: Vec<(String, Option<usize>)> =
            refs.iter().map(|(_, md, pe)| (md.clone(), *pe)).collect();
        let found = crate::model::resolve_refs(&self.out, &query);
        for ((i, _, _), d) in refs.into_iter().zip(found) {
            let Some(d) = d.filter(|&d| self.out.entries[d].kind == "metadata def") else {
                continue;
            };
            if !matches!(
                self.out.entries[i].kind.as_str(),
                EXTENDED_DEF_KIND | EXTENDED_USAGE_KIND
            ) {
                continue;
            }
            let is_def = self.out.entries[i].is_def;
            if let Some(kind) = self.out.entries[d]
                .exprs
                .iter()
                .find_map(|x| base_metaclass(&x.text))
                .and_then(|m| base_kind(m, is_def))
            {
                self.out.entries[i].kind = kind.to_owned();
            }
        }
    }

    /// `expose A`・`A::*`・`A::**`・`A::*::**` と、後ろの `[式]`（SysML 8.2.2.26.2）。
    ///
    /// # 引数
    ///
    /// - `n`：`EXPOSE` の節
    /// - `start`・`end`：文の範囲（UTF-16 のオフセット。そのまま結果に入れる）
    ///
    /// # 戻り値
    ///
    /// 対象の名前（引用符を外し `::` でつなぐ）・`::*` の有無・`::**` の有無・絞り込みの式（`[ ]` の中）。
    /// 対象の修飾名が無ければ `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// expose("expose 'B c'::*[@F];") → Some({ target: "B c", members: true, recursive: false, filter: Some("@F") })
    /// expose("expose A::*::**;")     → Some({ target: "A", members: true, recursive: true, filter: None })
    /// expose("expose ;")             → None
    /// ```
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

/// 子の節のうち、最初の `kind`。孫より下は探さない。
///
/// # 引数
///
/// - `n`：探す親の節
/// - `kind`：探す節の種類
///
/// # 戻り値
///
/// 最初に見つかった子の節。無ければ `None`。
///
/// # 例
///
/// ```text
/// child("part def A { }" の PART_DEFINITION, BODY) → Some(BODY@11..14)
/// child("part a;" の PART_USAGE, BODY)             → None
/// ```
fn child(n: &SyntaxNode, kind: SyntaxKind) -> Option<SyntaxNode> {
    n.children().find(|c| c.kind() == kind)
}

/// 節の中の、空白・注記・コメントを除いたトークン。子孫の節の中のトークンも含め、書いた順に返す。
///
/// # 引数
///
/// - `n`：節
///
/// # 戻り値
///
/// トークンの反復子。意味のあるトークンが無ければ空。
///
/// # 例
///
/// ```text
/// tokens("part /* c */ a;" の PART_USAGE) → [part, a, ;]
/// tokens("R :: k1" の QUALIFIED_NAME)     → [R, ::, k1]
/// ```
fn tokens(n: &SyntaxNode) -> impl Iterator<Item = SyntaxToken> {
    n.descendants_with_tokens()
        .filter_map(|e| e.into_token())
        .filter(|t| !t.kind().is_trivia() && t.kind() != REGULAR_COMMENT)
}

/// 参照（修飾名・特徴の連鎖）を、空白を除いた文字列にする。引用名の引用符は外さない。
///
/// # 引数
///
/// - `n`：`QUALIFIED_NAME`・`FEATURE_CHAIN`・`NAME` などの節
///
/// # 戻り値
///
/// 意味のあるトークンの文字列をつないだもの。
///
/// # 例
///
/// ```text
/// compact("R :: k1" の QUALIFIED_NAME)       → "R::k1"
/// compact("kettle.heater" の FEATURE_CHAIN)  → "kettle.heater"
/// compact("'a b'" の NAME)                   → "'a b'"
/// ```
fn compact(n: &SyntaxNode) -> String {
    tokens(n).map(|t| t.text().to_owned()).collect()
}

/// 文の終わりの種類と位置（バイト）。末尾の終わっていない文は、暫定コアと同じく読まない。
///
/// # 引数
///
/// - `n`：文の節
///
/// # 戻り値
///
/// 本体があれば `(Open, 本体の { の位置)`、最後のトークンが `;` なら `(Semi, ; の位置)`、
/// 次の意味のあるトークンが `}` なら `(Close, } の位置)`、ほかのトークンが続くなら `(Semi, 節の終わり)`。
/// 後ろに何も無い（ファイルの末尾の終わっていない文）なら `None`。
///
/// # 例
///
/// ```text
/// terminator("part def A { }")                           → Some((Open, 11))
/// terminator("part a;")                                  → Some((Semi, 6))
/// terminator("constraint def C { a * b == c }" の式の文) → Some((Close, 30))
/// terminator("part b : B\n    part c : C;" の 1 つ目)     → Some((Semi, 10))   // 「;」の書き忘れ
/// terminator("part def Tail")                            → None
/// ```
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
///
/// `DECL_KINDS` を先頭から順に、語ごとに（語の途中で切れないように）当てる。
///
/// # 引数
///
/// - `n`：文の節（`LIBRARY_PACKAGE` なら頭によらず `"package"`）
/// - `h`：文の頭（修飾・前置メタデータ・`then`・`return` を外したもの）
///
/// # 戻り値
///
/// 暫定コアの種類名（`"part def"`・`"use case"` など）。宣言の種類で始まらなければ `None`。
///
/// # 例
///
/// ```text
/// decl_kind(…, "part def A")       → Some("part def")
/// decl_kind(…, "part a : T")       → Some("part")
/// decl_kind(…, "use case def U")   → Some("use case def")
/// decl_kind(…, "perform a")        → None   // "perform action" ではない
/// decl_kind(…, "parts x")          → None   // 語の途中
/// ```
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

/// 文が宣言になるときの種類（暫定コアの種類名）と、定義か。
///
/// `decl_kind` で決まる種類に加え、alpha.7 で読むようにした形を見分ける。
/// `timeslice`・`snapshot` の修飾だけの使用（PortionUsage）はその語を、`#X def H`（ExtendedDefinition）は `"def"`、
/// 種類のキーワードの無い `#X h`（ExtendedUsage）は `"usage"`、`variant a`（VariantReference）は `"variant"`、
/// `include U`・`event e`（参照の形）は `"include use case"`・`"event occurrence"` にする。
///
/// # 引数
///
/// - `n`：文の節
/// - `h`：文の頭（修飾・前置メタデータ・`then`・`return` を外したもの）
/// - `mods`：外した修飾（空白区切り）
/// - `has_prefix_meta`：前置メタデータ（`#X`）が付いているか
///
/// # 戻り値
///
/// `(種類, 定義か)`。宣言にならない文なら `None`。
///
/// # 例
///
/// ```text
/// entry_kind("part def A;", "part def A", "", false)        → Some(("part def", true))
/// entry_kind("timeslice t;", "t", "timeslice", false)       → Some(("timeslice", false))
/// entry_kind("timeslice part p;", "part p", "timeslice", …) → Some(("part", false))
/// entry_kind("#X def H;", "def H", "", true)                → Some(("def", true))
/// entry_kind("#X h : T;", "h : T", "", true)                → Some(("usage", false))
/// entry_kind("in #X x : T;", "x : T", "in", true)           → None   // パラメータとして読む
/// entry_kind("a = 1;", "a = 1", "", false)                  → None
/// ```
fn entry_kind(
    n: &SyntaxNode,
    h: &str,
    mods: &str,
    has_prefix_meta: bool,
) -> Option<(&'static str, bool)> {
    if n.kind() == EXTENDED_DEFINITION {
        return Some((EXTENDED_DEF_KIND, true));
    }
    let kind = decl_kind(n, h);
    let portion = mods
        .split(' ')
        .rev()
        .find_map(|m| ["timeslice", "snapshot"].into_iter().find(|p| *p == m));
    if let Some(p) = portion
        && matches!(kind, None | Some("occurrence"))
    {
        return Some((p, false));
    }
    if let Some(k) = kind {
        return Some((k, k.ends_with(" def")));
    }
    let is_mod = |w: &str| mods.split(' ').any(|m| m == w);
    match n.kind() {
        INCLUDE_USE_CASE_USAGE => Some(("include use case", false)),
        OCCURRENCE_USAGE if starts_with_word(h, "event") => Some(("event occurrence", false)),
        REFERENCE_USAGE if is_mod("variant") => Some(("variant", false)),
        REFERENCE_USAGE
            if has_prefix_meta
                && child(n, NAME).is_some()
                && (mods.is_empty() || param(n).is_none()) =>
        {
            Some((EXTENDED_USAGE_KIND, false))
        }
        _ => None,
    }
}

/// メタデータの定義の本体の式 `:>> baseType = … meta SysML::PartUsage` から、基のメタクラスの名前を取り出す
/// （SemanticMetadata の baseType、8.2.2.27）。
///
/// # 引数
///
/// - `text`：メタデータの定義の式（空白をまとめたもの）
///
/// # 戻り値
///
/// `meta` の後ろの修飾名の最後の名前。`baseType` と `meta` が無ければ `None`。
///
/// # 例
///
/// ```text
/// base_metaclass(":>> baseType = parts meta SysML::PartUsage") → Some("PartUsage")
/// base_metaclass("baseType = commands meta Usage")             → Some("Usage")
/// base_metaclass(":>> annotatedElement = x")                   → None
/// ```
fn base_metaclass(text: &str) -> Option<&str> {
    let (_, rest) = text.split_once("baseType")?;
    let (_, after) = rest.split_once(" meta ")?;
    let qn = after.split([' ', ';']).next()?;
    let name = last_segment(qn);
    is_basic_name(name).then_some(name)
}

/// 基のメタクラス（`PartUsage`・`ActionDefinition` など）から、利用者定義のキーワードで書いた宣言の種類を決める。
///
/// # 引数
///
/// - `metaclass`：メタクラスの名前（修飾の無い名前）
/// - `is_def`：定義（`#X def H`）か
///
/// # 戻り値
///
/// 宣言の種類（`DECL_KINDS` にあるもの）。定義なら `"part def"` のように ` def` を付ける。
/// メタクラスを種類にできないか、その種類の宣言を読まないなら `None`。
///
/// # 例
///
/// ```text
/// base_kind("PartUsage", true)       → Some("part def")
/// base_kind("ActionUsage", false)    → Some("action")
/// base_kind("Usage", false)          → None   // 種類が決まらない
/// base_kind("MetadataUsage", false)  → None   // メタデータの使用は宣言として読まない
/// ```
fn base_kind(metaclass: &str, is_def: bool) -> Option<&'static str> {
    let kind = crate::model::metaclass_kind(metaclass)?;
    let head = kind.strip_suffix(" def").unwrap_or(&kind);
    let want = if is_def {
        format!("{head} def")
    } else {
        head.to_owned()
    };
    DECL_KINDS.iter().copied().find(|k| *k == want)
}

/// 本体の無い `assert constraint c : CD`・`require c : CD` などを、持ち主の式の文字列にする。
/// 頭の `assert`・`require`・`assume`・`constraint` を外し、`not` は残す。
///
/// # 引数
///
/// - `h`：文の頭（空白をまとめたもの）
///
/// # 戻り値
///
/// 外した後の文字列。何も残らなければ空文字列。
///
/// # 例
///
/// ```text
/// constraint_reference_text("assert constraint c : CD")      → "c : CD"
/// constraint_reference_text("assert not constraint c : CD")  → "not c : CD"
/// constraint_reference_text("require c : CD")                → "c : CD"
/// constraint_reference_text("require constraint")            → ""
/// ```
fn constraint_reference_text(h: &str) -> String {
    h.split(' ')
        .skip_while(|w| matches!(*w, "assert" | "require" | "assume"))
        .filter(|w| *w != "constraint")
        .collect::<Vec<_>>()
        .join(" ")
}

/// 宣言の名前・短い名前・型（型付け、または定義の特殊化）。
struct DeclParts {
    short: String,
    name: String,
    /// 型（型付け、または定義の特殊化の相手）
    typed: Option<TypeRef>,
}

/// 関係の相手の型。
struct TypeRef {
    /// 最後の修飾名の最後の部分（引用符を外したもの）。
    name: String,
    /// 共役（`~`）か。
    conj: bool,
    /// 修飾名全体（引用符を外し `::` でつなぐ）。特徴の連鎖なら `name` と同じ。
    path: String,
}

/// 宣言の節から、短い名前・名前・型を取り出す。
///
/// 名前の無い宣言が関係で始まるとき（`:>> mass`）は、その関係の相手の名前を名前にする。
/// 型は最初の型付け（`:`）、定義なら最初の特殊化（`:>`）の相手にする。
///
/// # 引数
///
/// - `n`：宣言の節
/// - `is_def`：定義か（真なら特殊化の相手も型にする）
///
/// # 戻り値
///
/// 短い名前・名前（無ければ空文字列）・型（`TypeRef`、無ければ `None`）。引用名は引用符を外す。
///
/// # 例
///
/// ```text
/// decl_parts("part def <P1> Engine :> Base", true) → { short: "P1", name: "Engine", typed: Some({ name: "Base", conj: false, path: "Base" }) }
/// decl_parts("port p : ~Q::Fuel[1];", false)       → { short: "", name: "p", typed: Some({ name: "Fuel", conj: true, path: "Q::Fuel" }) }
/// decl_parts("attribute :>> mass;", false)         → { short: "", name: "mass", typed: None }
/// ```
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

/// 関係の相手の型（最後の修飾名の最後の部分と、修飾名全体）と、共役か。
///
/// # 引数
///
/// - `rel`：関係の節（`FEATURE_TYPING`・`SUBCLASSIFICATION` など）
///
/// # 戻り値
///
/// 最初の相手の `TypeRef`（名前は引用符を外す）。相手の名前が無ければ `None`。
///
/// # 例
///
/// ```text
/// type_of(": ~Fuel")  → Some({ name: "Fuel", conj: true, path: "Fuel" })
/// type_of(": A::B")   → Some({ name: "B", conj: false, path: "A::B" })
/// type_of(": a.b")    → Some({ name: "b", conj: false, path: "b" })   // 特徴の連鎖
/// type_of(":")        → None   // 相手が無い
/// ```
fn type_of(rel: &SyntaxNode) -> Option<TypeRef> {
    let conj = rel.children_with_tokens().any(|e| e.kind() == TILDE);
    let target = rel
        .children()
        .find(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))?;
    let last = tokens(&target)
        .filter(|t| matches!(t.kind(), IDENT | QUOTED_NAME))
        .last()?;
    let name = unquote(last.text()).to_owned();
    let path = if target.kind() == QUALIFIED_NAME {
        path_of(&target)
    } else {
        name.clone()
    };
    Some(TypeRef { name, conj, path })
}

/// 修飾名の節を、引用符を外した名前を `::` でつないだ文字列にする。
///
/// # 引数
///
/// - `qn`：`QUALIFIED_NAME` の節
///
/// # 戻り値
///
/// 名前を `::` でつないだ文字列。名前が無ければ空文字列。
///
/// # 例
///
/// ```text
/// path_of("'P 1' :: A") → "P 1::A"
/// path_of("A")          → "A"
/// ```
fn path_of(qn: &SyntaxNode) -> String {
    tokens(qn)
        .filter(|t| matches!(t.kind(), IDENT | QUOTED_NAME))
        .map(|t| unquote(t.text()).to_owned())
        .collect::<Vec<_>>()
        .join("::")
}

/// `alias B for A;` の別名（AliasMember、8.2.2.5）。
///
/// # 引数
///
/// - `n`：`ALIAS` の節
/// - `pe`：別名を書いた宣言の番号。ファイルの直下なら `None`
///
/// # 戻り値
///
/// 別名と指す先。名前か、`for` の後の修飾名が無ければ `None`。
///
/// # 例
///
/// ```text
/// alias("alias B for Q::A;", Some(0)) → Some({ name: "B", target: "Q::A", pe: Some(0) })
/// alias("alias B;", None)             → None   // 指す先が無い
/// ```
fn alias(n: &SyntaxNode, pe: Option<usize>) -> Option<Alias> {
    let name = child(n, NAME)
        .and_then(|c| tokens(&c).next())
        .map(|t| unquote(t.text()).to_owned())?;
    let mut seen = false;
    for e in n.children_with_tokens() {
        match e {
            rowan::NodeOrToken::Token(t) if t.kind() == KEYWORD && t.text() == "for" => seen = true,
            rowan::NodeOrToken::Node(c) if seen && c.kind() == QUALIFIED_NAME => {
                return Some(Alias {
                    name,
                    target: path_of(&c),
                    pe,
                });
            }
            _ => {}
        }
    }
    None
}

/// キーワード `kw` の後ろの最初の参照。`kw` と参照は `n` の直接の子であること。
///
/// # 引数
///
/// - `n`：文の節
/// - `kw`：キーワードの文字列（`"by"`・`"from"`・`"to"` など）
///
/// # 戻り値
///
/// `kw` の後の最初の修飾名か特徴の連鎖を、空白を除いた文字列にしたもの。`kw` が無いか、後ろに参照が無ければ `None`。
///
/// # 例
///
/// ```text
/// ref_after("satisfy R::k1 by kettle.heater;", "by") → Some("kettle.heater")
/// ref_after("satisfy R::k1 by kettle.heater;", "of") → None
/// ```
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
///
/// # 引数
///
/// - `n`：文の節
///
/// # 戻り値
///
/// 最初の `NAME`・`QUALIFIED_NAME`・`FEATURE_CHAIN` の子を、空白を除き（全体が引用名なら引用符も外し）文字列にしたもの。
/// 無ければ `None`。
///
/// # 例
///
/// ```text
/// first_ref("verify R;")               → Some("R")
/// first_ref("verify requirement r;")   → Some("r")   // NAME
/// first_ref("verify;")                 → None
/// ```
fn first_ref(n: &SyntaxNode) -> Option<String> {
    n.children()
        .find(|c| matches!(c.kind(), NAME | QUALIFIED_NAME | FEATURE_CHAIN))
        .map(|c| unquote(&compact(&c)).to_owned())
}

/// `interface i : I connect a to b` の両端。
///
/// # 引数
///
/// - `n`：宣言の節
///
/// # 戻り値
///
/// `(connect の後の参照, to の後の参照)`。どちらかが無ければ `None`。
///
/// # 例
///
/// ```text
/// connect_ends("interface i : I connect a.p to b.q;") → Some(("a.p", "b.q"))
/// connect_ends("interface i : I;")                     → None
/// ```
fn connect_ends(n: &SyntaxNode) -> Option<(String, String)> {
    Some((ref_after(n, "connect")?, ref_after(n, "to")?))
}

/// 関係を表す文（依存・メッセージ・満たす・検証する・扱う・流れ・遷移）。
///
/// 依存は前置メタデータ（`#derivation` なら導出）の付いたものだけ、流れは名前の無いものだけを関係にする。
///
/// # 引数
///
/// - `n`：文の節（種類で関係の種類を決める）
/// - `h`：文の頭（修飾を外したもの。依存は `#` で、満たすは `satisfy` で始まることを確かめる）
///
/// # 戻り値
///
/// 関係の種類と相手。関係の文でないか、必要な相手（`from`・`to`・`by` の後など）が無ければ `None`。
///
/// # 例
///
/// ```text
/// relation("satisfy R by A;", "satisfy R by A")  → Some(Satisfy { req: "R", by: "A", negated: false })
/// relation("satisfy R;", "satisfy R")            → Some(Satisfy { req: "R", by: "", negated: false })
/// relation("not satisfy R by A;", …)             → Some(Satisfy { req: "R", by: "A", negated: true })
/// relation("verify R;", "verify R")              → Some(Verify { req: "R" })
/// relation("transition t first idle accept Go then idle;", …)
///   → Some(Transition { from: "idle", ev: "Go", to: "idle" })
/// relation("part a;", "part a")                  → None
/// ```
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
        // `satisfy R by X`・`satisfy R;`（持ち主が満たす）・`assert satisfy`・`not satisfy`（8.2.2.21）
        SATISFY_REQUIREMENT_USAGE
            if ["satisfy", "assert", "not"]
                .iter()
                .any(|w| starts_with_word(h, w)) =>
        {
            let req = name().or_else(|| {
                n.children()
                    .find(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
                    .map(|c| compact(&c))
            })?;
            let negated = n
                .children_with_tokens()
                .any(|e| e.kind() == KEYWORD && e.as_token().is_some_and(|t| t.text() == "not"));
            Some(RelKind::Satisfy {
                req,
                by: ref_after(n, "by").unwrap_or_default(),
                negated,
            })
        }
        REQUIREMENT_VERIFICATION_USAGE => Some(RelKind::Verify { req: first_ref(n)? }),
        FRAMED_CONCERN_USAGE => {
            let t = child(n, FEATURE_TYPING).and_then(|c| type_of(&c))?;
            Some(RelKind::Frame {
                name: name()?,
                ty: t.name,
                path: t.path,
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

/// 修飾の付いた `name : Type`（パラメータ）。修飾があるかは呼び出し側が確かめる。
///
/// # 引数
///
/// - `n`：文の節
///
/// # 戻り値
///
/// `(名前, 型)`。前置メタデータを除いた最初の子が基本名の `NAME`、次の子が型付けでなければ `None`。
///
/// # 例
///
/// ```text
/// param("in x : Real;")   → Some(("x", { name: "Real", conj: false, path: "Real" }))
/// param("in x;")          → None   // 型付けが無い
/// param("in 'x' : Real;") → None   // 引用名
/// ```
fn param(n: &SyntaxNode) -> Option<(String, TypeRef)> {
    let mut cs = n.children().filter(|c| c.kind() != PREFIX_METADATA);
    let name = cs.next().filter(|c| c.kind() == NAME)?;
    let name = tokens(&name)
        .next()
        .filter(|t| t.kind() == IDENT)?
        .text()
        .to_owned();
    let typing = cs.next().filter(|c| c.kind() == FEATURE_TYPING)?;
    Some((name, type_of(&typing)?))
}

/// 空白で区切った最初の語（無名ブロックのキーワードに使う）。
///
/// # 引数
///
/// - `s`：空白をまとめた文の頭
///
/// # 戻り値
///
/// 最初の半角空白の手前まで。空白が無ければ `s` 全体。
///
/// # 例
///
/// ```text
/// first_word_space("require constraint") → "require"
/// first_word_space("@Phase")             → "@Phase"
/// first_word_space("")                   → ""
/// ```
fn first_word_space(s: &str) -> &str {
    s.split(' ').next().unwrap_or("")
}

#[cfg(test)]
mod tests;
