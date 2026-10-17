//! v0 のプラグイン（YAML のチェックルール、ADR-0018 §2）の読み込みと検査。
//!
//! ルールの形（`RuleSet`・`Rule`・マニフェスト）は plugin-sdk（`modelith-plugin-protocol`）が決め、
//! ここではそれを読み、モデルに当てる。ブラウザ（wasm）と CLI が同じコードを通るので、結果は同じになる。
//! ファイルを読むのは呼び出し側で、ここは入力（テキスト）から結果を返すだけ（I/O を持たない）。
//!
//! # ルールに書く言葉
//!
//! `match.kind` に書ける要素の種類（図に描く要素の種類。[`element_kinds`]）：
//!
//! - 定義：`occurrence def`・`part def`・`requirement def`・`constraint def`・`port def`・`item def`・
//!   `attribute def`・`concern def`・`verification def`・`analysis def`・`state def`・`action def`・
//!   `interface def`・`calc def`・`connection def`・`use case def`・`enum def`
//! - 使用：`part`・`requirement`（package の直下にあるものだけ。部品の中の部品は要素にならない）
//!
//! `require.incoming`・`require.outgoing` に書ける関係の種類（[`RELATIONS`]）。向きは「元 → 先」：
//!
//! | 書く言葉 | 意味 | 元 → 先 |
//! | --- | --- | --- |
//! | `satisfy` | 満たす | 満たす要素 → 要求 |
//! | `verify` | 検証する | 検証 → 要求 |
//! | `frame` | 扱う | 扱う要素 → 関心事 |
//! | `derivation` | 導出 | 導出した（下位の）要求 → 導出元の（上位の）要求 |
//! | `flow` | 流れ・接続 | 流れの元 → 先（`connect` の接続も含む） |
//!
//! 例えば「要求を満たす要素がある」は `incoming: satisfy`、「上位の要求から導出している」は `outgoing: derivation`。
//!
//! # 当て方
//!
//! - `match` は、書いた条件をすべて満たす要素に当てる（`kind` はいずれか、`phase` は工程の名前が等しい、`name` は名前が正規表現に当たる）
//! - `require` は、書いた条件をすべて満たせば良し、そうでなければ診断を出す。何も書かなければ常に良し
//!   （`not: {}` は常に満たさないので、当たった要素すべてに診断を出す）
//! - 正規表現は `regex-lite` の書き方で、名前のどこかに当たればよい（全体に当てるときは `^…$`）。`\w` などは ASCII だけに当たる
//! - 工程は、要素か、それを囲む要素に付けた `@Phase { stage = …; }` の値

mod check;
mod load;

#[cfg(test)]
mod tests;

pub use check::{check, check_text};
pub use load::{describe_manifest, load_plugin, load_plugin_files};
pub use modelith_plugin_protocol::{DiagnosticSeverity, Runtime};

use regex_lite::Regex;
use serde::Serialize;

/// プロジェクトに入れたプラグインを置くフォルダ（プロジェクトのフォルダからの相対パス。ADR-0019 §1）。
pub const PLUGINS_DIR: &str = ".modelith/plugins";

/// プラグインのフォルダの中の、マニフェストのファイル名。
pub const MANIFEST_FILE: &str = "modelith-plugin.json";

/// ルールに書く関係の種類と、モデルの線の種類（`Edge.kind`）の対応。
pub const RELATIONS: &[(&str, &str)] = &[
    ("satisfy", "satisfy"),
    ("verify", "verify"),
    ("frame", "frame"),
    ("derivation", "derive"),
    ("flow", "flow"),
];

/// ルールの `match.kind` に書ける要素の種類（図に描く要素になる種類）を、宣言の種類の表の順に返す。
///
/// # 戻り値
///
/// 定義の種類（メタデータとビューの定義を除く）と、package の直下で要素になる使用の種類。
///
/// # 例
///
/// ```text
/// element_kinds() → ["occurrence def", "part def", "requirement def", …, "enum def", "part", "requirement"]
/// element_kinds().contains(&"view def") → false   // 図に描かない
/// ```
pub fn element_kinds() -> Vec<&'static str> {
    let defs = crate::project::DECL_KINDS
        .iter()
        .copied()
        .filter(|k| k.ends_with(" def") && !crate::model::UNDRAWN_DEF_KINDS.contains(k));
    defs.chain(crate::model::TOP_USAGE_KINDS.iter().copied())
        .collect()
}

/// ファイルの中の位置（1 始まりの行と列。列は UTF-16 コード単位）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Place {
    pub line: u32,
    pub column: u32,
}

/// プラグインを読み込むときの問題 1 件（どれも誤り。そのルールやファイルは使わない）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LoadProblem {
    /// 問題のあるファイル（プロジェクトのフォルダからの相対パス、`/` 区切り）。
    pub path: String,
    /// ファイルの中の位置。ファイル全体の問題（見つからないなど）や、位置を決められないときは `None`。
    pub place: Option<Place>,
    /// 画面にそのまま出す文（画面の言葉の手引きに従う）。
    pub message: String,
}

/// ファイルを読めなかった理由（呼び出し側が渡す）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    /// ファイルが無い。
    NotFound,
    /// それ以外（権限が無い、UTF-8 でないなど）。中身は理由の文。
    Other(String),
}

/// マニフェスト（`modelith-plugin.json`）から読んだ、プラグインを画面に示すための情報。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ManifestInfo {
    /// プラグインの ID。
    pub id: String,
    /// 表示名。
    pub name: String,
    /// プラグイン自身の版（`"0.1.0"` など）。
    pub version: String,
    /// 実行方式（`rules`・`browser`・`wasm-component`）。
    pub runtime: Runtime,
    /// 説明（書いてあれば）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// 読み込んだプラグイン 1 つ。
#[derive(Debug, Clone)]
pub struct LoadedPlugin {
    /// プラグインの ID（`modelith.json` の `plugins` のキー）。
    pub id: String,
    /// マニフェストが見つかったか（見つからなければ、プロジェクトに入っていない。F-PLUG-9）。
    pub installed: bool,
    /// マニフェストの情報。マニフェストが無い・JSON として読めないときは `None`。
    pub manifest: Option<ManifestInfo>,
    /// 使えるルール（問題のあったルールは入れない）。
    pub rules: Vec<CheckRule>,
    /// 読み込みの問題（読んだ順）。
    pub problems: Vec<LoadProblem>,
}

/// 使える形にしたルール 1 つ（正規表現を組み立て、関係の種類をモデルの線の種類に直したもの）。
#[derive(Debug, Clone)]
pub struct CheckRule {
    /// ルールの ID（プラグインの中で一意）。
    pub id: String,
    pub severity: DiagnosticSeverity,
    /// 診断の文（`{name}`・`{kind}` は差し込む前のまま）。
    pub message: String,
    pub(crate) target: Target,
    pub(crate) require: Condition,
}

/// ルールを当てる要素の条件（`match`）。
#[derive(Debug, Clone)]
pub(crate) struct Target {
    pub(crate) kinds: Vec<String>,
    pub(crate) phase: Option<String>,
    pub(crate) name: Option<Regex>,
}

/// 当たった要素が満たすべき条件（`require`）。関係の種類はモデルの線の種類に直してある。
#[derive(Debug, Clone, Default)]
pub(crate) struct Condition {
    pub(crate) incoming: Option<Vec<&'static str>>,
    pub(crate) outgoing: Option<Vec<&'static str>>,
    pub(crate) name: Option<Regex>,
    pub(crate) phase: Option<bool>,
    pub(crate) ports: Option<(Option<u32>, Option<u32>)>,
    pub(crate) not: Option<Box<Condition>>,
}

/// 検査の結果 1 件（要素が `match` に当たり、`require` を満たさなかった）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    /// プラグインの ID。
    pub plugin: String,
    /// ルールの ID。
    pub rule: String,
    pub severity: DiagnosticSeverity,
    /// `{name}`・`{kind}` を差し込んだ文。
    pub message: String,
    /// 要素のキー（`Node.key`）。
    pub element: String,
    /// 要素の宣言の始まり（UTF-16 のオフセット。モデルの問題の `pos` と同じ数え方）。
    pub pos: usize,
}

/// 位置を行・列にした検査の結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    pub place: Place,
    pub finding: Finding,
}
