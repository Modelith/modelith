//! バイトオフセットと行・列の相互変換。
//!
//! コアは内部ではバイトオフセットで位置を扱い、UI / LSP との境界で行・列へ変換する。
//! 列は LSP の既定に合わせて UTF-16 コード単位で数える。

/// 0 始まりの行・列（列は UTF-16 コード単位）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineCol {
    pub line: u32,
    pub col: u32,
}

/// テキストの行頭オフセット表。
#[derive(Debug, Clone)]
pub struct LineIndex {
    text: String,
    line_starts: Vec<usize>,
}

impl LineIndex {
    /// テキストを写し取り、各行の始まり（バイトオフセット）の表を作る。
    ///
    /// 行は `\n` で区切る（`\r` は列の 1 文字として数える）。空のテキストも 1 行として扱う。
    ///
    /// # 引数
    ///
    /// - `text`：変換の元にするテキスト（全体を内部に写す）
    ///
    /// # 戻り値
    ///
    /// 行頭の表を持つ `LineIndex`。失敗しない。
    ///
    /// # 例
    ///
    /// ```text
    /// LineIndex::new("a\nb") → 行頭 [0, 2]
    /// LineIndex::new("")     → 行頭 [0]（空でも 1 行）
    /// ```
    pub fn new(text: &str) -> Self {
        let line_starts = std::iter::once(0)
            .chain(text.match_indices('\n').map(|(i, _)| i + 1))
            .collect();
        Self {
            text: text.to_owned(),
            line_starts,
        }
    }

    /// バイトオフセットを行・列に変換する。範囲外や文字境界でない場合は `None`。
    ///
    /// # 引数
    ///
    /// - `offset`：テキストの先頭からのバイトオフセット（`0` 以上、テキストの長さ以下。長さちょうどはテキストの末尾）
    ///
    /// # 戻り値
    ///
    /// 0 始まりの行と、行頭からの列（UTF-16 コード単位）。`offset` がテキストの長さを超えるか、
    /// マルチバイト文字の途中を指すときは `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "part def A;\n// 日本語\npart b : A;"
    /// line_col(0)                → Some({ line: 0, col: 0 })
    /// line_col(12)               → Some({ line: 1, col: 0 })    // 改行の直後
    /// line_col("語" の直後)       → Some({ line: 1, col: 6 })    // 漢字は UTF-16 で 1 単位
    /// line_col(len)              → Some({ line: 2, col: 11 })   // テキストの末尾
    /// line_col(len + 1)          → None                         // 範囲外
    /// line_col("語" の 2 バイト目) → None                         // 文字境界でない
    /// ```
    pub fn line_col(&self, offset: usize) -> Option<LineCol> {
        if offset > self.text.len() || !self.text.is_char_boundary(offset) {
            return None;
        }
        let line = self.line_starts.partition_point(|&s| s <= offset) - 1;
        let start = self.line_starts[line];
        let col: usize = self.text[start..offset].chars().map(char::len_utf16).sum();
        Some(LineCol {
            line: u32::try_from(line).ok()?,
            col: u32::try_from(col).ok()?,
        })
    }

    /// 行・列をバイトオフセットに変換する。範囲外の場合は `None`。`line_col` の逆。
    ///
    /// # 引数
    ///
    /// - `pos`：0 始まりの行と列（列は UTF-16 コード単位。行の長さちょうどは行末＝改行の手前）
    ///
    /// # 戻り値
    ///
    /// テキストの先頭からのバイトオフセット。行が無い、列が行の長さを超える、
    /// または列がサロゲートペアの途中を指すときは `None`。
    ///
    /// # 例
    ///
    /// ```text
    /// // テキスト "part def A;\n// 日本語\npart b : A;"
    /// offset({ line: 0, col: 11 }) → Some(11)   // 行末（改行の位置）
    /// offset({ line: 0, col: 12 }) → None       // 行の長さ + 1
    /// offset({ line: 3, col: 0 })  → None       // 最終行 + 1
    /// // テキスト ""
    /// offset({ line: 0, col: 0 })  → Some(0)
    /// ```
    pub fn offset(&self, pos: LineCol) -> Option<usize> {
        let start = *self.line_starts.get(pos.line as usize)?;
        let end = self
            .line_starts
            .get(pos.line as usize + 1)
            .map_or(self.text.len(), |&e| e - 1);
        let mut utf16 = 0u32;
        for (i, c) in self.text[start..end].char_indices() {
            if utf16 == pos.col {
                return Some(start + i);
            }
            utf16 += c.len_utf16() as u32;
        }
        (utf16 == pos.col).then_some(end)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 1 行目: ASCII、2 行目: 3 バイト文字（UTF-16 で 1 単位）、3 行目: 末尾に改行なし
    const TEXT: &str = "part def A;\n// 日本語\npart b : A;";

    // --- line_col: 正常系（同値クラス: 行頭・行中・行末・テキスト末尾） ---

    #[test]
    fn line_col_at_text_start_is_origin() {
        // Arrange
        let idx = LineIndex::new(TEXT);
        // Act
        let pos = idx.line_col(0);
        // Assert
        assert_eq!(pos, Some(LineCol { line: 0, col: 0 }));
    }

    #[test]
    fn line_col_just_after_newline_starts_next_line() {
        // Arrange（境界値: 改行の直後）
        let idx = LineIndex::new(TEXT);
        let after_newline = TEXT.find('\n').unwrap() + 1;
        // Act
        let pos = idx.line_col(after_newline);
        // Assert
        assert_eq!(pos, Some(LineCol { line: 1, col: 0 }));
    }

    #[test]
    fn line_col_counts_columns_in_utf16_units() {
        // Arrange（同値クラス: マルチバイト文字の後ろ）
        let idx = LineIndex::new(TEXT);
        let after_kanji = TEXT.find('語').unwrap() + '語'.len_utf8();
        // Act
        let pos = idx.line_col(after_kanji);
        // Assert
        assert_eq!(pos, Some(LineCol { line: 1, col: 6 }));
    }

    #[test]
    fn line_col_at_text_end_is_last_position() {
        // Arrange（境界値: テキスト末尾 = len）
        let idx = LineIndex::new(TEXT);
        // Act
        let pos = idx.line_col(TEXT.len());
        // Assert
        assert_eq!(pos, Some(LineCol { line: 2, col: 11 }));
    }

    // --- line_col: 異常系 ---

    #[test]
    fn line_col_rejects_offset_past_end() {
        // Arrange（境界値: len + 1）
        let idx = LineIndex::new(TEXT);
        // Act
        let pos = idx.line_col(TEXT.len() + 1);
        // Assert
        assert_eq!(pos, None);
    }

    #[test]
    fn line_col_rejects_offset_inside_multibyte_char() {
        // Arrange（同値クラス: 文字境界でない位置）
        let idx = LineIndex::new(TEXT);
        let inside = TEXT.find('語').unwrap() + 1;
        // Act
        let pos = idx.line_col(inside);
        // Assert
        assert_eq!(pos, None);
    }

    // --- offset: 正常系・異常系 ---

    #[test]
    fn offset_is_inverse_of_line_col_for_every_char_boundary() {
        // Arrange
        let idx = LineIndex::new(TEXT);
        let boundaries: Vec<usize> = TEXT
            .char_indices()
            .map(|(i, _)| i)
            .chain([TEXT.len()])
            .collect();
        // Act
        let roundtrips: Vec<Option<usize>> = boundaries
            .iter()
            .map(|&o| idx.offset(idx.line_col(o).unwrap()))
            .collect();
        // Assert
        assert_eq!(
            roundtrips,
            boundaries.into_iter().map(Some).collect::<Vec<_>>()
        );
    }

    #[test]
    fn offset_accepts_column_at_line_end() {
        // Arrange（境界値: 行末の列 = 行の長さ）
        let idx = LineIndex::new(TEXT);
        // Act
        let offset = idx.offset(LineCol { line: 0, col: 11 });
        // Assert
        assert_eq!(offset, Some(TEXT.find('\n').unwrap()));
    }

    #[test]
    fn offset_rejects_column_past_line_end() {
        // Arrange（境界値: 行の長さ + 1）
        let idx = LineIndex::new(TEXT);
        // Act
        let offset = idx.offset(LineCol { line: 0, col: 12 });
        // Assert
        assert_eq!(offset, None);
    }

    #[test]
    fn offset_rejects_line_past_last() {
        // Arrange（境界値: 最終行 + 1）
        let idx = LineIndex::new(TEXT);
        // Act
        let offset = idx.offset(LineCol { line: 3, col: 0 });
        // Assert
        assert_eq!(offset, None);
    }

    #[test]
    fn empty_text_has_single_empty_line() {
        // Arrange（境界値: 空テキスト）
        let idx = LineIndex::new("");
        // Act
        let (pos, offset) = (idx.line_col(0), idx.offset(LineCol { line: 0, col: 0 }));
        // Assert
        assert_eq!((pos, offset), (Some(LineCol { line: 0, col: 0 }), Some(0)));
    }
}
