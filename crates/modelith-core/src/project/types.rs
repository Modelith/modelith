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
    /// 型の修飾名（`Q::A`。引用符を外し `::` でつなぐ）。修飾の無い型は `ty` と同じ。名前の解決にだけ使い、TS には渡さない。
    #[serde(skip)]
    pub ty_path: String,
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
    /// 値の書き方（FeatureValue、8.2.2.6）。`:=`（初期値）・`default`・`default =`・`default :=`（既定値）を、
    /// 空白を 1 つにまとめて書いたとおりに持つ。`=`（束縛）と、値の無い宣言では `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_op: Option<String>,
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
    /// 特殊化・部分集合・再定義・参照（8.2.2.6）。相手ごとに、書いた順。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub specs: Vec<Spec>,
    /// 多重度（MultiplicityPart、8.2.2.6）。書いていなければ `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiplicity: Option<Multiplicity>,
    /// コメント（種類 `comment`、Comment、8.2.2.4）の本文。`/*`・`*/` と、各行の頭の空白と `*` を除き、行は改行でつなぐ。
    /// コメントでない宣言では `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// コメントが注釈する宣言の番号（`about` の相手。`about` が無ければ持ち主）。書いた順。見つからない相手は入れない。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub about: Vec<usize>,
    /// 別の言語での表し方（`rep r language "x" /* … */`、TextualRepresentation、8.2.2.4）。書いた順。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reps: Vec<Rep>,
}

/// 別の言語での表し方 1 つ（TextualRepresentation、8.2.2.4）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Rep {
    /// 名前（`rep r` の `r`）。無ければ空文字列。
    pub name: String,
    /// 言語の名前（`language "OCL"` の引用符の中）。
    pub language: String,
    /// 本文（`/*`・`*/` を外し、共通の字下げと前後の空の行を除いたもの。行は改行でつなぐ）。
    pub body: String,
}

/// 多重度と、その並びの性質（MultiplicityPart、8.2.2.6）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Multiplicity {
    /// `[` と `]` の中（空白を除いたもの。`0..4`・`*`・`1`）。範囲を書いていなければ空文字列。
    pub range: String,
    /// `ordered` を書いたか。
    pub ordered: bool,
    /// `nonunique` を書いたか。
    pub nonunique: bool,
}

/// 宣言の特殊化の相手 1 つ（SubclassificationPart・FeatureSpecializationPart、8.2.2.6）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Spec {
    /// 関係の種類。`specializes`（定義の `:>`・`specializes`）・`subsets`（使用の `:>`・`subsets`）・
    /// `redefines`（`:>>`・`redefines`）・`references`（`::>`・`references`）のいずれか。
    pub op: &'static str,
    /// 相手（書いた修飾名・特徴の連鎖から空白を除いたもの。引用符は残す）。
    pub target: String,
    /// 相手の修飾名（引用符を外し `::` でつなぐ）。名前の解決にだけ使い、TS には渡さない。
    #[serde(skip)]
    pub path: String,
    /// この相手だけを消すときの範囲（UTF-16 のオフセット。`end` は含まない）。
    pub start: usize,
    pub end: usize,
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
        /// 依存の名前（`dependency d from …` の `d`）。無ければ空。図のラベルにだけ使い、TS には渡さない。
        #[serde(skip)]
        name: String,
        /// 前に付けたメタデータの名前（`#trace dependency …` の `trace`）。無ければ空。図のラベルにだけ使い、TS には渡さない。
        #[serde(skip)]
        meta: String,
    },
    Message {
        name: String,
        item: String,
        a: String,
        b: String,
    },
    Satisfy {
        req: String,
        /// 満たす要素。`by` の無い `satisfy R;` では空（持ち主が満たす。8.2.2.21）。
        by: String,
        /// `not satisfy`（否定の充足、isNegated）か。図に描かず、トレースの抜けの検出にも数えない。
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        negated: bool,
    },
    Verify {
        req: String,
    },
    Frame {
        name: String,
        #[serde(rename = "type")]
        ty: String,
        /// 関心事の型の修飾名（`ty` の修飾を残したもの）。名前の解決にだけ使い、TS には渡さない。
        #[serde(skip)]
        path: String,
    },
    Flow {
        item: String,
        a: String,
        b: String,
        /// 名前付きのフロー（`flow f : FD from a to b;`、FlowUsage、8.2.2.16）の名前。名前の無いフローでは空。
        #[serde(default, skip_serializing_if = "String::is_empty")]
        name: String,
        /// 名前付きのフローの型（`: FD` の `FD`）。無ければ空。
        #[serde(default, rename = "type", skip_serializing_if = "String::is_empty")]
        ty: String,
        /// 名前付きのフローの使用（`ParseResult.entries` の番号）。名前の無いフローは宣言にしないので `None`。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<usize>,
    },
    Connect {
        a: String,
        b: String,
        item: String,
        usage: usize,
        /// 端すべて（書いた順。2 つ以上）。`a`・`b` は最初の 2 つ。n 項の `connect (a, b, c)`（8.2.2.13.1）で 3 つ以上になる。
        /// TS には 3 つ以上のときだけ渡す（2 つなら `a`・`b` と同じ）。
        #[serde(skip_serializing_if = "is_binary")]
        ends: Vec<String>,
    },
    Transition {
        from: String,
        ev: String,
        to: String,
    },
    /// `allocate x to y;`・`allocation a : AD allocate x to y;`（AllocationUsage、8.2.2.15）。`a` を `b` に割り当てる。
    Allocate {
        a: String,
        b: String,
        /// 割り当ての使用（名前の無いものを含む。`ParseResult.entries` の番号）。
        usage: usize,
    },
    /// `bind a = b;`・`binding bb bind a = b;`（BindingConnectorAsUsage、8.2.2.13.2）。両端は等しい値を持つ。
    Bind {
        a: String,
        b: String,
        /// 結び付けの使用（名前の無いものを含む。`ParseResult.entries` の番号）。
        usage: usize,
    },
}

/// 接続の端が 2 つ以下か（2 項の接続。端の一覧を TS に渡さない）。
///
/// # 引数
///
/// - `ends`：接続の端の一覧
///
/// # 戻り値
///
/// 端が 2 つ以下なら `true`。
///
/// # 例
///
/// ```text
/// is_binary(["a", "b"])      → true
/// is_binary(["a", "b", "c"]) → false
/// ```
fn is_binary(ends: &[String]) -> bool {
    ends.len() <= 2
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

/// 別名（`alias B for A;`、AliasMember）。持ち主の中身と同じように、名前 `name` で `target` を指す。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Alias {
    /// 別名（引用符を外したもの）。
    pub name: String,
    /// 指す先の修飾名（引用符を外し `::` でつなぐ）。
    pub target: String,
    /// 別名を書いた宣言の番号（package など）。ファイルの直下なら `None`。
    pub pe: Option<usize>,
}

/// `metadata M about A` の相手のうち、見つからなかったもの（8.2.2.27）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingRef {
    /// 文の位置（UTF-16 のオフセット）。
    pub pos: usize,
    /// 書いた相手の名前（修飾名・特徴の連鎖のまま）。
    pub name: String,
}

/// 解析結果。`layout`（`@layout` コメント）は TS の境界で読む。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ParseResult {
    pub entries: Vec<Entry>,
    pub blocks: Vec<Block>,
    pub rels: Vec<Rel>,
    pub errors: Vec<ParseError>,
    pub unsupported: Vec<Unsupported>,
    /// 同じファイルの中の別名。名前の解決にだけ使い、TS には渡さない。
    #[serde(skip)]
    pub aliases: Vec<Alias>,
    /// `import` の対象の修飾名（`ISQ::*` なら `ISQ`。書いた順）。標準ライブラリの型の判定にだけ使い、TS には渡さない。
    #[serde(skip)]
    pub imports: Vec<String>,
    /// `metadata M about A` の相手のうち、見つからなかったもの。問題一覧に出すためだけに使い、TS には渡さない。
    #[serde(skip)]
    pub missing_about: Vec<MissingRef>,
    /// `comment c about A` の相手のうち、見つからなかったもの。問題一覧に出すためだけに使い、TS には渡さない。
    #[serde(skip)]
    pub missing_comment_about: Vec<MissingRef>,
}
