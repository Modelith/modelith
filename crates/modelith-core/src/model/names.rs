//! 名前の解決（修飾名と、同じファイルの中の別名）。
//!
//! 修飾名（`Q::A`）は、参照した場所の名前空間から外へ向かって最初の段を探し、見つかった名前空間から中へたどる
//! （SysML 8.2.2.5 と KerML の名前の解決）。たどれなければ見つからないものとする。
//! 修飾の無い名前は、これまでどおりファイル全体から探す（意味に沿った作り直しは 0.1.0 の後）。
//! 別名（`alias B for A;`、AliasMember、8.2.2.5）は、書いた名前空間の中身と同じように見え、指す先に置き換わる。

use super::Builder;
use crate::project::text::unquote;
use crate::project::{Alias, ParseResult};

/// 解析結果の中で、参照（修飾名・特徴の連鎖）を、書いた場所から解決する（`project` の後処理が使う）。
///
/// 図の要素はまだ無いので、修飾の無い名前は書いた場所から外へ、無ければ全体から書いた順で最初のものを探す。
///
/// # 引数
///
/// - `p`：読み終えた解析結果（別名を含む）
/// - `refs`：`(参照, 書いた文の持ち主の宣言の番号)` の並び
///
/// # 戻り値
///
/// `refs` と同じ順の、見つかった宣言の番号（別名なら指す先）。見つからなければ None。
///
/// # 例
///
/// ```text
/// // "package P { part def A { part b; } alias C for A; }" のとき（P は 0 番）
/// resolve_refs(p, [("A", Some(0)), ("A.b", Some(0)), ("C", Some(0)), ("Z", Some(0))])
///   → [Some(A の番号), Some(b の番号), Some(A の番号), None]
/// ```
pub(crate) fn resolve_refs(
    p: &ParseResult,
    refs: &[(String, Option<usize>)],
) -> Vec<Option<usize>> {
    let b = Builder::new(p);
    refs.iter().map(|(r, ctx)| b.resolve(r, *ctx)).collect()
}

/// 別名をたどる深さの上限（`alias A for B; alias B for A;` のような輪で止まらないように）。
const MAX_ALIAS_DEPTH: usize = 8;

impl Builder<'_> {
    /// 修飾名を、参照した場所から解決する。
    ///
    /// 最初の段は `ctx` から外へ向かって（各段の直下の中身・別名・その宣言自身の名前の順に）探し、無ければファイルの直下から探す。
    /// 2 段目からは、前の段の直下の中身と別名から探す。修飾の無い名前は `find_first` と同じく全体からも探す。
    ///
    /// # 引数
    ///
    /// - `path`：`::` でつないだ名前（`Q::A`・`'P 1'::A`・`A` など。各段の引用符は外して比べる）
    /// - `ctx`：参照した文の持ち主の宣言の番号。None ならファイルの直下から探す
    ///
    /// # 戻り値
    ///
    /// 最後の段の宣言の番号（別名なら指す先）。途中の段が見えないか無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package X { part def A; } package P { package Q { part def A; } part def H { part a : Q::A; } }" のとき
    /// lookup("Q::A", Some(H の番号)) → Some(Q の中の A の番号)   // X の A ではない
    /// lookup("X::A", Some(H の番号)) → Some(X の中の A の番号)   // ファイルの直下から
    /// lookup("Nope::A", Some(H の番号)) → None
    /// ```
    pub(crate) fn lookup(&self, path: &str, ctx: Option<usize>) -> Option<usize> {
        self.lookup_at(path, ctx, 0)
    }

    /// `lookup` の本体。別名をたどった深さ `depth` を数え、上限を超えたら探さない。
    ///
    /// # 引数
    ///
    /// - `path`：`::` でつないだ名前
    /// - `ctx`：探し始める宣言の番号。None ならファイルの直下から
    /// - `depth`：ここまでにたどった別名の数
    ///
    /// # 戻り値
    ///
    /// 最後の段の宣言の番号。見つからないか、深さが上限を超えたら None。
    ///
    /// # 例
    ///
    /// ```text
    /// lookup_at("Q::A", Some(H の番号), 0) → Some(A の番号)
    /// lookup_at("A", None, 9)              → None   // 深さの上限を超えた
    /// ```
    fn lookup_at(&self, path: &str, ctx: Option<usize>, depth: usize) -> Option<usize> {
        if depth > MAX_ALIAS_DEPTH {
            return None;
        }
        let mut segs = path.split("::").map(unquote);
        let first = segs.next().unwrap_or("");
        if !path.contains("::") {
            return self.find_first_at(first, ctx, depth);
        }
        let mut cur = self.visible_named(first, ctx, depth)?;
        for seg in segs {
            cur = self.member_named(cur, seg, depth)?;
        }
        Some(cur)
    }

    /// 名前空間 `ctx` から見える名前 `nm`（`ctx` から外へ、各段の直下の中身・別名・その宣言自身の名前、最後にファイルの直下）。
    ///
    /// # 引数
    ///
    /// - `nm`：探す名前（修飾の無い名前）
    /// - `ctx`：探し始める宣言の番号。None ならファイルの直下だけ
    /// - `depth`：ここまでにたどった別名の数
    ///
    /// # 戻り値
    ///
    /// 見つかった宣言の番号（別名なら指す先）。外側のどこにも無ければ None（全体からは探さない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { package Q { part def A; } part def H; } package X { package Q; }" のとき
    /// visible_named("Q", Some(H の番号), 0) → Some(P の中の Q の番号)
    /// visible_named("A", Some(H の番号), 0) → None   // Q の中は見えない
    /// ```
    fn visible_named(&self, nm: &str, ctx: Option<usize>, depth: usize) -> Option<usize> {
        let mut a = ctx;
        while let Some(i) = a {
            if let Some(c) = self.member_named(i, nm, depth) {
                return Some(c);
            }
            if self.e(i).name == nm {
                return Some(i);
            }
            a = self.e(i).pe;
        }
        self.by_name
            .get(nm)
            .and_then(|l| l.iter().copied().find(|&i| self.e(i).pe.is_none()))
            .or_else(|| self.alias_named(None, nm, depth))
    }

    /// 宣言 `i` の直下の中身か別名で、名前 `nm` のもの。
    ///
    /// # 引数
    ///
    /// - `i`：名前空間の宣言の番号
    /// - `nm`：探す名前
    /// - `depth`：ここまでにたどった別名の数
    ///
    /// # 戻り値
    ///
    /// 中身の番号か、別名の指す先の番号。無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; alias B for A; }" のとき
    /// member_named(P の番号, "A", 0) → Some(A の番号)
    /// member_named(P の番号, "B", 0) → Some(A の番号)   // 別名
    /// member_named(P の番号, "C", 0) → None
    /// ```
    fn member_named(&self, i: usize, nm: &str, depth: usize) -> Option<usize> {
        self.child_named(i, nm)
            .or_else(|| self.alias_named(Some(i), nm, depth))
    }

    /// 宣言 `owner` に書いた別名 `nm` の指す先。
    ///
    /// # 引数
    ///
    /// - `owner`：別名を書いた宣言の番号。None ならファイルの直下
    /// - `nm`：別名
    /// - `depth`：ここまでにたどった別名の数
    ///
    /// # 戻り値
    ///
    /// 指す先の宣言の番号。その別名が無いか、指す先が見つからなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; alias B for A; }" のとき
    /// alias_named(Some(P の番号), "B", 0) → Some(A の番号)
    /// alias_named(None, "B", 0)           → None   // P に書いた別名
    /// ```
    pub(crate) fn alias_named(
        &self,
        owner: Option<usize>,
        nm: &str,
        depth: usize,
    ) -> Option<usize> {
        self.p
            .aliases
            .iter()
            .filter(|a| a.pe == owner && a.name == nm)
            .find_map(|a| self.alias_target(a, depth + 1))
    }

    /// ファイルのどこかに書いた別名 `nm` の指す先（修飾の無い名前を全体から探すときに使う）。
    ///
    /// # 引数
    ///
    /// - `nm`：別名
    /// - `depth`：ここまでにたどった別名の数
    ///
    /// # 戻り値
    ///
    /// 書いた順で最初に指す先が見つかった別名の、指す先の番号。無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; alias B for A; }" のとき
    /// alias_anywhere("B", 0) → Some(A の番号)
    /// alias_anywhere("A", 0) → None   // 別名ではない
    /// ```
    pub(crate) fn alias_anywhere(&self, nm: &str, depth: usize) -> Option<usize> {
        self.p
            .aliases
            .iter()
            .filter(|a| a.name == nm)
            .find_map(|a| self.alias_target(a, depth + 1))
    }

    /// 別名の指す先を、別名を書いた名前空間から解決する。
    ///
    /// # 引数
    ///
    /// - `a`：別名
    /// - `depth`：この別名を含めてたどった別名の数
    ///
    /// # 戻り値
    ///
    /// 指す先の宣言の番号。見つからないか、深さが上限を超えたら None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { package Q { part def A; } alias B for Q::A; }" のとき
    /// alias_target(B, 1) → Some(A の番号)
    /// // "alias A for B; alias B for A;" のとき
    /// alias_target(A, 1) → None   // 輪になっている
    /// ```
    fn alias_target(&self, a: &Alias, depth: usize) -> Option<usize> {
        self.lookup_at(&a.target, a.pe, depth)
    }

    /// 型の名前（修飾名でもよい）から、その定義を探す。
    ///
    /// 修飾の無い名前は `def_named` と同じく全体から、修飾名は `ctx` から `lookup` で探し、定義のときだけ返す。
    ///
    /// # 引数
    ///
    /// - `path`：型の名前（`A`・`Q::A` など。引用符を外したもの）
    /// - `ctx`：型を書いた宣言の持ち主の番号
    ///
    /// # 戻り値
    ///
    /// 定義の宣言の番号。見つからないか、定義でなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { package Q { part def A; } part def H { part a : Q::A; } }" のとき
    /// def_of("Q::A", Some(H の番号))    → Some(A の番号)
    /// def_of("A", Some(H の番号))       → Some(A の番号)   // 修飾の無い名前は全体から
    /// def_of("Nope::A", Some(H の番号)) → None
    /// ```
    pub(crate) fn def_of(&self, path: &str, ctx: Option<usize>) -> Option<usize> {
        if !path.contains("::") {
            return self.def_named(path);
        }
        self.lookup(path, ctx).filter(|&i| self.e(i).is_def)
    }
}
