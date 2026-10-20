//! 構文木の節とトークンの種類。
//!
//! 節の名前は SysML v2 のテキスト記法の BNF の規則名にそろえる（ADR-0015）。
//! キーワードはすべて `KEYWORD` の 1 種類とし、文字列で見分ける。

macro_rules! syntax_kinds {
    ($($(#[$doc:meta])* $name:ident),* $(,)?) => {
        /// 構文木の節とトークンの種類。
        #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        #[repr(u16)]
        pub enum SyntaxKind {
            $($(#[$doc])* $name),*
        }

        /// すべての種類（`rowan` の数値から戻すための表）。
        const ALL: &[SyntaxKind] = &[$(SyntaxKind::$name),*];
    };
}

syntax_kinds! {
    // ---- トークン ----
    /// 空白と改行。
    WHITESPACE,
    /// `// …`（行末までの注記。SINGLE_LINE_NOTE）。
    LINE_NOTE,
    /// `//* … */`（複数行の注記。MULTILINE_NOTE）。
    BLOCK_NOTE,
    /// `/* … */`（コメントの本文。REGULAR_COMMENT）。宣言の途中にあるものは読み飛ばす。
    REGULAR_COMMENT,
    /// 基本名（BASIC_NAME）。
    IDENT,
    /// 引用名（UNRESTRICTED_NAME、`'…'`）。
    QUOTED_NAME,
    /// 予約語（RESERVED_KEYWORD）。
    KEYWORD,
    /// 数値（DECIMAL_VALUE・EXPONENTIAL_VALUE）。
    NUMBER,
    /// 文字列（STRING_VALUE）。
    STRING,
    SEMI,
    COMMA,
    DOT,
    L_BRACE,
    R_BRACE,
    L_PAREN,
    R_PAREN,
    L_BRACK,
    R_BRACK,
    LT,
    GT,
    COLON,
    /// `::`
    COLON2,
    /// `:>`
    COLON_GT,
    /// `:>>`
    COLON_GT2,
    /// `::>`
    COLON2_GT,
    /// `:=`
    COLON_EQ,
    TILDE,
    EQ,
    HASH,
    AT,
    STAR,
    /// `**`
    STAR2,
    /// そのほかの演算子（`==`・`<=`・`+`・`->` など）。
    OP,
    /// 字句として読めない文字。
    ERROR_TOKEN,

    // ---- 節：共通 ----
    /// ファイル全体（RootNamespace）。
    SOURCE_FILE,
    /// `{ … }`（NamespaceBody・DefinitionBody など）。
    BODY,
    /// 宣言の名前（Identification の Name）。
    NAME,
    /// 短い名前（Identification の `<…>`）。
    SHORT_NAME,
    /// 修飾名（QualifiedName、`A::B`）。
    QUALIFIED_NAME,
    /// 特徴の連鎖（FeatureChain、`a.b.c`）。
    FEATURE_CHAIN,
    /// 前置メタデータ（PrefixMetadataMember、`#M`）。
    PREFIX_METADATA,
    /// 型付け（FeatureTyping、`:`・`defined by`）。
    FEATURE_TYPING,
    /// 定義の特殊化（Subclassification、定義の `:>`・`specializes`）。
    SUBCLASSIFICATION,
    /// 部分集合（Subsetting、使用の `:>`・`subsets`）。
    SUBSETTING,
    /// 再定義（Redefinition、`:>>`・`redefines`）。
    REDEFINITION,
    /// 参照（ReferenceSubsetting、`::>`・`references`）。
    REFERENCE_SUBSETTING,
    /// 多重度（MultiplicityBounds、`[…]`）。
    MULTIPLICITY,
    /// 値（FeatureValue、`=`・`:=`・`default`）。
    FEATURE_VALUE,
    /// 接続の端（ConnectorEnd、`a.p`・`[1] e ::> a.p`。`connect`・`bind`・`allocate` の相手）。
    CONNECTOR_END,
    /// まだ文法として読まない式（段階 A。括弧の釣り合いだけで区切る）。
    EXPRESSION,
    /// 読めなかった部分。
    ERROR,

    // ---- 節：要素 ----
    PACKAGE,
    LIBRARY_PACKAGE,
    IMPORT,
    ALIAS,
    COMMENT,
    DOCUMENTATION,
    /// `rep r language "x" /* … */`・`language "x" /* … */`（TextualRepresentation）。
    TEXTUAL_REPRESENTATION,
    /// `@M { … }`（MetadataUsage）。
    METADATA_USAGE,
    DEPENDENCY,
    /// `expose`（MembershipExpose・NamespaceExpose）。
    EXPOSE,
    /// `filter`（ElementFilterMember）。
    ELEMENT_FILTER_MEMBER,
    /// `render`（ViewRenderingUsage）。
    VIEW_RENDERING_USAGE,
    /// 名前で始まる式だけの文（ResultExpressionMember など）。
    EXPRESSION_MEMBER,
    /// 段階 A では文法を持たない文（キーワードで始まる）。
    UNSUPPORTED_MEMBER,

    ATTRIBUTE_DEFINITION,
    ENUMERATION_DEFINITION,
    OCCURRENCE_DEFINITION,
    ITEM_DEFINITION,
    PART_DEFINITION,
    PORT_DEFINITION,
    CONNECTION_DEFINITION,
    FLOW_DEFINITION,
    INTERFACE_DEFINITION,
    ALLOCATION_DEFINITION,
    ACTION_DEFINITION,
    STATE_DEFINITION,
    CALCULATION_DEFINITION,
    CONSTRAINT_DEFINITION,
    REQUIREMENT_DEFINITION,
    CONCERN_DEFINITION,
    CASE_DEFINITION,
    ANALYSIS_CASE_DEFINITION,
    VERIFICATION_CASE_DEFINITION,
    USE_CASE_DEFINITION,
    VIEW_DEFINITION,
    VIEWPOINT_DEFINITION,
    RENDERING_DEFINITION,
    METADATA_DEFINITION,
    /// `#X def H;`（利用者定義のキーワードで書く定義。ExtendedDefinition、8.2.2.27）。
    EXTENDED_DEFINITION,

    ATTRIBUTE_USAGE,
    ENUMERATION_USAGE,
    OCCURRENCE_USAGE,
    ITEM_USAGE,
    PART_USAGE,
    PORT_USAGE,
    CONNECTION_USAGE,
    FLOW_USAGE,
    INTERFACE_USAGE,
    ALLOCATION_USAGE,
    ACTION_USAGE,
    STATE_USAGE,
    CALCULATION_USAGE,
    CONSTRAINT_USAGE,
    REQUIREMENT_USAGE,
    CONCERN_USAGE,
    CASE_USAGE,
    ANALYSIS_CASE_USAGE,
    VERIFICATION_CASE_USAGE,
    USE_CASE_USAGE,
    VIEW_USAGE,
    VIEWPOINT_USAGE,
    RENDERING_USAGE,
    /// `metadata M;`（キーワードで書くメタデータ）。
    METADATA_KEYWORD_USAGE,
    /// キーワードの無い使用（`in x : T;`・`end a : P;`・`x = 1;` など）。
    REFERENCE_USAGE,
    MESSAGE_USAGE,
    TRANSITION_USAGE,
    /// `first a then b;`・`then b;`・`succession s first a then b;`・`first a if g then b;`・`if g then b;`・`else b;`・
    /// `first start;`（SuccessionAsUsage・TargetSuccessionMember・GuardedSuccession・DefaultTargetSuccession・InitialNodeMember）。
    SUCCESSION_AS_USAGE,
    /// `succession flow f from a.x to b.y;`（SuccessionFlowUsage）。
    SUCCESSION_FLOW_USAGE,
    /// 継起のガード `if g`（GuardExpressionMember）。`first a if g then b;`・`if g then b;` の中に置く。
    GUARD_EXPRESSION,
    /// `fork f;`（ForkNode）。
    FORK_NODE,
    /// `join j;`（JoinNode）。
    JOIN_NODE,
    /// `merge m;`（MergeNode）。
    MERGE_NODE,
    /// `decide d;`（DecisionNode）。
    DECISION_NODE,
    /// `send x via p to y;`・`action s send x;`（SendNode）。
    SEND_NODE,
    /// `accept e : E via p;`・`action a accept E;`（AcceptNode）。
    ACCEPT_NODE,
    /// `assign a.x := 1;`（AssignmentNode）。
    ASSIGNMENT_NODE,
    /// `terminate;`・`terminate p;`（TerminateNode）。
    TERMINATE_NODE,
    /// アクションの節の引数（NodeParameterMember・PayloadParameterMember。送るもの・受けるもの・送る先・代入の相手と値）。
    NODE_PARAMETER,
    /// `bind a = b;`（BindingConnectorAsUsage）。
    BINDING_CONNECTOR_AS_USAGE,
    /// `entry;`・`entry action a;`・`exit`・`do`（StateSubactionMembership）。
    STATE_SUBACTION_MEMBER,
    PERFORM_ACTION_USAGE,
    EXHIBIT_STATE_USAGE,
    INCLUDE_USE_CASE_USAGE,
    SATISFY_REQUIREMENT_USAGE,
    /// `verify`（RequirementVerificationUsage）。
    REQUIREMENT_VERIFICATION_USAGE,
    /// `assert constraint`（AssertConstraintUsage）。
    ASSERT_CONSTRAINT_USAGE,
    /// `require constraint`・`assume constraint`（RequirementConstraintMember）。
    REQUIREMENT_CONSTRAINT_USAGE,
    /// `frame concern`（FramedConcernMember）。
    FRAMED_CONCERN_USAGE,
    SUBJECT_USAGE,
    ACTOR_USAGE,
    STAKEHOLDER_USAGE,
    /// `objective`（ObjectiveRequirementUsage）。
    OBJECTIVE_REQUIREMENT_USAGE,
}

impl SyntaxKind {
    /// 構文の意味を持たないトークン（空白・注記）か。
    ///
    /// コメント（`/* */`、`REGULAR_COMMENT`）は要素になりうるので含めない（KerML 8.2.2.1）。
    ///
    /// # 戻り値
    ///
    /// `WHITESPACE`・`LINE_NOTE`・`BLOCK_NOTE` なら `true`、それ以外は `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// SyntaxKind::LINE_NOTE.is_trivia()       → true
    /// SyntaxKind::REGULAR_COMMENT.is_trivia() → false
    /// ```
    pub fn is_trivia(self) -> bool {
        matches!(self, Self::WHITESPACE | Self::LINE_NOTE | Self::BLOCK_NOTE)
    }

    /// `rowan` の数値から戻す。範囲外なら `ERROR`。
    ///
    /// # 引数
    ///
    /// - `raw`：`SyntaxKind as u16` で得た数値（宣言の順の番号）
    ///
    /// # 戻り値
    ///
    /// その番号の種類。種類の数以上なら `SyntaxKind::ERROR`。
    ///
    /// # 例
    ///
    /// ```text
    /// SyntaxKind::from_raw(SyntaxKind::WHITESPACE as u16) → WHITESPACE
    /// SyntaxKind::from_raw(u16::MAX)                      → ERROR
    /// ```
    pub(crate) fn from_raw(raw: u16) -> Self {
        ALL.get(usize::from(raw)).copied().unwrap_or(Self::ERROR)
    }
}

/// SysML の予約語（SysML-textual-bnf の RESERVED_KEYWORD）。
pub const KEYWORDS: &[&str] = &[
    "about",
    "abstract",
    "accept",
    "action",
    "actor",
    "after",
    "alias",
    "all",
    "allocate",
    "allocation",
    "analysis",
    "and",
    "as",
    "assert",
    "assign",
    "assume",
    "at",
    "attribute",
    "bind",
    "binding",
    "by",
    "calc",
    "case",
    "comment",
    "concern",
    "connect",
    "connection",
    "constant",
    "constraint",
    "crosses",
    "decide",
    "def",
    "default",
    "defined",
    "dependency",
    "derived",
    "do",
    "doc",
    "else",
    "end",
    "entry",
    "enum",
    "event",
    "exhibit",
    "exit",
    "expose",
    "false",
    "filter",
    "first",
    "flow",
    "for",
    "fork",
    "frame",
    "from",
    "hastype",
    "if",
    "implies",
    "import",
    "in",
    "include",
    "individual",
    "inout",
    "interface",
    "istype",
    "item",
    "join",
    "language",
    "library",
    "locale",
    "loop",
    "merge",
    "message",
    "meta",
    "metadata",
    "new",
    "nonunique",
    "not",
    "null",
    "objective",
    "occurrence",
    "of",
    "or",
    "ordered",
    "out",
    "package",
    "parallel",
    "part",
    "perform",
    "port",
    "private",
    "protected",
    "public",
    "redefines",
    "ref",
    "references",
    "render",
    "rendering",
    "rep",
    "require",
    "requirement",
    "return",
    "satisfy",
    "send",
    "snapshot",
    "specializes",
    "stakeholder",
    "standard",
    "state",
    "subject",
    "subsets",
    "succession",
    "terminate",
    "then",
    "timeslice",
    "to",
    "transition",
    "true",
    "until",
    "use",
    "variant",
    "variation",
    "verification",
    "verify",
    "via",
    "view",
    "viewpoint",
    "when",
    "while",
    "xor",
];

/// SysML の予約語か（SysML-textual-bnf の RESERVED_KEYWORD）。大文字と小文字を区別する。
///
/// # 引数
///
/// - `word`：調べる語
///
/// # 戻り値
///
/// `KEYWORDS` にあれば `true`。
///
/// # 例
///
/// ```text
/// is_keyword("part")  → true
/// is_keyword("stage") → false
/// is_keyword("Part")  → false   // 大文字違い
/// ```
pub fn is_keyword(word: &str) -> bool {
    KEYWORDS.binary_search(&word).is_ok()
}

impl From<SyntaxKind> for rowan::SyntaxKind {
    fn from(kind: SyntaxKind) -> Self {
        Self(kind as u16)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keywords_are_sorted_for_binary_search() {
        // Arrange
        let mut sorted = KEYWORDS.to_vec();
        // Act
        sorted.sort_unstable();
        // Assert
        assert_eq!(sorted, KEYWORDS);
    }

    #[test]
    fn is_keyword_distinguishes_reserved_words_from_names() {
        // Arrange / Act / Assert（同値クラス: 予約語・基本名・大文字違い）
        assert!(is_keyword("part"));
        assert!(!is_keyword("stage"));
        assert!(!is_keyword("Part"));
    }

    #[test]
    fn from_raw_round_trips_and_falls_back_to_error() {
        // Arrange / Act / Assert（境界値: 先頭・末尾・範囲外）
        assert_eq!(
            SyntaxKind::from_raw(SyntaxKind::WHITESPACE as u16),
            SyntaxKind::WHITESPACE
        );
        assert_eq!(
            SyntaxKind::from_raw(SyntaxKind::OBJECTIVE_REQUIREMENT_USAGE as u16),
            SyntaxKind::OBJECTIVE_REQUIREMENT_USAGE
        );
        assert_eq!(SyntaxKind::from_raw(u16::MAX), SyntaxKind::ERROR);
    }
}
