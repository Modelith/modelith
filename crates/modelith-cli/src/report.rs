//! `modelith check` の出力（1 件 1 行と、最後のまとめの行）を組み立てる。入出力は持たない。

use modelith_core::project_file;
use modelith_core::rules::{DiagnosticSeverity, LoadProblem, Located, Place};

/// 出力する 1 件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// ファイル（プロジェクトのフォルダからの相対パス、`/` 区切り）。
    pub path: String,
    /// ファイルの中の位置。ファイル全体のことなら `None`。
    pub place: Option<Place>,
    pub severity: DiagnosticSeverity,
    pub message: String,
    /// 出どころ（`プラグイン/ルール` か `プラグイン`）。無ければ `None`。
    pub source: Option<String>,
}

/// 設定ファイル（`modelith.json`）の問題を、出力する 1 件にする。
///
/// # 引数
///
/// - `p`：設定ファイルの問題
///
/// # 戻り値
///
/// パスが `modelith.json` の 1 件（誤りは「エラー」、注意は「警告」）。
///
/// # 例
///
/// ```text
/// from_project_problem(誤り 1:1「…」) → Entry { path: "modelith.json", place: Some(1:1), severity: Error, source: None, … }
/// ```
pub fn from_project_problem(p: &project_file::Problem) -> Entry {
    Entry {
        path: "modelith.json".to_owned(),
        place: Some(Place {
            line: p.line,
            column: p.column,
        }),
        severity: match p.severity {
            project_file::Severity::Error => DiagnosticSeverity::Error,
            project_file::Severity::Warning => DiagnosticSeverity::Warning,
        },
        message: p.message.clone(),
        source: None,
    }
}

/// プラグインの読み込みの問題を、出力する 1 件（誤り）にする。
///
/// # 引数
///
/// - `plugin`：プラグインの ID
/// - `p`：読み込みの問題
///
/// # 戻り値
///
/// 出どころがプラグインの ID の、誤りの 1 件。
///
/// # 例
///
/// ```text
/// from_load_problem("jp.x", LoadProblem { path: "…/rules.yaml", place: Some(8:7), … })
///   → Entry { path: "…/rules.yaml", place: Some(8:7), severity: Error, source: Some("jp.x"), … }
/// ```
pub fn from_load_problem(plugin: &str, p: &LoadProblem) -> Entry {
    Entry {
        path: p.path.clone(),
        place: p.place,
        severity: DiagnosticSeverity::Error,
        message: p.message.clone(),
        source: Some(plugin.to_owned()),
    }
}

/// 検査の結果を、出力する 1 件にする。
///
/// # 引数
///
/// - `path`：検査したファイル
/// - `l`：位置つきの検査の結果
///
/// # 戻り値
///
/// 出どころが `プラグイン/ルール` の 1 件。
///
/// # 例
///
/// ```text
/// from_finding("model.sysml", Located { place: 2:3, finding: { plugin: "jp.x", rule: "r1", … } })
///   → Entry { path: "model.sysml", place: Some(2:3), source: Some("jp.x/r1"), … }
/// ```
pub fn from_finding(path: &str, l: &Located) -> Entry {
    Entry {
        path: path.to_owned(),
        place: Some(l.place),
        severity: l.finding.severity,
        message: l.finding.message.clone(),
        source: Some(format!("{}/{}", l.finding.plugin, l.finding.rule)),
    }
}

/// 重さを、出力の言葉にする。
///
/// # 引数
///
/// - `s`：重さ
///
/// # 戻り値
///
/// 「エラー」「警告」「情報」「ヒント」のいずれか。
///
/// # 例
///
/// ```text
/// label(Error)       → "エラー"
/// label(Information) → "情報"
/// ```
pub fn label(s: DiagnosticSeverity) -> &'static str {
    match s {
        DiagnosticSeverity::Error => "エラー",
        DiagnosticSeverity::Warning => "警告",
        DiagnosticSeverity::Information => "情報",
        DiagnosticSeverity::Hint => "ヒント",
    }
}

/// 1 件を 1 行にする（`パス:行:列: 重さ: 文 [出どころ]`）。
///
/// # 引数
///
/// - `e`：出力する 1 件
///
/// # 戻り値
///
/// 改行を含まない 1 行。位置が無ければ `パス: 重さ: 文`、出どころが無ければ末尾の `[…]` を書かない。
///
/// # 例
///
/// ```text
/// line(model.sysml 2:3 注意「a」jp.x/r1) → "model.sysml:2:3: 警告: a [jp.x/r1]"
/// line(rules.yaml 位置なし 誤り「b」jp.x) → "rules.yaml: エラー: b [jp.x]"
/// ```
pub fn line(e: &Entry) -> String {
    let at = e
        .place
        .map_or(String::new(), |p| format!(":{}:{}", p.line, p.column));
    let source = e
        .source
        .as_ref()
        .map_or(String::new(), |s| format!(" [{s}]"));
    format!(
        "{}{at}: {}: {}{source}",
        e.path,
        label(e.severity),
        e.message
    )
}

/// 全体の出力を作る。行はパス・行・列の順に並べ（位置の無いものはそのファイルの先頭）、最後にまとめの行を置く。
///
/// # 引数
///
/// - `entries`：出力する件（順は問わない。同じ位置のものは渡した順を保つ）
/// - `files`：検査したモデルのファイルの数
///
/// # 戻り値
///
/// 出力のテキスト（行ごとに改行）と、誤りが 1 件でもあるか。
///
/// # 例
///
/// ```text
/// render([b.sysml 1:1 注意, a.sysml 3:1 誤り], 2)
///   → ("a.sysml:3:1: エラー: …\nb.sysml:1:1: 警告: …\nファイル 2 件をチェックしました：エラー 1 件・警告 1 件・情報 0 件・ヒント 0 件\n", true)
/// render([], 0) → ("ファイル 0 件をチェックしました：エラー 0 件・警告 0 件・情報 0 件・ヒント 0 件\n", false)
/// ```
pub fn render(mut entries: Vec<Entry>, files: usize) -> (String, bool) {
    entries.sort_by(|a, b| {
        (a.path.as_str(), a.place.map(|p| (p.line, p.column)))
            .cmp(&(b.path.as_str(), b.place.map(|p| (p.line, p.column))))
    });
    let count = |s: DiagnosticSeverity| entries.iter().filter(|e| e.severity == s).count();
    let errors = count(DiagnosticSeverity::Error);
    let mut out: String = entries.iter().map(|e| line(e) + "\n").collect();
    out.push_str(&format!(
        "ファイル {files} 件をチェックしました：エラー {errors} 件・警告 {} 件・情報 {} 件・ヒント {} 件\n",
        count(DiagnosticSeverity::Warning),
        count(DiagnosticSeverity::Information),
        count(DiagnosticSeverity::Hint),
    ));
    (out, errors > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, place: Option<(u32, u32)>, severity: DiagnosticSeverity) -> Entry {
        Entry {
            path: path.to_owned(),
            place: place.map(|(line, column)| Place { line, column }),
            severity,
            message: "m".to_owned(),
            source: Some("jp.x/r".to_owned()),
        }
    }

    #[test]
    fn line_has_path_place_label_message_and_source() {
        // Arrange
        let e = entry("model.sysml", Some((2, 3)), DiagnosticSeverity::Warning);
        // Act
        let got = line(&e);
        // Assert
        assert_eq!(got, "model.sysml:2:3: 警告: m [jp.x/r]");
    }

    #[test]
    fn line_without_place_or_source_omits_them() {
        // Arrange（境界値：位置も出どころも無い）
        let mut e = entry("modelith.json", None, DiagnosticSeverity::Error);
        e.source = None;
        // Act
        let got = line(&e);
        // Assert
        assert_eq!(got, "modelith.json: エラー: m");
    }

    #[test]
    fn labels_cover_every_severity() {
        // Arrange
        let all = [
            DiagnosticSeverity::Error,
            DiagnosticSeverity::Warning,
            DiagnosticSeverity::Information,
            DiagnosticSeverity::Hint,
        ];
        // Act
        let got: Vec<&str> = all.into_iter().map(label).collect();
        // Assert
        assert_eq!(got, ["エラー", "警告", "情報", "ヒント"]);
    }

    #[test]
    fn render_sorts_by_path_line_and_column() {
        // Arrange（位置の無いものはそのファイルの先頭。行 10 は行 9 の後）
        let entries = vec![
            entry("b.sysml", Some((1, 1)), DiagnosticSeverity::Hint),
            entry("a.sysml", Some((10, 1)), DiagnosticSeverity::Warning),
            entry("a.sysml", Some((9, 5)), DiagnosticSeverity::Warning),
            entry("a.sysml", Some((9, 2)), DiagnosticSeverity::Information),
            entry("a.sysml", None, DiagnosticSeverity::Warning),
        ];
        // Act
        let (out, _) = render(entries, 2);
        // Assert
        let places: Vec<&str> = out
            .lines()
            .map(|l| l.split(": ").next().unwrap_or(""))
            .collect();
        assert_eq!(
            places,
            [
                "a.sysml",
                "a.sysml:9:2",
                "a.sysml:9:5",
                "a.sysml:10:1",
                "b.sysml:1:1",
                "ファイル 2 件をチェックしました：エラー 0 件・警告 3 件・情報 1 件・ヒント 1 件"
            ]
        );
    }

    #[test]
    fn render_fails_only_when_there_is_an_error() {
        // Arrange（同値クラス：誤りなし／誤り 1 件）
        let warnings = vec![entry("a.sysml", Some((1, 1)), DiagnosticSeverity::Warning)];
        let one_error = vec![entry("a.sysml", Some((1, 1)), DiagnosticSeverity::Error)];
        // Act
        let got = (render(warnings, 1).1, render(one_error, 1).1);
        // Assert
        assert_eq!(got, (false, true));
    }

    #[test]
    fn render_of_nothing_is_only_the_summary() {
        // Arrange（境界値：0 件・ファイル 0）
        let entries = vec![];
        // Act
        let got = render(entries, 0);
        // Assert
        assert_eq!(
            got,
            (
                "ファイル 0 件をチェックしました：エラー 0 件・警告 0 件・情報 0 件・ヒント 0 件\n"
                    .to_owned(),
                false
            )
        );
    }

    #[test]
    fn project_warnings_stay_warnings() {
        // Arrange
        let p = project_file::Problem {
            severity: project_file::Severity::Warning,
            line: 1,
            column: 3,
            message: "不明な項目".to_owned(),
        };
        // Act
        let got = line(&from_project_problem(&p));
        // Assert
        assert_eq!(got, "modelith.json:1:3: 警告: 不明な項目");
    }
}
