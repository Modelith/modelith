//! 解析結果から、図に描く要素・関係・問題・フェーズ・保存された図を作る（ADR-0016 の手順 A）。
//!
//! alpha.4 で、暫定の TS コア（ADR-0009。beta.1 で削除）のモデル構築の振る舞いをそのまま移した。
//! 「暫定コアの X と同じ」は、移した元の関数の名前を指す。
//! ゴールデンと仕様のケースとの一致は、web の golden.test.ts・spec.test.ts が確かめる。
//! SysML v2 の意味（名前解決・継承など）に沿った作り直しは、0.1.0 の後に行う。

mod chains;
mod filters;
mod flows;
mod focus;
mod names;
mod sequences;
mod states;
mod types;
mod views;

pub(crate) use names::resolve_refs;
pub use types::*;
pub(crate) use views::metaclass_kind;
pub use views::{is_standard_view, std_view_label};

use std::collections::{HashMap, HashSet};

use crate::project::{Entry, ParseResult, RelKind, Span, merge};

/// 図に描かない定義の種類（ほかの定義はすべて図に描く要素になる）。ツリーにだけ出す。
/// `def` は、基の種類の決まらない利用者定義のキーワードの定義（`#X def H;`）。
pub(crate) const UNDRAWN_DEF_KINDS: &[&str] = &[
    "metadata def",
    "view def",
    "case def",
    "viewpoint def",
    "rendering def",
    "def",
];

/// package の直下にあるときだけ図に描く要素になる、使用の種類。
pub(crate) const TOP_USAGE_KINDS: &[&str] = &[
    "part",
    "requirement",
    "verification",
    "analysis",
    "action",
    "item",
    "state",
];

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

/// 標準ライブラリの型のうち、`import` を解決しなくても「型が見つかりません」と言わない名前。
/// SysML-v2-Release 2026-08 の `sysml.library` にあることを確かめたものだけを入れる
/// （Base・ScalarValues・Occurrences、Systems Library の各パッケージの基の定義、VerificationCases、Time）。
const LIBRARY_TYPES: &[&str] = &[
    // Base・ScalarValues・Occurrences（Kernel Libraries）
    "Anything",
    "DataValue",
    "ScalarValue",
    "Boolean",
    "String",
    "NumericalValue",
    "Number",
    "Complex",
    "Real",
    "Rational",
    "Integer",
    "Natural",
    "Positive",
    "Occurrence",
    // Systems Library の基の定義
    "Part",
    "Item",
    "Action",
    "StateAction",
    "Port",
    "Connection",
    "Interface",
    "Allocation",
    "Calculation",
    "ConstraintCheck",
    "RequirementCheck",
    "Case",
    "AnalysisCase",
    "VerificationCase",
    "UseCase",
    "View",
    "Rendering",
    "MetadataItem",
    // VerificationCases
    "VerdictKind",
    "VerificationMethodKind",
    // Time（Quantities and Units）
    "TimeInstantValue",
    "DateTime",
    "Date",
    "TimeOfDay",
    "UtcTimeInstantValue",
    "Iso8601DateTime",
];

/// メタクラスのライブラリのパッケージ（Systems Library の `SysML`・Kernel Semantic Library の `KerML`）。
const METACLASS_PACKAGES: &[&str] = &["SysML", "KerML"];

/// 量と単位のライブラリのパッケージ（Domain Libraries/Quantities and Units）。これを `import` したファイルと、
/// これで修飾した名前（`ISQ::MassValue`）では、`…Value`・`…Kind` で終わる名前を標準ライブラリの型とみなす。
const QUANTITY_PACKAGES: &[&str] = &[
    "ISQ",
    "ISQAcoustics",
    "ISQAtomicNuclear",
    "ISQBase",
    "ISQCharacteristicNumbers",
    "ISQChemistryMolecular",
    "ISQCondensedMatter",
    "ISQElectromagnetism",
    "ISQInformation",
    "ISQLight",
    "ISQMechanics",
    "ISQSpaceTime",
    "ISQThermodynamics",
    "SI",
    "SIPrefixes",
    "USCustomaryUnits",
    "Quantities",
    "QuantityCalculations",
    "MeasurementReferences",
    "MeasurementRefCalculations",
    "Time",
    "TensorCalculations",
    "VectorCalculations",
];

/// 修飾名の最初の段が、量と単位のライブラリのパッケージ（`QUANTITY_PACKAGES`）か。
///
/// # 引数
///
/// - `path`：修飾名（`ISQ::MassValue`・`ISQ` など。引用符を外したもの）
///
/// # 戻り値
///
/// 最初の段が表にあれば true。
///
/// # 例
///
/// ```text
/// is_quantity_path("ISQ::MassValue") → true
/// is_quantity_path("SI")             → true
/// is_quantity_path("MyLib::Value")   → false
/// ```
fn is_quantity_path(path: &str) -> bool {
    let first = path.split("::").next().unwrap_or("");
    QUANTITY_PACKAGES.contains(&first)
}

/// 標準ライブラリの型か（未定義でも問題にしない。ライブラリは同梱していないので名前で判定する）。
///
/// 最後の名前が `LIBRARY_TYPES` にあれば標準とみなす（`ScalarValues::Real` も）。メタクラスのライブラリ
/// （`SysML::PartDefinition`・`KerML::Feature` のように `SysML`・`KerML` で修飾した名前。メタデータの定義の
/// `:>> annotatedElement : SysML::PartDefinition;` などに書く）も標準とみなす。`…Value`・`…Kind` で終わる名前は、
/// ファイルが量と単位のライブラリ（ISQ・SI など）を `import` しているか、名前をそのパッケージで修飾しているときだけ標準とみなす。
///
/// # 引数
///
/// - `path`：型の名前（書いた修飾名のまま。引用符は外したもの）
/// - `quantities_imported`：ファイルが量と単位のライブラリを `import` しているか
///
/// # 戻り値
///
/// 標準ライブラリの型なら true、そうでなければ false。
///
/// # 例
///
/// ```text
/// is_lib("Real", false)            → true
/// is_lib("Positive", false)        → true
/// is_lib("MassValue", true)        → true    // ISQ などを import している
/// is_lib("MassValue", false)       → false   // import が無い
/// is_lib("ISQ::MassValue", false)  → true    // 量のパッケージで修飾している
/// is_lib("SysML::PartDefinition", false) → true   // メタクラス
/// is_lib("MyTypoValue", false)     → false
/// is_lib("", false)                → false   // 空の名前
/// ```
pub fn is_lib(path: &str, quantities_imported: bool) -> bool {
    let name = path.rsplit("::").next().unwrap_or(path);
    if LIBRARY_TYPES.contains(&name)
        || METACLASS_PACKAGES
            .iter()
            .any(|p| path.strip_prefix(p).is_some_and(|r| r.starts_with("::")))
    {
        return true;
    }
    let qualified = path.contains("::");
    (name.ends_with("Value") || name.ends_with("Kind"))
        && (quantities_imported || (qualified && is_quantity_path(path)))
}

/// 種類から色分けの系統を決める。web の種類のアイコンの色（`web/src/app/svg.ts` の `family`）と同じ。
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

/// 解析結果からモデルを作る。暫定コアの `build` から移した振る舞い。
/// 図に描く要素 → ポート → 型付けと部品の線 → 関係の線 → 特殊化の線 → 線の ID → メモ → アクションの流れ → 解析の問題 → フェーズ → view の順に組み立てる。
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
    narrow(build_whole(p), p)
}

/// `build_whole` で作ったモデルを、表示中のファイルの要素と、それが参照するほかのファイルの要素だけに絞る（ADR-0021）。
/// 検査（`build_whole` が要る）と図（絞ったモデル）を、モデルを 2 回作らずに得るために使う。
///
/// # 引数
///
/// - `whole`：`build_whole(p)` の結果
/// - `p`：モデルを作った解析結果
///
/// # 戻り値
///
/// `build(p)` と同じモデル。
///
/// # 例
///
/// ```text
/// narrow(build_whole(&p), &p) == build(&p)
/// ```
pub fn narrow(whole: Model, p: &ParseResult) -> Model {
    focus::keep_focus(whole, p.entries.as_slice())
}

/// 解析結果から、ほかのファイルの要素も絞らずにモデルを作る（ADR-0021）。ファイルをまたぐ関係を数える検査（チェックルール）に使う。
/// ほかのファイルが無ければ `build` と同じ。
///
/// # 引数
///
/// - `p`：`project` の解析結果か、`merge` でつないだ解析結果
///
/// # 戻り値
///
/// すべてのファイルの要素・線・問題を入れたモデル。ほかのファイルの要素は `Node.file` を持つ。
///
/// # 例
///
/// ```text
/// // 表示中 "package A { requirement def R; }"、ほか "package B { part def X; satisfy A::R by X; }" をつないだとき
/// build_whole(p).edges → [satisfy|X|R|…]   // build(p) では、ほかのファイルに書いた関係なので残らない
/// ```
pub fn build_whole(p: &ParseResult) -> Model {
    let mut b = Builder::new(p);
    b.nodes();
    b.ports();
    b.usages();
    b.relations();
    b.specializations();
    b.edge_ids();
    b.notes();
    b.action_flows();
    b.state_machines();
    b.sequences();
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
    /// ファイルが量と単位のライブラリ（ISQ・SI など）を `import` しているか（`is_lib` に渡す）。
    quantities_imported: bool,
    /// ファイルごとの、`import` で取り込んだ宣言（ADR-0021。0 は表示中のファイル）。ほかのファイルが無ければ空。
    imported: Vec<HashSet<usize>>,
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
            quantities_imported: p.imports.iter().any(|i| is_quantity_path(i)),
            imported: Vec::new(),
            node_of: HashMap::new(),
            model: Model::default(),
        }
        .with_imports()
    }

    /// ファイルごとに、`import` で取り込んだ宣言を集める（ADR-0021）。`P::*` は P の中身、`P::**` は入れ子の中身すべて、
    /// `P::A` は A を取り込む。取り込んだ名前空間の中の `private` でない `import` も 1 段だけたどる（取り込みの取り込み）。
    ///
    /// # 戻り値
    ///
    /// 取り込みを入れた自分。ほかのファイルが無ければ、何も集めない（1 つのファイルでは、名前はファイル全体から探すため）。
    ///
    /// # 例
    ///
    /// ```text
    /// // 表示中のファイル "import B::*;"、2 つ目のファイル "package B { part def Y; }" のとき
    /// with_imports().imported[0] → { Y の番号 }
    /// ```
    fn with_imports(mut self) -> Self {
        let files = self.entries.last().map_or(0, |e| merge::file_of(e.start)) + 1;
        if files <= 1 {
            return self;
        }
        let mut imported = vec![HashSet::new(); files];
        for imp in &self.p.import_list {
            let f = merge::file_of(imp.start);
            let Some(ns) = self.lookup(&imp.path, imp.pe) else {
                continue;
            };
            let set = &mut imported[f];
            self.bring(ns, imp.members, imp.recursive, set, 0);
            // 取り込んだ名前空間の中の、private でない import も取り込む
            for inner in self
                .p
                .import_list
                .iter()
                .filter(|i| i.pe == Some(ns) && !i.private)
            {
                if let Some(n2) = self.lookup(&inner.path, inner.pe) {
                    self.bring(n2, inner.members, inner.recursive, set, 0);
                }
            }
        }
        self.imported = imported;
        self
    }

    /// 名前空間 `ns`（または要素）を取り込む宣言の集まりに足す。
    ///
    /// # 引数
    ///
    /// - `ns`：取り込む名前空間か要素の宣言の番号
    /// - `members`：中身を取り込むか（false なら `ns` そのもの）
    /// - `recursive`：入れ子の中身まで取り込むか
    /// - `set`：足す先
    /// - `depth`：たどった深さ
    fn bring(
        &self,
        ns: usize,
        members: bool,
        recursive: bool,
        set: &mut HashSet<usize>,
        depth: usize,
    ) {
        if !members {
            set.insert(ns);
            return;
        }
        for &c in &self.e(ns).children {
            if self.hidden(c) {
                continue;
            }
            set.insert(c);
            if recursive && depth < 16 {
                self.bring(c, true, true, set, depth + 1);
            }
        }
    }

    /// 宣言 `i` が `private`・`protected` で、持ち主の名前空間の外へ見せないものか。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    ///
    /// # 戻り値
    ///
    /// 外へ見せなければ true。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { private part def S; part def A; }" のとき
    /// hidden(S の番号) → true
    /// hidden(A の番号) → false
    /// ```
    fn hidden(&self, i: usize) -> bool {
        self.e(i).mods.as_deref().is_some_and(|m| {
            m.split_whitespace()
                .any(|w| w == "private" || w == "protected")
        })
    }

    /// 宣言 `i` が、`ctx` を書いたファイルから修飾の無い名前で見えるか（ADR-0021）。同じファイルの宣言・どのファイルの一番上の宣言・
    /// `import` で取り込んだ宣言が見える。ほかのファイルが無ければ、いつも見える。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    /// - `ctx`：名前を書いた場所の宣言の番号（無ければ表示中のファイル）
    ///
    /// # 戻り値
    ///
    /// 見えれば true。
    ///
    /// # 例
    ///
    /// ```text
    /// // 表示中のファイル "package A { part def X; }"、2 つ目 "package B { part def Y; }" のとき
    /// visible(Y, Some(A)) → false（取り込んでいない）
    /// visible(B, Some(A)) → true（一番上の宣言）
    /// ```
    pub(crate) fn visible(&self, i: usize, ctx: Option<usize>) -> bool {
        if self.imported.is_empty() {
            return true;
        }
        let f = ctx.map_or(0, |c| merge::file_of(self.e(c).start));
        merge::file_of(self.e(i).start) == f || self.e(i).pe.is_none() || self.imported_into(i, ctx)
    }

    /// 宣言 `i` を、`ctx` を書いたファイルが `import` で取り込んでいるか（ADR-0021）。ほかのファイルが無ければ false。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    /// - `ctx`：名前を書いた場所の宣言の番号（無ければ表示中のファイル）
    ///
    /// # 戻り値
    ///
    /// 取り込んでいれば true。
    ///
    /// # 例
    ///
    /// ```text
    /// // 表示中のファイル "package A { import B::*; }"、2 つ目 "package B { package Q; }" のとき
    /// imported_into(Q, Some(A)) → true
    /// imported_into(B, Some(A)) → false（一番上の宣言は取り込まなくても見える）
    /// ```
    pub(crate) fn imported_into(&self, i: usize, ctx: Option<usize>) -> bool {
        let f = ctx.map_or(0, |c| merge::file_of(self.e(c).start));
        self.imported.get(f).is_some_and(|s| s.contains(&i))
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
                file: Some(merge::file_of(e.start)).filter(|&f| f > 0),
            });
        }
    }

    /// 名前 `nm` の最初の定義（書いた順で最初の `… def`）。暫定コアの `defNamed` と同じ。
    /// その名前の定義が無ければ、同じファイルの別名（`alias nm for …;`）の指す先の定義を返す。
    ///
    /// # 引数
    ///
    /// - `nm`：探す名前（修飾の無い名前）
    /// - `ctx`：名前を書いた場所の宣言の番号（ほかのファイルの定義は、見えるもの（`visible`）だけを探す）
    ///
    /// # 戻り値
    ///
    /// 定義の宣言の番号。その名前の定義も、定義を指す別名も無ければ None（同じ名前の使用だけがあっても None）。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A; part a : A; alias B for A; }" のとき
    /// def_named("A", None) → Some(part def A の番号)
    /// def_named("B", None) → Some(part def A の番号)   // 別名
    /// def_named("a", None) → None   // 使用だけ
    /// def_named("Z", None) → None   // 名前が無い
    /// ```
    pub(crate) fn def_named(&self, nm: &str, ctx: Option<usize>) -> Option<usize> {
        self.by_name
            .get(nm)
            .and_then(|l| {
                l.iter()
                    .copied()
                    .find(|&i| self.e(i).is_def && self.visible(i, ctx))
            })
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
        let seen: Vec<usize> = list
            .iter()
            .copied()
            .filter(|&i| self.visible(i, ctx))
            .collect();
        seen.iter()
            .copied()
            .find(|i| self.node_of.contains_key(i))
            .or_else(|| seen.first().copied())
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
    /// // "part def H { viewpoint def VP { frame concern c : C; } }" のとき
    /// owner_node(Some(VP の番号)) → None                   // 視点は図に描かない
    /// ```
    fn owner_node(&self, i: Option<usize>) -> Option<usize> {
        // 視点（viewpoint）は図に描かないので、その中の frame・verify の線を外側の要素から引かない
        if i.is_some_and(|x| matches!(self.e(x).kind.as_str(), "viewpoint" | "viewpoint def")) {
            return None;
        }
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
    /// - `kind`：線の種類（`defined`・`comp`・`satisfy`・`verify`・`frame`・`flow`・`derive`・`dependency`・`allocate`・`specialize`・`subset`・`redefine`・`reference`）
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
            end_label: None,
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

    /// 型付けの線（defined）と、部品として持つ線（comp。部品の側の端に多重度と飾りを書く）。見つからない型は問題にする。
    /// 標準ライブラリの型・`subject`・標準ビュー定義を型にした view は、型が見つからなくても問題にしない（モデルの `edges`・`problems` を書き換える）。
    fn usages(&mut self) {
        let entries = self.entries;
        for (i, u) in entries.iter().enumerate() {
            if u.is_def || u.ty.is_empty() || u.kind == "package" {
                continue;
            }
            let Some(t) = self.def_of(&u.ty_path, u.pe) else {
                if !is_lib(&u.ty_path, self.quantities_imported)
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
                let ed = self.add_edge("comp", pn, tn, u.name.clone(), src);
                self.model.edges[ed].end_label = end_label(u);
            }
        }
    }

    /// 関係（satisfy・verify・frame・flow・connect・derivation・dependency・allocate・message・transition）を線や遷移にする。
    /// 割り当ての線（8.2.3.15 の allocate-relationship）は、割り当ての使用の範囲を指す（線を消すと文ごと消える）。
    /// n 項の接続と結び付けは、一般の図の線にしない（内部ブロック図に描く）が、相手が見つからなければ問題にする。
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
                // 型も名前も無い宣言する形（`verify requirement;`）は、新しい要求の使用そのものなので描かない
                RelKind::Satisfy { req, .. } | RelKind::Verify { req } if req.is_empty() => {}
                RelKind::Satisfy { req, by, negated } => {
                    // 相手は名前で探し、見つからないときだけ知らせる（図の要素でない相手、視点 viewpoint なども見つかればよい）
                    let er = self.resolve(req, pe);
                    let eb = (!by.is_empty()).then(|| self.resolve(by, pe));
                    let missing = if er.is_none() {
                        Some(req)
                    } else if eb == Some(None) {
                        Some(by)
                    } else {
                        None
                    };
                    if let Some(who) = missing {
                        self.problem(
                            r.start,
                            format!("「満たす」関係の相手「{who}」が見つかりません（satisfy）"),
                            None,
                        );
                        continue;
                    }
                    // 否定の充足（not satisfy）は線にせず、トレースの抜けの検出にも数えない
                    if *negated {
                        continue;
                    }
                    // `by` の無い `satisfy R;` は、持ち主（使用なら型の定義）が満たす（8.2.2.21）
                    let a = match eb {
                        Some(e) => self.node_for(e),
                        None => self.node_for(pe).or_else(|| self.owner_node(pe)),
                    };
                    // 満たす側・満たされる側が図に無い（視点、型の無い使用の中など）ときは、線にしない
                    if let (Some(a), Some(b)) = (a, self.node_for(er)) {
                        self.add_edge("satisfy", a, b, "«satisfy»".into(), src);
                    }
                }
                RelKind::Verify { req } => {
                    let er = self.resolve(req, pe);
                    if er.is_none() {
                        self.problem(
                            r.start,
                            format!("「検証する」関係の相手「{req}」が見つかりません（verify）"),
                            None,
                        );
                        continue;
                    }
                    // 線を引く元か相手が図に無い（型の無い使用の中など）ときは、線にしない
                    if let (Some(a), Some(b)) = (self.owner_node(pe), self.node_for(er)) {
                        self.add_edge("verify", a, b, "«verify»".into(), src);
                    }
                }
                RelKind::Frame { ty, path, .. } => {
                    let a = self.owner_node(pe);
                    // `frame concern c : C;` は型の定義、`frame cu;`（参照の形）は既にある関心事の使用（線はその型の定義へ）
                    let found = self
                        .def_of(path, pe)
                        .or_else(|| self.resolve(path, pe).filter(|&u| !self.e(u).is_def));
                    let tn = found.and_then(|t| self.node_for(Some(t)));
                    match (a, tn) {
                        (Some(a), Some(tn)) => {
                            self.add_edge("frame", a, tn, "«frame»".into(), src);
                        }
                        (None, Some(_)) => {}
                        // 関心事はあるが、型の無い使用などで図に無い
                        (_, None) if found.is_some() => {}
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
                // n 項の接続（8.2.3.13 の n-ary-connection）は、一般の図には線にしない（内部ブロック図に描く）
                RelKind::Connect { ends, .. } if ends.len() > 2 => {
                    if let Some(who) = self.missing_end(ends, pe) {
                        self.problem(
                            r.start,
                            format!("線の接続先「{who}」が見つかりません（connect）"),
                            None,
                        );
                    } else if let Some(miss) = self.missing_chain(ends, pe) {
                        let msg = format!("線の接続先{miss}が見つかりません（connect）");
                        self.problem(r.start, msg, None);
                    }
                }
                RelKind::Flow {
                    item, a: ra, b: rb, ..
                }
                | RelKind::Connect {
                    item, a: ra, b: rb, ..
                } => {
                    let label = match &r.kind {
                        RelKind::Flow { name, ty, .. } => flow_label(name, ty, item),
                        _ => item.clone(),
                    };
                    let rel = if matches!(r.kind, RelKind::Connect { .. }) {
                        "connect"
                    } else {
                        "flow"
                    };
                    let pa: Vec<&str> = ra.split('.').collect();
                    let pb: Vec<&str> = rb.split('.').collect();
                    let (ea, eb) = (self.resolve(pa[0], pe), self.resolve(pb[0], pe));
                    if ea.is_none() || eb.is_none() {
                        let who = if ea.is_none() { ra } else { rb };
                        self.problem(
                            r.start,
                            format!("線の接続先「{who}」が見つかりません（{rel}）"),
                            None,
                        );
                        continue;
                    }
                    let (a, b) = (self.node_for(ea), self.node_for(eb));
                    // 接続と名前付きのフローは、使用の範囲（本体を含む）を指す
                    let usage = match &r.kind {
                        RelKind::Connect { usage, .. } => Some(*usage),
                        RelKind::Flow { usage, .. } => *usage,
                        _ => None,
                    };
                    let s = usage.map_or(src, |u| Span {
                        start: p.entries[u].start,
                        end: p.entries[u].end,
                    });
                    // 2 段目のポート（`a.p` の `p`）は port_end が確かめるので、連鎖は 3 段目から確かめる。
                    // 端はあるが一般ビューの要素でない（定義の中の型の無い部品など）ときは、線にせず（内部ブロック図に描く）、
                    // 2 段目から部品の本体の中をたどって確かめる
                    let checked = match (a, b) {
                        (Some(a), Some(b)) => {
                            let ed = self.add_edge("flow", a, b, label, s);
                            self.model.edges[ed].rel = Some(ri);
                            self.port_end(ed, a, pa.get(1).copied(), true, r.start);
                            self.port_end(ed, b, pb.get(1).copied(), false, r.start);
                            1
                        }
                        _ => 0,
                    };
                    for (head, x) in [(ea, ra), (eb, rb)] {
                        if let Some(miss) = self.chain_miss(head, x, checked) {
                            let msg = format!("線の接続先{miss}が見つかりません（{rel}）");
                            self.problem(r.start, msg, None);
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
                        let head = pe.and_then(|pe| self.child_named(pe, seg));
                        if head.is_none() {
                            let owner = pe.map_or("", |pe| self.e(pe).name.as_str());
                            self.problem(r.start, format!("メッセージの相手「{seg}」が「{owner}」の中にありません（message）"), None);
                        } else if let Some(miss) = self.chain_miss(head, x, 0) {
                            // 2 段目から先（`a.sub.e` のイベント）も、部品の中をたどって確かめる
                            let msg = format!("メッセージの相手{miss}が見つかりません（message）");
                            self.problem(r.start, msg, None);
                        }
                    }
                }
                // 結び付けは内部ブロック図だけに描く（web）。ここでは相手があるかだけを確かめる
                RelKind::Bind { a, b, .. } => {
                    let ends = [a.clone(), b.clone()];
                    if let Some(who) = self.missing_end(&ends, pe) {
                        self.problem(
                            r.start,
                            format!("「結び付け」の相手「{who}」が見つかりません（bind）"),
                            None,
                        );
                    } else if let Some(miss) = self.missing_chain(&ends, pe) {
                        let msg = format!("「結び付け」の相手{miss}が見つかりません（bind）");
                        self.problem(r.start, msg, None);
                    }
                }
                RelKind::Allocate {
                    a: ra,
                    b: rb,
                    usage,
                } => {
                    let (ea, eb) = (self.resolve(ra, pe), self.resolve(rb, pe));
                    if ea.is_none() || eb.is_none() {
                        let who = if ea.is_none() { ra } else { rb };
                        self.problem(
                            r.start,
                            format!("「割り当て」関係の相手「{who}」が見つかりません（allocate）"),
                            None,
                        );
                        continue;
                    }
                    // 相手はあるが図の要素でない（package など）ときは、線にしない
                    if let (Some(a), Some(b)) = (self.node_for(ea), self.node_for(eb))
                        && a != b
                    {
                        let u = &p.entries[*usage];
                        let s = Span {
                            start: u.start,
                            end: u.end,
                        };
                        self.add_edge("allocate", a, b, dependency_label(&u.name, "allocate"), s);
                    }
                }
                // 継起と順序付きの流れは一般の図の線にしない（アクションの流れの図に描く）
                RelKind::Succession { .. } | RelKind::SuccessionFlow { .. } => {}
                // 最初の遷移は、状態遷移の図にだけ描く
                RelKind::EntryTransition { .. } => {}
                RelKind::Transition { from, ev, to, .. } => {
                    if let Some(a) = self.node_ancestor(pe) {
                        let ev = if ev.is_empty() {
                            String::new()
                        } else {
                            format!("  [{ev}]")
                        };
                        self.model.nodes[a].trans.push(format!("{from} → {to}{ev}"));
                    }
                }
                RelKind::Dependency {
                    a: ra,
                    b: rb,
                    name,
                    meta,
                } => {
                    let (ea, eb) = (self.resolve(ra, pe), self.resolve(rb, pe));
                    if ea.is_none() || eb.is_none() {
                        let who = if ea.is_none() { ra } else { rb };
                        self.problem(
                            r.start,
                            format!("「依存」関係の相手「{who}」が見つかりません（dependency）"),
                            None,
                        );
                        continue;
                    }
                    // 相手はあるが図の要素でない（package など）ときは、線にしない
                    if let (Some(a), Some(b)) = (self.node_for(ea), self.node_for(eb))
                        && a != b
                    {
                        self.add_edge("dependency", a, b, dependency_label(name, meta), src);
                    }
                }
            }
        }
    }

    /// 特殊化・部分集合・再定義・参照の線（8.2.3 の subclassification・subsetting・redefinition・reference-subsetting）。
    /// 両端が図の要素のときだけ、特殊な側から一般な側へ引く（モデルの `edges` を書き換える）。定義の相手は定義として、
    /// 使用の相手は持ち主から外へ（`a.b` は型の中へ）探す。図の要素でない使用（定義の中の特性）の関係は、線にしない。
    /// 相手が見つからなくても問題にしない（標準ライブラリの定義や、継承した特性など、読んでいない相手が多いため）。
    /// 線の範囲は、その相手だけを消す範囲にする（線を削除すると、その相手だけがテキストから消える）。
    fn specializations(&mut self) {
        let entries = self.entries;
        for (i, e) in entries.iter().enumerate() {
            let Some(&from) = self.node_of.get(&i) else {
                continue;
            };
            for s in &e.specs {
                let Some(kind) = spec_edge_kind(s.op) else {
                    continue;
                };
                let target = if e.is_def {
                    self.def_of(&s.path, e.pe)
                } else {
                    self.resolve(&s.target, e.pe)
                };
                let Some(&to) = target.and_then(|t| self.node_of.get(&t)) else {
                    continue;
                };
                if to != from {
                    let src = Span {
                        start: s.start,
                        end: s.end,
                    };
                    self.add_edge(kind, from, to, String::new(), src);
                }
            }
        }
    }

    /// 接続の端（`a.p` など）のうち、最初の段（`a`）が見つからない最初のもの。
    ///
    /// # 引数
    ///
    /// - `ends`：端の参照（書いた順）
    /// - `pe`：文の持ち主の宣言の番号（名前を探し始める場所）
    ///
    /// # 戻り値
    ///
    /// 見つからない端（書いたままの参照）。すべて見つかれば None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def H { part a; part b; connect (a.p, b, c); }" の H の中で
    /// missing_end(["a.p", "b"], Some(H の番号))      → None
    /// missing_end(["a.p", "b", "c"], Some(H の番号)) → Some("c")
    /// ```
    fn missing_end<'s>(&self, ends: &'s [String], pe: Option<usize>) -> Option<&'s String> {
        ends.iter().find(|x| {
            let head = x.split('.').next().unwrap_or("");
            self.resolve(head, pe).is_none()
        })
    }

    /// 接続・結び付けの端（`a.b.c` など）のうち、2 段目から先に見つからない段がある最初のもの（`chain_miss`）。
    /// 最初の段は `missing_end` が確かめる。
    ///
    /// # 引数
    ///
    /// - `ends`：端の参照（書いた順）
    /// - `pe`：文の持ち主の宣言の番号（最初の段を探し始める場所）
    ///
    /// # 戻り値
    ///
    /// 見つからない段のある端の `「連鎖」の「段」`。すべて見つかるか、確かめられなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part def B { part c; } part def H { part a : B; part b; bind a.c = b; bind a.x = b; }" の H の中で
    /// missing_chain(["a.c", "b"], Some(H の番号)) → None
    /// missing_chain(["a.x", "b"], Some(H の番号)) → Some("「a.x」の「x」")
    /// ```
    fn missing_chain(&self, ends: &[String], pe: Option<usize>) -> Option<String> {
        ends.iter().find_map(|x| {
            let head = x.split('.').next().unwrap_or("");
            self.chain_miss(self.resolve(head, pe), x, 0)
        })
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

    /// 図に描くコメント（8.2.3.4）。注釈する要素のうち図に描く要素があるコメントだけを、書いた順に `notes` に足す。
    /// キーは、名前があれば `note:名前`（同じ名前が続けば `note:名前#2`）、無ければ名前の無いメモの通し番号で `note:#1` から。
    fn notes(&mut self) {
        let mut taken: HashSet<String> = HashSet::new();
        let mut unnamed = 0;
        for (i, e) in self.entries.iter().enumerate() {
            if e.kind != "comment" {
                continue;
            }
            let targets: Vec<String> = e
                .about
                .iter()
                .filter_map(|a| self.node_of.get(a))
                .map(|&n| self.model.nodes[n].key.clone())
                .collect();
            if targets.is_empty() {
                continue;
            }
            let key = if e.name.is_empty() {
                unnamed += 1;
                format!("note:#{unnamed}")
            } else {
                let base = format!("note:{}", e.name);
                let mut key = base.clone();
                let mut k = 1;
                while taken.contains(&key) {
                    k += 1;
                    key = format!("{base}#{k}");
                }
                key
            };
            taken.insert(key.clone());
            self.model.notes.push(Note {
                key,
                entry: i,
                targets,
            });
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

    /// 構文解析のエラー、`metadata … about`・`comment … about` の見つからない相手、まだ扱えない構文を問題一覧に加える（モデルの `problems` を書き換える）。
    /// まだ扱えない構文は、頭を UTF-16 で 40 単位までに切って示し、種類を `unsupported` にする。
    fn parse_problems(&mut self) {
        let p = self.p;
        for e in &p.errors {
            self.problem(e.pos, e.msg.clone(), None);
        }
        for m in &p.missing_about {
            self.problem(
                m.pos,
                format!(
                    "メタデータを付ける相手「{}」が見つかりません（metadata about）",
                    m.name
                ),
                None,
            );
        }
        for m in &p.missing_comment_about {
            self.problem(
                m.pos,
                format!(
                    "メモを付ける相手「{}」が見つかりません（comment about）",
                    m.name
                ),
                None,
            );
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

    /// フェーズに沿った要求のトレースの抜け（導出・充足・検証）を問題として加える。暫定コアの `addTraceGaps` にならう（短い名前の無い要求の名前を 2 回並べていた所は直した）。
    /// 最初のフェーズの要求定義は下位への展開（derive の終わりの端）が無いことを、それ以外のフェーズの要求定義は導出元・満たす要素・検証が無いことを、種類 `gap` の問題にする（モデルの `problems` を書き換える）。
    /// 文の頭には要求を、短い名前があれば `<'K3'> 名前`、無ければ名前だけで書く。
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
            // 短い名前が無ければ名前だけにする（名前を 2 回並べない）
            let label = if n.short.is_empty() {
                n.name.clone()
            } else {
                format!("<'{}'> {}", n.short, n.name)
            };
            let pos = self.e(n.entry).start;
            let mut gap = |msg: &str| gaps.push((pos, format!("{label}：{msg}")));
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

/// 依存・割り当ての線のラベル（8.2.3.3 の binary-dependency の名前・8.2.3.15 の «allocate»）。
/// 前に付けたメタデータ（割り当てでは `allocate`）は «キーワード» にして名前の前に書く。
///
/// # 引数
///
/// - `name`：依存の名前（無ければ空）
/// - `meta`：前に付けたメタデータの名前（無ければ空）
///
/// # 戻り値
///
/// ラベル。名前もメタデータも無ければ空文字列。
///
/// # 例
///
/// ```text
/// dependency_label("d", "trace") → "«trace» d"
/// dependency_label("", "trace")  → "«trace»"
/// dependency_label("", "")       → ""
/// dependency_label("a", "allocate") → "«allocate» a"
/// ```
fn dependency_label(name: &str, meta: &str) -> String {
    let keyword = (!meta.is_empty()).then(|| format!("«{meta}»"));
    keyword
        .into_iter()
        .chain((!name.is_empty()).then(|| name.to_owned()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// 流れの線のラベル（8.2.3.16 の flow-label：`UsageDeclaration? ('of' FlowPayloadFeatureMember)?`）。
/// 名前の無いフローは、これまでどおりアイテムの型だけを書く。
///
/// # 引数
///
/// - `name`：フローの名前（名前の無いフローは空）
/// - `ty`：フローの型の名前（無ければ空）
/// - `item`：流れるアイテムの型の名前（`of` の後。無ければ空）
///
/// # 戻り値
///
/// ラベル。書くことが無ければ空文字列。
///
/// # 例
///
/// ```text
/// flow_label("f", "FD", "")      → "f : FD"
/// flow_label("g", "", "Water")   → "g of Water"
/// flow_label("", "", "Heat")     → "Heat"   // 名前の無いフロー
/// flow_label("", "", "")         → ""
/// ```
pub(crate) fn flow_label(name: &str, ty: &str, item: &str) -> String {
    if name.is_empty() {
        return item.to_owned();
    }
    let mut label = name.to_owned();
    if !ty.is_empty() {
        label.push_str(&format!(" : {ty}"));
    }
    if !item.is_empty() {
        label.push_str(&format!(" of {item}"));
    }
    label
}

/// 部品として持つ線の、部品の側の端に書く文字（8.2.3 の multiplicity と c-adornment）。
/// 多重度の範囲（`[4]`）、`ordered`・`nonunique`、部分集合・再定義・参照・交差の相手（`subsets a`・`crosses q.r` など）を、この順に空白でつなぐ。
///
/// # 引数
///
/// - `e`：部品として持つ使用の宣言
///
/// # 戻り値
///
/// 端に書く文字。書くことが無ければ None。
///
/// # 例
///
/// ```text
/// end_label("part w : W[4];")                 → Some("[4]")
/// end_label("part w : W[0..*] ordered :>> v;") → Some("[0..*] ordered redefines v")
/// end_label("part w : W;")                    → None
/// ```
fn end_label(e: &Entry) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(m) = &e.multiplicity {
        if !m.range.is_empty() {
            parts.push(format!("[{}]", m.range));
        }
        if m.ordered {
            parts.push("ordered".to_owned());
        }
        if m.nonunique {
            parts.push("nonunique".to_owned());
        }
    }
    for s in &e.specs {
        parts.push(format!("{} {}", s.op, s.target));
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

/// 特殊化の種類（`Spec.op`）から、線の種類を決める。
///
/// # 引数
///
/// - `op`：特殊化の種類（`specializes` など）
///
/// # 戻り値
///
/// 線の種類。線にしない種類なら None。
///
/// # 例
///
/// ```text
/// spec_edge_kind("specializes") → Some("specialize")
/// spec_edge_kind("redefines")   → Some("redefine")
/// spec_edge_kind("crosses")     → None   // 交差は線にせず、部品の線の端に書く
/// spec_edge_kind("bogus")       → None
/// ```
fn spec_edge_kind(op: &str) -> Option<&'static str> {
    match op {
        "specializes" => Some("specialize"),
        "subsets" => Some("subset"),
        "redefines" => Some("redefine"),
        "references" => Some("reference"),
        _ => None,
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
