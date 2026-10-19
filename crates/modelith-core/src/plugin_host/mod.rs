//! v1 のプラグイン（TypeScript、ADR-0018 §3・§4）とのやり取りのうち、コアが受け持つ判断。
//!
//! メッセージの型（`PluginMessage`・`ModelSnapshot`・`TextEdit`）は plugin-sdk（`modelith-plugin-protocol`）が決める。
//! ここでは、プラグインから届いたメッセージをその型で読み（形の正しくないものは使わない）、
//! マニフェストで宣言した権限で許されるかを確かめ、テキストの位置（行・列）を画面の位置（UTF-16 のオフセット）に直す。
//! プラグインに渡すモデル（`ModelSnapshot`）もここで作る。I/O は持たない（呼び出し側がテキストと JSON を渡す）。

mod message;
mod position;
mod snapshot;

#[cfg(test)]
mod tests;

pub use message::{
    CheckedMessage, PlacedDiagnostic, PlacedEdit, check_message, place_diagnostics,
    required_permission, resolve_edits,
};
pub use snapshot::snapshot;
