//! ブラウザ向けの wasm バインディング。Web Worker 内で読み込まれ、
//! UI とは LSP と同じ形のメッセージでやり取りする（ADR-0003）。

use wasm_bindgen::prelude::*;

/// コアのバージョンを返す。
#[wasm_bindgen]
pub fn version() -> String {
    modelith_core::VERSION.to_owned()
}

/// テキストを解析してモデルを作り、暫定コアと同じ形の `{ parse, model }` を JSON で返す（ADR-0015・ADR-0016）。
#[wasm_bindgen]
pub fn analyze(text: &str) -> String {
    analyze_json(text)
}

/// 図の操作の意図（JSON）を今のテキストに当て、テキストの編集を JSON で返す（ADR-0016）。
/// 返すのは `{ edits, select?, flash? }`、操作できなければ `{ refused }`（画面に出す文）。
#[wasm_bindgen]
pub fn edit(text: &str, intent: &str) -> String {
    edit_json(text, intent)
}

#[derive(serde::Serialize)]
struct Refused {
    refused: String,
}

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
