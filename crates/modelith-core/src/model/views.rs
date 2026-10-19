//! テキストに書かれた view を、描く要素と描き方に解決する（ADR-0005・ADR-0013、F-VIEW-7）。
//! 暫定コアの `web/src/core/views.ts` と同じ振る舞い。
//! 仕様：8.2.2.26 Views and Viewpoints（view・expose・filter・render）、9.2.20 標準ビュー定義（StandardViewDefinitions）。

use std::collections::HashSet;

use super::{Builder, Frame, View};
use crate::project::{Entry, Expose};

/// 標準ビュー定義（名前・短い名前）と、Modelith の描き方。None は専用の描き方が無い（ノードと線の図で代わりに描く）。
const STANDARD_VIEWS: &[(&str, &str, Option<&str>)] = &[
    ("GeneralView", "gv", Some("general")),
    ("InterconnectionView", "iv", Some("interconnection")),
    ("ActionFlowView", "afv", None),
    ("StateTransitionView", "stv", Some("stateTransition")),
    ("SequenceView", "sv", Some("sequence")),
    ("GeometryView", "gev", None),
    ("GridView", "grv", None),
    ("BrowserView", "bv", None),
];

/// 標準ビュー定義の、画面での名前（ADR-0014）。
const STD_LABEL: &[(&str, &str)] = &[
    ("GeneralView", "一般の図"),
    ("InterconnectionView", "内部ブロック図"),
    ("ActionFlowView", "アクションの流れ図"),
    ("StateTransitionView", "状態遷移の図"),
    ("SequenceView", "シーケンス図"),
    ("GeometryView", "形状の図"),
    ("GridView", "表の図"),
    ("BrowserView", "一覧の図"),
];

/// 標準のレンダリング（Views）と描き方。None は図にできない。
const RENDERINGS: &[(&str, Option<&str>)] = &[
    ("asTreeDiagram", Some("general")),
    ("asInterconnectionDiagram", Some("interconnection")),
    ("asTextualNotation", None),
    ("asElementTable", None),
];

/// メタクラス名の頭（PartDefinition の Part）と、Modelith の要素の種類。
const METACLASS_KIND: &[(&str, &str)] = &[
    ("Part", "part"),
    ("Requirement", "requirement"),
    ("Constraint", "constraint"),
    ("Port", "port"),
    ("Item", "item"),
    ("Attribute", "attribute"),
    ("Concern", "concern"),
    ("VerificationCase", "verification"),
    ("AnalysisCase", "analysis"),
    ("State", "state"),
    ("Action", "action"),
    ("Interface", "interface"),
    ("Calculation", "calc"),
    ("Connection", "connection"),
    ("UseCase", "use case"),
    ("Enumeration", "enum"),
    ("Occurrence", "occurrence"),
    ("Metadata", "metadata"),
    ("View", "view"),
];

/// 標準ビュー定義を、名前か短い名前で引く。暫定コアの `STANDARD_VIEWS`（`web/src/core/views.ts`）の引き方と同じ。
///
/// # 引数
///
/// - `t`：view の型の名前（`InterconnectionView` のような名前か、`iv` のような短い名前）
///
/// # 戻り値
///
/// 標準ビュー定義の名前と、Modelith の描き方（専用の描き方が無ければ None）の組。標準ビュー定義でなければ None。
///
/// # 例
///
/// ```text
/// standard_view("iv")       → Some(("InterconnectionView", Some("interconnection")))
/// standard_view("GridView") → Some(("GridView", None))   // 専用の描き方が無い
/// standard_view("MyView")   → None
/// ```
fn standard_view(t: &str) -> Option<(&'static str, Option<&'static str>)> {
    STANDARD_VIEWS
        .iter()
        .find(|(n, s, _)| *n == t || *s == t)
        .map(|(n, _, k)| (*n, *k))
}

/// 標準ビュー定義の名前か（型が見つからないことを問題にしない）。暫定コアの `isStandardView` と同じ。
///
/// # 引数
///
/// - `t`：view の型の名前（名前でも短い名前でもよい）
///
/// # 戻り値
///
/// 標準ビュー定義の名前か短い名前なら true、そうでなければ false。
///
/// # 例
///
/// ```text
/// is_standard_view("InterconnectionView") → true
/// is_standard_view("iv")                  → true    // 短い名前
/// is_standard_view("MyView")              → false
/// ```
pub fn is_standard_view(t: &str) -> bool {
    standard_view(t).is_some()
}

/// 図の種類の、画面での名前（型の無い図は一般の図）。暫定コアの `stdViewLabel` と同じ。
///
/// # 引数
///
/// - `std`：標準ビュー定義の名前（`SequenceView` など。短い名前ではない）。型の無い図は None
///
/// # 戻り値
///
/// 画面での名前（ADR-0014）。表に無い名前なら、その名前をそのまま返す。
///
/// # 例
///
/// ```text
/// std_view_label(Some("SequenceView")) → "シーケンス図"
/// std_view_label(None)                 → "一般の図"
/// std_view_label(Some("Other"))        → "Other"   // 表に無い
/// ```
pub fn std_view_label(std: Option<&str>) -> String {
    match std {
        None => "一般の図".to_owned(),
        Some(s) => STD_LABEL
            .iter()
            .find(|(n, _)| *n == s)
            .map_or(s, |(_, l)| l)
            .to_owned(),
    }
}

/// `@X`（X はメタクラスかメタデータ）の絞り込み。
enum Filter {
    Definition,
    Usage,
    Kind(String),
    Metadata(String),
}

impl Filter {
    /// 宣言が絞り込みに合うか。
    ///
    /// # 引数
    ///
    /// - `e`：調べる宣言
    ///
    /// # 戻り値
    ///
    /// 合えば true。`Definition` は定義、`Usage` は使用、`Kind` は種類が一致するもの、`Metadata` はそのメタデータを付けたものが合う。
    ///
    /// # 例
    ///
    /// ```text
    /// Filter::Kind("part def").test(part def A の宣言) → true
    /// Filter::Usage.test(part def A の宣言)            → false
    /// ```
    fn test(&self, e: &Entry) -> bool {
        match self {
            Self::Definition => e.is_def,
            Self::Usage => !e.is_def,
            Self::Kind(k) => e.kind == *k,
            Self::Metadata(m) => e
                .meta
                .as_ref()
                .is_some_and(|ms| ms.0.iter().any(|(k, _)| k == m)),
        }
    }
}

/// `@X` の式を絞り込みにする。扱えない式なら None。暫定コアの `filterTest`（`web/src/core/views.ts`）と同じ。
/// `X` は修飾名でもよく、最後の段だけを見る。`…Definition`・`…Usage` のメタクラスは種類に、メタデータの定義の名前はメタデータの絞り込みにする。
///
/// # 引数
///
/// - `expr`：filter の式（`@PartDefinition`・`@SysML::PartUsage`・`@Safety` など）
/// - `is_metadata`：名前がメタデータの定義（`metadata def`）かを答える関数
///
/// # 戻り値
///
/// 絞り込み。`@` で始まらない式・名前の形でない式・知らないメタクラスでメタデータでもない名前なら None。
///
/// # 例
///
/// ```text
/// filter_of("@PartDefinition", …)  → Some(Kind("part def"))
/// filter_of("@SysML::PartUsage", …) → Some(Kind("part"))
/// filter_of("@Definition", …)      → Some(Definition)
/// filter_of("@Safety", …)          → Some(Metadata("Safety"))   // Safety がメタデータの定義のとき
/// filter_of("not @A", …)           → None                       // 扱えない式
/// ```
fn filter_of(expr: &str, is_metadata: impl Fn(&str) -> bool) -> Option<Filter> {
    let rest = expr.strip_prefix('@')?.trim_start();
    let mut cs = rest.chars();
    let ok = cs
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':');
    if !ok {
        return None;
    }
    let name = rest.rsplit("::").next().unwrap_or(rest);
    match name {
        "Definition" => return Some(Filter::Definition),
        "Usage" => return Some(Filter::Usage),
        _ => {}
    }
    if let Some(kind) = metaclass_kind(name) {
        return Some(Filter::Kind(kind));
    }
    is_metadata(name).then(|| Filter::Metadata(name.to_owned()))
}

/// メタクラスの名前（`PartDefinition`・`ActionUsage` など）を、Modelith の要素の種類にする。
///
/// # 引数
///
/// - `name`：メタクラスの名前（修飾の無い名前）
///
/// # 戻り値
///
/// `…Definition` なら `"part def"` のような定義の種類、`…Usage` なら `"part"` のような使用の種類。
/// 頭が `METACLASS_KIND` に無いか、`Definition`・`Usage` で終わらなければ `None`。
///
/// # 例
///
/// ```text
/// metaclass_kind("PartDefinition") → Some("part def")
/// metaclass_kind("UseCaseUsage")   → Some("use case")
/// metaclass_kind("Usage")          → None   // 頭が空
/// metaclass_kind("Safety")         → None
/// ```
pub(crate) fn metaclass_kind(name: &str) -> Option<String> {
    let (head, is_def) = name
        .strip_suffix("Definition")
        .map(|h| (h, true))
        .or_else(|| name.strip_suffix("Usage").map(|h| (h, false)))
        .filter(|(h, _)| !h.is_empty())?;
    let (_, kind) = METACLASS_KIND.iter().find(|(m, _)| *m == head)?;
    Some(if is_def {
        format!("{kind} def")
    } else {
        (*kind).to_owned()
    })
}

impl Builder<'_> {
    /// expose の対象の名前（`A`・`A::B::C`）の要素。
    ///
    /// 修飾名は、view から外へ向かって最初の段を探し、そこから中へたどる（`lookup`、8.2.2.5）。
    /// 修飾の無い名前は、これまでどおりファイル全体で書いた順に最初のもの（無ければ同じ名前の別名の指す先）。
    ///
    /// # 引数
    ///
    /// - `qn`：対象の名前（`P::Q`・`A` など。`::` で区切る）
    /// - `ctx`：expose を書いた view の番号
    ///
    /// # 戻り値
    ///
    /// 対象の宣言の番号。無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { package Q { part def B; } view v; }" のとき
    /// resolve_qualified("P::Q", Some(v の番号))    → Some(Q の番号)
    /// resolve_qualified("Q::B", Some(v の番号))    → Some(B の番号)   // Q は v の外側の P から見える
    /// resolve_qualified("Nope::X", Some(v の番号)) → None
    /// ```
    fn resolve_qualified(&self, qn: &str, ctx: Option<usize>) -> Option<usize> {
        if qn.contains("::") {
            return self.lookup(qn, ctx);
        }
        self.by_name
            .get(qn)
            .and_then(|l| l.first().copied())
            .or_else(|| self.alias_anywhere(qn, 0))
    }

    /// 入れ子の中身すべて（書いた順）を `out` の後ろに足す。各中身のすぐ後にその中身が続く（深さ優先）。暫定コアの `descendants` と同じ。
    /// 宣言そのものは足さない。
    ///
    /// # 引数
    ///
    /// - `i`：中身を集める宣言の番号
    /// - `out`：集めた宣言の番号を足す先
    fn descendants(&self, i: usize, out: &mut Vec<usize>) {
        for &c in &self.entries[i].children {
            out.push(c);
            self.descendants(c, out);
        }
    }

    /// expose 1 つで出る要素（8.2.2.26.2。MembershipExpose は対象そのもの、NamespaceExpose は中身）。暫定コアの `exposed` と同じ。
    ///
    /// # 引数
    ///
    /// - `x`：expose の文（`::*` があれば `members`、`::**` があれば `recursive` が true）
    /// - `target`：expose の対象の宣言の番号
    ///
    /// # 戻り値
    ///
    /// 出る宣言の番号（書いた順）。`P::*` は直下の中身、`P::*::**` は入れ子の中身すべて、`P::**` は P と入れ子の中身すべて、`P` は P だけ。
    ///
    /// # 例
    ///
    /// ```text
    /// // "package P { part def A { part b; } }" のとき
    /// exposed(expose P::*,     P の番号) → [A]
    /// exposed(expose P::*::**, P の番号) → [A, b]
    /// exposed(expose P::**,    P の番号) → [P, A, b]
    /// exposed(expose P,        P の番号) → [P]   // 対象そのものだけ
    /// ```
    fn exposed(&self, x: &Expose, target: usize) -> Vec<usize> {
        let mut out = Vec::new();
        match (x.members, x.recursive) {
            (true, true) => self.descendants(target, &mut out),
            (true, false) => out.extend(self.entries[target].children.iter().copied()),
            (false, true) => {
                out.push(target);
                self.descendants(target, &mut out);
            }
            (false, false) => out.push(target),
        }
        out
    }

    /// view の型をたどり、標準ビュー定義と、型の側に書かれた filter・render を集める。暫定コアの `viewType` と同じ。
    /// 型が `view def` なら、その filter を足し、render がまだ無ければその render を使い、さらにその型へ進む。同じ定義を 2 度たどったら止める。
    ///
    /// # 引数
    ///
    /// - `v`：view の宣言
    ///
    /// # 戻り値
    ///
    /// 標準ビュー定義の名前・描き方・filter の式（view 自身の分から順）・render の名前の組。
    /// 標準ビュー定義に行き着かなければ、名前は None、描き方は `general` になる。空の render は None にする。
    ///
    /// # 例
    ///
    /// ```text
    /// // "view v : GridView { render asElementTable; }" のとき
    /// view_type(v) → (Some("GridView"), None, [], Some("asElementTable"))
    /// // "view v { filter @PartDefinition; }" のとき（型が無い）
    /// view_type(v) → (None, Some("general"), ["@PartDefinition"], None)
    /// ```
    fn view_type(
        &self,
        v: &Entry,
    ) -> (
        Option<&'static str>,
        Option<&'static str>,
        Vec<String>,
        Option<String>,
    ) {
        let mut filters = v.filters.clone().unwrap_or_default();
        let mut render = v.render.clone();
        let mut seen = HashSet::new();
        let mut t = v.ty.clone();
        while !t.is_empty() {
            if let Some((std, kind)) = standard_view(&t) {
                return (Some(std), kind, filters, render.filter(|r| !r.is_empty()));
            }
            let def = self.by_name.get(t.as_str()).and_then(|l| {
                l.iter()
                    .copied()
                    .find(|&i| self.entries[i].kind == "view def")
            });
            let Some(def) = def.filter(|d| seen.insert(*d)) else {
                break;
            };
            let d = &self.entries[def];
            filters.extend(d.filters.clone().unwrap_or_default());
            if render.as_deref().is_none_or(str::is_empty) {
                render = d.render.clone().or(render);
            }
            t = d.ty.clone();
        }
        // 型の無い view は、一般的な図（GeneralView）として描く
        (
            None,
            Some("general"),
            filters,
            render.filter(|r| !r.is_empty()),
        )
    }
}

/// 解析した view を、描く要素と描き方に解決する。扱えない部分は問題として知らせる（ADR-0013）。暫定コアの `buildViews` と同じ。
/// 名前のある view ごとに `View` を作ってモデルの `views` に足し、見つからない expose・扱えない filter・render・描き方の無い標準ビュー定義を `problems` に足す。
/// package そのものを出したときは枠（`Frame`）にし、その中の図の要素も出す（F-VIEW-9）。
///
/// # 引数
///
/// - `b`：要素（`nodes`）まで組み立てた状態
pub(super) fn build_views(b: &mut Builder<'_>) {
    let is_metadata = |b: &Builder<'_>, n: &str| {
        b.by_name
            .get(n)
            .is_some_and(|l| l.iter().any(|&i| b.entries[i].kind == "metadata def"))
    };
    let entries = b.entries;
    for (vi, v) in entries.iter().enumerate() {
        if v.kind != "view" || v.name.is_empty() {
            continue;
        }
        let (std, mut kind, filters, render) = b.view_type(v);
        if kind.is_none() {
            let label = std_view_label(std);
            let msg = format!(
                "図「{}」の種類（{label}）の描き方はまだ無いため、一般の図として描きます（{}）",
                v.name,
                std.unwrap_or("")
            );
            b.problem(v.start, msg, Some("unsupported"));
        }
        if let Some(r) = &render {
            match RENDERINGS
                .iter()
                .find(|(n, _)| n == r)
                .and_then(|(_, k)| *k)
            {
                Some(k) => kind = Some(k),
                None => {
                    let msg = format!(
                        "図「{}」の表し方（{r}）はまだ扱えないため、図として描きます（render）",
                        v.name
                    );
                    b.problem(v.start, msg, Some("unsupported"));
                }
            }
        }
        let mut tests = Vec::new();
        for f in &filters {
            match filter_of(f, |n| is_metadata(b, n)) {
                Some(t) => tests.push(t),
                None => {
                    let msg = format!(
                        "図「{}」の絞り込み「{f}」はまだ扱えないため、絞り込まずに描きます（filter）",
                        v.name
                    );
                    b.problem(v.start, msg, Some("unsupported"));
                }
            }
        }
        let mut targets = Vec::new();
        let mut shown: Vec<usize> = Vec::new();
        let mut shown_set = HashSet::new();
        for x in v.exposes.iter().flatten() {
            let Some(target) = b.resolve_qualified(&x.target, Some(vi)) else {
                let msg = format!(
                    "図「{}」に出す要素「{}」が見つかりません（expose）",
                    v.name, x.target
                );
                b.problem(x.start, msg, None);
                continue;
            };
            targets.push(target);
            let own = match &x.filter {
                Some(f) => {
                    let t = filter_of(f, |n| is_metadata(b, n));
                    if t.is_none() {
                        let msg = format!(
                            "図「{}」の絞り込み「{f}」はまだ扱えないため、絞り込まずに描きます（expose の [ ]）",
                            v.name
                        );
                        b.problem(x.start, msg, Some("unsupported"));
                    }
                    t
                }
                None => None,
            };
            for e in b.exposed(x, target) {
                if own.as_ref().is_none_or(|f| f.test(&b.entries[e])) && shown_set.insert(e) {
                    shown.push(e);
                }
            }
        }
        let passes = |e: usize| tests.iter().all(|t| t.test(&entries[e]));
        let key =
            |b: &Builder<'_>, e: usize| b.node_of.get(&e).map(|&n| b.model.nodes[n].key.clone());
        let shown: Vec<usize> = shown.into_iter().filter(|&e| passes(e)).collect();
        let mut node_keys: Vec<String> = shown.iter().filter_map(|&e| key(b, e)).collect();
        // package そのものを出したら、枠として描き、中の要素も図に出す（F-VIEW-9、8.2.3.5）
        let mut frames = Vec::new();
        for &p in shown.iter().filter(|&&e| entries[e].kind == "package") {
            let mut inner = Vec::new();
            b.descendants(p, &mut inner);
            let keys: Vec<String> = inner
                .into_iter()
                .filter(|&e| passes(e))
                .filter_map(|e| key(b, e))
                .collect();
            for k in &keys {
                if !node_keys.contains(k) {
                    node_keys.push(k.clone());
                }
            }
            frames.push(Frame {
                name: entries[p].name.clone(),
                entry: p,
                node_keys: keys,
            });
        }
        b.model.views.push(View {
            name: v.name.clone(),
            entry: vi,
            kind: kind.unwrap_or("general"),
            std,
            node_keys,
            targets,
            frames,
        });
    }
}
