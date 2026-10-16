//! 暫定コア（`web/src/core/types.ts` の `ParseResult`）と同じ形の解析結果（ADR-0015）。
//!
//! 位置はすべて UTF-16 のオフセット（JS の文字列の位置）。要素どうしの参照は番号で持ち、
//! TS の境界でオブジェクトの参照に戻す。

use serde::Serialize;
use serde::ser::{SerializeMap, Serializer};

/// 持ち主（名前のある宣言か、名前の無いブロック）の番号。JSON では `{"e":0}`・`{"b":0}`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Scope {
    #[serde(rename = "e")]
    Entry(usize),
    #[serde(rename = "b")]
    Block(usize),
}

/// テキスト上の範囲。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

/// 要素に書かれた式。`via` は囲んでいる無名ブロックのキーワード。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Expr {
    pub text: String,
    pub via: String,
}

/// 書いた順を保つ文字列の表（メタデータの名前の順を JSON にそのまま出す）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OrderedMap<V>(pub Vec<(String, V)>);

impl<V> OrderedMap<V> {
    /// `key` の値。無ければ `make` で作って足す（末尾に足すので、書いた順が保たれる）。
    ///
    /// # 引数
    ///
    /// - `key`：探すキー（大文字と小文字を区別する）
    /// - `make`：キーが無いときに値を作る関数（キーがあれば呼ばない）
    ///
    /// # 戻り値
    ///
    /// その値への可変参照。失敗しない。
    ///
    /// # 例
    ///
    /// ```text
    /// // 表 [("a", 1)]
    /// entry("a", || 9) → &mut 1        （表は変わらない）
    /// entry("b", || 9) → &mut 9        （表は [("a", 1), ("b", 9)]）
    /// ```
    pub fn entry(&mut self, key: &str, make: impl FnOnce() -> V) -> &mut V {
        let i = match self.0.iter().position(|(k, _)| k == key) {
            Some(i) => i,
            None => {
                self.0.push((key.to_owned(), make()));
                self.0.len() - 1
            }
        };
        &mut self.0[i].1
    }
}

impl<V: Serialize> Serialize for OrderedMap<V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

/// 宣言 1 つ（定義・使用・パラメータ）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub kind: String,
    pub is_def: bool,
    pub short: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conj: Option<bool>,
    #[serde(rename = "type")]
    pub ty: String,
    pub owner: Option<Scope>,
    pub pe: Option<usize>,
    pub start: usize,
    pub head_end: usize,
    pub end: usize,
    pub head: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mods: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    pub exprs: Vec<Expr>,
    pub children: Vec<usize>,
    pub idx: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<OrderedMap<OrderedMap<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_val: Option<Span>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_block: Option<Scope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposes: Option<Vec<Expose>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filters: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close: Option<usize>,
}

/// 名前を持たないブロック（`objective { … }`、`@Phase { … }` など）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Block {
    pub kw: String,
    pub head: String,
    pub start: usize,
    pub owner: Option<Scope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<usize>,
}

/// view・view def の expose（8.2.2.26.2）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Expose {
    pub target: String,
    pub members: bool,
    pub recursive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    pub start: usize,
    pub end: usize,
}

/// 関係の種類と相手。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "rel", rename_all = "lowercase")]
pub enum RelKind {
    Derive {
        a: String,
        b: String,
    },
    Dependency {
        a: String,
        b: String,
    },
    Message {
        name: String,
        item: String,
        a: String,
        b: String,
    },
    Satisfy {
        req: String,
        by: String,
    },
    Verify {
        req: String,
    },
    Frame {
        name: String,
        #[serde(rename = "type")]
        ty: String,
    },
    Flow {
        item: String,
        a: String,
        b: String,
    },
    Connect {
        a: String,
        b: String,
        item: String,
        usage: usize,
    },
    Transition {
        from: String,
        ev: String,
        to: String,
    },
}

/// 要素間の関係を表す文。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rel {
    #[serde(flatten)]
    pub kind: RelKind,
    pub pe: Option<usize>,
    pub start: usize,
    pub end: usize,
}

/// 構文エラー。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ParseError {
    pub pos: usize,
    pub msg: String,
}

/// まだ扱えない文。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Unsupported {
    pub start: usize,
    pub end: usize,
    pub head: String,
}

/// 解析結果。`layout`（`@layout` コメント）は TS の境界で読む。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ParseResult {
    pub entries: Vec<Entry>,
    pub blocks: Vec<Block>,
    pub rels: Vec<Rel>,
    pub errors: Vec<ParseError>,
    pub unsupported: Vec<Unsupported>,
}
