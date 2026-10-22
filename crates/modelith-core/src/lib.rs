//! Modelith のコア。ブラウザ（wasm）・CLI・サーバで同じコードを共有する。
//!
//! 設計方針は `docs/adr/` を参照。特に ADR-0001（テキストが唯一の正本）に従い、
//! 図の操作を含むすべての変更はテキスト編集として表現する。

pub mod edit;
pub mod levels;
mod line_index;
pub mod model;
pub mod plugin_host;
pub mod project;
pub mod project_file;
pub mod rules;
pub mod syntax;

pub use line_index::{LineCol, LineIndex};

/// コアのバージョン。
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
