//! プロジェクトのほかのファイルの解析結果を、表示中のファイルの解析結果の後ろにつなぎ、1 つのモデルにする（ADR-0021）。
//!
//! 宣言どうしの参照は番号なので、つなぐときに番号をずらす。位置はファイルごとに 0 から数えるので、ほかのファイルの位置には
//! ファイルごとの区切り（`FILE_STRIDE` の倍数）を足す。表示中のファイルの位置は変えないので、エディタと編集はそのまま動く。
//! 位置から、どのファイルのものかが分かる（`file_of`）。ほかのファイルの構文エラー・まだ扱えない文は、表示中のファイルの問題に混ぜない。

use super::{Block, ParseResult, Rel, RelKind, Scope, project};
use crate::syntax::parse;

/// ファイルごとの位置の区切り。ほかのファイルの `n` 番目（1 から）の位置は `n * FILE_STRIDE` から始まる。
/// wasm の位置（32 ビット）に収まるように 2^24（1 ファイル 1677 万字まで）にする。
pub const FILE_STRIDE: usize = 1 << 24;

/// つなげるほかのファイルの数の上限（32 ビットでは 255）。
pub const MAX_OTHERS: usize = usize::MAX / FILE_STRIDE - 1;

/// 位置が、どのファイルのものか。
///
/// # 引数
///
/// - `pos`：つないだ解析結果の中の位置
///
/// # 戻り値
///
/// 表示中のファイルなら 0、ほかのファイルなら 1 から始まる番号（`merge` に渡した順）。
///
/// # 例
///
/// ```text
/// file_of(120)                   → 0
/// file_of(2 * FILE_STRIDE + 5)   → 2
/// ```
pub fn file_of(pos: usize) -> usize {
    pos / FILE_STRIDE
}

/// 表示中のファイルとほかのファイルのテキストを解析し、1 つの解析結果につなぐ（ADR-0021）。
///
/// # 引数
///
/// - `focus`：表示中のファイルのテキスト
/// - `others`：プロジェクトのほかのファイルのテキスト（この順に 1 から番号を付ける）
///
/// # 戻り値
///
/// つないだ解析結果。`others` が空なら `project(focus, …)` と同じ。区切り（`FILE_STRIDE`）より長いファイルと、
/// 上限（`MAX_OTHERS`）を超えたファイルはつながない。表示中のファイルが区切りより長ければ、ほかのファイルをつながない。
///
/// # 例
///
/// ```text
/// project_files("package A { import B::*; }", &["package B { part def Y; }"]).entries → [A, B, Y]
/// project_files("part def X;", &[])                                                     → project("part def X;", …) と同じ
/// ```
pub fn project_files(focus: &str, others: &[&str]) -> ParseResult {
    let one = |t: &str| project(t, &parse(t));
    let fits = |t: &&&str| t.len() < FILE_STRIDE;
    if !fits(&&focus) {
        return one(focus);
    }
    let rest = others
        .iter()
        .filter(fits)
        .take(MAX_OTHERS)
        .map(|t| one(t))
        .collect();
    merge(one(focus), rest)
}

/// 表示中のファイルの解析結果の後ろに、ほかのファイルの解析結果をつなぐ。宣言・ブロック・関係・別名・`import` を足し、
/// 番号と位置をずらす。構文エラー・まだ扱えない文・見つからないメモの相手は、表示中のファイルのものだけを残す。
///
/// # 引数
///
/// - `focus`：表示中のファイルの解析結果
/// - `others`：ほかのファイルの解析結果（この順に 1 から番号を付ける）
///
/// # 戻り値
///
/// つないだ解析結果。どのファイルも区切り（`FILE_STRIDE`）より短く、`others` は `MAX_OTHERS` 以下であること（`project_files` が選ぶ）。
///
/// # 例
///
/// ```text
/// // focus = "package A { part def X; }"、others = ["package B { part def Y; }"] のとき
/// merge(focus, [others]) → entries は [A, X, B, Y]。B の pe は None、Y の pe は Some(2)、B の start は FILE_STRIDE
/// ```
pub fn merge(focus: ParseResult, others: Vec<ParseResult>) -> ParseResult {
    let mut out = focus;
    for (k, o) in others.into_iter().enumerate() {
        let at = Shift {
            entries: out.entries.len(),
            blocks: out.blocks.len(),
            pos: (k + 1) * FILE_STRIDE,
        };
        out.entries.extend(o.entries.into_iter().map(|mut e| {
            e.pe = e.pe.map(|i| i + at.entries);
            e.children.iter_mut().for_each(|i| *i += at.entries);
            e.about.iter_mut().for_each(|i| *i += at.entries);
            e.idx += at.entries;
            e.owner = e.owner.map(|s| at.scope(s));
            e.phase_block = e.phase_block.map(|s| at.scope(s));
            e.start += at.pos;
            e.head_end += at.pos;
            e.end += at.pos;
            e.open = e.open.map(|p| p + at.pos);
            e.close = e.close.map(|p| p + at.pos);
            if let Some(v) = e.phase_val.as_mut() {
                v.start += at.pos;
                v.end += at.pos;
            }
            for s in &mut e.specs {
                s.start += at.pos;
                s.end += at.pos;
            }
            for x in e.exposes.iter_mut().flatten() {
                x.start += at.pos;
                x.end += at.pos;
            }
            e
        }));
        out.blocks.extend(o.blocks.into_iter().map(|b| at.block(b)));
        out.rels.extend(o.rels.into_iter().map(|r| at.rel(r)));
        out.aliases.extend(o.aliases.into_iter().map(|mut a| {
            a.pe = a.pe.map(|i| i + at.entries);
            a
        }));
        out.import_list
            .extend(o.import_list.into_iter().map(|mut i| {
                i.pe = i.pe.map(|p| p + at.entries);
                i.start += at.pos;
                i
            }));
    }
    out
}

/// つなぐファイル 1 つ分の、番号と位置のずれ。
struct Shift {
    entries: usize,
    blocks: usize,
    pos: usize,
}

impl Shift {
    /// 持ち主の番号をずらす。
    ///
    /// # 引数
    ///
    /// - `s`：持ち主
    ///
    /// # 戻り値
    ///
    /// ずらした持ち主。
    ///
    /// # 例
    ///
    /// ```text
    /// // entries = 10, blocks = 3 のとき
    /// scope(Scope::Entry(2)) → Scope::Entry(12)
    /// scope(Scope::Block(1)) → Scope::Block(4)
    /// ```
    fn scope(&self, s: Scope) -> Scope {
        match s {
            Scope::Entry(i) => Scope::Entry(i + self.entries),
            Scope::Block(i) => Scope::Block(i + self.blocks),
        }
    }

    /// ブロックの持ち主と位置をずらす。
    ///
    /// # 引数
    ///
    /// - `b`：ブロック
    ///
    /// # 戻り値
    ///
    /// ずらしたブロック。
    ///
    /// # 例
    ///
    /// ```text
    /// // pos = FILE_STRIDE のとき
    /// block(Block { start: 4, open: Some(9), … }) → Block { start: FILE_STRIDE + 4, open: Some(FILE_STRIDE + 9), … }
    /// ```
    fn block(&self, mut b: Block) -> Block {
        b.owner = b.owner.map(|s| self.scope(s));
        b.start += self.pos;
        b.open = b.open.map(|p| p + self.pos);
        b.close = b.close.map(|p| p + self.pos);
        b.end = b.end.map(|p| p + self.pos);
        b
    }

    /// 関係の持ち主・使用の番号と位置をずらす。
    ///
    /// # 引数
    ///
    /// - `r`：関係
    ///
    /// # 戻り値
    ///
    /// ずらした関係。
    ///
    /// # 例
    ///
    /// ```text
    /// // entries = 10, pos = FILE_STRIDE のとき
    /// rel(Rel { pe: Some(1), start: 30, kind: Connect { usage: 2, … }, … })
    ///   → Rel { pe: Some(11), start: FILE_STRIDE + 30, kind: Connect { usage: 12, … }, … }
    /// ```
    fn rel(&self, mut r: Rel) -> Rel {
        let n = self.entries;
        r.pe = r.pe.map(|i| i + n);
        r.start += self.pos;
        r.end += self.pos;
        match &mut r.kind {
            RelKind::Flow { usage, .. } | RelKind::SuccessionFlow { usage, .. } => {
                *usage = usage.map(|u| u + n);
            }
            RelKind::Connect { usage, .. }
            | RelKind::Allocate { usage, .. }
            | RelKind::Bind { usage, .. } => {
                *usage += n;
            }
            RelKind::Transition { from_entry, .. } => *from_entry = from_entry.map(|u| u + n),
            RelKind::Succession {
                a_entry, b_entry, ..
            } => {
                *a_entry = a_entry.map(|u| u + n);
                *b_entry = b_entry.map(|u| u + n);
            }
            RelKind::Derive { .. }
            | RelKind::Dependency { .. }
            | RelKind::Message { .. }
            | RelKind::Satisfy { .. }
            | RelKind::Verify { .. }
            | RelKind::Frame { .. }
            | RelKind::EntryTransition { .. } => {}
        }
        r
    }
}
