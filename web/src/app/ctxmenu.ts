// 右クリック（長押し）メニュー。

import type { ModelEdge, ModelNode } from "../core";
import { local, placeUsageAt, fit, toCanvas } from "./canvas";
import { $, closest, esc } from "./dom";
import type { Pin } from "./geometry";
import { act, renderInspector, startRename } from "./inspector";
import { alignSel, deleteSel, MSGOPS, OPS, PHASEOPS, setPhaseSel, setSelection, toggleSel } from "./ops";
import { openEntry, openTarget, PALETTE, placeTool, selectEntry, setTab } from "./panels";
import { DIR_LABEL, PINOPS, pinsFor } from "./pins";
import { highlight, render, scrollEditorTo } from "./render";
import { clearSel, S } from "./state";
import { kindIcon } from "./svg";
import { relayout, toast } from "./sync";
import { CC, edgeById, nodeByKey, phaseLabel } from "./views";
import { addToView, canAddToView, editableView, removeFromView } from "./view-ops";

export type CtxItem = { sep: true } | { head: string } | { label: string; icon?: string; disabled?: boolean; act: () => void };

let open = false;
/**
 * 右クリックメニューが開いているか。
 *
 * @returns 開いていれば true
 * @example
 * // openCtx で項目のあるメニューを開いた後
 * isCtxOpen() // → true
 * // closeCtx の後
 * isCtxOpen() // → false
 */
export const isCtxOpen = (): boolean => open;

/**
 * 右クリックメニューを閉じて中身を消す。開いていなければ何もしない。
 */
export function closeCtx(): void {
  if (!open) return;
  open = false;
  const el = $("#ctx");
  el.hidden = true;
  el.innerHTML = "";
}

/**
 * 右クリックメニューを開く（F-VIEW-4）。画面からはみ出さないように位置を詰める。
 * 項目を押すとメニューを閉じてから、その項目の操作を行う。項目が無ければ開かない。
 *
 * @param cx 開く位置の x（画面の座標、px）
 * @param cy 開く位置の y（画面の座標、px）
 * @param items メニューの項目（区切り・見出し・操作）
 */
export function openCtx(cx: number, cy: number, items: CtxItem[]): void {
  if (!items.length) return;
  const el = $("#ctx");
  el.innerHTML = items
    .map((it, i) =>
      "sep" in it ? `<div class="sep"></div>` : "head" in it ? `<div class="head">${esc(it.head)}</div>` : `<button data-i="${i}" ${it.disabled ? "disabled" : ""}>${it.icon ?? ""}<span>${esc(it.label)}</span></button>`,
    )
    .join("");
  el.hidden = false;
  open = true;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(cx, window.innerWidth - r.width - 8)) + "px";
  el.style.top = Math.max(6, Math.min(cy, window.innerHeight - r.height - 8)) + "px";
  el.onclick = (ev) => {
    const b = closest(ev, "button[data-i]");
    if (!b) return;
    const it = items[Number(b.dataset["i"])];
    closeCtx();
    if (it && "act" in it) it.act();
  };
}

/**
 * 要素を 1 つだけ選び、図・テキストの色付け・インスペクタを描き直す。
 *
 * @param k 要素のキー
 */
const selectOnly = (k: string): void => {
  setSelection([k]);
  render();
  highlight();
  renderInspector();
};

/**
 * 要素の上で開くメニューの項目を作る。複数選択の中の要素なら、整列・工程の一括設定・一括削除を並べる。
 * メモなら itemsForNote の項目にする。そうでなければ、テキストで見る・名前の変更・関係の追加・定義を開く・工程・削除（保存された図では
 * 「この図から外す」と「モデルから削除」を分ける。F-VIEW-8）を並べる。
 *
 * @param n 要素
 * @returns メニューの項目
 * @example
 * // part def Vehicle だけを選び、工程の無いモデルで、自動の図
 * itemsForNode(Vehicle).map((it) => "head" in it ? it.head : "label" in it ? it.label : "—")
 * // → ["«part def» Vehicle", "テキストで見る", "名前を変更", "関係を追加…", "選択に追加", …, "—", "削除"]
 * // A・B の 2 個を選択中に A で開いた
 * itemsForNode(A)[0] // → { head: "2 個を選択中" }
 */
function itemsForNode(n: ModelNode): CtxItem[] {
  const items: CtxItem[] = [];
  const phases = S.M.phases;
  if (S.selSet.size > 1 && S.selSet.has(n.key)) {
    items.push(
      { head: `${S.selSet.size} 個を選択中` },
      { label: "左を揃える", act: () => alignSel("left") },
      { label: "上を揃える", act: () => alignSel("top") },
      { label: "横に等間隔で並べる", act: () => alignSel("hspace") },
      { label: "縦に等間隔で並べる", act: () => alignSel("vspace") },
    );
    if (phases) {
      items.push({ sep: true }, { head: "フェーズをまとめて設定" });
      for (const p of phases) items.push({ label: phaseLabel(p), act: () => setPhaseSel(p) });
    }
    items.push({ sep: true }, { label: `${S.selSet.size} 個をまとめて削除`, act: deleteSel });
    return items;
  }
  if (n.note) return itemsForNote(n);
  items.push({ head: `«${n.kind}» ${n.name}` }, {
    label: "テキストで見る",
    act: () => {
      selectOnly(n.key);
      setTab("text");
      scrollEditorTo(n.entry.start);
    },
  });
  if (!n.usage && !n.lifeline) items.push({ label: "名前を変更", act: () => { selectOnly(n.key); startRename(); } });
  items.push({ label: "関係を追加…", act: () => { selectOnly(n.key); act("connect"); } }, { label: "選択に追加", act: () => toggleSel(n.key) });
  const typeEntry = !n.isDef && n.entry.type ? S.M.byName.get(n.entry.type)?.find((x) => x.isDef) : undefined;
  const target = typeEntry ?? n.entry;
  const ot = openTarget(target);
  if (ot) items.push({ label: ot.label, act: () => openEntry(target) });
  if (phases && n.isDef) {
    items.push({ sep: true }, { head: "フェーズ" });
    for (const p of phases) items.push({ label: phaseLabel(p) + (n.phase === p ? "（現在）" : ""), act: () => PHASEOPS.set(n, p) });
  }
  // 保存された図では、図から外す操作とモデルから削除する操作を分けて並べる（取り違えてモデルを消さないため）
  if (editableView()) items.push({ sep: true }, { label: "この図から外す", act: () => removeFromView(n) }, { label: "モデルから削除", act: () => { selectOnly(n.key); OPS.deleteNode(n); } });
  else items.push({ sep: true }, { label: "削除", act: () => { selectOnly(n.key); OPS.deleteNode(n); } });
  return items;
}

/**
 * メモの上で開くメニューの項目を作る。テキストで見る・メモを削除だけを並べる（メモから線は引けず、名前も図では変えない）。
 *
 * @param n メモ（`note` の図の要素）
 * @returns メニューの項目
 * @example
 * itemsForNote(note).map((it) => "head" in it ? it.head : "label" in it ? it.label : "—")
 * // → ["メモ", "テキストで見る", "—", "メモを削除"]
 */
function itemsForNote(n: ModelNode): CtxItem[] {
  return [
    { head: `メモ${n.name ? " " + n.name : ""}` },
    { label: "テキストで見る", act: () => { selectOnly(n.key); setTab("text"); scrollEditorTo(n.entry.start); } },
    { sep: true },
    { label: "メモを削除", act: () => { selectOnly(n.key); OPS.deleteNode(n); } },
  ];
}

/**
 * 線の上で開くメニューの項目を作る。メッセージなら、名前・型の編集と順番の移動も並べる。メモの線には「関係を削除」を出さない。
 *
 * @param ed 線
 * @returns メニューの項目
 * @example
 * // satisfy の線
 * itemsForEdge(ed).map((it) => "head" in it ? it.head : "label" in it ? it.label : "—")
 * // → ["«satisfy»", "テキストで見る", "—", "関係を削除"]
 * // 最初のメッセージ（idx 0）では「上へ移動」を押せない
 * itemsForEdge(msg)[3] // → { label: "上へ移動", disabled: true, act }
 */
function itemsForEdge(ed: ModelEdge): CtxItem[] {
  const i = ed.idx ?? 0;
  const items: CtxItem[] = [
    { head: ed.kind === "message" ? `メッセージ ${i + 1}` : `«${ed.kind}»` },
    {
      label: "テキストで見る",
      act: () => {
        clearSel();
        S.selEdge = ed.id;
        setTab("text");
        scrollEditorTo(ed.src.start);
        render();
        highlight();
        renderInspector();
      },
    },
  ];
  if (ed.kind === "message") {
    items.push(
      { label: "名前・型を編集", act: () => { clearSel(); S.selEdge = ed.id; S.msgEdit = true; render(); renderInspector(); } },
      { label: "上へ移動", disabled: i === 0, act: () => MSGOPS.move(ed, -1) },
      { label: "下へ移動", disabled: i === CC().edges.length - 1, act: () => MSGOPS.move(ed, 1) },
    );
  }
  // メモの線だけを削除する操作は無い（メモごと削除する）
  if (ed.kind !== "annotate") items.push({ sep: true }, { label: "関係を削除", act: () => { clearSel(); S.selEdge = ed.id; OPS.deleteEdge(ed); } });
  return items;
}

/**
 * 接続点の上で開くメニューの項目を作る。ポートなら向きの変更と削除、自由な接続点ならポートにする・外すを並べる。
 *
 * @param node 接続点を持つ要素
 * @param pin 接続点
 * @returns メニューの項目
 * @example
 * // 自由な接続点 a1
 * itemsForPin(n, { id: "a1", side: "t", t: 0.5 }).map((it) => "head" in it ? it.head : "label" in it ? it.label : "—")
 * // → ["接続点", "ポートにする…", "接続点を外す"]
 * // in のポート p
 * itemsForPin(n, pin)[0] // → { head: "ポート p" }
 */
function itemsForPin(node: ModelNode, pin: Pin): CtxItem[] {
  const port = pin.port;
  const items: CtxItem[] = [{ head: port ? `ポート ${port.name}` : "接続点" }];
  if (port) {
    for (const d of ["in", "out", "inout"] as const) items.push({ label: `向き：${DIR_LABEL[d]}` + (port.dir === d ? "（現在）" : ""), act: () => PINOPS.setDir(node, port, d) });
    items.push({ sep: true }, { label: "ポートを削除", act: () => { clearSel(); S.selPin = { node: node.key, pin: pin.id }; PINOPS.deletePort(node, pin); } });
  } else {
    items.push(
      { label: "ポートにする…", act: () => { clearSel(); S.selPin = { node: node.key, pin: pin.id }; S.portForm = true; render(); renderInspector(); } },
      { label: "接続点を外す", act: () => PINOPS.removeAnchor(node, pin.id) },
    );
  }
  return items;
}

/**
 * 図の何も無いところで開くメニューの項目を作る。その位置に要素（内部ブロック図・シーケンス図では、
 * 部品定義を 12 個までの部品・ライフライン）を置く項目と、すべて選択・並べ直す・全体を表示を並べる。
 *
 * @param lx 開いた位置の x（図の枠の中の座標、px）
 * @param ly 開いた位置の y（図の枠の中の座標、px）
 * @returns メニューの項目
 * @example
 * // 「構造」の図
 * itemsForCanvas(100, 80)[0] // → { head: "ここに要素を追加" }
 * // 内部ブロック図
 * itemsForCanvas(100, 80)[0] // → { head: "ここに部品を置く" }
 */
function itemsForCanvas(lx: number, ly: number): CtxItem[] {
  const items: CtxItem[] = [];
  if (S.view === "ibd" || S.view === "seq") {
    items.push({ head: S.view === "ibd" ? "ここに部品を置く" : "ライフラインを追加" });
    for (const n of S.M.nodes.filter((x) => x.kind === "part def").slice(0, 12)) {
      items.push({ label: n.name, icon: kindIcon("part"), act: () => { S.tool = { usage: n.name }; placeTool(lx, ly); } });
    }
  } else {
    items.push({ head: "ここに要素を追加" });
    for (const [k, l] of PALETTE[S.view] ?? PALETTE["all"] ?? []) items.push({ label: l, icon: kindIcon(k), act: () => { S.tool = { kind: k }; placeTool(lx, ly); } });
  }
  items.push(
    { sep: true },
    { label: "すべて選択", act: () => { setSelection(CC().nodes.map((n) => n.key)); render(); highlight(); renderInspector(); } },
    { label: "この図を並べ直す", act: () => { relayout(); fit(); toast("この図を並べ直しました"); } },
    { label: "全体を表示", act: fit },
  );
  return items;
}

/**
 * 図の上の位置に応じたメニュー項目を返す。接続点・要素・線・何も無いところの順に、当たったものの項目にする。
 *
 * @param target 右クリックした要素（DOM）
 * @param clientX 右クリックした位置の x（画面の座標、px）
 * @param clientY 右クリックした位置の y（画面の座標、px）
 * @returns メニューの項目
 * @example
 * // part def Vehicle の箱の上で、Vehicle だけが選ばれている
 * ctxItemsAt(el, x, y)[0] // → { head: "«part def» Vehicle" }
 * // 「構造」の図の何も無いところ
 * ctxItemsAt(el, x, y)[0] // → { head: "ここに要素を追加" }
 */
export function ctxItemsAt(target: Element, clientX: number, clientY: number): CtxItem[] {
  const pEl = target.closest<HTMLElement>(".pin"), nEl = target.closest<HTMLElement>(".node, .lifeline"), eEl = target.closest<HTMLElement>(".edge");
  if (pEl) {
    const n = nodeByKey(pEl.dataset["node"]);
    const pin = n ? pinsFor(n).find((p) => p.id === pEl.dataset["pin"]) : undefined;
    if (n && pin) return itemsForPin(n, pin);
  }
  if (nEl) {
    const n = nodeByKey(nEl.dataset["key"]);
    if (n) return itemsForNode(n);
  }
  if (eEl) {
    const ed = edgeById(eEl.dataset["edge"]);
    if (ed) return itemsForEdge(ed);
  }
  const [lx, ly] = local(clientX, clientY);
  return itemsForCanvas(lx, ly);
}

/**
 * 右クリックメニューを図とツリーにつなぐ（F-VIEW-4・F-VIEW-5）。起動時に 1 回呼ぶ。
 * 図では位置に応じた項目を、ツリーでは行の要素の項目（テキストで見る・この図で選択・図に入れる・名前の変更・削除など）を出す。
 * メニューの外を押すか Esc でメニューを閉じる。
 */
export function initCtxMenu(): void {
  document.addEventListener("pointerdown", (ev) => {
    if (open && !closest(ev, "#ctx")) closeCtx();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeCtx();
  });
  $("#wrap").addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    closeCtx();
    if (ev.target instanceof Element) openCtx(ev.clientX, ev.clientY, ctxItemsAt(ev.target, ev.clientX, ev.clientY));
  });
  $("#tree").addEventListener("contextmenu", (ev) => {
    const row = closest(ev, ".ti[data-idx]");
    const e = row ? S.P.entries[Number(row.dataset["idx"])] : undefined;
    if (!e) return;
    ev.preventDefault();
    const n = S.M.nodeOf.get(e);
    const items: CtxItem[] = [
      { head: `«${e.kind}» ${e.name}` },
      { label: "テキストで見る", act: () => { selectEntry(e); setTab("text"); } },
      { label: "この図で選択", act: () => selectEntry(e) },
    ];
    const ot = openTarget(e);
    if (ot) items.push({ label: ot.label, act: () => openEntry(e) });
    if ((S.view === "ibd" || S.view === "seq") && e.kind === "part def") {
      items.push({
        label: S.view === "ibd" ? "開いている図に部品として追加" : "開いている図にライフラインとして追加",
        act: () => {
          const r = $("#wrap").getBoundingClientRect();
          placeUsageAt(e.name, r.width / 2, r.height / 3);
        },
      });
    }
    if (canAddToView(e)) {
      items.push({
        label: "この図に入れる",
        act: () => {
          const r = $("#wrap").getBoundingClientRect();
          const [cx, cy] = toCanvas(r.width / 2, r.height / 3);
          addToView(e, [Math.round(cx / 10) * 10, Math.round(cy / 10) * 10]);
        },
      });
    }
    if (n) items.push({ sep: true }, { label: "名前を変更", act: () => { selectOnly(n.key); startRename(); } }, { label: "削除", act: () => { selectOnly(n.key); OPS.deleteNode(n); } });
    closeCtx();
    openCtx(ev.clientX, ev.clientY, items);
  });
}
