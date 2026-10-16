//! 図の操作（ADR-0016 の手順 B）。操作は「意図」として表し、要素を位置ではなくキーで指す。
//! コアは今のテキストを解析し直して要素を探し、テキストの編集（UTF-16 の位置）を返す。
//! ダイアログ・確認・トースト・配置は UI（TS）に残す。暫定コアの `web/src/app/ops.ts` と同じ書き方をする。

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
/// `ctx` は内部ブロック図・シーケンス図の対象（部品定義・シナリオのキー）。`u:名前`・`l:名前` のキーは、その中の部品・ライフライン。
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

/// 今のテキストに意図を当てて、テキストの編集を返す。
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
    pub fn b(&self, pos: usize) -> usize {
        self.utf16.byte(pos)
    }

    pub fn e(&self, i: usize) -> &Entry {
        &self.p.entries[i]
    }

    /// 宣言を、子を挿入できる位置にする（バイトオフセット）。
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
