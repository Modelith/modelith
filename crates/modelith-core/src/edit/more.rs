//! メッセージ・フェーズ・ポート・保存された図の操作（暫定コアの `ops.ts`・`pins.ts`・`view-ops.ts`・`view-text.ts` と同じ書き方）。

use super::ops::{BAD_NAME, Found, append_package, messages, tokens};
use super::text::{Splice, indent_at, insert_into, insert_splice, remove_range};
use super::{Change, Doc, Refusal};
use crate::project::{Expose, RelKind, Scope, text::is_basic_name};
use crate::syntax::{SyntaxKind, is_keyword};

// ---- メッセージ（シーケンス図） ----

/// シーケンス図の関係の ID（`msg|順番|名前`）から、シナリオの中のメッセージを探す。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：シナリオの宣言の番号
/// - `id`：メッセージの ID（`msg|順番|名前`。順番は 0 始まりで、書いた順）
///
/// # 戻り値
///
/// ID に当たるメッセージの順番と、シナリオのメッセージすべて（`ParseResult.rels` の番号、書いた順）。無ければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = SEQ（m1、then m2 の 2 つのメッセージを持つシナリオ S）のとき
/// message_at(d, S の番号, "msg|1|m2") → Ok((1, [m1 の関係の番号, m2 の関係の番号]))
/// message_at(d, S の番号, "msg|0|m2") → Err("操作するメッセージが見つかりません。…")   // 順番が合わない
/// ```
fn message_at(d: &Doc<'_>, c: usize, id: &str) -> Result<(usize, Vec<usize>), Refusal> {
    let ms = messages(d, c);
    let i = ms
        .iter()
        .enumerate()
        .position(|(i, &ri)| matches!(&d.p.rels[ri].kind, RelKind::Message { name, .. } if format!("msg|{i}|{name}") == id))
        .ok_or_else(|| "操作するメッセージが見つかりません。テキストが先に変わった可能性があります".to_owned())?;
    Ok((i, ms))
}

/// メッセージの文の範囲（バイト。`then` があれば `then` から `;` まで）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `ri`：メッセージの関係の番号（`ParseResult.rels` の添字）
///
/// # 戻り値
///
/// 文の始まりと終わり（バイトオフセット。終わりは `;` の次）。
///
/// # 例
///
/// ```text
/// // d.text の中の "then message m2 of Sig from b to a;" の関係の番号を ri とすると
/// message_span(d, ri) → (then の位置, ; の次の位置)
/// ```
fn message_span(d: &Doc<'_>, ri: usize) -> (usize, usize) {
    let r = &d.p.rels[ri];
    (d.b(r.start), d.b(r.end + 1))
}

/// 文が `then` と空白で始まるか（`then message …` か）。
///
/// # 引数
///
/// - `s`：文（またはその後ろのテキスト）
///
/// # 戻り値
///
/// `then` の後に空白が続けば true。
///
/// # 例
///
/// ```text
/// starts_with_then("then message m2 from b to a;") → true
/// starts_with_then("thenx message")                → false   // 語の一部
/// starts_with_then("message m1 from a to b;")      → false
/// ```
fn starts_with_then(s: &str) -> bool {
    s.strip_prefix("then")
        .is_some_and(|r| r.starts_with(char::is_whitespace))
}

/// メッセージを足す（名前は msg1・msg2 …。前のメッセージが then で始まれば、then を付ける）。
/// 名前の番号は「今のメッセージの数 + 1」から始め、使われていれば次へ進む。暫定コアの `MSGOPS.add` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `ctx`：シナリオのキー
/// - `from`・`to`：送り手と受け手のライフラインのキー（`l:名前`。先頭の 2 文字を除いた名前を書く）
///
/// # 戻り値
///
/// 足した後のテキストと、選ぶ名前・光らせる範囲（足した文）。シナリオが無ければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// add_message(Doc(SEQ), "S", "l:b", "l:a")
///   → Ok(text に "then message m2 of Sig from b to a;\n    then message msg3 from b to a;\n}", select = Some("msg3"))
/// add_message(Doc(SEQ), "Gone", "l:a", "l:b") → Err("操作する要素「Gone」が見つかりません。…")
/// ```
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

/// メッセージの名前とアイテムの型を書き換える。空なら書かない。`then` と送り手・受け手は保つ。暫定コアの `MSGOPS.update` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `ctx`：シナリオのキー
/// - `id`：メッセージの ID（`msg|順番|名前`）
/// - `name`：新しい名前（基本名。空なら名前を書かない）
/// - `ty`：アイテムの型（空なら `of 型` を書かない）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、光らせる範囲（書き換えた文）。名前が使えないとき・シナリオやメッセージが無いときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// update_message(Doc(SEQ), "S", "msg|1|m2", "go", "Cmd") → Ok(text に "then message go of Cmd from b to a;")
/// update_message(Doc(SEQ), "S", "msg|1|m2", "", "")      → Ok(text に "then message from b to a;")
/// update_message(Doc(SEQ), "S", "msg|1|m2", "1x", "")    → Err(BAD_NAME)
/// ```
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

/// メッセージの順番を入れ替える（文を入れ替え、then の有無は位置に残す）。dir は -1（上へ）か 1（下へ）。暫定コアの `MSGOPS.move` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `ctx`：シナリオのキー
/// - `id`：動かすメッセージの ID（`msg|順番|名前`）
/// - `dir`：-1 なら 1 つ前と、1 なら 1 つ後と入れ替える
///
/// # 戻り値
///
/// 入れ替えた後のテキストと、光らせる範囲（入れ替えた 2 つの文を含む範囲）。先頭より前・末尾より後へは動かせず、理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// move_message(Doc(SEQ), "S", "msg|1|m2", -1)
///   → Ok(text に "    message m2 of Sig from b to a;\n    then message m1 from a to b;\n")
/// move_message(Doc(SEQ), "S", "msg|0|m1", -1) → Err("これ以上は動かせません")
/// move_message(Doc(SEQ), "S", "msg|1|m2", 1)  → Err("これ以上は動かせません")
/// ```
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
/// 自分に `@Phase` を書いていれば値だけを書き換え、無ければ `@Phase { stage = 列挙::値; }` を中に足す。暫定コアの `PHASEOPS.set` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `found`：設定する要素（1 つ以上）
/// - `value`：フェーズの値（列挙の値の名前。空なら指定を外す。外せるのは 1 つの要素のときだけ）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、光らせる範囲。フェーズの定義が無いとき・受け継いだ指定を外そうとしたとき・受け継いだ値と同じとき・複数で空の値のときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = PH（A は自分に K::a、C は package Q から K::b を受け継ぐ）のとき
/// set_phase(d, [A], "b")    → Ok(text に "part def A { @Phase { stage = K::b; } }")
/// set_phase(d, [B], "a")    → Ok(text に "part def B {\n        @Phase { stage = K::a; }\n    }")
/// set_phase(d, [A], "")     → Ok(text に "part def A { }")
/// set_phase(d, [C], "")     → Err("パッケージから継承しているため、ここでは外せません")
/// set_phase(Doc("package P { part def A; }"), [A], "x") → Err("フェーズの定義がありません")
/// ```
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
/// 同じ位置の編集が 2 つ以上あれば、最初の 1 つだけを当てる。
///
/// # 引数
///
/// - `text`：元のテキスト
/// - `splices`：編集の列（位置は元のテキストのバイトオフセット。順は問わない）
///
/// # 戻り値
///
/// 編集を当てた後のテキストと、いちばん前の編集の位置（編集が無ければ 0）。
///
/// # 例
///
/// ```text
/// apply_all("abcd", [Splice { at: 3, del: 1, ins: "D" }, Splice { at: 0, del: 1, ins: "A" }]) → ("AbcD", 0)
/// apply_all("abcd", [])                                                                      → ("abcd", 0)
/// ```
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
/// 足すのは package の開き括弧の直後で、`PhaseKind` の 4 つの値（StakeholderNeeds・SystemRequirements・Architecture・Verification）を持つ。暫定コアの `PHASEOPS.init` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `new_package`：package が無いときに作る package の名前
///
/// # 戻り値
///
/// 足した後のテキストと、光らせる範囲（足した定義）。最初の package が `{ }` で囲まれていないとき・package が無く作る名前も無いとき・名前が使えないときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// init_phases(Doc("package P {\n    part def A;\n}\n"), None) → Ok(足した後のモデルのフェーズは 4 つ)
/// init_phases(Doc(""), Some("M"))                         → Ok(text は "package M {\n" で始まる)
/// init_phases(Doc("package P;"), None)                    → Err("このファイルの書き方では、フェーズを足せません（最初の package が { } で囲まれていません）")
/// ```
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
            return Err("フェーズを書き込むパッケージがありません".to_owned());
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
    /// ポートを置く先（使用なら型の定義、見つからなければ使用そのもの）。型の定義は図の要素から名前で探す。
    ///
    /// # 引数
    ///
    /// - `i`：要素の宣言の番号（定義か、内部ブロック図の部品）
    ///
    /// # 戻り値
    ///
    /// ポートを置く宣言の番号。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = PORTS（part def E と、C の中の part a : E）のとき
    /// port_host(a の番号) → E の番号   // 使用は型の定義
    /// port_host(E の番号) → E の番号
    /// // 型の定義が図の要素に無い使用 x なら
    /// port_host(x の番号) → x の番号
    /// ```
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

    /// 要素のポート（ポートを置く先の直下にある、その名前の宣言）。
    ///
    /// # 引数
    ///
    /// - `f`：要素（定義か、内部ブロック図の部品）
    /// - `port`：ポートの名前
    ///
    /// # 戻り値
    ///
    /// ポートの宣言の番号。無ければ理由の文（`Err`）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = PORTS（part def E { out port o; }）のとき
    /// port(a, "o") → Ok(E の中の o の番号)
    /// port(a, "x") → Err("ポート「x」が見つかりません。テキストが先に変わった可能性があります")
    /// ```
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

/// 文の中の `kw 名前` の名前（後ろに名前の文字や . が続かないもの）の位置。キーワードと名前の間には空白が要る。
///
/// # 引数
///
/// - `stmt`：文（`flow from a to b;` など）
/// - `kws`：名前の前に来るキーワードの候補（`from`・`connect`・`to` など）
/// - `name`：探す名前（`a` や `a.p` などの参照）
///
/// # 戻り値
///
/// 名前の始まり（`stmt` の中のバイトオフセット）。当たるものが無ければ None。
///
/// # 例
///
/// ```text
/// after_keyword("flow from a to b;", &["to"], "b")     → Some(15)
/// after_keyword("flow from a.p to b;", &["from"], "a") → None   // 後ろに . が続く
/// ```
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
/// 宣言はポートを置く先（使用なら型の定義）に `向き port 名前 : 型;` で足す。見つからない線や流れでない線は飛ばす。暫定コアの `pins.ts` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：ポートを作る要素（定義か、内部ブロック図の部品）
/// - `name`：ポートの名前（基本名）
/// - `dir`：向き（`in`・`out`・`inout`）
/// - `ty`：ポートの型（空なら書かない）
/// - `flows`：書き換える線の ID と、書き換える端（始まりか終わりか）
/// - `ctx`：内部ブロック図の対象のキー（線の ID を探すのに使う）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、選ぶ名前・光らせる範囲（足した宣言）。名前・向きが使えないとき、置く先で名前が使われているときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// make_port(Doc(PORTS), b, "i", "in", "Sig", [{ id: "flow|u:a|u:b|#1", to: true }], Some("C"))
///   → Ok(text に "part def E { out port o; in port i : Sig; }" と "flow from a to b.i;")
/// make_port(Doc(PORTS), E, "o", "in", "", [], None) → Err("「o」は E の中で既に使われています")
/// make_port(Doc(PORTS), E, "x", "up", "", [], None) → Err("ポートの向き「up」は扱えません")
/// ```
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
                // 端は部品を指す道筋（入れ子の部品なら `a.b`）なので、その後ろにポートの名前を足す
                stmt.replace_range(i..i + path.len(), &format!("{path}.{name}"));
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

/// ポートの向き（in / out / inout）を書き換える。可視性（`private` など）は残し、元の向きを新しい向きに置き換える（無ければ足す）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：ポートを持つ要素
/// - `port`：ポートの名前
/// - `dir`：新しい向き（`in`・`out`・`inout`）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、光らせる範囲（ポートの宣言の頭）。向きが使えないとき・ポートが無いときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// set_port_dir(Doc(PORTS), E, "o", "inout") → Ok(text に "part def E { inout port o; }")
/// set_port_dir(Doc(PORTS), E, "o", "up")    → Err("ポートの向き「up」は扱えません")
/// ```
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

/// ポートを削除する（宣言を消す。行全体を占めるなら行ごと消す）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：ポートを持つ要素（内部ブロック図の部品なら、型の定義のポートを消す）
/// - `port`：ポートの名前
///
/// # 戻り値
///
/// 消した後のテキストと、光らせる範囲（消した位置の 1 バイト）。ポートが無ければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// delete_port(Doc(PORTS), a, "o") → Ok(text に "part def E { }")
/// delete_port(Doc(PORTS), a, "x") → Err("ポート「x」が見つかりません。…")
/// ```
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

/// SysML の名前として書く（基本名に使えない文字や予約語を含むときは引用名、8.2.2.1）。引用名の中の `\` と `'` は `\` で逃がす。
///
/// # 引数
///
/// - `name`：要素の名前（引用符を外した名前）
///
/// # 戻り値
///
/// テキストに書く名前。基本名で予約語でなければそのまま、そうでなければ `'…'`。
///
/// # 例
///
/// ```text
/// sysml_name("Kettle_1") → "Kettle_1"
/// sysml_name("全体図")   → "'全体図'"
/// sysml_name("part")     → "'part'"     // 予約語
/// sysml_name("it's")     → "'it\'s'"
/// ```
pub fn sysml_name(name: &str) -> String {
    if is_basic_name(name) && !is_keyword(name) {
        return name.to_owned();
    }
    format!("'{}'", name.replace('\\', "\\\\").replace('\'', "\\'"))
}

impl Doc<'_> {
    /// 名前を持つ親をたどった名前の並び（package P の中の A なら ["P", "A"]）。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    ///
    /// # 戻り値
    ///
    /// 外側から順の名前の並び（引用名にはしない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P { part def A; }" のとき
    /// name_path(A の番号) → ["P", "A"]
    /// name_path(P の番号) → ["P"]   // 外側が無い
    /// ```
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
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    ///
    /// # 戻り値
    ///
    /// `::` でつないだ修飾名。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P {\n    part def A;\n    part def '電気 ケトル';\n}\n" のとき
    /// qualified_name(A の番号)           → "P::A"
    /// qualified_name(電気 ケトル の番号) → "P::'電気 ケトル'"
    /// ```
    pub(super) fn qualified_name(&self, i: usize) -> String {
        self.name_path(i)
            .into_iter()
            .map(sysml_name)
            .collect::<Vec<_>>()
            .join("::")
    }

    /// e だけを出している expose（中身をまとめて出す expose は含めない）。`::*`・`::**`・`[ ]` の絞り込みが無く、対象が e の修飾名と同じものを集める。
    ///
    /// # 引数
    ///
    /// - `view`：view の宣言の番号
    /// - `i`：要素の宣言の番号
    ///
    /// # 戻り値
    ///
    /// e だけを出している expose（書いた順）。無ければ空。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P {\n    part def A;\n    part def B;\n    view v {\n        expose P::A;\n    }\n}\n" のとき
    /// exposes_only_for(v の番号, A の番号) → [expose P::A]
    /// exposes_only_for(v の番号, B の番号) → []
    /// ```
    fn exposes_only_for(&self, view: usize, i: usize) -> Vec<&Expose> {
        let plain = self.name_path(i).join("::");
        self.e(view)
            .exposes
            .iter()
            .flatten()
            .filter(|x| !x.members && !x.recursive && x.filter.is_none() && x.target == plain)
            .collect()
    }

    /// 名前の図（モデルの view）を探す。
    ///
    /// # 引数
    ///
    /// - `name`：view の名前
    ///
    /// # 戻り値
    ///
    /// view の宣言の番号。無ければ理由の文（`Err`）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P { view v { } }" のとき
    /// view_named("v")    → Ok(v の番号)
    /// view_named("gone") → Err("図「gone」が見つかりません。テキストが先に変わった可能性があります")
    /// ```
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
///
/// # 引数
///
/// - `kind`：図の描き方（`general`・`interconnection`・`stateTransition`・`sequence`・`actionFlow`）
///
/// # 戻り値
///
/// 標準ビュー定義の名前。知らない描き方なら None。
///
/// # 例
///
/// ```text
/// std_view_for("general")  → Some("GeneralView")
/// std_view_for("sequence") → Some("SequenceView")
/// std_view_for("actionFlow") → Some("ActionFlowView")
/// std_view_for("bogus")    → None
/// ```
fn std_view_for(kind: &str) -> Option<&'static str> {
    match kind {
        "general" => Some("GeneralView"),
        "interconnection" => Some("InterconnectionView"),
        "stateTransition" => Some("StateTransitionView"),
        "sequence" => Some("SequenceView"),
        "actionFlow" => Some("ActionFlowView"),
        _ => None,
    }
}

/// 図を保存するときの view の宣言。要素は 1 つずつ expose する。indent は view を置く位置の字下げ。暫定コアの `view-text.ts` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `name`：図の名前（必要なら引用名にする）
/// - `std`：標準ビュー定義の名前（`GeneralView` など）
/// - `targets`：図に出す要素の宣言の番号
/// - `indent`：view を置く位置の字下げ（expose はこれより 1 段深く書く）
///
/// # 戻り値
///
/// view の宣言（先頭に字下げは付けない。閉じ括弧の前には `indent` を付ける）。
///
/// # 例
///
/// ```text
/// // d.text = "package P {\n    part def A;\n    part def '電気 ケトル';\n}\n" のとき
/// view_declaration(d, "全体", "GeneralView", [A, 電気 ケトル], "    ")
///   → "view '全体' : GeneralView {\n        expose P::A;\n        expose P::'電気 ケトル';\n    }"
/// view_declaration(d, "v", "GeneralView", [], "    ")
///   → "view v : GeneralView {\n    }"   // 要素が無い
/// ```
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

/// 表示中の図を、名前を付けて保存する（最初の package に view を書く）。名前の前後の空白は除く。暫定コアの `view-ops.ts` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `name`：図の名前
/// - `kind`：図の描き方（`general`・`interconnection`・`stateTransition`・`sequence`・`actionFlow`）
/// - `targets`：図に出す要素
///
/// # 戻り値
///
/// 書いた後のテキストと、選ぶ名前・光らせる範囲（足した view）。名前が空・既にある名前・知らない描き方・package が無い・
/// 一般の図でないのに対象が無いときは理由の文（`Err`）。一般の図は、要素の無い空の図も作れる（F-VIEW-8）。
///
/// # 例
///
/// ```text
/// save_view(Doc("package P {\n    part def A;\n    part def '電気 ケトル';\n}\n"), "全体", "general", [A, 電気 ケトル])
///   → Ok(text に "    view '全体' : GeneralView {\n        expose P::A;\n        expose P::'電気 ケトル';\n    }\n}")
/// save_view(Doc("package P { part def A; }"), "w", "general", [])         → Ok(text に "view w : GeneralView {\n    }")
/// save_view(Doc("package P { part def A; view v; }"), "v", "general", [A]) → Err("「v」という図は既にあります。別の名前にしてください")
/// save_view(Doc("package P { part def A; }"), "w", "actionFlow", [])      → Err("図の対象を選んでください")
/// save_view(Doc("part def A;"), "w", "general", [])                       → Err("図を置くパッケージがありません。先にパッケージを作ってください")
/// ```
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
    if targets.is_empty() && kind != "general" {
        return Err("図の対象を選んでください".to_owned());
    }
    let pkg = d.first_package().ok_or_else(|| {
        "図を置くパッケージがありません。先にパッケージを作ってください".to_owned()
    })?;
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
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `view`：view の名前
/// - `f`：入れる要素
///
/// # 戻り値
///
/// 足した後のテキストと、光らせる範囲（足した expose）。図が無いとき・既に図にあるときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P {\n    part def A;\n    part def B;\n    view v {\n        expose P::A;\n    }\n}\n" のとき
/// add_to_view(d, "v", B)    → Ok(text に "        expose P::A;\n        expose P::B;\n    }")
/// add_to_view(d, "v", A)    → Err("「A」は既にこの図にあります")
/// add_to_view(d, "gone", B) → Err("図「gone」が見つかりません。…")
/// ```
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
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `view`：view の名前
/// - `f`：外す要素
///
/// # 戻り値
///
/// 消した後のテキストと、光らせる範囲（消した位置の 1 バイト）。図が無いとき・その要素だけを出している expose が無いときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P {\n    part def A;\n    part def B;\n    view v {\n        expose P::A;\n    }\n}\n" のとき
/// remove_from_view(d, "v", A) → Ok(text に "    view v {\n    }")
/// remove_from_view(d, "v", B) → Err("「B」は、ほかの要素とまとめてこの図に入っているため、…")
/// ```
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

/// 作成した図の名前を変える（view の宣言の名前だけを書き換える。view は名前で参照されないので、ほかは変えない）。名前の前後の空白は除く。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `view`：今の図の名前
/// - `name`：新しい図の名前（基本名でなければ引用名で書く）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、選ぶ名前・光らせる範囲（view の宣言の頭）。同じ名前ならテキストを変えずに返す。
/// 図が無い・名前が空・既にある図の名前のときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// rename_view(Doc("package P { view v : GeneralView { } }"), "v", "全体") → Ok(text = "package P { view '全体' : GeneralView { } }")
/// rename_view(Doc("package P { view v; view w; }"), "v", "w")             → Err("「w」という図は既にあります。別の名前にしてください")
/// rename_view(Doc("package P { view v; }"), "v", " ")                     → Err("図の名前を入力してください")
/// ```
pub(super) fn rename_view(d: &Doc<'_>, view: &str, name: &str) -> Result<Change, Refusal> {
    let v = d.view_named(view)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("図の名前を入力してください".to_owned());
    }
    let e = d.e(v);
    if name == view {
        return Ok(Change {
            text: d.text.to_owned(),
            select: Some(name.to_owned()),
            flash: None,
        });
    }
    if d.m.views.iter().any(|x| x.name == name) {
        return Err(format!(
            "「{name}」という図は既にあります。別の名前にしてください"
        ));
    }
    let (hs, he) = (d.b(e.start), d.b(e.head_end));
    let unquote = |t: &str| t.trim_matches('\'').replace("\\'", "'");
    let at = tokens(d.text)
        .into_iter()
        .filter(|t| (hs..he).contains(&t.1))
        .skip_while(|t| t.2 != "view")
        .find(|t| {
            (t.0 == SyntaxKind::IDENT && t.2 == view)
                || (t.0 == SyntaxKind::QUOTED_NAME && unquote(t.2) == view)
        })
        .map(|t| (t.1, t.2.len()))
        .ok_or_else(|| format!("図「{view}」の名前が見つかりません"))?;
    let nn = sysml_name(name);
    let mut text = d.text.to_owned();
    text.replace_range(at.0..at.0 + at.1, &nn);
    let grow = nn.len() as isize - at.1 as isize;
    Ok(Change {
        text,
        select: Some(name.to_owned()),
        flash: Some((hs, (he as isize + grow) as usize)),
    })
}

/// 作成した図を削除する（view の宣言を消す）。図に出していたモデルの要素は残す。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `view`：図の名前
///
/// # 戻り値
///
/// 消した後のテキストと、光らせる範囲（消した位置の 1 バイト）。図が無いときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// delete_view(Doc("package P {\n    part def A;\n    view v {\n        expose P::A;\n    }\n}\n"), "v")
///   → Ok(text = "package P {\n    part def A;\n}\n")
/// delete_view(Doc("package P { }"), "gone") → Err("図「gone」が見つかりません。…")
/// ```
pub(super) fn delete_view(d: &Doc<'_>, view: &str) -> Result<Change, Refusal> {
    let e = d.e(d.view_named(view)?);
    let (text, at) = remove_range(d.text, d.b(e.start), d.b(e.end));
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}

// ---- 説明（doc）の編集 ----

/// 宣言の本体の直下にある最初の説明（`doc /* … */`）の、`doc` の始まりとコメントの範囲（バイト）。入れ子の要素の説明は見ない。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `i`：宣言の番号
///
/// # 戻り値
///
/// （`doc` の始まり, コメントの始まり, コメントの終わり）。説明が無ければ None。
///
/// # 例
///
/// ```text
/// // d.text = "requirement def R { doc /* 文 */ part p { doc /* 中 */ } }" のとき
/// doc_span(d, R) → Some((19, 23, 31))   // 「doc /* 文 */」
/// // d.text = "requirement def R;" のとき
/// doc_span(d, R) → None
/// ```
fn doc_span(d: &Doc<'_>, i: usize) -> Option<(usize, usize, usize)> {
    let e = d.e(i);
    let (from, to) = (d.b(e.start), d.b(e.end));
    let ts = tokens(d.text);
    let mut depth = 0;
    let mut doc_at = None;
    for &(kind, at, s) in ts.iter().filter(|t| (from..to).contains(&t.1)) {
        match s {
            "{" => depth += 1,
            "}" => depth -= 1,
            "doc" if depth == 1 && doc_at.is_none() => doc_at = Some(at),
            _ if kind == SyntaxKind::REGULAR_COMMENT => {
                if let Some(start) = doc_at {
                    return Some((start, at, at + s.len()));
                }
            }
            _ if doc_at.is_some() && !kind.is_trivia() && depth == 1 && s == ";" => doc_at = None,
            _ => {}
        }
    }
    None
}

/// 説明の文をコメントの本文にする。`*/` は書けないので `* /` にし、2 行目からは字下げを揃える。
///
/// # 引数
///
/// - `text`：説明の文（改行を含んでよい。前後の空白は除く）
/// - `indent`：`doc` の行の字下げ
///
/// # 戻り値
///
/// `/* … */` の形のコメント。
///
/// # 例
///
/// ```text
/// doc_comment("お湯を沸かす", "    ")        → "/* お湯を沸かす */"
/// doc_comment("1 行目\n2 行目", "    ")     → "/* 1 行目\n       2 行目 */"
/// doc_comment("a */ b", "")                 → "/* a * / b */"
/// ```
fn doc_comment(text: &str, indent: &str) -> String {
    let body = text.trim().replace("*/", "* /");
    let lines: Vec<&str> = body.lines().map(str::trim_end).collect();
    format!("/* {} */", lines.join(&format!("\n{indent}   ")))
}

/// 要素の説明（要求の文章など、`doc /* … */`）を書き換える。説明が無ければ本体の終わりに足し、文が空なら説明を消す（F-EDIT-12）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：説明を書き換える宣言
/// - `text`：新しい説明の文（前後の空白は除く。空なら説明を消す）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、光らせる範囲（書いた説明。消したときは消した位置の 1 バイト）。説明が無く文も空なら、テキストを変えずに返す。
///
/// # 例
///
/// ```text
/// set_doc(Doc("package P { requirement def R { doc /* 古い */ } }"), R, "新しい") → Ok(text = "package P { requirement def R { doc /* 新しい */ } }")
/// set_doc(Doc("package P { requirement def R; }"), R, "沸かす")                 → Ok(text = "package P { requirement def R {\n    doc /* 沸かす */\n} }" の形)
/// set_doc(Doc("package P {\n    requirement def R {\n        doc /* 古い */\n    }\n}"), R, "") → Ok(text = "package P {\n    requirement def R {\n    }\n}")
/// ```
pub(super) fn set_doc(d: &Doc<'_>, f: &Found, text: &str) -> Result<Change, Refusal> {
    let text = text.trim();
    let span = doc_span(d, f.entry);
    match span {
        Some((doc_at, _, c1)) if text.is_empty() => {
            let (out, at) = remove_range(d.text, doc_at, c1);
            Ok(Change {
                text: out,
                select: None,
                flash: Some((at, at + 1)),
            })
        }
        Some((doc_at, c0, c1)) => {
            let comment = doc_comment(text, indent_at(d.text, doc_at));
            let mut out = d.text.to_owned();
            out.replace_range(c0..c1, &comment);
            Ok(Change {
                text: out,
                select: None,
                flash: Some((doc_at, c0 + comment.len())),
            })
        }
        None if text.is_empty() => Ok(Change {
            text: d.text.to_owned(),
            select: None,
            flash: None,
        }),
        None => {
            let e = d.e(f.entry);
            let indent = format!("{}    ", indent_at(d.text, d.b(e.start)));
            let line = format!("doc {}", doc_comment(text, &indent));
            let (out, s, end) = insert_into(d.text, d.target(f.entry), &line);
            Ok(Change {
                text: out,
                select: None,
                flash: Some((s, end)),
            })
        }
    }
}

// ---- 属性の編集（F-EDIT-12） ----

/// 属性の型と値に書けない文字（文や本体の区切りになるもの）。
const ATTR_STOP: &[char] = &[';', '{', '}', '\n', '\r'];

/// 属性の宣言の 1 行を作る。名前は必要なら引用名にし、型・値が空ならその部分を書かない。
///
/// # 引数
///
/// - `head`：名前の前に書く語（`attribute`・`constant attribute` など）
/// - `name`：属性の名前
/// - `ty`：型（空なら書かない）
/// - `op`：値の書き方（`=`・`:=`・`default` など）
/// - `value`：値（空なら書かない）
///
/// # 戻り値
///
/// `attribute 名前 : 型 = 値;` の形の 1 行。
///
/// # 例
///
/// ```text
/// attribute_line("attribute", "mass", "Real", "=", "1500") → "attribute mass : Real = 1500;"
/// attribute_line("attribute", "重さ", "", "=", "")         → "attribute '重さ';"
/// attribute_line("attribute", "t", "Real", ":=", "0")      → "attribute t : Real := 0;"
/// ```
fn attribute_line(head: &str, name: &str, ty: &str, op: &str, value: &str) -> String {
    let ty = if ty.is_empty() {
        String::new()
    } else {
        format!(" : {ty}")
    };
    let value = if value.is_empty() {
        String::new()
    } else {
        format!(" {op} {value}")
    };
    format!("{head} {}{ty}{value};", sysml_name(name))
}

/// 属性を足すか、書き換える（インスペクタの「属性」。F-EDIT-12）。`attr` が無ければ足し、あればその名前の属性を書き換える。
/// 書き換えるときは、`constant` などの修飾と値の書き方（`:=`・`default`）を保つ。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：属性を持つ定義
/// - `attr`：書き換える属性の今の名前（足すときは None）
/// - `name`・`ty`・`value`：新しい名前・型・値（前後の空白は除く。型と値は空なら書かない）
///
/// # 戻り値
///
/// 書いた後のテキストと、光らせる範囲（書いた属性の宣言）。名前が空・使えない文字を含む・同じ名前の属性が既にある・
/// 書き換える属性が見つからない・属性に本体（`{ … }`）があるときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// set_attribute(Doc("package P { part def A; }"), A, None, "mass", "Real", "1500")
///   → Ok(text に "attribute mass : Real = 1500;")
/// set_attribute(Doc("package P { part def A { attribute m : Real := 1; } }"), A, Some("m"), "m", "Real", "2")
///   → Ok(text = "package P { part def A { attribute m : Real := 2; } }")
/// set_attribute(Doc("package P { part def A { attribute m; attribute n; } }"), A, Some("m"), "n", "", "")
///   → Err("「n」という属性は既にあります")
/// ```
pub(super) fn set_attribute(
    d: &Doc<'_>,
    f: &Found,
    attr: Option<&str>,
    name: &str,
    ty: &str,
    value: &str,
) -> Result<Change, Refusal> {
    let (name, ty, value) = (name.trim(), ty.trim(), value.trim());
    if name.is_empty() {
        return Err("属性の名前を入力してください".to_owned());
    }
    if name
        .chars()
        .any(|c| c == '\'' || c == '\\' || c.is_control())
    {
        return Err(super::ops::BAD_RENAME.to_owned());
    }
    if ty.contains(ATTR_STOP) || value.contains(ATTR_STOP) || ty.contains('=') {
        return Err(
            "型と値には「;」「{」「}」や改行は書けません（型には「=」も書けません）".to_owned(),
        );
    }
    let owner = d.e(f.entry);
    let attrs: Vec<usize> = owner
        .children
        .iter()
        .copied()
        .filter(|&c| d.e(c).kind == "attribute")
        .collect();
    let current = match attr {
        Some(a) => Some(
            attrs
                .iter()
                .copied()
                .find(|&c| d.e(c).name == a)
                .ok_or_else(|| {
                    format!("属性「{a}」が見つかりません。テキストが先に変わった可能性があります")
                })?,
        ),
        None => None,
    };
    if attrs
        .iter()
        .any(|&c| Some(c) != current && d.e(c).name == name)
    {
        return Err(format!("「{name}」という属性は既にあります"));
    }
    match current {
        Some(c) => {
            let e = d.e(c);
            if e.close.is_some() {
                return Err("この属性には中身があるため、テキストで直してください".to_owned());
            }
            let head = match e.mods.as_deref() {
                Some(m) if !m.is_empty() => format!("{m} attribute"),
                _ => "attribute".to_owned(),
            };
            let head = match e.dir.as_deref() {
                Some(dir) if !dir.is_empty() => format!("{dir} {head}"),
                _ => head,
            };
            let op = e.value_op.as_deref().unwrap_or("=");
            let line = attribute_line(&head, name, ty, op, value);
            let (s, end) = (d.b(e.start), d.b(e.end));
            let mut text = d.text.to_owned();
            text.replace_range(s..end, &line);
            Ok(Change {
                text,
                select: None,
                flash: Some((s, s + line.len())),
            })
        }
        None => {
            let line = attribute_line("attribute", name, ty, "=", value);
            let (text, s, end) = insert_into(d.text, d.target(f.entry), &line);
            Ok(Change {
                text,
                select: None,
                flash: Some((s, end)),
            })
        }
    }
}

/// 属性を消す（F-EDIT-12）。行全体を占めるなら行ごと消す。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：属性を持つ定義
/// - `attr`：消す属性の名前
///
/// # 戻り値
///
/// 消した後のテキストと、光らせる範囲（消した位置の 1 バイト）。属性が見つからないときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// remove_attribute(Doc("package P {\n    part def A {\n        attribute m;\n    }\n}"), A, "m")
///   → Ok(text = "package P {\n    part def A {\n    }\n}")
/// remove_attribute(Doc("package P { part def A; }"), A, "m") → Err("属性「m」が見つかりません。…")
/// ```
pub(super) fn remove_attribute(d: &Doc<'_>, f: &Found, attr: &str) -> Result<Change, Refusal> {
    let c = d
        .e(f.entry)
        .children
        .iter()
        .copied()
        .find(|&c| d.e(c).kind == "attribute" && d.e(c).name == attr)
        .ok_or_else(|| {
            format!("属性「{attr}」が見つかりません。テキストが先に変わった可能性があります")
        })?;
    let e = d.e(c);
    let (text, at) = remove_range(d.text, d.b(e.start), d.b(e.end));
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}
