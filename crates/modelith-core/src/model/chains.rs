//! 特徴の連鎖（`a.b.c.d`、FeatureChain、8.2.2.6・KerML 8.2.5）を、2 段目から先までたどる。
//!
//! 各段は、前の段の宣言の本体、その型の定義の本体、型の定義が特殊化した定義の本体、前の段が部分集合・再定義した相手の順に探す。
//! 探す先がファイルの外（標準ライブラリなど）にあり、中身を確かめられないときは、見つからないとは言わない。

use std::collections::HashSet;

use super::Builder;

/// 連鎖の 2 段目から先をたどった結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChainEnd {
    /// 最後の段の宣言の番号。
    Found(usize),
    /// `rest` の何番目（0 から）の段が見つからないか。前の段の中身はすべてファイルの中にあり、その名前は無いと言い切れる。
    Missing(usize),
    /// 途中の段の中身を確かめられない（型の無い使用・ファイルの外の型を持つ使用の中を探した）。
    Unknown,
}

impl Builder<'_> {
    /// 宣言 `from` から、連鎖の残りの段 `rest` を順にたどる。
    ///
    /// # 引数
    ///
    /// - `from`：連鎖の最初の段の宣言の番号
    /// - `rest`：2 段目から先の名前（空なら `from` そのもの）
    ///
    /// # 戻り値
    ///
    /// 最後の段の宣言（`Found`）、見つからない段の位置（`Missing`）、確かめられない（`Unknown`）のどれか。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def C { part d { port p; } } part def B { part c : C; } part def A { part b : B; }" のとき
    /// follow_chain(b の番号, ["c", "d", "p"]) → Found(p の番号)       // 型 B・C の中をたどる
    /// follow_chain(b の番号, ["c", "x"])      → Missing(1)            // C の中に x が無い
    /// follow_chain(b の番号, [])              → Found(b の番号)
    /// // "part def A { part u; }" の u（型が無く、本体も無い）から
    /// follow_chain(u の番号, ["x"])           → Unknown
    /// ```
    pub(crate) fn follow_chain(&self, from: usize, rest: &[&str]) -> ChainEnd {
        let mut cur = from;
        for (i, seg) in rest.iter().enumerate() {
            match self.feature_named(cur, seg) {
                Ok(Some(c)) => cur = c,
                Ok(None) => return ChainEnd::Missing(i),
                Err(()) => return ChainEnd::Unknown,
            }
        }
        ChainEnd::Found(cur)
    }

    /// 連鎖 `chain` の、最初の段を `head` としたとき、2 段目から先で見つからない段（`skip` 段目より後ろのもの）を、
    /// 問題の文の頭（`「a.b.x」の「x」`）にする。最初の段は呼び出し側が確かめる。
    ///
    /// # 引数
    ///
    /// - `head`：最初の段の宣言の番号。None なら何もしない（最初の段が見つからない）
    /// - `chain`：書いた連鎖（`a.b.x` など）
    /// - `skip`：2 段目から数えて、ほかの検査が確かめる段の数（線の端の 2 段目のポートは 1）
    ///
    /// # 戻り値
    ///
    /// 見つからない段があれば `「連鎖」の「段の名前」`。すべて見つかるか、確かめられなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def C { part d; } part def A { part c : C; }" の A の中で
    /// chain_miss(Some(c の番号), "c.d", 0)   → None
    /// chain_miss(Some(c の番号), "c.x", 0)   → Some("「c.x」の「x」")
    /// chain_miss(Some(c の番号), "c.x", 1)   → None            // 2 段目はほかの検査が確かめる
    /// chain_miss(Some(c の番号), "c.d.y", 1) → None            // d は型も本体も無いので確かめられない
    /// chain_miss(None, "z.q", 0)             → None
    /// ```
    pub(crate) fn chain_miss(
        &self,
        head: Option<usize>,
        chain: &str,
        skip: usize,
    ) -> Option<String> {
        let rest: Vec<&str> = chain.split('.').skip(1).collect();
        match self.follow_chain(head?, &rest) {
            ChainEnd::Missing(i) if i >= skip => Some(format!("「{chain}」の「{}」", rest[i])),
            _ => None,
        }
    }

    /// 宣言 `i` の特性のうち、名前 `nm` のもの。本体・型の定義（とその一般の定義）・部分集合や再定義の相手の順に探す。
    ///
    /// # 引数
    ///
    /// - `i`：中身を探す宣言の番号
    /// - `nm`：探す名前
    ///
    /// # 戻り値
    ///
    /// 見つかれば `Ok(Some(番号))`、探す先がすべてファイルの中にあって無ければ `Ok(None)`。
    /// 探す先にファイルの外のもの（型の無い使用・見つからない型や相手）があり、見つからなければ `Err(())`（確かめられない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def G { port g; } part def T :> G; part def A { part t : T; part u; part w : Lib; }" のとき
    /// feature_named(t の番号, "g") → Ok(Some(g の番号))   // 一般の定義 G から引き継ぐ
    /// feature_named(t の番号, "x") → Ok(None)
    /// feature_named(u の番号, "x") → Err(())             // 型も本体も無い
    /// feature_named(w の番号, "x") → Err(())             // 型がファイルの外
    /// ```
    fn feature_named(&self, i: usize, nm: &str) -> Result<Option<usize>, ()> {
        let mut seen = HashSet::new();
        let mut stack = vec![i];
        let mut known = true;
        while let Some(x) = stack.pop() {
            if !seen.insert(x) {
                continue;
            }
            if let Some(c) = self.child_named(x, nm) {
                return Ok(Some(c));
            }
            let e = self.e(x);
            if !e.is_def {
                match self.type_scope(x) {
                    Some(d) => stack.push(d),
                    // 型がファイルの外にある使用と、型も本体も無い使用（`event occurrence e;` など）の中身は確かめられない
                    None => {
                        if !e.ty.is_empty() || e.children.is_empty() {
                            known = false;
                        }
                    }
                }
            }
            for s in &e.specs {
                let target = if e.is_def {
                    (s.op == "specializes")
                        .then(|| self.def_of(&s.path, e.pe))
                        .flatten()
                } else {
                    self.resolve(&s.target, e.pe)
                };
                match target {
                    Some(t) => stack.push(t),
                    None => known = false,
                }
            }
        }
        if known { Ok(None) } else { Err(()) }
    }
}
