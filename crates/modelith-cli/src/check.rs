//! `modelith check <フォルダ>`：プロジェクトに入れた検査ルールで、フォルダの中のモデルを検査する（ADR-0018・ADR-0019 §5）。
//!
//! ここはファイルを集めて読むだけにし、判断はコア（`modelith_core::rules`・`project_file`）と `report` に任せる。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

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
/// run(Path::new("proj"))    → Ok(("model.sysml:2:3: 注意: … [jp.x/r1]\nファイル 1 件を検査しました：…\n", false))
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
            return Err(format!("modelith.json を読み取れません（{reason}）"));
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
    let files = model_files(folder).map_err(|e| format!("フォルダの中を読み取れません（{e}）"))?;
    for file in &files {
        let path = relative(folder, file);
        match read_text(file) {
            Ok(text) => entries.extend(
                rules::check_text(&text, &plugins)
                    .iter()
                    .map(|l| report::from_finding(&path, l)),
            ),
            Err(e) => entries.push(unreadable_model(&path, &e)),
        }
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
/// unreadable_model("a.sysml", Other("UTF-8 のテキストではありません")) → a.sysml: 誤り: ファイルを読み取れません（UTF-8 のテキストではありません）
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
        message: format!("ファイルを読み取れません（{reason}）"),
        source: None,
    }
}

/// ファイルをテキストとして読む。
///
/// # 引数
///
/// - `path`：ファイルのパス
///
/// # 戻り値
///
/// ファイルのテキスト。無ければ `ReadError::NotFound`、読めない・UTF-8 でなければ理由つきの `ReadError::Other`。
///
/// # 例
///
/// ```text
/// read_text("proj/modelith.json") → Ok("{ … }")
/// read_text("proj/none.json")     → Err(NotFound)
/// ```
fn read_text(path: &Path) -> Result<String, ReadError> {
    match fs::read(path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map_err(|_| ReadError::Other("UTF-8 のテキストではありません".to_owned())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(ReadError::NotFound),
        Err(e) => Err(ReadError::Other(e.to_string())),
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
