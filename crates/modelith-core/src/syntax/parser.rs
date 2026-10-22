//! 再帰下降の土台。文法（`grammar`）は、この型の操作だけでトークンを読み、木を組むイベントを出す。
//! 木そのものは作らない（rust-analyzer と同じ方式。ADR-0015）。

use super::kind::SyntaxKind;

/// パーサが読むトークン（空白・注記を除いたもの）。
#[derive(Debug, Clone, Copy)]
pub(crate) struct Input<'t> {
    pub kind: SyntaxKind,
    pub text: &'t str,
    /// 直前に改行があるか（`;` の書き忘れから立ち直るために使う）。
    pub newline_before: bool,
}

/// エラーの位置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ErrorAt {
    /// そのトークンの先頭。
    Start(usize),
    /// そのトークンの末尾。
    End(usize),
}

/// 木を組むイベント。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Event {
    Start {
        kind: SyntaxKind,
    },
    Token,
    Finish,
    Error {
        at: ErrorAt,
        message: String,
    },
    /// 捨てた `Start`。
    Tombstone,
}

pub(crate) struct Parser<'t> {
    input: Vec<Input<'t>>,
    pos: usize,
    events: Vec<Event>,
    /// 今読んでいるブロック `{ … }` の入れ子の深さ。
    pub depth: usize,
}

/// 開始した節。`complete` か `abandon` で閉じる。
pub(crate) struct Marker {
    event: usize,
    /// 節の先頭のトークン。
    pub token: usize,
}

impl<'t> Parser<'t> {
    /// 入力の先頭から読むパーサを作る（イベントは空、ブロックの深さは 0）。
    ///
    /// # 引数
    ///
    /// - `input`：パーサが読むトークン（空白・注記を除いたもの。空でもよい）
    ///
    /// # 戻り値
    ///
    /// 位置 0 のパーサ。
    ///
    /// # 例
    ///
    /// ```text
    /// Parser::new(vec![]).at_eof()          → true
    /// Parser::new([part, a, ;]).position()  → 0
    /// ```
    pub fn new(input: Vec<Input<'t>>) -> Self {
        Self {
            input,
            pos: 0,
            events: Vec::new(),
            depth: 0,
        }
    }

    /// 読み終えたパーサから、木を組むイベントを取り出す。
    ///
    /// # 戻り値
    ///
    /// これまでに出したイベント（出した順）。捨てた節は `Tombstone` のまま残る。
    ///
    /// # 例
    ///
    /// ```text
    /// // start → bump → complete(PART_USAGE) の後
    /// finish() → [Start { kind: PART_USAGE }, Token, Finish]
    /// Parser::new(vec![]).finish() → []
    /// ```
    pub fn finish(self) -> Vec<Event> {
        self.events
    }

    // ---- 先読み ----

    /// 今の位置から `n` 個先のトークンの種類を見る（読み進めない）。
    ///
    /// # 引数
    ///
    /// - `n`：今の位置からの距離（0 が今のトークン）
    ///
    /// # 戻り値
    ///
    /// トークンの種類。入力の末尾を越えるときは `SyntaxKind::ERROR`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part(KEYWORD), a(IDENT)]、位置 0
    /// nth(1) → IDENT
    /// nth(2) → ERROR   // 末尾を越える
    /// ```
    pub fn nth(&self, n: usize) -> SyntaxKind {
        self.input
            .get(self.pos + n)
            .map_or(SyntaxKind::ERROR, |t| t.kind)
    }

    /// 今のトークンの種類を見る（`nth(0)`）。
    ///
    /// # 戻り値
    ///
    /// トークンの種類。入力の末尾にいるときは `SyntaxKind::ERROR`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part(KEYWORD)]
    /// current() → KEYWORD     // 位置 0
    /// current() → ERROR       // 位置 1（末尾）
    /// ```
    pub fn current(&self) -> SyntaxKind {
        self.nth(0)
    }

    /// 入力の末尾まで読んだか。
    ///
    /// # 戻り値
    ///
    /// 今の位置が入力の数以上なら `true`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part]
    /// at_eof() → false   // 位置 0
    /// at_eof() → true    // 位置 1
    /// ```
    pub fn at_eof(&self) -> bool {
        self.pos >= self.input.len()
    }

    /// 今のトークンが種類 `kind` か。
    ///
    /// # 引数
    ///
    /// - `kind`：比べるトークンの種類
    ///
    /// # 戻り値
    ///
    /// 一致すれば `true`。入力の末尾では、`kind` が `ERROR` でも `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [;]
    /// at(SEMI)  → true    // 位置 0
    /// at(ERROR) → false   // 位置 1（末尾）
    /// ```
    pub fn at(&self, kind: SyntaxKind) -> bool {
        !self.at_eof() && self.current() == kind
    }

    /// 今の位置から `n` 個先のトークンが種類 `kind` か。
    ///
    /// # 引数
    ///
    /// - `n`：今の位置からの距離（0 が今のトークン）
    /// - `kind`：比べるトークンの種類
    ///
    /// # 戻り値
    ///
    /// 一致すれば `true`。末尾を越えるときは `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part(KEYWORD), a(IDENT)]、位置 0
    /// nth_at(1, IDENT) → true
    /// nth_at(2, ERROR) → false   // 末尾を越える
    /// ```
    pub fn nth_at(&self, n: usize, kind: SyntaxKind) -> bool {
        self.input.get(self.pos + n).is_some_and(|t| t.kind == kind)
    }

    /// 今の位置から `n` 個先のトークンの文字列を見る。
    ///
    /// # 引数
    ///
    /// - `n`：今の位置からの距離（0 が今のトークン）
    ///
    /// # 戻り値
    ///
    /// トークンの文字列（入力のテキストの一部）。末尾を越えるときは空文字列。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part, a]、位置 0
    /// nth_text(1) → "a"
    /// nth_text(5) → ""
    /// ```
    pub fn nth_text(&self, n: usize) -> &'t str {
        self.input.get(self.pos + n).map_or("", |t| t.text)
    }

    /// 今の位置から `n` 個前に読んだトークン（1 が直前のトークン）。読み進めない。
    ///
    /// # 引数
    ///
    /// - `n`：今の位置から戻る数（1 以上）
    ///
    /// # 戻り値
    ///
    /// トークンの種類と文字列。入力の先頭より前なら `(ERROR, "")`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [a(IDENT), ->(OP), b(IDENT)]、位置 3
    /// behind(1) → (IDENT, "b")
    /// behind(2) → (OP, "->")
    /// behind(4) → (ERROR, "")   // 先頭より前
    /// ```
    pub fn behind(&self, n: usize) -> (SyntaxKind, &'t str) {
        self.pos
            .checked_sub(n)
            .and_then(|i| self.input.get(i))
            .map_or((SyntaxKind::ERROR, ""), |t| (t.kind, t.text))
    }

    /// n 番目がキーワード `kw` か。
    ///
    /// # 引数
    ///
    /// - `n`：今の位置からの距離（0 が今のトークン）
    /// - `kw`：キーワードの文字列（`"part"` など）
    ///
    /// # 戻り値
    ///
    /// 種類が `KEYWORD` で文字列が `kw` と等しければ `true`。同じ綴りの名前（`IDENT`）や末尾の先では `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part(KEYWORD), def(KEYWORD)]、位置 0
    /// nth_at_kw(1, "def")  → true
    /// nth_at_kw(0, "def")  → false
    /// nth_at_kw(2, "def")  → false   // 末尾を越える
    /// ```
    pub fn nth_at_kw(&self, n: usize, kw: &str) -> bool {
        self.nth_at(n, SyntaxKind::KEYWORD) && self.nth_text(n) == kw
    }

    /// 今のトークンがキーワード `kw` か（`nth_at_kw(0, kw)`）。
    ///
    /// # 引数
    ///
    /// - `kw`：キーワードの文字列（`"part"` など）
    ///
    /// # 戻り値
    ///
    /// 今のトークンがそのキーワードなら `true`。末尾では `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part(KEYWORD)]、位置 0
    /// at_kw("part") → true
    /// at_kw("port") → false
    /// ```
    pub fn at_kw(&self, kw: &str) -> bool {
        self.nth_at_kw(0, kw)
    }

    /// n 番目が名前（基本名・引用名）か。
    ///
    /// # 引数
    ///
    /// - `n`：今の位置からの距離（0 が今のトークン）
    ///
    /// # 戻り値
    ///
    /// 種類が `IDENT` か `QUOTED_NAME` なら `true`。キーワードや末尾の先では `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part(KEYWORD), 'a b'(QUOTED_NAME)]、位置 0
    /// nth_at_name(1) → true
    /// nth_at_name(0) → false   // キーワード
    /// ```
    pub fn nth_at_name(&self, n: usize) -> bool {
        self.nth_at(n, SyntaxKind::IDENT) || self.nth_at(n, SyntaxKind::QUOTED_NAME)
    }

    /// 今のトークンが名前（基本名・引用名）か（`nth_at_name(0)`）。
    ///
    /// # 戻り値
    ///
    /// 今のトークンが `IDENT` か `QUOTED_NAME` なら `true`。末尾では `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [Engine(IDENT)]
    /// at_name() → true    // 位置 0
    /// at_name() → false   // 位置 1（末尾）
    /// ```
    pub fn at_name(&self) -> bool {
        self.nth_at_name(0)
    }

    /// 今のトークンの前に改行があるか。
    ///
    /// 直前の意味のあるトークンとの間（空白・注記・読み飛ばしたコメント）に `\n` があるかを見る。
    ///
    /// # 戻り値
    ///
    /// 改行があれば `true`。入力の末尾では `false`。
    ///
    /// # 例
    ///
    /// ```text
    /// // "part b : B\n    part c" の 2 つ目の part の位置
    /// newline_before() → true
    /// // "part a" の a の位置
    /// newline_before() → false
    /// ```
    pub fn newline_before(&self) -> bool {
        self.input.get(self.pos).is_some_and(|t| t.newline_before)
    }

    /// 今のトークンの位置（入力の何番目か）。
    ///
    /// # 戻り値
    ///
    /// 0 始まりの番号（バイトではない）。末尾まで読んだら入力の数。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [part, a]
    /// position() → 0      // 読み始め
    /// position() → 2      // bump を 2 回した後（末尾）
    /// ```
    pub fn position(&self) -> usize {
        self.pos
    }

    // ---- 読み進める ----

    /// 今のトークンを読み進め、`Token` のイベントを出す。末尾では何もしない。
    pub fn bump(&mut self) {
        if !self.at_eof() {
            self.pos += 1;
            self.events.push(Event::Token);
        }
    }

    /// 今のトークンが種類 `kind` なら読み進める（`Token` のイベントを出す）。
    ///
    /// # 引数
    ///
    /// - `kind`：読みたいトークンの種類
    ///
    /// # 戻り値
    ///
    /// 読み進めたら `true`。種類が違うか末尾なら `false`（位置は変えない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [;]、位置 0
    /// eat(SEMI)  → true（位置 1 へ）
    /// eat(COMMA) → false（位置 0 のまま）
    /// ```
    pub fn eat(&mut self, kind: SyntaxKind) -> bool {
        if self.at(kind) {
            self.bump();
            true
        } else {
            false
        }
    }

    /// 今のトークンがキーワード `kw` なら読み進める（`Token` のイベントを出す）。
    ///
    /// # 引数
    ///
    /// - `kw`：読みたいキーワードの文字列（`"def"` など）
    ///
    /// # 戻り値
    ///
    /// 読み進めたら `true`。違うキーワード・名前・末尾なら `false`（位置は変えない）。
    ///
    /// # 例
    ///
    /// ```text
    /// // 入力 [def(KEYWORD)]、位置 0
    /// eat_kw("def") → true（位置 1 へ）
    /// eat_kw("ref") → false
    /// ```
    pub fn eat_kw(&mut self, kw: &str) -> bool {
        if self.at_kw(kw) {
            self.bump();
            true
        } else {
            false
        }
    }

    // ---- 節とエラー ----

    /// 節を開始する。種類の決まっていない `Tombstone` のイベントを置き、後で `Marker::complete` が種類を書き込む。
    ///
    /// # 戻り値
    ///
    /// 開始した節の印（置いたイベントの番号と、今のトークンの位置を持つ）。
    ///
    /// # 例
    ///
    /// ```text
    /// // イベントが 3 個、位置 5 のとき
    /// start() → Marker { event: 3, token: 5 }（イベントに Tombstone が足される）
    /// ```
    pub fn start(&mut self) -> Marker {
        let event = self.events.len();
        self.events.push(Event::Tombstone);
        Marker {
            event,
            token: self.pos,
        }
    }

    /// 位置 `at` にエラーを置く（`Error` のイベントを出す。読み進めない）。
    ///
    /// # 引数
    ///
    /// - `at`：エラーの位置（意味のあるトークンの番号と、その先頭か末尾か）
    /// - `message`：画面に出すエラーの文言
    pub fn error_at(&mut self, at: ErrorAt, message: impl Into<String>) {
        self.events.push(Event::Error {
            at,
            message: message.into(),
        });
    }

    /// 今のトークンの先頭にエラーを置く（末尾ならファイルの末尾）。読み進めない。
    ///
    /// # 引数
    ///
    /// - `message`：画面に出すエラーの文言
    pub fn error(&mut self, message: impl Into<String>) {
        self.error_at(ErrorAt::Start(self.pos), message);
    }

    /// 直前に読んだトークンの末尾にエラーを置く（まだ何も読んでいなければテキストの先頭）。
    ///
    /// `;` の書き忘れを、次の行の頭ではなく書き忘れた行の末尾で知らせるために使う。
    ///
    /// # 引数
    ///
    /// - `message`：画面に出すエラーの文言
    pub fn error_after_previous(&mut self, message: impl Into<String>) {
        let at = self
            .pos
            .checked_sub(1)
            .map_or(ErrorAt::Start(0), ErrorAt::End);
        self.error_at(at, message);
    }
}

impl Marker {
    /// 節を種類 `kind` で閉じる。開始時の `Tombstone` を `Start { kind }` に書き換え、`Finish` を出す。
    ///
    /// # 引数
    ///
    /// - `p`：この節を開始したパーサ
    /// - `kind`：節の種類（`PART_USAGE` など）
    pub fn complete(self, p: &mut Parser<'_>, kind: SyntaxKind) {
        if let Some(e) = p.events.get_mut(self.event) {
            *e = Event::Start { kind };
        }
        p.events.push(Event::Finish);
    }

    /// 節を作らずに捨てる。中のトークンは親の節に入る。
    pub fn abandon(self) {}
}
