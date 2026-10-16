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
}
