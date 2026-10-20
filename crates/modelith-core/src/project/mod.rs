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
/// project("package P { send s; }\npart def Tail", …)
///   → unsupported の head: ["send s"]、Tail は entries に無い、errors は 1 件
/// ```
pub fn project(source: &str, parse: &Parse) -> ParseResult {
    let mut c = Ctx::new(source, parse);
    c.members(&parse.syntax(), None, None);
    c.apply_about_annotations();
    c.apply_comment_abouts();
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
    "allocation def",
    "flow def",
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
    "allocation",
    "flow",
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

/// アクションの流れ（8.2.2.17）の要素になる使用の種類（ActionBehaviorMember：振る舞いの使用とアクションの節）。
/// これらの宣言は、続く `then b;`・`if g then b;`・`else b;` の継起の元になる。
pub(crate) const ACTION_FLOW_KINDS: &[&str] = &[
    "action",
    "perform action",
    "state",
    "exhibit state",
    "fork",
    "join",
    "merge",
    "decide",
    "send",
    "accept",
    "assign",
    "terminate",
    "if",
    "while",
    "loop",
    "for",
];

/// 本体の中で、直前に書いたアクションの流れの要素（継起の元）。
#[derive(Clone)]
struct Prev {
    /// 宣言の番号。`first start;` のように参照で決めたときは `None`。
    entry: Option<usize>,
    /// 名前（名前の無い宣言は空）。
    name: String,
    /// 状態の本体の `entry …;`（EntryActionMember、8.2.2.18）か。続く `then s;` は、最初の遷移になる。
    initial: bool,
}

/// 種類のキーワードの無い参照の使用（`x : Real;`・`ref r;`、DefaultReferenceUsage・ReferenceUsage、8.2.2.6）の種類。
/// 向きの付いたパラメータ（`in x : Real;`）と同じ種類にし、向きを `ref` にする。
const REFERENCE_KIND: &str = "param";

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

/// `comment c about A, B /* … */`（相手は読み終えてから、書いた場所から解決する）。
struct CommentAbout {
    /// コメントの宣言の番号。
    entry: usize,
    /// 相手の参照（修飾名・特徴の連鎖）。
    about: Vec<String>,
    /// 文を書いた宣言の番号（名前を探し始める場所）。
    pe: Option<usize>,
    /// 文の位置（UTF-16 のオフセット。相手が見つからないときの問題の位置）。
    pos: usize,
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
    /// `about` の付いたコメント（書いた順）。相手は読み終えてから解決する。
    comment_abouts: Vec<CommentAbout>,
    /// 読んでいる本体ごとの、直前のアクションの流れの要素（入れ子の本体の順。末尾が今の本体）。
    prev: Vec<Option<Prev>>,
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
            comment_abouts: Vec::new(),
            prev: Vec::new(),
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
    /// 継起の元になる直前の要素（`prev`）は、この本体の中だけで数える。
    ///
    /// # 引数
    ///
    /// - `container`：要素を並べた節（`SOURCE_FILE` か `BODY`）
    /// - `owner`：子の持ち主（宣言か無名ブロックの番号）。ファイルの直下なら `None`
    /// - `pe`：子を含む、いちばん近い宣言の番号。無ければ `None`
    fn members(&mut self, container: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        // 継起の元（直前の要素）は、本体ごとに数える
        self.prev.push(None);
        for n in container.children() {
            self.statement(&n, owner, pe);
        }
        self.prev.pop();
    }

    /// 要素 1 つを、宣言・関係・式・まだ扱えない文・無名ブロックのどれかにする（暫定コアの stmt と同じ順で判定する）。
    ///
    /// `doc` は `pe` の宣言の `doc` に、`rep` は `pe` の宣言の `reps` に入れ、`comment` は種類 `comment` の宣言にする。本体 `{ … }` があれば、宣言ならその中を、宣言でなければ
    /// 無名ブロックを作ってその中を読み、`open`・`close`・`end` を記録する。まだ扱えない文の本体は読まない
    /// （中の宣言を、外側の宣言の中身にしない）。依存・別名の本体（関係への注釈）も読まない。終わっていない末尾の文は読まない。
    ///
    /// # 引数
    ///
    /// - `n`：要素の節
    /// - `owner`：要素の持ち主（宣言か無名ブロックの番号）。ファイルの直下なら `None`
    /// - `pe`：要素を含む、いちばん近い宣言の番号。無ければ `None`
    fn statement(&mut self, n: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        match n.kind() {
            COMMENT => {
                self.comment(n, owner, pe);
                return;
            }
            TEXTUAL_REPRESENTATION => {
                if let (Some(pe), Some(rep)) = (pe, representation(n)) {
                    self.out.entries[pe].reps.push(rep);
                }
                return;
            }
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
        // 依存・別名の本体（RelationshipBody、8.2.2.2）は関係への注釈（doc・comment・@M）だけを持つ。関係への注釈は
        // まだ記録しないので読まない（外側の宣言の説明やメタデータと取り違えないように）
        let is_relationship_body = matches!(n.kind(), DEPENDENCY | ALIAS);
        // メタデータの本体の文の本体（`@M { :>> x { … } }`）も、持ち主の中身にしない
        let in_metadata_body =
            matches!(owner, Some(Scope::Block(b)) if self.meta_blocks.contains_key(&b));
        if term != Term::Open || is_unsupported || is_relationship_body || in_metadata_body {
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
                if matches!(n.kind(), IF_NODE | WHILE_LOOP_NODE) {
                    self.branches(n, i);
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

    /// `if` のアクションの `else` の後（本体か `else if …`）と、`while` の後ろの `until c;` を読む（IfNode・WhileLoopNode、8.2.2.17）。
    ///
    /// `else` の本体は、キーワード `else` の無名ブロックにして中を読む（中の宣言の `pe` は `if` のアクション）。`else if …` は、
    /// `if` のアクションの中の `if` のアクションにする。宣言の終わり（`end`）は、`else` の本体や `until c;` まで広げる。
    ///
    /// # 引数
    ///
    /// - `n`：`IF_NODE` か `WHILE_LOOP_NODE` の節
    /// - `i`：その節の宣言の番号（最初の本体は読み終えていること）
    fn branches(&mut self, n: &SyntaxNode, i: usize) {
        let bodies: Vec<SyntaxNode> = n.children().filter(|c| c.kind() == BODY).collect();
        if let Some(body) = bodies.get(1) {
            let at = n
                .children_with_tokens()
                .find(|e| e.kind() == KEYWORD && e.as_token().is_some_and(|t| t.text() == "else"))
                .map_or(body.text_range().start(), |e| e.text_range().start());
            let b = self.out.blocks.len();
            let close = body
                .last_token()
                .filter(|t| t.kind() == R_BRACE)
                .map(|t| self.utf16(t.text_range().start().into()));
            self.out.blocks.push(Block {
                kw: "else".to_owned(),
                head: "else".to_owned(),
                start: self.utf16(at.into()),
                owner: Some(Scope::Entry(i)),
                open: Some(self.utf16(body.text_range().start().into())),
                close,
                end: close.map(|c| c + 1),
            });
            self.members(body, Some(Scope::Block(b)), Some(i));
        }
        if let Some(nested) = child(n, IF_NODE) {
            self.statement(&nested, Some(Scope::Entry(i)), Some(i));
        }
        self.out.entries[i].end = self.utf16(n.text_range().end().into());
    }

    /// `if`・`while` のアクションの条件、`for` のアクションの `変数 in 列`（IfNode・WhileLoopNode・ForLoopNode、8.2.2.17）。
    ///
    /// # 引数
    ///
    /// - `n`：文の節
    ///
    /// # 戻り値
    ///
    /// 条件の式（空白をまとめたもの）。`for` は `x : T in xs` の形。ほかの節や、条件の無い `loop` なら `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// guard("if x  > 0 { … }")         → Some("x > 0")
    /// guard("for x : T in xs { … }")   → Some("x : T in xs")
    /// guard("loop { … } until done;") → None   // until の条件は記録しない
    /// guard("part p;")                 → None
    /// ```
    fn guard(&self, n: &SyntaxNode) -> Option<String> {
        let cond = child(n, EXPRESSION).map(|x| self.node_head(&x));
        match n.kind() {
            IF_NODE => cond.filter(|c| !c.is_empty()),
            WHILE_LOOP_NODE if !has_keyword(n, "loop") => cond.filter(|c| !c.is_empty()),
            FOR_LOOP_NODE => {
                let var = child(n, NODE_PARAMETER).map(|v| self.node_head(&v))?;
                Some(format!("{var} in {}", cond.unwrap_or_default()))
            }
            _ => None,
        }
    }

    /// 文を読み、宣言を作ったらその番号を返す。
    ///
    /// メタデータの本体の `key = 値`、メタデータの使用（`@M`・`metadata M about …`）、列挙値、関係、
    /// view の `expose`・`filter`・`render`、別名、`import`、本体の無い名前付きの制約（`assert constraint c : CD`）、
    /// 読み飛ばす文、宣言（アクションの節を含む）、パラメータ、式、まだ扱えない文の順に判定し、解析結果の該当する表に足す。
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
    /// // "action def A { then send s to b; }" の中の文（A が 0 番）
    /// classify(…, "then send s to b", …)   → Some(1)（kind "send"、head "send s to b"）
    /// // "until s;"
    /// classify(…, "until s", …)            → None（unsupported に "until s"）
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

        // メタデータの本体（@Phase { stage = PhaseKind::X; }・metadata M about A { k = 1 + 2; }・@M { :>> x = 1; }）。
        // 本体の文はメタデータの特性（MetadataBodyUsage、8.2.2.27）なので、値の無いものも持ち主の宣言や式にしない
        if let Some(Scope::Block(b)) = owner
            && let Some(mb) = self.meta_blocks.get(&b).cloned()
        {
            if let Some((key, val)) = metadata_body_assignment(h) {
                match mb.target {
                    MetaTarget::Owner(Some(pe)) => {
                        self.set_owner_meta(pe, b, &mb.md, key, val, hs);
                    }
                    MetaTarget::Owner(None) => {}
                    MetaTarget::About(a) => self.annotations[a]
                        .fields
                        .push((key.to_owned(), meta_value(val).to_owned())),
                }
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
        // 依存（依存する側とされる側の組ごとに 1 つの関係にする。8.2.2.3）
        if n.kind() == DEPENDENCY {
            for kind in dependencies(n) {
                self.out.rels.push(Rel {
                    kind,
                    pe,
                    start,
                    end,
                });
            }
            return None;
        }
        // 遷移（`transition …;`、状態の中の `then b;`・`accept E then b;`・`if g then b;`、`entry; then s;`。8.2.2.18）
        if self.transition(n, pe, start, end) {
            return None;
        }
        if self.state_subaction(n, pe, h) {
            return None;
        }
        // 継起（`first a then b;`・`then b;`・`if g then b;`・`else b;`・`first start;`、8.2.2.14・8.2.2.17）
        if n.kind() == SUCCESSION_AS_USAGE {
            self.succession(n, pe, start, end);
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
                // 参照形 `render asTreeDiagram;`（特殊化・本体が続いてもよい）は、参照した表し方の名前。
                // 合成形 `render rendering r …` は、下で種類 `rendering` の宣言にする
                VIEW_RENDERING_USAGE if !has_keyword(n, "rendering") => {
                    if let Some(q) = child(n, QUALIFIED_NAME) {
                        self.out.entries[pe].render = Some(last_segment(&path_of(&q)).to_owned());
                        return None;
                    }
                }
                _ => {}
            }
        }
        // 前置メタデータは、続く宣言のメタデータとして読む（ADR-0013）
        let (prefix_meta, h) = strip_prefix_metadata(h);
        let h = strip_then_return(h);
        let h = match n.kind() {
            VIEW_RENDERING_USAGE => h.strip_prefix("render ").unwrap_or(h),
            _ => h,
        };
        // KerML の宣言（`classifier C { … }` など）は、まだ扱えない文として知らせ、本体を外側の中身にしない（F-EDIT-8）
        if n.kind() == UNSUPPORTED_MEMBER && crate::syntax::is_kerml_keyword(first_word(h)) {
            self.out.unsupported.push(Unsupported {
                start,
                end,
                head: h.to_owned(),
            });
            return None;
        }
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
        // アクションの節（`fork f;`・`then send x to y;`・`accept e : E;` など）は、書いた語を種類にした使用（8.2.2.17）
        let node = action_node_kind(n).or_else(|| {
            // 名前付きの `succession flow f …;` は、名前付きのフローと同じく宣言にする（8.2.2.16）
            (n.kind() == SUCCESSION_FLOW_USAGE && child(n, NAME).is_some())
                .then_some("succession flow")
        });
        let h = match node {
            Some(_) => h.strip_prefix("then ").unwrap_or(h),
            None if is_skipped(h) => return None,
            None => h,
        };
        // `x : Real;`・`y :> x;`・`ref r;`（種類のキーワードの無い参照の使用。DefaultReferenceUsage・ReferenceUsage、8.2.2.6）は、
        // `ref s : A;` と同じく参照のパラメータにする。列挙の定義の本体の `a = 1;` と、結果のパラメータ `return r : R;` は、
        // これまでどおり読む（列挙値・パラメータとして扱うまで）
        let reference = n.kind() == REFERENCE_USAGE
            && (mods.is_empty() || mods == "ref")
            && prefix_meta.is_empty()
            && !has_keyword(n, "return")
            && !pe.is_some_and(|pe| self.out.entries[pe].kind == "enum def")
            && !decl_parts(n, false).name.is_empty();
        if let Some((kind, is_def)) = node
            .map(|k| (k, false))
            .or_else(|| reference.then_some((REFERENCE_KIND, false)))
            .or_else(|| entry_kind(n, h, &mods, !prefix_meta.is_empty()))
        {
            let idx = self.out.entries.len();
            let parts = decl_parts(n, is_def);
            let name = if parts.name.is_empty()
                && matches!(
                    n.kind(),
                    INCLUDE_USE_CASE_USAGE
                        | OCCURRENCE_USAGE
                        | PERFORM_ACTION_USAGE
                        | EXHIBIT_STATE_USAGE
                ) {
                // `include U;`・`event e;`・`perform x.y;`・`exhibit s;` は、参照した特徴の名前を名前にする（OwnedReferenceSubsetting）
                first_ref(n)
                    .map(|r| last_segment(r.rsplit('.').next().unwrap_or(&r)).to_owned())
                    .unwrap_or_default()
            } else {
                parts.name
            };
            if matches!(kind, EXTENDED_DEF_KIND | EXTENDED_USAGE_KIND) {
                self.extended.push(idx);
            }
            let value = child(n, FEATURE_VALUE)
                .and_then(|v| child(&v, EXPRESSION))
                .map(|x| self.node_head(&x))
                .filter(|v| !v.is_empty());
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
                value: value.clone(),
                value_op: value
                    .and(child(n, FEATURE_VALUE))
                    .and_then(|v| value_op(&v)),
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
                specs: self.specs(n, is_def),
                multiplicity: multiplicity(n),
                body: None,
                about: Vec::new(),
                reps: Vec::new(),
                guard: None,
                state_actions: Vec::new(),
                parallel: false,
            };
            if reference {
                // 参照の使用は、`ref` のパラメータと同じく向き `ref` で表す（修飾は持たない）
                e.mods = None;
                e.dir = Some("ref".to_owned());
            }
            if let Some(spec) = self.performed_reference(n) {
                e.specs.insert(0, spec);
            }
            e.guard = self.guard(n);
            e.parallel = matches!(
                n.kind(),
                STATE_DEFINITION | STATE_USAGE | EXHIBIT_STATE_USAGE
            ) && has_keyword(n, "parallel");
            if !prefix_meta.is_empty() {
                let meta = e.meta.get_or_insert_with(OrderedMap::default);
                for md in prefix_meta {
                    meta.entry(md, OrderedMap::default);
                }
            }
            let flow = match n.kind() {
                FLOW_USAGE => flow_ends(n, e.name.clone(), e.ty.clone(), Some(idx)),
                SUCCESSION_FLOW_USAGE => {
                    succession_flow_ends(n, e.name.clone(), e.ty.clone(), Some(idx))
                }
                _ => None,
            };
            if let Some(kind) =
                flow.or_else(|| connector_relation(n.kind(), connector_ends(n), &e.ty, idx))
            {
                self.out.rels.push(Rel {
                    kind,
                    pe,
                    start,
                    end,
                });
            }
            // イベントも、続く `then event occurrence e2;` の継起の元になる（OccurrenceUsageMember の SourceSuccessionMember、8.2.2.9.3）。
            // 状態の本体では、`then s;` を直前の状態からの遷移として読むので、イベントを元にしない
            // 合成形の `render rendering r :> asTreeDiagram { … }` は、view の表し方にもする（ViewRenderingMember、8.2.2.26）
            if n.kind() == VIEW_RENDERING_USAGE
                && let Some(pe) = pe
                && matches!(self.out.entries[pe].kind.as_str(), "view" | "view def")
            {
                self.out.entries[pe].render = Some(rendering_reference(&e));
            }
            let is_flow_node = ACTION_FLOW_KINDS.contains(&e.kind.as_str())
                || (e.kind == "event occurrence" && !self.in_state(pe));
            let name = e.name.clone();
            self.push_entry(e, pe);
            if is_flow_node {
                self.flow_node(n, pe, idx, name);
            }
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
                value_op: None,
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
                specs: Vec::new(),
                multiplicity: None,
                body: None,
                about: Vec::new(),
                reps: Vec::new(),
                guard: None,
                state_actions: Vec::new(),
                parallel: false,
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

    /// 継起の文（SuccessionAsUsage・TargetSuccessionMember・GuardedSuccession・DefaultTargetSuccession、8.2.2.14・8.2.2.17）を
    /// 関係にする。`first a then b;` は書いた 2 つの端の間、`then b;`・`if g then b;`・`else b;` は直前の要素から b へ。
    /// `then` の無い `first start;`（InitialNodeMember）は関係にせず、続く継起の元を start にする。
    ///
    /// # 引数
    ///
    /// - `n`：`SUCCESSION_AS_USAGE` の節
    /// - `pe`：文を含む、いちばん近い宣言の番号
    /// - `start`・`end`：文の範囲（UTF-16。`end` は `;` の位置）
    fn succession(&mut self, n: &SyntaxNode, pe: Option<usize>, start: usize, end: usize) {
        let ends = connector_ends(n);
        let has = |kw: &str| has_keyword(n, kw);
        let guard = child(n, GUARD_EXPRESSION)
            .and_then(|g| child(&g, EXPRESSION))
            .map(|x| self.node_head(&x))
            .unwrap_or_else(|| {
                if has("else") {
                    "else".to_owned()
                } else {
                    String::new()
                }
            });
        let (source, target) = match (has("first"), ends.as_slice()) {
            (true, [a, b, ..]) if has("then") => (
                Prev {
                    entry: None,
                    name: a.clone(),
                    initial: false,
                },
                b.clone(),
            ),
            (true, [a, ..]) => {
                if let Some(top) = self.prev.last_mut() {
                    *top = Some(Prev {
                        entry: None,
                        name: a.clone(),
                        initial: false,
                    });
                }
                return;
            }
            (false, [b, ..]) => (self.current_prev(), b.clone()),
            _ => return,
        };
        self.out.rels.push(Rel {
            kind: RelKind::Succession {
                a: source.name,
                b: target,
                a_entry: source.entry,
                b_entry: None,
                guard,
                name: child(n, NAME)
                    .map(|c| unquote(&compact(&c)).to_owned())
                    .unwrap_or_default(),
            },
            pe,
            start,
            end,
        });
    }

    /// 状態の本体（`state def`・`state`・`exhibit state` の本体、8.2.2.18）か。
    ///
    /// # 引数
    ///
    /// - `pe`：文を含む、いちばん近い宣言の番号
    ///
    /// # 戻り値
    ///
    /// `pe` が状態の定義か使用なら `true`。ファイルの直下やほかの宣言なら `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "state def S { … }" の中の文（S が 0 番）
    /// in_state(Some(0)) → true
    /// in_state(None)    → false
    /// ```
    fn in_state(&self, pe: Option<usize>) -> bool {
        pe.is_some_and(|i| {
            matches!(
                self.out.entries[i].kind.as_str(),
                "state def" | "state" | "exhibit state"
            )
        })
    }

    /// 遷移の文（TransitionUsage・TargetTransitionUsage・EntryTransitionMember、8.2.2.18）を関係にする。
    ///
    /// `transition … first a … then b;` は書いた 2 つの端の間、`first` の無い `transition … then b;` と、状態の本体の
    /// `then b;`・`if g do e then b;`・`accept E via p if g do e then b;` は、直前の状態から b へ。状態の本体の `entry …;` の直後の
    /// `then s;`・`if g then s;` は、最初の遷移（`EntryTransition`）にする。トリガ（受けるもの）・`via`・ガード・効果・名前も記録する。
    /// 状態の本体の `else b;` と `first a then b;` は、遷移にしない（継起として読む）。
    ///
    /// # 引数
    ///
    /// - `n`：文の節
    /// - `pe`：文を含む、いちばん近い宣言の番号
    /// - `start`・`end`：文の範囲（UTF-16。`end` は `;` の位置）
    ///
    /// # 戻り値
    ///
    /// 遷移の文として読んだ（関係にしたか、行き先が無いので捨てた）なら `true`。遷移の文でなければ `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "state def S { state a; accept Go if x > 0 do beep then b; }" の accept の文
    /// transition(…) → true（rels に Transition { from: "a", ev: "Go", to: "b", guard: "x > 0", effect: "beep", from_entry: Some(a の番号), … }）
    /// // "state def S { entry; then idle; }" の then の文
    /// transition(…) → true（rels に EntryTransition { to: "idle", guard: "" }）
    /// // "action def A { action a; then b; }" の then の文
    /// transition(…) → false（継起として読む）
    /// ```
    fn transition(&mut self, n: &SyntaxNode, pe: Option<usize>, start: usize, end: usize) -> bool {
        let in_state = self.in_state(pe);
        let shorthand = in_state
            && match n.kind() {
                SUCCESSION_AS_USAGE => !has_keyword(n, "first") && !has_keyword(n, "else"),
                ACCEPT_NODE => child(n, CONNECTOR_END).is_some(),
                _ => false,
            };
        if n.kind() != TRANSITION_USAGE && !shorthand {
            return false;
        }
        let ends = connector_ends(n);
        let guard = child(n, GUARD_EXPRESSION)
            .and_then(|g| child(&g, EXPRESSION))
            .map(|x| self.node_head(&x))
            .unwrap_or_default();
        let (from, to) = match (has_keyword(n, "first"), ends.as_slice()) {
            (true, [a, b]) => (
                Prev {
                    entry: None,
                    name: a.clone(),
                    initial: false,
                },
                b.clone(),
            ),
            (false, [b]) => (self.current_prev(), b.clone()),
            _ => return true,
        };
        let kind = if from.initial {
            RelKind::EntryTransition { to, guard }
        } else {
            let (ev, via) = self.trigger(n);
            RelKind::Transition {
                from: from.name,
                ev,
                to,
                name: child(n, NAME)
                    .map(|c| unquote(&compact(&c)).to_owned())
                    .unwrap_or_default(),
                via,
                guard,
                effect: child(n, EFFECT_BEHAVIOR)
                    .and_then(|x| child(&x, EXPRESSION))
                    .map(|x| self.node_head(&x))
                    .unwrap_or_default(),
                from_entry: from.entry,
            }
        };
        self.out.rels.push(Rel {
            kind,
            pe,
            start,
            end,
        });
        true
    }

    /// 遷移のトリガ（TriggerAction・省略形の `accept`、8.2.2.18）の、受けるものと `via` の後。
    ///
    /// # 引数
    ///
    /// - `n`：遷移の文の節（`TRANSITION_USAGE` は `TRIGGER_ACTION` の中を、`ACCEPT_NODE` は直下を見る）
    ///
    /// # 戻り値
    ///
    /// （受けるもの, `via` の後）。どちらも空白をまとめて書いたとおり。無ければ空文字列。
    ///
    /// # 例
    ///
    /// ```text
    /// trigger("transition first a accept e : Go via p then b;") → ("e : Go", "p")
    /// trigger("accept after 5 [s] then b;")                     → ("after 5 [s]", "")
    /// trigger("then b;")                                        → ("", "")
    /// ```
    fn trigger(&self, n: &SyntaxNode) -> (String, String) {
        let holder = if n.kind() == TRANSITION_USAGE {
            child(n, TRIGGER_ACTION)
        } else if n.kind() == ACCEPT_NODE {
            Some(n.clone())
        } else {
            None
        };
        let Some(t) = holder else {
            return (String::new(), String::new());
        };
        let mut params = t.children().filter(|c| c.kind() == NODE_PARAMETER);
        let ev = params
            .next()
            .map(|x| self.node_head(&x))
            .unwrap_or_default();
        let via = if has_keyword(&t, "via") {
            params
                .next()
                .map(|x| self.node_head(&x))
                .unwrap_or_default()
        } else {
            String::new()
        };
        (ev, via)
    }

    /// 状態の本体の `entry …;`・`do …;`・`exit …;`（StateSubactionMembership、8.2.2.18）を、状態の振る舞いとして記録する。
    /// 振る舞いを書かない `entry;` は記録しない。`entry …;` の後は、続く `then s;` を最初の遷移にするため、直前の要素を「entry」にする。
    ///
    /// # 引数
    ///
    /// - `n`：文の節（`STATE_SUBACTION_MEMBER` のときだけ働く）
    /// - `pe`：文を含む、いちばん近い宣言の番号
    /// - `h`：文の頭（修飾を外し、空白をまとめたもの。`entry action init` など）
    ///
    /// # 戻り値
    ///
    /// 状態の本体の振る舞いの文として読んだら `true`。ほかの文や、状態の本体の外なら `false`（何もしない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "state def S { entry action init; }" の entry の文（S が 0 番）
    /// state_subaction(…, Some(0), "entry action init") → true（S の state_actions に { kind: "entry", text: "action init" }）
    /// state_subaction(…, Some(0), "entry")              → true（記録しないが、直前の要素を「entry」にする）
    /// state_subaction(…, None, "do a")                 → false
    /// ```
    fn state_subaction(&mut self, n: &SyntaxNode, pe: Option<usize>, h: &str) -> bool {
        let (Some(pe), STATE_SUBACTION_MEMBER) = (pe, n.kind()) else {
            return false;
        };
        if !self.in_state(Some(pe)) {
            return false;
        }
        let Some(kind) = ["entry", "do", "exit"]
            .into_iter()
            .find(|k| has_keyword(n, k))
        else {
            return false;
        };
        let text = h.strip_prefix(kind).unwrap_or(h).trim();
        if !text.is_empty() {
            self.out.entries[pe].state_actions.push(StateAction {
                kind,
                text: text.to_owned(),
            });
        }
        if kind == "entry"
            && let Some(top) = self.prev.last_mut()
        {
            *top = Some(Prev {
                entry: None,
                name: String::new(),
                initial: true,
            });
        }
        true
    }

    /// 本体の中の、直前のアクションの流れの要素（継起の元）。無ければ、名前も番号も無い元。
    ///
    /// # 戻り値
    ///
    /// 今の本体で直前に書いた要素。まだ無ければ `Prev { entry: None, name: "", initial: false }`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "action a; then b;" の then b; を読むとき
    /// current_prev() → Prev { entry: Some(a の番号), name: "a" }
    /// // 本体の最初の "then b;" を読むとき
    /// current_prev() → Prev { entry: None, name: "" }
    /// ```
    fn current_prev(&self) -> Prev {
        self.prev.last().cloned().flatten().unwrap_or(Prev {
            entry: None,
            name: String::new(),
            initial: false,
        })
    }

    /// アクションの流れの要素（`action b;`・`fork f;` など）とイベント（`event occurrence e;`）を読んだ後の処理。
    /// `then` で始まる要素（`then action b;`・`then event occurrence e;`、SourceSuccessionMember、8.2.2.9.3・8.2.2.17）なら、直前の要素からこの要素への継起を関係にし（範囲は `then` と後ろの空白だけ）、
    /// この要素を、続く継起の元にする。
    ///
    /// # 引数
    ///
    /// - `n`：要素の文の節
    /// - `pe`：文を含む、いちばん近い宣言の番号
    /// - `idx`：要素の宣言の番号
    /// - `name`：要素の名前（名前の無い要素は空）
    fn flow_node(&mut self, n: &SyntaxNode, pe: Option<usize>, idx: usize, name: String) {
        let mut ts = tokens(n);
        if let (Some(then), Some(next)) = (ts.next(), ts.next())
            && then.kind() == KEYWORD
            && then.text() == "then"
        {
            let source = self.current_prev();
            let from: usize = then.text_range().start().into();
            let to: usize = next.text_range().start().into();
            self.out.rels.push(Rel {
                kind: RelKind::Succession {
                    a: source.name,
                    b: name.clone(),
                    a_entry: source.entry,
                    b_entry: Some(idx),
                    guard: String::new(),
                    name: String::new(),
                },
                pe,
                start: self.utf16(from),
                // 関係の範囲の終わり（end + 1 が、消す範囲の終わり）は、次のトークンの手前
                end: self.utf16(to).saturating_sub(1),
            });
        }
        if let Some(top) = self.prev.last_mut() {
            *top = Some(Prev {
                entry: Some(idx),
                name,
                initial: false,
            });
        }
    }

    /// 宣言の特殊化・部分集合・再定義・参照・交差（8.2.2.6）を、相手ごとに書いた順に集める。
    ///
    /// 定義の `:>`・`specializes` は `specializes`、使用の `:>`・`specializes`・`subsets` は `subsets`、
    /// `:>>`・`redefines` は `redefines`、`::>`・`references` は `references`、`=>`・`crosses` は `crosses` にする。
    ///
    /// # 引数
    ///
    /// - `n`：宣言の節
    /// - `is_def`：定義か
    ///
    /// # 戻り値
    ///
    /// 相手ごとの `Spec`（範囲は UTF-16）。関係が無ければ空。
    ///
    /// # 例
    ///
    /// ```text
    /// specs("part def B :> A, Q::C;", true) → [specializes A（範囲は "A, "）, specializes Q::C（範囲は ", Q::C"）]
    /// specs("part b : B :> a;", false)      → [subsets a（範囲 " :> a"）]
    /// specs("end part w : A => q.r;", false) → [crosses q.r（範囲 " => q.r"）]
    /// specs("part c : C;", false)           → []
    /// ```
    fn specs(&self, n: &SyntaxNode, is_def: bool) -> Vec<Spec> {
        let mut out = Vec::new();
        for rel in n.children() {
            let op = match rel.kind() {
                SUBCLASSIFICATION if is_def => "specializes",
                SUBCLASSIFICATION | SUBSETTING => "subsets",
                REDEFINITION => "redefines",
                REFERENCE_SUBSETTING => "references",
                CROSS_SUBSETTING => "crosses",
                _ => continue,
            };
            let targets: Vec<SyntaxNode> = rel
                .children()
                .filter(|t| matches!(t.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
                .collect();
            for (i, t) in targets.iter().enumerate() {
                let (start, end) = removal_range(&rel, &targets, i);
                out.push(Spec {
                    op,
                    target: compact(t),
                    path: if t.kind() == QUALIFIED_NAME {
                        path_of(t)
                    } else {
                        compact(t)
                    },
                    start: self.utf16(start),
                    end: self.utf16(end),
                });
            }
        }
        out
    }

    /// 参照の形の `perform x.y;`・`exhibit s;`（PerformActionUsage・ExhibitStateUsage の OwnedReferenceSubsetting、8.2.2.17〜18）が
    /// 指す、既にあるアクション・状態。`::>` と同じ参照（`references`）の相手にする。
    ///
    /// # 引数
    ///
    /// - `n`：文の節
    ///
    /// # 戻り値
    ///
    /// 参照の相手（範囲は参照そのもの。UTF-16）。`perform action a : A;` のような宣言する形や、ほかの文なら `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// performed_reference("perform x.y;")        → Some(Spec { op: "references", target: "x.y", … })
    /// performed_reference("exhibit s;")          → Some(Spec { op: "references", target: "s", … })
    /// performed_reference("perform action a;")   → None
    /// ```
    fn performed_reference(&self, n: &SyntaxNode) -> Option<Spec> {
        if !matches!(n.kind(), PERFORM_ACTION_USAGE | EXHIBIT_STATE_USAGE) {
            return None;
        }
        let r = reference_form(n)?;
        let range = r.text_range();
        Some(Spec {
            op: "references",
            target: compact(&r),
            path: if r.kind() == QUALIFIED_NAME {
                path_of(&r)
            } else {
                compact(&r)
            },
            start: self.utf16(range.start().into()),
            end: self.utf16(range.end().into()),
        })
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
    /// - `key`・`val`：本体の文の名前と値の式（`metadata_body_assignment` の結果）
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

    /// コメント（Comment、8.2.2.4）を、種類 `comment` の宣言にする。`comment` か `locale` を書いたものだけを読み、
    /// キーワードの無い `/* … */` はこれまでどおり読み飛ばす（コードの注釈に使われることが多いため）。
    ///
    /// `about` が無ければ持ち主の宣言 `pe` を注釈する（ファイルの直下なら何も注釈しない）。あれば相手を読み終えてから
    /// 解決するよう `comment_abouts` に足す。
    ///
    /// # 引数
    ///
    /// - `n`：`COMMENT` の節
    /// - `owner`：コメントの持ち主（宣言か無名ブロックの番号）。ファイルの直下なら `None`
    /// - `pe`：コメントを含む、いちばん近い宣言の番号。無ければ `None`
    fn comment(&mut self, n: &SyntaxNode, owner: Option<Scope>, pe: Option<usize>) {
        let is_element = n.children_with_tokens().any(|e| {
            e.kind() == KEYWORD
                && e.as_token()
                    .is_some_and(|t| matches!(t.text(), "comment" | "locale"))
        });
        let body = n
            .children_with_tokens()
            .filter_map(|e| e.into_token())
            .find(|t| t.kind() == REGULAR_COMMENT);
        let (true, Some(body)) = (is_element, body) else {
            return;
        };
        let range = n.text_range();
        let (hs, be): (usize, usize) = (range.start().into(), body.text_range().start().into());
        let idx = self.out.entries.len();
        let parts = decl_parts(n, false);
        let about: Vec<String> = n
            .children()
            .filter(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
            .map(|c| compact(&c))
            .collect();
        let start = self.utf16(hs);
        let e = Entry {
            kind: "comment".to_owned(),
            is_def: false,
            short: parts.short,
            name: parts.name,
            conj: None,
            ty: String::new(),
            ty_path: String::new(),
            owner,
            pe,
            start,
            head_end: self.utf16(be),
            end: self.utf16(range.end().into()),
            head: self.head_text(hs, be),
            mods: None,
            dir: None,
            exprs: Vec::new(),
            children: Vec::new(),
            idx,
            value: None,
            value_op: None,
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
            specs: Vec::new(),
            multiplicity: None,
            body: Some(comment_body(body.text())),
            about: if about.is_empty() {
                pe.into_iter().collect()
            } else {
                Vec::new()
            },
            reps: Vec::new(),
            guard: None,
            state_actions: Vec::new(),
            parallel: false,
        };
        self.push_entry(e, pe);
        if !about.is_empty() {
            self.comment_abouts.push(CommentAbout {
                entry: idx,
                about,
                pe,
                pos: start,
            });
        }
    }

    /// `comment c about A, B` の相手を、文を書いた場所から解決し（`model` の名前の解決、修飾名と別名を含む）、
    /// 見つかった宣言の番号をコメントの `about` に書いた順で入れる。見つからない相手は `missing_comment_about` に足す。
    fn apply_comment_abouts(&mut self) {
        if self.comment_abouts.is_empty() {
            return;
        }
        let refs: Vec<(String, Option<usize>)> = self
            .comment_abouts
            .iter()
            .flat_map(|c| c.about.iter().map(|r| (r.clone(), c.pe)))
            .collect();
        let mut found = crate::model::resolve_refs(&self.out, &refs).into_iter();
        for c in std::mem::take(&mut self.comment_abouts) {
            for r in &c.about {
                match found.next().flatten() {
                    Some(i) => self.out.entries[c.entry].about.push(i),
                    None => self.out.missing_comment_about.push(MissingRef {
                        pos: c.pos,
                        name: r.clone(),
                    }),
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
            // `:>> baseType = … meta SysML::PartUsage;` は、メタデータの定義の参照の使用（名前 baseType）として読んである
            if let Some(kind) = self.out.entries[d]
                .children
                .iter()
                .map(|&c| &self.out.entries[c])
                .filter(|c| c.name == "baseType")
                .find_map(|c| c.value.as_deref().and_then(base_metaclass))
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
/// `include U`・`event e`（参照の形）は `"include use case"`・`"event occurrence"`、`connect a to b`（`connection` の無い接続）は
/// `"connection"`、`allocate x to y` は `"allocation"`、`bind a = b`・`binding bb bind a = b` は `"binding"`、
/// 種類のキーワードの無い `individual def H`・`individual h`（IndividualDefinition・IndividualUsage）は
/// `"occurrence def"`・`"occurrence"` にする。
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
/// entry_kind("connect a to b;", "connect a to b", "", false) → Some(("connection", false))
/// entry_kind("individual def E;", "def E", "individual", false) → Some(("occurrence def", true))
/// entry_kind("perform x.y;", "perform x.y", "", false)     → Some(("perform action", false))
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
        // `connect a to b;`（`connection` の無い ConnectionUsage、8.2.2.13.1）は名前の無い接続
        CONNECTION_USAGE if starts_with_word(h, "connect") => Some(("connection", false)),
        // `allocate x to y;`（`allocation` の無い AllocationUsage、8.2.2.15）は名前の無い割り当て
        ALLOCATION_USAGE if starts_with_word(h, "allocate") => Some(("allocation", false)),
        // `bind a = b;`・`binding bb bind a = b;`（BindingConnectorAsUsage、8.2.2.13.2）
        BINDING_CONNECTOR_AS_USAGE => Some(("binding", false)),
        OCCURRENCE_USAGE if starts_with_word(h, "event") => Some(("event occurrence", false)),
        // `perform x.y;`・`exhibit s;`（既にあるアクション・状態を指す形、8.2.2.17〜18）
        PERFORM_ACTION_USAGE if reference_form(n).is_some() => Some(("perform action", false)),
        EXHIBIT_STATE_USAGE if reference_form(n).is_some() => Some(("exhibit state", false)),
        // `individual def H;`・`individual h : H;`（IndividualDefinition・IndividualUsage、8.2.2.9）
        OCCURRENCE_DEFINITION if starts_with_word(h, "def") => Some(("occurrence def", true)),
        OCCURRENCE_USAGE if is_mod("individual") => Some(("occurrence", false)),
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

/// アクションの節（ActionNode、8.2.2.17）の、書いた語の種類。宣言の種類にする（`fork f;` は種類 `fork` の使用）。
///
/// 状態の中の省略形の遷移 `accept E then b;`（8.2.2.18）は、アクションの節にしない（遷移として読むまで、これまでどおり読み飛ばす）。
///
/// # 引数
///
/// - `n`：文の節
///
/// # 戻り値
///
/// `fork`・`join`・`merge`・`decide`・`send`・`accept`・`assign`・`terminate`・`if`・`while`・`loop`・`for` のどれか。
/// アクションの節でなければ `None`。
///
/// # 例
///
/// ```text
/// action_node_kind("decide d;")        → Some("decide")
/// action_node_kind("accept e : E;")    → Some("accept")
/// action_node_kind("loop { … }")       → Some("loop")
/// action_node_kind("accept Go then b;") → None   // 状態の中の省略形の遷移
/// action_node_kind("part p;")          → None
/// ```
fn action_node_kind(n: &SyntaxNode) -> Option<&'static str> {
    match n.kind() {
        FORK_NODE => Some("fork"),
        JOIN_NODE => Some("join"),
        MERGE_NODE => Some("merge"),
        DECISION_NODE => Some("decide"),
        SEND_NODE => Some("send"),
        ACCEPT_NODE if child(n, CONNECTOR_END).is_none() => Some("accept"),
        ASSIGNMENT_NODE => Some("assign"),
        TERMINATE_NODE => Some("terminate"),
        IF_NODE => Some("if"),
        WHILE_LOOP_NODE if has_keyword(n, "loop") => Some("loop"),
        WHILE_LOOP_NODE => Some("while"),
        FOR_LOOP_NODE => Some("for"),
        _ => None,
    }
}

/// 節の直下に、キーワード `kw` のトークンがあるか（孫より深くは見ない）。
///
/// # 引数
///
/// - `n`：節
/// - `kw`：探すキーワード
///
/// # 戻り値
///
/// 直下にあれば `true`。
///
/// # 例
///
/// ```text
/// has_keyword("loop { … }" の WHILE_LOOP_NODE, "loop")       → true
/// has_keyword("while x { loop { } }" の WHILE_LOOP_NODE, "loop") → false   // 本体の中は見ない
/// ```
fn has_keyword(n: &SyntaxNode, kw: &str) -> bool {
    n.children_with_tokens()
        .any(|e| e.kind() == KEYWORD && e.as_token().is_some_and(|t| t.text() == kw))
}

/// メタデータの定義の `:>> baseType = … meta SysML::PartUsage` の値から、基のメタクラスの名前を取り出す
/// （SemanticMetadata の baseType、8.2.2.27）。
///
/// # 引数
///
/// - `value`：`baseType` の値の式（空白をまとめたもの）
///
/// # 戻り値
///
/// `meta` の後ろの修飾名の最後の名前。`meta` が無ければ `None`。
///
/// # 例
///
/// ```text
/// base_metaclass("parts meta SysML::PartUsage") → Some("PartUsage")
/// base_metaclass("meta Usage")                  → Some("Usage")
/// base_metaclass("x")                           → None
/// ```
fn base_metaclass(value: &str) -> Option<&str> {
    let after = value
        .strip_prefix("meta ")
        .or_else(|| value.split_once(" meta ").map(|(_, a)| a))?;
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
/// type_of(": Q::Pt::'~Pt'") → Some({ name: "Pt", conj: true, path: "Q::Pt" })   // 共役のポートの定義
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
    if target.kind() != QUALIFIED_NAME {
        return Some(TypeRef {
            path: name.clone(),
            name,
            conj,
        });
    }
    let path = path_of(&target);
    // `Pt::'~Pt'` は、ポートの定義 Pt に含まれる共役のポートの定義（ConjugatedPortDefinition、8.2.2.12 の Note 1・2）。
    // `~Pt` と同じく、Pt を共役にした型として読む
    if let Some((owner, _)) = path.rsplit_once("::")
        && name.strip_prefix('~') == Some(last_segment(owner))
    {
        return Some(TypeRef {
            name: last_segment(owner).to_owned(),
            conj: true,
            path: owner.to_owned(),
        });
    }
    Some(TypeRef { name, conj, path })
}

/// 宣言の多重度（MultiplicityPart、8.2.2.6）。`[…]` の中と、`ordered`・`nonunique` を読む。
///
/// # 引数
///
/// - `n`：宣言の節
///
/// # 戻り値
///
/// 多重度。`[…]` も `ordered`・`nonunique` も無ければ `None`。
///
/// # 例
///
/// ```text
/// multiplicity("part w : W[0 .. 4] ordered;") → Some({ range: "0..4", ordered: true, nonunique: false })
/// multiplicity("part w : W nonunique;")       → Some({ range: "", ordered: false, nonunique: true })
/// multiplicity("part w : W;")                 → None
/// ```
fn multiplicity(n: &SyntaxNode) -> Option<Multiplicity> {
    let range = child(n, MULTIPLICITY).map(|m| {
        let t = compact(&m);
        let t = t.strip_prefix('[').unwrap_or(&t);
        t.strip_suffix(']').unwrap_or(t).to_owned()
    });
    let has_kw = |kw: &str| {
        n.children_with_tokens()
            .any(|e| e.kind() == KEYWORD && e.as_token().is_some_and(|t| t.text() == kw))
    };
    let (ordered, nonunique) = (has_kw("ordered"), has_kw("nonunique"));
    if range.is_none() && !ordered && !nonunique {
        return None;
    }
    Some(Multiplicity {
        range: range.unwrap_or_default(),
        ordered,
        nonunique,
    })
}

/// 値の書き方（FeatureValue、8.2.2.6）。式の前の記号とキーワードを、空白を 1 つにまとめて返す。
///
/// # 引数
///
/// - `v`：`FEATURE_VALUE` の節
///
/// # 戻り値
///
/// `:=`・`default`・`default =`・`default :=` のどれか。`=`（束縛）なら `None`。
///
/// # 例
///
/// ```text
/// value_op("= 10")          → None
/// value_op(":= 10")         → Some(":=")
/// value_op("default 10")    → Some("default")
/// value_op("default := 10") → Some("default :=")
/// ```
fn value_op(v: &SyntaxNode) -> Option<String> {
    let op = v
        .children_with_tokens()
        .take_while(|e| e.kind() != EXPRESSION)
        .filter_map(|e| e.into_token())
        .filter(|t| !t.kind().is_trivia())
        .map(|t| t.text().to_owned())
        .collect::<Vec<_>>()
        .join(" ");
    (op != "=").then_some(op)
}

/// 別の言語での表し方（`rep r language "x" /* … */`、TextualRepresentation、8.2.2.4）を読む。
///
/// # 引数
///
/// - `n`：`TEXTUAL_REPRESENTATION` の節
///
/// # 戻り値
///
/// 名前・言語の名前（引用符を外したもの）・本文。言語の名前か本文が欠けていれば `None`。
///
/// # 例
///
/// ```text
/// representation("rep r language \"OCL\" /* self.m > 0 */") → Some({ name: "r", language: "OCL", body: "self.m > 0" })
/// representation("language \"x\" /* a */")                   → Some({ name: "", language: "x", body: "a" })
/// representation("rep r language;")                         → None   // 言語の名前と本文が無い
/// ```
fn representation(n: &SyntaxNode) -> Option<Rep> {
    let token = |kind: SyntaxKind| {
        n.children_with_tokens()
            .filter_map(|e| e.into_token())
            .find(|t| t.kind() == kind)
    };
    let language = token(STRING)?;
    let body = token(REGULAR_COMMENT)?;
    let lang = language.text();
    let lang = lang.strip_prefix('"').unwrap_or(lang);
    Some(Rep {
        name: decl_parts(n, false).name,
        language: lang.strip_suffix('"').unwrap_or(lang).to_owned(),
        body: representation_body(body.text()),
    })
}

/// 関係の相手 1 つだけを消すときの範囲（バイトオフセット）。消した後も、関係の書き方が崩れないようにする。
///
/// 相手が 1 つなら関係全体と前の空白（` :> A`）、複数のうち最後でなければ次の相手の手前まで（`A, `）、
/// 最後なら前の相手の後ろから（`, C`）。
///
/// # 引数
///
/// - `rel`：関係の節（`SUBCLASSIFICATION` など）
/// - `targets`：関係の相手の節（書いた順。空でないこと）
/// - `i`：消す相手の番号（`targets` の添字）
///
/// # 戻り値
///
/// 消す範囲の始まりと終わり（`end` は含まない）。
///
/// # 例
///
/// ```text
/// // "part def B :> A, C;"
/// removal_range(:> A, C, [A, C], 0) → "A, " の範囲
/// removal_range(:> A, C, [A, C], 1) → ", C" の範囲
/// // "part def B :> A;"
/// removal_range(:> A, [A], 0)       → " :> A" の範囲
/// ```
fn removal_range(rel: &SyntaxNode, targets: &[SyntaxNode], i: usize) -> (usize, usize) {
    let start_of = |n: &SyntaxNode| -> usize { n.text_range().start().into() };
    let end_of = |n: &SyntaxNode| -> usize { n.text_range().end().into() };
    if let (Some(t), Some(next)) = (targets.get(i), targets.get(i + 1)) {
        return (start_of(t), start_of(next));
    }
    if let (Some(prev), Some(t)) = (
        i.checked_sub(1).and_then(|p| targets.get(p)),
        targets.get(i),
    ) {
        return (end_of(prev), end_of(t));
    }
    let space = rel
        .prev_sibling_or_token()
        .filter(|t| t.kind() == WHITESPACE)
        .map(|t| t.text_range().start().into());
    (space.unwrap_or_else(|| start_of(rel)), end_of(rel))
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

/// 合成形の表し方（`render rendering r :> asTreeDiagram { … }`、ViewRenderingUsage、8.2.2.26）が指す表し方の名前。
/// 特殊化・再定義・参照の最初の相手、無ければ自分の名前、それも無ければ型の名前（どれも最後の段）。
///
/// # 引数
///
/// - `e`：合成形の表し方の宣言（種類 `rendering`）
///
/// # 戻り値
///
/// 表し方の名前。名前も相手も型も無ければ空文字列。
///
/// # 例
///
/// ```text
/// rendering_reference("rendering r :> Views::asTreeDiagram") → "asTreeDiagram"
/// rendering_reference("rendering r : Foo")                   → "r"
/// rendering_reference("rendering : Foo")                     → "Foo"
/// rendering_reference("rendering")                           → ""
/// ```
fn rendering_reference(e: &Entry) -> String {
    let target = e.specs.first().map(|s| last_segment(&s.path).to_owned());
    target
        .or_else(|| (!e.name.is_empty()).then(|| e.name.clone()))
        .unwrap_or_else(|| last_segment(&e.ty).to_owned())
}

/// 既にある要素を指す形（OwnedReferenceSubsetting。`perform x.y;`・`exhibit s;`・`frame c;`、8.2.2.17・8.2.2.18・8.2.2.21）の参照。
/// 頭のキーワード（`perform`・`exhibit`・`frame`）の直後に参照が続くときだけ、その参照を返す。
///
/// # 引数
///
/// - `n`：文の節
///
/// # 戻り値
///
/// 頭のキーワードの直後の `QUALIFIED_NAME`・`FEATURE_CHAIN` の節。直後が種類のキーワード（`perform action a`）や
/// ほかの語（`perform use case u`）なら `None`。
///
/// # 例
///
/// ```text
/// reference_form("perform x.y;")            → Some(FEATURE_CHAIN(x.y))
/// reference_form("private exhibit s;")      → Some(QUALIFIED_NAME(s))
/// reference_form("perform action a : A;")   → None
/// reference_form("perform use case u : U;") → None
/// ```
fn reference_form(n: &SyntaxNode) -> Option<SyntaxNode> {
    let mut after_head = false;
    for e in n.children_with_tokens() {
        match e {
            rowan::NodeOrToken::Token(t) if t.kind().is_trivia() || t.kind() == REGULAR_COMMENT => {
            }
            rowan::NodeOrToken::Token(t)
                if t.kind() == KEYWORD && matches!(t.text(), "perform" | "exhibit" | "frame") =>
            {
                after_head = true;
            }
            rowan::NodeOrToken::Node(c)
                if after_head && matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN) =>
            {
                return Some(c);
            }
            _ if after_head => return None,
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

/// 接続の端を持つ使用（接続・インタフェース・割り当て・結び付け）の、端の間の関係。
///
/// # 引数
///
/// - `kind`：使用の節の種類
/// - `ends`：端の参照（`connector_ends` の結果。書いた順）
/// - `ty`：使用の型の名前（接続の線のラベル。無ければ空）
/// - `usage`：使用の宣言の番号
///
/// # 戻り値
///
/// 接続・インタフェースで端が 2 つ以上なら `Connect`、割り当てで端が 2 つなら `Allocate`、結び付けで端が 2 つなら `Bind`。
/// それ以外（n 項の割り当てを含む）は `None`。
///
/// # 例
///
/// ```text
/// connector_relation(CONNECTION_USAGE, ["a", "b", "c"], "C", 3) → Some(Connect { a: "a", b: "b", ends: [a, b, c], item: "C", usage: 3 })
/// connector_relation(BINDING_CONNECTOR_AS_USAGE, ["x", "y"], "", 4) → Some(Bind { a: "x", b: "y", usage: 4 })
/// connector_relation(ALLOCATION_USAGE, ["f", "c"], "AD", 5)        → Some(Allocate { a: "f", b: "c", usage: 5 })
/// connector_relation(CONNECTION_USAGE, ["a"], "", 3)            → None   // 端が足りない
/// connector_relation(PART_USAGE, [], "", 0)                     → None
/// ```
fn connector_relation(
    kind: SyntaxKind,
    ends: Vec<String>,
    ty: &str,
    usage: usize,
) -> Option<RelKind> {
    match (kind, ends.as_slice()) {
        (CONNECTION_USAGE | INTERFACE_USAGE, [a, b, ..]) => Some(RelKind::Connect {
            a: a.clone(),
            b: b.clone(),
            item: ty.to_owned(),
            usage,
            ends: ends.clone(),
        }),
        (ALLOCATION_USAGE, [a, b]) => Some(RelKind::Allocate {
            a: a.clone(),
            b: b.clone(),
            usage,
        }),
        (BINDING_CONNECTOR_AS_USAGE, [a, b]) => Some(RelKind::Bind {
            a: a.clone(),
            b: b.clone(),
            usage,
        }),
        _ => None,
    }
}

/// 接続の端（`CONNECTOR_END`、8.2.2.13.1）の参照を、書いた順に集める。
///
/// 端の名前（`e ::> a.p` の `e`）と多重度は除き、参照だけを空白を除いた文字列にする。
///
/// # 引数
///
/// - `n`：文の節（`connect`・`bind`・`allocate` を含む宣言）
///
/// # 戻り値
///
/// 端の参照の一覧。端が無ければ空。
///
/// # 例
///
/// ```text
/// connector_ends("connect (a.p, b, [1] e ::> c.r);") → ["a.p", "b", "c.r"]
/// connector_ends("bind x = y.z;")                     → ["x", "y.z"]
/// connector_ends("part a;")                           → []
/// ```
fn connector_ends(n: &SyntaxNode) -> Vec<String> {
    n.children()
        .filter(|c| c.kind() == CONNECTOR_END)
        .filter_map(|end| {
            end.children()
                .filter(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
                .last()
                .map(|c| compact(&c))
        })
        .collect()
}

/// 関係を表す文（メッセージ・満たす・検証する・扱う・流れ・順序付きの流れ）。依存は `dependencies` で、遷移は `Ctx::transition` で読む。
///
/// 流れと順序付きの流れは、名前の無いものだけを関係にする（名前付きのものは宣言を作るときに関係にする）。
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
/// relation("satisfy requirement s : R by A;", …) → Some(Satisfy { req: "R", by: "A", negated: false })
/// relation("verify requirement R;", …)           → Some(Verify { req: "R" })  // 型の無い宣言する形は書いた名前
/// relation("succession flow of W from a.o to b.i;", …) → Some(SuccessionFlow { item: "W", a: "a.o", b: "b.i", … })
/// relation("part a;", "part a")                  → None
/// ```
fn relation(n: &SyntaxNode, h: &str) -> Option<RelKind> {
    let name = || child(n, NAME).map(|c| unquote(&compact(&c)).to_owned());
    match n.kind() {
        MESSAGE_USAGE => {
            let (a, b) = flow_end_refs(n)?;
            Some(RelKind::Message {
                name: name().unwrap_or_default(),
                item: payload_type(n),
                a,
                b,
            })
        }
        // `satisfy R by X`・`satisfy R;`（持ち主が満たす）・`assert satisfy`・`not satisfy`・
        // `satisfy requirement r : R by X;`（宣言する形。満たすのは型の R）（8.2.2.21）
        SATISFY_REQUIREMENT_USAGE
            if ["satisfy", "assert", "not"]
                .iter()
                .any(|w| starts_with_word(h, w)) =>
        {
            let req = if has_keyword(n, "requirement") {
                declared_requirement(n)
            } else {
                n.children()
                    .find(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
                    .map(|c| compact(&c))?
            };
            let negated = n
                .children_with_tokens()
                .any(|e| e.kind() == KEYWORD && e.as_token().is_some_and(|t| t.text() == "not"));
            Some(RelKind::Satisfy {
                req,
                by: ref_after(n, "by").unwrap_or_default(),
                negated,
            })
        }
        // `verify R;`・`verify requirement r : R;`（宣言する形。検証するのは型の R）（8.2.2.24）
        REQUIREMENT_VERIFICATION_USAGE => Some(RelKind::Verify {
            req: if has_keyword(n, "requirement") {
                declared_requirement(n)
            } else {
                first_ref(n)?
            },
        }),
        // `frame cu;`（既にある関心事を指す形、FramedConcernMember の OwnedReferenceSubsetting、8.2.2.21）
        FRAMED_CONCERN_USAGE if reference_form(n).is_some() => {
            let r = reference_form(n)?;
            let reference = compact(&r);
            Some(RelKind::Frame {
                name: unquote(last_segment(
                    reference.rsplit('.').next().unwrap_or(&reference),
                ))
                .to_owned(),
                ty: reference.clone(),
                path: if r.kind() == QUALIFIED_NAME {
                    path_of(&r)
                } else {
                    reference
                },
            })
        }
        FRAMED_CONCERN_USAGE => {
            let t = child(n, FEATURE_TYPING).and_then(|c| type_of(&c))?;
            Some(RelKind::Frame {
                name: name()?,
                ty: t.name,
                path: t.path,
            })
        }
        FLOW_USAGE if child(n, NAME).is_none() => flow_ends(n, String::new(), String::new(), None),
        SUCCESSION_FLOW_USAGE if child(n, NAME).is_none() => {
            succession_flow_ends(n, String::new(), String::new(), None)
        }
        _ => None,
    }
}

/// 宣言する形の `satisfy requirement r : R …`・`verify requirement r : R;`（SatisfyRequirementUsage・
/// RequirementVerificationUsage の 'requirement' UsageDeclaration、8.2.2.21・8.2.2.24）が満たす・検証する要求。
/// 新しい要求の使用 `r` の型（無ければ特殊化・部分集合・再定義・参照の最初の相手）にする。
/// 型も相手も無い `satisfy requirement R by X;` は、これまでどおり（モックとも同じく）書いた名前の要求を指すとみなす。
///
/// # 引数
///
/// - `n`：`SATISFY_REQUIREMENT_USAGE`・`REQUIREMENT_VERIFICATION_USAGE` の節（`requirement` を書いたもの）
///
/// # 戻り値
///
/// 要求の参照（空白を除いたもの）。型も相手も名前も無ければ空文字列（満たす・検証するのは、新しい要求の使用そのもの）。
///
/// # 例
///
/// ```text
/// declared_requirement("satisfy requirement sr : Q::R by v;") → "Q::R"
/// declared_requirement("verify requirement r2 :> r1;")        → "r1"
/// declared_requirement("verify requirement SpeedReq;")        → "SpeedReq"   // 型も相手も無い
/// declared_requirement("verify requirement;")                 → ""
/// ```
fn declared_requirement(n: &SyntaxNode) -> String {
    n.children()
        .filter(|c| {
            matches!(
                c.kind(),
                FEATURE_TYPING | SUBSETTING | REDEFINITION | REFERENCE_SUBSETTING
            )
        })
        .min_by_key(|c| c.kind() != FEATURE_TYPING)
        .and_then(|rel| {
            rel.children()
                .find(|t| matches!(t.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
        })
        .map(|t| compact(&t))
        .or_else(|| child(n, NAME).map(|c| unquote(&compact(&c)).to_owned()))
        .unwrap_or_default()
}

/// フロー（`flow of I from a to b`、FlowUsage、8.2.2.16）の流れの関係。
///
/// # 引数
///
/// - `n`：`FLOW_USAGE` の節
/// - `name`：フローの名前（名前の無いフローは空）
/// - `ty`：フローの型の名前（無ければ空）
/// - `usage`：名前付きのフローの宣言の番号（名前の無いフローは `None`）
///
/// # 戻り値
///
/// 流れの関係（アイテムは `of` の後の型の最後の名前）。`from`・`to` の後の参照が無ければ `None`。
///
/// # 例
///
/// ```text
/// flow_ends("flow of Heat from h.o to w.i;", "", "", None) → Some(Flow { item: "Heat", a: "h.o", b: "w.i", … })
/// flow_ends("flow f : FD from a to b;", "f", "FD", Some(3)) → Some(Flow { item: "", a: "a", b: "b", name: "f", ty: "FD", usage: Some(3) })
/// flow_ends("flow h.o to w.i;", "", "", None)               → Some(Flow { item: "", a: "h.o", b: "w.i", … })   // from を省いた形
/// flow_ends("flow f : FD;", "f", "FD", Some(3))             → None
/// ```
fn flow_ends(n: &SyntaxNode, name: String, ty: String, usage: Option<usize>) -> Option<RelKind> {
    let (a, b) = flow_end_refs(n)?;
    Some(RelKind::Flow {
        item: payload_type(n),
        a,
        b,
        name,
        ty,
        usage,
    })
}

/// フロー・順序付きの流れ・メッセージの 2 つの端（FlowDeclaration・MessageDeclaration、8.2.2.16）。
/// `from a to b` の形と、`from` を省いた `a to b` の形（FlowEndMember 'to' FlowEndMember・MessageEventMember 'to' MessageEventMember）を読む。
///
/// # 引数
///
/// - `n`：`FLOW_USAGE`・`SUCCESSION_FLOW_USAGE`・`MESSAGE_USAGE` の節
///
/// # 戻り値
///
/// （元の参照, 先の参照）。空白を除いて書いたとおり。`to` の前後の参照が無ければ `None`。
///
/// # 例
///
/// ```text
/// flow_end_refs("flow of W from h.o to w.i;") → Some(("h.o", "w.i"))
/// flow_end_refs("flow h.o to w.i;")           → Some(("h.o", "w.i"))
/// flow_end_refs("message a to b;")            → Some(("a", "b"))
/// flow_end_refs("flow f : FD;")               → None
/// ```
fn flow_end_refs(n: &SyntaxNode) -> Option<(String, String)> {
    let b = ref_after(n, "to")?;
    if let Some(a) = ref_after(n, "from") {
        return Some((a, b));
    }
    // `from` を省いた形：`to` の直前の参照が元
    let mut before = None;
    for e in n.children_with_tokens() {
        match e {
            rowan::NodeOrToken::Token(t) if t.kind() == KEYWORD && t.text() == "to" => break,
            rowan::NodeOrToken::Node(c) if matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN) => {
                before = Some(compact(&c));
            }
            _ => {}
        }
    }
    Some((before?, b))
}

/// 順序付きの流れ（`succession flow of I from a to b`、SuccessionFlowUsage、8.2.2.16）の関係。
///
/// # 引数
///
/// - `n`：`SUCCESSION_FLOW_USAGE` の節
/// - `name`：名前（名前の無いものは空）
/// - `ty`：型の名前（無ければ空）
/// - `usage`：名前付きのものの宣言の番号（名前の無いものは `None`）
///
/// # 戻り値
///
/// 順序付きの流れの関係（アイテムは `of` の後の型の最後の名前）。`from`・`to` の後の参照が無ければ `None`。
///
/// # 例
///
/// ```text
/// succession_flow_ends("succession flow of W from a.o to b.i;", "", "", None) → Some(SuccessionFlow { item: "W", a: "a.o", b: "b.i", … })
/// succession_flow_ends("succession flow f;", "f", "", Some(3))               → None
/// ```
fn succession_flow_ends(
    n: &SyntaxNode,
    name: String,
    ty: String,
    usage: Option<usize>,
) -> Option<RelKind> {
    let RelKind::Flow { item, a, b, .. } = flow_ends(n, String::new(), String::new(), None)? else {
        return None;
    };
    Some(RelKind::SuccessionFlow {
        item,
        a,
        b,
        name,
        ty,
        usage,
    })
}

/// `flow`・`message` の流れるもの（`of` の後、FlowPayloadFeature、8.2.2.16）の型の最後の名前。
/// `of ff : Fuel` は型 `Fuel`（`ff` は流れるものの名前）、`of Fuel` は `Fuel` にする。
///
/// # 引数
///
/// - `n`：`FLOW_USAGE`・`SUCCESSION_FLOW_USAGE`・`MESSAGE_USAGE` の節
///
/// # 戻り値
///
/// 型の最後の名前（型付けの相手は引用符を外し、型だけの `of 'A'` はこれまでどおり書いたまま）。`of` が無いか、型が無ければ空文字列。
///
/// # 例
///
/// ```text
/// payload_type("flow of ff : Q::Fuel from a to b;") → "Fuel"
/// payload_type("flow of Fuel from a to b;")         → "Fuel"
/// payload_type("flow from a to b;")                 → ""
/// ```
fn payload_type(n: &SyntaxNode) -> String {
    let Some(payload) = child(n, FLOW_PAYLOAD_FEATURE) else {
        return String::new();
    };
    if let Some(t) = child(&payload, FEATURE_TYPING).and_then(|t| type_of(&t)) {
        return t.name;
    }
    payload
        .children()
        .find(|c| matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN))
        .map(|c| last_segment(&compact(&c)).to_owned())
        .unwrap_or_default()
}

/// 依存（Dependency、8.2.2.3）を、依存する側とされる側の組ごとの関係にする。
///
/// 前置メタデータが `#derivation` なら導出、それ以外（メタデータが無いものを含む）は依存にする。
///
/// # 引数
///
/// - `n`：`DEPENDENCY` の節
///
/// # 戻り値
///
/// 組ごとの関係（依存する側の順、その中でされる側の順）。どちらかの側が無ければ空。
///
/// # 例
///
/// ```text
/// dependencies("dependency A, B to C;")              → [Dependency { a: "A", b: "C" }, Dependency { a: "B", b: "C" }]
/// dependencies("#trace dependency d from A to B;")   → [Dependency { a: "A", b: "B", name: "d", meta: "trace" }]
/// dependencies("#derivation dependency from B to A;") → [Derive { a: "B", b: "A" }]
/// dependencies("dependency from A;")                 → []（される側が無い）
/// ```
fn dependencies(n: &SyntaxNode) -> Vec<RelKind> {
    let meta = child(n, PREFIX_METADATA)
        .and_then(|pm| tokens(&pm).find(|t| matches!(t.kind(), IDENT | QUOTED_NAME)))
        .map(|t| unquote(t.text()).to_owned())
        .unwrap_or_default();
    let name = child(n, NAME)
        .map(|c| unquote(&compact(&c)).to_owned())
        .unwrap_or_default();
    let (mut clients, mut suppliers) = (Vec::new(), Vec::new());
    let mut after_to = false;
    for e in n.children_with_tokens() {
        match e {
            rowan::NodeOrToken::Token(t) if t.kind() == KEYWORD && t.text() == "to" => {
                after_to = true;
            }
            rowan::NodeOrToken::Node(c) if matches!(c.kind(), QUALIFIED_NAME | FEATURE_CHAIN) => {
                if after_to {
                    suppliers.push(compact(&c));
                } else {
                    clients.push(compact(&c));
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    for a in &clients {
        for b in &suppliers {
            let (a, b) = (a.clone(), b.clone());
            out.push(if meta == "derivation" {
                RelKind::Derive { a, b }
            } else {
                RelKind::Dependency {
                    a,
                    b,
                    name: name.clone(),
                    meta: meta.clone(),
                }
            });
        }
    }
    out
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
