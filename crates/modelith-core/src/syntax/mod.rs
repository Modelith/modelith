//! SysML v2 のテキストを、ロスレスな構文木（CST）にする（ADR-0015）。
//!
//! 字句解析（`lexer`）→ 再帰下降（`grammar`、イベントを出す）→ 木の組み立て（この層、`rowan`）の順に進む。
//! 木の文字列は入力と 1 文字も違わず、どんな入力でも panic しない。

mod grammar;
mod kind;
mod lexer;
mod parser;

pub use kind::{KEYWORDS, SyntaxKind, is_keyword};

use lexer::Token;
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
}

impl Parse {
    /// 構文木の根（`SOURCE_FILE`）。
    pub fn syntax(&self) -> SyntaxNode {
        SyntaxNode::new_root(self.green.clone())
    }

    /// 字句と構文のエラー（位置の順）。
    pub fn errors(&self) -> &[SyntaxError] {
        &self.errors
    }

    /// 木を、節と位置の入れ子の文字列にする（テストと調査用）。
    pub fn debug_tree(&self) -> String {
        format!("{:#?}", self.syntax())
    }
}

/// テキストを解析する。
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
    Parse { green, errors }
}

/// パーサに渡すトークン（生のトークンの番号）。空白と注記は除く。
///
/// `/* … */`（REGULAR_COMMENT）は、要素として書かれたもの（文の頭にあるもの、`doc`・`comment` の本文）だけを渡し、
/// 宣言の途中にあるものは読み飛ばす（KerML 8.2.2.1・8.2.3.3.2）。
fn significant_tokens(text: &str, tokens: &[Token], starts: &[usize]) -> Vec<usize> {
    let mut out = Vec::with_capacity(tokens.len());
    // 今の文の最初のトークン（文の区切りの直後は None）
    let mut first: Option<&str> = None;
    for (i, t) in tokens.iter().enumerate() {
        if t.kind.is_trivia() {
            continue;
        }
        let s = &text[starts[i]..starts[i] + t.len];
        if t.kind == SyntaxKind::REGULAR_COMMENT {
            if matches!(first, None | Some("doc" | "comment")) {
                out.push(i);
                first = None;
            }
            continue;
        }
        out.push(i);
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

    fn push_raw_until(&mut self, b: &mut GreenNodeBuilder<'_>, until: usize) {
        while self.raw < until {
            let t = self.tokens[self.raw];
            let start = self.starts[self.raw];
            b.token(t.kind.into(), &self.text[start..start + t.len]);
            self.raw += 1;
        }
    }

    /// エラーの位置をバイトオフセットにする。
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
