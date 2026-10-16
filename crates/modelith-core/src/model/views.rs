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

fn standard_view(t: &str) -> Option<(&'static str, Option<&'static str>)> {
    STANDARD_VIEWS
        .iter()
        .find(|(n, s, _)| *n == t || *s == t)
        .map(|(n, _, k)| (*n, *k))
}

/// 標準ビュー定義の名前か（型が見つからないことを問題にしない）。
pub fn is_standard_view(t: &str) -> bool {
    standard_view(t).is_some()
}

/// 図の種類の、画面での名前（型の無い図は一般の図）。
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

/// `@X` の式を絞り込みにする。扱えない式なら None。
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
    let split = name
        .strip_suffix("Definition")
        .map(|h| (h, true))
        .or_else(|| name.strip_suffix("Usage").map(|h| (h, false)))
        .filter(|(h, _)| !h.is_empty());
    if let Some((head, is_def)) = split
        && let Some((_, kind)) = METACLASS_KIND.iter().find(|(m, _)| *m == head)
    {
        return Some(Filter::Kind(if is_def {
            format!("{kind} def")
        } else {
            (*kind).to_owned()
        }));
    }
    is_metadata(name).then(|| Filter::Metadata(name.to_owned()))
}

impl Builder<'_> {
    /// 修飾名（A::B::C）の要素。後ろから順に、親の名前が合うものを探す。
    fn resolve_qualified(&self, qn: &str) -> Option<usize> {
        let mut segs: Vec<&str> = qn.split("::").collect();
        let last = segs.pop().unwrap_or("");
        self.by_name.get(last)?.iter().copied().find(|&i| {
            let mut a = self.entries[i].pe;
            for seg in segs.iter().rev() {
                match a {
                    Some(x) if self.entries[x].name == *seg => a = self.entries[x].pe,
                    _ => return false,
                }
            }
            true
        })
    }

    /// 入れ子の中身すべて（書いた順）。
    fn descendants(&self, i: usize, out: &mut Vec<usize>) {
        for &c in &self.entries[i].children {
            out.push(c);
            self.descendants(c, out);
        }
    }

    /// expose 1 つで出る要素（8.2.2.26.2。MembershipExpose は対象そのもの、NamespaceExpose は中身）。
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

    /// view の型をたどり、標準ビュー定義と、型の側に書かれた filter・render を集める。
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

/// 解析した view を、描く要素と描き方に解決する。扱えない部分は問題として知らせる（ADR-0013）。
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
            let Some(target) = b.resolve_qualified(&x.target) else {
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
