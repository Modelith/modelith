//! SysML v2 のテキスト記法の文法（段階 A、ADR-0015）。
//!
//! 規則は SysML v2 の BNF（8.2.2）に沿うが、段階 A では宣言の頭（種類・名前・型付けなどの関係）だけを
//! 文法として読み、式は括弧の釣り合いで区切った `EXPRESSION` として持つ。
//! どの入力でも止まらず、読めない部分は `ERROR` か `UNSUPPORTED_MEMBER` に入れて続きを読む。

use super::kind::SyntaxKind::{self, *};
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
/// 読み進めない。`event occurrence`・`use case` は 2 語で 1 つの種類とする。
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
    "dependency",
    "derived",
    "doc",
    "entry",
    "enum",
    "exhibit",
    "exit",
    "expose",
    "filter",
    "frame",
    "import",
    "include",
    "individual",
    "inout",
    "interface",
    "item",
    "language",
    "library",
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
    "stakeholder",
    "standard",
    "state",
    "subject",
    "succession",
    "transition",
    "use",
    "variant",
    "variation",
    "verification",
    "verify",
    "view",
    "viewpoint",
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
    loop {
        if p.at(HASH) && p.nth_at_name(1) {
            let pm = p.start();
            p.bump();
            reference(p);
            pm.complete(p, PREFIX_METADATA);
            extended = true;
        } else if p.at(KEYWORD) && PREFIX_KEYWORDS.contains(&p.nth_text(0)) {
            p.bump();
        } else {
            break;
        }
        prefixed = true;
    }
    let owner = m.token;

    if let Some((n, def, usage)) = kind_keyword(p, 0) {
        for _ in 0..n {
            p.bump();
        }
        let is_def = p.eat_kw("def");
        let kind = if is_def { def } else { usage };
        if kind == METADATA_KEYWORD_USAGE {
            metadata_usage_tail(p, owner);
        } else {
            declaration(p, owner, true, is_def);
        }
        m.complete(p, kind);
        return;
    }
    if extended && p.at_kw("def") {
        // `#X def H;`：利用者定義のキーワードで書く定義（ExtendedDefinition、8.2.2.27）
        p.bump();
        declaration(p, owner, true, true);
        m.complete(p, EXTENDED_DEFINITION);
        return;
    }
    if p.at(KEYWORD) {
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
        m.complete(p, REFERENCE_USAGE);
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
/// keyword_member("send x via p;")      → UNSUPPORTED_MEMBER   // 文法を持たない文
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
            declaration(p, owner, false, false);
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
            if let Some((n, _, usage)) = kind_keyword(p, 0) {
                // `then action a;`・`then message …;` は、その種類の使用として読む
                for _ in 0..n {
                    p.bump();
                }
                declaration(p, owner, true, false);
                usage
            } else {
                declaration(p, owner, false, false);
                SUCCESSION_AS_USAGE
            }
        }
        "first" => {
            declaration(p, owner, false, false);
            SUCCESSION_AS_USAGE
        }
        "bind" => {
            p.bump();
            declaration(p, owner, false, false);
            BINDING_CONNECTOR_AS_USAGE
        }
        "connect" => {
            p.bump();
            declaration(p, owner, false, false);
            CONNECTION_USAGE
        }
        "allocate" => {
            p.bump();
            declaration(p, owner, false, false);
            ALLOCATION_USAGE
        }
        _ => {
            // 段階 A では文法を持たない文。黙って捨てず、節として残す（F-EDIT-8）
            p.bump();
            declaration(p, owner, false, false);
            UNSUPPORTED_MEMBER
        }
    }
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
/// 今のトークンが関係の記号（`:`・`:>`・`:>>`・`::>`）か、名前の次が関係の記号・`=`・`:=`・`;`・`[`・`{`・
/// `<名前>`・関係のキーワード（`redefines` など）なら `true`。それ以外（式など）は `false`。
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
            "redefines" | "subsets" | "references" | "defined" | "specializes" | "default"
        ),
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
    let name = declaration_tail(p, named, is_def);
    end(p, owner, &name, true);
    name
}

/// 宣言の名前より後ろを、終わり（`;`・`{`・`}`・末尾）の手前まで読む。終わりそのものは読まない。
///
/// 改行の後に新しい要素の頭のキーワードが来たら、`;` の書き忘れとみなしてそこで止める。
///
/// # 引数
///
/// - `p`：種類のキーワードの直後にいるパーサ
/// - `named`：最初の名前を新しい要素の名前（`NAME`）として読むか。名前の後ろが `.`・`::`・`to` なら参照として読む
/// - `is_def`：定義か。真なら `:>` を `SUBCLASSIFICATION`、偽なら `SUBSETTING` にする
///
/// # 戻り値
///
/// 読んだ名前（引用名は引用符を外す）。名前が無いときは空文字列。
///
/// # 例
///
/// ```text
/// declaration_tail("<P1> Engine :> Base {", true, true) → "Engine"（<P1> は SHORT_NAME）
/// declaration_tail("kettle.heater;", true, false)       → ""（特徴の連鎖は参照）
/// declaration_tail("b : B\n    part c : C;", true, false) → "b"（改行の後の part の手前で止まる）
/// ```
fn declaration_tail(p: &mut Parser<'_>, named: bool, is_def: bool) -> String {
    let mut name = String::new();
    let mut name_slot = named;
    let mut first = true;
    loop {
        if p.at_eof() || p.at(SEMI) || p.at(L_BRACE) || p.at(R_BRACE) {
            break;
        }
        if !first && p.newline_before() && at_member_start(p) {
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
            KEYWORD => match p.nth_text(0) {
                "defined" if p.nth_at_kw(1, "by") => relationship(p, 2, FEATURE_TYPING),
                "specializes" => relationship(p, 1, SUBCLASSIFICATION),
                "subsets" => relationship(p, 1, SUBSETTING),
                "redefines" => relationship(p, 1, REDEFINITION),
                "references" => relationship(p, 1, REFERENCE_SUBSETTING),
                "default" => feature_value(p),
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
    let m = p.start();
    let mut depth = 0usize;
    let mut any = false;
    loop {
        if p.at_eof() || p.at(SEMI) || p.at(L_BRACE) || p.at(R_BRACE) {
            break;
        }
        if depth == 0 && any && p.newline_before() && at_member_start(p) {
            break;
        }
        if depth == 0 && any && stop_at_keyword && p.at(KEYWORD) {
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
