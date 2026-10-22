//! プラグインに渡すモデル（`ModelSnapshot`、ADR-0018 §3 の `didChange`）を、解析結果とモデルから作る。

use modelith_plugin_protocol::{
    ModelElement, ModelPort, ModelRelation, ModelSnapshot, PortDirection, Range, RelationKind,
};

use super::position::Positions;
use crate::model::{Model, Node, Port};
use crate::project::ParseResult;

/// 解析結果とモデルから、プラグインに渡すモデルを作る。要素は図に描く要素、関係は契約にある種類（満たす・検証する・扱う・導出・流れ）だけを入れる。
///
/// # 引数
///
/// - `text`：解析したテキスト全体（位置を行・列にするのに使う）
/// - `parse`：`text` の解析結果
/// - `model`：`parse` から作ったモデル
///
/// # 戻り値
///
/// 要素（キー・名前・種類・工程・ポート・テキスト上の範囲）と関係（ID・種類・元と先のキー）。要素が無ければどちらも空。
///
/// # 例
///
/// ```text
/// snapshot("package P {\n  requirement def R;\n  part def A;\n  satisfy R by A;\n}", …)
///   → elements: [R（requirement def、range 1:2–1:20）, A（part def）]、relations: [satisfy A → R]
/// snapshot("", …) → elements: []、relations: []
/// ```
pub fn snapshot(text: &str, parse: &ParseResult, model: &Model) -> ModelSnapshot {
    let positions = Positions::new(text);
    let elements = model
        .nodes
        .iter()
        .map(|n| element(n, parse, &positions))
        .collect();
    let relations = model
        .edges
        .iter()
        .filter_map(|e| {
            relation_kind(e.kind).map(|kind| ModelRelation {
                id: e.id.clone(),
                kind,
                from: e.from.clone(),
                to: e.to.clone(),
            })
        })
        .collect();
    ModelSnapshot {
        elements,
        relations,
    }
}

/// 図に描く要素 1 つを、プラグインに渡す形にする。
///
/// # 引数
///
/// - `n`：モデルの要素
/// - `parse`：解析結果（宣言の範囲を引く）
/// - `positions`：テキストの位置の変換表
///
/// # 戻り値
///
/// 要素。宣言が見つからなければ、範囲はテキストの先頭（0:0–0:0）。
///
/// # 例
///
/// ```text
/// element(part def A（ポート p : Power、in）, …) → { key: "A", name: "A", kind: "part def", ports: [{ name: "p", type: "Power", direction: "in" }], range: … }
/// ```
fn element(n: &Node, parse: &ParseResult, positions: &Positions) -> ModelElement {
    let (start, end) = parse
        .entries
        .get(n.entry)
        .map_or((0, 0), |e| (e.start, e.end));
    ModelElement {
        key: n.key.clone(),
        name: n.name.clone(),
        kind: n.kind.clone(),
        phase: n.phase.clone(),
        ports: n.ports.iter().map(port).collect(),
        range: Range {
            start: positions.position(start),
            end: positions.position(end),
        },
    }
}

/// ポート 1 つを、プラグインに渡す形にする。
///
/// # 引数
///
/// - `p`：モデルのポート
///
/// # 戻り値
///
/// 名前・型（書いていなければ省く）・向き（in・out・inout 以外なら省く）。
///
/// # 例
///
/// ```text
/// port(Port { name: "p", ty: "Power", dir: "out", … }) → { name: "p", type: Some("Power"), direction: Some(Out) }
/// port(Port { name: "q", ty: "", dir: "?", … })        → { name: "q", type: None, direction: None }
/// ```
fn port(p: &Port) -> ModelPort {
    ModelPort {
        name: p.name.clone(),
        port_type: (!p.ty.is_empty()).then(|| p.ty.clone()),
        direction: match p.dir {
            "in" => Some(PortDirection::In),
            "out" => Some(PortDirection::Out),
            "inout" => Some(PortDirection::Inout),
            _ => None,
        },
    }
}

/// モデルの線の種類（`Edge.kind`）を、契約の関係の種類にする（検査ルールの `RELATIONS` と同じ対応）。
///
/// # 引数
///
/// - `kind`：線の種類
///
/// # 戻り値
///
/// 関係の種類。契約に無い線（型・部品の持ち方など）は `None`。
///
/// # 例
///
/// ```text
/// relation_kind("derive")  → Some(Derivation)
/// relation_kind("satisfy") → Some(Satisfy)
/// relation_kind("comp")    → None
/// ```
fn relation_kind(kind: &str) -> Option<RelationKind> {
    match kind {
        "satisfy" => Some(RelationKind::Satisfy),
        "verify" => Some(RelationKind::Verify),
        "frame" => Some(RelationKind::Frame),
        "derive" => Some(RelationKind::Derivation),
        "flow" => Some(RelationKind::Flow),
        _ => None,
    }
}
