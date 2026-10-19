//! 解析結果から、図に描く要素・関係・問題・フェーズ・保存された図を作る（ADR-0016 の手順 A）。
//!
//! alpha.4 では、暫定コア（`web/src/core/model.ts`・`views.ts`）の振る舞いをそのまま移す。
//! 一致は web の golden.test.ts・spec.test.ts が TS と Rust の両方で確かめる。
//! SysML v2 の意味（名前解決・継承など）に沿った作り直しは、0.1.0 の後に行う。

mod names;
mod types;
mod views;

pub use types::*;
pub use views::{is_standard_view, std_view_label};

use std::collections::{HashMap, HashSet};

use crate::project::{Entry, ParseResult, RelKind, Span};

/// 図に描かない定義の種類（ほかの定義はすべて図に描く要素になる）。
pub(crate) const UNDRAWN_DEF_KINDS: &[&str] = &["metadata def", "view def"];

/// package の直下にあるときだけ図に描く要素になる、使用の種類。
pub(crate) const TOP_USAGE_KINDS: &[&str] = &["part", "requirement"];

/// 部品として持つ（comp の線を引く）使用の種類。
const COMP_KINDS: &[&str] = &[
    "part",
    "requirement",
    "constraint",
    "perform action",
    "exhibit state",
    "analysis",
    "verification",
    "attribute",
    "calc",
    "concern",
    "use case",
    "item",
    "port",
];

/// 標準ライブラリの型か（未定義でも問題にしない）。暫定コアの `isLib`（`web/src/core/model.ts`）と同じ。
/// `…Value`・`…Kind` で終わる名前と、`Real`・`Integer`・`Boolean`・`String`・`Natural`・`Number`・`Complex`・`Anything` を標準とみなす。
///
/// # 引数
///
/// - `t`：型の名前（修飾の無い名前。`ScalarValues::Real` のような修飾名は標準とみなさない）
///
/// # 戻り値
///
/// 標準ライブラリの型なら true、そうでなければ false。
///
/// # 例
///
/// ```text
/// is_lib("Real")      → true
/// is_lib("MassValue") → true    // …Value で終わる
/// is_lib("Engine")    → false
/// is_lib("")          → false   // 空の名前
/// ```
pub fn is_lib(t: &str) -> bool {
    t.ends_with("Value")
        || t.ends_with("Kind")
        || matches!(
            t,
            "Real"
                | "Integer"
                | "Boolean"
                | "String"
                | "Natural"
                | "Number"
                | "Complex"
                | "Anything"
        )
}

/// 種類から色分けの系統を決める。暫定コアの `family`（`web/src/core/model.ts`）と同じ。
/// 種類の頭（`requirement`・`concern`・`verification`・`analysis`・`constraint`・`calc`・`state`・`action`・`use case`・`part`）で決め、定義と使用を区別しない。
///
/// # 引数
///
/// - `kind`：宣言の種類（`part def`・`requirement` など、`Entry.kind` の値）
///
/// # 戻り値
///
/// 系統の名前（`req`・`concern`・`ver`・`con`・`beh`・`part`・`other` のいずれか）。どれにも当たらなければ `other`。
///
/// # 例
///
/// ```text
/// family("requirement def") → "req"
/// family("verification")    → "ver"
/// family("calc def")        → "con"
/// family("state")           → "beh"
/// family("part")            → "part"
/// family("item def")        → "other"   // どの系統にも当たらない
/// ```
pub fn family(kind: &str) -> &'static str {
    let starts = |p: &str| kind.starts_with(p);
    if starts("requirement") {
        "req"
    } else if starts("concern") {
        "concern"
    } else if starts("verification") || starts("analysis") {
        "ver"
    } else if starts("constraint") || starts("calc") {
        "con"
    } else if starts("state") || starts("action") || starts("use case") {
        "beh"
    } else if starts("part") {
        "part"
    } else {
        "other"
    }
}

/// 修飾の並び（`private in` など）に、語 `w` があるか（`\bw\b`）。空白で区切った語と完全に一致するかで調べる。
///
/// # 引数
///
/// - `mods`：修飾の並び（空白区切り。空文字列でもよい）
/// - `w`：探す語（`in`・`out`・`inout` など）
///
/// # 戻り値
///
/// 語が並びの中にあれば true、無ければ false。
///
/// # 例
///
/// ```text
/// has_word("private in", "in") → true
/// has_word("inout", "in")      → false   // 語の一部は数えない
/// has_word("", "out")          → false
/// ```
fn has_word(mods: &str, w: &str) -> bool {
    mods.split_whitespace().any(|x| x == w)
}

/// 解析結果からモデルを作る。暫定コアの `build`（`web/src/core/model.ts`）と同じ振る舞い。
/// 図に描く要素 → ポート → 型付けと部品の線 → 関係の線 → 線の ID → 解析の問題 → フェーズ → view の順に組み立てる。
///
/// # 引数
///
/// - `p`：`project` の解析結果（位置は UTF-16 のオフセット）
///
/// # 戻り値
///
/// 図に描く要素・線・問題・フェーズ・view をまとめたモデル。失敗はせず、見つからない型や相手は `problems` に入れる。
///
/// # 例
///
/// ```text
/// build(project("package P { part def A; attribute def B; metadata def M; view def V; }"))
///   → nodes のキーは ["A", "B"]   // メタデータとビューの定義は描かない
/// build(project("package P { part def A { part y : Nope; } }"))
///   → problems に「型「Nope」が見つかりません（y）」が 1 件（kind は None）
/// ```
pub fn build(p: &ParseResult) -> Model {
    let mut b = Builder::new(p);
    b.nodes();
    b.ports();
    b.usages();
    b.relations();
    b.edge_ids();
    b.parse_problems();
    b.phases();
    views::build_views(&mut b);
    b.model
}

pub(crate) struct Builder<'a> {
    pub(crate) entries: &'a [Entry],
    p: &'a ParseResult,
    /// 名前ごとの宣言（書いた順）。
    pub(crate) by_name: HashMap<&'a str, Vec<usize>>,
    /// 宣言の番号 → 図の要素の番号。
    pub(crate) node_of: HashMap<usize, usize>,
    pub(crate) model: Model,
}

impl<'a> Builder<'a> {
    /// 解析結果から組み立ての状態を作る。名前ごとの宣言の一覧（`by_name`）を書いた順に作り、モデルは空にしておく。
    ///
    /// # 引数
    ///
    /// - `p`：`project` の解析結果
    ///
    /// # 戻り値
    ///
    /// 組み立ての状態。名前の無い宣言は `by_name` に入れない。
    ///
    /// # 例
    ///
    /// ```text
    /// Builder::new(project("package P { part def A; } package Q { part def A; }"))
    ///   → by_name["A"] = [P の中の A の番号, Q の中の A の番号]、by_name["P"] = [P の番号]
    /// ```
    fn new(p: &'a ParseResult) -> Self {
        let mut by_name: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, e) in p.entries.iter().enumerate() {
            if !e.name.is_empty() {
                by_name.entry(e.name.as_str()).or_default().push(i);
            }
        }
        Self {
            entries: &p.entries,
            p,
            by_name,
            node_of: HashMap::new(),
            model: Model::default(),
        }
    }

    /// 宣言の番号から宣言を取り出す。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号（`ParseResult.entries` の添字。範囲外なら panic するので、解析結果から得た番号だけを渡す）
    ///
    /// # 戻り値
    ///
    /// その番号の宣言。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; }" で、A の番号を i とすると
    /// e(i) → name が "A"、kind が "part def" の宣言
    /// ```
    fn e(&self, i: usize) -> &'a Entry {
        &self.entries[i]
    }

    /// 問題一覧に 1 行加える（モデルの `problems` を書き換える）。
    ///
    /// # 引数
    ///
    /// - `pos`：問題の位置（UTF-16 のオフセット）
    /// - `msg`：画面に出す文
    /// - `kind`：問題の種類。None はエラー、`Some("gap")` はトレースの抜け、`Some("unsupported")` はまだ扱えない構文
    pub(crate) fn problem(&mut self, pos: usize, msg: String, kind: Option<&'static str>) {
        self.model.problems.push(Problem { pos, msg, kind });
    }

    /// 図に描く要素（定義と、package の直下の部品・要求）。
    fn nodes(&mut self) {
        let mut keys = HashSet::new();
        let entries = self.entries;
        for (i, e) in entries.iter().enumerate() {
            if e.name.is_empty() {
                continue;
            }
            // メタデータとビューの定義は、図に描く要素ではない
            let def = e.is_def && !UNDRAWN_DEF_KINDS.contains(&e.kind.as_str());
            let top = TOP_USAGE_KINDS.contains(&e.kind.as_str())
                && e.pe.is_some_and(|pe| self.entries[pe].kind == "package");
            if !(def || top) {
                continue;
            }
            let mut key = e.name.clone();
            if keys.contains(&key) {
                key = format!(
                    "{}@{}",
                    e.name,
                    e.pe.map_or("", |pe| self.entries[pe].name.as_str())
                );
            }
            keys.insert(key.clone());
            self.node_of.insert(i, self.model.nodes.len());
            self.model.nodes.push(Node {
                key,
                name: e.name.clone(),
                short: e.short.clone(),
                kind: e.kind.clone(),
                is_def: e.is_def,
                entry: i,
                fam: family(&e.kind),
                trans: Vec::new(),
                ports: Vec::new(),
                phase: None,
                phase_own: false,
            });
        }
    }

    /// 名前 `nm` の最初の定義（書いた順で最初の `… def`）。暫定コアの `defNamed` と同じ。
    /// その名前の定義が無ければ、同じファイルの別名（`alias nm for …;`）の指す先の定義を返す。
    ///
    /// # 引数
    ///
    /// - `nm`：探す名前（修飾の無い名前）
    ///
    /// # 戻り値
    ///
    /// 定義の宣言の番号。その名前の定義も、定義を指す別名も無ければ None（同じ名前の使用だけがあっても None）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; part a : A; alias B for A; }" のとき
    /// def_named("A") → Some(part def A の番号)
    /// def_named("B") → Some(part def A の番号)   // 別名
    /// def_named("a") → None   // 使用だけ
    /// def_named("Z") → None   // 名前が無い
    /// ```
    pub(crate) fn def_named(&self, nm: &str) -> Option<usize> {
        self.by_name
            .get(nm)
            .and_then(|l| l.iter().copied().find(|&i| self.e(i).is_def))
            .or_else(|| self.alias_anywhere(nm, 0).filter(|&i| self.e(i).is_def))
    }

    /// 宣言の中身を探す範囲（定義はそれ自身、使用は型の定義）。暫定コアの `typeScope` と同じ。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号（`ParseResult.entries` の添字）
    ///
    /// # 戻り値
    ///
    /// 中身を探す定義の番号。型の無い使用や、型の定義が見つからない使用なら None。型が修飾名なら `def_of` で探す。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; part a : A; part b; part c : Z; }" のとき
    /// type_scope(A の番号) → Some(A の番号)   // 定義はそれ自身
    /// type_scope(a の番号) → Some(A の番号)   // 型の定義
    /// type_scope(b の番号) → None             // 型が無い
    /// type_scope(c の番号) → None             // 型の定義が見つからない
    /// ```
    fn type_scope(&self, i: usize) -> Option<usize> {
        let e = self.e(i);
        if e.is_def {
            Some(i)
        } else if e.ty.is_empty() {
            None
        } else {
            self.def_of(&e.ty_path, e.pe)
        }
    }

    /// 宣言の直下の中身から、名前 `nm` のものを探す（孫より深くは探さない）。
    ///
    /// # 引数
    ///
    /// - `i`：中身を探す宣言の番号
    /// - `nm`：探す名前
    ///
    /// # 戻り値
    ///
    /// 最初に見つかった中身の番号。無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def H { part s : S { part t; } }" のとき
    /// child_named(H の番号, "s") → Some(s の番号)
    /// child_named(H の番号, "t") → None   // 孫は探さない
    /// ```
    fn child_named(&self, i: usize, nm: &str) -> Option<usize> {
        self.e(i)
            .children
            .iter()
            .copied()
            .find(|&c| self.e(c).name == nm)
    }

    /// 文の持ち主から外へ向かって名前を探し、無ければ全体から探す（図の要素を優先する）。暫定コアの `findFirst` と同じ。
    /// 外へたどる各段では、直下の中身 → その宣言自身の名前 → その宣言に書いた別名の順に比べる。
    /// 全体にも無ければ、ファイルのどこかに書いた同じ名前の別名の指す先を返す。
    ///
    /// # 引数
    ///
    /// - `nm`：探す名前（修飾の無い名前）
    /// - `ctx`：探し始める宣言の番号（文の持ち主）。None なら全体からだけ探す
    /// - `depth`：ここまでにたどった別名の数（別名の輪で止まらないように数える。最初は 0）
    ///
    /// # 戻り値
    ///
    /// 見つかった宣言の番号。全体から探すときは、図の要素になった宣言を優先し、無ければ書いた順で最初の宣言。どこにも無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A { part b; } part def C { part b; } alias D for A; }" のとき
    /// find_first_at("b", Some(C の番号), 0) → Some(C の中の b の番号)   // 持ち主の中を優先
    /// find_first_at("A", None, 0)           → Some(A の番号)
    /// find_first_at("D", Some(C の番号), 0) → Some(A の番号)            // 別名
    /// find_first_at("Z", Some(C の番号), 0) → None
    /// ```
    fn find_first_at(&self, nm: &str, ctx: Option<usize>, depth: usize) -> Option<usize> {
        let mut a = ctx;
        while let Some(i) = a {
            if let Some(c) = self.child_named(i, nm) {
                return Some(c);
            }
            if self.e(i).name == nm {
                return Some(i);
            }
            if let Some(c) = self.alias_named(Some(i), nm, depth) {
                return Some(c);
            }
            a = self.e(i).pe;
        }
        let Some(list) = self.by_name.get(nm) else {
            return self.alias_anywhere(nm, depth);
        };
        list.iter()
            .copied()
            .find(|i| self.node_of.contains_key(i))
            .or_else(|| list.first().copied())
    }

    /// `a.b.c` の参照をたどる。暫定コアの `resolve` と同じ。
    /// 最初の段は `lookup` で探し（修飾の無い名前は `find_first_at` と同じ、`P::a` は `P` を持ち主から外へ探して中へたどる）、
    /// 以降の段は直下の中身、無ければ型の定義の中身から探す。
    ///
    /// # 引数
    ///
    /// - `chain`：`.` でつないだ参照（`s.o.y` など。最初の段は `::` の修飾名でもよい）
    /// - `ctx`：探し始める宣言の番号（文の持ち主）。None なら全体から探す
    ///
    /// # 戻り値
    ///
    /// 最後の段の宣言の番号。途中の段が見つからなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def S { port o; } part def H { part s : S; }" のとき
    /// resolve("s.o", Some(H の番号)) → Some(S の中の o の番号)   // s の型 S の中から探す
    /// resolve("s.x", Some(H の番号)) → None
    /// // "package X { requirement def R; } package P { requirement def R; }" の P の中から
    /// resolve("X::R", Some(P の番号)) → Some(X の中の R の番号)
    /// resolve("Nope::R", Some(P の番号)) → None
    /// ```
    fn resolve(&self, chain: &str, ctx: Option<usize>) -> Option<usize> {
        let mut segs = chain.split('.');
        let first = segs.next().unwrap_or("");
        let mut cur = self.lookup(first, ctx);
        for seg in segs {
            let c = cur?;
            cur = self
                .child_named(c, seg)
                .or_else(|| self.type_scope(c).and_then(|s| self.child_named(s, seg)));
        }
        cur
    }

    /// 宣言を描く図の要素（使用なら型の定義の要素）。暫定コアの `nodeFor` と同じ。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号。None なら None を返す
    ///
    /// # 戻り値
    ///
    /// 図の要素の番号（`model.nodes` の添字）。宣言もその型の定義も図の要素でなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def S; part def H { part s : S; } }" のとき
    /// node_for(Some(H の番号)) → Some(H の要素の番号)
    /// node_for(Some(s の番号)) → Some(S の要素の番号)   // 使用は型の定義の要素
    /// node_for(None)           → None
    /// ```
    fn node_for(&self, i: Option<usize>) -> Option<usize> {
        let i = i?;
        self.node_of.get(&i).copied().or_else(|| {
            self.type_scope(i)
                .and_then(|d| self.node_of.get(&d).copied())
        })
    }

    /// 宣言を含む、いちばん近い図の要素（宣言自身が要素ならそれ）。暫定コアの `nodeAncestor` と同じ。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号。None なら None を返す
    ///
    /// # 戻り値
    ///
    /// 図の要素の番号（`model.nodes` の添字）。外側にも図の要素が無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def H { part s; } }" のとき
    /// node_ancestor(Some(s の番号)) → Some(H の要素の番号)
    /// node_ancestor(Some(P の番号)) → None   // package は図の要素ではない
    /// ```
    fn node_ancestor(&self, i: Option<usize>) -> Option<usize> {
        let mut a = i;
        while let Some(x) = a {
            if let Some(&n) = self.node_of.get(&x) {
                return Some(n);
            }
            a = self.e(x).pe;
        }
        None
    }

    /// 関係（verify・frame）の線を引く元の図の要素。`node_ancestor` で見つからなければ、外へ向かって最初に
    /// 型の定義が図の要素になっている使用の、その要素にする（`verification v : VD { objective { verify R; } }` の VD）。
    ///
    /// # 引数
    ///
    /// - `i`：関係の文の持ち主の宣言の番号。None なら None を返す
    ///
    /// # 戻り値
    ///
    /// 図の要素の番号（`model.nodes` の添字）。外側にも、外側の使用の型にも図の要素が無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { verification def VD; verification v : VD { … } verification w { … } }" のとき
    /// owner_node(Some(v の番号)) → Some(VD の要素の番号)   // v は図の要素ではないので、型の VD
    /// owner_node(Some(w の番号)) → None                    // 型が無い
    /// // "package P { part def H { part s : S; } }" のとき
    /// owner_node(Some(s の番号)) → Some(H の要素の番号)    // これまでどおり外側の要素を優先
    /// ```
    fn owner_node(&self, i: Option<usize>) -> Option<usize> {
        self.node_ancestor(i).or_else(|| {
            let mut a = i;
            while let Some(x) = a {
                if let Some(&n) = self.type_scope(x).and_then(|t| self.node_of.get(&t)) {
                    return Some(n);
                }
                a = self.e(x).pe;
            }
            None
        })
    }

    /// 図の線を 1 本加える（モデルの `edges` を書き換える）。暫定コアの `addEdge` と同じ。
    /// ID は空のまま加え、`edge_ids` で後から付ける。
    ///
    /// # 引数
    ///
    /// - `kind`：線の種類（`defined`・`comp`・`satisfy`・`verify`・`frame`・`flow`・`derive`）
    /// - `from`・`to`：線の両端の図の要素の番号（`model.nodes` の添字。範囲外なら panic する）
    /// - `label`：線のラベル（無ければ空文字列）
    /// - `src`：線のもとになった文の範囲（UTF-16 のオフセット）
    ///
    /// # 戻り値
    ///
    /// 加えた線の番号（`model.edges` の添字）。
    ///
    /// # 例
    ///
    /// ```text
    /// // nodes[0].key = "a"、nodes[1].key = "A"、edges が空のとき
    /// add_edge("defined", 0, 1, "", src) → 0   // edges[0] は from "a"・to "A"・id ""
    /// ```
    fn add_edge(
        &mut self,
        kind: &'static str,
        from: usize,
        to: usize,
        label: String,
        src: Span,
    ) -> usize {
        let (from, to) = (
            self.model.nodes[from].key.clone(),
            self.model.nodes[to].key.clone(),
        );
        self.model.edges.push(Edge {
            id: String::new(),
            kind,
            from,
            to,
            label,
            src,
            rel: None,
            from_port: None,
            to_port: None,
        });
        self.model.edges.len() - 1
    }

    /// ポートの向き。修飾の向きを優先し、無ければポートの定義の中身から決め、共役なら反転する。暫定コアの `portDir` と同じ。
    /// 定義の中身に `out` だけがあれば `out`、`in` だけがあれば `in`、両方か無ければ `inout`。
    ///
    /// # 引数
    ///
    /// - `c`：ポートの使用の宣言の番号
    ///
    /// # 戻り値
    ///
    /// `in`・`out`・`inout` のいずれか。ポートの定義が見つからなければ `inout`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "port def Pt { in item x : Real; } part def H { port a : Pt; port b : ~Pt; port c : Nope; }" のとき
    /// port_dir(a の番号) → "in"
    /// port_dir(b の番号) → "out"     // 共役（~）で反転
    /// port_dir(c の番号) → "inout"   // 定義が見つからない
    /// ```
    fn port_dir(&self, c: usize) -> &'static str {
        let e = self.e(c);
        let m = e.mods.as_deref().unwrap_or("");
        if has_word(m, "inout") {
            return "inout";
        }
        if has_word(m, "out") {
            return "out";
        }
        if has_word(m, "in") {
            return "in";
        }
        let Some(pd) = self.def_of(&e.ty_path, e.pe) else {
            return "inout";
        };
        let ds: Vec<&str> = self
            .e(pd)
            .children
            .iter()
            .map(|&x| {
                let x = self.e(x);
                x.mods
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .or(x.dir.as_deref())
                    .unwrap_or("")
            })
            .collect();
        let has_o = ds.iter().any(|d| has_word(d, "out"));
        let has_i = ds.iter().any(|d| has_word(d, "in"));
        let base = if has_o && !has_i {
            "out"
        } else if has_i && !has_o {
            "in"
        } else {
            "inout"
        };
        match (e.conj.unwrap_or(false), base) {
            (true, "out") => "in",
            (true, "in") => "out",
            _ => base,
        }
    }

    /// 図の要素ごとに、直下にある名前付きのポートを集めて `ports` に入れる（モデルの `nodes` を書き換える）。向きは `port_dir` で決める。
    fn ports(&mut self) {
        for n in 0..self.model.nodes.len() {
            let entry = self.model.nodes[n].entry;
            let ports = self
                .e(entry)
                .children
                .iter()
                .copied()
                .filter(|&c| self.e(c).kind == "port" && !self.e(c).name.is_empty())
                .map(|c| {
                    let e = self.e(c);
                    Port {
                        name: e.name.clone(),
                        ty: e.ty.clone(),
                        conj: e.conj.unwrap_or(false),
                        dir: self.port_dir(c),
                        entry: c,
                    }
                })
                .collect();
            self.model.nodes[n].ports = ports;
        }
    }

    /// 型付けの線（defined）と、部品として持つ線（comp）。見つからない型は問題にする。
    /// 標準ライブラリの型・`subject`・標準ビュー定義を型にした view は、型が見つからなくても問題にしない（モデルの `edges`・`problems` を書き換える）。
    fn usages(&mut self) {
        let entries = self.entries;
        for (i, u) in entries.iter().enumerate() {
            if u.is_def || u.ty.is_empty() || u.kind == "package" {
                continue;
            }
            let Some(t) = self.def_of(&u.ty_path, u.pe) else {
                if !is_lib(&u.ty)
                    && u.kind != "subject"
                    && !(u.kind == "view" && is_standard_view(&u.ty))
                {
                    let who = if u.name.is_empty() { &u.kind } else { &u.name };
                    self.problem(
                        u.start,
                        format!("型「{}」が見つかりません（{who}）", u.ty_path),
                        None,
                    );
                }
                continue;
            };
            let tn = self.node_of.get(&t).copied();
            let un = self.node_of.get(&i).copied();
            let pn = u.pe.and_then(|pe| self.node_of.get(&pe).copied());
            let src = Span {
                start: u.start,
                end: u.end,
            };
            if let Some(un) = un {
                if let Some(tn) = tn {
                    self.add_edge("defined", un, tn, String::new(), src);
                }
            } else if let (true, Some(pn), Some(tn)) =
                (COMP_KINDS.contains(&u.kind.as_str()), pn, tn)
                && u.pe != Some(t)
            {
                self.add_edge("comp", pn, tn, u.name.clone(), src);
            }
        }
    }

    /// 関係（satisfy・verify・frame・flow・connect・derivation・message・transition）を線や遷移にする。
    /// 相手が見つからない関係は問題にする（モデルの `edges`・`nodes` の `trans`・`problems` を書き換える）。暫定コアの `build` の関係の処理と同じ。
    fn relations(&mut self) {
        let p = self.p;
        for (ri, r) in p.rels.iter().enumerate() {
            let src = Span {
                start: r.start,
                end: r.end + 1,
            };
            let pe = r.pe;
            match &r.kind {
                RelKind::Satisfy { req, by } => {
                    let a = self.node_for(self.resolve(by, pe));
                    let b = self.node_for(self.resolve(req, pe));
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            self.add_edge("satisfy", a, b, "«satisfy»".into(), src);
                        }
                        _ => {
                            let who = if b.is_none() { req } else { by };
                            self.problem(
                                r.start,
                                format!("「満たす」関係の相手「{who}」が見つかりません（satisfy）"),
                                None,
                            );
                        }
                    }
                }
                RelKind::Verify { req } => {
                    let a = self.owner_node(pe);
                    let b = self.node_for(self.resolve(req, pe));
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            self.add_edge("verify", a, b, "«verify»".into(), src);
                        }
                        // 相手はあるが、線を引く元が図に無い（型の無い使用の中など）。相手が無いとは言わない
                        (None, Some(_)) => {}
                        _ => self.problem(
                            r.start,
                            format!("「検証する」関係の相手「{req}」が見つかりません（verify）"),
                            None,
                        ),
                    }
                }
                RelKind::Frame { ty, path, .. } => {
                    let a = self.owner_node(pe);
                    let tn = self
                        .def_of(path, pe)
                        .and_then(|t| self.node_of.get(&t).copied());
                    match (a, tn) {
                        (Some(a), Some(tn)) => {
                            self.add_edge("frame", a, tn, "«frame»".into(), src);
                        }
                        (None, Some(_)) => {}
                        _ => {
                            let shown = if path.is_empty() { ty } else { path };
                            self.problem(
                                r.start,
                                format!("扱う関心事「{shown}」が見つかりません（frame）"),
                                None,
                            );
                        }
                    }
                }
                RelKind::Flow { item, a: ra, b: rb }
                | RelKind::Connect {
                    item, a: ra, b: rb, ..
                } => {
                    let rel = if matches!(r.kind, RelKind::Connect { .. }) {
                        "connect"
                    } else {
                        "flow"
                    };
                    let pa: Vec<&str> = ra.split('.').collect();
                    let pb: Vec<&str> = rb.split('.').collect();
                    let a = self.node_for(self.resolve(pa[0], pe));
                    let b = self.node_for(self.resolve(pb[0], pe));
                    let s = match &r.kind {
                        RelKind::Connect { usage, .. } => Span {
                            start: p.entries[*usage].start,
                            end: p.entries[*usage].end,
                        },
                        _ => src,
                    };
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            let ed = self.add_edge("flow", a, b, item.clone(), s);
                            self.model.edges[ed].rel = Some(ri);
                            self.port_end(ed, a, pa.get(1).copied(), true, r.start);
                            self.port_end(ed, b, pb.get(1).copied(), false, r.start);
                        }
                        _ => {
                            let who = if a.is_none() { ra } else { rb };
                            self.problem(
                                r.start,
                                format!("線の接続先「{who}」が見つかりません（{rel}）"),
                                None,
                            );
                        }
                    }
                }
                RelKind::Derive { a: ra, b: rb } => {
                    let a = self.node_for(self.resolve(ra, pe));
                    let b = self.node_for(self.resolve(rb, pe));
                    match (a, b) {
                        (Some(a), Some(b)) => {
                            self.add_edge("derive", a, b, "«derive»".into(), src);
                        }
                        _ => {
                            let who = if a.is_none() { ra } else { rb };
                            self.problem(
                                r.start,
                                format!(
                                    "「導出」関係の相手「{who}」が見つかりません（derivation）"
                                ),
                                None,
                            );
                        }
                    }
                }
                RelKind::Message { a: ra, b: rb, .. } => {
                    for x in [ra, rb] {
                        let seg = x.split('.').next().unwrap_or("");
                        if pe.and_then(|pe| self.child_named(pe, seg)).is_none() {
                            let owner = pe.map_or("", |pe| self.e(pe).name.as_str());
                            self.problem(r.start, format!("メッセージの相手「{seg}」が「{owner}」の中にありません（message）"), None);
                        }
                    }
                }
                RelKind::Transition { from, ev, to } => {
                    if let Some(a) = self.node_ancestor(pe) {
                        let ev = if ev.is_empty() {
                            String::new()
                        } else {
                            format!("  [{ev}]")
                        };
                        self.model.nodes[a].trans.push(format!("{from} → {to}{ev}"));
                    }
                }
                RelKind::Dependency { .. } => {}
            }
        }
    }

    /// 流れの端のポート（`a.p` の `p`）。要素にポートがあればそこにつなぎ、ポートでも中身でもなければ問題にする。
    /// つないだ端には `port:p` を `from_port`／`to_port` に入れる（モデルの `edges`・`problems` を書き換える）。`seg` が None なら何もしない。
    ///
    /// # 引数
    ///
    /// - `ed`：線の番号（`model.edges` の添字）
    /// - `nd`：端の図の要素の番号（`model.nodes` の添字）
    /// - `seg`：参照の 2 段目（`a.p` の `p`）。None なら要素そのものにつなぐ
    /// - `from`：true なら始まりの端、false なら終わりの端
    /// - `pos`：問題にするときの位置（UTF-16 のオフセット）
    fn port_end(&mut self, ed: usize, nd: usize, seg: Option<&str>, from: bool, pos: usize) {
        let Some(seg) = seg else { return };
        let node = &self.model.nodes[nd];
        if node.ports.iter().any(|p| p.name == seg) {
            let port = Some(format!("port:{seg}"));
            if from {
                self.model.edges[ed].from_port = port;
            } else {
                self.model.edges[ed].to_port = port;
            }
        } else if self.child_named(node.entry, seg).is_none() {
            let msg = format!("ポート「{seg}」が {} にありません", node.name);
            self.problem(pos, msg, None);
        }
    }

    /// 線の ID（種類・両端・ラベルが同じ線には、出てきた順に番号を付ける）。形は `種類|from|to|ラベル#番号`（`comp|A|B|b#1` など）で、モデルの `edges` を書き換える。
    fn edge_ids(&mut self) {
        let mut seen: HashMap<String, usize> = HashMap::new();
        for e in &mut self.model.edges {
            let base = format!("{}|{}|{}|{}", e.kind, e.from, e.to, e.label);
            let k = seen.entry(base.clone()).or_insert(0);
            *k += 1;
            e.id = format!("{base}#{k}");
        }
    }

    /// 構文解析のエラーと、まだ扱えない構文を問題一覧に加える（モデルの `problems` を書き換える）。
    /// まだ扱えない構文は、頭を UTF-16 で 40 単位までに切って示し、種類を `unsupported` にする。
    fn parse_problems(&mut self) {
        let p = self.p;
        for e in &p.errors {
            self.problem(e.pos, e.msg.clone(), None);
        }
        // 黙って捨てず、まだ扱えない構文があることを知らせる（ADR-0013）
        for u in &p.unsupported {
            let head = truncate_utf16(&u.head, 40);
            self.problem(
                u.start,
                format!("「{head}」は Modelith ではまだ扱えないため、図とツリーに出ません"),
                Some("unsupported"),
            );
        }
    }

    /// フェーズ（`metadata def Phase { attribute stage : K; }` と列挙 K）と、要素ごとのフェーズ、トレースの抜け。
    /// 列挙に値があれば `phases`・`phase_enum` を入れ、要素ごとに `phase`・`phase_own` を入れ、`trace_gaps` で抜けを問題にする（モデルを書き換える）。
    fn phases(&mut self) {
        let pmd = self.by_name.get("Phase").and_then(|l| {
            l.iter()
                .copied()
                .find(|&i| self.e(i).kind == "metadata def")
        });
        let en = pmd
            .and_then(|m| self.child_named(m, "stage"))
            .and_then(|st| self.def_of(&self.e(st).ty_path, self.e(st).pe));
        if let Some(en) = en {
            let e = self.e(en);
            if let Some(vs) = e.enum_values.as_ref().filter(|v| !v.is_empty()) {
                self.model.phases = Some(vs.clone());
                self.model.phase_enum = Some(e.name.clone());
            }
        }
        for n in 0..self.model.nodes.len() {
            let entry = self.model.nodes[n].entry;
            if let Some((value, holder)) = self.phase_of(entry) {
                self.model.nodes[n].phase = Some(value);
                self.model.nodes[n].phase_own = holder == entry;
            }
        }
        if let Some(phases) = self.model.phases.clone() {
            self.trace_gaps(&phases);
        }
    }

    /// 宣言のフェーズと、それを書いた宣言（自分か、外側の宣言から受け継ぐ）。暫定コアの `phaseOf` と同じ。
    /// `@Phase { stage = … }` の値が空でない、いちばん近い宣言を外へ向かって探す。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    ///
    /// # 戻り値
    ///
    /// フェーズの値と、それを書いた宣言の番号の組。自分にも外側にも無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "requirement def R2 { @Phase { stage = detail; } }" のとき
    /// phase_of(R2 の番号) → Some(("detail", R2 の番号))
    /// // "package P { part def A; }" のとき
    /// phase_of(A の番号)  → None
    /// ```
    fn phase_of(&self, i: usize) -> Option<(String, usize)> {
        let mut a = Some(i);
        while let Some(x) = a {
            let stage = self
                .e(x)
                .meta
                .as_ref()
                .and_then(|m| m.0.iter().find(|(k, _)| k == "Phase"))
                .and_then(|(_, v)| v.0.iter().find(|(k, _)| k == "stage"))
                .map(|(_, v)| v.as_str())
                .filter(|s| !s.is_empty());
            if let Some(s) = stage {
                return Some((s.to_owned(), x));
            }
            a = self.e(x).pe;
        }
        None
    }

    /// フェーズに沿った要求のトレースの抜け（導出・充足・検証）を問題として加える。暫定コアの `addTraceGaps` と同じ。
    /// 最初のフェーズの要求定義は下位への展開（derive の終わりの端）が無いことを、それ以外のフェーズの要求定義は導出元・満たす要素・検証が無いことを、種類 `gap` の問題にする（モデルの `problems` を書き換える）。
    ///
    /// # 引数
    ///
    /// - `phases`：フェーズの値（列挙の値を書いた順。先頭が最上位のフェーズ）
    fn trace_gaps(&mut self, phases: &[String]) {
        let has = |edges: &[Edge], kind: &str, from: bool, key: &str| {
            edges
                .iter()
                .any(|e| e.kind == kind && if from { e.from == key } else { e.to == key })
        };
        let mut gaps = Vec::new();
        for n in &self.model.nodes {
            let Some(phase) = n.phase.as_ref().filter(|_| n.kind == "requirement def") else {
                continue;
            };
            let Some(i) = phases.iter().position(|p| p == phase) else {
                continue;
            };
            let label = if n.short.is_empty() {
                n.name.clone()
            } else {
                format!("<'{}'>", n.short)
            };
            let pos = self.e(n.entry).start;
            let mut gap = |msg: &str| gaps.push((pos, format!("{label} {}：{msg}", n.name)));
            let edges = &self.model.edges;
            if i == 0 {
                if !has(edges, "derive", false, &n.key) {
                    gap("どの下位の要求にも展開されていません（derivation）");
                }
            } else {
                if !has(edges, "derive", true, &n.key) {
                    gap("導出元の上位の要求がありません（derivation）");
                }
                if !has(edges, "satisfy", false, &n.key) {
                    gap("この要求を満たす要素がありません（satisfy）");
                }
                if !has(edges, "verify", false, &n.key) {
                    gap("この要求を確かめる検証がありません（verify）");
                }
            }
        }
        for (pos, msg) in gaps {
            self.problem(pos, msg, Some("gap"));
        }
    }
}

/// UTF-16 で `max` 単位を超える文字列を切り、「…」を付ける（JS の `slice(0, max) + "…"` と同じ）。
/// ただし文字の途中では切らない（サロゲートペアの文字が境界をまたぐときは、その文字を含めない）。
///
/// # 引数
///
/// - `s`：元の文字列
/// - `max`：残す長さの上限（UTF-16 の単位の数）
///
/// # 戻り値
///
/// `max` 単位以内ならそのままの文字列、超えるなら先頭を残して「…」を付けた文字列。
///
/// # 例
///
/// ```text
/// truncate_utf16("abc", 3)  → "abc"    // ちょうど上限
/// truncate_utf16("abcd", 3) → "abc…"
/// truncate_utf16("🚀🚀", 3)  → "🚀…"    // 2 つ目の 🚀 は境界をまたぐので含めない
/// ```
fn truncate_utf16(s: &str, max: usize) -> String {
    if s.encode_utf16().count() <= max {
        return s.to_owned();
    }
    let mut n = 0;
    let mut out = String::new();
    for c in s.chars() {
        n += c.len_utf16();
        if n > max {
            break;
        }
        out.push(c);
    }
    out.push('…');
    out
}

#[cfg(test)]
mod tests;
