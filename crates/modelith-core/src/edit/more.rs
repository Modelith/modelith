//! メッセージ・フェーズ・ポート・保存された図の操作（暫定コアの `ops.ts`・`pins.ts`・`view-ops.ts`・`view-text.ts` と同じ書き方）。

use super::ops::{BAD_NAME, Found, append_package, messages};
use super::text::{Splice, indent_at, insert_into, insert_splice, remove_range};
use super::{Change, Doc, Refusal};
use crate::project::{Expose, RelKind, Scope, text::is_basic_name};
use crate::syntax::is_keyword;

// ---- メッセージ（シーケンス図） ----

fn message_at(d: &Doc<'_>, c: usize, id: &str) -> Result<(usize, Vec<usize>), Refusal> {
    let ms = messages(d, c);
    let i = ms
        .iter()
        .enumerate()
        .position(|(i, &ri)| matches!(&d.p.rels[ri].kind, RelKind::Message { name, .. } if format!("msg|{i}|{name}") == id))
        .ok_or_else(|| "操作するメッセージが見つかりません。テキストが先に変わった可能性があります".to_owned())?;
    Ok((i, ms))
}

/// メッセージの文の範囲（バイト。`;` まで）。
fn message_span(d: &Doc<'_>, ri: usize) -> (usize, usize) {
    let r = &d.p.rels[ri];
    (d.b(r.start), d.b(r.end + 1))
}

fn starts_with_then(s: &str) -> bool {
    s.strip_prefix("then")
        .is_some_and(|r| r.starts_with(char::is_whitespace))
}

/// メッセージを足す（名前は msg1・msg2 …。前のメッセージが then で始まれば、then を付ける）。
pub(super) fn add_message(d: &Doc<'_>, ctx: &str, from: &str, to: &str) -> Result<Change, Refusal> {
    let c = d.context(ctx)?;
    let ms = messages(d, c);
    let used: Vec<&str> = ms
        .iter()
        .filter_map(|&ri| match &d.p.rels[ri].kind {
            RelKind::Message { name, .. } => Some(name.as_str()),
            _ => None,
        })
        .collect();
    let mut k = ms.len() + 1;
    let mut nm = format!("msg{k}");
    while used.contains(&nm.as_str()) {
        k += 1;
        nm = format!("msg{k}");
    }
    let then = ms
        .last()
        .is_some_and(|&ri| starts_with_then(&d.text[message_span(d, ri).0..]));
    let a = from.get(2..).unwrap_or(from);
    let b = to.get(2..).unwrap_or(to);
    let snippet = format!(
        "{}message {nm} from {a} to {b};",
        if then { "then " } else { "" }
    );
    let (text, s, e) = insert_into(d.text, d.target(c), &snippet);
    Ok(Change {
        text,
        select: Some(nm),
        flash: Some((s, e)),
    })
}

/// メッセージの名前とアイテムの型を書き換える。
pub(super) fn update_message(
    d: &Doc<'_>,
    ctx: &str,
    id: &str,
    name: &str,
    ty: &str,
) -> Result<Change, Refusal> {
    if !name.is_empty() && !is_basic_name(name) {
        return Err(BAD_NAME.to_owned());
    }
    let c = d.context(ctx)?;
    let (i, ms) = message_at(d, c, id)?;
    let ri = ms[i];
    let RelKind::Message { a, b, .. } = &d.p.rels[ri].kind else {
        return Err("メッセージではありません".to_owned());
    };
    let (s, e) = message_span(d, ri);
    let then = if starts_with_then(&d.text[s..e]) {
        "then "
    } else {
        ""
    };
    let name = if name.is_empty() {
        String::new()
    } else {
        format!("{name} ")
    };
    let of = if ty.is_empty() {
        String::new()
    } else {
        format!("of {ty} ")
    };
    let ns = format!("{then}message {name}{of}from {a} to {b};");
    let text = format!("{}{ns}{}", &d.text[..s], &d.text[e..]);
    Ok(Change {
        text,
        select: None,
        flash: Some((s, s + ns.len())),
    })
}

/// メッセージの順番を入れ替える（文を入れ替え、then の有無は位置に残す）。dir は -1（上へ）か 1（下へ）。
pub(super) fn move_message(d: &Doc<'_>, ctx: &str, id: &str, dir: i8) -> Result<Change, Refusal> {
    let c = d.context(ctx)?;
    let (i, ms) = message_at(d, c, id)?;
    let j = i
        .checked_add_signed(dir.into())
        .filter(|&j| j < ms.len())
        .ok_or_else(|| "これ以上は動かせません".to_owned())?;
    let ((a0, a1), (b0, b1)) = {
        let (x, y) = (message_span(d, ms[i]), message_span(d, ms[j]));
        if x.0 < y.0 { (x, y) } else { (y, x) }
    };
    let (ta, tb) = (&d.text[a0..a1], &d.text[b0..b1]);
    let pre = |s: &str| -> usize {
        if starts_with_then(s) {
            s.len() - s[4..].trim_start().len()
        } else {
            0
        }
    };
    let (pa, pb) = (pre(ta), pre(tb));
    let na = format!("{}{}", &ta[..pa], &tb[pb..]);
    let nb = format!("{}{}", &tb[..pb], &ta[pa..]);
    let text = format!(
        "{}{na}{}{nb}{}",
        &d.text[..a0],
        &d.text[a1..b0],
        &d.text[b1..]
    );
    let end = b1 + na.len() + nb.len() - ta.len() - tb.len();
    Ok(Change {
        text,
        select: None,
        flash: Some((a0, end)),
    })
}

// ---- フェーズ（@Phase） ----

/// 要素のフェーズを設定する。value が空なら、その要素に書いた指定を外す。複数のときは、まとめて設定する。
pub(super) fn set_phase(d: &Doc<'_>, found: &[Found], value: &str) -> Result<Change, Refusal> {
    let en =
        d.m.phase_enum
            .as_deref()
            .ok_or_else(|| "フェーズの定義がありません".to_owned())?;
    let tok = format!("{en}::{value}");
    let decl = format!("@Phase {{ stage = {tok}; }}");
    if let [one] = found {
        let e = d.e(one.entry);
        if let (Some(pv), Some(pb)) = (e.phase_val, e.phase_block) {
            if value.is_empty() {
                let (s, end) = match pb {
                    Scope::Entry(i) => (d.e(i).start, d.e(i).end),
                    Scope::Block(i) => (
                        d.p.blocks[i].start,
                        d.p.blocks[i].end.unwrap_or(d.p.blocks[i].start),
                    ),
                };
                let (text, at) = remove_range(d.text, d.b(s), d.b(end));
                return Ok(Change {
                    text,
                    select: None,
                    flash: Some((at, at + 1)),
                });
            }
            let (s, end) = (d.b(pv.start), d.b(pv.end));
            let text = format!("{}{tok}{}", &d.text[..s], &d.text[end..]);
            return Ok(Change {
                text,
                select: None,
                flash: Some((s, s + tok.len())),
            });
        }
        if value.is_empty() {
            return Err("パッケージから継承しているため、ここでは外せません".to_owned());
        }
        if d.phase_of(one.entry) == Some(value) {
            return Err("すでにパッケージから継承しています".to_owned());
        }
        let (text, s, e) = insert_into(d.text, d.target(one.entry), &decl);
        return Ok(Change {
            text,
            select: None,
            flash: Some((s, s.max(e))),
        });
    }
    if value.is_empty() {
        return Err("フェーズを選んでください".to_owned());
    }
    let splices: Vec<Splice> = found
        .iter()
        .map(|f| match d.e(f.entry).phase_val {
            Some(pv) => Splice {
                at: d.b(pv.start),
                del: d.b(pv.end) - d.b(pv.start),
                ins: tok.clone(),
            },
            None => insert_splice(d.text, d.target(f.entry), &decl),
        })
        .collect();
    let (text, at) = apply_all(d.text, splices);
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}

/// 重ならない編集をまとめて当てる（後ろから当てるので位置はずれない）。結果と、最初の編集の位置。
fn apply_all(text: &str, mut splices: Vec<Splice>) -> (String, usize) {
    splices.sort_by_key(|s| s.at);
    splices.dedup_by_key(|s| s.at);
    let first = splices.first().map_or(0, |s| s.at);
    let out = splices
        .iter()
        .rev()
        .fold(text.to_owned(), |t, s| s.apply(&t));
    (out, first)
}

/// フェーズの定義（metadata def と enum def）を最初の package に足す。package が無ければ new_package の名前で作る。
pub(super) fn init_phases(d: &Doc<'_>, new_package: Option<&str>) -> Result<Change, Refusal> {
    let (text, start, open) = match (d.first_package(), new_package) {
        (Some(p), _) => {
            let e = d.e(p);
            let open = e.open.ok_or_else(|| "このファイルの書き方では、フェーズを足せません（最初の package が { } で囲まれていません）".to_owned())?;
            (d.text.to_owned(), d.b(e.start), d.b(open))
        }
        (None, Some(name)) => {
            let (text, t) = append_package(d.text, name)?;
            let open = t.head_end;
            (text, t.start, open)
        }
        (None, None) => {
            return Err("フェーズを書く、モデルの入れ物（package）がありません".to_owned());
        }
    };
    let i1 = format!("{}    ", indent_at(&text, start));
    let ins = format!(
        "\n{i1}// フェーズ管理：要素やパッケージに @Phase を付けて分類する（パッケージに付けると中の要素が継承）\n\
         {i1}metadata def Phase {{ attribute stage : PhaseKind; }}\n\
         {i1}enum def PhaseKind {{ enum StakeholderNeeds; enum SystemRequirements; enum Architecture; enum Verification; }}\n"
    );
    let at = open + 1;
    let out = format!("{}{ins}{}", &text[..at], &text[at..]);
    Ok(Change {
        text: out,
        select: None,
        flash: Some((at, at + ins.len())),
    })
}

// ---- ポート ----

impl Doc<'_> {
    /// ポートを置く先（使用なら型の定義、見つからなければ使用そのもの）。
    fn port_host(&self, i: usize) -> usize {
        let e = self.e(i);
        if e.is_def {
            return i;
        }
        self.m
            .nodes
            .iter()
            .find(|n| n.is_def && n.name == e.ty)
            .map_or(i, |n| n.entry)
    }

    fn port(&self, f: &Found, port: &str) -> Result<usize, Refusal> {
        let host = self.port_host(f.entry);
        self.e(host)
            .children
            .iter()
            .copied()
            .find(|&c| self.e(c).name == port)
            .ok_or_else(|| {
                format!("ポート「{port}」が見つかりません。テキストが先に変わった可能性があります")
            })
    }
}

/// 線の端をポートにつなぎ直すときの指定（関係の ID と、つなぎ直す端）。
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct FlowEnd {
    pub id: String,
    #[serde(default)]
    pub from: bool,
    #[serde(default)]
    pub to: bool,
}

/// 文の中の `kw 名前` の名前（後ろに名前の文字や . が続かないもの）の位置。
fn after_keyword(stmt: &str, kws: &[&str], name: &str) -> Option<usize> {
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(i) = stmt[from..].find(name).map(|i| from + i) {
        from = i + 1;
        let before = stmt[..i].trim_end_matches(char::is_whitespace);
        let spaced = before.len() < i;
        let kw_ok = kws
            .iter()
            .any(|k| before.ends_with(k) && !before[..before.len() - k.len()].ends_with(word));
        let tail_ok = !stmt[i + name.len()..].starts_with(|c: char| word(c) || c == '.');
        if spaced && kw_ok && tail_ok {
            return Some(i);
        }
    }
    None
}

/// 接続点をポートにする（宣言を足し、その接続点につながる flow を「部品.ポート」に書き換える）。
pub(super) fn make_port(
    d: &Doc<'_>,
    f: &Found,
    name: &str,
    dir: &str,
    ty: &str,
    flows: &[FlowEnd],
    ctx: Option<&str>,
) -> Result<Change, Refusal> {
    if !is_basic_name(name) {
        return Err("ポート名は英字か _ で始め、英字・数字・_ だけで付けてください".to_owned());
    }
    if !matches!(dir, "in" | "out" | "inout") {
        return Err(format!("ポートの向き「{dir}」は扱えません"));
    }
    let host = d.port_host(f.entry);
    if d.e(host).children.iter().any(|&c| d.e(c).name == name) {
        return Err(format!(
            "「{name}」は {} の中で既に使われています",
            d.e(host).name
        ));
    }
    let ty = if ty.is_empty() {
        String::new()
    } else {
        format!(" : {ty}")
    };
    let port = insert_splice(d.text, d.target(host), &format!("{dir} port {name}{ty};"));
    let mut splices = vec![port.clone()];
    for fe in flows {
        let Ok(edge) = d.edge(&fe.id, ctx) else {
            continue;
        };
        let Some(RelKind::Flow { a, b, .. } | RelKind::Connect { a, b, .. }) =
            edge.rel.map(|r| &d.p.rels[r].kind)
        else {
            continue;
        };
        let (s, e) = (d.b(edge.src.start), d.b(edge.src.end));
        let mut stmt = d.text[s..e].to_owned();
        let mut swap = |kws: &[&str], path: &str| {
            if let Some(i) = after_keyword(&stmt, kws, path) {
                let head = path.split('.').next().unwrap_or("");
                stmt.replace_range(i..i + path.len(), &format!("{head}.{name}"));
            }
        };
        if fe.from {
            swap(&["from", "connect"], a);
        }
        if fe.to {
            swap(&["to"], b);
        }
        if stmt != d.text[s..e] {
            splices.push(Splice {
                at: s,
                del: e - s,
                ins: stmt,
            });
        }
    }
    let before: isize = splices
        .iter()
        .filter(|x| x.at < port.at)
        .map(|x| x.ins.len() as isize - x.del as isize)
        .sum();
    let (text, _) = apply_all(d.text, splices);
    let at = (port.at as isize + before) as usize;
    Ok(Change {
        text,
        select: Some(name.to_owned()),
        flash: Some((at, at + port.ins.len())),
    })
}

/// ポートの向き（in / out / inout）を書き換える。
pub(super) fn set_port_dir(
    d: &Doc<'_>,
    f: &Found,
    port: &str,
    dir: &str,
) -> Result<Change, Refusal> {
    if !matches!(dir, "in" | "out" | "inout") {
        return Err(format!("ポートの向き「{dir}」は扱えません"));
    }
    let e = d.e(d.port(f, port)?);
    let (s, he) = (d.b(e.start), d.b(e.head_end));
    let head = &d.text[s..he];
    let strip = |h: &str, words: &[&str]| -> usize {
        words
            .iter()
            .find_map(|w| {
                h.strip_prefix(w)
                    .filter(|r| r.starts_with(char::is_whitespace))
                    .map(|r| h.len() - r.trim_start().len())
            })
            .unwrap_or(0)
    };
    let vis = strip(head, &["private", "public", "protected"]);
    let old_dir = strip(&head[vis..], &["inout", "in", "out"]);
    let nh = format!("{}{dir} {}", &head[..vis], &head[vis + old_dir..]);
    let text = format!("{}{nh}{}", &d.text[..s], &d.text[he..]);
    Ok(Change {
        text,
        select: None,
        flash: Some((s, s + nh.len())),
    })
}

/// ポートを削除する。
pub(super) fn delete_port(d: &Doc<'_>, f: &Found, port: &str) -> Result<Change, Refusal> {
    let e = d.e(d.port(f, port)?);
    let (text, at) = remove_range(d.text, d.b(e.start), d.b(e.end));
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}

// ---- 保存された図（view と expose、F-VIEW-8） ----

/// SysML の名前として書く（基本名に使えない文字や予約語を含むときは引用名、8.2.2.1）。
pub fn sysml_name(name: &str) -> String {
    if is_basic_name(name) && !is_keyword(name) {
        return name.to_owned();
    }
    format!("'{}'", name.replace('\\', "\\\\").replace('\'', "\\'"))
}

impl Doc<'_> {
    /// 名前を持つ親をたどった名前の並び（package P の中の A なら ["P", "A"]）。
    fn name_path(&self, i: usize) -> Vec<&str> {
        let mut names = Vec::new();
        let mut a = Some(i);
        while let Some(x) = a {
            names.push(self.e(x).name.as_str());
            a = self.e(x).pe;
        }
        names.reverse();
        names
    }

    /// テキストに書く修飾名（P::A。名前は必要なら引用名にする）。
    pub(super) fn qualified_name(&self, i: usize) -> String {
        self.name_path(i)
            .into_iter()
            .map(sysml_name)
            .collect::<Vec<_>>()
            .join("::")
    }

    /// e だけを出している expose（中身をまとめて出す expose は含めない）。
    fn exposes_only_for(&self, view: usize, i: usize) -> Vec<&Expose> {
        let plain = self.name_path(i).join("::");
        self.e(view)
            .exposes
            .iter()
            .flatten()
            .filter(|x| !x.members && !x.recursive && x.filter.is_none() && x.target == plain)
            .collect()
    }

    fn view_named(&self, name: &str) -> Result<usize, Refusal> {
        self.m
            .views
            .iter()
            .find(|v| v.name == name)
            .map(|v| v.entry)
            .ok_or_else(|| {
                format!("図「{name}」が見つかりません。テキストが先に変わった可能性があります")
            })
    }
}

/// 描き方に対応する標準ビュー定義（9.2.20）。
fn std_view_for(kind: &str) -> Option<&'static str> {
    match kind {
        "general" => Some("GeneralView"),
        "interconnection" => Some("InterconnectionView"),
        "stateTransition" => Some("StateTransitionView"),
        "sequence" => Some("SequenceView"),
        _ => None,
    }
}

/// 図を保存するときの view の宣言。要素は 1 つずつ expose する。indent は view を置く位置の字下げ。
fn view_declaration(d: &Doc<'_>, name: &str, std: &str, targets: &[usize], indent: &str) -> String {
    let lines: Vec<String> = targets
        .iter()
        .map(|&t| format!("{indent}    expose {};", d.qualified_name(t)))
        .collect();
    let nl = if lines.is_empty() { "" } else { "\n" };
    format!(
        "view {} : {std} {{\n{}{nl}{indent}}}",
        sysml_name(name),
        lines.join("\n")
    )
}

/// 表示中の図を、名前を付けて保存する（最初の package に view を書く）。
pub(super) fn save_view(
    d: &Doc<'_>,
    name: &str,
    kind: &str,
    targets: &[Found],
) -> Result<Change, Refusal> {
    let name = name.trim();
    if name.is_empty() {
        return Err("図の名前を入力してください".to_owned());
    }
    if d.m.views.iter().any(|v| v.name == name) {
        return Err(format!(
            "「{name}」という図は既にあります。別の名前にしてください"
        ));
    }
    let std = std_view_for(kind).ok_or_else(|| format!("図の描き方「{kind}」は扱えません"))?;
    let pkg = d
        .first_package()
        .filter(|_| !targets.is_empty())
        .ok_or_else(|| "図に要素が無いため、保存できません".to_owned())?;
    let indent = format!("{}    ", indent_at(d.text, d.b(d.e(pkg).start)));
    let ts: Vec<usize> = targets.iter().map(|f| f.entry).collect();
    let (text, s, e) = insert_into(
        d.text,
        d.target(pkg),
        &view_declaration(d, name, std, &ts, &indent),
    );
    Ok(Change {
        text,
        select: Some(name.to_owned()),
        flash: Some((s, e)),
    })
}

/// 保存された図に要素を入れる（expose を足す）。
pub(super) fn add_to_view(d: &Doc<'_>, view: &str, f: &Found) -> Result<Change, Refusal> {
    let v = d.view_named(view)?;
    let e = d.e(f.entry);
    if d.m.views.iter().any(|x| {
        x.name == view
            && x.node_keys
                .iter()
                .any(|k| d.m.nodes.iter().any(|n| &n.key == k && n.entry == f.entry))
    }) {
        return Err(format!("「{}」は既にこの図にあります", e.name));
    }
    let (text, s, end) = insert_into(
        d.text,
        d.target(v),
        &format!("expose {};", d.qualified_name(f.entry)),
    );
    Ok(Change {
        text,
        select: None,
        flash: Some((s, end)),
    })
}

/// 保存された図から要素を外す（その要素だけを出している expose を消す）。モデルの要素は残す。
pub(super) fn remove_from_view(d: &Doc<'_>, view: &str, f: &Found) -> Result<Change, Refusal> {
    let v = d.view_named(view)?;
    let mut xs: Vec<(usize, usize)> = d
        .exposes_only_for(v, f.entry)
        .iter()
        .map(|x| (d.b(x.start), d.b(x.end + 1)))
        .collect();
    if xs.is_empty() {
        return Err(format!(
            "「{}」は、ほかの要素とまとめてこの図に入っているため、1 つだけ外すことはできません（テキストの expose で直せます）",
            d.e(f.entry).name
        ));
    }
    xs.sort_unstable();
    let mut text = d.text.to_owned();
    let mut at = 0;
    for &(s, e) in xs.iter().rev() {
        (text, at) = remove_range(&text, s, e);
    }
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}
