// 画面の上のメニューバー（Q-9）と、開くメニュー（details.menu）の共通の振る舞い（Q-8）。
// 1 つ開いたらほかは閉じ、開いている間はマウスを隣の見出しに乗せる・左右の矢印キーで隣のメニューへ移り、上下の矢印キーで項目を移る。
// 狭い画面では、メニューバーを ☰ のボタン 1 つにまとめ、押すと縦に並べたパネルを開く。移る先の判断は keyboard.ts の純粋関数に置く。

import { $ } from "./dom";
import { nextMenuIndex, nextMenuItem } from "./keyboard";
import { isNarrow } from "./panels";

/** 開いているメニュー（details.menu）をすべて閉じる。 */
export function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

/**
 * メニューバーのメニュー（左から順）を返す。
 *
 * @param bar メニューバー（nav.menubar）
 * @returns メニューバーの直下の details.menu
 * @example
 * menusOf($("#menubar")) // → [#fileMenu, #editMenu, #viewMenu, #diagramMenu, #pluginMenu, #helpMenu]
 */
function menusOf(bar: HTMLElement): HTMLDetailsElement[] {
  return [...bar.querySelectorAll<HTMLDetailsElement>(":scope > details.menu")];
}

/**
 * メニューの項目（上から順）を返す。押せる項目かは、矢印キーで移るときに確かめる。
 *
 * @param menu メニュー
 * @returns メニューの中のボタン・リンク・入力欄（チェックボックス）。項目の無いメニューなら空の配列
 * @example
 * itemsOf($("#editMenu")) // → [#menuUndo, #menuRedo, #menuSelectAll]
 */
function itemsOf(menu: HTMLDetailsElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(":scope > .pop button, :scope > .pop a, :scope > .pop input")];
}

/**
 * 項目を押せるかを返す。無効な項目と、画面に出ていない項目（隠したプラグインのコマンド・狭い画面で隠す項目）は押せない。
 *
 * @param item メニューの項目
 * @returns 押せるなら true
 * @example
 * isUsable($("#btnNew"))        // → true
 * isUsable($("#menuUndo"))      // → false（戻れる版が無く、無効）
 * isUsable(隠したコマンドのボタン) // → false（画面に出ていない）
 */
function isUsable(item: HTMLElement): boolean {
  if ((item as HTMLButtonElement).disabled) return false;
  return item.getClientRects().length > 0;
}

/**
 * メニューを 1 つ開き、ほかに開いているメニューを閉じる。
 *
 * @param menu 開くメニュー
 */
function openOnly(menu: HTMLDetailsElement): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
    if (d !== menu) d.open = false;
  });
  menu.open = true;
}

/**
 * 狭い画面のメニューのパネル（☰ で開く）を開け閉めする。☰ のボタンの aria-expanded も合わせる。閉じるときは、中のメニューも閉じる。
 *
 * @param bar メニューバー
 * @param toggle ☰ のボタン
 * @param open 開くなら true
 */
function setPanel(bar: HTMLElement, toggle: HTMLElement, open: boolean): void {
  bar.toggleAttribute("data-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  if (!open) for (const d of menusOf(bar)) d.open = false;
}

/**
 * メニューバーの中で押した矢印キーを扱う（Q-9）。メニューを開いている間だけ、左右で隣のメニュー（両端で回る）を開いてその見出しへ、
 * 上下で押せる項目へ入力を移す。移したときはキーの既定の動き（画面の移動など）を止める。
 *
 * @param bar メニューバー
 * @param ev キーの押下
 */
function onArrowKey(bar: HTMLElement, ev: KeyboardEvent): void {
  const menus = menusOf(bar);
  const at = menus.findIndex((d) => d.open && d.contains(document.activeElement));
  const menu = menus[at];
  if (!menu) return;
  const nextMenu = nextMenuIndex(menus.length, at, ev.key);
  if (nextMenu !== null) {
    const target = menus[nextMenu];
    if (!target) return;
    ev.preventDefault();
    openOnly(target);
    target.querySelector<HTMLElement>(":scope > summary")?.focus();
    return;
  }
  const items = itemsOf(menu);
  const current = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
  const nextItem = nextMenuItem(items.map(isUsable), current, ev.key);
  if (nextItem === null) return;
  ev.preventDefault();
  items[nextItem]?.focus();
}

/**
 * Esc で、開いているメニューを閉じる（Q-8）。入力がメニューの中にあれば、その見出しへ戻す。
 * メニューが開いていなくて、狭い画面のメニューのパネルが開いていれば、パネルを閉じて ☰ へ入力を戻す。
 * 閉じたときは、Esc をほかの操作（図の選択を解くなど）に渡さない。どちらも開いていなければ何もしない。
 *
 * @param bar メニューバー
 * @param toggle ☰ のボタン
 * @param ev キーの押下（文書の捕捉の段階で受ける）
 */
function onEscape(bar: HTMLElement, toggle: HTMLElement, ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return;
  const open = [...document.querySelectorAll<HTMLDetailsElement>("details.menu[open]")];
  const panelOpen = bar.hasAttribute("data-open");
  if (!open.length && !panelOpen) return;
  ev.stopPropagation();
  if (open.length) {
    const focused = open.find((d) => d.contains(document.activeElement));
    closeMenus();
    focused?.querySelector<HTMLElement>(":scope > summary")?.focus();
    return;
  }
  setPanel(bar, toggle, false);
  toggle.focus();
}

/**
 * メニューバーとメニューの振る舞いをつなぐ。起動時に 1 回呼ぶ。
 * メニューの外をクリックしたら閉じ、メニューの項目（ボタン・リンク）を押したら閉じる（狭い画面ではパネルも閉じる）。
 * メニューバーの見出しは、1 つ開いたらほかを閉じ、開いている間にマウスを乗せた見出しへ切り替わる（狭い画面では切り替えない）。
 */
export function initMenuBar(): void {
  const bar = $("#menubar");
  const toggle = $("#menuToggle");
  document.addEventListener("click", (ev) => {
    const target = ev.target instanceof Node ? ev.target : null;
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
      if (!target || !d.contains(target)) d.open = false;
    });
    if (bar.hasAttribute("data-open") && !(target && (bar.contains(target) || toggle.contains(target)))) setPanel(bar, toggle, false);
  });
  document.addEventListener("keydown", (ev) => onEscape(bar, toggle, ev), true);
  toggle.addEventListener("click", () => setPanel(bar, toggle, !bar.hasAttribute("data-open")));
  for (const menu of menusOf(bar)) {
    menu.addEventListener("toggle", () => {
      if (menu.open) openOnly(menu);
      else delete menu.dataset["hoverOpened"];
    });
    // マウスを乗せて開いたメニューの見出しを続けてクリックしても、閉じずに開いたままにする（開くつもりのクリックで閉じてしまわないように）
    menu.querySelector(":scope > summary")?.addEventListener("click", (ev) => {
      if (menu.dataset["hoverOpened"] === undefined) return;
      delete menu.dataset["hoverOpened"];
      ev.preventDefault();
    });
  }
  // マウスだけで切り替える（タッチでは、タップの前に届く pointerover で開いて、タップで閉じてしまうため）
  bar.addEventListener("pointerover", (ev) => {
    if (ev.pointerType !== "mouse" || isNarrow() || !(ev.target instanceof Element)) return;
    const menu = ev.target.closest("summary")?.parentElement;
    if (!(menu instanceof HTMLDetailsElement) || menu.open || !menusOf(bar).some((d) => d.open)) return;
    openOnly(menu);
    menu.dataset["hoverOpened"] = "";
  });
  bar.addEventListener("keydown", (ev) => onArrowKey(bar, ev));
  bar.addEventListener("click", (ev) => {
    if (!(ev.target instanceof Element) || !ev.target.closest(".pop button, .pop a")) return;
    closeMenus();
    setPanel(bar, toggle, false);
  });
}
