//! SysML v2 のテキスト記法の文法（段階 A、ADR-0015）。
//!
//! 規則は SysML v2 の BNF（8.2.2）に沿うが、段階 A では宣言の頭（種類・名前・型付けなどの関係）だけを
//! 文法として読み、式は括弧の釣り合いで区切った `EXPRESSION` として持つ。
//! どの入力でも止まらず、読めない部分は `ERROR` か `UNSUPPORTED_MEMBER` に入れて続きを読む。

use super::kind::SyntaxKind::{self, *};
use super::kind::{KERML_DECLARATION_KEYWORDS, KERML_PREFIX_KEYWORDS};
use super::parser::{ErrorAt, Parser};

/// ファイル全体（RootNamespace）。入力の末尾まで要素を読み、`SOURCE_FILE` の節にする。
///
/// 対応する `{` の無い `}` は、その 1 つを `ERROR` の節にして「対応する「{」がない「}」があります」を置き、続きを読む。
///
/// # 引数
///
/// - `p`：入力の先頭にいるパーサ（読み終えると末尾にいる）
pub(crate) fn source_file(p: &mut Parser<'_>) {
    let m = p.start();
    while !p.at_eof() {
        if p.at(R_BRACE) {
            let e = p.start();
            p.error("対応する「{」がない「}」があります");
            p.bump();
            e.complete(p, ERROR);
        } else {
            member_or_skip(p);
        }
    }
    m.complete(p, SOURCE_FILE);
}

/// ブロックの入れ子の上限。これより深い `{ … }` は中を読まずにエラーにする（再帰でスタックがあふれないように）。
pub(crate) const MAX_DEPTH: usize = 256;

/// 深すぎるブロック。対応する `}` まで（無ければ末尾まで）を、入れ子を数えながら 1 つの ERROR にする。
///
/// 「入れ子が深すぎるため、この { … } の中は読み取りません（256 段まで）」のエラーを、開きの `{` の先頭に置く。
///
/// # 引数
///
/// - `p`：深さが `MAX_DEPTH` に達したブロックの開き `{` にいるパーサ
fn too_deep(p: &mut Parser<'_>) {
    let m = p.start();
    p.error(format!(
        "入れ子が深すぎるため、この {{ … }} の中は読み取りません（{MAX_DEPTH} 段まで）"
    ));
    let mut depth = 0usize;
    while !p.at_eof() {
        match p.current() {
            L_BRACE => depth += 1,
            R_BRACE => depth = depth.saturating_sub(1),
            _ => {}
        }
        p.bump();
        if depth == 0 {
            break;
        }
    }
    m.complete(p, ERROR);
}

/// `{ … }`。閉じていなければ、持ち主の宣言の頭にエラーを置く。`label` は持ち主の名前。
///
/// 深さが `MAX_DEPTH` 以上なら中を読まずに `too_deep` に任せる。中の要素を `}` か末尾まで読み、`BODY` の節にする。
///
/// # 引数
///
/// - `p`：開き `{` にいるパーサ
/// - `owner`：持ち主の宣言の頭のトークンの番号（閉じていないときのエラーの位置）
/// - `label`：持ち主の名前。空なら「「{」に対応する「}」がありません」、あれば「「P」のブロックが閉じていません」の形の文言にする
fn body(p: &mut Parser<'_>, owner: usize, label: &str) {
    if p.depth >= MAX_DEPTH {
        too_deep(p);
        return;
    }
    let m = p.start();
    p.bump();
    p.depth += 1;
    while !p.at_eof() && !p.at(R_BRACE) {
        member_or_skip(p);
    }
    p.depth -= 1;
    if !p.eat(R_BRACE) {
        let message = if label.is_empty() {
            "「{」に対応する「}」がありません".to_owned()
        } else {
            format!("「{label}」のブロックが閉じていません")
        };
        p.error_at(ErrorAt::Start(owner), message);
    }
    m.complete(p, BODY);
}

/// 要素 1 つ。1 つもトークンを読めなかったときは、そのトークンをエラーとして読み飛ばす（必ず進む）。
///
/// 読み飛ばしたトークンは `ERROR` の節にし、「読めない記号があります」を置く。
///
/// # 引数
///
/// - `p`：要素の頭にいるパーサ（末尾ではないこと）
fn member_or_skip(p: &mut Parser<'_>) {
    let before = p.position();
    member(p);
    if p.position() == before {
        let e = p.start();
        p.error("読めない記号があります");
        p.bump();
        e.complete(p, ERROR);
    }
}

/// 宣言の頭に来るキーワードのうち、種類を決めるもの。返り値は（キーワードの数、定義の節、使用の節）。
///
/// 読み進めない。`event occurrence`・`use case`・`succession flow` は 2 語で 1 つの種類とする。
///
/// # 引数
///
/// - `p`：パーサ
/// - `n`：調べるトークンの、今の位置からの距離（0 が今のトークン）
///
/// # 戻り値
///
/// `Some((キーワードの数, 定義の節の種類, 使用の節の種類))`。種類を決めるキーワードでなければ `None`。
///
/// # 例
///
/// ```text
/// kind_keyword("part def A", 0)         → Some((1, PART_DEFINITION, PART_USAGE))
/// kind_keyword("event occurrence e", 0) → Some((2, OCCURRENCE_DEFINITION, OCCURRENCE_USAGE))
/// kind_keyword("succession flow f", 0)  → Some((2, SUCCESSION_FLOW_USAGE, SUCCESSION_FLOW_USAGE))
/// kind_keyword("use x", 0)              → None   // `use` の後に `case` が無い
/// kind_keyword("a : T", 0)              → None   // キーワードでない
/// ```
fn kind_keyword(p: &Parser<'_>, n: usize) -> Option<(usize, SyntaxKind, SyntaxKind)> {
    if !p.nth_at(n, KEYWORD) {
        return None;
    }
    let pair = |d, u| Some((1, d, u));
    match p.nth_text(n) {
        "attribute" => pair(ATTRIBUTE_DEFINITION, ATTRIBUTE_USAGE),
        "enum" => pair(ENUMERATION_DEFINITION, ENUMERATION_USAGE),
        "occurrence" => pair(OCCURRENCE_DEFINITION, OCCURRENCE_USAGE),
        "event" if p.nth_at_kw(n + 1, "occurrence") => {
            Some((2, OCCURRENCE_DEFINITION, OCCURRENCE_USAGE))
        }
        "item" => pair(ITEM_DEFINITION, ITEM_USAGE),
        "part" => pair(PART_DEFINITION, PART_USAGE),
        "port" => pair(PORT_DEFINITION, PORT_USAGE),
        "connection" => pair(CONNECTION_DEFINITION, CONNECTION_USAGE),
        "flow" => pair(FLOW_DEFINITION, FLOW_USAGE),
        "interface" => pair(INTERFACE_DEFINITION, INTERFACE_USAGE),
        "allocation" => pair(ALLOCATION_DEFINITION, ALLOCATION_USAGE),
        "action" => pair(ACTION_DEFINITION, ACTION_USAGE),
        "state" => pair(STATE_DEFINITION, STATE_USAGE),
        "calc" => pair(CALCULATION_DEFINITION, CALCULATION_USAGE),
        "constraint" => pair(CONSTRAINT_DEFINITION, CONSTRAINT_USAGE),
        "requirement" => pair(REQUIREMENT_DEFINITION, REQUIREMENT_USAGE),
        "concern" => pair(CONCERN_DEFINITION, CONCERN_USAGE),
        "case" => pair(CASE_DEFINITION, CASE_USAGE),
        "analysis" => pair(ANALYSIS_CASE_DEFINITION, ANALYSIS_CASE_USAGE),
        "verification" => pair(VERIFICATION_CASE_DEFINITION, VERIFICATION_CASE_USAGE),
        "use" if p.nth_at_kw(n + 1, "case") => Some((2, USE_CASE_DEFINITION, USE_CASE_USAGE)),
        "view" => pair(VIEW_DEFINITION, VIEW_USAGE),
        "viewpoint" => pair(VIEWPOINT_DEFINITION, VIEWPOINT_USAGE),
        "rendering" => pair(RENDERING_DEFINITION, RENDERING_USAGE),
        "metadata" => pair(METADATA_DEFINITION, METADATA_KEYWORD_USAGE),
        "message" => pair(MESSAGE_USAGE, MESSAGE_USAGE),
        "transition" => pair(TRANSITION_USAGE, TRANSITION_USAGE),
        // `succession flow f from a to b;`（SuccessionFlowUsage、8.2.2.16）は 2 語で 1 つの種類
        "succession" if p.nth_at_kw(n + 1, "flow") => {
            Some((2, SUCCESSION_FLOW_USAGE, SUCCESSION_FLOW_USAGE))
        }
        "succession" => pair(SUCCESSION_AS_USAGE, SUCCESSION_AS_USAGE),
        "binding" => pair(BINDING_CONNECTOR_AS_USAGE, BINDING_CONNECTOR_AS_USAGE),
        _ => None,
    }
}

/// 宣言の前に付く語（可視性・修飾・向き。MemberPrefix・UsagePrefix・DefinitionPrefix）。
const PREFIX_KEYWORDS: &[&str] = &[
    "private",
    "public",
    "protected",
    "abstract",
    "variation",
    "variant",
    "individual",
    "derived",
    "constant",
    "end",
    "ref",
    "in",
    "out",
    "inout",
    "snapshot",
    "timeslice",
    "return",
    "readonly",
];

/// 新しい要素の頭になるキーワード。改行の後にこれが来たら、前の文の「;」の書き忘れとみなす。
const MEMBER_START_KEYWORDS: &[&str] = &[
    "abstract",
    "action",
    "actor",
    "alias",
    "allocate",
    "allocation",
    "analysis",
    "assert",
    "assign",
    "assume",
    "attribute",
    "bind",
    "binding",
    "calc",
    "case",
    "comment",
    "concern",
    "connection",
    "constant",
    "constraint",
    "decide",
    "dependency",
    "derived",
    "doc",
    "entry",
    "enum",
    "exhibit",
    "exit",
    "expose",
    "filter",
    "fork",
    "frame",
    "import",
    "include",
    "individual",
    "inout",
    "interface",
    "item",
    "join",
    "language",
    "library",
    "loop",
    "merge",
    "message",
    "metadata",
    "objective",
    "occurrence",
    "out",
    "package",
    "part",
    "perform",
    "port",
    "private",
    "protected",
    "public",
    "ref",
    "render",
    "rendering",
    "rep",
    "require",
    "requirement",
    "return",
    "satisfy",
    "send",
    "stakeholder",
    "standard",
    "state",
    "subject",
    "succession",
    "terminate",
    "transition",
    "use",
    "variant",
    "variation",
    "verification",
    "verify",
    "view",
    "viewpoint",
    "while",
];

/// 今のトークンが、新しい要素の頭になるキーワード（`MEMBER_START_KEYWORDS`）か。
///
/// 改行の後でこれが真なら、前の文の `;` の書き忘れとみなして宣言や式を打ち切る。
///
/// # 引数
///
/// - `p`：パーサ
///
/// # 戻り値
///
/// 今のトークンが `KEYWORD` で、表にある語なら `true`。
///
/// # 例
///
/// ```text
/// // 今のトークンが
/// part（KEYWORD） → true
/// to（KEYWORD）   → false   // 表に無い
/// a（IDENT）     → false   // キーワードでない
/// ```
fn at_member_start(p: &Parser<'_>) -> bool {
    p.at(KEYWORD) && MEMBER_START_KEYWORDS.contains(&p.nth_text(0))
}

/// 要素 1 つ（OwnedMember・PackageMember・DefinitionBodyItem など）。
///
/// 頭のコメント、前置きの語（可視性・修飾・`#メタデータ`）、種類のキーワード、ほかのキーワード、`@`、
/// キーワードの無い使用、式の順に見分けて節を作る。どれでもなければ何も読まない（`member_or_skip` が読み飛ばす）。
///
/// # 引数
///
/// - `p`：要素の頭にいるパーサ
fn member(p: &mut Parser<'_>) {
    let m = p.start();
    if p.at(REGULAR_COMMENT) {
        p.bump();
        m.complete(p, COMMENT);
        return;
    }
    let mut prefixed = false;
    let mut extended = false;
    let mut individual = false;
    loop {
        if p.at(HASH) && p.nth_at_name(1) {
            let pm = p.start();
            p.bump();
            reference(p);
            pm.complete(p, PREFIX_METADATA);
            extended = true;
        } else if p.at(KEYWORD) && PREFIX_KEYWORDS.contains(&p.nth_text(0)) {
            individual |= p.at_kw("individual");
            p.bump();
        } else {
            break;
        }
        prefixed = true;
    }
    let owner = m.token;

    if let Some(n) = kerml_declaration_head(p) {
        // KerML の宣言（`classifier C { … }`・`function F { … }`）。まだ扱わないので、本体ごと 1 つの文として残す（F-EDIT-8）
        for _ in 0..n {
            p.bump();
        }
        declaration(p, owner, true, false);
        m.complete(p, UNSUPPORTED_MEMBER);
        return;
    }
    if p.at_kw("action") && action_node_follows(p, 1) {
        // `action s send x;`・`action a accept E;`（ActionNodeUsageDeclaration、8.2.2.17）
        p.bump();
        identification(p);
        if let Some(kind) = action_node(p, owner) {
            m.complete(p, kind);
            return;
        }
    }
    if let Some((n, def, usage)) = kind_keyword(p, 0) {
        for _ in 0..n {
            p.bump();
        }
        let is_def = p.eat_kw("def");
        let kind = if is_def { def } else { usage };
        if kind == METADATA_KEYWORD_USAGE {
            metadata_usage_tail(p, owner);
        } else if kind == SUCCESSION_AS_USAGE {
            succession_declaration(p, owner);
        } else if kind == TRANSITION_USAGE {
            transition_declaration(p, owner);
        } else if let Some(kw) = connector_keyword(kind) {
            // `allocation a\n    allocate x to y;` の改行の後の `allocate` は、新しい文ではなく続き
            let name = declaration_tail(p, true, false, Some(kw));
            end(p, owner, &name, true);
        } else {
            declaration(p, owner, true, is_def);
        }
        m.complete(p, kind);
        return;
    }
    if (extended || individual) && p.at_kw("def") {
        // `#X def H;`：利用者定義のキーワードで書く定義（ExtendedDefinition、8.2.2.27）
        // `individual def H;`：種類のキーワードの無い個体の定義（IndividualDefinition、8.2.2.9）
        p.bump();
        declaration(p, owner, true, true);
        m.complete(
            p,
            if extended {
                EXTENDED_DEFINITION
            } else {
                OCCURRENCE_DEFINITION
            },
        );
        return;
    }
    if p.at(KEYWORD) && !at_expression_keyword(p) {
        let kind = keyword_member(p, owner);
        m.complete(p, kind);
        return;
    }
    if p.at(AT) {
        p.bump();
        metadata_usage_tail(p, owner);
        m.complete(p, METADATA_USAGE);
        return;
    }
    if prefixed || is_feature_declaration(p) {
        declaration(p, owner, true, false);
        // `individual h : H;` は個体の使用（IndividualUsage : OccurrenceUsage、8.2.2.9）
        m.complete(
            p,
            if individual {
                OCCURRENCE_USAGE
            } else {
                REFERENCE_USAGE
            },
        );
        return;
    }
    if p.at(R_PAREN) || p.at(R_BRACK) {
        m.abandon();
        stray(p);
        return;
    }
    if p.at(L_BRACE) || p.at(SEMI) {
        // 頭の無い `{ … }`・`;`
        p.error("要素の種類や名前がありません");
        end(p, owner, "", true);
        m.complete(p, ERROR);
        return;
    }
    if expression(p, false) {
        if !p.eat(SEMI) && !p.at(R_BRACE) {
            if p.at(L_BRACE) {
                body(p, owner, "");
            } else {
                p.error_after_previous("「;」がありません");
            }
        }
        m.complete(p, EXPRESSION_MEMBER);
    } else {
        m.abandon();
    }
}

/// KerML だけの宣言の頭（`classifier C`・`composite feature f`・`assoc struct A` など、KerML 8.2.3〜8.2.5）の語の数。読み進めない。
///
/// KerML の予約語は SysML の字句では名前（`IDENT`）なので、前に付く語（`composite` など）の後に宣言の頭の語があり、
/// その後に名前・短い名前・本体が続くときだけ KerML の宣言とみなす（`type : T;` のような、名前が `type` の特性は除く）。
///
/// # 引数
///
/// - `p`：要素の頭（SysML の前置きの語の後）にいるパーサ
///
/// # 戻り値
///
/// KerML の宣言なら、頭の語（前に付く語と宣言の頭の語）の数。そうでなければ `None`。
///
/// # 例
///
/// ```text
/// kerml_declaration_head("classifier C { … }")      → Some(1)
/// kerml_declaration_head("composite feature f : T;") → Some(2)
/// kerml_declaration_head("inv { x > 0 }")            → Some(1)
/// kerml_declaration_head("type : T;")                → None   // 名前が type の特性
/// kerml_declaration_head("part p;")                  → None
/// ```
fn kerml_declaration_head(p: &Parser<'_>) -> Option<usize> {
    let is = |i: usize, words: &[&str]| p.nth_at(i, IDENT) && words.contains(&p.nth_text(i));
    let mut i = 0;
    while is(i, KERML_PREFIX_KEYWORDS) {
        i += 1;
    }
    if !is(i, KERML_DECLARATION_KEYWORDS) {
        return None;
    }
    let next = i + 1;
    (p.nth_at_name(next) || p.nth_at(next, LT) || p.nth_at(next, L_BRACE)).then_some(next)
}

/// 式の頭になるキーワード（KerML 8.2.5 の LiteralBoolean・NullExpression・単項の `not`・InstantiationExpression の `new`）。
const EXPRESSION_KEYWORDS: &[&str] = &["true", "false", "null", "not", "new"];

/// 今のトークンが、式の頭になるキーワード（`EXPRESSION_KEYWORDS`）か。読み進めない。
///
/// 制約・要求・計算の本体の結果の式（ResultExpressionMember、8.2.2.19〜20）は、`true`・`not x` のように
/// キーワードで始まってもよい。`not satisfy R;`（否定の充足、8.2.2.21）の `not` は式の頭にしない。
///
/// # 引数
///
/// - `p`：要素の頭にいるパーサ
///
/// # 戻り値
///
/// 式の頭になるキーワードなら `true`。
///
/// # 例
///
/// ```text
/// at_expression_keyword("true }")         → true
/// at_expression_keyword("not (a and b) }") → true
/// at_expression_keyword("not satisfy R;") → false   // 否定の充足
/// at_expression_keyword("part p;")        → false
/// ```
fn at_expression_keyword(p: &Parser<'_>) -> bool {
    p.at(KEYWORD)
        && EXPRESSION_KEYWORDS.contains(&p.nth_text(0))
        && !(p.at_kw("not") && p.nth_at_kw(1, "satisfy"))
}

/// キーワードで始まる、種類キーワード以外の要素。
///
/// 文法を持たないキーワード（段階 A）は、黙って捨てずに `UNSUPPORTED_MEMBER` として読む（F-EDIT-8）。
///
/// # 引数
///
/// - `p`：キーワードにいるパーサ
/// - `owner`：この要素の頭のトークンの番号（前置きの語を含む。閉じていないブロックのエラーの位置）
///
/// # 戻り値
///
/// 要素の節の種類（呼び出し側が `complete` に使う）。
///
/// # 例
///
/// ```text
/// keyword_member("doc /* 説明 */")      → DOCUMENTATION
/// keyword_member("rep r language \"x\" /* … */") → TEXTUAL_REPRESENTATION
/// keyword_member("import A::*::**;")   → IMPORT
/// keyword_member("perform a;")         → PERFORM_ACTION_USAGE
/// keyword_member("first a then b;")    → SUCCESSION_AS_USAGE
/// keyword_member("if x > 0 then b;")   → SUCCESSION_AS_USAGE（GUARD_EXPRESSION を持つ）
/// keyword_member("send x via p;")      → SEND_NODE
/// keyword_member("then fork f;")       → FORK_NODE
/// keyword_member("then event a.e;")    → OCCURRENCE_USAGE（参照の形のイベント）
/// keyword_member("until x;")           → UNSUPPORTED_MEMBER   // 文法を持たない文
/// ```
fn keyword_member(p: &mut Parser<'_>, owner: usize) -> SyntaxKind {
    let kw = p.nth_text(0);
    match kw {
        "doc" => {
            p.bump();
            comment_tail(p, false);
            DOCUMENTATION
        }
        "comment" => {
            p.bump();
            comment_tail(p, true);
            COMMENT
        }
        "rep" | "language" => {
            textual_representation(p);
            TEXTUAL_REPRESENTATION
        }
        "package" => {
            p.bump();
            declaration(p, owner, true, false);
            PACKAGE
        }
        "library" | "standard" => {
            p.bump();
            p.eat_kw("library");
            if !p.eat_kw("package") {
                p.error("「package」がありません");
            }
            declaration(p, owner, true, false);
            LIBRARY_PACKAGE
        }
        "import" | "expose" => {
            p.bump();
            p.eat_kw("all");
            import_target(p);
            end(p, owner, kw, false);
            if kw == "import" { IMPORT } else { EXPOSE }
        }
        "filter" => {
            p.bump();
            expression(p, false);
            end(p, owner, kw, false);
            ELEMENT_FILTER_MEMBER
        }
        "render" => {
            p.bump();
            // 合成形 `render rendering r :> asTreeDiagram { … }`（ViewRenderingUsage、8.2.2.26）は、続く名前を新しい要素の名前にする。
            // 参照形 `render asTreeDiagram;` の名前は参照のまま
            let named = p.eat_kw("rendering");
            declaration(p, owner, named, false);
            VIEW_RENDERING_USAGE
        }
        "alias" => {
            p.bump();
            declaration(p, owner, true, false);
            ALIAS
        }
        "dependency" => {
            p.bump();
            dependency_tail(p, owner);
            DEPENDENCY
        }
        "perform" => headed(p, owner, &["action"], PERFORM_ACTION_USAGE),
        "exhibit" => headed(p, owner, &["state"], EXHIBIT_STATE_USAGE),
        "include" => headed(p, owner, &["use", "case"], INCLUDE_USE_CASE_USAGE),
        "satisfy" => headed(p, owner, &["requirement"], SATISFY_REQUIREMENT_USAGE),
        "not" if p.nth_at_kw(1, "satisfy") => {
            // `not satisfy R by X;`（否定の充足。SatisfyRequirementUsage の isNegated、8.2.2.21）
            p.bump();
            headed(p, owner, &["requirement"], SATISFY_REQUIREMENT_USAGE)
        }
        // `event occurrence e;` は kind_keyword が読む。ここに来るのは参照の形 `event e;`（EventOccurrenceUsage、8.2.2.9）
        "event" => headed(p, owner, &["occurrence"], OCCURRENCE_USAGE),
        "verify" => headed(p, owner, &["requirement"], REQUIREMENT_VERIFICATION_USAGE),
        "frame" => headed(p, owner, &["concern"], FRAMED_CONCERN_USAGE),
        "require" | "assume" => headed(p, owner, &["constraint"], REQUIREMENT_CONSTRAINT_USAGE),
        "assert" => {
            p.bump();
            p.eat_kw("not");
            if p.at_kw("satisfy") {
                headed(p, owner, &["requirement"], SATISFY_REQUIREMENT_USAGE)
            } else {
                // `assert` の後ろは、`assert constraint` と同じ形で読む
                let named = p.eat_kw("constraint");
                declaration(p, owner, named, false);
                ASSERT_CONSTRAINT_USAGE
            }
        }
        "subject" | "actor" | "stakeholder" | "objective" => {
            p.bump();
            declaration(p, owner, true, false);
            match kw {
                "subject" => SUBJECT_USAGE,
                "actor" => ACTOR_USAGE,
                "stakeholder" => STAKEHOLDER_USAGE,
                _ => OBJECTIVE_REQUIREMENT_USAGE,
            }
        }
        "entry" | "exit" | "do" => {
            p.bump();
            let named = match kind_keyword(p, 0) {
                Some((n, _, _)) => {
                    for _ in 0..n {
                        p.bump();
                    }
                    true
                }
                None => false,
            };
            declaration(p, owner, named, false);
            STATE_SUBACTION_MEMBER
        }
        "then" => {
            p.bump();
            if p.at_kw("action") && action_node_follows(p, 1) {
                // `then action s send x;`（SourceSuccessionMember の後のアクションの節）
                p.bump();
                identification(p);
            }
            if let Some(kind) = action_node(p, owner) {
                // `then fork f;`・`then send x to y;` は、その節として読む
                kind
            } else if let Some((n, _, usage)) = kind_keyword(p, 0) {
                // `then action a;`・`then message …;` は、その種類の使用として読む
                for _ in 0..n {
                    p.bump();
                }
                declaration(p, owner, true, false);
                usage
            } else if p.at_kw("event") {
                // `then event a.e;`（参照の形のイベント EventOccurrenceUsage の前の SourceSuccessionMember、8.2.2.9）
                headed(p, owner, &["occurrence"], OCCURRENCE_USAGE)
            } else {
                // `then b;`（TargetSuccessionMember、8.2.2.17）：直前の要素から b への継起
                connector_end(p);
                end(p, owner, "", true);
                SUCCESSION_AS_USAGE
            }
        }
        // `first a then b;`・`first a if g then b;`・`first start;`（SuccessionAsUsage・GuardedSuccession・InitialNodeMember）
        "first" => {
            succession_ends(p);
            end(p, owner, "", true);
            SUCCESSION_AS_USAGE
        }
        // `else b;`（DefaultTargetSuccession、8.2.2.17）：直前の判断から、ほかのガードに当たらないときの継起
        "else" => {
            p.bump();
            connector_end(p);
            end(p, owner, "", true);
            SUCCESSION_AS_USAGE
        }
        "if" => guarded_target(p, owner),
        // `bind a = b;`・`connect a to b;`・`allocate a to b;`（名前の無い BindingConnectorAsUsage・
        // ConnectionUsage・AllocationUsage、8.2.2.13・8.2.2.15）
        "bind" => {
            binding_part(p);
            declaration(p, owner, false, false);
            BINDING_CONNECTOR_AS_USAGE
        }
        "connect" => {
            connector_part(p);
            declaration(p, owner, false, false);
            CONNECTION_USAGE
        }
        "allocate" => {
            connector_part(p);
            declaration(p, owner, false, false);
            ALLOCATION_USAGE
        }
        _ if action_node_keyword(p, 0) => action_node(p, owner).unwrap_or(UNSUPPORTED_MEMBER),
        _ => {
            // 段階 A では文法を持たない文。黙って捨てず、節として残す（F-EDIT-8）
            p.bump();
            declaration(p, owner, false, false);
            UNSUPPORTED_MEMBER
        }
    }
}

/// アクションの節（ActionNode、8.2.2.17）の頭のキーワードと、その節の種類。制御の節（ControlNode）は `action n` の後に書けない。
const ACTION_NODES: &[(&str, SyntaxKind, bool)] = &[
    ("fork", FORK_NODE, false),
    ("join", JOIN_NODE, false),
    ("merge", MERGE_NODE, false),
    ("decide", DECISION_NODE, false),
    ("send", SEND_NODE, true),
    ("accept", ACCEPT_NODE, true),
    ("assign", ASSIGNMENT_NODE, true),
    ("terminate", TERMINATE_NODE, true),
    ("if", IF_NODE, true),
    ("while", WHILE_LOOP_NODE, true),
    ("loop", WHILE_LOOP_NODE, true),
    ("for", FOR_LOOP_NODE, true),
];

/// `n` 番目のトークンが、アクションの節（ActionNode、8.2.2.17）の頭のキーワードか。読み進めない。
///
/// # 引数
///
/// - `p`：パーサ
/// - `n`：調べるトークンの、今の位置からの距離（0 が今のトークン）
///
/// # 戻り値
///
/// `fork`・`join`・`merge`・`decide`・`send`・`accept`・`assign`・`terminate`・`if`・`while`・`loop`・`for` のどれかなら `true`。
///
/// # 例
///
/// ```text
/// action_node_keyword("fork f;", 0) → true
/// action_node_keyword("part p;", 0) → false
/// ```
fn action_node_keyword(p: &Parser<'_>, n: usize) -> bool {
    ACTION_NODES.iter().any(|(kw, _, _)| p.nth_at_kw(n, kw))
}

/// `action` の後に、名前を付けたアクションの節（ActionNodeUsageDeclaration、8.2.2.17）が続くか。読み進めない。
///
/// `action` の直後か、名前 1 つの後に、`action n` の後に書ける節のキーワード（`send`・`accept`・`assign`・`terminate`・
/// `if`・`while`・`loop`・`for`）があれば真。
///
/// # 引数
///
/// - `p`：パーサ
/// - `n`：`action` の次のトークンの、今の位置からの距離
///
/// # 戻り値
///
/// アクションの節が続くなら `true`。
///
/// # 例
///
/// ```text
/// action_node_follows("action s send x;", 1)  → true
/// action_node_follows("action accept E;", 1)  → true
/// action_node_follows("action a : A;", 1)     → false
/// action_node_follows("action f fork;", 1)    → false   // 制御の節は action の後に書けない
/// ```
fn action_node_follows(p: &Parser<'_>, n: usize) -> bool {
    let named = |i: usize| {
        ACTION_NODES
            .iter()
            .any(|(kw, _, after_action)| *after_action && p.nth_at_kw(i, kw))
    };
    named(n) || (p.nth_at_name(n) && named(n + 1))
}

/// アクションの節 1 つ（ActionNode、8.2.2.17）。頭のキーワードから終わり（`;` か本体）までを読む。
///
/// 制御の節（`fork`・`join`・`merge`・`decide`）は名前と型などを、`send` は送るもの・`via`・`to` を、`accept` は受けるものと `via` を、
/// `assign` は代入の相手と `:=` の値を、`terminate` は終わらせる相手を読む。引数は `NODE_PARAMETER` の節にする。
/// 状態の中の省略形の遷移 `accept E if g do e then b;` は、ガード・効果・`then` と行き先（`CONNECTOR_END`）も読む（`transition_rest`）。
/// `if`・`while`・`loop`・`for` は、条件（`EXPRESSION`）と本体（`BODY`）を読む（`if_tail`・`body_parameter`）。
///
/// # 引数
///
/// - `p`：節の頭のキーワードにいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 戻り値
///
/// 節の種類。頭がアクションの節のキーワードでなければ `None`（何も読まない）。
///
/// # 例
///
/// ```text
/// action_node("decide d;", …)            → Some(DECISION_NODE)（d は NAME）
/// action_node("send x via p to y;", …)   → Some(SEND_NODE)（NODE_PARAMETER が 3 つ）
/// action_node("assign a.x := 1;", …)     → Some(ASSIGNMENT_NODE)
/// action_node("while i < 3 { … } until done;", …) → Some(WHILE_LOOP_NODE)
/// action_node("part p;", …)              → None
/// ```
fn action_node(p: &mut Parser<'_>, owner: usize) -> Option<SyntaxKind> {
    let (kw, kind, _) = ACTION_NODES.iter().find(|(kw, _, _)| p.at_kw(kw))?;
    let (kw, kind) = (*kw, *kind);
    p.bump();
    match kw {
        "send" => {
            if !p.at_kw("via") && !p.at_kw("to") {
                node_parameter(p, &["via", "to"]);
            }
            if p.eat_kw("via") {
                required_parameter(p, &["to"]);
            }
            if p.eat_kw("to") {
                required_parameter(p, &[]);
            }
        }
        "accept" => {
            payload_parameter(p, TRANSITION_STOPS);
            if p.eat_kw("via") {
                required_parameter(p, TRANSITION_STOPS);
            }
            // 状態の中の省略形の遷移 `accept E if g do e then b;`（TargetTransitionUsage、8.2.2.18）は、行き先まで読む
            if TRANSITION_STOPS.iter().any(|k| p.at_kw(k)) {
                transition_rest(p, owner);
            }
        }
        "assign" => {
            let m = p.start();
            if p.at_name() {
                reference(p);
            } else {
                p.error("関係の相手の名前がありません");
            }
            m.complete(p, NODE_PARAMETER);
            if p.eat(COLON_EQ) {
                required_parameter(p, &[]);
            } else {
                // `:=` を書き忘れても、続く値は読む（「;」が無いとは言わない）
                p.error_after_previous("「:=」がありません");
                node_parameter(p, &[]);
            }
        }
        "terminate" => {
            node_parameter(p, &[]);
        }
        "if" => {
            if !expression_until(p, &["action"]) {
                p.error("条件の式がありません");
            }
            if_tail(p, owner);
            return Some(kind);
        }
        "while" | "loop" => {
            if kw == "while" && !expression_until(p, &["action"]) {
                p.error("条件の式がありません");
            }
            body_parameter(p, owner);
            if p.eat_kw("until") {
                if !expression_until(p, &[]) {
                    p.error("条件の式がありません");
                }
                if !p.eat(SEMI) {
                    p.error_after_previous("「;」がありません");
                }
            }
            return Some(kind);
        }
        "for" => {
            for_variable(p);
            if !p.eat_kw("in") {
                p.error("「in」がありません");
            }
            if !expression_until(p, &["action"]) {
                p.error("値の式がありません");
            }
            body_parameter(p, owner);
            return Some(kind);
        }
        _ => {
            // 制御の節（ControlNode）は、使用の宣言と本体
            declaration(p, owner, true, false);
            return Some(kind);
        }
    }
    end(p, owner, "", true);
    Some(kind)
}

/// `if` の条件より後ろ（IfNode、8.2.2.17）。本体と、`else` の後の本体か `else if …`（中の `IF_NODE`）を読む。
///
/// # 引数
///
/// - `p`：条件の式の直後にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 例
///
/// ```text
/// if_tail("{ action a; } else { action b; }", …)  → BODY・BODY
/// if_tail("{ action a; } else if y { … }", …)     → BODY・IF_NODE { if, EXPRESSION(y), BODY }
/// if_tail(";", …)                                  → 「「{」がありません」
/// ```
fn if_tail(p: &mut Parser<'_>, owner: usize) {
    body_parameter(p, owner);
    if !p.eat_kw("else") {
        return;
    }
    if p.at_kw("if") {
        let m = p.start();
        p.bump();
        if !expression_until(p, &["action"]) {
            p.error("条件の式がありません");
        }
        if_tail(p, owner);
        m.complete(p, IF_NODE);
    } else {
        body_parameter(p, owner);
    }
}

/// `if`・`while`・`for` の本体（ActionBodyParameter、8.2.2.17）。`( 'action' 名前? )? '{' … '}'`。
///
/// 本体が無ければ「「{」がありません」を置き、続く `;` は読み飛ばす（「;」の後を別の文と取り違えないように）。
///
/// # 引数
///
/// - `p`：本体の頭にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 例
///
/// ```text
/// body_parameter("{ action a; }", …)        → BODY
/// body_parameter("action b { … }", …)       → NAME(b)・BODY
/// body_parameter(";", …)                    → 「「{」がありません」（; は読む）
/// ```
fn body_parameter(p: &mut Parser<'_>, owner: usize) {
    if p.eat_kw("action") {
        identification(p);
    }
    if p.at(L_BRACE) {
        body(p, owner, "");
    } else {
        p.error("「{」がありません");
        p.eat(SEMI);
    }
}

/// `for` の変数（ForVariableDeclarationMember、8.2.2.17）。`名前 ( : 型 )?` を `NODE_PARAMETER` の節にする。
/// 名前が無ければ「名前がありません」を置く。
///
/// # 引数
///
/// - `p`：`for` の直後にいるパーサ
///
/// # 例
///
/// ```text
/// for_variable("x : T in xs") → NODE_PARAMETER { NAME(x), FEATURE_TYPING(T) }（in の手前で止まる）
/// for_variable("in xs")       → 「名前がありません」
/// ```
fn for_variable(p: &mut Parser<'_>) {
    if !p.at_name() {
        p.error("名前がありません");
        return;
    }
    let m = p.start();
    let n = p.start();
    p.bump();
    n.complete(p, NAME);
    if p.at(COLON) {
        relationship(p, 1, FEATURE_TYPING);
    }
    m.complete(p, NODE_PARAMETER);
}

/// アクションの節の引数 1 つ（NodeParameterMember、8.2.2.17）。`stops` のキーワードの手前までの式を `NODE_PARAMETER` の節にする。
///
/// # 引数
///
/// - `p`：引数の頭にいるパーサ
/// - `stops`：括弧の外で着いたら止まるキーワード
///
/// # 戻り値
///
/// 式を読んだら `true`。何も読まなかったら `false`（節も作らない）。
///
/// # 例
///
/// ```text
/// node_parameter("S(1) via p;", &["via", "to"]) → true（NODE_PARAMETER { EXPRESSION("S(1)") }）
/// node_parameter(";", &[])                      → false
/// ```
fn node_parameter(p: &mut Parser<'_>, stops: &[&str]) -> bool {
    let m = p.start();
    if expression_until(p, stops) {
        m.complete(p, NODE_PARAMETER);
        true
    } else {
        m.abandon();
        false
    }
}

/// キーワード（`via`・`to`・`:=`）の後の、省けない引数。式が無ければ「値の式がありません」を置く。
///
/// # 引数
///
/// - `p`：引数の頭にいるパーサ
/// - `stops`：括弧の外で着いたら止まるキーワード
///
/// # 例
///
/// ```text
/// required_parameter("p to y;", &["to"]) → NODE_PARAMETER { EXPRESSION("p") }
/// required_parameter(";", &[])           → 「値の式がありません」
/// ```
fn required_parameter(p: &mut Parser<'_>, stops: &[&str]) {
    if !node_parameter(p, stops) {
        p.error("値の式がありません");
    }
}

/// `accept` の後の、受けるもの（PayloadParameterMember、8.2.2.17）。`NODE_PARAMETER` の節にする。
///
/// `e : E`（名前と型）、`E`（型だけ）、`when 式`・`at 式`・`after 式`（変化・時刻・時間の経過で受ける）を読む。
/// 式は `stops` のキーワード（`via`、遷移なら `if`・`do`・`then` も）の手前で止める。
/// 受けるものが無ければ「受けるものがありません」を置く。
///
/// # 引数
///
/// - `p`：`accept` の直後にいるパーサ
/// - `stops`：`when`・`at`・`after` の後の式を止めるキーワード
///
/// # 例
///
/// ```text
/// payload_parameter("e : E via p;", TRANSITION_STOPS)       → NODE_PARAMETER { NAME(e), FEATURE_TYPING(E) }
/// payload_parameter("Go;", TRANSITION_STOPS)                → NODE_PARAMETER { QUALIFIED_NAME(Go) }
/// payload_parameter("after 5 [s] then b;", TRANSITION_STOPS) → NODE_PARAMETER { EXPRESSION("5 [s]") }（then の手前で止まる）
/// payload_parameter(";", TRANSITION_STOPS)                  → 「受けるものがありません」
/// ```
fn payload_parameter(p: &mut Parser<'_>, stops: &[&str]) {
    if !payload_feature(p, stops, &["when", "at", "after"], NODE_PARAMETER) {
        p.error("受けるものがありません");
    }
}

/// `flow`・`message` の `of` の後の、流れるもの（FlowPayloadFeature、8.2.2.16）。`FLOW_PAYLOAD_FEATURE` の節にする。
///
/// `of ff : Fuel`（名前と型）・`of Fuel`（型だけ）・`of Fuel[1]` を読む。流れるものが無ければ「流れるものがありません」を置く。
///
/// # 引数
///
/// - `p`：`of` にいるパーサ
///
/// # 例
///
/// ```text
/// flow_payload("of ff : Fuel from a to b;") → FLOW_PAYLOAD_FEATURE { NAME(ff), FEATURE_TYPING(Fuel) }（from の手前で止まる）
/// flow_payload("of Fuel from a to b;")      → FLOW_PAYLOAD_FEATURE { QUALIFIED_NAME(Fuel) }
/// flow_payload("of from a to b;")           → 「流れるものがありません」
/// ```
fn flow_payload(p: &mut Parser<'_>) {
    p.bump();
    if !payload_feature(p, &[], &[], FLOW_PAYLOAD_FEATURE) {
        p.error("流れるものがありません");
    }
}

/// 受けるもの・流れるもの（PayloadFeature、8.2.2.16〜17）を、節の種類 `kind` で読む。
///
/// `e : E`（名前と型）、`E`（型だけ）、`triggers` のキーワードの後の式（`accept` の `when 式`・`at 式`・`after 式`）を読む。
/// 式は `stops` のキーワードの手前で止める。
///
/// # 引数
///
/// - `p`：受けるもの・流れるものの頭にいるパーサ
/// - `stops`：`triggers` の後の式を止めるキーワード
/// - `triggers`：変化・時刻・時間の経過で受けるときのキーワード（流れるものでは空）
/// - `kind`：節の種類（`NODE_PARAMETER`・`FLOW_PAYLOAD_FEATURE`）
///
/// # 戻り値
///
/// 何か読んで節を作ったら `true`。何も読まなかったら `false`（節も作らない）。
///
/// # 例
///
/// ```text
/// payload_feature("e : E via p;", …, NODE_PARAMETER)        → true（NODE_PARAMETER { NAME(e), FEATURE_TYPING(E) }）
/// payload_feature("Fuel from a", &[], &[], FLOW_PAYLOAD_FEATURE) → true（FLOW_PAYLOAD_FEATURE { QUALIFIED_NAME(Fuel) }）
/// payload_feature(";", …)                                    → false
/// ```
fn payload_feature(
    p: &mut Parser<'_>,
    stops: &[&str],
    triggers: &[&str],
    kind: SyntaxKind,
) -> bool {
    let m = p.start();
    let mut any = false;
    if p.at_name()
        && (matches!(p.nth(1), COLON | COLON_GT | COLON_GT2 | COLON2_GT)
            || triggers.iter().any(|k| p.nth_at_kw(1, k)))
    {
        let n = p.start();
        p.bump();
        n.complete(p, NAME);
        any = true;
    }
    loop {
        match p.current() {
            COLON => relationship(p, 1, FEATURE_TYPING),
            COLON_GT => relationship(p, 1, SUBSETTING),
            COLON_GT2 => relationship(p, 1, REDEFINITION),
            COLON2_GT => relationship(p, 1, REFERENCE_SUBSETTING),
            L_BRACK => bracketed(p, MULTIPLICITY),
            IDENT | QUOTED_NAME if !any => reference(p),
            KEYWORD if triggers.iter().any(|k| p.at_kw(k)) => {
                p.bump();
                if !expression_until(p, stops) {
                    p.error("値の式がありません");
                }
            }
            _ => break,
        }
        any = true;
    }
    if any {
        m.complete(p, kind);
    } else {
        m.abandon();
    }
    any
}

/// `dependency` の後ろ（DependencyDeclaration、8.2.2.3）。`( Identification 'from' )? 参照 ( ',' 参照 )* 'to' 参照 ( ',' 参照 )*` と終わり。
///
/// 名前は `from` があるときだけ読む（`dependency A, B to C;` の `A` は名前ではなく依存する側）。
/// 依存する側・される側の名前が無ければ「関係の相手の名前がありません」、`to` が無ければ「「to」がありません」を置く。
///
/// # 引数
///
/// - `p`：`dependency` の直後にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 例
///
/// ```text
/// dependency_tail("d from A, B to C;", …) → NAME(d)、QUALIFIED_NAME(A)・(B)、to の後に QUALIFIED_NAME(C)
/// dependency_tail("A, B to C, D;", …)     → NAME なし。A・B と C・D の QUALIFIED_NAME
/// dependency_tail("from A;", …)           → 「「to」がありません」
/// ```
fn dependency_tail(p: &mut Parser<'_>, owner: usize) {
    let short = p.at(LT) && p.nth_at_name(1) && p.nth_at(2, GT);
    let at = if short { 3 } else { 0 };
    let named = p.nth_at_kw(at, "from") || (p.nth_at_name(at) && p.nth_at_kw(at + 1, "from"));
    if named {
        identification(p);
        p.bump();
    }
    reference_list(p);
    if p.eat_kw("to") {
        reference_list(p);
    } else {
        p.error("「to」がありません");
    }
    end(p, owner, "", true);
}

/// 参照（修飾名・特徴の連鎖）のカンマ区切りの並び。名前が無ければ「関係の相手の名前がありません」を置いて止める。
///
/// # 引数
///
/// - `p`：並びの最初の参照にいるパーサ
///
/// # 例
///
/// ```text
/// reference_list("A, b.c to") → QUALIFIED_NAME(A)、FEATURE_CHAIN(b.c)（to の手前で止まる）
/// reference_list("to C")      → 「関係の相手の名前がありません」
/// ```
fn reference_list(p: &mut Parser<'_>) {
    loop {
        if p.at_name() {
            reference(p);
        } else {
            p.error("関係の相手の名前がありません");
            break;
        }
        if !p.eat(COMMA) {
            break;
        }
    }
}

/// `perform action a`・`perform a` のように、後ろに種類のキーワードが続いてもよい頭。
/// 種類のキーワードがあれば、続く名前は新しい要素の名前、無ければ参照として読む（BNF の UsageDeclaration と OwnedReferenceSubsetting）。
///
/// # 引数
///
/// - `p`：頭のキーワード（`perform` など）にいるパーサ
/// - `owner`：この要素の頭のトークンの番号
/// - `kws`：頭の後ろに続いてよい種類のキーワードの並び（`["action"]`・`["use", "case"]` など）。全部そろったときだけ名前を読む
/// - `kind`：返す節の種類
///
/// # 戻り値
///
/// `kind` をそのまま返す。
///
/// # 例
///
/// ```text
/// headed("perform action a : A;", …, &["action"], PERFORM_ACTION_USAGE) → PERFORM_ACTION_USAGE（a は NAME）
/// headed("perform a;", …, &["action"], PERFORM_ACTION_USAGE)            → PERFORM_ACTION_USAGE（a は参照、NAME なし）
/// ```
fn headed(p: &mut Parser<'_>, owner: usize, kws: &[&str], kind: SyntaxKind) -> SyntaxKind {
    p.bump();
    let named = kws.iter().enumerate().all(|(i, kw)| p.nth_at_kw(i, kw));
    if named {
        for _ in kws {
            p.bump();
        }
    }
    declaration(p, owner, named, false);
    kind
}

/// `@` か `metadata` の後ろ（MetadataUsageDeclaration・`about`・MetadataBody、8.2.2.27）。
///
/// `m : M`・`m typed by M` のように名前があれば `NAME` と `FEATURE_TYPING` に、名前が無ければ型の参照
/// （`QUALIFIED_NAME`）にする。`about A, B` の相手は、`about` の後の参照（`QUALIFIED_NAME`・`FEATURE_CHAIN`）にする。
/// 相手の名前が無ければ「関係の相手の名前がありません」を置く。最後に `;` か本体を読む。
///
/// # 引数
///
/// - `p`：`@` か `metadata` の直後にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 例
///
/// ```text
/// metadata_usage_tail("Safety about A, b.c { k = 1; }") → QUALIFIED_NAME(Safety)、about の後に A・b.c、BODY
/// metadata_usage_tail("s : Safety;")                    → NAME(s)、FEATURE_TYPING(Safety)
/// metadata_usage_tail("Safety about ;")                 → 「関係の相手の名前がありません」
/// ```
fn metadata_usage_tail(p: &mut Parser<'_>, owner: usize) {
    let short = p.at(LT) && p.nth_at_name(1) && p.nth_at(2, GT);
    let at = if short { 3 } else { 0 };
    let typed_by =
        p.nth_at(at + 1, IDENT) && p.nth_text(at + 1) == "typed" && p.nth_at_kw(at + 2, "by");
    let named = p.nth_at_name(at) && (p.nth_at(at + 1, COLON) || typed_by);
    if short || named {
        identification(p);
        if p.at(COLON) {
            relationship(p, 1, FEATURE_TYPING);
        } else if p.at(IDENT) && p.nth_text(0) == "typed" && p.nth_at_kw(1, "by") {
            relationship(p, 2, FEATURE_TYPING);
        }
    } else if p.at_name() {
        reference(p);
    }
    if p.eat_kw("about") {
        loop {
            if p.at_name() {
                reference(p);
            } else {
                p.error("関係の相手の名前がありません");
                break;
            }
            if !p.eat(COMMA) {
                break;
            }
        }
    }
    declaration(p, owner, false, false);
}

/// 名前で始まる文が、キーワードの無い使用の宣言か（式ではないか）。読み進めない。
///
/// # 引数
///
/// - `p`：文の頭にいるパーサ
///
/// # 戻り値
///
/// 今のトークンが関係の記号（`:`・`:>`・`:>>`・`::>`）か、名前の次が関係の記号（`=>` を含む）・`=`・`:=`・`;`・`[`・`{`・
/// `<名前>`・関係のキーワード（`redefines`・`crosses` など）なら `true`。それ以外（式など）は `false`。
///
/// # 例
///
/// ```text
/// is_feature_declaration("stage = K::X;") → true
/// is_feature_declaration(":>> mass;")     → true
/// is_feature_declaration("a * b == c")    → false   // 式
/// is_feature_declaration("x < 0")         → false   // 比べる式（`<` の後が `名前>` でない）
/// is_feature_declaration("a.b;")          → false
/// ```
fn is_feature_declaration(p: &Parser<'_>) -> bool {
    if matches!(p.current(), COLON | COLON_GT | COLON_GT2 | COLON2_GT) {
        return true;
    }
    if !p.at_name() {
        return false;
    }
    match p.nth(1) {
        COLON | COLON_GT | COLON_GT2 | COLON2_GT | EQ | COLON_EQ | SEMI | L_BRACK | L_BRACE => true,
        // `x <s> …` の形だけを宣言とみなす（`x < 0` は比べる式）
        LT => p.nth_at_name(2) && p.nth_at(3, GT),
        KEYWORD => matches!(
            p.nth_text(1),
            "redefines"
                | "subsets"
                | "references"
                | "crosses"
                | "defined"
                | "specializes"
                | "default"
        ),
        OP => p.nth_text(1) == "=>",
        _ => false,
    }
}

/// 宣言の名前より後ろ（Identification・FeatureSpecializationPart・MultiplicityPart・ValuePart など）と、終わり（`;` か本体）。
/// `named` のときだけ、先頭の名前を新しい要素の名前として読む。名前を返す。
///
/// # 引数
///
/// - `p`：種類のキーワードの直後（名前があればその位置）にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
/// - `named`：先頭の名前を新しい要素の名前（`NAME`）として読むか。偽なら参照として読む
/// - `is_def`：定義か。真なら `:>` を特殊化（`SUBCLASSIFICATION`）、偽なら部分集合（`SUBSETTING`）として読む
///
/// # 戻り値
///
/// 読んだ名前（引用名は引用符を外す）。名前が無いときは空文字列。
///
/// # 例
///
/// ```text
/// declaration("Engine :> Base;", owner, true, true)  → "Engine"（:> は SUBCLASSIFICATION）
/// declaration("'a b' : T;", owner, true, false)      → "a b"
/// declaration("a;", owner, false, false)             → ""（a は参照）
/// declaration("a : T", owner, true, false)           → "a"（「;」がありません のエラー）
/// ```
fn declaration(p: &mut Parser<'_>, owner: usize, named: bool, is_def: bool) -> String {
    let name = declaration_tail(p, named, is_def, None);
    end(p, owner, &name, true);
    name
}

/// 宣言の名前より後ろを、終わり（`;`・`{`・`}`・末尾）の手前まで読む。終わりそのものは読まない。
///
/// 改行の後に新しい要素の頭のキーワードが来たら、`;` の書き忘れとみなしてそこで止める（`keep` の語は除く）。
/// `connect`・`allocate` の後は接続の端（`connector_part`）、`bind` の後は結び付ける端（`binding_part`）として読む。
///
/// # 引数
///
/// - `p`：種類のキーワードの直後にいるパーサ
/// - `named`：最初の名前を新しい要素の名前（`NAME`）として読むか。名前の後ろが `.`・`::`・`to` なら参照として読む
/// - `is_def`：定義か。真なら `:>` を `SUBCLASSIFICATION`、偽なら `SUBSETTING` にする
/// - `keep`：改行の後に来ても、新しい文の頭とみなさないキーワード（`allocation` の後の `allocate` など）。無ければ `None`
///
/// # 戻り値
///
/// 読んだ名前（引用名は引用符を外す）。名前が無いときは空文字列。
///
/// # 例
///
/// ```text
/// declaration_tail("<P1> Engine :> Base {", true, true, None) → "Engine"（<P1> は SHORT_NAME）
/// declaration_tail("kettle.heater;", true, false, None)       → ""（特徴の連鎖は参照）
/// declaration_tail("b : B\n    part c : C;", true, false, None) → "b"（改行の後の part の手前で止まる）
/// declaration_tail("c : C connect (a, b);", true, false, None) → "c"（a・b は CONNECTOR_END）
/// declaration_tail("a\n allocate x to y;", true, false, Some("allocate")) → "a"（allocate も読む）
/// ```
fn declaration_tail(p: &mut Parser<'_>, named: bool, is_def: bool, keep: Option<&str>) -> String {
    let mut name = String::new();
    let mut name_slot = named;
    let mut first = true;
    loop {
        if p.at_eof() || p.at(SEMI) || p.at(L_BRACE) || p.at(R_BRACE) {
            break;
        }
        if !first && p.newline_before() && at_member_start(p) && !keep.is_some_and(|k| p.at_kw(k)) {
            break;
        }
        first = false;
        match p.current() {
            LT if p.nth_at_name(1) && p.nth_at(2, GT) => {
                let m = p.start();
                p.bump();
                p.bump();
                p.bump();
                m.complete(p, SHORT_NAME);
                continue;
            }
            // `typed by A`（KerML の TYPED_BY。`: A` と同じ型付け。`typed` は SysML の予約語ではない）
            IDENT if p.nth_text(0) == "typed" && p.nth_at_kw(1, "by") => {
                relationship(p, 2, FEATURE_TYPING);
            }
            IDENT | QUOTED_NAME
                if name_slot
                    && !p.nth_at(1, DOT)
                    && !p.nth_at(1, COLON2)
                    && !p.nth_at_kw(1, "to") =>
            {
                name = unquote(p.nth_text(0));
                let m = p.start();
                p.bump();
                m.complete(p, NAME);
            }
            IDENT | QUOTED_NAME => reference(p),
            COLON => relationship(p, 1, FEATURE_TYPING),
            COLON_GT => relationship(
                p,
                1,
                if is_def {
                    SUBCLASSIFICATION
                } else {
                    SUBSETTING
                },
            ),
            COLON_GT2 => relationship(p, 1, REDEFINITION),
            COLON2_GT => relationship(p, 1, REFERENCE_SUBSETTING),
            // `=> q.r`・`crosses q.r`（Crosses の OwnedCrossSubsetting、8.2.2.6）
            OP if p.nth_text(0) == "=>" => relationship(p, 1, CROSS_SUBSETTING),
            KEYWORD => match p.nth_text(0) {
                "defined" if p.nth_at_kw(1, "by") => relationship(p, 2, FEATURE_TYPING),
                "specializes" => relationship(p, 1, SUBCLASSIFICATION),
                "subsets" => relationship(p, 1, SUBSETTING),
                "redefines" => relationship(p, 1, REDEFINITION),
                "references" => relationship(p, 1, REFERENCE_SUBSETTING),
                "crosses" => relationship(p, 1, CROSS_SUBSETTING),
                // `flow of ff : Fuel from …`・`message of M …`（FlowPayloadFeatureMember、8.2.2.16）
                "of" => flow_payload(p),
                "default" => feature_value(p),
                "connect" | "allocate" => connector_part(p),
                "bind" => binding_part(p),
                _ => p.bump(),
            },
            L_BRACK => bracketed(p, MULTIPLICITY),
            EQ | COLON_EQ => feature_value(p),
            _ => {
                if !expression(p, true) {
                    stray(p);
                }
            }
        }
        name_slot = false;
    }
    name
}

/// 接続の端を持つ使用の種類（`allocation`・`binding`）の、端の前に来るキーワード（8.2.2.13.2・8.2.2.15）。
///
/// # 引数
///
/// - `kind`：使用の節の種類
///
/// # 戻り値
///
/// `ALLOCATION_USAGE` なら `Some("allocate")`、`BINDING_CONNECTOR_AS_USAGE` なら `Some("bind")`。ほかは `None`。
///
/// # 例
///
/// ```text
/// connector_keyword(ALLOCATION_USAGE) → Some("allocate")
/// connector_keyword(PART_USAGE)       → None
/// ```
fn connector_keyword(kind: SyntaxKind) -> Option<&'static str> {
    match kind {
        ALLOCATION_USAGE => Some("allocate"),
        BINDING_CONNECTOR_AS_USAGE => Some("bind"),
        _ => None,
    }
}

/// `connect`・`allocate` の後ろの端（ConnectorPart、8.2.2.13.1）。2 項の `a to b` か、n 項の `( a, b, c )`。
///
/// 端は 1 つずつ `CONNECTOR_END` の節にする。2 項で `to` が無ければ「「to」がありません」、
/// n 項で `)` が無ければ「「)」がありません」を置く。
///
/// # 引数
///
/// - `p`：`connect` か `allocate` にいるパーサ
///
/// # 例
///
/// ```text
/// connector_part("connect a.p to b.q;")   → CONNECTOR_END(a.p)・CONNECTOR_END(b.q)
/// connector_part("connect (a, b, c);")    → CONNECTOR_END が 3 つ
/// connector_part("connect a;")            → 「「to」がありません」
/// ```
fn connector_part(p: &mut Parser<'_>) {
    p.bump();
    if p.eat(L_PAREN) {
        loop {
            connector_end(p);
            if !p.eat(COMMA) {
                break;
            }
        }
        if !p.eat(R_PAREN) {
            p.error_after_previous("「)」がありません");
        }
        return;
    }
    connector_end(p);
    if p.eat_kw("to") {
        connector_end(p);
    } else {
        p.error_after_previous("「to」がありません");
    }
}

/// `bind` の後ろの、結び付ける 2 つの端（BindingConnectorAsUsage、8.2.2.13.2）。`a = b`。
///
/// 端は `CONNECTOR_END` の節にする（`=` を値として読まない）。`=` が無ければ「「=」がありません」を置く。
///
/// # 引数
///
/// - `p`：`bind` にいるパーサ
///
/// # 例
///
/// ```text
/// binding_part("bind a.x = b.y;") → CONNECTOR_END(a.x)・CONNECTOR_END(b.y)
/// binding_part("bind a.x;")       → 「「=」がありません」
/// ```
fn binding_part(p: &mut Parser<'_>) {
    p.bump();
    connector_end(p);
    if p.eat(EQ) {
        connector_end(p);
    } else {
        p.error_after_previous("「=」がありません");
    }
}

/// `succession` の後ろ（SuccessionAsUsage・GuardedSuccession、8.2.2.14・8.2.2.17）。
/// `UsageDeclaration? 'first' 端 ( 'if' 式 )? 'then' 端` と終わり（`;` か本体）を読む。
///
/// 名前・短い名前・型付けなどの関係は、`first` の手前まで読む。`first` が無ければ「「first」がありません」を置く。
///
/// # 引数
///
/// - `p`：`succession` の直後にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 例
///
/// ```text
/// succession_declaration("s first a then b;", …)     → NAME(s)、CONNECTOR_END(a)・CONNECTOR_END(b)
/// succession_declaration("first a if g then b;", …)  → CONNECTOR_END(a)、GUARD_EXPRESSION(if g)、CONNECTOR_END(b)
/// succession_declaration("s : S;", …)                → NAME(s)、FEATURE_TYPING(S)、「「first」がありません」
/// ```
fn succession_declaration(p: &mut Parser<'_>, owner: usize) {
    let label = connector_usage_head(p);
    if p.at_kw("first") {
        succession_ends(p);
    } else {
        p.error("「first」がありません");
    }
    end(p, owner, &label, true);
}

/// 継起・遷移の宣言の頭（UsageDeclaration、8.2.2.6）。名前・短い名前と、型付け・部分集合・再定義・参照・多重度を、
/// 端（`first` など）の手前まで読む。
///
/// # 引数
///
/// - `p`：`succession`・`transition` の直後にいるパーサ
///
/// # 戻り値
///
/// 名前（引用名は引用符を外す）。名前が無ければ空文字列。
///
/// # 例
///
/// ```text
/// connector_usage_head("s : S first a then b;") → "s"（NAME(s)・FEATURE_TYPING(S)。first の手前で止まる）
/// connector_usage_head("first a then b;")       → ""（何も読まない）
/// ```
fn connector_usage_head(p: &mut Parser<'_>) -> String {
    let label = if p.at_name() {
        unquote(p.nth_text(0))
    } else {
        String::new()
    };
    identification(p);
    loop {
        match p.current() {
            COLON => relationship(p, 1, FEATURE_TYPING),
            COLON_GT => relationship(p, 1, SUBSETTING),
            COLON_GT2 => relationship(p, 1, REDEFINITION),
            COLON2_GT => relationship(p, 1, REFERENCE_SUBSETTING),
            L_BRACK => bracketed(p, MULTIPLICITY),
            KEYWORD if p.at_kw("defined") && p.nth_at_kw(1, "by") => {
                relationship(p, 2, FEATURE_TYPING);
            }
            _ => break,
        }
    }
    label
}

/// 遷移の、トリガより後ろの部分を止めるキーワード（8.2.2.18）。受けるもの・`via` の後の式は、これらの手前で止める。
const TRANSITION_STOPS: &[&str] = &["via", "if", "do", "then"];

/// `transition` の後ろ（TransitionUsage・TargetTransitionUsage、8.2.2.18）。
/// `( UsageDeclaration )? ( 'first' 端 )? ( 'accept' 受けるもの ( 'via' 式 )? )? ( 'if' 式 )? ( 'do' 振る舞い )? 'then' 端` と終わりを読む。
///
/// 元と先は `CONNECTOR_END`、トリガは `TRIGGER_ACTION`、ガードは `GUARD_EXPRESSION`、効果は `EFFECT_BEHAVIOR` の節にする。
/// `first` の無い `transition accept E then b;` は、状態の中で直前の状態から引く遷移（TargetTransitionUsage）。
///
/// # 引数
///
/// - `p`：`transition` の直後にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 例
///
/// ```text
/// transition_declaration("t first a accept E via p if g do e then b;", …)
///   → NAME(t)・CONNECTOR_END(a)・TRIGGER_ACTION・GUARD_EXPRESSION・EFFECT_BEHAVIOR・CONNECTOR_END(b)
/// transition_declaration("first a then b;", …) → CONNECTOR_END(a)・CONNECTOR_END(b)
/// transition_declaration("t first a;", …)      → 「「then」がありません」
/// ```
fn transition_declaration(p: &mut Parser<'_>, owner: usize) {
    let label = connector_usage_head(p);
    if p.eat_kw("first") {
        connector_end(p);
    }
    if p.at_kw("accept") {
        let m = p.start();
        p.bump();
        payload_parameter(p, TRANSITION_STOPS);
        if p.eat_kw("via") {
            required_parameter(p, TRANSITION_STOPS);
        }
        m.complete(p, TRIGGER_ACTION);
    }
    transition_rest(p, owner);
    end(p, owner, &label, true);
}

/// 遷移のトリガより後ろ（`( 'if' 式 )? ( 'do' 振る舞い )? 'then' 端`、8.2.2.18）。終わりの `;` は読まない。
///
/// ガードは `GUARD_EXPRESSION`、効果は `EFFECT_BEHAVIOR`、行き先は `CONNECTOR_END` の節にする。`then` が無ければ
/// 「「then」がありません」を置く。
///
/// # 引数
///
/// - `p`：`if`・`do`・`then` のどれかにいるパーサ
/// - `owner`：この要素の頭のトークンの番号（効果の本体が閉じていないときのエラーの位置）
///
/// # 例
///
/// ```text
/// transition_rest("if x > 0 do beep then b;", …) → GUARD_EXPRESSION("x > 0")・EFFECT_BEHAVIOR("beep")・CONNECTOR_END(b)
/// transition_rest("then b;", …)                  → CONNECTOR_END(b)
/// transition_rest(";", …)                        → 「「then」がありません」
/// ```
fn transition_rest(p: &mut Parser<'_>, owner: usize) {
    if p.at_kw("if") {
        guard(p, &["do", "then"]);
    }
    if p.at_kw("do") {
        let m = p.start();
        p.bump();
        // 効果は、参照（`do e`）・`action a`・`send …`・`assign …` などを、then の手前までの式として持つ
        expression_until(p, &["then"]);
        if p.at(L_BRACE) {
            body(p, owner, "");
        }
        m.complete(p, EFFECT_BEHAVIOR);
    }
    if p.eat_kw("then") {
        connector_end(p);
    } else {
        p.error_after_previous("「then」がありません");
    }
}

/// 継起の端とガード（`'first' 端 ( 'if' 式 )? ( 'then' 端 )?`、8.2.2.14・8.2.2.17）。終わりの `;` は読まない。
///
/// 端は `CONNECTOR_END`、ガードは `if` と条件の式を `GUARD_EXPRESSION` の節にする。`then` の無い `first start;` は、
/// 最初の要素を決める文（InitialNodeMember）として読む。条件の式が無ければ「条件の式がありません」を置く。
///
/// # 引数
///
/// - `p`：`first` にいるパーサ
///
/// # 例
///
/// ```text
/// succession_ends("first a then b;")      → CONNECTOR_END(a)・CONNECTOR_END(b)
/// succession_ends("first d if x > 0 then b;") → CONNECTOR_END(d)・GUARD_EXPRESSION（式は "x > 0"）・CONNECTOR_END(b)
/// succession_ends("first start;")         → CONNECTOR_END(start)
/// succession_ends("first a if then b;")   → 「条件の式がありません」
/// ```
fn succession_ends(p: &mut Parser<'_>) {
    if p.eat_kw("first") {
        connector_end(p);
    }
    if p.at_kw("if") {
        guard(p, &["then"]);
    }
    if p.eat_kw("then") {
        connector_end(p);
    }
}

/// 継起・遷移のガード（GuardExpressionMember、8.2.2.17・8.2.2.18）。`if` と、`stops` のキーワードの手前までの条件の式を
/// `GUARD_EXPRESSION` の節にする。
///
/// 条件の式が無ければ「条件の式がありません」を置く。
///
/// # 引数
///
/// - `p`：`if` にいるパーサ
/// - `stops`：条件の式を止めるキーワード（継起は `then`、遷移は `do`・`then`）
///
/// # 例
///
/// ```text
/// guard("if x > 0 then b;", &["then"])      → GUARD_EXPRESSION { if, EXPRESSION("x > 0") }（then の手前で止まる）
/// guard("if x do e then b;", &["do", "then"]) → GUARD_EXPRESSION { if, EXPRESSION("x") }（do の手前で止まる）
/// guard("if then b;", &["then"])            → GUARD_EXPRESSION { if }、「条件の式がありません」
/// ```
fn guard(p: &mut Parser<'_>, stops: &[&str]) {
    let g = p.start();
    p.bump();
    if !expression_until(p, stops) {
        p.error("条件の式がありません");
    }
    g.complete(p, GUARD_EXPRESSION);
}

/// `if g then b;`（GuardedTargetSuccession、8.2.2.17）：直前の要素から、条件 g が成り立つときに b へ進む継起。
/// 状態の中の `if g do e then b;`（TargetTransitionUsage、8.2.2.18）も、同じ節に効果（`EFFECT_BEHAVIOR`）を足して読む。
///
/// 条件の後が本体（`{`）なら、`if` のアクション（IfNode）として読む。`then` も本体も無い `if` は、段階 A では文法を持たない文
/// （`UNSUPPORTED_MEMBER`）として残す（F-EDIT-8）。
///
/// # 引数
///
/// - `p`：`if` にいるパーサ
/// - `owner`：この要素の頭のトークンの番号（閉じていないブロックのエラーの位置）
///
/// # 戻り値
///
/// `then` があれば `SUCCESSION_AS_USAGE`、本体があれば `IF_NODE`、どちらも無ければ `UNSUPPORTED_MEMBER`。
///
/// # 例
///
/// ```text
/// guarded_target("if x > 0 then b;", …) → SUCCESSION_AS_USAGE（GUARD_EXPRESSION と CONNECTOR_END(b)）
/// guarded_target("if x do e then b;", …) → SUCCESSION_AS_USAGE（GUARD_EXPRESSION・EFFECT_BEHAVIOR・CONNECTOR_END(b)）
/// guarded_target("if x { action a; }", …) → IF_NODE
/// guarded_target("if x;", …)            → UNSUPPORTED_MEMBER
/// ```
fn guarded_target(p: &mut Parser<'_>, owner: usize) -> SyntaxKind {
    let g = p.start();
    p.bump();
    let any = expression_until(p, &["then", "action", "do"]);
    if p.at(L_BRACE) || p.at_kw("action") {
        // `if g { … }`（IfNode、8.2.2.17）
        g.abandon();
        if !any {
            p.error("条件の式がありません");
        }
        if_tail(p, owner);
        return IF_NODE;
    }
    if p.at_kw("then") || p.at_kw("do") {
        if !any {
            p.error("条件の式がありません");
        }
        g.complete(p, GUARD_EXPRESSION);
        transition_rest(p, owner);
        end(p, owner, "", true);
        return SUCCESSION_AS_USAGE;
    }
    g.abandon();
    declaration(p, owner, false, false);
    UNSUPPORTED_MEMBER
}

/// 接続の端 1 つ（ConnectorEnd、8.2.2.13.1）。`[多重度]? (名前 ::>)? 参照` を `CONNECTOR_END` の節にする。
///
/// 参照が無ければ「関係の相手の名前がありません」を置く（多重度も名前も無ければ節を作らない）。
///
/// # 引数
///
/// - `p`：端の頭にいるパーサ
///
/// # 例
///
/// ```text
/// connector_end("a.p to")         → CONNECTOR_END { FEATURE_CHAIN(a.p) }
/// connector_end("[1] e ::> a to") → CONNECTOR_END { MULTIPLICITY, NAME(e), QUALIFIED_NAME(a) }
/// connector_end(";")              → 「関係の相手の名前がありません」（節は作らない）
/// ```
fn connector_end(p: &mut Parser<'_>) {
    let m = p.start();
    let mut any = false;
    if p.at(L_BRACK) {
        bracketed(p, MULTIPLICITY);
        any = true;
    }
    if p.at_name() && (p.nth_at(1, COLON2_GT) || p.nth_at_kw(1, "references")) {
        let n = p.start();
        p.bump();
        n.complete(p, NAME);
        p.bump();
        any = true;
    }
    if p.at_name() {
        reference(p);
        any = true;
    } else {
        p.error("関係の相手の名前がありません");
    }
    if any {
        m.complete(p, CONNECTOR_END);
    } else {
        m.abandon();
    }
}

/// 宣言の終わり。`;` か本体 `{ … }`。どちらも無ければエラー。
///
/// どちらも無いときは、直前に読んだトークンの末尾に「「;」がありません」を置く（何も読み進めない）。
///
/// # 引数
///
/// - `p`：宣言の終わりにいるパーサ
/// - `owner`：この要素の頭のトークンの番号（本体が閉じていないときのエラーの位置）
/// - `label`：要素の名前（本体が閉じていないときのエラーの文言に使う。空でもよい）
/// - `allow_body`：本体 `{ … }` を許すか（`import`・`expose`・`filter` は偽）
fn end(p: &mut Parser<'_>, owner: usize, label: &str, allow_body: bool) {
    if p.eat(SEMI) {
        return;
    }
    if allow_body && p.at(L_BRACE) {
        body(p, owner, label);
        return;
    }
    p.error_after_previous("「;」がありません");
}

/// `doc`・`comment` の後ろ（Identification、`about`、`locale`、本文の REGULAR_COMMENT）。
///
/// 本文の `/* … */` が無ければ、今のトークンの先頭に「本文（/* … */）がありません」を置く。
///
/// # 引数
///
/// - `p`：`doc`・`comment` の直後にいるパーサ
/// - `about`：`about` の後の参照の並びを読むか（`comment` は真、`doc` は偽）
fn comment_tail(p: &mut Parser<'_>, about: bool) {
    identification(p);
    if about && p.eat_kw("about") {
        loop {
            if p.at_name() {
                reference(p);
            }
            if !p.eat(COMMA) {
                break;
            }
        }
    }
    if p.eat_kw("locale") {
        p.eat(STRING);
    }
    if !p.eat(REGULAR_COMMENT) {
        p.error("本文（/* … */）がありません");
    }
}

/// 名前の付け方（Identification）。`<短い名前>` と名前を、あればそれぞれ `SHORT_NAME`・`NAME` の節にする。
///
/// # 引数
///
/// - `p`：短い名前か名前の頭にいるパーサ（どちらも無ければ何も読まない）
fn identification(p: &mut Parser<'_>) {
    if p.at(LT) && p.nth_at_name(1) && p.nth_at(2, GT) {
        let m = p.start();
        p.bump();
        p.bump();
        p.bump();
        m.complete(p, SHORT_NAME);
    }
    if p.at_name() {
        let m = p.start();
        p.bump();
        m.complete(p, NAME);
    }
}

/// テキストでの表し方（TextualRepresentation、8.2.2.4）。`( rep Identification )? language STRING_VALUE REGULAR_COMMENT`。
///
/// 本文の `/* … */` が文の終わりになる（`;` は書かない）。`language`・言語の名前・本文が欠けていれば、
/// そこにエラーを置く。欠けたまま `;` が続くときは、その `;` までを 1 つの文として読む。
///
/// # 引数
///
/// - `p`：`rep` か `language` にいるパーサ
fn textual_representation(p: &mut Parser<'_>) {
    if p.eat_kw("rep") {
        identification(p);
    }
    let missing = if !p.eat_kw("language") {
        Some("「language」がありません")
    } else if !p.eat(STRING) {
        Some("言語の名前（\"…\"）がありません")
    } else if !p.eat(REGULAR_COMMENT) {
        Some("本文（/* … */）がありません")
    } else {
        None
    };
    if let Some(message) = missing {
        p.error(message);
        p.eat(SEMI);
    }
}

/// `import`・`expose` の対象（`A::B`、`A::*`、`A::**`、`A::*::**`、後ろの `[ … ]`）。
///
/// 対象を `QUALIFIED_NAME`、後ろの絞り込みを `EXPRESSION` の節にする。名前が無ければ「対象の名前がありません」を置く。
///
/// # 引数
///
/// - `p`：`import`・`expose`（と `all`）の直後にいるパーサ
fn import_target(p: &mut Parser<'_>) {
    if p.at_name() {
        let m = p.start();
        p.bump();
        while p.at(COLON2) && p.nth_at_name(1) {
            p.bump();
            p.bump();
        }
        while p.at(COLON2) && matches!(p.nth(1), STAR | STAR2) {
            p.bump();
            p.bump();
        }
        m.complete(p, QUALIFIED_NAME);
    } else {
        p.error("対象の名前がありません");
    }
    if p.at(L_BRACK) {
        bracketed(p, EXPRESSION);
    }
}

/// 関係（型付け・特殊化など）。`ops` 個の記号かキーワードの後に、`~` と参照のカンマ区切りが続く。
///
/// 相手の名前が無ければ「関係の相手の名前がありません」を置いて止める。
///
/// # 引数
///
/// - `p`：関係の記号かキーワードにいるパーサ
/// - `ops`：読み飛ばす記号・キーワードの数（`:` は 1、`defined by` は 2）
/// - `kind`：関係の節の種類（`FEATURE_TYPING`・`SUBSETTING` など）
fn relationship(p: &mut Parser<'_>, ops: usize, kind: SyntaxKind) {
    let m = p.start();
    for _ in 0..ops {
        p.bump();
    }
    loop {
        p.eat(TILDE);
        if p.at_name() {
            reference(p);
        } else {
            p.error("関係の相手の名前がありません");
            break;
        }
        if !p.eat(COMMA) {
            break;
        }
    }
    m.complete(p, kind);
}

/// `= 式`・`:= 式`・`default = 式`。`FEATURE_VALUE` の節にする。
///
/// 式が無ければ「値の式がありません」を置く。
///
/// # 引数
///
/// - `p`：`=`・`:=`・`default` にいるパーサ
fn feature_value(p: &mut Parser<'_>) {
    let m = p.start();
    if p.eat_kw("default") {
        if !p.eat(EQ) {
            p.eat(COLON_EQ);
        }
    } else {
        p.bump();
    }
    if !expression(p, false) {
        p.error("値の式がありません");
    }
    m.complete(p, FEATURE_VALUE);
}

/// 修飾名（`A::B`）か、特徴の連鎖（`a.b.c`）。
///
/// 連鎖のときは各部分の `QUALIFIED_NAME` を `FEATURE_CHAIN` の節で包む。
///
/// # 引数
///
/// - `p`：名前（基本名・引用名）にいるパーサ
fn reference(p: &mut Parser<'_>) {
    let n = qualified_name_len(p, 0);
    let chain = p.nth_at(n, DOT) && p.nth_at_name(n + 1);
    let outer = if chain { Some(p.start()) } else { None };
    qualified_name(p);
    while p.at(DOT) && p.nth_at_name(1) {
        p.bump();
        qualified_name(p);
    }
    if let Some(m) = outer {
        m.complete(p, FEATURE_CHAIN);
    }
}

/// 修飾名（`A::B::C`）1 つを読み、`QUALIFIED_NAME` の節にする。`::` の後に名前が無ければ `::` の手前で止める。
///
/// # 引数
///
/// - `p`：名前（基本名・引用名）にいるパーサ
fn qualified_name(p: &mut Parser<'_>) {
    let m = p.start();
    p.bump();
    while p.at(COLON2) && p.nth_at_name(1) {
        p.bump();
        p.bump();
    }
    m.complete(p, QUALIFIED_NAME);
}

/// n 番目から始まる修飾名のトークン数。読み進めない。
///
/// # 引数
///
/// - `p`：パーサ
/// - `n`：修飾名の最初の名前の、今の位置からの距離（そこが名前であること）
///
/// # 戻り値
///
/// 名前と `::` を合わせたトークン数（1 以上）。`::` の後に名前が無ければ、その `::` は数えない。
///
/// # 例
///
/// ```text
/// qualified_name_len("A::B::C x", 0) → 5
/// qualified_name_len("a.b", 0)       → 1
/// qualified_name_len("A::*", 0)      → 1   // * は名前でない
/// ```
fn qualified_name_len(p: &Parser<'_>, n: usize) -> usize {
    let mut i = n + 1;
    while p.nth_at(i, COLON2) && p.nth_at_name(i + 1) {
        i += 2;
    }
    i - n
}

/// `[ … ]`。中は括弧の釣り合いだけで読む。
///
/// `;`・`{`・`}`・末尾に着いても閉じていなければ、直前のトークンの末尾に「「]」がありません」を置く。
///
/// # 引数
///
/// - `p`：開き `[` にいるパーサ
/// - `kind`：節の種類（多重度は `MULTIPLICITY`、`import` の絞り込みは `EXPRESSION`）
fn bracketed(p: &mut Parser<'_>, kind: SyntaxKind) {
    let m = p.start();
    p.bump();
    let mut depth = 1usize;
    while depth > 0 && !p.at_eof() && !p.at(SEMI) && !p.at(L_BRACE) && !p.at(R_BRACE) {
        match p.current() {
            L_BRACK | L_PAREN => depth += 1,
            R_BRACK | R_PAREN => depth -= 1,
            _ => {}
        }
        p.bump();
    }
    if depth > 0 {
        p.error_after_previous("「]」がありません");
    }
    m.complete(p, kind);
}

/// まだ文法として読まない式（段階 A）。`;`・`{`・`}`、対応の無い閉じ括弧、括弧の外の（`stop_at_keyword` なら）キーワードの手前まで。
/// 何か読んだら true。
///
/// 改行の後に新しい要素の頭のキーワードが来たら、そこで止める。開いた括弧が閉じないまま止まったら
/// 「括弧が閉じていません」を置く。読んだトークンは `EXPRESSION` の節にする。
///
/// # 引数
///
/// - `p`：式の頭にいるパーサ
/// - `stop_at_keyword`：括弧の外で（2 つ目以降の）キーワードに着いたら止めるか（宣言の途中の式は真）
///
/// # 戻り値
///
/// 1 つ以上のトークンを読んだら `true`。何も読まなかったら `false`（節も作らない）。
///
/// # 例
///
/// ```text
/// expression("a * b == c }", false) → true（EXPRESSION は "a * b == c"）
/// expression("1 to x;", true)       → true（EXPRESSION は "1"、to の手前で止まる）
/// expression("f(x;", false)         → true（「括弧が閉じていません」）
/// expression(";", false)            → false
/// expression(") a", false)          → false   // 対応の無い閉じ括弧
/// ```
fn expression(p: &mut Parser<'_>, stop_at_keyword: bool) -> bool {
    expression_with(p, |p, any| any && stop_at_keyword && p.at(KEYWORD))
}

/// 式（段階 A）を、括弧の外の `stops` のキーワードの手前まで読む（`expression` と同じく、`;`・`{`・`}`・対応の無い閉じ括弧でも止まる）。
/// 何か読んだら true。継起のガード（`if g then b`）・送る相手（`send x to y`）のように、キーワードで区切られた式に使う。
///
/// # 引数
///
/// - `p`：式の頭にいるパーサ
/// - `stops`：括弧の外で着いたら止まるキーワード（式の先頭でも止まる）
///
/// # 戻り値
///
/// 1 つ以上のトークンを読んだら `true`。何も読まなかったら `false`（節も作らない）。
///
/// # 例
///
/// ```text
/// expression_until("x > 0 and y then b;", &["then"]) → true（EXPRESSION は "x > 0 and y"）
/// expression_until("f(a then b) then c", &["then"])  → true（括弧の中の then では止まらない）
/// expression_until("then b;", &["then"])             → false
/// ```
fn expression_until(p: &mut Parser<'_>, stops: &[&str]) -> bool {
    expression_with(p, |p, _| stops.iter().any(|k| p.at_kw(k)))
}

/// 式（段階 A）を読む本体。`;`・`{`・`}`・末尾・対応の無い閉じ括弧、改行の後の新しい要素の頭、括弧の外で `stop` が真になる所の手前で止まる。
/// ただし式の中の本体（`a->collect{in i; i * 2}` の `{ … }`、BodyExpression）は、対応する `}` まで式として読む。
///
/// 開いた括弧が閉じないまま止まったら「括弧が閉じていません」を置く。読んだトークンは `EXPRESSION` の節にする。
///
/// # 引数
///
/// - `p`：式の頭にいるパーサ
/// - `stop`：括弧の外の今のトークンで止まるか（2 つ目の引数は、ここまでに何か読んだか）
///
/// # 戻り値
///
/// 1 つ以上のトークンを読んだら `true`。何も読まなかったら `false`（節も作らない）。
///
/// # 例
///
/// ```text
/// expression_with("a + b;", |_, _| false)          → true（EXPRESSION は "a + b"）
/// expression_with("a->collect{in i; i};", |_, _| false) → true（EXPRESSION は "a->collect{in i; i}"）
/// expression_with("to y;", |p, _| p.at_kw("to"))   → false
/// ```
fn expression_with(p: &mut Parser<'_>, stop: impl Fn(&Parser<'_>, bool) -> bool) -> bool {
    let m = p.start();
    let mut depth = 0usize;
    let mut any = false;
    loop {
        if p.at(L_BRACE) && body_expression_follows(p) {
            expression_body(p);
            any = true;
            continue;
        }
        if p.at_eof() || p.at(SEMI) || p.at(L_BRACE) || p.at(R_BRACE) {
            break;
        }
        if depth == 0 && any && p.newline_before() && at_member_start(p) {
            break;
        }
        if depth == 0 && stop(p, any) {
            break;
        }
        match p.current() {
            L_PAREN | L_BRACK => depth += 1,
            R_PAREN | R_BRACK if depth == 0 => break,
            R_PAREN | R_BRACK => depth -= 1,
            _ => {}
        }
        p.bump();
        any = true;
    }
    if depth > 0 {
        p.error_after_previous("括弧が閉じていません");
    }
    if any {
        m.complete(p, EXPRESSION);
    } else {
        m.abandon();
    }
    any
}

/// 今の `{` が、式の中の本体（KerML 8.2.5 の BodyExpression）の始まりか。読み進めない。
///
/// `a->collect{…}`（FunctionOperationExpression の BodyArgument）・`a.{…}`（CollectExpression）・`a.?{…}`（SelectExpression）の
/// `{` だけを本体とみなす。宣言の本体（`part p {`）の `{` はそうしない。
///
/// # 引数
///
/// - `p`：`{` にいるパーサ
///
/// # 戻り値
///
/// 直前が `.`、`.?`、`->` の後の名前なら `true`。
///
/// # 例
///
/// ```text
/// // 直前まで読んだトークンが
/// a . b -> collect   → true
/// a .                → true
/// a . ?              → true
/// part p             → false
/// ```
fn body_expression_follows(p: &Parser<'_>) -> bool {
    match p.behind(1) {
        (DOT, _) => true,
        (OP, "?") => p.behind(2).0 == DOT,
        (IDENT | QUOTED_NAME, _) => p.behind(2) == (OP, "->"),
        _ => false,
    }
}

/// 式の中の本体 `{ … }`（BodyExpression の ExpressionBody、KerML 8.2.5）を、対応する `}` まで式の一部として読む。
/// 中の `;` や入れ子の `{ … }` も読む。閉じていなければ「「{」に対応する「}」がありません」を置く。
///
/// # 引数
///
/// - `p`：本体の開き `{` にいるパーサ
///
/// # 例
///
/// ```text
/// expression_body("{in i; i * 2};") → `{in i; i * 2}` を読む（`;` の手前で止まる）
/// expression_body("{in i; i")       → 末尾まで読み、「「{」に対応する「}」がありません」
/// ```
fn expression_body(p: &mut Parser<'_>) {
    let mut depth = 0usize;
    while !p.at_eof() {
        match p.current() {
            L_BRACE => depth += 1,
            R_BRACE => depth = depth.saturating_sub(1),
            _ => {}
        }
        p.bump();
        if depth == 0 {
            return;
        }
    }
    p.error_after_previous("「{」に対応する「}」がありません");
}

/// 対応する開きの無い `)`・`]` を、エラーとして読み飛ばす。
///
/// その 1 トークンを `ERROR` の節にし、「対応する括弧がありません」を置く。
///
/// # 引数
///
/// - `p`：読み飛ばすトークンにいるパーサ
fn stray(p: &mut Parser<'_>) {
    let e = p.start();
    p.error("対応する括弧がありません");
    p.bump();
    e.complete(p, ERROR);
}

/// 引用名の引用符を外す（`'a b'` → `a b`）。
///
/// `\'` などのエスケープは解かない。
///
/// # 引数
///
/// - `s`：名前のトークンの文字列（基本名か引用名）
///
/// # 戻り値
///
/// 両端が `'` なら外した文字列。そうでなければ `s` をそのまま写したもの。
///
/// # 例
///
/// ```text
/// unquote("'a b'") → "a b"
/// unquote("Engine") → "Engine"
/// unquote("'a")     → "'a"   // 閉じていない
/// ```
fn unquote(s: &str) -> String {
    s.strip_prefix('\'')
        .and_then(|t| t.strip_suffix('\''))
        .unwrap_or(s)
        .to_owned()
}
