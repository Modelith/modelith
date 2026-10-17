// テキストを更新し、解析し直して画面全体を同期する。図の操作も最後は setText を通る（ADR-0001）。

import { lineOf, type CoreClient, type Model, type ParseResult, type Problem, type RuleFinding } from "../core";
import { $, esc } from "./dom";
import { autoPlace, nodeH } from "./geometry";
import { scheduleRecord } from "./history";
import { renderInspector } from "./inspector";
import { emptyView, type Layout } from "./layout";
import { serializeLayout } from "./layout-file";
import { renderPalette, renderSub, renderTabs, renderTree } from "./panels";
import { findingText, SEVERITY_MARK } from "./plugins";
import { prunePins } from "./pins";
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
}

/**
 * 今のテキストの解析結果が画面に反映されるまで待つ（操作の直後に、追加した要素を選ぶときなど）。
 * コアがまだつながっていない・既に反映済みなら、すぐに終わる。
 */
export function settled(): Promise<void> {
  if (!core || applied === core.current) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

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
 * 既に置かれた要素があれば、その一番下から 80 下に並べる。シーケンス図では何もしない。
 */
export function ensureLayout(): void {
  if (S.view === "seq") return;
  const v = curView();
  const { nodes, edges } = viewContent(S.M, v);
  const L = curLayout().pos;
  const missing = nodes.filter((n) => !L[n.key]);
  if (!missing.length) return;
  const placed = nodes.flatMap((n) => {
    const p = L[n.key];
    return p ? [p[1] + nodeH(n)] : [];
  });
  const oy = placed.length ? Math.max(...placed) + 80 : 0;
  autoPlace(missing, edges, L, v, S.M.phases?.[0] ?? null, oy);
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
 * 問題の件数は、まだ扱えない構文とトレースの抜けを除いた件数に、チェックルールの誤りと注意、プラグインについての行を足したもの。
 */
export function updateSync(): void {
  const rules = S.findings.filter((f) => f.severity === "error" || f.severity === "warning").length;
  const n = S.M.nodes.length, e = S.M.edges.length, p = S.M.problems.filter((x) => !x.kind).length + rules + S.pluginNotes.length;
  setSync(p ? "bad" : "", p ? `同期済み（問題 ${p} 件）` : "同期済み");
  $("#textInfo").textContent = `SysML v2 テキスト：要素 ${n}、関係 ${e}`;
}

/**
 * 問題（構文エラー・参照切れ・チェックルールの結果・プラグインについての行・まだ扱えない構文・トレースの抜け）の一覧を描き直す（F-EDIT-5・F-PLUG-1・F-PLUG-3・F-PLUG-9）。
 * エラー → チェックルールの結果 → プラグインについての行 → まだ扱えない構文 → トレースの抜けの順に、先頭 40 件をボタンにする。
 * テキストの中の位置があるもの（モデルの問題・チェックルールの結果）は行番号を付け、押すとその行に移る。
 * 足りないプラグインの行は、押すと追加を始める（data-plugin-add）。
 */
export function renderProblems(): void {
  // エラー → まだ扱えない構文 → トレースの抜け、の順に並べる
  const order = (k: Problem["kind"]): number => (k === undefined ? 0 : k === "unsupported" ? 1 : 2);
  const sorted = [...S.M.problems].sort((a, b) => order(a.kind) - order(b.kind));
  const mark = { gap: "△", unsupported: "ℹ" } as const;
  const model = (p: Problem): string => `<button data-pos="${p.pos}" class="${p.kind ?? ""}">${p.kind ? mark[p.kind] : "⚠"} ${lineOf(S.text, p.pos)} 行目：${esc(p.msg)}</button>`;
  const rule = (f: RuleFinding): string =>
    `<button data-pos="${f.pos}" class="rule ${f.severity}">${SEVERITY_MARK[f.severity]} ${lineOf(S.text, f.pos)} 行目：${esc(findingText(f, S.pluginNames))}</button>`;
  const notes = S.pluginNotes.map((n) => `<button class="plugin"${n.add ? ` data-plugin-add="${esc(n.add)}"` : ""}>⚠ ${esc(n.msg)}</button>`);
  const items = [
    ...sorted.filter((p) => !p.kind).map(model),
    ...S.findings.map(rule),
    ...notes,
    ...sorted.filter((p) => p.kind).map(model),
  ];
  $("#problems").innerHTML = items.slice(0, 40).join("");
}
