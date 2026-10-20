// テキストの語の説明を画面に出す（F-EDIT-9）。語の表と探し方は glossary.ts。
// 広い画面では、語にマウスを乗せるとツールチップを出し、カーソルのある語の説明をテキストの下の 1 行（#wordLine）に出す。

import { $ } from "./dom";
import { explainAt, type WordHelp } from "./glossary";
import { S } from "./state";

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

/**
 * テキストの下の 1 行（#wordLine）に、位置にある語の説明を出す。説明の無い位置なら空にする（行は隠れる）。
 *
 * @param offset テキストの位置（UTF-16 の位置）
 */
export function showLineFor(offset: number): void {
  const line = $("#wordLine");
  const help = explainAt(S.text, offset);
  if (help) writeHelp(line, help);
  else line.replaceChildren();
}

/**
 * 語の説明をテキスト欄につなぐ。起動時に 1 回呼ぶ。マウスを語に乗せるとツールチップを出し、
 * クリック・キー操作でカーソルを動かすとカーソルのある語の説明を下の行に出す。テキスト欄を離れたら行を空にする。
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
  ed.addEventListener("blur", () => $("#wordLine").replaceChildren());
}
