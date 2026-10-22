//! `modelith check <フォルダ>`：プロジェクトに入れたチェックルールで、フォルダの中のモデルを検査する（ADR-0018・ADR-0019 §5）。
//!
//! ここはファイルを集めて読むだけにし、判断はコア（`modelith_core::rules`・`project_file`）と `report` に任せる。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use modelith_core::levels;
use modelith_core::project_file;
use modelith_core::rules::{self, LoadedPlugin, ReadError};

use crate::report::{self, Entry};

/// 検査を行い、出力のテキストと、誤りがあったかを返す。
///
/// # 引数
///
/// - `folder`：プロジェクトのフォルダ
///
/// # 戻り値
///
/// 出力のテキスト（1 件 1 行とまとめの行）と、誤り（読み込みの誤りを含む）が 1 件でもあるか。
/// フォルダや `modelith.json` を読めないときは、理由の文を `Err` で返す。
///
/// # 例
///
/// ```text
/// run(Path::new("proj"))    → Ok(("model.sysml:2:3: 警告: … [jp.x/r1]\nファイル 1 件をチェックしました：…\n", false))
/// run(Path::new("missing")) → Err("フォルダ「missing」が見つかりません")
/// ```
pub fn run(folder: &Path) -> Result<(String, bool), String> {
    if !folder.is_dir() {
        return Err(format!("フォルダ「{}」が見つかりません", folder.display()));
    }
    let project_text = match read_text(&folder.join("modelith.json")) {
        Ok(text) => text,
        Err(ReadError::NotFound) => {
            return Err(format!(
                "フォルダ「{}」に modelith.json がありません。プロジェクトのフォルダを指定してください",
                folder.display()
            ));
        }
        Err(ReadError::Other(reason)) => {
            return Err(format!("modelith.json を読み込めません（{reason}）"));
        }
    };
    let parsed = project_file::parse(&project_text);
    let mut entries: Vec<Entry> = parsed
        .problems
        .iter()
        .map(report::from_project_problem)
        .collect();
    let Some(project) = parsed.project else {
        return Ok(report::render(entries, 0));
    };
    let plugins: Vec<LoadedPlugin> = project
        .plugins
        .iter()
        .filter(|(_, p)| p.enabled)
        .map(|(id, _)| rules::load_plugin(id, |rel| read_text(&folder.join(rel))))
        .collect();
    for plugin in &plugins {
        entries.extend(
            plugin
                .problems
                .iter()
                .map(|p| report::from_load_problem(&plugin.id, p)),
        );
    }
    let files =
        model_files(folder).map_err(|e| format!("フォルダの内容を読み込めません（{e}）"))?;
    // フォルダのすべてのファイルを 1 つのモデルとし、ファイルごとにその要素を検査する（ADR-0021）
    let mut texts: Vec<(String, String)> = Vec::new();
    for file in &files {
        let path = relative(folder, file);
        match read_text(file) {
            Ok(text) => texts.push((path, text)),
            Err(e) => entries.push(unreadable_model(&path, &e)),
        }
    }
    for (k, (path, text)) in texts.iter().enumerate() {
        let others: Vec<&str> = texts
            .iter()
            .enumerate()
            .filter(|&(j, _)| j != k)
            .map(|(_, (_, t))| t.as_str())
            .collect();
        // プロジェクトで選んだ知らせの重さを当てる（F-EDIT-11。画面と同じ）
        let located = rules::check_text(text, &others, &plugins);
        entries.extend(
            located
                .into_iter()
                .filter_map(|l| {
                    let finding = levels::apply_findings(vec![l.finding], &project.levels).pop()?;
                    Some(rules::Located {
                        place: l.place,
                        finding,
                    })
                })
                .map(|l| report::from_finding(path, &l)),
        );
    }
    Ok(report::render(entries, files.len()))
}

/// 読めなかったモデルのファイルを、誤りの 1 件にする。
///
/// # 引数
///
/// - `path`：ファイル（プロジェクトのフォルダからの相対パス）
/// - `e`：読めなかった理由
///
/// # 戻り値
///
/// 位置の無い誤りの 1 件。
///
/// # 例
///
/// ```text
/// unreadable_model("a.sysml", Other("UTF-8 のテキストではありません")) → a.sysml: エラー: ファイルを読み込めません（UTF-8 のテキストではありません）
/// ```
fn unreadable_model(path: &str, e: &ReadError) -> Entry {
    let reason = match e {
        ReadError::NotFound => "見つかりません",
        ReadError::Other(reason) => reason,
    };
    Entry {
        path: path.to_owned(),
        place: None,
        severity: rules::DiagnosticSeverity::Error,
        message: format!("ファイルを読み込めません（{reason}）"),
        source: None,
    }
}

/// ファイルをテキストとして読む。シンボリックリンクはたどらない（プロジェクトのフォルダの外を読まないため）。
///
/// # 引数
///
/// - `path`：ファイルのパス
///
/// # 戻り値
///
/// ファイルのテキスト。無ければ `ReadError::NotFound`、シンボリックリンク・読めない・UTF-8 でなければ理由つきの `ReadError::Other`。
///
/// # 例
///
/// ```text
/// read_text("proj/modelith.json") → Ok("{ … }")
/// read_text("proj/none.json")     → Err(NotFound)
/// read_text("proj/link.yaml")     → Err(Other("シンボリックリンクは読みません"))   // link.yaml がシンボリックリンク
/// ```
fn read_text(path: &Path) -> Result<String, ReadError> {
    if is_symlink(path).map_err(read_error)? {
        return Err(ReadError::Other(
            "シンボリックリンクは読みません".to_owned(),
        ));
    }
    let bytes = fs::read(path).map_err(read_error)?;
    String::from_utf8(bytes)
        .map_err(|_| ReadError::Other("UTF-8 のテキストではありません".to_owned()))
}

/// パスそのものがシンボリックリンクか（リンクの先は見ない）。
///
/// # 引数
///
/// - `path`：調べるパス
///
/// # 戻り値
///
/// シンボリックリンクなら true。無い・調べられなければ `io::Error`。
///
/// # 例
///
/// ```text
/// is_symlink("proj/link.yaml")  → Ok(true)    // ln -s rules.yaml proj/link.yaml
/// is_symlink("proj/rules.yaml") → Ok(false)
/// is_symlink("proj/none.yaml")  → Err(NotFound)
/// ```
fn is_symlink(path: &Path) -> io::Result<bool> {
    fs::symlink_metadata(path).map(|m| m.file_type().is_symlink())
}

/// ファイルの読み込みの `io::Error` を、コアの読み込みの誤りにする。
///
/// # 引数
///
/// - `e`：読み込みの誤り
///
/// # 戻り値
///
/// 無いなら `ReadError::NotFound`、それ以外は理由の文を持つ `ReadError::Other`。
///
/// # 例
///
/// ```text
/// read_error(io::Error::from(io::ErrorKind::NotFound))         → NotFound
/// read_error(io::Error::from(io::ErrorKind::PermissionDenied)) → Other("permission denied")
/// ```
fn read_error(e: io::Error) -> ReadError {
    if e.kind() == io::ErrorKind::NotFound {
        ReadError::NotFound
    } else {
        ReadError::Other(e.to_string())
    }
}

/// フォルダの中のモデルのファイル（`.sysml`・`.kerml`）を、パスの順に集める。飛ばすフォルダの中は見ない。
///
/// # 引数
///
/// - `folder`：プロジェクトのフォルダ
///
/// # 戻り値
///
/// ファイルのパスの一覧（名前の順）。フォルダを読めなければ `Err`。シンボリックリンクはたどらない。
///
/// # 例
///
/// ```text
/// // proj/a.sysml・proj/sub/b.kerml・proj/node_modules/c.sysml・proj/notes.txt
/// model_files("proj") → ["proj/a.sysml", "proj/sub/b.kerml"]
/// ```
fn model_files(folder: &Path) -> io::Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(folder)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = entry.file_type()?;
        if kind.is_dir() && !is_skipped_dir(&name) {
            found.extend(model_files(&entry.path())?);
        } else if kind.is_file() && is_model_file(&name) {
            found.push(entry.path());
        }
    }
    Ok(found)
}

/// 中を見ないフォルダか（隠しフォルダ・`.modelith`・ビルドの成果物・npm の依存）。
///
/// # 引数
///
/// - `name`：フォルダの名前
///
/// # 戻り値
///
/// 飛ばすなら true。
///
/// # 例
///
/// ```text
/// is_skipped_dir(".modelith")    → true
/// is_skipped_dir(".git")         → true
/// is_skipped_dir("target")       → true
/// is_skipped_dir("node_modules") → true
/// is_skipped_dir("models")       → false
/// ```
fn is_skipped_dir(name: &str) -> bool {
    name.starts_with('.') || name == "target" || name == "node_modules"
}

/// モデルのファイルか（拡張子が `.sysml` か `.kerml`）。
///
/// # 引数
///
/// - `name`：ファイルの名前
///
/// # 戻り値
///
/// モデルのファイルなら true（大文字と小文字を区別する）。
///
/// # 例
///
/// ```text
/// is_model_file("a.sysml")   → true
/// is_model_file("b.kerml")   → true
/// is_model_file("a.sysml.bak") → false
/// is_model_file(".sysml")    → false   // 名前の無い隠しファイル
/// ```
fn is_model_file(name: &str) -> bool {
    [".sysml", ".kerml"]
        .iter()
        .any(|ext| name.len() > ext.len() && name.ends_with(ext))
}

/// ファイルのパスを、プロジェクトのフォルダからの相対パス（`/` 区切り）にする。
///
/// # 引数
///
/// - `folder`：プロジェクトのフォルダ
/// - `file`：フォルダの中のファイル
///
/// # 戻り値
///
/// `/` 区切りの相対パス。フォルダの外なら、そのままのパス。
///
/// # 例
///
/// ```text
/// relative("proj", "proj/sub/a.sysml") → "sub/a.sysml"
/// relative("proj", "other/a.sysml")    → "other/a.sysml"
/// ```
fn relative(folder: &Path, file: &Path) -> String {
    let rel = file.strip_prefix(folder).unwrap_or(file);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_hidden_build_and_dependency_folders() {
        // Arrange（同値クラス：隠し・.modelith・target・node_modules／ふつうのフォルダ）
        let names = [
            ".modelith",
            ".git",
            "target",
            "node_modules",
            "models",
            "targets",
        ];
        // Act
        let got: Vec<bool> = names.iter().map(|n| is_skipped_dir(n)).collect();
        // Assert
        assert_eq!(got, [true, true, true, true, false, false]);
    }

    #[test]
    fn model_files_are_sysml_and_kerml_only() {
        // Arrange（境界値：拡張子だけの名前、後ろに続く拡張子、大文字）
        let names = [
            "a.sysml",
            "b.kerml",
            ".sysml",
            "a.sysml.bak",
            "a.SYSML",
            "a.layout.json",
        ];
        // Act
        let got: Vec<bool> = names.iter().map(|n| is_model_file(n)).collect();
        // Assert
        assert_eq!(got, [true, true, false, false, false, false]);
    }

    #[test]
    fn read_error_maps_not_found_and_keeps_other_reasons() {
        // Arrange（同値クラス：無い／それ以外）
        let missing = io::Error::from(io::ErrorKind::NotFound);
        let denied = io::Error::new(io::ErrorKind::PermissionDenied, "権限がありません");
        // Act
        let got = (read_error(missing), read_error(denied));
        // Assert
        assert_eq!(
            got,
            (
                ReadError::NotFound,
                ReadError::Other("権限がありません".to_owned())
            )
        );
    }

    #[test]
    fn relative_uses_slashes_inside_the_folder() {
        // Arrange
        let folder = Path::new("proj");
        // Act
        let got = (
            relative(folder, &folder.join("sub").join("a.sysml")),
            relative(folder, Path::new("other/a.sysml")),
        );
        // Assert
        assert_eq!(got, ("sub/a.sysml".to_owned(), "other/a.sysml".to_owned()));
    }
}
