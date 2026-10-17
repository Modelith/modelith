//! `modelith` CLI。`check`（プロジェクトの検査ルールでの検査、ADR-0018）を持つ。`export` / MCP(stdio) は P3 で足す。

mod check;
mod report;

use std::path::Path;
use std::process::ExitCode;

/// 使い方の 1 行。
const USAGE: &str = "使い方: modelith check <フォルダ> | modelith --version";

/// コマンドラインの引数を見て、版を表示するか、検査するか、使い方を示す。標準出力・標準エラーに書く。
///
/// # 戻り値
///
/// `--version`・`-V` なら版（`modelith <版>`）を標準出力に書いて終了コード 0。
/// `check <フォルダ>` なら検査の結果を標準出力に書き、誤りが無ければ 0、あれば 1（フォルダを読めないときは理由を標準エラーに書いて 1）。
/// それ以外（引数なしを含む）は使い方を標準エラーに書いて終了コード 2。
///
/// # 例
///
/// ```text
/// modelith --version      → 標準出力 "modelith 0.1.0-alpha.4"（Cargo.toml の版）、終了コード 0
/// modelith check proj     → 標準出力 "model.sysml:2:3: 注意: … [jp.x/r1]\nファイル 1 件を検査しました：…"、終了コード 0
/// modelith check missing  → 標準エラー "modelith: フォルダ「missing」が見つかりません"、終了コード 1
/// modelith                → 標準エラー "使い方: modelith check <フォルダ> | modelith --version"、終了コード 2
/// modelith check a b      → 同上
/// ```
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["--version" | "-V"] => {
            println!("modelith {}", modelith_core::VERSION);
            ExitCode::SUCCESS
        }
        ["check", folder] => match check::run(Path::new(folder)) {
            Ok((out, failed)) => {
                print!("{out}");
                if failed {
                    ExitCode::from(1)
                } else {
                    ExitCode::SUCCESS
                }
            }
            Err(reason) => {
                eprintln!("modelith: {reason}");
                ExitCode::from(1)
            }
        },
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
