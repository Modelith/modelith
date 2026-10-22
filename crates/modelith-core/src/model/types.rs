//! 画面の型（`web/src/core/types.ts` の `Model`）と同じ形のモデル（ADR-0016 の手順 A）。
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
    /// ほかのファイルの要素なら、そのファイルの番号（1 から、`merge` に渡した順。ADR-0021）。表示中のファイルの要素は None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<usize>,
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

/// 図に描くコメント（メモの記号。8.2.3.4 の comment と annotation：角を折った四角と、注釈する要素への破線）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    /// 図の要素のキー（名前があれば `note:名前`、無ければ `note:#番号`）。配置はこのキーで覚える。
    pub key: String,
    /// コメントの宣言（`ParseResult.entries` の番号）。
    pub entry: usize,
    /// 注釈する要素のうち、図に描く要素のキー（書いた順）。空のコメントは図に描かないので、作らない。
    pub targets: Vec<String>,
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

/// アクションの流れの図（8.2.3.17）の要素 1 つ。アクション・制御の節・送受信などのアクションの節と、暗黙の開始（`start`）・終了（`done`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNode {
    /// 図の要素のキー（`a:名前`。名前の無い要素は `a:#番号`、開始・終了は `a:start`・`a:done`。入れ子の本体の要素は `a:外.中`・`a:外.start`）。
    /// 配置はこのキーで覚える。
    pub key: String,
    /// 名前（名前の無い要素は空）。
    pub name: String,
    /// 種類（宣言の種類。`action`・`fork`・`send` など。開始・終了は `start`・`done`）。
    pub kind: String,
    /// 宣言（`ParseResult.entries` の番号）。開始・終了は宣言を持たないので `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<usize>,
    /// パラメータ（向き `in`・`out`・`inout` の付いた特徴量。8.2.3.17 の parameter）。本体に無く型があれば、型の定義のパラメータ。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<Port>,
    /// 入れ子の本体の要素なら、その本体を持つアクションのキー（中に描く）。アクション定義の直下なら `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
}

/// アクション定義 1 つの、アクションの流れの図（ActionFlowView、8.2.3.17）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionFlow {
    /// アクション定義の、図の要素のキー。
    pub key: String,
    /// アクション定義の宣言（`ParseResult.entries` の番号）。
    pub entry: usize,
    /// 要素（開始、書いた順の要素、終了の順）。
    pub nodes: Vec<FlowNode>,
    /// アクション定義そのもののパラメータ（枠の上に描く。8.2.3.17 の parameter）。図のキーは `b:名前`。
    pub params: Vec<Port>,
    /// 区画（8.2.3.17 の swimlane）。要素を受け持つ部品（`perform 使用.要素;` を書いた部品）ごとに、書いた順。無ければ空。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lanes: Vec<Lane>,
    /// 継起（種類 `succession`）・順序付きの流れ（種類 `successionFlow`）・流れ（種類 `flow`）の線。
    /// 端は `nodes` のキーか、アクション定義そのもののパラメータ（`b:名前`）。流れの端のパラメータは `fromPort`・`toPort`（`port:名前`）。
    pub edges: Vec<Edge>,
}

/// アクションの流れの図の区画 1 つ（8.2.3.17 の swimlane）。受け持つ部品と、その部品が受け持つ要素。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    /// 区画のキー（`lane:部品の道のり`）。
    pub key: String,
    /// 受け持つ部品の道のり（`kettle.heater`。外の部品から）。
    pub name: String,
    /// 受け持つ部品の宣言（`ParseResult.entries` の番号）。
    pub entry: usize,
    /// 受け持つ要素のキー（`perform` を書いた順）。
    pub nodes: Vec<String>,
}

/// 状態遷移の図（8.2.3.18）の要素 1 つ。状態と、本体ごとの開始（最初の遷移の元）・終了（`done`）の記号。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateNode {
    /// 図の要素のキー（`s:名前`、入れ子は `s:外.中`。名前の無い状態は `s:頭#番号`、開始・終了は `s:頭#start`・`s:頭#done`）。
    /// 配置はこのキーで覚える。
    pub key: String,
    /// 名前（名前の無い状態は空。開始・終了は `start`・`done`）。
    pub name: String,
    /// 種類（`state`・`exhibit state`。開始・終了は `start`・`done`）。
    pub kind: String,
    /// 宣言（`ParseResult.entries` の番号）。開始・終了は宣言を持たないので `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<usize>,
    /// この要素を中に描く状態のキー（状態定義の直下の要素は `None`）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
    /// 並行の状態（中の状態を、破線で区切った領域に描く）か。
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub parallel: bool,
}

/// 状態定義 1 つの、状態遷移の図（StateTransitionView、8.2.3.18）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateMachine {
    /// 状態定義の、図の要素のキー。
    pub key: String,
    /// 状態定義の宣言（`ParseResult.entries` の番号）。
    pub entry: usize,
    /// 並行の状態定義（直下の状態を、破線で区切った領域に描く）か。
    pub parallel: bool,
    /// 要素（外の状態の直後に中の状態。本体ごとに、開始・書いた順の状態・終了の順）。
    pub nodes: Vec<StateNode>,
    /// 遷移（種類 `transition`）の線。端は `nodes` のキー。
    pub edges: Vec<Edge>,
}

/// シーケンス図のライフライン（8.2.3.9 の lifeline）。シナリオ（`occurrence def`）の直下の、名前のある部品と出来事。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lifeline {
    /// 図の要素のキー（`l:名前`）。
    pub key: String,
    /// 名前。
    pub name: String,
    /// 部品か出来事の宣言（`ParseResult.entries` の番号）。
    pub entry: usize,
}

/// シーケンス図の、ライフラインの上のイベント（8.2.3.9 の sq-proxy。札は `.ev`・`.sub.ev` の特徴の連鎖）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceEvent {
    /// キー（`e:ライフライン.連鎖`。`e:a.sub.ev` など）。
    pub key: String,
    /// イベントを描くライフラインのキー。
    pub lifeline: String,
    /// 札（ライフラインから先の連鎖に `.` を付けたもの。`.ev`・`.sub.ev`）。
    pub label: String,
    /// イベントの宣言（`ParseResult.entries` の番号）。ライフラインの本体に宣言が無いもの（型の中のもの・確かめられないもの）は `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<usize>,
    /// 上から何段目か（0 から。メッセージの端のイベントは、そのメッセージの段）。
    pub row: usize,
}

/// シーケンス図のメッセージ（8.2.3.9 の message）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceMessage {
    /// 線の ID（`msg|書いた順の番号|名前`。図の操作が同じ ID で探し直す）。
    pub id: String,
    /// 送り手・受け手のライフラインのキー。
    pub from: String,
    pub to: String,
    /// 送り手・受け手のイベントのキー（端が `a.ev` のとき）。端がライフラインそのものなら `None`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_event: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_event: Option<String>,
    /// 上から何段目か（0 から）。
    pub row: usize,
    /// メッセージの関係（`ParseResult.rels` の番号）。
    pub rel: usize,
}

/// シナリオ 1 つの、シーケンス図（SequenceView、9.2.20.2.7・8.2.3.9）。時間は上から下へ進む。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    /// シナリオの、図の要素のキー。
    pub key: String,
    /// シナリオの宣言（`ParseResult.entries` の番号）。
    pub entry: usize,
    /// ライフライン（書いた順。左から並べる）。
    pub lifelines: Vec<Lifeline>,
    /// ライフラインの上のイベント（段の順）。
    pub events: Vec<SequenceEvent>,
    /// メッセージ（段の順）。
    pub messages: Vec<SequenceMessage>,
    /// 別のライフラインのイベントの間の順序（種類 `succession`、8.2.3.9 の sq-succession）。端はイベントのキー。
    pub successions: Vec<Edge>,
    /// 段の数（メッセージと、メッセージの端でないイベントが 1 段ずつ使う）。
    pub rows: usize,
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
    /// 図に描くコメント（書いた順）。一般の図（GeneralView）にだけ描く。
    pub notes: Vec<Note>,
    /// アクション定義ごとの、アクションの流れの図（図の要素の順）。
    pub action_flows: Vec<ActionFlow>,
    /// 状態定義ごとの、状態遷移の図（図の要素の順）。
    pub state_machines: Vec<StateMachine>,
    /// シナリオ（`occurrence def`）ごとの、シーケンス図（図の要素の順）。
    pub sequences: Vec<Sequence>,
}
