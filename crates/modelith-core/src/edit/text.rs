//! テキストを書き換える小さな関数（暫定コアの `web/src/core/text-ops.ts` と同じ振る舞い）。
//! 位置はバイトオフセット。UTF-16 の位置との変換は [`Utf16`] で行う。

/// UTF-16 の位置とバイトオフセットの対応（解析結果の位置は UTF-16）。
pub struct Utf16 {
    /// UTF-16 の位置ごとのバイトオフセット（末尾の位置を含む）。
    bytes: Vec<usize>,
}

impl Utf16 {
    /// テキストの UTF-16 の位置ごとに、バイトオフセットの表を作る。サロゲートペアの後ろ半分の位置は、文字の先頭のバイトにする。
    ///
    /// # 引数
    ///
    /// - `text`：対応を作るテキスト
    ///
    /// # 戻り値
    ///
    /// UTF-16 の位置からバイトオフセットを引く表（末尾の位置を含む）。
    ///
    /// # 例
    ///
    /// ```text
    /// Utf16::new("a🚀b") → 位置 0..=4 のバイトは [0, 1, 1, 5, 6]   // 🚀 の 2 単位とも 1
    /// Utf16::new("")     → [0]
    /// ```
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
    ///
    /// # 引数
    ///
    /// - `pos`：UTF-16 の位置
    ///
    /// # 戻り値
    ///
    /// バイトオフセット。範囲外ならテキストの長さ（バイト）。
    ///
    /// # 例
    ///
    /// ```text
    /// // Utf16::new("a🚀b") のとき
    /// byte(3) → 5
    /// byte(2) → 1   // サロゲートペアの後ろ半分は文字の先頭
    /// byte(9) → 6   // 範囲外は末尾
    /// ```
    pub fn byte(&self, pos: usize) -> usize {
        self.bytes
            .get(pos)
            .or(self.bytes.last())
            .copied()
            .unwrap_or(0)
    }
}

/// p 以下で最も近い文字の境目（範囲外はテキストの長さ）。`str::floor_char_boundary` と同じ（MSRV 1.85 で使えないため）。
///
/// # 引数
///
/// - `t`：テキスト
/// - `p`：位置（バイトオフセット）
///
/// # 戻り値
///
/// 文字の境目のバイトオフセット（`t[..戻り値]` は必ず切り出せる）。
///
/// # 例
///
/// ```text
/// floor_boundary("a🚀b", 2) → 1   // 🚀（1..5）の途中は、その先頭
/// floor_boundary("a🚀b", 9) → 6   // 範囲外は長さ
/// ```
fn floor_boundary(t: &str, p: usize) -> usize {
    (0..=p.min(t.len()))
        .rev()
        .find(|&i| t.is_char_boundary(i))
        .unwrap_or(0)
}

/// バイトオフセットの UTF-16 の位置。
///
/// # 引数
///
/// - `text`：テキスト
/// - `byte`：バイトオフセット
///
/// # 戻り値
///
/// `byte` より前の UTF-16 の単位の数。`byte` が文字の途中なら、その文字の先頭の位置。範囲外ならテキスト全体の UTF-16 の長さ。
///
/// # 例
///
/// ```text
/// utf16_of("a🚀b", 5) → 3
/// utf16_of("a🚀b", 2) → 1   // 文字の途中は、その文字の先頭
/// utf16_of("a🚀b", 9) → 4   // 範囲外は全体の長さ
/// ```
pub fn utf16_of(text: &str, byte: usize) -> usize {
    text[..floor_boundary(text, byte)].encode_utf16().count()
}

/// p を含む行の先頭。暫定コアの `lineStart`（`web/src/core/text-ops.ts`）と同じ。
///
/// # 引数
///
/// - `t`：テキスト
/// - `p`：位置（バイトオフセット）
///
/// # 戻り値
///
/// 行の先頭のバイトオフセット。1 行目なら 0。`p` が文字の途中ならその文字を含む行、範囲外なら最後の行の先頭。
///
/// # 例
///
/// ```text
/// line_start("ab\ncd", 4) → 3
/// line_start("ab\ncd", 0) → 0   // 先頭行
/// line_start("ab\ncd", 9) → 3   // 範囲外は最後の行（暫定コアと同じ）
/// ```
pub fn line_start(t: &str, p: usize) -> usize {
    t[..floor_boundary(t, p)].rfind('\n').map_or(0, |i| i + 1)
}

/// p を含む行の字下げ（行頭の空白とタブ）。暫定コアの `indentAt` と同じ。
///
/// # 引数
///
/// - `t`：テキスト
/// - `p`：位置（バイトオフセット）
///
/// # 戻り値
///
/// 字下げの文字列（`t` の一部）。字下げが無ければ空文字列。
///
/// # 例
///
/// ```text
/// indent_at("x\n \t  y", 5) → " \t  "
/// indent_at("x", 0)          → ""
/// ```
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
    /// 編集をテキストに当てる。消す範囲がテキストの末尾を越えるときは末尾までを消す。
    ///
    /// # 引数
    ///
    /// - `t`：元のテキスト（`at` は文字の境界で、テキストの長さ以下であること。そうでなければ panic する）
    ///
    /// # 戻り値
    ///
    /// 編集を当てた後のテキスト。
    ///
    /// # 例
    ///
    /// ```text
    /// Splice { at: 2, del: 1, ins: "X" }.apply("abcd") → "abXd"
    /// Splice { at: 2, del: 9, ins: "" }.apply("abcd")  → "ab"   // 末尾を越える分は消さない
    /// ```
    pub fn apply(&self, t: &str) -> String {
        let end = (self.at + self.del).min(t.len());
        format!("{}{}{}", &t[..self.at], self.ins, &t[end..])
    }
}

/// 宣言の中に 1 行を足す編集。ブロックなら閉じ括弧の前に、`;` で終わる宣言ならブロックに書き換えて入れる。
/// 暫定コアの `insertEdit` と同じ。テキストはまだ変えない。
///
/// # 引数
///
/// - `t`：元のテキスト
/// - `target`：足す先の宣言（バイトオフセット。`close` があればブロックの閉じ括弧の位置）
/// - `snippet`：足す 1 行（字下げと改行は付けない。`part b : B;` など）
///
/// # 戻り値
///
/// 1 つの編集。閉じ括弧が行頭（前が空白だけ）なら、その行の前に字下げした行を入れる。
///
/// # 例
///
/// ```text
/// insert_splice("part def A {}", Target { start: 0, head_end: 11, close: Some(12) }, "part b : B;")
///   → Splice { at: 12, del: 0, ins: " part b : B; " }                 // 同じ行の閉じ括弧の前
/// insert_splice("part def A {\n}", Target { start: 0, head_end: 11, close: Some(13) }, "part b;")
///   → Splice { at: 13, del: 0, ins: "    part b;\n" }                 // 閉じ括弧だけの行の前
/// insert_splice("  part def A;", Target { start: 2, head_end: 12, close: None }, "part b : B;")
///   → Splice { at: 12, del: 1, ins: " {\n      part b : B;\n  }" }    // ; をブロックに書き換える
/// ```
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

/// [`insert_splice`] を適用した結果と、挿入した範囲。暫定コアの `insertInto` と同じ。
///
/// # 引数
///
/// - `t`：元のテキスト
/// - `target`：足す先の宣言（バイトオフセット）
/// - `snippet`：足す 1 行（字下げと改行は付けない）
///
/// # 戻り値
///
/// 挿入後のテキストと、挿入した範囲の始まり・終わり（挿入後のテキストのバイトオフセット）。
///
/// # 例
///
/// ```text
/// insert_into("part def A {}", Target { start: 0, head_end: 11, close: Some(12) }, "part b : B;")
///   → ("part def A { part b : B; }", 12, 25)
/// ```
pub fn insert_into(t: &str, target: Target, snippet: &str) -> (String, usize, usize) {
    let s = insert_splice(t, target, snippet);
    (s.apply(t), s.at, s.at + s.ins.len())
}

/// 範囲を消す。範囲が行全体を占めるなら行ごと消す。結果と、消した位置。暫定コアの `removeRange` と同じ。
/// 行の一部を消すときは、範囲の後ろに続く空白も消す。
///
/// # 引数
///
/// - `t`：元のテキスト
/// - `start`・`end`：消す範囲（バイトオフセット。`end` は含まない。テキストの長さを超える分は末尾に詰める）
///
/// # 戻り値
///
/// 消した後のテキストと、消した位置（バイトオフセット）。
///
/// # 例
///
/// ```text
/// remove_range("a\n  b;\nc", 4, 6) → ("a\nc", 2)   // 行ごと
/// remove_range("x; b; y", 3, 5)    → ("x; y", 3)   // 行の一部
/// ```
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
/// 暫定コアの `diffRange` と同じく前後の一致を除き、サロゲートペアの途中では切らない。
///
/// # 引数
///
/// - `old`：古いテキスト
/// - `new`：新しいテキスト
///
/// # 戻り値
///
/// 古いテキストの範囲の始まり・終わり（UTF-16）と、そこに入れる文字列。2 つが同じなら None。
///
/// # 例
///
/// ```text
/// diff("a😀b", "a😁b") → Some((1, 3, "😁"))   // 同じ上位サロゲートでも文字ごと置き換える
/// diff("same", "same") → None
/// ```
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

/// 先頭を小文字にする（`Engine` → `engine`）。部品などの使用の名前を、型の名前から作るときに使う。
///
/// # 引数
///
/// - `s`：元の文字列
///
/// # 戻り値
///
/// 先頭の 1 文字を小文字にした文字列。空なら空文字列。
///
/// # 例
///
/// ```text
/// lower_first("Engine") → "engine"
/// lower_first("")       → ""
/// ```
pub fn lower_first(s: &str) -> String {
    let mut cs = s.chars();
    cs.next()
        .map_or_else(String::new, |c| c.to_lowercase().chain(cs).collect())
}
