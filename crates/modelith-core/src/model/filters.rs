//! view の絞り込み（`filter …;`・`expose A::*[…]`、ElementFilterMember・FilterPackageMember、8.2.2.26・7.5.4）の式を読む。
//!
//! 扱う式は、要素のメタクラス・メタデータの分類の検査（`@X`・`istype X`・`hastype X`）と、それを組み合わせる
//! `and`・`&`・`or`・`|`・`xor`・`not` と括弧（KerML 8.2.5.8.1 の Table 6 の優先順位：`not` → 分類の検査 → `and` → `xor` → `or`）。
//! ほかの式（`approved and level > 1` のような属性の値の比較など）は扱えないものとし、呼び出し側が知らせる。

use super::views::metaclass_kind;
use crate::project::Entry;

/// 絞り込み。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Filter {
    /// 定義（`@Definition`）。
    Definition,
    /// 使用（`@Usage`）。
    Usage,
    /// 種類が一致する（`@PartDefinition` は `part def`）。
    Kind(String),
    /// そのメタデータを付けた（`@Safety`）。
    Metadata(String),
    /// どれにも合わない（`hastype Definition` のように、ちょうどその型の要素が無い）。
    Never,
    /// 合わない（`not`）。
    Not(Box<Filter>),
    /// すべてに合う（`and`・`&`）。
    All(Vec<Filter>),
    /// どれかに合う（`or`・`|`）。
    Any(Vec<Filter>),
    /// どちらか一方だけに合う（`xor`）。
    Xor(Box<Filter>, Box<Filter>),
}

impl Filter {
    /// 宣言が絞り込みに合うか。
    ///
    /// # 引数
    ///
    /// - `e`：調べる宣言
    ///
    /// # 戻り値
    ///
    /// 合えば true。
    ///
    /// # 例
    ///
    /// ```text
    /// Filter::Kind("part def").test(part def A の宣言)                       → true
    /// Filter::Usage.test(part def A の宣言)                                  → false
    /// Filter::Not(Box::new(Filter::Usage)).test(part def A の宣言)           → true
    /// Filter::Any(vec![Filter::Usage, Filter::Definition]).test(part def A) → true
    /// ```
    pub(crate) fn test(&self, e: &Entry) -> bool {
        match self {
            Self::Definition => e.is_def,
            Self::Usage => !e.is_def,
            Self::Kind(k) => e.kind == *k,
            Self::Metadata(m) => e
                .meta
                .as_ref()
                .is_some_and(|ms| ms.0.iter().any(|(k, _)| k == m)),
            Self::Never => false,
            Self::Not(f) => !f.test(e),
            Self::All(fs) => fs.iter().all(|f| f.test(e)),
            Self::Any(fs) => fs.iter().any(|f| f.test(e)),
            Self::Xor(a, b) => a.test(e) != b.test(e),
        }
    }
}

/// 絞り込みの式を読む。扱えない式なら None。
///
/// # 引数
///
/// - `expr`：filter の式（`@PartDefinition`・`@SysML::PartUsage or @Safety`・`not (@A and @B)` など）
/// - `is_metadata`：名前がメタデータの定義（`metadata def`）かを答える関数
///
/// # 戻り値
///
/// 絞り込み。分類の検査と論理演算・括弧以外を含む式、閉じていない括弧、知らないメタクラスでメタデータでもない名前なら None。
///
/// # 例
///
/// ```text
/// filter_of("@PartDefinition", …)                    → Some(Kind("part def"))
/// filter_of("@SysML::PartUsage", …)                  → Some(Kind("part"))
/// filter_of("istype Safety", …)                      → Some(Metadata("Safety"))   // Safety がメタデータの定義のとき
/// filter_of("@PartDefinition or @Safety", …)         → Some(Any([Kind("part def"), Metadata("Safety")]))
/// filter_of("not (@Definition and @Safety)", …)      → Some(Not(All([Definition, Metadata("Safety")])))
/// filter_of("hastype Usage", …)                      → Some(Never)
/// filter_of("@Safety and level > 1", …)              → None   // 値の比較は扱えない
/// filter_of("(@Safety", …)                           → None   // 閉じていない括弧
/// ```
pub(crate) fn filter_of(expr: &str, is_metadata: impl Fn(&str) -> bool) -> Option<Filter> {
    let tokens = tokens(expr)?;
    let mut p = FilterParser {
        tokens: &tokens,
        at: 0,
        is_metadata: &is_metadata,
    };
    let f = p.or()?;
    (p.at == tokens.len()).then_some(f)
}

/// 式を語に分ける（括弧・`@`・`&`・`|` は 1 文字で 1 語、名前は `::` を含めて 1 語）。
///
/// # 引数
///
/// - `expr`：式
///
/// # 戻り値
///
/// 語の並び。名前・記号でない文字（`>`・数・引用符など）を含めば None。
///
/// # 例
///
/// ```text
/// tokens("not(@A::B&@C)") → Some(["not", "(", "@", "A::B", "&", "@", "C", ")"])
/// tokens("level > 1")     → None
/// ```
fn tokens(expr: &str) -> Option<Vec<&str>> {
    let mut out = Vec::new();
    let mut rest = expr.trim_start();
    while let Some(c) = rest.chars().next() {
        let len = if "()@&|".contains(c) {
            1
        } else if c.is_ascii_alphabetic() || c == '_' {
            rest.find(|x: char| !(x.is_ascii_alphanumeric() || x == '_' || x == ':'))
                .unwrap_or(rest.len())
        } else {
            return None;
        };
        out.push(&rest[..len]);
        rest = rest[len..].trim_start();
    }
    Some(out)
}

/// 絞り込みの式の、再帰下降の読み手。
struct FilterParser<'t, F: Fn(&str) -> bool> {
    tokens: &'t [&'t str],
    at: usize,
    is_metadata: &'t F,
}

impl<F: Fn(&str) -> bool> FilterParser<'_, F> {
    /// 次の語が `words` のどれかなら、読み進めて true。
    ///
    /// # 引数
    ///
    /// - `words`：読み進めてよい語
    ///
    /// # 戻り値
    ///
    /// 読み進めたら true。語が無いか違えば false（位置は変えない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // 語が ["or", "@", "A"]、位置 0 のとき
    /// eat(&["or", "|"]) → true（位置 1）
    /// eat(&["and"])     → false
    /// ```
    fn eat(&mut self, words: &[&str]) -> bool {
        let hit = self.tokens.get(self.at).is_some_and(|t| words.contains(t));
        if hit {
            self.at += 1;
        }
        hit
    }

    /// `or`・`|` でつないだ式（いちばん低い優先順位）。
    ///
    /// # 戻り値
    ///
    /// 絞り込み。1 つだけならそのもの、2 つ以上なら `Any`。読めなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// or("@A or @B | @C") → Some(Any([A, B, C]))
    /// or("@A")            → Some(A)
    /// ```
    fn or(&mut self) -> Option<Filter> {
        let mut fs = vec![self.xor()?];
        while self.eat(&["or", "|"]) {
            fs.push(self.xor()?);
        }
        Some(if fs.len() == 1 {
            fs.remove(0)
        } else {
            Filter::Any(fs)
        })
    }

    /// `xor` でつないだ式（左から順に組む）。
    ///
    /// # 戻り値
    ///
    /// 絞り込み。読めなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// xor("@A xor @B") → Some(Xor(A, B))
    /// ```
    fn xor(&mut self) -> Option<Filter> {
        let mut f = self.and()?;
        while self.eat(&["xor"]) {
            f = Filter::Xor(Box::new(f), Box::new(self.and()?));
        }
        Some(f)
    }

    /// `and`・`&` でつないだ式。
    ///
    /// # 戻り値
    ///
    /// 絞り込み。1 つだけならそのもの、2 つ以上なら `All`。読めなければ None。
    ///
    /// # 例
    ///
    /// ```text
    /// and("@A and @B & @C") → Some(All([A, B, C]))
    /// ```
    fn and(&mut self) -> Option<Filter> {
        let mut fs = vec![self.unary()?];
        while self.eat(&["and", "&"]) {
            fs.push(self.unary()?);
        }
        Some(if fs.len() == 1 {
            fs.remove(0)
        } else {
            Filter::All(fs)
        })
    }

    /// `not` の付いた式、括弧の式、分類の検査（`@X`・`istype X`・`hastype X`）。
    ///
    /// # 戻り値
    ///
    /// 絞り込み。閉じていない括弧・名前の無い検査・知らない名前なら None。
    ///
    /// # 例
    ///
    /// ```text
    /// unary("not @A")          → Some(Not(A))
    /// unary("(@A or @B)")      → Some(Any([A, B]))
    /// unary("hastype Usage")   → Some(Never)
    /// unary("@")               → None
    /// ```
    fn unary(&mut self) -> Option<Filter> {
        if self.eat(&["not"]) {
            return Some(Filter::Not(Box::new(self.unary()?)));
        }
        if self.eat(&["("]) {
            let f = self.or()?;
            return self.eat(&[")"]).then_some(f);
        }
        let exact = match self.tokens.get(self.at).copied() {
            Some("@" | "istype") => false,
            Some("hastype") => true,
            _ => return None,
        };
        self.at += 1;
        let name = *self.tokens.get(self.at)?;
        self.at += 1;
        classification(name, exact, self.is_metadata)
    }
}

/// 分類の検査 1 つ（`@X`・`istype X`・`hastype X`）の絞り込み。`X` は修飾名でもよく、最後の段だけを見る。
/// `…Definition`・`…Usage` のメタクラスは種類に、メタデータの定義の名前はメタデータの絞り込みにする。
///
/// # 引数
///
/// - `name`：型の名前（`PartDefinition`・`SysML::PartUsage`・`Safety` など）
/// - `exact`：`hastype`（ちょうどその型。`Definition`・`Usage` そのものの要素は無いので、どれにも合わない）か
/// - `is_metadata`：名前がメタデータの定義かを答える関数
///
/// # 戻り値
///
/// 絞り込み。名前の形でないか、知らないメタクラスでメタデータでもない名前なら None。
///
/// # 例
///
/// ```text
/// classification("SysML::PartUsage", false, …) → Some(Kind("part"))
/// classification("Definition", false, …)       → Some(Definition)
/// classification("Definition", true, …)        → Some(Never)
/// classification("Nope", false, …)             → None
/// ```
fn classification(name: &str, exact: bool, is_metadata: impl Fn(&str) -> bool) -> Option<Filter> {
    if !name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') {
        return None;
    }
    let last = name.rsplit("::").next().unwrap_or(name);
    match (last, exact) {
        ("Definition" | "Usage", true) => return Some(Filter::Never),
        ("Definition", false) => return Some(Filter::Definition),
        ("Usage", false) => return Some(Filter::Usage),
        _ => {}
    }
    if let Some(kind) = metaclass_kind(last) {
        return Some(Filter::Kind(kind));
    }
    is_metadata(last).then(|| Filter::Metadata(last.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Safety` だけをメタデータの定義とみなして読む。
    fn read(expr: &str) -> Option<Filter> {
        filter_of(expr, |n| n == "Safety")
    }

    #[test]
    fn single_classification_tests_are_read_as_before() {
        // Arrange（同値分割：@ メタクラス・修飾名・メタデータ・istype・@ の後の空白）
        let cases = [
            ("@PartDefinition", Filter::Kind("part def".into())),
            ("@SysML::PartUsage", Filter::Kind("part".into())),
            ("@Safety", Filter::Metadata("Safety".into())),
            ("istype Safety", Filter::Metadata("Safety".into())),
            ("@ Definition", Filter::Definition),
        ];
        for (expr, want) in cases {
            // Act
            let got = read(expr);
            // Assert
            assert_eq!(got, Some(want), "{expr}");
        }
    }

    #[test]
    fn logical_operators_follow_the_kerml_precedence() {
        // Arrange（not → 分類 → and → xor → or の順に強く結ぶ）
        let expr = "not @Usage and @Safety or @PartDefinition xor @Definition";
        // Act
        let got = read(expr);
        // Assert
        assert_eq!(
            got,
            Some(Filter::Any(vec![
                Filter::All(vec![
                    Filter::Not(Box::new(Filter::Usage)),
                    Filter::Metadata("Safety".into())
                ]),
                Filter::Xor(
                    Box::new(Filter::Kind("part def".into())),
                    Box::new(Filter::Definition)
                ),
            ]))
        );
    }

    #[test]
    fn parentheses_and_symbol_operators_group_tests() {
        // Arrange（括弧・& と |）
        let expr = "not(@Safety|@Usage)&@Definition";
        // Act
        let got = read(expr);
        // Assert
        assert_eq!(
            got,
            Some(Filter::All(vec![
                Filter::Not(Box::new(Filter::Any(vec![
                    Filter::Metadata("Safety".into()),
                    Filter::Usage
                ]))),
                Filter::Definition,
            ]))
        );
    }

    #[test]
    fn hastype_of_the_general_metaclasses_matches_nothing() {
        // Arrange（境界値：ちょうど Definition・Usage の要素は無い。ほかの名前は @ と同じ）
        // Act
        let (def, part) = (read("hastype Definition"), read("hastype PartUsage"));
        // Assert
        assert_eq!(def, Some(Filter::Never));
        assert_eq!(part, Some(Filter::Kind("part".into())));
    }

    #[test]
    fn unsupported_expressions_are_none() {
        // Arrange（異常系：値の比較・閉じていない括弧・余る括弧・名前の無い検査・知らない名前・空・引用名）
        let cases = [
            "@Safety and level > 1",
            "(@Safety",
            "@Safety)",
            "@",
            "not",
            "@Nope",
            "",
            "@'Part Def'",
            "@Safety @Usage",
        ];
        for expr in cases {
            // Act
            let got = read(expr);
            // Assert
            assert_eq!(got, None, "{expr}");
        }
    }

    #[test]
    fn test_combines_the_results_of_the_parts() {
        // Arrange（part def A（Safety 付き）と part a）
        let text = "package P { metadata def Safety; part def A { @Safety; } part a; }";
        let p = crate::project::project(text, &crate::syntax::parse(text));
        let (a_def, a_use) = (
            p.entries.iter().find(|e| e.name == "A"),
            p.entries.iter().find(|e| e.name == "a"),
        );
        let f = read("@Safety xor @Usage");
        // Act
        let got: Vec<bool> = [a_def, a_use]
            .into_iter()
            .flatten()
            .map(|e| f.as_ref().is_some_and(|f| f.test(e)))
            .collect();
        // Assert
        assert_eq!(got, [true, true]);
        assert!(!Filter::Never.test(p.entries.first().unwrap_or_else(|| panic!("空"))));
    }
}
