// テキストを更新し、解析し直して画面全体を同期する。図の操作も最後は setText を通る（ADR-0001）。

import { CORE_STOPPED, lineOf, type CoreClient, type CoreSupervisorHooks, type Model, type ParseResult, type PlacedDiagnostic, type Problem, type RuleFinding } from "../core";
import { $, esc } from "./dom";
import { errorText } from "./error-text";
import { autoPlace, placeInLanes, placeJunctions, placeNested, placeNotes, placeStates, stackedHeight, stackedWidth } from "./geometry";
import { scheduleRecord } from "./history";
import { renderInspector } from "./inspector";
import { emptyView, type Layout } from "./layout";
import { serializeLayout } from "./layout-file";
import { renderPalette, renderSub, renderTabs, renderTree } from "./panels";
import { droppedDiagnosticsNote, MAX_DIAGNOSTICS } from "../plugins/limits";
import { diagnosticText, findingText, SEVERITY_MARK } from "./plugins";
import { prunePins } from "./pins";
import { LEVEL_MARK, problemLevel } from "./notice-levels";
import type { CopyRow } from "./problem-copy";
import { otherFiles, problemClass, type FileProblems } from "./project-problems";
import { highlight, render } from "./render";
import { S } from "./state";
import { curLayout, curView, syncModelViewKind, VK, viewContent } from "./views";

export interface SetTextOpts {
  /** 変更が始まる位置（カーソル位置の補正に使う）。 */
  changeAt?: number;
  /** 一時的に強調する範囲。 */
  flash?: [number, number] | null;
  /** 元に戻す履歴に積まない。 */
  noHistory?: boolean;
  /** テキストの直接編集による変更（変わった要素を図で光らせる）。 */
  fromText?: boolean;
}

/**
 * テキスト（S.text）を置き換えて、解析・描画・自動保存・履歴を更新する（ADR-0001。図の操作も最後はここを通る）。
 * テキスト欄の中身が違えば書き換え、カーソルとスクロールの位置を保つ（変更位置より後ろのカーソルは長さの差だけずらす）。
 * flash があれば、その範囲を約 1.9 秒光らせる。
 *
 * @param t 新しいテキストの全文
 * @param opts changeAt：変更が始まる位置（UTF-16。省くと 0）、flash：光らせる範囲、noHistory：元に戻す履歴に積まない、fromText：テキストの直接編集による変更（変わった要素を図で光らせる）
 */
export function setText(t: string, opts: SetTextOpts = {}): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  const { selectionStart: a, selectionEnd: b, scrollTop: st, scrollLeft: sl } = ed;
  const old = S.text;
  S.text = t;
  if (ed.value !== t) {
    ed.value = t;
    const d = t.length - old.length, cs = opts.changeAt ?? 0;
    const na = a >= cs ? a + d : a, nb = b >= cs ? b + d : b;
    ed.setSelectionRange(Math.max(0, na), Math.max(0, nb));
    ed.scrollTop = st;
    ed.scrollLeft = sl;
  }
  S.flash = opts.flash ?? null;
  reparse(!!opts.fromText);
  notifyTextChange();
  if (!opts.noHistory) scheduleRecord();
  if (S.flash) {
    setTimeout(() => {
      S.flash = null;
      highlight();
    }, 1900);
  }
}

// ---- コア（Worker）との同期（ADR-0016 §4） ----
let core: CoreClient | null = null;
/** 画面に反映した解析結果の版。 */
let applied = 0;
/** 反映を待っている間に、テキストの直接編集があったか（変わった要素を図で光らせる）。 */
let pendingFromText = false;
let waiters: (() => void)[] = [];

/**
 * 起動時に、Worker で動くコアをつなぐ。以後の解析と図の操作は、このコアに頼む。
 *
 * @param c コアの受け口（Worker とのやり取りを包んだもの）
 */
export function attachCore(c: CoreClient): void {
  core = c;
}

/**
 * つないだコアの受け口を返す。
 *
 * @returns attachCore で渡したコアの受け口。まだつないでいなければ例外（Error「コアがまだつながっていません」）を投げる
 * @example
 * // attachCore(c) の後
 * coreClient() // → c
 * // attachCore の前
 * coreClient() // → Error「コアがまだつながっていません」
 */
export function coreClient(): CoreClient {
  if (!core) throw new Error("コアがまだつながっていません");
  return core;
}

/**
 * コアが返した解析結果のうち、今のテキストの版のものを画面に反映する（`startCore` に渡す）。
 * S.P・S.M・S.findings を置き換えて画面全体を描き直し、settled で待っている処理を進める。
 *
 * @param version 解析したテキストの版（コアの受け口が数える番号）
 * @param P 解析結果
 * @param M 解析結果から組み立てたモデル
 * @param findings チェックルールの結果（プラグインが無ければ空。ADR-0018 §2）
 * 反映した後、onAnalyzedVersion で登録した処理を呼ぶ。
 */
export function onAnalyzed(version: number, P: ParseResult, M: Model, findings: RuleFinding[]): void {
  S.P = P;
  S.M = M;
  S.findings = findings;
  applied = version;
  const fromText = pendingFromText;
  pendingFromText = false;
  refresh(fromText);
  const ws = waiters;
  waiters = [];
  for (const w of ws) w();
  analyzedListener(version);
  projectListener();
}

let analyzedListener: (version: number) => void = () => {};
let projectListener: () => void = () => {};
/**
 * 今の版の解析結果を画面に反映した後に、フォルダのほかのファイルの問題を数え直す処理を登録する（ADR-0021 §6）。前に登録した処理は置き換える。
 *
 * @param fn 反映するたびに呼ばれる処理
 */
export function onAnalyzedProject(fn: () => void): void {
  projectListener = fn;
}
/**
 * 今の版の解析結果を画面に反映した後の処理（v1 のプラグインへの didChange）を登録する。前に登録した処理は置き換える。
 *
 * @param fn 反映した版の番号を受け取って呼ばれる処理
 */
export function onAnalyzedVersion(fn: (version: number) => void): void {
  analyzedListener = fn;
}

/**
 * 今のテキストの解析結果が画面に反映されるまで待つ（操作の直後に、追加した要素を選ぶときなど）。
 * コアがまだつながっていない・既に反映済み・コアをあきらめた（もう解析結果は届かない）なら、すぐに終わる。
 */
export function settled(): Promise<void> {
  if (!core || applied === core.current || coreGaveUp) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

/** コアを作り直すのをあきらめたか（以後、解析結果は届かない。Q-7）。 */
let coreGaveUp = false;

/**
 * コアが止まった・あきらめたときに画面を更新する処理（`superviseCore` に渡す。Q-7）。
 * 止まったら、図の操作をやめたことをトーストで知らせ、同期の表示を読み込み直し中にする（作り直して送り直したテキストの解析結果が届けば、同期済みに戻る）。
 * あきらめたら、同期の表示で再読み込みを案内し、解析結果を待っている処理を進める（テキストの編集と保存は続けられる）。
 */
export const coreHooks: CoreSupervisorHooks = {
  onDown: () => {
    toast(CORE_STOPPED);
    setSync("busy", "図を読み込み直しています…");
  },
  onGaveUp: () => {
    coreGaveUp = true;
    setSync("bad", "図を更新できません。ページを再読み込みしてください");
    toast("図を更新できなくなりました。テキストは保存できます。ページを再読み込みしてください");
    const ws = waiters;
    waiters = [];
    for (const w of ws) w();
  },
};

/**
 * テキスト（S.text）をコアに送って解析を頼む。結果は届いたとき（onAnalyzed）に描き直す。
 * テキストが変わっていなければ（版が反映済みのものと同じなら）、今の結果ですぐに描き直す。
 *
 * @param fromText テキストの直接編集による変更なら true（変わった要素を図で光らせる）
 */
export function reparse(fromText: boolean): void {
  pendingFromText ||= fromText;
  const version = coreClient().sync(S.text);
  if (version !== applied) return;
  pendingFromText = false;
  refresh(fromText);
}

/**
 * 今の解析結果から、画面全体（図・テキストの色付け・問題一覧・インスペクタ・タブ・パレット・ツリー）を描き直す。
 * 消えた要素・線の選択を外し、座標の無い要素を自動で並べ、使われなくなった接続点を片付ける。
 *
 * @param fromText テキストの直接編集による変更なら true（前回から中身が変わった要素を S.pulse に入れて光らせる）
 */
function refresh(fromText: boolean): void {
  syncModelViewKind();
  prunePins();
  const sig = new Map<string, string>();
  for (const n of S.M.nodes) sig.set(n.key, S.text.slice(n.entry.start, n.entry.end));
  S.pulse = new Set();
  if (fromText) for (const [k, v] of sig) if (S.prevSig.get(k) !== v) S.pulse.add(k);
  S.prevSig = sig;
  if (S.sel && !S.M.nodes.some((n) => n.key === S.sel)) S.sel = null;
  if (S.selEdge && !S.M.edges.some((e) => e.id === S.selEdge)) S.selEdge = null;
  ensureLayout();
  highlight();
  render();
  renderProblems();
  renderInspector();
  updateSync();
  renderTabs();
  renderPalette();
  renderTree();
  renderSub();
}

/**
 * 表示中のビューで座標の無い要素を自動で並べる（S.layout を書き換える。F-VIEW-3）。
 * 既に置かれた要素があれば、その一番下から 80 下に並べる。中の部品（内部ブロック図の入れ子）は外の部品の中に縦に積み、
 * n 項の接続の点は、つながる要素の重心に、メモは注釈する要素の近くに置く。幅の狭い要素（アクションの流れの図の記号）は列の中央に置き、
 * アクティビティ図に区画があれば、要素を受け持つ部品の列に置く。
 * 状態遷移の図は、状態の入れ子と遷移の向きで並べる（placeStates）。シーケンス図では何もしない。
 */
export function ensureLayout(): void {
  if (S.view === "seq") return;
  const v = curView();
  if (S.view === "stm") {
    const c = viewContent(S.M, v);
    placeStates(c.nodes, c.edges, c.regions ?? [], curLayout().pos);
    return;
  }
  const { nodes, edges, lanes } = viewContent(S.M, v);
  const L = curLayout().pos;
  const heightOf = (n: (typeof nodes)[number]): number => stackedHeight(n, nodes);
  const missing = nodes.filter((n) => !L[n.key] && !n.junction && !n.container && !n.note);
  if (missing.length) {
    const placed = nodes.flatMap((n) => {
      const p = L[n.key];
      return p && !n.junction && !n.container ? [p[1] + heightOf(n)] : [];
    });
    const oy = placed.length ? Math.max(...placed) + 80 : 0;
    autoPlace(missing, edges, L, v, S.M.phases?.[0] ?? null, oy, heightOf, (n) => stackedWidth(n, nodes));
    // アクティビティ図の区画（swimlane）があれば、置いたばかりの要素を区画の列に置き直す
    if (lanes?.length) placeInLanes(nodes, lanes, L, new Set(missing.map((n) => n.key)));
  }
  placeNested(nodes, L);
  placeJunctions(nodes, edges, L);
  placeNotes(nodes, edges, L);
}

// 確定した配置（配置ファイルの文字列）。自動で置いただけの座標は含めない。
let committed = "";

/**
 * 確定した配置を配置ファイルの文字列で返す（元に戻す履歴が比べるのはこれ）。自動で置いただけの座標は含めない。
 *
 * @returns 最後に loadLayout・notifyLayoutChange・commitLayout したときの配置ファイルの文字列。まだ一度も確定していなければ空文字列
 * @example
 * // loadLayout({}) の後
 * committedLayout() // → '{\n  "modelith": "layout",\n  "format": 1,\n  "views": {}\n}\n'
 */
export function committedLayout(): string {
  return committed;
}

/**
 * 表示する文書の配置にする（文書を切り替えたとき・元に戻したとき）。S.layout を置き換え、確定した配置として記録する。
 * 描き直しは呼び出し側の setText に任せる。
 *
 * @param layout 文書の配置（配置ファイルから読んだもの）
 */
export function loadLayout(layout: Layout): void {
  S.layout = layout;
  committed = serializeLayout(layout);
}

let layoutListener: (layout: string) => void = () => {};
/**
 * 配置が変わったときの処理（ワークスペースへの反映）を登録する。前に登録した処理は置き換える。
 *
 * @param fn 配置が変わるたびに、配置ファイルの文字列を受け取って呼ばれる処理
 */
export function onLayoutChange(fn: (layout: string) => void): void {
  layoutListener = fn;
}

/**
 * 配置が変わったことを知らせる（元に戻したときなど、履歴には積まない）。今の S.layout を確定した配置として記録し、登録した処理に渡す。
 */
export function notifyLayoutChange(): void {
  committed = serializeLayout(S.layout);
  layoutListener(committed);
}

/**
 * 現在の配置を確定する。配置はテキストには書かず、文書の配置ファイルとして持つ（ADR-0005・C-6）。
 * 元に戻す履歴にも積み、描き直す。
 */
export function commitLayout(): void {
  notifyLayoutChange();
  scheduleRecord();
  render();
}

/**
 * 表示中のビューの配置（座標・接続点・線の端）を消して自動で並べ直し、配置を確定する（履歴に積んで描き直す）。
 */
export function relayout(): void {
  S.layout[VK()] = emptyView();
  ensureLayout();
  commitLayout();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * 図の上部に短いメッセージ（トースト）を出し、約 2.4 秒後に消す。続けて出したときは前のメッセージを置き換える。
 *
 * @param msg 出す文（画面の言葉の手引きに従った文）
 */
export function toast(msg: string): void {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
}

/**
 * 失敗をトーストで知らせる。理由はブラウザの英語の文を見せず日本語の文（errorText）にし、詳しい内容（投げられた値）はコンソールに残す（Q-4・Q-6）。
 *
 * @param what できなかったこと（「保存できませんでした」など。句点なし）
 * @param e 投げられた値
 * @example
 * toastFailure("保存できませんでした", new DOMException("…", "NotAllowedError"))
 *   // → トースト「保存できませんでした：フォルダやファイルを編集する許可がありません。…」、コンソールに DOMException
 */
export function toastFailure(what: string, e: unknown): void {
  console.warn(`${what}:`, e);
  toast(`${what}：${errorText(e)}`);
}

let textListener: (text: string) => void = () => {};
/**
 * テキストが変わったときの処理（ワークスペースへの反映）を登録する。前に登録した処理は置き換える。
 *
 * @param fn テキストが変わるたびに、新しいテキストの全文を受け取って呼ばれる処理
 */
export function onTextChange(fn: (text: string) => void): void {
  textListener = fn;
}
/**
 * テキストが変わったことを、登録した処理に今のテキスト（S.text）を渡して知らせる。
 */
export function notifyTextChange(): void {
  textListener(S.text);
}

/**
 * 同期の状態の表示（#sync・#syncText）を書き換える。
 *
 * @param cls 状態の見た目。"" は同期済み、"busy" は処理中、"bad" は問題あり
 * @param txt 表示する文（`同期済み` など）
 */
export function setSync(cls: "" | "busy" | "bad", txt: string): void {
  $("#sync").className = "sync " + cls;
  $("#syncText").textContent = txt;
}

/**
 * 今のモデルから、同期の状態（問題の件数）と、テキスト欄の見出しの要素と関係の数を書き換える。
 * 問題の件数は、エラーの重さのモデルの問題（F-EDIT-11）に、チェックルールと v1 のプラグインの診断のエラーと警告、プラグインについての行を足したもの。
 */
export function updateSync(): void {
  const serious = (s: string): boolean => s === "error" || s === "warning";
  const rules = S.findings.filter((f) => serious(f.severity)).length + currentDiagnostics().filter((d) => serious(d.item.severity)).length;
  const n = S.M.nodes.length, e = S.M.edges.length, p = S.M.problems.filter((x) => problemLevel(x) === "error").length + rules + S.pluginNotes.length;
  setSync(p ? "bad" : "", p ? `同期済み（問題 ${p} 件）` : "同期済み");
  $("#textInfo").textContent = `SysML v2 テキスト：要素 ${n}、関係 ${e}`;
}

/** 問題一覧の 1 行（画面の HTML と、コピーする内容）。own は表示中のファイルの行（ファイル名はコピーするときに決める）。 */
interface ProblemRow {
  html: (copy: number) => string;
  own: boolean;
  path: string | null;
  line: number | null;
  text: string;
}

/** 今の問題一覧の、コピーできる行（一覧に出す上限を超えた分も含む。F-EDIT-13）。 */
let rows: ProblemRow[] = [];

/**
 * 問題一覧の行を、コピーする内容にする（F-EDIT-13）。表示中のファイルの行には、今のファイル名を付ける。
 *
 * @param which 行の番号（無ければすべて）
 * @returns コピーする行（一覧の順。番号が範囲の外なら空）
 * @example
 * // 表示中の app.sysml の 3 行目に問題が 1 件
 * problemCopyRows()  // → [{ path: "app.sysml", line: 3, text: "…" }]
 * problemCopyRows(5) // → []（番号が範囲の外）
 */
export function problemCopyRows(which?: number): CopyRow[] {
  const picked = which === undefined ? rows : rows.slice(which, which + 1);
  return picked.map((r) => ({ path: r.own ? S.docPath : r.path, line: r.line, text: r.text }));
}

/**
 * 問題（構文エラー・参照切れ・チェックルールの結果・v1 のプラグインの診断・プラグインについての行・まだ扱えない構文・トレースの抜け）の一覧を描き直す（F-EDIT-5・F-PLUG-1・F-PLUG-3・F-PLUG-9）。
 * エラー → チェックルールの結果 → プラグインの診断（件数の上限を超えて捨てた分があれば、その知らせを先に）→ プラグインについての行 → まだ扱えない構文 → トレースの抜けの順に、先頭 40 件をボタンにする。
 * テキストの中の位置があるもの（モデルの問題・チェックルールの結果・プラグインの診断）は行番号を付け、押すとその行に移る。
 * トレースの抜けの行には何件目の抜けか（data-gap）を付け、図が見えていれば図の要素へ移れるようにする。
 * 足りないプラグインの行は、押すと追加を始める（data-plugin-add）。
 * 一覧の上に「すべてコピー」を、各行にコピーする行の番号（data-copy）を付ける（F-EDIT-13）。
 */
export function renderProblems(): void {
  // エラーの重さの問題 → まだ扱えない構文 → トレースの抜け、の順に並べる（重さはプロジェクトで選べる。F-EDIT-11）
  const order = (p: Problem): number => (problemLevel(p) === "error" ? 0 : p.kind === "unsupported" ? 1 : 2);
  const sorted = [...S.M.problems].sort((a, b) => order(a) - order(b));
  // トレースの抜けの行には、何件目の抜けか（data-gap）を付ける。押したときに図の要素へ移るため（F-TRACE-2）
  const gapIndex = new Map(S.M.problems.filter((p) => p.kind === "gap").map((p, i) => [p, i]));
  const own = (pos: number, text: string, html: (copy: number) => string): ProblemRow => ({ html, own: true, path: null, line: lineOf(S.text, pos), text });
  const note = (text: string, html: (copy: number) => string): ProblemRow => ({ html, own: false, path: null, line: null, text });
  const model = (p: Problem): ProblemRow =>
    own(p.pos, p.msg, (c) => `<button data-pos="${p.pos}"${gapIndex.has(p) ? ` data-gap="${gapIndex.get(p)}"` : ""} data-copy="${c}" class="${problemClass(p)}">${LEVEL_MARK[problemLevel(p)]} ${lineOf(S.text, p.pos)} 行目：${esc(p.msg)}</button>`);
  const rule = (f: RuleFinding): ProblemRow => {
    const text = findingText(f, S.pluginNames);
    return own(f.pos, text, (c) => `<button data-pos="${f.pos}" data-copy="${c}" class="rule ${f.severity}">${SEVERITY_MARK[f.severity]} ${lineOf(S.text, f.pos)} 行目：${esc(text)}</button>`);
  };
  const notes = S.pluginNotes.map((n) => note(n.msg, (c) => `<button class="plugin"${n.add ? ` data-plugin-add="${esc(n.add)}"` : ""} data-copy="${c}">⚠ ${esc(n.msg)}</button>`));
  const diagnostic = ({ plugin, item }: { plugin: string; item: PlacedDiagnostic }): ProblemRow => {
    const text = diagnosticText(item, S.pluginNames.get(plugin) ?? plugin);
    return own(item.pos, text, (c) => `<button data-pos="${item.pos}" data-copy="${c}" class="rule ${item.severity}">${SEVERITY_MARK[item.severity]} ${lineOf(S.text, item.pos)} 行目：${esc(text)}</button>`);
  };
  const dropped = S.pluginDiagnostics
    .filter((d) => d.version === applied && d.dropped > 0)
    .map((d) => {
      const text = droppedDiagnosticsNote(S.pluginNames.get(d.plugin) ?? d.plugin, d.dropped, MAX_DIAGNOSTICS);
      return note(text, (c) => `<button class="plugin" data-copy="${c}">⚠ ${esc(text)}</button>`);
    });
  const mine = [
    ...sorted.filter((p) => order(p) === 0).map(model),
    ...S.findings.map(rule),
    ...dropped,
    ...currentDiagnostics().map(diagnostic),
    ...notes,
    ...sorted.filter((p) => order(p) > 0).map(model),
  ];
  const fileProblems = otherFiles(S.fileProblems, S.shownPath);
  const others = fileProblems.map((f) => f.rows.map((r): ProblemRow => ({
    html: (c) => `<button data-path="${esc(f.path)}" data-at="${r.pos}" data-copy="${c}" class="${r.cls}">${r.mark} ${r.line} 行目：${esc(r.text)}</button>`,
    own: false,
    path: f.path,
    line: r.line,
    text: r.text,
  })));
  rows = [...mine, ...others.flat()];
  if (!rows.length) {
    $("#problems").innerHTML = "";
    return;
  }
  const head = `<div class="phead"><span>問題 ${rows.length} 件</span><button type="button" class="pcopy" data-levels title="知らせの種類ごとに、エラー・警告・情報・出さないのどれで知らせるかを選ぶ">知らせの重さ…</button><button type="button" class="pcopy" data-copy-all title="一覧のすべての問題を「ファイル名:行: メッセージ」の形でコピーする">すべてコピー</button></div>`;
  let at = mine.length;
  const files = fileProblems.map((f, i) => {
    const html = otherFileHtml(f, (others[i] ?? []).map((r, j) => r.html(at + j)));
    at += f.rows.length;
    return html;
  });
  $("#problems").innerHTML = head + mine.slice(0, 40).map((r, i) => r.html(i)).join("") + files.join("");
}

/** 問題一覧に出す、ほかのファイル 1 つの行の上限（多いファイルで一覧が埋まらないように）。 */
const MAX_FILE_ROWS = 20;

/**
 * 問題一覧の、ほかのファイル 1 つのまとまりの HTML（ADR-0021 §6）。見出しにファイルのパスと件数、その下に行を並べる。
 * 行には data-path と data-at（そのファイルの中の位置）を付け、押すとそのファイルを開いてその行へ移る。問題の無いファイルは出さない。
 *
 * @param f ほかのファイルの問題
 * @param rowsHtml 行の HTML（f.rows の順）
 * @returns まとまりの HTML。行が無ければ ""
 * @example
 * otherFileHtml({ path: "parts.sysml", status: { errors: 1, warnings: 0 }, rows: [r] }, ['<button data-path="parts.sysml" …>⚠ 2 行目：…</button>'])
 * // → '<div class="pfile">parts.sysml<small>エラー 1・警告 0</small></div><button data-path="parts.sysml" …>⚠ 2 行目：…</button>'
 */
function otherFileHtml(f: FileProblems, rowsHtml: readonly string[]): string {
  if (!f.rows.length) return "";
  const head = `<div class="pfile">${esc(f.path)}<small>エラー ${f.status.errors}・警告 ${f.status.warnings}</small></div>`;
  const more = f.rows.length > MAX_FILE_ROWS ? [`<div class="pfile-more">ほか ${f.rows.length - MAX_FILE_ROWS} 件</div>`] : [];
  return head + rowsHtml.slice(0, MAX_FILE_ROWS).join("") + more.join("");
}

/**
 * 画面に反映している版に対する、v1 のプラグインの診断（古い版に対するものは、プラグインが出し直すまで出さない）。
 *
 * @returns プラグインの ID と診断の組（プラグインの順、届いた順）
 * @example
 * // S.pluginDiagnostics が [{ plugin: "jp.x", version: 3, items: [d] }] で、反映している版が 3
 * currentDiagnostics() // → [{ plugin: "jp.x", item: d }]
 * // 反映している版が 4 → []
 */
function currentDiagnostics(): { plugin: string; item: PlacedDiagnostic }[] {
  return S.pluginDiagnostics.filter((d) => d.version === applied).flatMap((d) => d.items.map((item) => ({ plugin: d.plugin, item })));
}
