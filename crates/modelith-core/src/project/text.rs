//! 文の頭の文字列を扱う小さな関数（暫定コアの正規表現と同じ判定を、正規表現を使わずに書く）。

/// 名前に使える文字か（`\w`）。ASCII の英数字と `_` だけを認める。
///
/// # 引数
///
/// - `c`：調べる文字
///
/// # 戻り値
///
/// ASCII の英数字か `_` なら `true`。
///
/// # 例
///
/// ```text
/// is_word('a') → true
/// is_word('_') → true
/// is_word(':') → false
/// is_word('部') → false   // ASCII でない
/// ```
pub fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// 基本名か（`[A-Za-z_]\w*`。KerML 8.2.2.1 の BASIC_NAME の ASCII の範囲）。
///
/// # 引数
///
/// - `s`：調べる文字列（全体を調べる）
///
/// # 戻り値
///
/// 全体が基本名なら `true`。空文字列は `false`。
///
/// # 例
///
/// ```text
/// is_basic_name("Engine_1") → true
/// is_basic_name("1a")       → false   // 数字で始まる
/// is_basic_name("")         → false
/// ```
pub fn is_basic_name(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && cs.all(is_word)
}

/// 基本名で始まる修飾名か（`[A-Za-z_][\w:]*`）。`:` の並び方は調べない。
///
/// # 引数
///
/// - `s`：調べる文字列（全体を調べる）
///
/// # 戻り値
///
/// 先頭が英字か `_` で、残りが名前の文字か `:` だけなら `true`。空文字列は `false`。
///
/// # 例
///
/// ```text
/// is_qualified_basic_name("PhaseKind::X") → true
/// is_qualified_basic_name("a.b")          → false
/// is_qualified_basic_name("")             → false
/// ```
pub fn is_qualified_basic_name(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| is_word(c) || c == ':')
}

/// 空白をまとめて 1 つにし、前後の空白を除く。改行やタブも空白として扱う。
///
/// # 引数
///
/// - `s`：元の文字列
///
/// # 戻り値
///
/// 語を半角空白 1 つでつないだ文字列。空白だけなら空文字列。
///
/// # 例
///
/// ```text
/// normalize("  part\n   def  A ") → "part def A"
/// normalize(" \t ")               → ""
/// ```
pub fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// コメントの本文（REGULAR_COMMENT の中身、8.2.2.4）。`/*`・`*/` を外し、各行の頭の空白と `*`（`/** … */` や、
/// 行の頭に並べた `*`）と、行末の空白を除く。前後の空の行は捨て、行は改行でつなぐ。
///
/// # 引数
///
/// - `raw`：`/*` から `*/` までのコメント（閉じていなければ末尾まで）
///
/// # 戻り値
///
/// 本文。中身が空白だけなら空文字列。
///
/// # 例
///
/// ```text
/// comment_body("/* 安全のため */")             → "安全のため"
/// comment_body("/**\n * 1 行目\n * 2 行目\n */") → "1 行目\n2 行目"
/// comment_body("/*   */")                      → ""
/// ```
pub fn comment_body(raw: &str) -> String {
    let inner = raw.strip_prefix("/*").unwrap_or(raw);
    let inner = inner.strip_suffix("*/").unwrap_or(inner);
    let lines: Vec<&str> = inner
        .lines()
        .map(|l| l.trim_start().trim_start_matches('*').trim())
        .collect();
    let first = lines.iter().position(|l| !l.is_empty());
    let last = lines.iter().rposition(|l| !l.is_empty());
    match (first, last) {
        (Some(a), Some(b)) => lines[a..=b].join("\n"),
        _ => String::new(),
    }
}

/// 別の言語での表し方の本文（TextualRepresentation、8.2.2.4）。`/*`・`*/` を外し、前後の空の行と、
/// 2 行目からの空でない行に共通する頭の空白（字下げ）と、行末の空白を除く。字下げの違いは残す（コードとして読めるように）。
///
/// # 引数
///
/// - `raw`：`/*` から `*/` までのコメント（閉じていなければ末尾まで）
///
/// # 戻り値
///
/// 本文。中身が空白だけなら空文字列。
///
/// # 例
///
/// ```text
/// representation_body("/* x > 0 */")                        → "x > 0"
/// representation_body("/*\n    if a:\n        b()\n*/")    → "if a:\n    b()"
/// representation_body("/* a\n  b */")                       → "a\nb"   // 1 行目は字下げに数えない
/// representation_body("/* */")                              → ""
/// ```
pub fn representation_body(raw: &str) -> String {
    let inner = raw.strip_prefix("/*").unwrap_or(raw);
    let inner = inner.strip_suffix("*/").unwrap_or(inner);
    let mut lines: Vec<&str> = inner.lines().map(str::trim_end).collect();
    // `/*` と同じ行の字下げは、本文の字下げではない
    if let Some(first) = lines.first_mut() {
        *first = first.trim_start();
    }
    let indent = lines
        .iter()
        .skip(1)
        .filter(|l| !l.is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    let lines: Vec<&str> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            if i == 0 {
                l
            } else {
                l.get(indent..).unwrap_or(l.trim_start())
            }
        })
        .collect();
    let first = lines.iter().position(|l| !l.is_empty());
    let last = lines.iter().rposition(|l| !l.is_empty());
    match (first, last) {
        (Some(a), Some(b)) => lines[a..=b].join("\n"),
        _ => String::new(),
    }
}

/// 修飾名の最後の部分（`A::B` → `B`）。
///
/// # 引数
///
/// - `s`：修飾名（`::` で区切った名前）
///
/// # 戻り値
///
/// 最後の `::` より後ろ。`::` が無ければ `s` 全体。
///
/// # 例
///
/// ```text
/// last_segment("A::B::C") → "C"
/// last_segment("A")       → "A"
/// last_segment("A::")     → ""
/// ```
pub fn last_segment(s: &str) -> &str {
    s.rsplit("::").next().unwrap_or(s)
}

/// 引用名の引用符を外す。`\'` などのエスケープは解かない。
///
/// # 引数
///
/// - `s`：名前（基本名か引用名）
///
/// # 戻り値
///
/// 両端が `'` なら内側の部分。そうでなければ `s` のまま。
///
/// # 例
///
/// ```text
/// unquote("'a b'") → "a b"
/// unquote("A")     → "A"
/// unquote("'a")    → "'a"   // 閉じていない
/// ```
pub fn unquote(s: &str) -> &str {
    s.strip_prefix('\'')
        .and_then(|t| t.strip_suffix('\''))
        .unwrap_or(s)
}

/// 頭の修飾（暫定コアの MOD_RE に、alpha.7 で `constant`・`variant`・`snapshot`・`timeslice` を足したもの）。
/// `private`・`in` などを、後ろに空白が続く限り外す。（修飾, 残り）を返す。
///
/// # 引数
///
/// - `head`：文の頭（空白を 1 つにまとめたもの）
///
/// # 戻り値
///
/// `(外した修飾を半角空白でつないだもの, 残りの文字列)`。修飾が無ければ `(空文字列, head)`。
///
/// # 例
///
/// ```text
/// strip_mods("private in item x") → ("private in", "item x")
/// strip_mods("constant attribute c : Real") → ("constant", "attribute c : Real")
/// strip_mods("part x")            → ("", "part x")
/// strip_mods("end")               → ("", "end")   // 後ろに空白が無い
/// ```
pub fn strip_mods(head: &str) -> (String, &str) {
    const MODS: &[&str] = &[
        "private",
        "public",
        "protected",
        "abstract",
        "in",
        "out",
        "inout",
        "derived",
        "readonly",
        "end",
        "ref",
        "variation",
        "individual",
        // UsagePrefix の isConstant・VariantUsageMember・PortionKind（8.2.2.6・8.2.2.9）
        "constant",
        "variant",
        "snapshot",
        "timeslice",
    ];
    let mut rest = head;
    let mut mods = Vec::new();
    while let Some((word, after)) = rest.split_once(' ') {
        if !MODS.contains(&word) {
            break;
        }
        mods.push(word);
        rest = after;
    }
    (mods.join(" "), rest)
}

/// 前置メタデータ（`#M #N `）を外す。（メタデータの名前, 残り）を返す（SysML 8.2.2.27 PrefixMetadataMember）。
///
/// `#` の後が基本名で、後ろに空白が続くものだけを外す。
///
/// # 引数
///
/// - `head`：文の頭（空白を 1 つにまとめたもの）
///
/// # 戻り値
///
/// `(メタデータの名前の並び（書いた順）, 残りの文字列)`。無ければ `(空, head)`。
///
/// # 例
///
/// ```text
/// strip_prefix_metadata("#M #N part def A") → (["M", "N"], "part def A")
/// strip_prefix_metadata("part def A")       → ([], "part def A")
/// strip_prefix_metadata("#M")               → ([], "#M")   // 後ろに空白が無い
/// ```
pub fn strip_prefix_metadata(head: &str) -> (Vec<&str>, &str) {
    let mut rest = head;
    let mut names = Vec::new();
    while let Some(after_hash) = rest.strip_prefix('#') {
        let Some((word, after)) = after_hash.split_once(' ') else {
            break;
        };
        if !is_basic_name(word) {
            break;
        }
        names.push(word);
        rest = after;
    }
    (names, rest)
}

/// `then action …` の `then `、`return …` の `return ` を外す。
///
/// `then` は後ろが `action` のときだけ外す（`then idle` のような継続はそのまま）。
///
/// # 引数
///
/// - `head`：文の頭（空白を 1 つにまとめたもの）
///
/// # 戻り値
///
/// 外した後の文字列。外すものが無ければ `head` のまま。
///
/// # 例
///
/// ```text
/// strip_then_return("then action a")          → "action a"
/// strip_then_return("then idle")              → "then idle"
/// strip_then_return("return attribute x : T") → "attribute x : T"
/// ```
pub fn strip_then_return(head: &str) -> &str {
    if let Some(rest) = head.strip_prefix("then ")
        && (rest == "action" || rest.starts_with("action ") || rest.starts_with("action{"))
    {
        return rest;
    }
    head.strip_prefix("return ").unwrap_or(head)
}

/// 先頭が `word` で、その後が名前の文字でないか（`\bword\b` の頭の判定）。
///
/// # 引数
///
/// - `s`：調べる文字列
/// - `word`：先頭にあるかを調べる語
///
/// # 戻り値
///
/// `s` が `word` で始まり、直後が終わりか名前の文字（`is_word`）以外なら `true`。
///
/// # 例
///
/// ```text
/// starts_with_word("import A::*", "import") → true
/// starts_with_word("import", "import")      → true    // 直後が終わり
/// starts_with_word("importer x", "import")  → false   // 語の途中
/// ```
pub fn starts_with_word(s: &str, word: &str) -> bool {
    s.strip_prefix(word)
        .is_some_and(|rest| !rest.starts_with(is_word))
}

/// 扱いを決めて読み飛ばす文の頭（暫定コアの SKIP_RE）。
///
/// # 引数
///
/// - `head`：文の頭（修飾を外したもの）
///
/// # 戻り値
///
/// 頭が読み飛ばす語（`import`・`doc`・`then` など）で始まるか、`@` の直後に名前の文字が続くなら `true`。
///
/// # 例
///
/// ```text
/// is_skipped("import A::*") → true
/// is_skipped("@Phase")      → true
/// is_skipped("importer x")  → false   // 語の途中で切れる
/// is_skipped("@ x")         → false
/// ```
pub fn is_skipped(head: &str) -> bool {
    const SKIP: &[&str] = &[
        "import",
        "alias",
        "doc",
        "comment",
        "entry",
        "transition",
        "first",
        "accept",
        "objective",
        "require",
        "assume",
        "assert",
        "exit",
        "do",
        "if",
        "else",
        "succession",
        "message",
        "dependency",
        "expose",
        "filter",
        "language",
        "rep",
        "then",
    ];
    SKIP.iter().any(|w| starts_with_word(head, w))
        || head
            .strip_prefix('@')
            .is_some_and(|r| r.starts_with(is_word))
}

/// メタデータの本体の `key = 式`（MetadataBodyUsage の名前と値、8.2.2.27）。（キー, 値の式）を返す。
///
/// # 引数
///
/// - `head`：メタデータの本体の文（`;` の手前まで。空白をまとめたもの）
///
/// # 戻り値
///
/// `Some((キー, 値))`。値は `=` の後ろの式全体（前後の空白を除く）。キーが基本名でない、`==` である、
/// 値が空のときは `None`。
///
/// # 例
///
/// ```text
/// meta_assignment("stage = PhaseKind::X") → Some(("stage", "PhaseKind::X"))
/// meta_assignment("k = 1 + 2")            → Some(("k", "1 + 2"))
/// meta_assignment("a = (b)")              → Some(("a", "(b)"))
/// meta_assignment("a == b")               → None
/// meta_assignment("k =")                  → None   // 値が無い
/// ```
pub fn meta_assignment(head: &str) -> Option<(&str, &str)> {
    let (key, rest) = head.split_once('=')?;
    let key = key.trim_end();
    if !is_basic_name(key) || rest.starts_with('=') {
        return None;
    }
    let value = rest.trim();
    (!value.is_empty()).then_some((key, value))
}

/// メタデータの値として記録する文字列。列挙値などの修飾名（`E::V`）は最後の名前だけ、ほかの式は全体にする。
///
/// フェーズ（`stage = PhaseKind::X`）は列挙値の名前で比べるので、修飾名は最後の名前にする。
///
/// # 引数
///
/// - `value`：`meta_assignment` が返した値の式
///
/// # 戻り値
///
/// 修飾名（`is_qualified_basic_name`）なら最後の部分、それ以外は `value` そのもの。
///
/// # 例
///
/// ```text
/// meta_value("PhaseKind::X") → "X"
/// meta_value("1 + 2")        → "1 + 2"
/// meta_value("\"a b\"")      → "\"a b\""
/// ```
pub fn meta_value(value: &str) -> &str {
    if is_qualified_basic_name(value) {
        last_segment(value)
    } else {
        value
    }
}

/// 列挙値（`enum X`・`X`）。
///
/// # 引数
///
/// - `head`：列挙の定義の本体にある文の頭
///
/// # 戻り値
///
/// 列挙値の名前。`enum ` を外した残りが基本名でなければ `None`。
///
/// # 例
///
/// ```text
/// enum_value("enum Red") → Some("Red")
/// enum_value("Red")      → Some("Red")
/// enum_value("Red = 1")  → None
/// ```
pub fn enum_value(head: &str) -> Option<&str> {
    let name = head.strip_prefix("enum ").unwrap_or(head);
    is_basic_name(name).then_some(name)
}

/// 文の頭の最初の語（`{`・`;`・空白の手前まで）。
///
/// # 引数
///
/// - `head`：文の頭
///
/// # 戻り値
///
/// 最初の半角空白・`{`・`;` の手前までの部分。先頭がそれらなら空文字列。
///
/// # 例
///
/// ```text
/// first_word("part def A") → "part"
/// first_word("objective{") → "objective"
/// first_word("")           → ""
/// ```
pub fn first_word(head: &str) -> &str {
    head.split([' ', '{', ';']).next().unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_mods_takes_only_leading_modifiers_followed_by_space() {
        // 同値クラス: 修飾あり・なし、境界値: 修飾だけの頭（後ろに空白が無い）
        assert_eq!(
            strip_mods("private in item x"),
            ("private in".to_owned(), "item x")
        );
        assert_eq!(strip_mods("part x"), (String::new(), "part x"));
        assert_eq!(strip_mods("end"), (String::new(), "end"));
    }

    #[test]
    fn strip_prefix_metadata_collects_names_in_order() {
        assert_eq!(
            strip_prefix_metadata("#M #N part def A"),
            (vec!["M", "N"], "part def A")
        );
        assert_eq!(strip_prefix_metadata("part def A"), (vec![], "part def A"));
    }

    #[test]
    fn strip_then_return_removes_only_then_action_and_return() {
        assert_eq!(strip_then_return("then action a"), "action a");
        assert_eq!(strip_then_return("then idle"), "then idle");
        assert_eq!(
            strip_then_return("return attribute x : T"),
            "attribute x : T"
        );
    }

    #[test]
    fn is_skipped_matches_whole_words() {
        // 境界値: 語の途中で切れる名前（importer）は読み飛ばさない
        assert!(is_skipped("import A::*"));
        assert!(is_skipped("@Phase"));
        assert!(!is_skipped("importer x"));
        assert!(!is_skipped("@ x"));
    }

    #[test]
    fn meta_assignment_reads_key_and_qualified_value() {
        assert_eq!(
            meta_assignment("stage = PhaseKind::X"),
            Some(("stage", "PhaseKind::X"))
        );
        assert_eq!(meta_assignment("a == b"), None);
    }

    #[test]
    fn meta_assignment_keeps_the_whole_expression() {
        // Arrange（同値クラス: 演算子を含む式・括弧の式、境界値: 値が空）
        let cases = ["k = 1 + 2", "a = (b)", "k ="];
        // Act
        let got: Vec<_> = cases.iter().map(|h| meta_assignment(h)).collect();
        // Assert
        assert_eq!(got, [Some(("k", "1 + 2")), Some(("a", "(b)")), None]);
    }

    #[test]
    fn meta_value_shortens_only_qualified_names() {
        // Arrange（同値クラス: 修飾名・修飾の無い名前・式）
        let cases = ["PhaseKind::X", "X", "1 + 2"];
        // Act
        let got: Vec<&str> = cases.iter().map(|v| meta_value(v)).collect();
        // Assert
        assert_eq!(got, ["X", "X", "1 + 2"]);
    }

    #[test]
    fn strip_mods_takes_constant_variant_and_portion_kinds() {
        // Arrange（alpha.7 で足した修飾）
        let heads = ["constant attribute c", "variant part a", "timeslice t"];
        // Act
        let got: Vec<(String, &str)> = heads.iter().map(|h| strip_mods(h)).collect();
        // Assert
        assert_eq!(
            got,
            [
                ("constant".to_owned(), "attribute c"),
                ("variant".to_owned(), "part a"),
                ("timeslice".to_owned(), "t"),
            ]
        );
    }

    #[test]
    fn comment_body_drops_markers_and_leading_stars_on_each_line() {
        // Arrange（同値クラス: 1 行・`/** */` の複数行・空。境界値: 閉じていない）
        let cases = [
            "/* 安全のため */",
            "/**\n   * 1 行目\n   *   2 行目  \n   */",
            "/*   */",
            "/* 閉じていない",
        ];
        // Act
        let got: Vec<String> = cases.iter().map(|c| comment_body(c)).collect();
        // Assert
        assert_eq!(got, ["安全のため", "1 行目\n2 行目", "", "閉じていない"]);
    }

    #[test]
    fn representation_body_keeps_relative_indentation() {
        // Arrange（同値クラス: 1 行・字下げのある複数行・空。境界値: 1 行目が `/*` と同じ行）
        let cases = [
            "/* x > 0 */",
            "/*\n    if a:\n        b()\n*/",
            "/* */",
            "/* a\n  b */",
        ];
        // Act
        let got: Vec<String> = cases.iter().map(|c| representation_body(c)).collect();
        // Assert
        assert_eq!(got, ["x > 0", "if a:\n    b()", "", "a\nb"]);
    }

    #[test]
    fn enum_value_accepts_with_and_without_keyword() {
        assert_eq!(enum_value("enum Red"), Some("Red"));
        assert_eq!(enum_value("Red"), Some("Red"));
        assert_eq!(enum_value("Red = 1"), None);
    }
}
