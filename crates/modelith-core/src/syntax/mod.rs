//! SysML v2 のテキストを、ロスレスな構文木（CST）にする（ADR-0015）。
//!
//! 字句解析（`lexer`）→ 再帰下降（`grammar`、イベントを出す）→ 木の組み立て（この層、`rowan`）の順に進む。
//! 木の文字列は入力と 1 文字も違わず、どんな入力でも panic しない。

mod grammar;
mod kind;
mod lexer;
mod parser;

pub use kind::{KEYWORDS, SyntaxKind, is_kerml_keyword, is_keyword};

pub use lexer::{Token, tokenize};
use parser::{ErrorAt, Event, Input, Parser};
use rowan::{GreenNode, GreenNodeBuilder};

/// `rowan` に渡す言語の印。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SysmlLanguage {}

impl rowan::Language for SysmlLanguage {
    type Kind = SyntaxKind;

    fn kind_from_raw(raw: rowan::SyntaxKind) -> SyntaxKind {
        SyntaxKind::from_raw(raw.0)
    }

    fn kind_to_raw(kind: SyntaxKind) -> rowan::SyntaxKind {
        kind.into()
    }
}

pub type SyntaxNode = rowan::SyntaxNode<SysmlLanguage>;
pub type SyntaxToken = rowan::SyntaxToken<SysmlLanguage>;
pub type SyntaxElement = rowan::SyntaxElement<SysmlLanguage>;

/// 構文のエラー（位置はバイトオフセット）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntaxError {
    pub offset: usize,
    pub message: String,
}

/// 解析の結果。
#[derive(Debug, Clone)]
pub struct Parse {
    green: GreenNode,
    errors: Vec<SyntaxError>,
    /// コメントと注記の範囲（バイト）。
    comments: Vec<(usize, usize)>,
}

impl Parse {
    /// 構文木の根（`SOURCE_FILE`）。呼ぶたびに緑の木から新しい根を作る（安価）。
    ///
    /// # 戻り値
    ///
    /// 種類が `SOURCE_FILE` の節。その文字列は解析した入力と 1 文字も違わない。
    ///
    /// # 例
    ///
    /// ```text
    /// parse("package P;").syntax().kind()           → SOURCE_FILE
    /// parse("").syntax().text()                     → ""（空の入力も根だけの木になる）
    /// ```
    pub fn syntax(&self) -> SyntaxNode {
        SyntaxNode::new_root(self.green.clone())
    }

    /// 字句と構文のエラー（位置の順）。
    ///
    /// # 戻り値
    ///
    /// エラーの一覧（位置はバイトオフセット、昇順）。エラーが無ければ空。
    ///
    /// # 例
    ///
    /// ```text
    /// parse("part def A { doc }").errors()  → [{ offset: 17, message: "本文（/* … */）がありません" }]
    /// parse("part a : T;").errors()         → []
    /// ```
    pub fn errors(&self) -> &[SyntaxError] {
        &self.errors
    }

    /// コメント（`/* */`）と注記（`//`・`//* */`）の範囲（バイト、位置の順）。
    ///
    /// 宣言の途中にあって構文木の要素にしなかったコメントも含む。
    ///
    /// # 戻り値
    ///
    /// `(始まり, 終わり)` の組の一覧（バイトオフセット。終わりは含まない）。無ければ空。
    ///
    /// # 例
    ///
    /// ```text
    /// parse("// a\n//* b */ /* c */").comments() → [(0, 4), (5, 13), (14, 21)]
    /// parse("part a;").comments()                 → []
    /// ```
    pub fn comments(&self) -> &[(usize, usize)] {
        &self.comments
    }

    /// 木を、節と位置の入れ子の文字列にする（テストと調査用）。
    ///
    /// # 戻り値
    ///
    /// 1 行に 1 つの節またはトークンを `種類@始まり..終わり` の形で書き、入れ子を字下げで表した文字列
    /// （位置はバイト）。
    ///
    /// # 例
    ///
    /// ```text
    /// parse("part a;").debug_tree() →
    ///   SOURCE_FILE@0..7
    ///     PART_USAGE@0..7
    ///       KEYWORD@0..4 "part"
    ///       …
    /// ```
    pub fn debug_tree(&self) -> String {
        format!("{:#?}", self.syntax())
    }
}

/// テキストを解析する。どんな入力でも panic せず、木の文字列は入力と 1 文字も違わない（ロスレス）。
///
/// 字句解析（KerML 8.2.2.1）→ 再帰下降（`grammar`）→ `rowan` の木の組み立ての順に進む。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体（空でもよい）
///
/// # 戻り値
///
/// 構文木・エラー（バイトオフセットの順）・コメントの範囲をまとめた `Parse`。
/// 書き誤りがあっても失敗せず、エラーを `errors()` に入れて返す。
///
/// # 例
///
/// ```text
/// parse("part a : T;").errors()                → []
/// parse("part def A { doc }").errors()         → [(17, "本文（/* … */）がありません")]
/// parse("package P {\n  part def A {\n").errors()
///   → [(0, "「P」のブロックが閉じていません"), (14, "「A」のブロックが閉じていません")]
/// ```
pub fn parse(text: &str) -> Parse {
    let (tokens, lex_errors) = lexer::tokenize(text);
    let starts: Vec<usize> = tokens
        .iter()
        .scan(0, |at, t| {
            let start = *at;
            *at += t.len;
            Some(start)
        })
        .collect();
    let significant = significant_tokens(text, &tokens, &starts);
    let input = significant
        .iter()
        .enumerate()
        .map(|(i, &raw)| {
            let start = starts[raw];
            let prev_end = i
                .checked_sub(1)
                .map_or(0, |j| starts[significant[j]] + tokens[significant[j]].len);
            Input {
                kind: tokens[raw].kind,
                text: &text[start..start + tokens[raw].len],
                newline_before: text[prev_end..start].contains('\n'),
            }
        })
        .collect();
    let mut p = Parser::new(input);
    grammar::source_file(&mut p);
    let events = p.finish();

    let mut errors: Vec<SyntaxError> = lex_errors
        .into_iter()
        .map(|e| SyntaxError {
            offset: e.offset,
            message: e.message,
        })
        .collect();
    let green = Builder {
        text,
        tokens: &tokens,
        starts: &starts,
        significant: &significant,
        raw: 0,
    }
    .build(events, &mut errors);
    errors.sort_by_key(|e| e.offset);
    let comments = tokens
        .iter()
        .zip(&starts)
        .filter(|(t, _)| {
            matches!(
                t.kind,
                SyntaxKind::REGULAR_COMMENT | SyntaxKind::LINE_NOTE | SyntaxKind::BLOCK_NOTE
            )
        })
        .map(|(t, &s)| (s, s + t.len))
        .collect();
    Parse {
        green,
        errors,
        comments,
    }
}

/// パーサに渡すトークン（生のトークンの番号）。空白と注記は除く。
///
/// `/* … */`（REGULAR_COMMENT）は、要素として書かれたもの（文の頭にあるもの、`doc`・`comment` の本文、
/// `rep`・`language` の言語の名前の直後にある本文）だけを渡し、
/// 宣言の途中にあるものは読み飛ばす（KerML 8.2.2.1・8.2.3.3.2）。
///
/// # 引数
///
/// - `text`：解析するテキスト全体
/// - `tokens`：`tokenize(text)` のトークン（空白・注記を含む、すべて）
/// - `starts`：`tokens` の各トークンの始まり（バイトオフセット。`tokens` と同じ長さ）
///
/// # 戻り値
///
/// パーサに渡すトークンの、`tokens` の中での番号（昇順）。
///
/// # 例
///
/// ```text
/// // トークン: part / 空白 / コメント / 空白 / a / ;
/// significant_tokens("part /* x */ a;", …) → [0, 4, 5]     // 宣言の途中のコメントは除く
/// // トークン: コメント / 空白 / part / 空白 / a / ;
/// significant_tokens("/* x */ part a;", …) → [0, 2, 4, 5]  // 文の頭のコメントは残す
/// // トークン: language / 空白 / "x" / 空白 / コメント
/// significant_tokens("language \"x\" /* b */", …) → [0, 2, 4]  // 表し方の本文は残す
/// significant_tokens("", …)               → []
/// ```
fn significant_tokens(text: &str, tokens: &[Token], starts: &[usize]) -> Vec<usize> {
    let mut out = Vec::with_capacity(tokens.len());
    // 今の文の最初のトークン（文の区切りの直後は None）
    let mut first: Option<&str> = None;
    // 直前に渡したトークンの種類
    let mut previous: Option<SyntaxKind> = None;
    for (i, t) in tokens.iter().enumerate() {
        if t.kind.is_trivia() {
            continue;
        }
        let s = &text[starts[i]..starts[i] + t.len];
        if t.kind == SyntaxKind::REGULAR_COMMENT {
            // `rep r language "x" /* … */` の本文は、言語の名前の直後のコメント（TextualRepresentation、8.2.2.4）
            let is_rep_body =
                matches!(first, Some("rep" | "language")) && previous == Some(SyntaxKind::STRING);
            if matches!(first, None | Some("doc" | "comment")) || is_rep_body {
                out.push(i);
                previous = Some(t.kind);
                first = None;
            }
            continue;
        }
        out.push(i);
        previous = Some(t.kind);
        if first.is_none() {
            first = Some(s);
        }
        if matches!(
            t.kind,
            SyntaxKind::SEMI | SyntaxKind::L_BRACE | SyntaxKind::R_BRACE
        ) {
            first = None;
        }
    }
    out
}

/// イベントから `rowan` の木を組む。空白・注記・読み飛ばしたコメントは、次のトークンの前に入れる。
struct Builder<'a> {
    text: &'a str,
    tokens: &'a [Token],
    starts: &'a [usize],
    significant: &'a [usize],
    /// 次に木へ入れる生のトークン。
    raw: usize,
}

impl Builder<'_> {
    /// パーサのイベントを順に読み、`rowan` の緑の木を組む。
    ///
    /// 意味のあるトークンの前にある空白・注記・読み飛ばしたコメントは、その位置の節に入れ、
    /// 根を閉じるときに残りをすべて入れる（ロスレス）。エラーのイベントは位置をバイトにして `errors` に足す。
    ///
    /// # 引数
    ///
    /// - `events`：`Parser::finish` が返したイベント（`Start` と `Finish` が対応している）
    /// - `errors`：構文のエラーを足す先（字句のエラーが既に入っていてよい。並べ替えはしない）
    ///
    /// # 戻り値
    ///
    /// 根（`SOURCE_FILE`）の緑の節。その文字列は元のテキストと等しい。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part a;" のイベント [Start(SOURCE_FILE), Start(PART_USAGE), Token, …, Finish, Finish]
    /// build(events, &mut errors) → SOURCE_FILE@0..7 { PART_USAGE@0..7 { … } }、errors は変わらない
    /// // Error { at: Start(9), … } があり、意味のあるトークンが 9 個未満
    /// build(events, &mut errors) → errors に offset = テキストの長さ のエラーが足される
    /// ```
    fn build(mut self, events: Vec<Event>, errors: &mut Vec<SyntaxError>) -> GreenNode {
        let mut b = GreenNodeBuilder::new();
        let mut next = 0; // 次の（意味のある）トークン
        let mut depth = 0usize;
        for event in events {
            match event {
                Event::Start { kind } => {
                    if depth > 0 {
                        // 節の前の空白は親に入れる
                        let until = self
                            .significant
                            .get(next)
                            .copied()
                            .unwrap_or(self.tokens.len());
                        self.push_raw_until(&mut b, until);
                    }
                    b.start_node(kind.into());
                    depth += 1;
                }
                Event::Token => {
                    if let Some(&raw) = self.significant.get(next) {
                        self.push_raw_until(&mut b, raw + 1);
                        next += 1;
                    }
                }
                Event::Finish => {
                    if depth == 1 {
                        self.push_raw_until(&mut b, self.tokens.len());
                    }
                    b.finish_node();
                    depth = depth.saturating_sub(1);
                }
                Event::Error { at, message } => errors.push(SyntaxError {
                    offset: self.offset(at),
                    message,
                }),
                Event::Tombstone => {}
            }
        }
        b.finish()
    }

    /// 生のトークンを、`self.raw` から `until` の手前まで、今開いている節に入れる。`self.raw` を進める。
    ///
    /// # 引数
    ///
    /// - `b`：組み立て中の木
    /// - `until`：ここまで入れる生のトークンの番号（含まない）。`self.raw` 以下なら何もしない
    fn push_raw_until(&mut self, b: &mut GreenNodeBuilder<'_>, until: usize) {
        while self.raw < until {
            let t = self.tokens[self.raw];
            let start = self.starts[self.raw];
            b.token(t.kind.into(), &self.text[start..start + t.len]);
            self.raw += 1;
        }
    }

    /// エラーの位置をバイトオフセットにする。
    ///
    /// # 引数
    ///
    /// - `at`：意味のあるトークンの番号で表したエラーの位置（先頭か末尾か）
    ///
    /// # 戻り値
    ///
    /// テキストの先頭からのバイトオフセット。番号が意味のあるトークンの数以上なら、テキストの長さ。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part a" の意味のあるトークン: part(0..4)・a(5..6)
    /// offset(ErrorAt::Start(1)) → 5
    /// offset(ErrorAt::End(1))   → 6
    /// offset(ErrorAt::Start(2)) → 6   // 範囲外はテキストの末尾
    /// ```
    fn offset(&self, at: ErrorAt) -> usize {
        let raw = |i: usize| self.significant.get(i).copied();
        match at {
            ErrorAt::Start(i) => raw(i).map_or(self.text.len(), |r| self.starts[r]),
            ErrorAt::End(i) => {
                raw(i).map_or(self.text.len(), |r| self.starts[r] + self.tokens[r].len)
            }
        }
    }
}

#[cfg(test)]
mod tests;
