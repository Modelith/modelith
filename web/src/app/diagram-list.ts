// サイドバーの「図」：作成した図の一覧（F-VIEW-11）。選ぶと開き、右クリックやボタンで名前の変更・削除をする。

import type { ModelView } from "../core";
import { closeCtx, openCtx } from "./ctxmenu";
import { $, esc } from "./dom";
import { stdViewLabel } from "../core";
import { savedViewHint } from "./labels";
import { openModelView } from "./panels";
import { S } from "./state";
import { viewIcon } from "./svg";
import { createDiagram, deleteDiagram, renameDiagram } from "./view-ops";
import { baseViewOf } from "./views";

/**
 * 作成した図 1 つの行の HTML を作る。表示中の図には印を付ける。
 *
 * @param v テキストに書かれた view
 * @param current 表示中のタブの図の名前（自動の図なら null）
 * @returns 行の HTML（文字は esc で逃がす）
 * @example
 * diagramRow({ name: "全体", kind: "general", std: "GeneralView", … }, "全体")
 * // → '<div class="ti sel" role="treeitem" … data-mv="全体" …>…<span class="nm">全体</span><span class="ty">一般ビュー</span>…</div>'
 */
export function diagramRow(v: ModelView, current: string | null): string {
  const sel = v.name === current;
  return (
    `<div class="ti${sel ? " sel" : ""}" role="treeitem" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-mv="${esc(v.name)}" style="--d:0" title="${esc(savedViewHint(v.std))}">` +
    `<span class="car"></span>${viewIcon(baseViewOf(v))}<span class="nm">${esc(v.name)}</span><span class="ty">${esc(stdViewLabel(v.std))}</span>` +
    `<span class="acts"><button data-rename-mv="${esc(v.name)}" title="名前を変更">名前</button><button data-delete-mv="${esc(v.name)}" title="削除">削除</button></span></div>`
  );
}

/** サイドバーの「図」を描き直す（モデルが変わったとき・タブを切り替えたとき）。 */
export function renderDiagramList(): void {
  const el = document.querySelector<HTMLElement>("#diagramList");
  if (!el) return;
  el.innerHTML = S.M.views.length
    ? S.M.views.map((v) => diagramRow(v, S.modelView)).join("")
    : `<div class="tree-empty">作成した図はまだありません。上の「新しい図を作成…」で作れます</div>`;
  if (!el.querySelector('.ti[tabindex="0"]')) el.querySelector<HTMLElement>(".ti")?.setAttribute("tabindex", "0");
}

/**
 * 行の要素から図の名前を引く。
 *
 * @param t クリックなどの対象
 * @param attr 名前を持つ属性（`data-mv` など）
 * @returns 図の名前。無ければ null
 * @example
 * // <div data-mv="全体"><span class="nm">全体</span></div> の span をクリックした
 * nameAt(span, "data-mv")        // → "全体"
 * nameAt(span, "data-delete-mv") // → null
 */
function nameAt(t: EventTarget | null, attr: string): string | null {
  return t instanceof Element ? (t.closest(`[${attr}]`)?.getAttribute(attr) ?? null) : null;
}

/** サイドバーの「図」の操作（新しい図の作成・開く・名前の変更・削除・右クリック・キーボード）を登録する。 */
export function initDiagramList(): void {
  const el = $("#diagramList");
  $("#btnNewDiagram").onclick = () => void createDiagram();
  el.addEventListener("click", (ev) => {
    const rn = nameAt(ev.target, "data-rename-mv");
    if (rn !== null) return void renameDiagram(rn);
    const del = nameAt(ev.target, "data-delete-mv");
    if (del !== null) return void deleteDiagram(del);
    const name = nameAt(ev.target, "data-mv");
    if (name !== null) openModelView(name);
  });
  el.addEventListener("keydown", (ev) => {
    const name = nameAt(ev.target, "data-mv");
    if (name === null) return;
    if (ev.key === "Enter") openModelView(name);
    else if (ev.key === "F2") void renameDiagram(name);
    else if (ev.key === "Delete") void deleteDiagram(name);
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const rows = [...el.querySelectorAll<HTMLElement>(".ti")];
      const i = rows.findIndex((r) => r === (ev.target as Element).closest(".ti"));
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)))];
      rows.forEach((r) => r.setAttribute("tabindex", r === next ? "0" : "-1"));
      next?.focus();
    } else return;
    ev.preventDefault();
  });
  el.addEventListener("contextmenu", (ev) => {
    const name = nameAt(ev.target, "data-mv");
    if (name === null) return;
    ev.preventDefault();
    closeCtx();
    openCtx(ev.clientX, ev.clientY, [
      { head: name },
      { label: "開く", act: () => openModelView(name) },
      { sep: true },
      { label: "名前を変更", act: () => void renameDiagram(name) },
      { label: "削除", act: () => void deleteDiagram(name) },
    ]);
  });
}
