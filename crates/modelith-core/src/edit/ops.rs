//! 操作ごとのテキストの書き換え（暫定コアの `web/src/app/ops.ts` と同じ書き方）。

use std::collections::HashSet;

use super::text::{Target, indent_at, insert_into, lower_first, remove_range};
use super::{Change, Doc, Intent, Refusal, more};
use crate::project::{RelKind, Span, text::is_basic_name};
use crate::syntax::{SyntaxKind, tokenize};

pub(super) const BAD_NAME: &str = "名前は英字か _ で始め、英字・数字・_ だけで付けてください";

/// 追加する定義の名前（種類ごと）。
const NEW_NAME: &[(&str, &str)] = &[
    ("part def", "NewPart"),
    ("requirement def", "NewRequirement"),
    ("constraint def", "NewConstraint"),
    ("concern def", "NewConcern"),
    ("verification def", "NewVerification"),
    ("analysis def", "NewAnalysis"),
    ("state def", "NewStates"),
    ("action def", "NewAction"),
    ("attribute def", "NewParams"),
    ("occurrence def", "NewScenario"),
];

/// 定義を持つときのキーワード（「部品として持つ」の書き方）。
const KW_FOR: &[(&str, &str)] = &[
    ("part def", "part"),
    ("requirement def", "requirement"),
    ("constraint def", "constraint"),
    ("state def", "exhibit state"),
    ("action def", "perform action"),
    ("analysis def", "analysis"),
    ("verification def", "verification"),
    ("port def", "port"),
    ("item def", "item"),
    ("attribute def", "attribute"),
    ("concern def", "concern"),
    ("calc def", "calc"),
    ("interface def", "interface"),
];

fn lookup(table: &[(&str, &'static str)], k: &str) -> Option<&'static str> {
    table.iter().find(|(x, _)| *x == k).map(|(_, v)| *v)
}

pub(super) fn run(d: &Doc<'_>, intent: &Intent) -> Result<Change, Refusal> {
    match intent {
        Intent::AddNode {
            kind,
            phase,
            new_package,
        } => add_node(d, kind, phase.as_deref(), new_package.as_deref()),
        Intent::AddUsage { ctx, ty } => add_usage(d, ctx, ty),
        Intent::Rename { key, name, ctx } => rename(d, &d.find(key, ctx.as_deref())?, name),
        Intent::Delete { keys, ctx } => delete(d, keys, ctx.as_deref()),
        Intent::DeleteEdge { id, ctx } => delete_edge(d, id, ctx.as_deref()),
        Intent::AddMessage { ctx, from, to } => more::add_message(d, ctx, from, to),
        Intent::UpdateMessage { ctx, id, name, ty } => more::update_message(d, ctx, id, name, ty),
        Intent::MoveMessage { ctx, id, dir } => more::move_message(d, ctx, id, *dir),
        Intent::SetPhase { keys, value, ctx } => {
            let found = keys
                .iter()
                .map(|k| d.find(k, ctx.as_deref()))
                .collect::<Result<Vec<_>, _>>()?;
            more::set_phase(d, &found, value)
        }
        Intent::InitPhases { new_package } => more::init_phases(d, new_package.as_deref()),
        Intent::MakePort {
            key,
            name,
            dir,
            ty,
            flows,
            ctx,
        } => more::make_port(
            d,
            &d.find(key, ctx.as_deref())?,
            name,
            dir,
            ty,
            flows,
            ctx.as_deref(),
        ),
        Intent::SetPortDir {
            key,
            port,
            dir,
            ctx,
        } => more::set_port_dir(d, &d.find(key, ctx.as_deref())?, port, dir),
        Intent::DeletePort { key, port, ctx } => {
            more::delete_port(d, &d.find(key, ctx.as_deref())?, port)
        }
        Intent::SaveView {
            name,
            kind,
            targets,
        } => {
            let found = targets
                .iter()
                .map(|k| d.find(k, None))
                .collect::<Result<Vec<_>, _>>()?;
            more::save_view(d, name, kind, &found)
        }
        Intent::AddToView { view, key } => more::add_to_view(d, view, &d.find(key, None)?),
        Intent::RemoveFromView { view, key } => {
            more::remove_from_view(d, view, &d.find(key, None)?)
        }
        Intent::Connect {
            rel,
            from,
            to,
            from_port,
            to_port,
            ctx,
        } => {
            let a = d.find(from, ctx.as_deref())?;
            let b = d.find(to, ctx.as_deref())?;
            connect(
                d,
                rel,
                &a,
                &b,
                from_port.as_deref(),
                to_port.as_deref(),
                ctx.as_deref(),
            )
        }
    }
}

/// キーで指した要素（宣言の番号）。
#[derive(Debug, Clone)]
pub(super) struct Found {
    pub entry: usize,
}

fn missing(key: &str) -> Refusal {
    format!("操作する要素「{key}」が見つかりません。テキストが先に変わった可能性があります")
}

impl Doc<'_> {
    /// キーの要素。`u:名前`・`l:名前` は、ctx（部品定義・シナリオ）の中の部品・ライフライン。
    pub(super) fn find(&self, key: &str, ctx: Option<&str>) -> Result<Found, Refusal> {
        if let Some(name) = key.strip_prefix("u:").or_else(|| key.strip_prefix("l:")) {
            let c = self.context(ctx.unwrap_or_default())?;
            let child = self
                .e(c)
                .children
                .iter()
                .copied()
                .find(|&i| self.e(i).name == name);
            return child
                .map(|entry| Found { entry })
                .ok_or_else(|| missing(key));
        }
        self.m
            .nodes
            .iter()
            .find(|n| n.key == key)
            .map(|n| Found { entry: n.entry })
            .ok_or_else(|| missing(key))
    }

    /// 内部ブロック図・シーケンス図の対象（宣言の番号）。
    pub(super) fn context(&self, key: &str) -> Result<usize, Refusal> {
        self.m
            .nodes
            .iter()
            .find(|n| n.key == key)
            .map(|n| n.entry)
            .ok_or_else(|| missing(key))
    }

    pub(super) fn names(&self) -> HashSet<&str> {
        self.p
            .entries
            .iter()
            .map(|e| e.name.as_str())
            .filter(|n| !n.is_empty())
            .collect()
    }

    pub(super) fn first_package(&self) -> Option<usize> {
        self.p.entries.iter().position(|e| e.kind == "package")
    }

    /// e から上へたどった、最初の @Phase の値。
    pub(super) fn phase_of(&self, i: usize) -> Option<&str> {
        let mut a = Some(i);
        while let Some(x) = a {
            let e = self.e(x);
            let stage = e
                .meta
                .as_ref()
                .and_then(|m| m.0.iter().find(|(k, _)| k == "Phase"))
                .and_then(|(_, v)| v.0.iter().find(|(k, _)| k == "stage"));
            if let Some((_, v)) = stage.filter(|(_, v)| !v.is_empty()) {
                return Some(v);
            }
            a = e.pe;
        }
        None
    }

    /// 子の名前と重ならない名前（base、base2、base3 …）。
    pub(super) fn unique_child(&self, i: usize, base: &str) -> String {
        let taken: HashSet<&str> = self
            .e(i)
            .children
            .iter()
            .map(|&c| self.e(c).name.as_str())
            .collect();
        unique(base, |n| taken.contains(n))
    }
}

pub(super) fn unique(base: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut n = base.to_owned();
    let mut k = 2;
    while taken(&n) {
        n = format!("{base}{k}");
        k += 1;
    }
    n
}

/// 定義を追加する。置く package は、同じ種類の要素が最後に置かれた package（無ければ最初の package）。
fn add_node(
    d: &Doc<'_>,
    kind: &str,
    phase: Option<&str>,
    new_package: Option<&str>,
) -> Result<Change, Refusal> {
    let pkg =
        d.p.entries
            .iter()
            .rev()
            .find(|e| e.kind == kind && e.pe.is_some_and(|p| d.e(p).kind == "package"))
            .and_then(|e| e.pe)
            .or_else(|| d.first_package());
    let (text, target, inherited) = match (pkg, new_package) {
        (Some(p), _) => (d.text.to_owned(), d.target(p), d.phase_of(p)),
        (None, Some(name)) => {
            let (text, target) = append_package(d.text, name)?;
            (text, target, None)
        }
        (None, None) => return Err("要素を置く、モデルの入れ物（package）がありません".to_owned()),
    };
    let names = d.names();
    let name = unique(lookup(NEW_NAME, kind).unwrap_or("NewElement"), |n| {
        names.contains(n)
    });
    let mut lines = Vec::new();
    if let (Some(ph), Some(_), Some(en)) = (phase, &d.m.phases, &d.m.phase_enum)
        && inherited != Some(ph)
    {
        lines.push(format!("@Phase {{ stage = {en}::{ph}; }}"));
    }
    match kind {
        "requirement def" => lines.push("doc /* ここに要求文を書く */".to_owned()),
        "constraint def" => {
            lines.extend(["in x : Real; in y : Real;".to_owned(), "y == x".to_owned()])
        }
        "occurrence def" => lines.push("doc /* シナリオの説明 */".to_owned()),
        _ => {}
    }
    let i1 = format!("{}    ", indent_at(&text, target.start));
    let i2 = format!("{i1}    ");
    let body: String = lines.iter().map(|l| format!("\n{i2}{l}")).collect();
    let (text, a, b) = insert_into(&text, target, &format!("{kind} {name} {{{body}\n{i1}}}"));
    Ok(Change {
        text,
        select: Some(name),
        flash: Some((a, b)),
    })
}

/// テキストの末尾（配置の `@layout` コメントがあればその前）に、空の package を足す（F-EDIT-7）。
pub(super) fn append_package(text: &str, name: &str) -> Result<(String, Target), Refusal> {
    if !is_basic_name(name) {
        return Err(
            "入れ物の名前は、英字か _ で始め、英字・数字・_ だけで付けてください".to_owned(),
        );
    }
    let cut = layout_comment_start(text).unwrap_or(text.len());
    let before = text[..cut].trim_end();
    let after = &text[cut..];
    let head = if before.is_empty() {
        String::new()
    } else {
        format!("{before}\n\n")
    };
    let block = format!("package {name} {{\n}}\n");
    let sep = if after.is_empty() { "" } else { "\n" };
    let next = format!("{head}{block}{sep}{after}");
    let close = head.len() + block.len() - 2;
    Ok((
        next,
        Target {
            start: head.len(),
            head_end: head.len() + format!("package {name} ").len(),
            close: Some(close),
        },
    ))
}

/// 移行期の `/* @layout … */` コメントの位置（暫定コアの LAYOUT_RE と同じく、閉じているものの最初の 1 つ）。
fn layout_comment_start(text: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(i) = text[from..].find("/*") {
        let start = from + i;
        let rest = text[start + 2..].trim_start();
        if rest.starts_with("@layout") && rest.contains("*/") {
            return Some(start);
        }
        from = start + 2;
    }
    None
}

/// 内部ブロック図の部品・シーケンス図のライフラインを追加する（`part 名前 : 型;`）。
fn add_usage(d: &Doc<'_>, ctx: &str, ty: &str) -> Result<Change, Refusal> {
    let c = d.context(ctx)?;
    let name = d.unique_child(c, &lower_first(ty));
    let (text, a, b) = insert_into(d.text, d.target(c), &format!("part {name} : {ty};"));
    Ok(Change {
        text,
        select: Some(name),
        flash: Some((a, b)),
    })
}

/// トークンとその位置（バイト）。
pub(super) fn tokens(text: &str) -> Vec<(SyntaxKind, usize, &str)> {
    let mut at = 0;
    tokenize(text)
        .0
        .into_iter()
        .map(|t| {
            let r = (t.kind, at, &text[at..at + t.len]);
            at += t.len;
            r
        })
        .collect()
}

/// 名前を変え、参照もまとめて書き換える。定義なら名前の出てくるところすべて、使用なら持ち主の中の宣言と `名前.`・`名前 :` などの参照。
fn rename(d: &Doc<'_>, f: &Found, nn: &str) -> Result<Change, Refusal> {
    if !is_basic_name(nn) {
        return Err(BAD_NAME.to_owned());
    }
    let e = d.e(f.entry);
    let old = e.name.as_str();
    if nn == old {
        return Ok(Change {
            text: d.text.to_owned(),
            select: Some(nn.to_owned()),
            flash: None,
        });
    }
    if d.names().contains(nn) {
        return Err(format!("「{nn}」は既に使われています"));
    }
    let ts = tokens(d.text);
    let significant = |i: usize, step: isize| -> Option<&(SyntaxKind, usize, &str)> {
        let mut j = i as isize + step;
        while let Some(t) = usize::try_from(j).ok().and_then(|j| ts.get(j)) {
            if !t.0.is_trivia() && t.0 != SyntaxKind::REGULAR_COMMENT {
                return Some(t);
            }
            j += step;
        }
        None
    };
    // 使用の名前は、持ち主（部品定義など）の中でだけ参照される
    let owner =
        e.pe.map_or(0..d.text.len(), |p| d.b(d.e(p).start)..d.b(d.e(p).end));
    let mut hits: Vec<(usize, usize)> = Vec::new(); // (位置, 消す長さ)
    for (i, &(kind, at, s)) in ts.iter().enumerate() {
        if kind == SyntaxKind::QUOTED_NAME && e.is_def && s.len() > 2 && &s[1..s.len() - 1] == old {
            hits.push((at + 1, old.len()));
        }
        if kind != SyntaxKind::IDENT || s != old {
            continue;
        }
        let hit = e.is_def || {
            let in_owner = owner.contains(&at);
            let after_dot = i > 0 && ts[i - 1].0 == SyntaxKind::DOT;
            let dot_next = ts.get(i + 1).is_some_and(|t| t.0 == SyntaxKind::DOT);
            let decl_next = significant(i, 1).is_some_and(|t| t.2.starts_with([':', ';', '{']));
            in_owner && !after_dot && (dot_next || decl_next)
        };
        if hit {
            hits.push((at, old.len()));
        }
    }
    if !e.is_def {
        let (hs, he) = (d.b(e.start), d.b(e.head_end));
        let head = ts
            .iter()
            .find(|t| t.0 == SyntaxKind::IDENT && t.2 == old && (hs..he).contains(&t.1));
        if let Some(&(_, at, _)) = head
            && !hits.iter().any(|h| h.0 == at)
        {
            hits.push((at, old.len()));
        }
    }
    hits.sort_unstable();
    let mut out = d.text.to_owned();
    for &(at, len) in hits.iter().rev() {
        out.replace_range(at..at + len, nn);
    }
    let grow = nn.len() as isize - old.len() as isize;
    let shift =
        |p: usize| (p as isize + grow * hits.iter().filter(|h| h.0 < p).count() as isize) as usize;
    let flash = (shift(d.b(e.start)), shift(d.b(e.head_end)));
    Ok(Change {
        text: out,
        select: Some(nn.to_owned()),
        flash: Some(flash),
    })
}

/// 要素を削除する。行全体を占めるなら行ごと消す。選んだ要素の中に選んだ要素があれば、外側だけを消す。
fn delete(d: &Doc<'_>, keys: &[String], ctx: Option<&str>) -> Result<Change, Refusal> {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for k in keys {
        let e = d.e(d.find(k, ctx)?.entry);
        spans.push((d.b(e.start), d.b(e.end)));
    }
    spans.sort_unstable();
    spans.dedup();
    let outer: Vec<(usize, usize)> = spans
        .iter()
        .copied()
        .filter(|&(a, b)| {
            !spans
                .iter()
                .any(|&(x, y)| (x, y) != (a, b) && x <= a && b <= y)
        })
        .collect();
    let mut text = d.text.to_owned();
    let mut at = 0;
    for &(a, b) in outer.iter().rev() {
        (text, at) = remove_range(&text, a, b);
    }
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}

/// 図の関係の範囲と、関係を書いた文（`ParseResult.rels` の番号）。
#[derive(Debug, Clone, Copy)]
pub(super) struct EdgeAt {
    pub src: Span,
    pub rel: Option<usize>,
}

/// 内部ブロック図・シーケンス図の関係の ID（UI の `web/src/app/views.ts` と同じ ID）。
pub(super) fn context_edges(d: &Doc<'_>, c: usize) -> Vec<(String, EdgeAt)> {
    let ctx = d.e(c);
    let line = |r: &crate::project::Rel| Span {
        start: r.start,
        end: r.end + 1,
    };
    if ctx.kind == "occurrence def" {
        return messages(d, c)
            .into_iter()
            .enumerate()
            .filter_map(|(i, ri)| match &d.p.rels[ri].kind {
                RelKind::Message { name, .. } => Some((
                    format!("msg|{i}|{name}"),
                    EdgeAt {
                        src: line(&d.p.rels[ri]),
                        rel: Some(ri),
                    },
                )),
                _ => None,
            })
            .collect();
    }
    let part = |path: &str| {
        let head = path.split('.').next().unwrap_or("");
        ctx.children
            .iter()
            .copied()
            .find(|&i| d.e(i).kind == "part" && !d.e(i).name.is_empty() && d.e(i).name == head)
    };
    let mut out = Vec::new();
    let mut seen: Vec<(String, usize)> = Vec::new();
    for (ri, r) in d.p.rels.iter().enumerate().filter(|(_, r)| r.pe == Some(c)) {
        let (a, b, item, src) = match &r.kind {
            RelKind::Flow { a, b, item } => (a, b, item, line(r)),
            RelKind::Connect { a, b, item, usage } => (
                a,
                b,
                item,
                Span {
                    start: d.e(*usage).start,
                    end: d.e(*usage).end,
                },
            ),
            _ => continue,
        };
        let (Some(pa), Some(pb)) = (part(a), part(b)) else {
            continue;
        };
        let base = format!("flow|u:{}|u:{}|{item}", d.e(pa).name, d.e(pb).name);
        let k = match seen.iter_mut().find(|(b, _)| *b == base) {
            Some((_, k)) => {
                *k += 1;
                *k
            }
            None => {
                seen.push((base.clone(), 1));
                1
            }
        };
        out.push((format!("{base}#{k}"), EdgeAt { src, rel: Some(ri) }));
    }
    out
}

/// シナリオのメッセージ（書いた順。`ParseResult.rels` の番号）。
pub(super) fn messages(d: &Doc<'_>, c: usize) -> Vec<usize> {
    let mut ms: Vec<usize> = (0..d.p.rels.len())
        .filter(|&i| {
            d.p.rels[i].pe == Some(c) && matches!(d.p.rels[i].kind, RelKind::Message { .. })
        })
        .collect();
    ms.sort_by_key(|&i| d.p.rels[i].start);
    ms
}

impl Doc<'_> {
    /// ID の関係。ctx があれば、その図の関係から先に探す。
    pub(super) fn edge(&self, id: &str, ctx: Option<&str>) -> Result<EdgeAt, Refusal> {
        let in_ctx = match ctx {
            Some(c) => context_edges(self, self.context(c)?)
                .into_iter()
                .find(|(x, _)| x == id)
                .map(|(_, e)| e),
            None => None,
        };
        in_ctx
            .or_else(|| {
                self.m.edges.iter().find(|e| e.id == id).map(|e| EdgeAt {
                    src: e.src,
                    rel: e.rel,
                })
            })
            .ok_or_else(|| {
                "操作する関係が見つかりません。テキストが先に変わった可能性があります".to_owned()
            })
    }
}

/// 関係を削除する（関係を書いた文を消す）。
fn delete_edge(d: &Doc<'_>, id: &str, ctx: Option<&str>) -> Result<Change, Refusal> {
    let src = d.edge(id, ctx)?.src;
    let (text, at) = remove_range(d.text, d.b(src.start), d.b(src.end));
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}

/// a から b への関係を書く。
fn connect(
    d: &Doc<'_>,
    rel: &str,
    a: &Found,
    b: &Found,
    fp: Option<&str>,
    tp: Option<&str>,
    ctx: Option<&str>,
) -> Result<Change, Refusal> {
    let (ea, eb) = (d.e(a.entry), d.e(b.entry));
    let last_rel = |want: fn(&RelKind) -> bool| d.p.rels.iter().rev().find(|r| want(&r.kind));
    let (host, snippet): (Target, String) = match rel {
        "comp" => {
            let kw = lookup(KW_FOR, &eb.kind).unwrap_or("part");
            let nm = d.unique_child(a.entry, &lower_first(&eb.name));
            (d.target(a.entry), format!("{kw} {nm} : {};", eb.name))
        }
        "satisfy" => {
            let host = last_rel(|k| matches!(k, RelKind::Satisfy { .. }))
                .and_then(|r| r.pe)
                .or_else(|| d.first_package());
            let host = host.ok_or_else(no_package)?;
            (
                d.target(host),
                format!("satisfy {} by {};", eb.name, ea.name),
            )
        }
        "verify" => {
            let has_objective =
                d.p.rels
                    .iter()
                    .any(|r| r.pe == Some(a.entry) && matches!(r.kind, RelKind::Verify { .. }));
            let objective = ea
                .open
                .filter(|_| has_objective)
                .and_then(|o| objective_block(d.text, d.b(o)));
            match objective {
                Some(t) => (t, format!("verify {};", eb.name)),
                None => (
                    d.target(a.entry),
                    format!("objective {{ verify {}; }}", eb.name),
                ),
            }
        }
        "frame" => {
            let nm = d.unique_child(a.entry, &lower_first(&eb.name));
            (
                d.target(a.entry),
                format!("frame concern {nm} : {};", eb.name),
            )
        }
        "derive" => {
            let host = last_rel(|k| matches!(k, RelKind::Derive { .. }))
                .and_then(|r| r.pe)
                .or(ea.pe)
                .or_else(|| d.first_package());
            let host = host.ok_or_else(no_package)?;
            (
                d.target(host),
                format!("#derivation dependency from {} to {};", ea.name, eb.name),
            )
        }
        "flow" => {
            let (parent, ua, ub) = match ctx {
                Some(c) if !ea.is_def => (d.context(c)?, a.entry, b.entry),
                _ => common_parent(d, &ea.name, &eb.name).ok_or_else(|| {
                    "2 つの部品を両方持つ部品定義がないため、流れを書けません".to_owned()
                })?,
            };
            let end = |u: usize, p: Option<&str>| {
                p.map_or_else(|| d.e(u).name.clone(), |p| format!("{}.{p}", d.e(u).name))
            };
            (
                d.target(parent),
                format!("flow from {} to {};", end(ua, fp), end(ub, tp)),
            )
        }
        _ => return Err(format!("関係の種類「{rel}」は扱えません")),
    };
    let (text, a, b) = insert_into(d.text, host, &snippet);
    Ok(Change {
        text,
        select: None,
        flash: Some((a, b)),
    })
}

fn no_package() -> Refusal {
    "関係を書く、モデルの入れ物（package）がありません".to_owned()
}

/// a と b を部品として持つ最初の定義（flow を書く場所）と、その部品。
fn common_parent(d: &Doc<'_>, a: &str, b: &str) -> Option<(usize, usize, usize)> {
    d.p.entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.is_def)
        .find_map(|(i, e)| {
            let part = |t: &str| {
                e.children
                    .iter()
                    .copied()
                    .find(|&c| d.e(c).kind == "part" && d.e(c).ty == t)
            };
            Some((i, part(a)?, part(b)?))
        })
}

/// 宣言の本体（open の後ろ）にある `objective { … }` の位置（コメント・文字列の中は見ない）。
fn objective_block(text: &str, open: usize) -> Option<Target> {
    let ts = tokens(text);
    let oi = ts
        .iter()
        .position(|t| t.1 >= open && t.0 == SyntaxKind::KEYWORD && t.2 == "objective")?;
    let ob = oi + ts[oi..].iter().position(|t| t.0 == SyntaxKind::L_BRACE)?;
    let mut depth = 0;
    for t in &ts[ob..] {
        match t.0 {
            SyntaxKind::L_BRACE => depth += 1,
            SyntaxKind::R_BRACE => {
                depth -= 1;
                if depth == 0 {
                    return Some(Target {
                        start: ts[oi].1,
                        head_end: t.1,
                        close: Some(t.1),
                    });
                }
            }
            _ => {}
        }
    }
    None
}
