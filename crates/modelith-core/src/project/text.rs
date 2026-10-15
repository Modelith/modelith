//! 文の頭の文字列を扱う小さな関数（暫定コアの正規表現と同じ判定を、正規表現を使わずに書く）。

/// 名前に使える文字か（`\w`）。
pub fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// 基本名か（`[A-Za-z_]\w*`）。
pub fn is_basic_name(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && cs.all(is_word)
}

/// 基本名で始まる修飾名か（`[A-Za-z_][\w:]*`）。
pub fn is_qualified_basic_name(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| is_word(c) || c == ':')
}

/// 空白をまとめて 1 つにし、前後の空白を除く。
pub fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 修飾名の最後の部分（`A::B` → `B`）。
pub fn last_segment(s: &str) -> &str {
    s.rsplit("::").next().unwrap_or(s)
}

/// 引用名の引用符を外す。
pub fn unquote(s: &str) -> &str {
    s.strip_prefix('\'')
        .and_then(|t| t.strip_suffix('\''))
        .unwrap_or(s)
}

/// 頭の修飾（暫定コアの MOD_RE）。`private`・`in` などを、後ろに空白が続く限り外す。（修飾, 残り）を返す。
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

/// 前置メタデータ（`#M #N `）を外す。（メタデータの名前, 残り）を返す。
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
pub fn strip_then_return(head: &str) -> &str {
    if let Some(rest) = head.strip_prefix("then ")
        && (rest == "action" || rest.starts_with("action ") || rest.starts_with("action{"))
    {
        return rest;
    }
    head.strip_prefix("return ").unwrap_or(head)
}

/// 先頭が `word` で、その後が名前の文字でないか（`\bword\b` の頭の判定）。
pub fn starts_with_word(s: &str, word: &str) -> bool {
    s.strip_prefix(word)
        .is_some_and(|rest| !rest.starts_with(is_word))
}

/// 扱いを決めて読み飛ばす文の頭（暫定コアの SKIP_RE）。
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
        "bind",
        "message",
        "dependency",
        "allocate",
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

/// メタデータの本体の `key = Value`（`^([A-Za-z_]\w*)\s*=\s*([\w:]+)`）。（キー, 値）を返す。
pub fn meta_assignment(head: &str) -> Option<(&str, &str)> {
    let (key, rest) = head.split_once('=')?;
    let key = key.trim_end();
    if !is_basic_name(key) || rest.starts_with('=') {
        return None;
    }
    let rest = rest.trim_start();
    let len = rest
        .find(|c: char| !(is_word(c) || c == ':'))
        .unwrap_or(rest.len());
    (len > 0).then(|| (key, &rest[..len]))
}

/// 列挙値（`enum X`・`X`）。
pub fn enum_value(head: &str) -> Option<&str> {
    let name = head.strip_prefix("enum ").unwrap_or(head);
    is_basic_name(name).then_some(name)
}

/// 文の頭の最初の語（`{`・`;`・空白の手前まで）。
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
        assert_eq!(meta_assignment("a = (b)"), None);
    }

    #[test]
    fn enum_value_accepts_with_and_without_keyword() {
        assert_eq!(enum_value("enum Red"), Some("Red"));
        assert_eq!(enum_value("Red"), Some("Red"));
        assert_eq!(enum_value("Red = 1"), None);
    }
}
