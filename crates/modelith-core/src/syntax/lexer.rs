//! 字句解析（KerML 8.2.2.1 Lexical Structure）。
//!
//! テキストを、空白・注記・コメントを含むすべてのトークンに分ける。どんな入力でも止まらず、
//! トークンの長さを足すと入力の長さに一致する（ロスレス）。

use super::kind::{SyntaxKind, is_keyword};

/// トークン 1 つ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Token {
    pub kind: SyntaxKind,
    /// バイト数。
    pub len: usize,
}

/// 字句のエラー（位置はバイトオフセット）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LexError {
    pub offset: usize,
    pub message: String,
}

/// テキストをトークンに分ける。
pub fn tokenize(text: &str) -> (Vec<Token>, Vec<LexError>) {
    let mut tokens = Vec::new();
    let mut errors = Vec::new();
    let mut offset = 0;
    while offset < text.len() {
        let rest = &text[offset..];
        let (kind, len, error) = next_token(rest);
        if let Some(message) = error {
            errors.push(LexError {
                offset,
                message: message.to_owned(),
            });
        }
        tokens.push(Token { kind, len });
        offset += len;
    }
    (tokens, errors)
}

/// 先頭のトークン 1 つの種類と長さ。閉じていない注記などはエラーの文言も返す。
fn next_token(s: &str) -> (SyntaxKind, usize, Option<&'static str>) {
    use SyntaxKind::*;
    let bytes = s.as_bytes();
    let Some(&c) = bytes.first() else {
        return (ERROR_TOKEN, 0, None);
    };
    let at = |i: usize| bytes.get(i).copied();
    match c {
        b' ' | b'\t' | b'\n' | b'\r' | b'\x0c' => {
            let len = s
                .find(|ch: char| !matches!(ch, ' ' | '\t' | '\n' | '\r' | '\x0c'))
                .unwrap_or(s.len());
            (WHITESPACE, len, None)
        }
        b'/' if at(1) == Some(b'/') && at(2) == Some(b'*') => block_end(s, 3, BLOCK_NOTE),
        b'/' if at(1) == Some(b'/') => (LINE_NOTE, s.find('\n').unwrap_or(s.len()), None),
        b'/' if at(1) == Some(b'*') => block_end(s, 2, REGULAR_COMMENT),
        b'\'' => quoted(s, b'\'', QUOTED_NAME, "引用名（'…'）が閉じていません"),
        b'"' => quoted(s, b'"', STRING, "文字列（\"…\"）が閉じていません"),
        b'0'..=b'9' => (NUMBER, number_len(bytes), None),
        b'.' if at(1).is_some_and(|b| b.is_ascii_digit()) => (NUMBER, number_len(bytes), None),
        b'A'..=b'Z' | b'a'..=b'z' | b'_' => {
            let len = bytes
                .iter()
                .position(|b| !(b.is_ascii_alphanumeric() || *b == b'_'))
                .unwrap_or(s.len());
            (
                if is_keyword(&s[..len]) {
                    KEYWORD
                } else {
                    IDENT
                },
                len,
                None,
            )
        }
        _ => punct(s),
    }
}

/// `/*`・`//*` で始まる注記・コメントの終わりまで。
fn block_end(s: &str, open: usize, kind: SyntaxKind) -> (SyntaxKind, usize, Option<&'static str>) {
    match s[open..].find("*/") {
        Some(i) => (kind, open + i + 2, None),
        None => (kind, s.len(), Some("コメント（/* … */）が閉じていません")),
    }
}

/// 引用符で囲む字句。`\` の後の 1 文字は閉じの引用符として扱わない。
fn quoted(
    s: &str,
    quote: u8,
    kind: SyntaxKind,
    unclosed: &'static str,
) -> (SyntaxKind, usize, Option<&'static str>) {
    let bytes = s.as_bytes();
    let mut i = 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b if b == quote => return (kind, i + 1, None),
            // 引用名・文字列は行をまたがない。閉じが無ければ行末までにする
            b'\n' => return (kind, i, Some(unclosed)),
            _ => i += 1,
        }
    }
    (kind, s.len().min(i), Some(unclosed))
}

/// 数値（`12`・`1.5`・`.5`・`1e-3`）の長さ。`1..*` の `1` は `1.` まで読まない。
fn number_len(bytes: &[u8]) -> usize {
    let digits = |from: usize| {
        from + bytes[from..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count()
    };
    let mut i = digits(0);
    if bytes.get(i) == Some(&b'.') && bytes.get(i + 1).is_some_and(u8::is_ascii_digit) {
        i = digits(i + 1);
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(bytes.get(i + 1), Some(b'+' | b'-')));
        if bytes.get(i + 1 + sign).is_some_and(u8::is_ascii_digit) {
            i = digits(i + 1 + sign);
        }
    }
    i
}

/// 記号。長いものから順に当てる。
fn punct(s: &str) -> (SyntaxKind, usize, Option<&'static str>) {
    use SyntaxKind::*;
    const TABLE: &[(&str, SyntaxKind)] = &[
        ("===", OP),
        ("!==", OP),
        (":>>", COLON_GT2),
        ("::>", COLON2_GT),
        ("::", COLON2),
        (":>", COLON_GT),
        (":=", COLON_EQ),
        ("**", STAR2),
        ("==", OP),
        ("!=", OP),
        ("<=", OP),
        (">=", OP),
        ("->", OP),
        ("..", OP),
        ("??", OP),
        ("@@", OP),
        (";", SEMI),
        (",", COMMA),
        (".", DOT),
        ("{", L_BRACE),
        ("}", R_BRACE),
        ("(", L_PAREN),
        (")", R_PAREN),
        ("[", L_BRACK),
        ("]", R_BRACK),
        ("<", LT),
        (">", GT),
        (":", COLON),
        ("~", TILDE),
        ("=", EQ),
        ("#", HASH),
        ("@", AT),
        ("*", STAR),
        ("+", OP),
        ("-", OP),
        ("/", OP),
        ("%", OP),
        ("^", OP),
        ("|", OP),
        ("&", OP),
        ("?", OP),
        ("!", OP),
        ("$", OP),
    ];
    for (text, kind) in TABLE {
        if s.starts_with(text) {
            return (*kind, text.len(), None);
        }
    }
    let len = s.chars().next().map_or(1, char::len_utf8);
    (ERROR_TOKEN, len, Some("使えない文字があります"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use SyntaxKind::*;

    fn kinds(text: &str) -> Vec<(SyntaxKind, &str)> {
        let (tokens, _) = tokenize(text);
        let mut at = 0;
        tokens
            .into_iter()
            .map(|t| {
                let s = &text[at..at + t.len];
                at += t.len;
                (t.kind, s)
            })
            .filter(|(k, _)| *k != WHITESPACE)
            .collect()
    }

    #[test]
    fn splits_declaration_into_keywords_names_and_symbols() {
        // Arrange
        let text = "part def <'R1'> Engine :> Base;";
        // Act
        let actual = kinds(text);
        // Assert
        assert_eq!(
            actual,
            vec![
                (KEYWORD, "part"),
                (KEYWORD, "def"),
                (LT, "<"),
                (QUOTED_NAME, "'R1'"),
                (GT, ">"),
                (IDENT, "Engine"),
                (COLON_GT, ":>"),
                (IDENT, "Base"),
                (SEMI, ";"),
            ]
        );
    }

    #[test]
    fn distinguishes_notes_from_regular_comments() {
        // Arrange（同値クラス: 行の注記・複数行の注記・コメント）
        let text = "// a\n//* b */ /* c */";
        // Act
        let actual = kinds(text);
        // Assert
        assert_eq!(
            actual,
            vec![
                (LINE_NOTE, "// a"),
                (BLOCK_NOTE, "//* b */"),
                (REGULAR_COMMENT, "/* c */")
            ]
        );
    }

    #[test]
    fn longest_symbol_wins() {
        // Arrange
        let text = ":>> ::> :> :: := : ** *";
        // Act
        let actual: Vec<_> = kinds(text).into_iter().map(|(k, _)| k).collect();
        // Assert
        assert_eq!(
            actual,
            vec![
                COLON_GT2, COLON2_GT, COLON_GT, COLON2, COLON_EQ, COLON, STAR2, STAR
            ]
        );
    }

    #[test]
    fn number_does_not_swallow_range_dots() {
        // Arrange（境界値: 小数・範囲・指数）
        let text = "1.5 1..* 2e-3";
        // Act
        let actual = kinds(text);
        // Assert
        assert_eq!(
            actual,
            vec![
                (NUMBER, "1.5"),
                (NUMBER, "1"),
                (OP, ".."),
                (STAR, "*"),
                (NUMBER, "2e-3")
            ]
        );
    }

    #[test]
    fn quoted_name_keeps_escaped_quote() {
        // Arrange
        let text = r"'it\'s' x";
        // Act
        let actual = kinds(text);
        // Assert
        assert_eq!(actual, vec![(QUOTED_NAME, r"'it\'s'"), (IDENT, "x")]);
    }

    #[test]
    fn unclosed_comment_runs_to_end_and_reports_error() {
        // Arrange（異常系）
        let text = "part a; /* never closed";
        // Act
        let (tokens, errors) = tokenize(text);
        // Assert
        assert_eq!(tokens.last().map(|t| t.kind), Some(REGULAR_COMMENT));
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].offset, 8);
    }

    #[test]
    fn unclosed_quoted_name_stops_at_line_end() {
        // Arrange（異常系）
        let text = "part 'a\npart b;";
        // Act
        let actual = kinds(text);
        // Assert
        assert_eq!(actual[1], (QUOTED_NAME, "'a"));
        assert_eq!(actual[2], (KEYWORD, "part"));
    }

    #[test]
    fn unknown_character_becomes_error_token() {
        // Arrange（異常系: 全角文字は名前に使えない）
        let text = "part 部品;";
        // Act
        let (tokens, errors) = tokenize(text);
        // Assert
        assert!(tokens.iter().any(|t| t.kind == ERROR_TOKEN));
        assert!(!errors.is_empty());
    }

    #[test]
    fn token_lengths_cover_the_whole_input() {
        // Arrange（ロスレス）
        let text = "package P { part a : 'B'[1..*] = \"s\"; } // 終わり\n/* x";
        // Act
        let (tokens, _) = tokenize(text);
        // Assert
        assert_eq!(tokens.iter().map(|t| t.len).sum::<usize>(), text.len());
    }
}
