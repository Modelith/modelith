//! 暫定コア（`web/src/core/types.ts` の `Model`）と同じ形のモデル（ADR-0016 の手順 A）。
//!
//! 位置は UTF-16 のオフセット。宣言は `ParseResult.entries` の番号、関係は `ParseResult.rels` の番号で指し、
//! TS の境界でオブジェクトの参照（`nodeOf`・`byName` の Map、`phaseOf` の関数を含む）に戻す。

use serde::Serialize;

use crate::project::Span;

/// 図に描く要素のポート。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Port {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub conj: bool,
    pub dir: &'static str,
    pub entry: usize,
}

/// 図に描く要素。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub key: String,
    pub name: String,
    pub short: String,
    pub kind: String,
    pub is_def: bool,
    pub entry: usize,
    pub fam: &'static str,
    pub trans: Vec<String>,
    pub ports: Vec<Port>,
    pub phase: Option<String>,
    pub phase_own: bool,
}

/// 図に描く関係。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub kind: &'static str,
    pub from: String,
    pub to: String,
    pub label: String,
    pub src: Span,
    /// 流れ・接続の関係（`ParseResult.rels` の番号）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_port: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_port: Option<String>,
    /// 終わりの端に書く文字（部品として持つ線の多重度と飾り。`[4] ordered`・`redefines w` など。8.2.3 の multiplicity・c-adornment）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_label: Option<String>,
}

/// 問題一覧の 1 行。`kind` が無ければエラー、`gap` はトレースの抜け、`unsupported` はまだ扱えない構文。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Problem {
    pub pos: usize,
    pub msg: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'static str>,
}

/// 図に出した package（package そのものを expose したもの）。枠として描き、中の要素を枠の中に示す（F-VIEW-9）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub name: String,
    pub entry: usize,
    /// 枠の中に示す要素（package の中の、図に描く要素）のキー。
    pub node_keys: Vec<String>,
}

/// テキストに書かれた view（図として表示する。ADR-0005、F-VIEW-7）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub name: String,
    pub entry: usize,
    pub kind: &'static str,
    pub std: Option<&'static str>,
    pub node_keys: Vec<String>,
    pub targets: Vec<usize>,
    /// 枠として描く package（外側から順）。
    pub frames: Vec<Frame>,
}

/// モデル。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub nodes: Vec<Node>,
    pub views: Vec<View>,
    pub edges: Vec<Edge>,
    pub problems: Vec<Problem>,
    pub phases: Option<Vec<String>>,
    pub phase_enum: Option<String>,
}
