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
}

/// 開始した節。`complete` か `abandon` で閉じる。
pub(crate) struct Marker {
    event: usize,
    /// 節の先頭のトークン。
    pub token: usize,
}

impl<'t> Parser<'t> {
    pub fn new(input: Vec<Input<'t>>) -> Self {
        Self {
            input,
            pos: 0,
            events: Vec::new(),
        }
    }

    pub fn finish(self) -> Vec<Event> {
        self.events
    }

    // ---- 先読み ----

    pub fn nth(&self, n: usize) -> SyntaxKind {
        self.input
            .get(self.pos + n)
            .map_or(SyntaxKind::ERROR, |t| t.kind)
    }

    pub fn current(&self) -> SyntaxKind {
        self.nth(0)
    }

    pub fn at_eof(&self) -> bool {
        self.pos >= self.input.len()
    }

    pub fn at(&self, kind: SyntaxKind) -> bool {
        !self.at_eof() && self.current() == kind
    }

    pub fn nth_at(&self, n: usize, kind: SyntaxKind) -> bool {
        self.input.get(self.pos + n).is_some_and(|t| t.kind == kind)
    }

    pub fn nth_text(&self, n: usize) -> &'t str {
        self.input.get(self.pos + n).map_or("", |t| t.text)
    }

    /// n 番目がキーワード `kw` か。
    pub fn nth_at_kw(&self, n: usize, kw: &str) -> bool {
        self.nth_at(n, SyntaxKind::KEYWORD) && self.nth_text(n) == kw
    }

    pub fn at_kw(&self, kw: &str) -> bool {
        self.nth_at_kw(0, kw)
    }

    /// n 番目が名前（基本名・引用名）か。
    pub fn nth_at_name(&self, n: usize) -> bool {
        self.nth_at(n, SyntaxKind::IDENT) || self.nth_at(n, SyntaxKind::QUOTED_NAME)
    }

    pub fn at_name(&self) -> bool {
        self.nth_at_name(0)
    }

    /// 今のトークンの前に改行があるか。
    pub fn newline_before(&self) -> bool {
        self.input.get(self.pos).is_some_and(|t| t.newline_before)
    }

    /// 今のトークンの位置（入力の何番目か）。
    pub fn position(&self) -> usize {
        self.pos
    }

    // ---- 読み進める ----

    pub fn bump(&mut self) {
        if !self.at_eof() {
            self.pos += 1;
            self.events.push(Event::Token);
        }
    }

    pub fn eat(&mut self, kind: SyntaxKind) -> bool {
        if self.at(kind) {
            self.bump();
            true
        } else {
            false
        }
    }

    pub fn eat_kw(&mut self, kw: &str) -> bool {
        if self.at_kw(kw) {
            self.bump();
            true
        } else {
            false
        }
    }

    // ---- 節とエラー ----

    pub fn start(&mut self) -> Marker {
        let event = self.events.len();
        self.events.push(Event::Tombstone);
        Marker {
            event,
            token: self.pos,
        }
    }

    pub fn error_at(&mut self, at: ErrorAt, message: impl Into<String>) {
        self.events.push(Event::Error {
            at,
            message: message.into(),
        });
    }

    /// 今のトークンの先頭にエラーを置く（末尾ならファイルの末尾）。
    pub fn error(&mut self, message: impl Into<String>) {
        self.error_at(ErrorAt::Start(self.pos), message);
    }

    /// 直前に読んだトークンの末尾にエラーを置く。
    pub fn error_after_previous(&mut self, message: impl Into<String>) {
        let at = self
            .pos
            .checked_sub(1)
            .map_or(ErrorAt::Start(0), ErrorAt::End);
        self.error_at(at, message);
    }
}

impl Marker {
    pub fn complete(self, p: &mut Parser<'_>, kind: SyntaxKind) {
        if let Some(e) = p.events.get_mut(self.event) {
            *e = Event::Start { kind };
        }
        p.events.push(Event::Finish);
    }

    /// 節を作らずに捨てる。中のトークンは親の節に入る。
    pub fn abandon(self) {}
}
