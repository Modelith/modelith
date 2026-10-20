// テキストの語の説明を画面に出す（F-EDIT-9・F-EDIT-10）。語の表と探し方は glossary.ts。
// 広い画面では、語にマウスを乗せるとツールチップを出し、カーソルのある語の説明をテキストの下の 1 行（#wordLine）に出す。
// タッチでは、語をダブルタップすると、その語を選んで説明を同じ行に出す（ホバーが無いため）。

import { $ } from "./dom";
import { explainAt, type WordHelp } from "./glossary";
import { highlight } from "./render";
import { S } from "./state";
import { isDoubleTap, isTap, type TouchPoint } from "./tap";

/** マウスを止めてからツールチップを出すまでの時間（ミリ秒）。 */
const TIP_DELAY = 350;

let tipTimer: ReturnType<typeof setTimeout> | undefined;
/** 出しているツールチップの語の範囲（画面の座標）。マウスがこの中にあるうちは出したままにする。 */
let tipRect: DOMRect | null = null;

/**
 * 説明を要素に書く。見出しを太字にし、本文を続ける。
 *
 * @param el 書き込む要素（中身は置き換える）
 * @param help 語の説明
 */
function writeHelp(el: HTMLElement, help: WordHelp): void {
  const title = document.createElement("b");
  title.textContent = help.title;
  el.replaceChildren(title, document.createTextNode(help.text));
}

/**
 * 画面の点にある、テキストの文字の位置を返す。テキスト欄（#ed）と同じ所に同じ文字を描いている色付けの層（#hl）で、
 * 点に最も近い文字の境目を調べる（テキスト欄の中の文字の位置は、ブラウザが教えてくれないため）。
 *
 * @param x 画面の x 座標（clientX）
 * @param y 画面の y 座標（clientY）
 * @returns 文字の位置（UTF-16 の位置）。点が色付けの層の外なら null
 * @example
 * // テキスト "part def A;" の 1 行目、"part" の 2 文字目と 3 文字目の境目の点
 * offsetAtPoint(x, y)  // → 2
 * offsetAtPoint(0, 0)  // → null（ヘッダーの上の点）
 */
export function offsetAtPoint(x: number, y: number): number | null {
  const hl = $("#hl"), ed = $("#ed");
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let node: Node | null = null, offset = 0;
  // 色付けの層はふだんマウスを受けないので、調べる間だけ受けるようにする
  hl.style.pointerEvents = "auto";
  ed.style.pointerEvents = "none";
  try {
    const pos = document.caretPositionFromPoint?.(x, y);
    const range = pos ? null : doc.caretRangeFromPoint?.(x, y);
    node = pos?.offsetNode ?? range?.startContainer ?? null;
    offset = pos?.offset ?? range?.startOffset ?? 0;
  } finally {
    hl.style.pointerEvents = "";
    ed.style.pointerEvents = "";
  }
  if (!node || !hl.contains(node)) return null;
  const before = document.createRange();
  before.setStart(hl, 0);
  before.setEnd(node, offset);
  return before.toString().length;
}

/**
 * テキストの範囲が、色付けの層（#hl）の上で画面のどこに描かれているかを返す。
 *
 * @param start 範囲の始まり（UTF-16 の位置）
 * @param end 範囲の終わり（含まない）
 * @returns 範囲を囲む矩形（画面の座標）。層の文字が範囲に届かなければ null
 * @example
 * rangeRect(0, 4)          // → "part" を囲む矩形（DOMRect）
 * rangeRect(0, 1_000_000)  // → null（テキストより長い範囲）
 */
export function rangeRect(start: number, end: number): DOMRect | null {
  const walker = document.createTreeWalker($("#hl"), NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0, started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0;
    if (!started && start < pos + len) {
      range.setStart(n, start - pos);
      started = true;
    }
    if (started && end <= pos + len) {
      range.setEnd(n, end - pos);
      return range.getBoundingClientRect();
    }
    pos += len;
  }
  return null;
}

/** ツールチップを隠し、出す予定も取り消す。 */
export function hideTip(): void {
  clearTimeout(tipTimer);
  tipTimer = undefined;
  tipRect = null;
  $("#wordTip").hidden = true;
}

/**
 * 点にある語の説明のツールチップを、語のすぐ下（下に入らなければ上）に出す。説明の無い語や、
 * 点が語の上に無い（語の後ろの空白など）ときは隠す。
 *
 * @param x 画面の x 座標（clientX）
 * @param y 画面の y 座標（clientY）
 */
function showTipAt(x: number, y: number): void {
  const offset = offsetAtPoint(x, y);
  const help = offset === null ? null : explainAt(S.text, offset);
  const rect = help ? rangeRect(help.start, help.end) : null;
  if (!help || !rect || x < rect.left - 1 || x > rect.right + 1 || y < rect.top - 1 || y > rect.bottom + 1) {
    hideTip();
    return;
  }
  const tip = $("#wordTip");
  writeHelp(tip, help);
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
  const top = rect.bottom + 4 + h <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 4 - h);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tipRect = rect;
}

/**
 * マウスの動きに合わせてツールチップを出し直す。出している語の上にいるうちはそのまま、離れたら隠して、
 * マウスが止まってから少し待って出す。
 *
 * @param ev テキスト欄の上のポインタの動き（マウスだけを扱う。タッチではホバーが無い）
 */
function onPointerMove(ev: PointerEvent): void {
  if (ev.pointerType !== "mouse") return;
  const r = tipRect;
  if (r && ev.clientX >= r.left - 1 && ev.clientX <= r.right + 1 && ev.clientY >= r.top - 1 && ev.clientY <= r.bottom + 1) return;
  hideTip();
  const { clientX, clientY } = ev;
  tipTimer = setTimeout(() => showTipAt(clientX, clientY), TIP_DELAY);
}

/** 読み取り専用のテキスト（狭い画面）で、説明する語が無いときに出す案内。 */
const TAP_HINT = "語をダブルタップすると、意味を表示します。書き換えるには「編集」を押します。";

/**
 * テキストの下の 1 行（#wordLine）を、説明する語が無いときの中身にする。読み取り専用のテキスト（狭い画面）ならダブルタップの案内を、
 * 編集できるテキストなら空にする（行は隠れる）。テキストの読み取り専用を切り替えたときにも呼ぶ。
 */
export function resetWordLine(): void {
  const line = $("#wordLine");
  if ($<HTMLTextAreaElement>("#ed").readOnly) line.replaceChildren(TAP_HINT);
  else line.replaceChildren();
}

/**
 * テキストの下の 1 行（#wordLine）に、位置にある語の説明を出す。説明の無い位置なら、説明する語が無いときの中身にする。
 *
 * @param offset テキストの位置（UTF-16 の位置）
 */
export function showLineFor(offset: number): void {
  const help = explainAt(S.text, offset);
  if (help) writeHelp($("#wordLine"), help);
  else resetWordLine();
}

/** ダブルタップで語に付けた印（S.textMark）があるか。次に触れたときに外す。 */
let tapMark = false;

/**
 * 点にある語を選び、その説明を下の行に出す（ダブルタップ）。テキスト欄にフォーカスを移して語を選び
 * （読み取り専用ならキーボードは出ない）、選択の見えにくい画面でも分かるよう、色付けの層にも印を付ける。
 *
 * @param x 画面の x 座標（clientX）
 * @param y 画面の y 座標（clientY）
 * @returns 説明のある語を選んだら true。語が無い・説明の無い語なら何もせず false
 * @example
 * // テキスト "part def A;" の "def" の上の点
 * selectWordAt(x, y) // → true（"part def" を選び、「部品定義（part def）」の説明を出す）
 * // 利用者の付けた名前 "A" の上の点
 * selectWordAt(x, y) // → false
 */
function selectWordAt(x: number, y: number): boolean {
  const offset = offsetAtPoint(x, y);
  const help = offset === null ? null : explainAt(S.text, offset);
  if (!help) return false;
  const ed = $<HTMLTextAreaElement>("#ed");
  ed.focus({ preventScroll: true });
  ed.setSelectionRange(help.start, help.end);
  S.textMark = [help.start, help.end];
  tapMark = true;
  highlight();
  writeHelp($("#wordLine"), help);
  return true;
}

/**
 * タッチをつなぐ。指を置いて離すまでがタップなら覚えておき、続くタップがダブルタップなら、その語を選んで説明を出す。
 * 説明する語を選んだときだけ、ブラウザのダブルタップの既定の動き（拡大や、ブラウザによる語の選択）を止める。
 *
 * @param ed テキスト欄
 */
function initDoubleTap(ed: HTMLTextAreaElement): void {
  let start: TouchPoint | null = null;
  let lastTap: TouchPoint | null = null;
  ed.addEventListener("touchstart", (ev) => {
    const t = ev.touches[0];
    start = ev.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, time: ev.timeStamp } : null;
    if (tapMark) {
      tapMark = false;
      S.textMark = null;
      highlight();
    }
  }, { passive: true });
  ed.addEventListener("touchend", (ev) => {
    const t = ev.changedTouches[0];
    const end = t ? { x: t.clientX, y: t.clientY, time: ev.timeStamp } : null;
    if (!start || !end || ev.touches.length > 0 || !isTap(start, end)) {
      lastTap = null;
      return;
    }
    if (lastTap && isDoubleTap(lastTap, end)) {
      lastTap = null;
      if (selectWordAt(end.x, end.y)) ev.preventDefault();
      return;
    }
    lastTap = end;
  });
}

/**
 * 語の説明をテキスト欄につなぐ。起動時に 1 回呼ぶ。マウスを語に乗せるとツールチップを出し、
 * クリック・キー操作でカーソルを動かすとカーソルのある語の説明を下の行に出す。語をダブルタップすると、その語を選んで説明を出す。
 * テキスト欄を離れたら、行を説明する語が無いときの中身に戻す。
 */
export function initWordHelp(): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  ed.addEventListener("pointermove", onPointerMove);
  ed.addEventListener("pointerleave", hideTip);
  ed.addEventListener("pointerdown", hideTip);
  ed.addEventListener("scroll", hideTip);
  ed.addEventListener("keydown", hideTip);
  const atCaret = (): void => showLineFor(ed.selectionStart);
  ed.addEventListener("click", atCaret);
  ed.addEventListener("keyup", atCaret);
  ed.addEventListener("blur", resetWordLine);
  initDoubleTap(ed);
}
