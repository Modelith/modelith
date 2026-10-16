//! `modelith` CLI。P3 で `check` / `export` / MCP(stdio) を実装する。

use std::process::ExitCode;

/// コマンドラインの最初の引数を見て、版を表示するか使い方を示す。標準出力・標準エラーに書く。
///
/// # 戻り値
///
/// `--version`・`-V` なら版（`modelith <版>`）を標準出力に書いて終了コード 0。
/// それ以外（引数なしを含む）は使い方を標準エラーに書いて終了コード 2。
///
/// # 例
///
/// ```text
/// modelith --version → 標準出力 "modelith 0.1.0-alpha.4"（Cargo.toml の版）、終了コード 0
/// modelith -V        → 同上
/// modelith           → 標準エラー "usage: modelith --version"、終了コード 2
/// modelith check     → 同上（まだ無いコマンド）
/// ```
fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("--version" | "-V") => {
            println!("modelith {}", modelith_core::VERSION);
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: modelith --version");
            ExitCode::from(2)
        }
    }
}
