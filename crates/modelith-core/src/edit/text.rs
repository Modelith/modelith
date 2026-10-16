//! テキストを書き換える小さな関数（暫定コアの `web/src/core/text-ops.ts` と同じ振る舞い）。
//! 位置はバイトオフセット。UTF-16 の位置との変換は [`Utf16`] で行う。

/// UTF-16 の位置とバイトオフセットの対応（解析結果の位置は UTF-16）。
pub struct Utf16 {
    /// UTF-16 の位置ごとのバイトオフセット（末尾の位置を含む）。
    bytes: Vec<usize>,
}

impl Utf16 {
    pub fn new(text: &str) -> Self {
        let mut bytes = Vec::with_capacity(text.len() + 1);
        for (b, c) in text.char_indices() {
            // サロゲートペアの後ろ半分の位置は、文字の先頭に寄せる
            bytes.extend(std::iter::repeat_n(b, c.len_utf16()));
        }
        bytes.push(text.len());
        Self { bytes }
    }

    /// UTF-16 の位置のバイトオフセット（範囲外は末尾）。
    pub fn byte(&self, pos: usize) -> usize {
        self.bytes
            .get(pos)
            .or(self.bytes.last())
            .copied()
            .unwrap_or(0)
    }
}

/// バイトオフセットの UTF-16 の位置。
pub fn utf16_of(text: &str, byte: usize) -> usize {
    text.get(..byte)
        .map_or_else(|| text.encode_utf16().count(), |s| s.encode_utf16().count())
}

/// p を含む行の先頭。
pub fn line_start(t: &str, p: usize) -> usize {
    t.get(..p).and_then(|s| s.rfind('\n')).map_or(0, |i| i + 1)
}

/// p を含む行の字下げ。
pub fn indent_at(t: &str, p: usize) -> &str {
    let rest = &t[line_start(t, p)..];
    let n = rest.len() - rest.trim_start_matches([' ', '\t']).len();
    &rest[..n]
}

/// 子を挿入できる宣言の位置（`close` があればブロック、なければ `;` で終わる宣言）。
#[derive(Debug, Clone, Copy)]
pub struct Target {
    pub start: usize,
    pub head_end: usize,
    pub close: Option<usize>,
}

/// 1 つの編集（`at` から `del` バイトを消して `ins` を入れる）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Splice {
    pub at: usize,
    pub del: usize,
    pub ins: String,
}

impl Splice {
    pub fn apply(&self, t: &str) -> String {
        let end = (self.at + self.del).min(t.len());
        format!("{}{}{}", &t[..self.at], self.ins, &t[end..])
    }
}

/// 宣言の中に 1 行を足す編集。ブロックなら閉じ括弧の前に、`;` で終わる宣言ならブロックに書き換えて入れる。
pub fn insert_splice(t: &str, target: Target, snippet: &str) -> Splice {
    if let Some(close) = target.close {
        let ind = format!("{}    ", indent_at(t, target.start));
        let ls = line_start(t, close);
        if t[ls..close].trim().is_empty() {
            return Splice {
                at: ls,
                del: 0,
                ins: format!("{ind}{snippet}\n"),
            };
        }
        let sep = if t[..close].ends_with(char::is_whitespace) {
            ""
        } else {
            " "
        };
        return Splice {
            at: close,
            del: 0,
            ins: format!("{sep}{snippet} "),
        };
    }
    let ind = indent_at(t, target.start);
    Splice {
        at: target.head_end,
        del: 1,
        ins: format!(" {{\n{ind}    {snippet}\n{ind}}}"),
    }
}

/// [`insert_splice`] を適用した結果と、挿入した範囲。
pub fn insert_into(t: &str, target: Target, snippet: &str) -> (String, usize, usize) {
    let s = insert_splice(t, target, snippet);
    (s.apply(t), s.at, s.at + s.ins.len())
}

/// 範囲を消す。範囲が行全体を占めるなら行ごと消す。結果と、消した位置。
pub fn remove_range(t: &str, start: usize, end: usize) -> (String, usize) {
    let (mut a, mut b) = (start.min(t.len()), end.min(t.len()));
    let ls = line_start(t, a);
    let le = t[b..].find('\n').map_or(t.len(), |i| b + i);
    if t[ls..a].trim().is_empty() && t[b..le].trim().is_empty() {
        a = ls;
        b = (le + 1).min(t.len());
    } else {
        b += t[b..].len() - t[b..].trim_start_matches(' ').len();
    }
    (format!("{}{}", &t[..a], &t[b..]), a)
}

/// 2 つのテキストの違う範囲を、UTF-16 の位置の 1 つの編集にする（古いテキストの [start, end) を text に置き換える）。
pub fn diff(old: &str, new: &str) -> Option<(usize, usize, String)> {
    let a: Vec<u16> = old.encode_utf16().collect();
    let b: Vec<u16> = new.encode_utf16().collect();
    let m = a.len().min(b.len());
    let mut p = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    // サロゲートペアの途中で切らない
    if p > 0 && (0xD800..0xDC00).contains(&a[p - 1]) {
        p -= 1;
    }
    let mut s = (0..m - p)
        .take_while(|&i| a[a.len() - 1 - i] == b[b.len() - 1 - i])
        .count();
    if s > 0 && (0xDC00..0xE000).contains(&a[a.len() - s]) {
        s -= 1;
    }
    if p == a.len() && p == b.len() {
        return None;
    }
    let text = String::from_utf16_lossy(&b[p..b.len() - s]);
    Some((p, a.len() - s, text))
}

/// 先頭を小文字にする（`Engine` → `engine`）。
pub fn lower_first(s: &str) -> String {
    let mut cs = s.chars();
    cs.next()
        .map_or_else(String::new, |c| c.to_lowercase().chain(cs).collect())
}
