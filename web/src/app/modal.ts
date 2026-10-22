// モーダルのダイアログの開け閉め（Q-8）。開いている間は背景を操作できなくし（inert）、Tab をダイアログの中で回し、
// 閉じたら開く前に入力を受け取っていた要素へ入力を戻す。

import { wrapFocus } from "./keyboard";

/** 開いているダイアログごとの、閉じる操作（同じダイアログを二重に開いても、背景の状態を 1 回だけ覚える）。 */
const opened = new Map<HTMLElement, () => void>();

/**
 * Tab で入力を受け取れる、ダイアログの中の要素。選んでいないラジオボタンは、同じ組の選んだものに Tab が止まるので数えない。
 *
 * @param box ダイアログ
 * @returns 文書の順に並べた要素（隠れているもの・押せないものを除く）
 * @example
 * // <div id="dialog"><input><button>OK</button><button hidden>…</button></div>
 * focusables(box) // → [input, button(OK)]
 */
function focusables(box: HTMLElement): HTMLElement[] {
  const all = box.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], summary, [tabindex]:not([tabindex="-1"])');
  return [...all].filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false;
    if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked) return false;
    return el.getClientRects().length > 0;
  });
}

/**
 * 入力を戻す先を決めて、そこへ入力を移す。閉じたメニューの中の項目からダイアログを開いたときは、そのメニューの見出しへ戻す。
 * 戻す先が畳んだパネル（狭い画面の ☰ のメニューなど）の中にあって見えなければ、そのパネルを開くボタン（aria-controls）へ戻す。
 * 戻す先が画面から消えていれば何もしない。
 *
 * @param opener ダイアログを開く前に入力を受け取っていた要素（無ければ null）
 */
function restoreFocus(opener: HTMLElement | null): void {
  if (!opener?.isConnected) return;
  const menu = opener.closest("details:not([open])");
  const target = menu?.querySelector<HTMLElement>(":scope > summary") ?? opener;
  if (target.getClientRects().length === 0) {
    for (let el = target.parentElement; el; el = el.parentElement) {
      const control = el.id ? document.querySelector<HTMLElement>(`[aria-controls="${el.id}"]`) : null;
      if (control) return control.focus();
    }
  }
  target.focus();
}

/**
 * モーダルのダイアログを開く。背景（body のほかの子要素）を inert にして押せなくし、Tab と Shift+Tab をダイアログの中で回す。
 * 背景の inert は、開く前の値を覚えて、閉じるときに戻す（開いているファイルが無いときの inert などを壊さない）。
 * ダイアログの上に重ねて開くときは、開くダイアログ自身が下のダイアログの背景として inert になっているので、開いている間だけ外す。
 * 入力の置き場所は呼び出し側が決める（開いた後に、ダイアログの中の要素へ移す）。
 *
 * @param box ダイアログ（body の直下の .modal）
 * @returns ダイアログを閉じる操作。隠して背景の inert を戻し、開く前の要素へ入力を戻す。2 回目以降の呼び出しは何もしない
 * @example
 * const close = openModal($("#modal")); // 背景が inert になる
 * close();                              // 背景が元に戻り、開いたボタンへ入力が戻る
 */
export function openModal(box: HTMLElement): () => void {
  const already = opened.get(box);
  if (already) return already;
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const background = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== box);
  const wasInert = background.map((el) => el.inert);
  const boxWasInert = box.inert;
  for (const el of background) el.inert = true;
  box.inert = false;
  // 入力がダイアログの外（body など）にあっても拾えるよう、文書で受ける。重ねて開いたときは一番上のダイアログだけが回す
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== "Tab" || [...opened.keys()].at(-1) !== box) return;
    const items = focusables(box);
    const active = document.activeElement;
    const next = wrapFocus(items.length, active instanceof HTMLElement ? items.indexOf(active) : -1, ev.shiftKey);
    if (next === null) return;
    ev.preventDefault();
    items[next]?.focus();
  };
  document.addEventListener("keydown", onKey);
  box.hidden = false;
  const close = (): void => {
    if (opened.get(box) !== close) return;
    opened.delete(box);
    box.hidden = true;
    document.removeEventListener("keydown", onKey);
    background.forEach((el, i) => (el.inert = wasInert[i] ?? false));
    box.inert = boxWasInert;
    restoreFocus(opener);
  };
  opened.set(box, close);
  return close;
}
