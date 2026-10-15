//! SysML v2 のテキスト記法の文法（段階 A、ADR-0015）。
//!
//! 規則は SysML v2 の BNF（8.2.2）に沿うが、段階 A では宣言の頭（種類・名前・型付けなどの関係）だけを
//! 文法として読み、式は括弧の釣り合いで区切った `EXPRESSION` として持つ。
//! どの入力でも止まらず、読めない部分は `ERROR` か `UNSUPPORTED_MEMBER` に入れて続きを読む。

use super::kind::SyntaxKind::{self, *};
use super::parser::{ErrorAt, Parser};

/// ファイル全体（RootNamespace）。
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
    "variation",
    "verification",
    "verify",
    "view",
    "viewpoint",
];

fn at_member_start(p: &Parser<'_>) -> bool {
    p.at(KEYWORD) && MEMBER_START_KEYWORDS.contains(&p.nth_text(0))
}

/// 要素 1 つ（OwnedMember・PackageMember・DefinitionBodyItem など）。
fn member(p: &mut Parser<'_>) {
    let m = p.start();
    if p.at(REGULAR_COMMENT) {
        p.bump();
        m.complete(p, COMMENT);
        return;
    }
    let mut prefixed = false;
    loop {
        if p.at(HASH) && p.nth_at_name(1) {
            let pm = p.start();
            p.bump();
            reference(p);
            pm.complete(p, PREFIX_METADATA);
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
        declaration(p, owner, true, is_def);
        m.complete(p, kind);
        return;
    }
    if p.at(KEYWORD) {
        let kind = keyword_member(p, owner);
        m.complete(p, kind);
        return;
    }
    if p.at(AT) {
        p.bump();
        if p.at_name() {
            reference(p);
        }
        declaration(p, owner, false, false);
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
        "alias" | "dependency" => {
            p.bump();
            declaration(p, owner, true, false);
            if kw == "alias" { ALIAS } else { DEPENDENCY }
        }
        "perform" => headed(p, owner, &["action"], PERFORM_ACTION_USAGE),
        "exhibit" => headed(p, owner, &["state"], EXHIBIT_STATE_USAGE),
        "include" => headed(p, owner, &["use", "case"], INCLUDE_USE_CASE_USAGE),
        "satisfy" => headed(p, owner, &["requirement"], SATISFY_REQUIREMENT_USAGE),
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

/// `perform action a`・`perform a` のように、後ろに種類のキーワードが続いてもよい頭。
/// 種類のキーワードがあれば、続く名前は新しい要素の名前、無ければ参照として読む（BNF の UsageDeclaration と OwnedReferenceSubsetting）。
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

/// 名前で始まる文が、キーワードの無い使用の宣言か（式ではないか）。
fn is_feature_declaration(p: &Parser<'_>) -> bool {
    if matches!(p.current(), COLON | COLON_GT | COLON_GT2 | COLON2_GT) {
        return true;
    }
    if !p.at_name() {
        return false;
    }
    match p.nth(1) {
        COLON | COLON_GT | COLON_GT2 | COLON2_GT | EQ | COLON_EQ | SEMI | L_BRACK | L_BRACE
        | LT => true,
        KEYWORD => matches!(
            p.nth_text(1),
            "redefines" | "subsets" | "references" | "defined" | "specializes" | "default"
        ),
        _ => false,
    }
}

/// 宣言の名前より後ろ（Identification・FeatureSpecializationPart・MultiplicityPart・ValuePart など）と、終わり（`;` か本体）。
/// `named` のときだけ、先頭の名前を新しい要素の名前として読む。名前を返す。
fn declaration(p: &mut Parser<'_>, owner: usize, named: bool, is_def: bool) -> String {
    let name = declaration_tail(p, named, is_def);
    end(p, owner, &name, true);
    name
}

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
fn comment_tail(p: &mut Parser<'_>, about: bool) {
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

/// `import`・`expose` の対象（`A::B`、`A::*`、`A::**`、`A::*::**`、後ろの `[ … ]`）。
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

/// `= 式`・`:= 式`・`default = 式`。
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

fn qualified_name(p: &mut Parser<'_>) {
    let m = p.start();
    p.bump();
    while p.at(COLON2) && p.nth_at_name(1) {
        p.bump();
        p.bump();
    }
    m.complete(p, QUALIFIED_NAME);
}

/// n 番目から始まる修飾名のトークン数。
fn qualified_name_len(p: &Parser<'_>, n: usize) -> usize {
    let mut i = n + 1;
    while p.nth_at(i, COLON2) && p.nth_at_name(i + 1) {
        i += 2;
    }
    i - n
}

/// `[ … ]`。中は括弧の釣り合いだけで読む。
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
fn stray(p: &mut Parser<'_>) {
    let e = p.start();
    p.error("対応する括弧がありません");
    p.bump();
    e.complete(p, ERROR);
}

/// 引用名の引用符を外す（`'a b'` → `a b`）。
fn unquote(s: &str) -> String {
    s.strip_prefix('\'')
        .and_then(|t| t.strip_suffix('\''))
        .unwrap_or(s)
        .to_owned()
}
