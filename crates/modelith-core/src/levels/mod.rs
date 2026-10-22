//! 知らせの重さ（F-EDIT-11、ADR-0019 §2）。プロジェクトの設定（`modelith.json` の `levels`）で選んだ重さを、
//! モデルの問題（トレースの抜け・まだ扱えない構文）とチェックルールの結果に当てる。画面と CLI で同じ関数を使う。
//! 構文エラーと見つからない型は、重さを変えられない（種類を持たない）。

use std::collections::BTreeMap;

use modelith_plugin_protocol::DiagnosticSeverity;
use serde::Serialize;

use crate::model::Problem;
use crate::project_file::Level;
use crate::rules::Finding;

#[cfg(test)]
mod tests;

/// 重さを選べる、モデルの知らせの種類 1 つ（チェックルールの結果は、ルールごとに `プラグインの ID/ルールの ID`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Kind {
    /// 設定に書く種類の名前。
    pub code: &'static str,
    /// 画面に出す名前（画面の言葉の手引きに従う）。
    pub label: &'static str,
    /// 何も選んでいないときの重さ。
    pub default: Level,
}

/// 重さを選べる、モデルの知らせの種類（画面の並び順）。
pub const KINDS: &[Kind] = &[
    Kind {
        code: "trace.derive",
        label: "トレースの抜け：上位・下位の要求とのつながり（derivation）",
        default: Level::Warning,
    },
    Kind {
        code: "trace.satisfy",
        label: "トレースの抜け：要求を満たす要素（satisfy）",
        default: Level::Warning,
    },
    Kind {
        code: "trace.verify",
        label: "トレースの抜け：要求を確かめる検証（verify）",
        default: Level::Warning,
    },
    Kind {
        code: "unsupported",
        label: "まだ扱えない書き方",
        default: Level::Info,
    },
];

/// 知らせの種類ごとの重さ（`modelith.json` の `levels`）。
pub type Levels = BTreeMap<String, Level>;

/// 設定に書ける知らせの種類か（モデルの知らせの種類か、`プラグインの ID/ルールの ID` の形）。
///
/// # 引数
///
/// - `kind`：種類の名前
///
/// # 戻り値
///
/// 書ける種類なら true。
///
/// # 例
///
/// ```text
/// is_known_kind("trace.verify")    → true
/// is_known_kind("jp.x/req-has-id") → true
/// is_known_kind("jp.x/")           → false（ルールの ID が無い）
/// is_known_kind("color")           → false
/// ```
pub fn is_known_kind(kind: &str) -> bool {
    KINDS.iter().any(|k| k.code == kind)
        || kind
            .split_once('/')
            .is_some_and(|(plugin, rule)| !plugin.is_empty() && !rule.is_empty())
}

/// チェックルールの結果の、知らせの種類の名前。
///
/// # 引数
///
/// - `plugin`：プラグインの ID
/// - `rule`：ルールの ID
///
/// # 戻り値
///
/// `プラグインの ID/ルールの ID`。
///
/// # 例
///
/// ```text
/// rule_kind("jp.x", "req-has-id") → "jp.x/req-has-id"
/// ```
pub fn rule_kind(plugin: &str, rule: &str) -> String {
    format!("{plugin}/{rule}")
}

/// 重さの、画面に返す名前（問題の `level`）。
///
/// # 引数
///
/// - `level`：重さ（出さないは名前を持たない）
///
/// # 戻り値
///
/// `"error"`・`"warning"`・`"info"`。出さないなら None。
///
/// # 例
///
/// ```text
/// level_name(Level::Info) → Some("info")
/// level_name(Level::Off)  → None
/// ```
fn level_name(level: Level) -> Option<&'static str> {
    match level {
        Level::Error => Some("error"),
        Level::Warning => Some("warning"),
        Level::Info => Some("info"),
        Level::Off => None,
    }
}

/// モデルの問題に、選んだ重さを当てる。「出さない」を選んだ種類の問題は除き、ほかの重さを選んだ種類の問題には `level` を付ける。
/// 種類を持たない問題（構文エラー・見つからない型）と、重さを選んでいない種類の問題はそのまま。
///
/// # 引数
///
/// - `problems`：モデルの問題
/// - `levels`：知らせの種類ごとの重さ
///
/// # 戻り値
///
/// 重さを当てた問題（並びはそのまま）。
///
/// # 例
///
/// ```text
/// // levels = { "trace.verify": "error", "unsupported": "off" }
/// apply_problems([構文エラー, 検証の抜け, 満たす要素の抜け, まだ扱えない書き方], &levels)
///   → [構文エラー, 検証の抜け（level: "error"）, 満たす要素の抜け]
/// ```
pub fn apply_problems(problems: Vec<Problem>, levels: &Levels) -> Vec<Problem> {
    problems
        .into_iter()
        .filter_map(|mut p| {
            let Some(level) = p.code.and_then(|c| levels.get(c)) else {
                return Some(p);
            };
            p.level = Some(level_name(*level)?);
            Some(p)
        })
        .collect()
}

/// チェックルールの結果に、選んだ重さを当てる。「出さない」を選んだルールの結果は除き、ほかの重さを選んだルールの結果は重さを置き換える（情報は `information`）。
///
/// # 引数
///
/// - `findings`：チェックルールの結果
/// - `levels`：知らせの種類ごとの重さ（ルールは `プラグインの ID/ルールの ID`）
///
/// # 戻り値
///
/// 重さを当てた結果（並びはそのまま）。
///
/// # 例
///
/// ```text
/// // levels = { "jp.x/r1": "error", "jp.x/r2": "off" }
/// apply_findings([r1 の警告, r2 の警告, r3 の情報], &levels) → [r1 のエラー, r3 の情報]
/// ```
pub fn apply_findings(findings: Vec<Finding>, levels: &Levels) -> Vec<Finding> {
    findings
        .into_iter()
        .filter_map(|mut f| {
            let Some(level) = levels.get(&rule_kind(&f.plugin, &f.rule)) else {
                return Some(f);
            };
            f.severity = match level {
                Level::Error => DiagnosticSeverity::Error,
                Level::Warning => DiagnosticSeverity::Warning,
                Level::Info => DiagnosticSeverity::Information,
                Level::Off => return None,
            };
            Some(f)
        })
        .collect()
}
