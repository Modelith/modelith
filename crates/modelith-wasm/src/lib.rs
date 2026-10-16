//! ブラウザ向けの wasm バインディング。Web Worker 内で読み込まれ、
//! UI とは LSP と同じ形のメッセージでやり取りする（ADR-0003）。

use wasm_bindgen::prelude::*;

/// コアのバージョンを返す。
///
/// # 戻り値
///
/// `modelith-core` の版（Cargo のワークスペースの版）。
///
/// # 例
///
/// ```text
/// version() → "0.1.0-alpha.4"（Cargo.toml の版。版を上げるとこの値も変わる）
/// ```
#[wasm_bindgen]
pub fn version() -> String {
    modelith_core::VERSION.to_owned()
}

/// テキストを解析してモデルを作り、暫定コアと同じ形の `{ parse, model }` を JSON で返す（ADR-0015・ADR-0016）。
///
/// 中身は `analyze_json` に任せる（wasm の境界を薄く保ち、テストを wasm なしで動かすため）。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
///
/// # 戻り値
///
/// `{ "parse": …, "model": … }` の JSON 文字列。位置はすべて UTF-16 のオフセット。書き誤りがあっても
/// 失敗せず、エラーは `parse.errors` に入る。
///
/// # 例
///
/// ```text
/// analyze("// 日本語\npart def A;") → "{\"parse\":{\"entries\":[{\"kind\":\"part def\",…,\"start\":7,…}],…},\"model\":{…}}"
/// ```
#[wasm_bindgen]
pub fn analyze(text: &str) -> String {
    analyze_json(text)
}

/// 図の操作の意図（JSON）を今のテキストに当て、テキストの編集を JSON で返す（ADR-0016）。
/// 返すのは `{ edits, select?, flash? }`、操作できなければ `{ refused }`（画面に出す文）。
///
/// 中身は `edit_json` に任せる。
///
/// # 引数
///
/// - `text`：今のテキスト全体
/// - `intent`：図の操作の意図の JSON（`{"op":"rename","key":"A","name":"B"}` など。形は `edit::Intent`）
///
/// # 戻り値
///
/// テキストの編集の JSON 文字列（位置は UTF-16 のオフセット）。意図が読めないときや操作できないときは
/// `{"refused":"…"}`。
///
/// # 例
///
/// ```text
/// edit("// 日本語\npackage P { part def A; }", r#"{"op":"rename","key":"A","name":"B"}"#)
///   → "{\"edits\":[{\"start\":28,\"end\":29,\"text\":\"B\"}],…}"
/// edit(…, r#"{"op":"rename"}"#) → "{\"refused\":\"操作を読み取れませんでした（…）\"}"
/// ```
#[wasm_bindgen]
pub fn edit(text: &str, intent: &str) -> String {
    edit_json(text, intent)
}

#[derive(serde::Serialize)]
struct Refused {
    refused: String,
}

/// 意図の JSON を読み、`edit::edit` でテキストの編集を作って JSON にする（`edit` の中身）。
///
/// # 引数
///
/// - `text`：今のテキスト全体
/// - `intent`：図の操作の意図の JSON（形は `edit::Intent`）
///
/// # 戻り値
///
/// 編集の結果の JSON 文字列。意図が JSON として読めなければ `{"refused":"操作を読み取れませんでした（理由）"}`、
/// 操作できなければ `{"refused":"画面に出す文"}`。
///
/// # 例
///
/// ```text
/// edit_json("// 日本語\npackage P { part def A; }", r#"{"op":"rename","key":"A","name":"B"}"#)
///   → "{\"edits\":[{\"start\":28,\"end\":29,\"text\":\"B\"}],…}"
/// edit_json(…, r#"{"op":"rename"}"#) → "{\"refused\":\"操作を読み取れませんでした（…）\"}"
/// ```
fn edit_json(text: &str, intent: &str) -> String {
    let result = serde_json::from_str::<modelith_core::edit::Intent>(intent)
        .map_err(|e| format!("操作を読み取れませんでした（{e}）"))
        .and_then(|i| modelith_core::edit::edit(text, &i));
    let json = match result {
        Ok(out) => serde_json::to_string(&out),
        Err(refused) => serde_json::to_string(&Refused { refused }),
    };
    json.unwrap_or_else(|e| format!(r#"{{"refused":"{e}"}}"#))
}

#[derive(serde::Serialize)]
struct Analysis {
    parse: modelith_core::project::ParseResult,
    model: modelith_core::model::Model,
}

/// テキストを解析・投影してモデルを作り、`{ parse, model }` を JSON にする（`analyze` の中身）。
///
/// # 引数
///
/// - `text`：SysML v2 のテキスト全体
///
/// # 戻り値
///
/// `{ "parse": …, "model": … }` の JSON 文字列（位置は UTF-16 のオフセット）。JSON への変換に失敗したときは
/// `{"error":"理由"}`（文字列のキーだけの構造なので、実際には起きない）。
///
/// # 例
///
/// ```text
/// analyze_json("// 日本語\npart def A;") → "…\"kind\":\"part def\"…\"start\":7…"
/// analyze_json("")                      → "{\"parse\":{\"entries\":[],…},\"model\":{…}}"
/// ```
fn analyze_json(text: &str) -> String {
    let parse = modelith_core::project::project(text, &modelith_core::syntax::parse(text));
    let model = modelith_core::model::build(&parse);
    // 文字列のキーだけの構造なので、JSON への変換は失敗しない
    serde_json::to_string(&Analysis { parse, model })
        .unwrap_or_else(|e| format!(r#"{{"error":"{e}"}}"#))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyze_json_returns_entries_with_utf16_positions() {
        // Arrange（境界値: 位置の前に多バイト文字がある）
        let text = "// 日本語\npart def A;";
        // Act
        let json = analyze_json(text);
        // Assert
        assert!(json.contains(r#""kind":"part def""#), "{json}");
        assert!(json.contains(r#""start":7"#), "{json}");
    }

    #[test]
    fn edit_json_returns_utf16_edits_or_refusal() {
        // Arrange
        let text = "// 日本語\npackage P { part def A; }";
        // Act
        let ok = edit_json(text, r#"{"op":"rename","key":"A","name":"B"}"#);
        let bad = edit_json(text, r#"{"op":"rename"}"#);
        // Assert（正常系と、読み取れない意図の異常系）
        assert!(
            ok.contains(r#""edits":[{"start":28,"end":29,"text":"B"}]"#),
            "{ok}"
        );
        assert!(
            bad.starts_with(r#"{"refused":"操作を読み取れませんでした"#),
            "{bad}"
        );
    }
}
