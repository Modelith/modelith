//! テキストの位置の変換。プラグインとの契約は行・列（0 始まり、列は UTF-16。LSP と同じ）、画面は UTF-16 のオフセットを使う。

use modelith_plugin_protocol::Position;

use crate::edit::text::{Utf16, utf16_of};
use crate::{LineCol, LineIndex};

/// 1 つのテキストについて、行・列と UTF-16 のオフセットを相互に変換する表。
pub(crate) struct Positions<'a> {
    text: &'a str,
    lines: LineIndex,
    utf16: Utf16,
}

impl<'a> Positions<'a> {
    /// テキストの行頭と UTF-16 の位置の表を作る。
    ///
    /// # 引数
    ///
    /// - `text`：変換の元にするテキスト
    ///
    /// # 戻り値
    ///
    /// 変換の表。失敗しない。
    ///
    /// # 例
    ///
    /// ```text
    /// Positions::new("a\n日本") → 行頭 [0, 2]・UTF-16 の長さ 4
    /// Positions::new("")        → 1 行・長さ 0
    /// ```
    pub(crate) fn new(text: &'a str) -> Self {
        Self {
            text,
            lines: LineIndex::new(text),
            utf16: Utf16::new(text),
        }
    }

    /// UTF-16 のオフセットを行・列にする。
    ///
    /// # 引数
    ///
    /// - `pos`：UTF-16 のオフセット（範囲外はテキストの末尾とみなす）
    ///
    /// # 戻り値
    ///
    /// 0 始まりの行と列（列は UTF-16）。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "a\n日本"
    /// position(3) → { line: 1, character: 1 }
    /// position(0) → { line: 0, character: 0 }
    /// position(9) → { line: 1, character: 2 }   // 範囲外は末尾
    /// ```
    pub(crate) fn position(&self, pos: usize) -> Position {
        let byte = self.utf16.byte(pos);
        let lc = self
            .lines
            .line_col(byte)
            .unwrap_or(LineCol { line: 0, col: 0 });
        Position {
            line: lc.line,
            character: lc.col,
        }
    }

    /// 行・列を UTF-16 のオフセットにする。
    ///
    /// # 引数
    ///
    /// - `p`：0 始まりの行と列（列は UTF-16）
    ///
    /// # 戻り値
    ///
    /// UTF-16 のオフセット。行が無い・列が行の長さを超える・サロゲートペアの途中を指すときは `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "a\n日本"
    /// offset({ line: 1, character: 1 }) → Some(3)
    /// offset({ line: 1, character: 2 }) → Some(4)   // 行末
    /// offset({ line: 1, character: 3 }) → None      // 行の長さ + 1
    /// offset({ line: 2, character: 0 }) → None      // 最終行 + 1
    /// ```
    pub(crate) fn offset(&self, p: Position) -> Option<usize> {
        let byte = self.lines.offset(LineCol {
            line: p.line,
            col: p.character,
        })?;
        Some(utf16_of(self.text, byte))
    }
}
