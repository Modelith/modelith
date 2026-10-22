//! 操作ごとのテキストの書き換え（暫定コアの `web/src/app/ops.ts` と同じ書き方）。

use std::collections::HashSet;

use super::more::sysml_name;
use super::text::{Target, indent_at, insert_into, lower_first, remove_range};
use super::{Change, Doc, Intent, Refusal, more};
use crate::project::{RelKind, Span, text::is_basic_name};
use crate::syntax::{SyntaxKind, tokenize};

pub(super) const BAD_NAME: &str = "名前は英字か _ で始め、英字・数字・_ だけで付けてください";
/// 名前を変えるときに使えない文字を含む名前を断る文。
pub(super) const BAD_RENAME: &str = "名前に「'」「\\」や改行は使えません";

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

/// 2 列の表（`NEW_NAME`・`KW_FOR` など）から、キーに当たる値を引く。
///
/// # 引数
///
/// - `table`：（キー, 値）の表
/// - `k`：引くキー（`part def` など、宣言の種類）
///
/// # 戻り値
///
/// 最初に当たった値。無ければ None。
///
/// # 例
///
/// ```text
/// lookup(NEW_NAME, "part def")  → Some("NewPart")
/// lookup(KW_FOR, "state def")   → Some("exhibit state")
/// lookup(NEW_NAME, "item def")  → None   // 表に無い
/// ```
fn lookup(table: &[(&str, &'static str)], k: &str) -> Option<&'static str> {
    table.iter().find(|(x, _)| *x == k).map(|(_, v)| *v)
}

/// 意図を、操作ごとの書き換えに振り分ける。キーで指す要素は、操作の前にすべて `find` で探す。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト（解析結果・モデルつき）
/// - `intent`：図の操作の意図（ADR-0016）
///
/// # 戻り値
///
/// 操作でできたテキスト（位置はバイト）と、選ぶ要素・光らせる範囲。要素が見つからないときや操作できないときは、画面にそのまま出す理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P { part def NewPart; part def NewPart2; }" のとき
/// run(d, AddNode { kind: "part def" })        → Ok(select = Some("NewPart3"))
/// run(d, Rename { key: "Gone", name: "X" })   → Err("操作する要素「Gone」が見つかりません。…")
/// ```
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
        Intent::RenameView { view, name } => more::rename_view(d, view, name),
        Intent::DeleteView { view } => more::delete_view(d, view),
        // 遷移は、状態遷移の図の要素のキー（終了の記号を含む）でつなぐ
        Intent::Connect {
            rel, from, to, ctx, ..
        } if rel == "transition" => super::states::add_transition(d, from, to, ctx.as_deref()),
        // 順序の線（継起）は、アクションの流れの図の要素のキー（開始・終了を含む）でつなぐ
        Intent::Connect {
            rel, from, to, ctx, ..
        } if rel == "succession" => super::flow::add_succession(d, from, to, ctx.as_deref()),
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

/// キーの要素が見つからないときの理由の文を作る（画面にそのまま出す。ADR-0014）。
///
/// # 引数
///
/// - `key`：見つからなかったキー（図の要素のキー、または `u:名前`・`l:名前`、図の対象のキー）
///
/// # 戻り値
///
/// 理由の文。
///
/// # 例
///
/// ```text
/// missing("Gone") → "操作する要素「Gone」が見つかりません。テキストが先に変わった可能性があります"
/// missing("")     → "操作する要素「」が見つかりません。テキストが先に変わった可能性があります"
/// ```
pub(super) fn missing(key: &str) -> Refusal {
    format!("操作する要素「{key}」が見つかりません。テキストが先に変わった可能性があります")
}

impl Doc<'_> {
    /// キーの要素。`u:名前`・`l:名前` は、ctx（部品定義・シナリオ）の中の部品・ライフライン。
    /// `u:部品.部品`（入れ子の部品）と `j:…`（n 項の接続の点。接続の使用を指す）は、内部ブロック図の要素として探す。
    /// `note:…` はメモ（コメントの宣言）として探す。`a:…` は、ctx（アクション定義）のアクションの流れの図の要素として、
    /// `s:…` は、ctx（状態定義）の状態遷移の図の要素として探す。
    /// それ以外のキーは、図の要素のキー（同じ名前が 2 つ目なら `名前@持ち主`）として探す。
    ///
    /// # 引数
    ///
    /// - `key`：要素のキー（`A`・`A@Q`・`u:e`・`l:x`・`note:#1` など）
    /// - `ctx`：`u:`・`l:` のキーのときの図の対象のキー（部品定義・シナリオ）。None なら空のキーとして探す
    ///
    /// # 戻り値
    ///
    /// 見つかった宣言の番号。要素や図の対象が無ければ、理由の文（`Err`）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P { part def E; part def C { part e : E; } }" のとき
    /// find("C", None)         → Ok(Found { entry: C の番号 })
    /// find("u:e", Some("C"))  → Ok(Found { entry: C の中の e の番号 })
    /// find("u:e.x", Some("C")) → Ok(Found { entry: E の中の x の番号 })   // E に part x があるとき
    /// find("note:#1", None)   → Ok(Found { entry: 名前の無い 1 つ目のメモの番号 })   // メモが E を注釈するとき
    /// find("a:x", Some("A"))  → Ok(Found { entry: A の中のアクション x の番号 })   // action def A { action x; } のとき
    /// find("a:start", Some("A")) → Err("開始と終了の記号は、順序の線から決まります。…")
    /// find("s:on.low", Some("S")) → Ok(Found { entry: S の中の on の中の low の番号 })   // state def S { state on { state low; } } のとき
    /// find("u:e", None)       → Err("操作する要素「」が見つかりません。…")   // 対象が無い
    /// find("Gone", None)      → Err("操作する要素「Gone」が見つかりません。…")
    /// ```
    pub(super) fn find(&self, key: &str, ctx: Option<&str>) -> Result<Found, Refusal> {
        // 入れ子の部品（`u:a.b`）と n 項の接続の点（`j:…`）は、内部ブロック図と同じ決め方で探す
        if key.starts_with("j:") || key.strip_prefix("u:").is_some_and(|k| k.contains('.')) {
            let c = self.context(ctx.unwrap_or_default())?;
            return super::ibd::entry_of(self, c, key)
                .map(|entry| Found { entry })
                .ok_or_else(|| missing(key));
        }
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
        // アクションの流れの図の要素（`a:…`）は、モデルのアクションの流れから探す（8.2.3.17）
        if key.starts_with("a:") {
            let c = self.context(ctx.unwrap_or_default())?;
            return super::flow::entry_of(self, c, key)?
                .map(|entry| Found { entry })
                .ok_or_else(|| missing(key));
        }
        // 状態遷移の図の要素（`s:…`）は、モデルの状態遷移の図から探す（8.2.3.18）
        if key.starts_with("s:") {
            let c = self.context(ctx.unwrap_or_default())?;
            return super::states::entry_of(self, c, key)?
                .map(|entry| Found { entry })
                .ok_or_else(|| missing(key));
        }
        // メモ（`note:…`）は、コメントの宣言を指す（8.2.3.4）
        if key.starts_with("note:") {
            return self
                .m
                .notes
                .iter()
                .find(|n| n.key == key)
                .map(|n| Found { entry: n.entry })
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
    ///
    /// # 引数
    ///
    /// - `key`：図の対象の、図の要素のキー（部品定義・シナリオのキー）
    ///
    /// # 戻り値
    ///
    /// 対象の宣言の番号。キーの要素が無ければ、理由の文（`Err`）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P { part def C; }" のとき
    /// context("C")    → Ok(C の番号)
    /// context("Gone") → Err("操作する要素「Gone」が見つかりません。…")
    /// ```
    pub(super) fn context(&self, key: &str) -> Result<usize, Refusal> {
        self.m
            .nodes
            .iter()
            .find(|n| n.key == key)
            .map(|n| n.entry)
            .ok_or_else(|| missing(key))
    }

    /// テキストに出てくる、名前のある宣言の名前すべて（新しい名前が使われていないかを調べるのに使う）。
    ///
    /// # 戻り値
    ///
    /// 名前の集まり（空の名前は含めない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P { part def A; part a : A; }" のとき
    /// names() → {"P", "A", "a"}
    /// // d.text = "" のとき
    /// names() → {}
    /// ```
    pub(super) fn names(&self) -> HashSet<&str> {
        self.p
            .entries
            .iter()
            .map(|e| e.name.as_str())
            .filter(|n| !n.is_empty())
            .collect()
    }

    /// 書いた順で最初の package。暫定コアの `firstPackage`（`web/src/app/ops.ts`）と同じ。
    ///
    /// # 戻り値
    ///
    /// package の宣言の番号。package が無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "part def A; package P { } package Q { }" のとき
    /// first_package() → Some(P の番号)
    /// // d.text = "part def A;" のとき
    /// first_package() → None
    /// ```
    pub(super) fn first_package(&self) -> Option<usize> {
        self.p.entries.iter().position(|e| e.kind == "package")
    }

    /// e から上へたどった、最初の @Phase の値（自分か、外側の宣言から受け継ぐ）。値が空の指定は飛ばす。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    ///
    /// # 戻り値
    ///
    /// フェーズの値（`stage = K::a` なら `a`）。自分にも外側にも無ければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package Q { @Phase { stage = K::a; } part def X; }" のとき
    /// phase_of(X の番号) → Some("a")   // Q から受け継ぐ
    /// // d.text = "package P { part def A; }" のとき
    /// phase_of(A の番号) → None
    /// ```
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

    /// 子の名前と重ならない名前（base、base2、base3 …）。暫定コアの `uniqueChild` と同じ。直下の子の名前だけと比べる。
    ///
    /// # 引数
    ///
    /// - `i`：子を持つ宣言の番号
    /// - `base`：もとにする名前
    ///
    /// # 戻り値
    ///
    /// 直下の子に無い名前。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "part def C { part e : E; }" のとき
    /// unique_child(C の番号, "e") → "e2"
    /// unique_child(C の番号, "f") → "f"   // 重ならなければそのまま
    /// ```
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

/// 使われていない名前（base、base2、base3 …）を、使われているかを調べる関数で探す。
///
/// # 引数
///
/// - `base`：もとにする名前
/// - `taken`：名前が使われていれば true を返す関数
///
/// # 戻り値
///
/// 使われていない最初の名前。
///
/// # 例
///
/// ```text
/// unique("NewPart", |n| ["NewPart", "NewPart2"].contains(&n)) → "NewPart3"
/// unique("NewPart", |_| false)                                → "NewPart"
/// ```
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
/// package が無く `new_package` があれば、テキストの末尾（`@layout` コメントの前）に作ってそこに置く。
/// 名前は種類ごとの `NewPart` などで、使われていれば番号を付ける。フェーズの指定は、置く package から受け継ぐ値と違うときだけ書く。
/// 暫定コアの `OPS.addNode`（`web/src/app/ops.ts`）と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `kind`：追加する定義の種類（`part def`・`requirement def` など）
/// - `phase`：絞り込み中のフェーズの値（`detail` など）。None なら書かない
/// - `new_package`：package が無いときに作る package の名前
///
/// # 戻り値
///
/// 追加後のテキストと、選ぶ名前・光らせる範囲（足した定義）。package が無く作る名前も無いとき、作る名前が使えないときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// add_node(Doc("package P { part def NewPart; part def NewPart2; }"), "part def", None, None)
///   → Ok(select = Some("NewPart3"))
/// add_node(Doc("// メモ\n/* @layout {} */\n"), "part def", None, Some("Model"))
///   → Ok(text = "// メモ\n\npackage Model {\n    part def NewPart {\n    }\n}\n\n/* @layout {} */\n")
/// add_node(Doc("part def A;"), "part def", None, None)
///   → Err("要素を配置するパッケージがありません")
/// ```
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
        (None, None) => return Err("要素を配置するパッケージがありません".to_owned()),
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
/// 前のテキストとの間は空行 1 つにし、`@layout` コメントがあれば、その前にも空行を入れる。
///
/// # 引数
///
/// - `text`：元のテキスト
/// - `name`：作る package の名前（基本名。英字か `_` で始め、英字・数字・`_` だけ）
///
/// # 戻り値
///
/// 足した後のテキストと、足した package の位置（バイトオフセット。子を挿入できる形）。名前が使えなければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// append_package("", "M")
///   → Ok(("package M {\n}\n", Target { start: 0, head_end: 10, close: Some(12) }))
/// append_package("part def A;", "M")
///   → Ok(("part def A;\n\npackage M {\n}\n", Target { start: 13, head_end: 23, close: Some(25) }))
/// append_package("", "1x")
///   → Err("パッケージ名は、英字か _ で始め、英字・数字・_ だけで付けてください")
/// ```
pub(super) fn append_package(text: &str, name: &str) -> Result<(String, Target), Refusal> {
    if !is_basic_name(name) {
        return Err(
            "パッケージ名は、英字か _ で始め、英字・数字・_ だけで付けてください".to_owned(),
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
/// `/*` の後ろの空白は飛ばして `@layout` かを見る。
///
/// # 引数
///
/// - `text`：テキスト
///
/// # 戻り値
///
/// コメントの始まり（`/*` のバイトオフセット）。閉じた `@layout` コメントが無ければ None。
///
/// # 例
///
/// ```text
/// layout_comment_start("a /* @layout {} */") → Some(2)
/// layout_comment_start("/* x */")            → None
/// layout_comment_start("/* @layout {")       → None   // 閉じていない
/// ```
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
/// 名前は型の名前の先頭を小文字にしたもので、対象の中で重なれば番号を付ける。暫定コアの `OPS.addUsage` と同じ書き方。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `ctx`：図の対象（部品定義・シナリオ）のキー
/// - `ty`：部品の型の名前
///
/// # 戻り値
///
/// 追加後のテキストと、選ぶ名前・光らせる範囲（足した宣言）。図の対象が無ければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// add_usage(Doc("package P { part def E; part def C { part e : E; } }"), "C", "E")
///   → Ok(text = "package P { part def E; part def C { part e : E; part e2 : E; } }", select = Some("e2"))
/// add_usage(Doc("package P { }"), "Gone", "E")
///   → Err("操作する要素「Gone」が見つかりません。…")
/// ```
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

/// テキストを字句に分け、トークンとその位置（バイト）を返す。空白・コメントのトークンも含める。
///
/// # 引数
///
/// - `text`：テキスト
///
/// # 戻り値
///
/// （トークンの種類, 始まりのバイトオフセット, トークンの文字列）の列（書いた順）。
///
/// # 例
///
/// ```text
/// tokens("part a;") → [(KEYWORD, 0, "part"), (WHITESPACE, 4, " "), (IDENT, 5, "a"), (SEMI, 6, ";")]
/// tokens("")        → []
/// ```
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
/// コメントの中・長い名前の一部・`a.e` の `.` の後ろの名前・短い名前（`<'R1'>`）は変えない。引用名（`'名前'`）で書いた参照も変える。暫定コアの `OPS.rename` と同じ。
/// 基本名（英字か `_` で始まり、英数字と `_` だけ）でない名前（日本語・空白を含む名前など）は、引用名で書く（8.2.2.3）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `f`：名前を変える宣言
/// - `nn`：新しい名前（前後の空白は除く）
///
/// # 戻り値
///
/// 書き換えた後のテキストと、選ぶ名前・光らせる範囲（名前を変えた宣言の頭）。同じ名前なら、テキストを変えずに返す。
/// 名前が空・使えない文字（`'`・`\`・改行などの制御文字）を含む・既に使われているときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// rename(Doc("package P { part def E { port e; } part def C { part e : E; part f : E; flow from e.e to f.e; } }"), C の中の e, "g")
///   → Ok(text = "package P { part def E { port e; } part def C { part g : E; part f : E; flow from g.e to f.e; } }")
/// rename(Doc("package P { part def Kettle; part def C { part k : Kettle; } }"), Kettle, "電気 ケトル")
///   → Ok(text = "package P { part def '電気 ケトル'; part def C { part k : '電気 ケトル'; } }")
/// rename(Doc("package P { part def A; part def B; }"), A, "B")  → Err("「B」は既に使われています")
/// rename(Doc("package P { part def A; }"), A, "it's")           → Err(BAD_RENAME)
/// ```
fn rename(d: &Doc<'_>, f: &Found, nn: &str) -> Result<Change, Refusal> {
    let nn = nn.trim();
    if nn.is_empty() {
        return Err("名前を入力してください".to_owned());
    }
    if nn.chars().any(|c| c == '\'' || c == '\\' || c.is_control()) {
        return Err(BAD_RENAME.to_owned());
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
    // 名前の字句：基本名の IDENT か、短い名前（`<'…'>`）でない引用名
    let is_name = |i: usize| -> bool {
        let (kind, _, s) = ts[i];
        match kind {
            SyntaxKind::IDENT => s == old,
            SyntaxKind::QUOTED_NAME => {
                s.len() >= 2
                    && &s[1..s.len() - 1] == old
                    && !significant(i, -1).is_some_and(|t| t.2 == "<")
            }
            _ => false,
        }
    };
    // 使用の名前は、持ち主（部品定義など）の中でだけ参照される
    let owner =
        e.pe.map_or(0..d.text.len(), |p| d.b(d.e(p).start)..d.b(d.e(p).end));
    let mut hits: Vec<usize> = Vec::new(); // 字句の番号
    for (i, &(_, at, _)) in ts.iter().enumerate() {
        if !is_name(i) {
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
            hits.push(i);
        }
    }
    let (hs, he) = (d.b(e.start), d.b(e.head_end));
    let head = (0..ts.len()).find(|&i| is_name(i) && (hs..he).contains(&ts[i].1));
    if let Some(i) = head
        && !hits.contains(&i)
    {
        hits.push(i);
    }
    hits.sort_unstable();
    // 宣言の名前と基本名の参照は必要なら引用名に（宣言は基本名に戻せる）、ほかの引用名の参照は引用符の中だけを書き換える
    let quoted_inner = sysml_name(nn);
    let quoted_inner = quoted_inner.trim_matches('\'');
    let edits: Vec<(usize, usize, String)> = hits
        .iter()
        .map(|&i| {
            let (kind, at, s) = ts[i];
            if kind == SyntaxKind::QUOTED_NAME && Some(i) != head {
                (at + 1, s.len() - 2, quoted_inner.to_owned())
            } else {
                (at, s.len(), sysml_name(nn))
            }
        })
        .collect();
    let mut out = d.text.to_owned();
    for (at, len, by) in edits.iter().rev() {
        out.replace_range(*at..*at + *len, by);
    }
    let shift = |p: usize| {
        let grow: isize = edits
            .iter()
            .filter(|x| x.0 < p)
            .map(|x| x.2.len() as isize - x.1 as isize)
            .sum();
        (p as isize + grow) as usize
    };
    let flash = (shift(d.b(e.start)), shift(d.b(e.head_end)));
    Ok(Change {
        text: out,
        select: Some(nn.to_owned()),
        flash: Some(flash),
    })
}

/// 要素を削除する。行全体を占めるなら行ごと消す。選んだ要素の中に選んだ要素があれば、外側だけを消す。
/// 光らせる範囲は、最後に消した位置（テキストの前のほう）の 1 バイト。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `keys`：消す要素のキー（1 つ以上。同じものが重なってもよい）
/// - `ctx`：`u:`・`l:` のキーのときの図の対象のキー
///
/// # 戻り値
///
/// 消した後のテキスト。キーの要素が 1 つでも見つからなければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// delete(Doc("package P {\n    part def A;\n    part def C {\n        part def D;\n    }\n    part def B;\n}\n"), ["D", "C", "A"], None)
///   → Ok(text = "package P {\n    part def B;\n}\n")   // D は C と一緒に消える
/// delete(Doc("package P { part def A; }"), ["u:x"], Some("Gone"))
///   → Err("操作する要素「Gone」が見つかりません。…")
/// ```
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

/// 内部ブロック図・シーケンス図・アクションの流れの図の関係の ID（UI の `web/src/app/views.ts` と同じ ID）。
/// アクション定義（`action def`）なら、アクションの流れの線（`flow::edges`。`succession|a:a|a:b|#1` など）。
/// 状態定義（`state def`）なら、遷移の線（`states::edges`。`transition|s:a|s:b|Go#1` など）。
/// シナリオ（`occurrence def`）なら、メッセージを書いた順に `msg|順番|名前`。
/// それ以外なら、内部ブロック図の線（`ibd::edges`。`flow|u:部品|u:部品|ラベル#番号`・`bind|…`・`connect|j:…|…`）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：図の対象（部品定義・シナリオ）の宣言の番号
///
/// # 戻り値
///
/// （ID, 関係の範囲と関係の番号）の列。関係が無ければ空。
///
/// # 例
///
/// ```text
/// // d.text = "package P { part def E; part def C { part a : E; part b : E; flow from a to b; } occurrence def S { part x : E; message m1 from x to x; } }" のとき
/// context_edges(d, C の番号) → [("flow|u:a|u:b|#1", …)]
/// context_edges(d, S の番号) → [("msg|0|m1", …)]（イベントの間の順序があれば、続けて "succession|e:a.e|e:b.r|#1" など）
/// context_edges(d, E の番号) → []
/// ```
pub(super) fn context_edges(d: &Doc<'_>, c: usize) -> Vec<(String, EdgeAt)> {
    let ctx = d.e(c);
    let line = |r: &crate::project::Rel| Span {
        start: r.start,
        end: r.end + 1,
    };
    if ctx.kind == "action def" {
        return super::flow::edges(d, c);
    }
    if ctx.kind == "state def" {
        return super::states::edges(d, c);
    }
    if ctx.kind == "occurrence def" {
        let mut out: Vec<(String, EdgeAt)> = messages(d, c)
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
        // イベントの間の順序の線（ID はモデルのシーケンス図が決めたもの）
        let lines = d.m.sequences.iter().filter(|s| s.entry == c);
        out.extend(lines.flat_map(|s| &s.successions).map(|e| {
            let at = EdgeAt {
                src: e.src,
                rel: None,
            };
            (e.id.clone(), at)
        }));
        return out;
    }
    super::ibd::edges(d, c)
}

/// シナリオのメッセージ（書いた順。`ParseResult.rels` の番号）。対象の直下に書いたものだけを集める。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `c`：シナリオの宣言の番号
///
/// # 戻り値
///
/// メッセージの関係の番号（書いた位置の順）。無ければ空。
///
/// # 例
///
/// ```text
/// // d.text = "occurrence def S { part x : E; message m1 from x to x; message m2 from x to x; }" のとき
/// messages(d, S の番号) → [m1 の関係の番号, m2 の関係の番号]
/// // d.text = "part def C;" のとき
/// messages(d, C の番号) → []
/// ```
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
    /// ID の関係。ctx があれば、その図の関係から先に探し、無ければモデルの線から探す。
    ///
    /// # 引数
    ///
    /// - `id`：関係の ID（モデルの線の ID、または `context_edges` の ID）
    /// - `ctx`：内部ブロック図・シーケンス図の対象のキー。None ならモデルの線だけから探す
    ///
    /// # 戻り値
    ///
    /// 関係の範囲（UTF-16）と関係の番号。図の対象や関係が見つからなければ理由の文（`Err`）。
    ///
    /// # 例
    ///
    /// ```text
    /// // d.text = "package P { part def E; part def C { part a : E; part b : E; flow from a to b; } }" のとき
    /// edge("flow|u:a|u:b|#1", Some("C")) → Ok(EdgeAt { src: flow の文の範囲, rel: Some(…) })
    /// edge("x", None)                    → Err("操作する関係が見つかりません。テキストが先に変わった可能性があります")
    /// ```
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

/// 関係を削除する（関係を書いた文を消す。行全体を占めるなら行ごと消す）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `id`：関係の ID
/// - `ctx`：内部ブロック図・シーケンス図の対象のキー
///
/// # 戻り値
///
/// 消した後のテキストと、光らせる範囲（消した位置の 1 バイト）。関係が見つからなければ理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// delete_edge(Doc("package P {\n    part def A;\n    requirement def R;\n    satisfy R by A;\n}\n"), satisfy の線の ID, None)
///   → Ok(text = "package P {\n    part def A;\n    requirement def R;\n}\n")
/// delete_edge(Doc("package P { }"), "x", None) → Err("操作する関係が見つかりません。…")
/// ```
fn delete_edge(d: &Doc<'_>, id: &str, ctx: Option<&str>) -> Result<Change, Refusal> {
    let src = d.edge(id, ctx)?.src;
    let (text, at) = remove_range(d.text, d.b(src.start), d.b(src.end));
    Ok(Change {
        text,
        select: None,
        flash: Some((at, at + 1)),
    })
}

/// a から b への関係を書く。暫定コアの `OPS.connect` と同じ書き方。
/// `comp` は a の中に部品、`satisfy`・`derive` は同じ関係を最後に書いた場所（無ければ最初の package）に文、
/// `verify` は a の `objective` の中（無ければ `objective { … }` を作る）、`frame` は a の中に関心事、
/// `flow` は 2 つの部品を持つ定義（内部ブロック図なら対象）の中に流れを書く。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `rel`：関係の種類（`comp`・`satisfy`・`verify`・`frame`・`derive`・`flow`）
/// - `a`・`b`：関係の始まりと終わりの宣言
/// - `fp`・`tp`：流れの始まり・終わりのポートの名前（`flow` だけで使う。None ならポートを書かない）
/// - `ctx`：内部ブロック図の対象のキー。`flow` で a が使用のときに使う
///
/// # 戻り値
///
/// 書いた後のテキストと、光らせる範囲（足した文）。書く場所が無いとき・知らない種類のときは理由の文（`Err`）。
///
/// # 例
///
/// ```text
/// // d.text = "package P {\n    part def A;\n    part def B;\n    requirement def R;\n}\n" のとき
/// connect(d, "comp", A, B, None, None, None)     → Ok(text に "part def A {\n        part b : B;\n    }")
/// connect(d, "satisfy", A, R, None, None, None)  → Ok(text に "    satisfy R by A;\n}")
/// // d.text = "package P { part def E; part def F; }" のとき
/// connect(d, "flow", E, F, None, None, None)     → Err("2 つの部品を両方持つ部品定義がないため、流れを書けません")
/// connect(d, "bogus", E, F, None, None, None)    → Err("関係の種類「bogus」は扱えません")
/// ```
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
            // 内部ブロック図の入れ子の部品は、対象の中から `a.b` で指す
            let end = |u: usize, p: Option<&str>| {
                let path = super::ibd::path_of(d, parent, u);
                p.map_or_else(|| path.clone(), |p| format!("{path}.{p}"))
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

/// 関係を書く package が無いときの理由の文を作る（画面にそのまま出す。ADR-0014）。
///
/// # 戻り値
///
/// 理由の文。
///
/// # 例
///
/// ```text
/// no_package() → "関係を追加するパッケージがありません"
/// ```
fn no_package() -> Refusal {
    "関係を追加するパッケージがありません".to_owned()
}

/// a と b を部品として持つ最初の定義（flow を書く場所）と、その部品。部品は型の名前で探す（直下の `part` だけ）。
///
/// # 引数
///
/// - `d`：操作の対象のテキスト
/// - `a`・`b`：部品の型の名前（定義の名前）
///
/// # 戻り値
///
/// （定義の番号, a を型にした部品の番号, b を型にした部品の番号）。両方を持つ定義が無ければ None。
///
/// # 例
///
/// ```text
/// // d.text = "package P { part def E; part def F; part def C { part e : E; part f : F; } }" のとき
/// common_parent(d, "E", "F") → Some((C の番号, e の番号, f の番号))
/// common_parent(d, "E", "X") → None
/// ```
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
///
/// # 引数
///
/// - `text`：テキスト
/// - `open`：宣言の本体の開き括弧の位置（バイトオフセット）
///
/// # 戻り値
///
/// `objective` の始まりと、その閉じ括弧（`head_end`・`close` とも閉じ括弧のバイトオフセット）。`objective` が無いか、閉じていなければ None。
///
/// # 例
///
/// ```text
/// objective_block("verification def V { objective { verify R; } }", 19)
///   → Some(Target { start: 21, head_end: 43, close: Some(43) })
/// objective_block("verification def V { }", 19) → None
/// ```
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
