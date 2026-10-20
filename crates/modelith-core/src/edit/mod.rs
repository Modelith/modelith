//! 図の操作（ADR-0016 の手順 B）。操作は「意図」として表し、要素を位置ではなくキーで指す。
//! コアは今のテキストを解析し直して要素を探し、テキストの編集（UTF-16 の位置）を返す。
//! ダイアログ・確認・トースト・配置は UI（TS）に残す。暫定コアの `web/src/app/ops.ts` と同じ書き方をする。

mod flow;
mod ibd;
mod more;
mod ops;
#[cfg(test)]
mod tests;
pub mod text;

use serde::{Deserialize, Serialize};

use crate::model::{self, Model};
use crate::project::{self, Entry, ParseResult};
pub use more::{FlowEnd, sysml_name};
use text::{Utf16, diff, utf16_of};

/// 図の操作の意図。要素は図の要素のキー、関係は ID で指す。
/// `ctx` は内部ブロック図・シーケンス図・アクションの流れの図の対象（部品定義・シナリオ・アクション定義のキー）。
/// `u:名前`・`l:名前`・`a:名前` のキーは、その中の部品・ライフライン・アクション。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Intent {
    /// 定義を追加する。`phase` は絞り込み中のフェーズ、`new_package` は package が無いときに作る package の名前。
    AddNode {
        kind: String,
        #[serde(default)]
        phase: Option<String>,
        #[serde(default)]
        new_package: Option<String>,
    },
    /// 内部ブロック図の部品・シーケンス図のライフラインを追加する。
    AddUsage {
        ctx: String,
        #[serde(rename = "type")]
        ty: String,
    },
    /// 名前を変え、参照もまとめて書き換える。
    Rename {
        key: String,
        name: String,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// 要素を削除する（複数選んだときはまとめて）。
    Delete {
        keys: Vec<String>,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// 関係を削除する。
    DeleteEdge {
        id: String,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// from から to への関係を追加する。`rel` は comp・satisfy・verify・frame・derive・flow。
    Connect {
        rel: String,
        from: String,
        to: String,
        #[serde(default)]
        from_port: Option<String>,
        #[serde(default)]
        to_port: Option<String>,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// シーケンス図にメッセージを足す（from・to はライフラインのキー）。
    AddMessage {
        ctx: String,
        from: String,
        to: String,
    },
    /// メッセージの名前とアイテムの型を書き換える（空なら書かない）。
    UpdateMessage {
        ctx: String,
        id: String,
        name: String,
        #[serde(rename = "type")]
        ty: String,
    },
    /// メッセージの順番を入れ替える（dir は -1 か 1）。
    MoveMessage { ctx: String, id: String, dir: i8 },
    /// フェーズを設定する。value が空なら、1 つの要素に書いた指定を外す。
    SetPhase {
        keys: Vec<String>,
        value: String,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// フェーズの定義を足す。`new_package` は package が無いときに作る package の名前。
    InitPhases {
        #[serde(default)]
        new_package: Option<String>,
    },
    /// 接続点をポートにする。`flows` は、その接続点につながっていて「部品.ポート」に書き換える線。
    MakePort {
        key: String,
        name: String,
        dir: String,
        #[serde(rename = "type", default)]
        ty: String,
        #[serde(default)]
        flows: Vec<FlowEnd>,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// ポートの向き（in・out・inout）を変える。
    SetPortDir {
        key: String,
        port: String,
        dir: String,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// ポートを削除する。
    DeletePort {
        key: String,
        port: String,
        #[serde(default)]
        ctx: Option<String>,
    },
    /// 表示中の図を、名前を付けて保存する。`kind` は描き方（general など）、`targets` は図に出す要素のキー。
    SaveView {
        name: String,
        kind: String,
        targets: Vec<String>,
    },
    /// 保存された図に要素を入れる。
    AddToView { view: String, key: String },
    /// 保存された図から要素を外す（モデルの要素は残す）。
    RemoveFromView { view: String, key: String },
}

/// テキストの編集 1 つ（UTF-16 の位置。古いテキストの [start, end) を text に置き換える）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TextEdit {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// 操作の結果。`select` は操作の後に選ぶ要素の名前、`flash` は編集後のテキストで光らせる範囲（UTF-16）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Outcome {
    pub edits: Vec<TextEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flash: Option<[usize; 2]>,
}

/// 操作できなかった理由（画面にそのまま出す文。ADR-0014）。
pub type Refusal = String;

/// 今のテキストに意図を当てて、テキストの編集を返す。暫定コアの `web/src/app/ops.ts` の操作と同じ振る舞い。
/// テキストを解析し直して要素をキーで探すので、意図を作った後にテキストが変わっていても、無くなった要素は断る。
///
/// # 引数
///
/// - `text`：今のテキスト（全体）
/// - `intent`：図の操作の意図（要素は図の要素のキー、関係は ID で指す。ADR-0016）
///
/// # 戻り値
///
/// テキストの編集（UTF-16 の位置）と、選ぶ要素・光らせる範囲。操作できなければ、画面にそのまま出す理由の文（`Err`）。
/// テキストが変わらない操作なら、編集は空。
///
/// # 例
///
/// ```text
/// edit("package P { part def A; }", Rename { key: "A", name: "B" })
///   → Ok(edits = [{ start: 21, end: 22, text: "B" }])
/// edit("package P { part def A; part def B; }", Rename { key: "A", name: "A" })
///   → Ok(edits = [])                                   // 同じ名前
/// edit("package P { part def A; }", Rename { key: "Gone", name: "X" })
///   → Err("…Gone…")                                    // 要素が無い
/// ```
pub fn edit(text: &str, intent: &Intent) -> Result<Outcome, Refusal> {
    let doc = Doc::new(text);
    let change = ops::run(&doc, intent)?;
    Ok(change.outcome(text))
}

/// 操作の対象のテキストと、その解析結果・モデル。
pub(crate) struct Doc<'a> {
    pub text: &'a str,
    pub p: ParseResult,
    pub m: Model,
    utf16: Utf16,
}

impl<'a> Doc<'a> {
    /// テキストを解析し、モデルを作って、操作の対象にする。
    ///
    /// # 引数
    ///
    /// - `text`：今のテキスト（全体）
    ///
    /// # 戻り値
    ///
    /// テキスト・解析結果・モデルと、UTF-16 の位置からバイトへの対応をまとめたもの。解析できない部分があっても失敗しない（問題はモデルの `problems` に入る）。
    ///
    /// # 例
    ///
    /// ```text
    /// Doc::new("package P { part def A; }") → m.nodes のキーは ["A"]
    /// Doc::new("")                          → m.nodes は空
    /// ```
    pub fn new(text: &'a str) -> Self {
        let p = project::project(text, &crate::syntax::parse(text));
        let m = model::build(&p);
        Self {
            text,
            p,
            m,
            utf16: Utf16::new(text),
        }
    }

    /// 解析結果の位置（UTF-16）のバイトオフセット。
    ///
    /// # 引数
    ///
    /// - `pos`：解析結果の位置（UTF-16 のオフセット）
    ///
    /// # 戻り値
    ///
    /// `text` の中のバイトオフセット。範囲外ならテキストの末尾。
    ///
    /// # 例
    ///
    /// ```text
    /// // text = "あa" のとき
    /// b(1) → 3
    /// b(9) → 4   // 範囲外は末尾
    /// ```
    pub fn b(&self, pos: usize) -> usize {
        self.utf16.byte(pos)
    }

    /// 宣言の番号から宣言を取り出す。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号（`ParseResult.entries` の添字。範囲外なら panic するので、解析結果から得た番号だけを渡す）
    ///
    /// # 戻り値
    ///
    /// その番号の宣言（位置は UTF-16）。
    ///
    /// # 例
    ///
    /// ```text
    /// // text = "package P { part def A; }" で、A の番号を i とすると
    /// e(i) → name が "A"、kind が "part def" の宣言
    /// ```
    pub fn e(&self, i: usize) -> &Entry {
        &self.p.entries[i]
    }

    /// 宣言を、子を挿入できる位置にする（バイトオフセット）。
    ///
    /// # 引数
    ///
    /// - `i`：宣言の番号
    ///
    /// # 戻り値
    ///
    /// 宣言の始まり・頭の終わり（`;` か `{` の位置）・閉じ括弧の位置（ブロックでなければ None）を、バイトオフセットにしたもの。
    ///
    /// # 例
    ///
    /// ```text
    /// // text = "package P { part def A; }" のとき
    /// target(A の番号) → Target { start: 12, head_end: 22, close: None }   // ; で終わる宣言
    /// ```
    pub fn target(&self, i: usize) -> text::Target {
        let e = self.e(i);
        text::Target {
            start: self.b(e.start),
            head_end: self.b(e.head_end),
            close: e.close.map(|c| self.b(c)),
        }
    }
}

/// 操作でできたテキスト（位置はバイト）。
#[derive(Debug, Default)]
pub(crate) struct Change {
    pub text: String,
    pub select: Option<String>,
    pub flash: Option<(usize, usize)>,
}

impl Change {
    /// 操作でできたテキストを、古いテキストに対する編集（UTF-16 の位置）にする。
    ///
    /// # 引数
    ///
    /// - `old`：操作の前のテキスト
    ///
    /// # 戻り値
    ///
    /// `diff` で求めた 1 つの編集（違いが無ければ空）と、選ぶ要素、光らせる範囲（新しいテキストの UTF-16 の位置）。
    ///
    /// # 例
    ///
    /// ```text
    /// // old = "package P { part def A; }"、text = "package P { part def B; }"、flash = Some((12, 22)) のとき
    /// outcome(old) → edits = [{ start: 21, end: 22, text: "B" }]、flash = Some([12, 22])
    /// // text が old と同じとき
    /// outcome(old) → edits = []
    /// ```
    fn outcome(self, old: &str) -> Outcome {
        let edits = diff(old, &self.text)
            .map(|(start, end, text)| TextEdit { start, end, text })
            .into_iter()
            .collect();
        let flash = self
            .flash
            .map(|(a, b)| [utf16_of(&self.text, a), utf16_of(&self.text, b)]);
        Outcome {
            edits,
            select: self.select,
            flash,
        }
    }
}
