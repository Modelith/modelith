// パネル（ツリー｜図｜テキスト）の配置、図のタブ、パレット、モデルツリー、ビューのサブバー。

import { stdViewLabel, type Entry } from "../core";
import { fit, local, placeUsageAt, toCanvas } from "./canvas";
import { $, closest, esc, isFormField, store } from "./dom";
import { W } from "./geometry";
import { act, renderInspector } from "./inspector";
import { kindLabel } from "./labels";
import { addToView, canAddToView, editableView } from "./view-ops";
import { deleteSel, OPS, PHASEOPS } from "./ops";
import { PINOPS, selPinInfo } from "./pins";
import { applyTf, centerOn, highlight, render, scrollEditorTo } from "./render";
import { cancelConnect, clearSel, S, type Tab, type Tool, type UiPrefs } from "./state";
import { HAND_ICON, kindIcon, SELECT_ICON, viewIcon } from "./svg";
import { ensureLayout, toast } from "./sync";
import { baseViewOf, CC, defaultIbdContext, edgeById, ibdContexts, modelView, nodeByKey, phaseLabel, seqContexts, VIEWS } from "./views";
import { isCtxOpen } from "./ctxmenu";

/* ---- パネル配置 ---- */
const UI_KEY = "modelith-ui-v1";
const TABS_KEY = "modelith-tabs-v1";

export function loadUi(): void {
  try {
    Object.assign(S.ui, JSON.parse(store.get(UI_KEY) ?? "{}") as Partial<UiPrefs>);
  } catch {
    /* 壊れた設定は無視して既定値を使う */
  }
}
export const saveUi = (): void => store.set(UI_KEY, JSON.stringify(S.ui));
export const isNarrow = (): boolean => window.matchMedia("(max-width:760px)").matches;

export function applyPanes(): void {
  const m = $("#main");
  m.dataset["tree"] = S.ui.tree ? "on" : "off";
  m.dataset["text"] = S.ui.text ? "on" : "off";
  $("#togTree").setAttribute("aria-pressed", String(S.ui.tree));
  $("#togText").setAttribute("aria-pressed", String(S.ui.text));
  if (isNarrow()) {
    m.style.gridTemplateColumns = "";
    return;
  }
  m.style.gridTemplateColumns = `${S.ui.tree ? S.ui.treeW : 0}px ${S.ui.tree ? 5 : 0}px minmax(0,1fr) ${S.ui.text ? 5 : 0}px ${S.ui.text ? S.ui.textW : 0}px`;
}

/** 狭い画面ではタブを切り替え、広い画面では隠れているパネルを開く。 */
export function setTab(t: "tree" | "diagram" | "text"): void {
  if (!isNarrow()) {
    if (t === "text" && !S.ui.text) {
      S.ui.text = true;
      applyPanes();
      saveUi();
    }
    if (t === "tree" && !S.ui.tree) {
      S.ui.tree = true;
      applyPanes();
      saveUi();
    }
    return;
  }
  $("#main").dataset["tab"] = t;
  $("#tabTree").setAttribute("aria-pressed", String(t === "tree"));
  $("#tabDiagram").setAttribute("aria-pressed", String(t === "diagram"));
  $("#tabText").setAttribute("aria-pressed", String(t === "text"));
  if (t === "diagram") requestAnimationFrame(() => render());
  if (t === "tree") {
    S.treeScrollForce = true;
    renderTree();
  }
}

function initPanes(): void {
  $("#togTree").onclick = () => {
    S.ui.tree = !S.ui.tree;
    applyPanes();
    saveUi();
    requestAnimationFrame(render);
  };
  $("#togText").onclick = () => {
    S.ui.text = !S.ui.text;
    applyPanes();
    saveUi();
    requestAnimationFrame(render);
  };
  const splits: [string, "treeW" | "textW", number, number, number][] = [["splitTree", "treeW", 1, 170, 520], ["splitText", "textW", -1, 260, 980]];
  for (const [id, key, dir, lo, hi] of splits) {
    const el = $("#" + id);
    let st: { x: number; w: number } | null = null;
    el.addEventListener("pointerdown", (ev) => {
      el.setPointerCapture(ev.pointerId);
      st = { x: ev.clientX, w: S.ui[key] };
      el.classList.add("on");
    });
    el.addEventListener("pointermove", (ev) => {
      if (!st) return;
      S.ui[key] = Math.max(lo, Math.min(hi, st.w + (ev.clientX - st.x) * dir));
      applyPanes();
    });
    el.addEventListener("pointerup", () => {
      if (!st) return;
      st = null;
      el.classList.remove("on");
      saveUi();
      render();
    });
  }
  window.addEventListener("resize", () => applyPanes());
  $("#tabTree").onclick = () => setTab("tree");
  $("#tabDiagram").onclick = () => setTab("diagram");
  $("#tabText").onclick = () => {
    setTab("text");
    highlight();
  };
}

/* ---- 図のタブ ---- */
let tabSeq = 1;
const curTab = (): Tab | undefined => S.tabs.find((t) => t.id === S.tabId);

function tabLabel(t: Tab): string {
  if (t.mv) return t.mv;
  const v = VIEWS.find((x) => x.id === t.view);
  if (!v) return t.view;
  const nm = t.ctx ? (S.M.nodes.find((n) => n.key === t.ctx)?.name ?? t.ctx) : "";
  if (t.view === "ibd") return `ibd ${nm || "（未選択）"}`;
  if (t.view === "seq") return `sd ${nm || "（未選択）"}`;
  return v.label + (t.phase ? `：${phaseLabel(t.phase)}` : "");
}

function syncCurTab(): void {
  const t = curTab();
  if (!t) return;
  t.ctx = S.view === "ibd" ? S.ibdCtx : S.view === "seq" ? S.seqCtx : null;
  t.phase = S.phase || "";
}

export function saveTabs(): void {
  syncCurTab();
  store.set(TABS_KEY, JSON.stringify({ tabs: S.tabs.map(({ id, view, ctx, phase, mv }) => ({ id, view, ctx, phase, ...(mv ? { mv } : {}) })), active: S.tabId }));
}

export function renderTabs(): void {
  syncCurTab();
  $("#tabbar").innerHTML =
    S.tabs
      .map((t) => {
        const sel = t.id === S.tabId;
        const title = t.mv ? `保存された図「${t.mv}」` : tabLabel(t);
        return (
          `<div class="tab${t.mv ? " mv" : ""}" role="tab" aria-selected="${sel}" data-tab="${t.id}" tabindex="${sel ? 0 : -1}" title="${esc(title)}">${viewIcon(t.view)}<span>${esc(tabLabel(t))}</span>` +
          (S.tabs.length > 1 ? `<button class="x" data-close="${t.id}" aria-label="タブを閉じる" title="タブを閉じる">×</button>` : "") +
          `</div>`
        );
      })
      .join("") +
    `<details class="menu tabadd"><summary aria-label="図を開く" title="図を開く">＋</summary><div class="pop pop-left">` +
    VIEWS.map((v) => `<button data-open="${v.id}">${viewIcon(v.id)}${esc(v.label)}</button>`).join("") +
    `<div class="phead">保存された図</div>` +
    (S.M.views.length
      ? S.M.views.map((v) => `<button data-open-mv="${esc(v.name)}" title="${esc(stdViewLabel(v.std))}">${viewIcon(baseViewOf(v))}${esc(v.name)}</button>`).join("")
      : `<div class="pnote">保存された図はまだありません</div>`) +
    `</div></details>`;
}

export function activateTab(id: number, opts: { keepSel?: boolean; fit?: boolean } = {}): void {
  const cur = curTab();
  if (cur) {
    syncCurTab();
    cur.tf = { ...S.tf };
  }
  const t = S.tabs.find((x) => x.id === id);
  if (!t) return;
  S.tabId = id;
  S.modelView = t.mv ?? null;
  const mv = modelView();
  if (mv) t.view = baseViewOf(mv);
  S.view = t.view;
  S.phase = t.phase || "";
  if (t.view === "ibd") S.ibdCtx = t.ctx;
  if (t.view === "seq") S.seqCtx = t.ctx;
  cancelConnect();
  S.tool = null;
  if (!opts.keepSel) clearSel();
  ensureLayout();
  renderTabs();
  renderPalette();
  renderSub();
  render();
  renderInspector();
  highlight();
  if (t.tf && !opts.fit) {
    S.tf = { ...t.tf };
    applyTf();
  } else fit();
  saveTabs();
}

/** テキストに書かれた view を図として開く（同じ view のタブがあればそれに切り替える、F-VIEW-7）。 */
export function openModelView(name: string): void {
  const ex = S.tabs.find((t) => t.mv === name);
  if (ex) return activateTab(ex.id);
  const mv = S.M.views.find((v) => v.name === name);
  const t: Tab = { id: tabSeq++, view: mv ? baseViewOf(mv) : "all", ctx: null, phase: "", mv: name };
  S.tabs.push(t);
  activateTab(t.id, { fit: true });
}

/** ビューを開く（同じビュー・同じ対象のタブがあればそれに切り替える）。 */
export function openTab(view: string, ctx?: string | null, opts: { keepSel?: boolean } = {}): void {
  const ex = S.tabs.find((t) => !t.mv && t.view === view && ((view !== "ibd" && view !== "seq") || !ctx || t.ctx === ctx));
  if (ex && !(ctx && ex.ctx !== ctx)) {
    activateTab(ex.id, opts);
    return;
  }
  const t: Tab = { id: tabSeq++, view, ctx: ctx ?? null, phase: "" };
  S.tabs.push(t);
  activateTab(t.id, { ...opts, fit: true });
}

function closeTab(id: number): void {
  if (S.tabs.length <= 1) return;
  const i = S.tabs.findIndex((t) => t.id === id);
  S.tabs.splice(i, 1);
  if (S.tabId === id) {
    S.tabId = null;
    const next = S.tabs[Math.max(0, i - 1)];
    if (next) activateTab(next.id);
  } else {
    renderTabs();
    saveTabs();
  }
}

const defaultCtx = (view: string): string | null =>
  view === "ibd" ? (defaultIbdContext(S.M)?.key ?? null) : view === "seq" ? (seqContexts(S.M)[0]?.key ?? null) : null;

function readSavedTabs(): { tabs?: Tab[]; active?: number } | null {
  try {
    return JSON.parse(store.get(TABS_KEY) ?? "null") as { tabs?: Tab[]; active?: number } | null;
  } catch {
    return null;
  }
}

export function initTabs(): void {
  const saved = readSavedTabs();
  if (saved?.tabs?.length) S.tabs = saved.tabs.filter((t) => VIEWS.some((v) => v.id === t.view));
  for (const tb of S.tabs) if (typeof tb.mv !== "string") delete tb.mv;
  if (!S.tabs.length) {
    S.tabs = [
      { id: 1, view: "trace", ctx: null, phase: "" },
      { id: 2, view: "control", ctx: null, phase: "" },
      { id: 3, view: "ibd", ctx: null, phase: "" },
      { id: 4, view: "seq", ctx: null, phase: "" },
    ];
  }
  tabSeq = Math.max(...S.tabs.map((t) => t.id)) + 1;
  for (const tb of S.tabs) if (!tb.ctx && !tb.mv) tb.ctx = defaultCtx(tb.view);
  const first = S.tabs[0];
  const active = saved?.active != null && S.tabs.some((t) => t.id === saved.active) ? saved.active : first?.id;
  if (active != null) activateTab(active, { fit: true });

  const bar = $("#tabbar");
  // タブバーは横にスクロールするので、その中のメニューは枠で切れてしまう。開いたときに画面に対する位置で出す
  bar.addEventListener(
    "toggle",
    (ev) => {
      const d = ev.target;
      if (!(d instanceof HTMLDetailsElement) || !d.open) return;
      const pop = d.querySelector<HTMLElement>(".pop");
      const r = d.querySelector("summary")?.getBoundingClientRect();
      if (!pop || !r) return;
      Object.assign(pop.style, { position: "fixed", left: `${r.left}px`, right: "auto", top: `${r.bottom + 4}px` });
      // 画面の右端からはみ出すなら、内側に寄せる（狭い画面）
      pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    },
    true,
  );
  bar.addEventListener("click", (ev) => {
    const x = closest(ev, "[data-close]");
    if (x) {
      ev.stopPropagation();
      closeTab(Number(x.dataset["close"]));
      return;
    }
    const mvb = closest(ev, "[data-open-mv]");
    if (mvb) {
      const d = mvb.closest("details");
      if (d) d.open = false;
      openModelView(mvb.dataset["openMv"] ?? "");
      return;
    }
    const o = closest(ev, "[data-open]");
    if (o) {
      const d = o.closest("details");
      if (d) d.open = false;
      const v = o.dataset["open"] ?? "trace";
      const t: Tab = { id: tabSeq++, view: v, ctx: defaultCtx(v), phase: "" };
      S.tabs.push(t);
      activateTab(t.id, { fit: true });
      return;
    }
    const tb = closest(ev, ".tab");
    if (tb && Number(tb.dataset["tab"]) !== S.tabId) activateTab(Number(tb.dataset["tab"]));
  });
  bar.addEventListener("auxclick", (ev) => {
    const tb = closest(ev, ".tab");
    if (tb && ev.button === 1) closeTab(Number(tb.dataset["tab"]));
  });
}

/* ---- パレット（クリックで配置） ---- */
export const PALETTE: Record<string, [string, string][]> = {
  trace: [["concern def", "関心事"], ["requirement def", "要求"], ["verification def", "検証"], ["analysis def", "解析"], ["part def", "部品定義"]],
  structure: [["part def", "部品定義"], ["attribute def", "属性定義"], ["port def", "ポート定義"], ["item def", "アイテム定義"]],
  control: [["part def", "部品定義"], ["constraint def", "制約定義"]],
  behavior: [["state def", "状態定義"], ["action def", "アクション定義"], ["occurrence def", "シナリオ"]],
  all: [
    ["part def", "部品定義"], ["requirement def", "要求"], ["constraint def", "制約定義"], ["concern def", "関心事"], ["verification def", "検証"],
    ["analysis def", "解析"], ["state def", "状態定義"], ["action def", "アクション定義"], ["attribute def", "属性定義"], ["port def", "ポート定義"],
    ["item def", "アイテム定義"],
  ],
};

const isHand = (t: Tool | null): boolean => !!t && "hand" in t;
const toolKind = (t: Tool | null): string | null => (t && "kind" in t ? t.kind : null);
const toolUsage = (t: Tool | null): string | null => (t && "usage" in t ? t.usage : null);

export function renderPalette(): void {
  let h =
    `<button class="tool" data-tool="" aria-pressed="${!S.tool}" title="選択：ドラッグで範囲選択（Esc）">${SELECT_ICON}<span>選択</span></button>` +
    `<button class="tool" data-tool="hand" aria-pressed="${isHand(S.tool)}" title="移動：ドラッグで表示範囲を動かす（中ボタン・スペース＋ドラッグでも可）">${HAND_ICON}<span>移動</span></button><span class="tsep"></span>`;
  if (S.view === "ibd" || S.view === "seq") {
    const pdefs = S.M.nodes.filter((n) => n.kind === "part def");
    const cur = toolUsage(S.tool);
    const label = S.view === "ibd" ? "部品を置く" : "ライフラインを追加";
    h += `<label class="tool toolsel" aria-pressed="${!!cur}">${kindIcon("part")}<select id="usageTool" aria-label="${label}"><option value="">${label}…</option>${pdefs.map((p) => `<option value="${esc(p.name)}" ${cur === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`;
    if (S.view === "seq") h += `<button class="tool" data-tool="occurrence def" aria-pressed="false" title="新しいシナリオを作成">${kindIcon("occurrence def")}<span>シナリオ</span></button>`;
  } else if (!S.modelView || editableView()) {
    // 保存された図では、置いた要素をその図にも入れる（OPS.addNode）
    for (const [k, l] of PALETTE[S.view] ?? [])
      h += `<button class="tool" data-tool="${k}" aria-pressed="${toolKind(S.tool) === k}" title="${l}（${k}）：押してから図の上をクリックで置く">${kindIcon(k)}<span>${l}</span></button>`;
  }
  $("#palette").innerHTML = h;
  $("#btnSaveView").hidden = !!S.modelView;
  $("#wrap").classList.toggle("placing", !!S.tool && !isHand(S.tool));
}

export function setTool(tool: Tool | null): void {
  S.tool = tool;
  cancelConnect();
  renderPalette();
  render();
  renderInspector();
  $("#wrap").classList.toggle("panning", isHand(tool));
  if (!tool || isHand(tool)) return;
  const u = toolUsage(tool);
  toast(u ? `図の上をクリックすると「${u}」を部品として置きます（Esc で取消）` : `図の上をクリックすると${kindLabel(toolKind(tool) ?? "")}を置きます（Esc で取消）`);
}

/** 画面上の位置（図の枠内の座標）に置くときの、要素の左上の座標。 */
function dropPos(lx: number, ly: number): [number, number] {
  const [cx, cy] = toCanvas(lx, ly);
  return [Math.round((cx - W / 2) / 10) * 10, Math.round((cy - 22) / 10) * 10];
}

/** 選んでいる道具で、画面上の位置（図の枠内の座標）に要素を置く。 */
export function placeTool(lx: number, ly: number): void {
  const tool = S.tool;
  S.tool = null;
  const pos = dropPos(lx, ly);
  const u = toolUsage(tool), k = toolKind(tool);
  if (u) OPS.addUsage(u, pos);
  else if (k) void OPS.addNode(k, pos);
  renderPalette();
}

function initPalette(): void {
  const pal = $("#palette");
  pal.addEventListener("click", (ev) => {
    const b = closest(ev, "button.tool");
    if (!b) return;
    const k = b.dataset["tool"];
    if (!k) {
      setTool(null);
      return;
    }
    if (k === "hand") {
      setTool(isHand(S.tool) ? null : { hand: true });
      return;
    }
    if (k === "occurrence def" && S.view === "seq") {
      void OPS.addNode(k, [0, 0]);
      return;
    }
    setTool(toolKind(S.tool) === k ? null : { kind: k });
  });
  pal.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLSelectElement) || t.id !== "usageTool") return;
    const v = t.value;
    if (!v) {
      setTool(null);
      return;
    }
    if (S.view === "seq") {
      t.value = "";
      OPS.addUsage(v, [0, 0]);
      return;
    }
    setTool({ usage: v });
  });
}

/* ---- キーボード ---- */
function initKeys(): void {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    if (isFormField(ev.target) || isCtxOpen()) return;
    if (S.selSet.size) {
      ev.preventDefault();
      deleteSel();
      return;
    }
    if (S.selEdge) {
      const ed = edgeById(S.selEdge);
      if (ed) {
        ev.preventDefault();
        OPS.deleteEdge(ed);
      }
      return;
    }
    const pi = selPinInfo();
    if (pi) {
      ev.preventDefault();
      if (pi.pin.port) PINOPS.deletePort(pi.n, pi.pin);
      else PINOPS.removeAnchor(pi.n, pi.pin.id);
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || isFormField(ev.target)) return;
    if (S.tool) setTool(null);
    else if (S.mode === "connect") act("cancel");
    else if (S.sel || S.selEdge || S.selPin || S.selSet.size) {
      clearSel();
      render();
      highlight();
      renderInspector();
    }
  });
}

/* ---- モデルツリー ---- */
const TREE_SKIP = new Set(["subject", "stakeholder"]);
const pathOf = (e: Entry): string => {
  const p: string[] = [];
  for (let a: Entry | null = e; a; a = a.pe) p.unshift(a.name || a.kind);
  return p.join("::");
};

/** 要素をどのビューで開くか。 */
export function openTarget(e: Entry | null | undefined): { view: string; ctx?: string; mv?: string; label: string } | null {
  if (!e) return null;
  if (e.kind === "view" && e.name) return { view: "", mv: e.name, label: "保存された図を開く" };
  if (e.kind === "part def" && e.children.some((c) => c.kind === "part" && c.name)) return { view: "ibd", ctx: e.name, label: "内部ブロック図で開く" };
  if (e.kind === "occurrence def") return { view: "seq", ctx: e.name, label: "シーケンス図で開く" };
  if (/^(requirement|concern|verification|analysis) def$/.test(e.kind) || (e.kind === "requirement" && e.pe?.kind === "package")) return { view: "trace", label: "トレーサビリティで開く" };
  if (e.kind === "constraint def" || e.kind === "calc def") return { view: "control", label: "制御ループで開く" };
  if (e.kind === "state def" || e.kind === "action def") return { view: "behavior", label: "振る舞いで開く" };
  if (e.kind === "part def" || e.kind === "attribute def" || (e.kind === "part" && e.pe?.kind === "package")) return { view: "structure", label: "構造で開く" };
  return null;
}

function keyForEntry(e: Entry): string | null {
  const c = CC();
  if (c.ctx && e.pe === c.ctx.entry) {
    if (S.view === "ibd" && e.kind === "part") return "u:" + e.name;
    if (S.view === "seq") return "l:" + e.name;
  }
  for (let a: Entry | null = e; a; a = a.pe) {
    const n = S.M.nodeOf.get(a);
    if (n) return n.key;
  }
  return null;
}

function selectedEntry(): Entry | null {
  const t = S.treeSel != null ? S.P.entries[S.treeSel] : undefined;
  if (t) return t;
  return nodeByKey(S.sel)?.entry ?? null;
}

let lastTreeSel: Entry | null = null;

export function renderTree(): void {
  const el = $("#tree");
  const q = S.treeQ.trim().toLowerCase();
  const selE = selectedEntry();
  const anc = new Set<Entry>();
  for (let a = selE?.pe ?? null; a; a = a.pe) anc.add(a);
  const memo = new Map<Entry, boolean>();
  const kidsOf = (e: Entry): Entry[] => e.children.filter((c) => c.name && !TREE_SKIP.has(c.kind));
  const matches = (e: Entry): boolean => e.name.toLowerCase().includes(q) || e.short.toLowerCase().includes(q);
  const has = (e: Entry): boolean => {
    const m = memo.get(e);
    if (m !== undefined) return m;
    const r = matches(e) || kidsOf(e).some(has);
    memo.set(e, r);
    return r;
  };
  const rows: string[] = [];
  const walk = (e: Entry, d: number): void => {
    if (q && !has(e)) return;
    const kids = kidsOf(e);
    const msgs = e.kind === "occurrence def" ? S.M.rels.filter((r) => r.rel === "message" && r.pe === e) : [];
    const expandable = kids.length + msgs.length > 0;
    const p = pathOf(e);
    const open = !!q || anc.has(e) || (S.treeOpen.get(p) ?? (e.kind === "package" && d <= 1));
    const sel = selE === e;
    const ot = openTarget(e);
    const addable = ((S.view === "ibd" || S.view === "seq") && e.kind === "part def") || canAddToView(e);
    const phase = S.M.nodeOf.get(e)?.phase;
    rows.push(
      `<div class="ti${sel ? " sel" : ""}" role="treeitem" tabindex="-1" aria-level="${d + 1}"${expandable ? ` aria-expanded="${open}"` : ""} aria-selected="${sel}" data-idx="${e.idx}" style="--d:${d}" title="${esc(e.kind + (phase ? "（" + phaseLabel(phase) + "）" : ""))}">` +
        `<span class="car" data-toggle="${esc(p)}">${expandable ? (open ? "▾" : "▸") : ""}</span>${kindIcon(e.kind)}` +
        `<span class="nm">${e.short ? `&lt;'${esc(e.short)}'&gt; ` : ""}${esc(e.name)}</span>${e.type ? `<span class="ty">: ${esc(e.type)}</span>` : ""}` +
        `<span class="acts">${addable ? `<button data-add="${e.idx}" title="${canAddToView(e) ? "この図に入れる" : `この図に${S.view === "ibd" ? "部品" : "ライフライン"}として追加`}">追加</button>` : ""}${ot ? `<button data-open="${e.idx}" title="${ot.label}">開く</button>` : ""}<button class="nar" data-totext="${e.idx}" title="テキストで見る">文</button></span></div>`,
    );
    if (!open) return;
    for (const c of kids) walk(c, d + 1);
    msgs.forEach((r, i) => {
      if (r.rel !== "message" || (q && !r.name.toLowerCase().includes(q))) return;
      rows.push(
        `<div class="ti" role="treeitem" tabindex="-1" aria-level="${d + 2}" data-msg="${r.start}" style="--d:${d + 1}"><span class="car"></span>${kindIcon("message")}<span class="nm">${i + 1}. ${esc(r.name || "（名前なし）")}</span><span class="ty">${esc(r.a)} → ${esc(r.b)}</span></div>`,
      );
    });
  };
  for (const e of S.P.entries) if (!e.pe) walk(e, 0);
  el.innerHTML = rows.join("") || `<div class="tree-empty">${q ? "一致する要素がありません" : "要素を追加すると、ここにモデルの構造が表示されます"}</div>`;
  const s = el.querySelector(".ti.sel");
  if (s && (selE !== lastTreeSel || S.treeScrollForce)) s.scrollIntoView({ block: "nearest" });
  lastTreeSel = selE;
  S.treeScrollForce = false;
}

/** 要素を選択し、テキストと図の両方で見えるようにする。 */
export function selectEntry(e: Entry, fromTree = true): void {
  clearSel();
  S.sel = keyForEntry(e);
  if (S.sel) S.selSet = new Set([S.sel]);
  S.treeSel = e.idx;
  S.textMark = [e.start, e.end];
  scrollEditorTo(e.start);
  if (S.sel && CC().nodes.some((n) => n.key === S.sel)) centerOn(S.sel, true);
  render();
  highlight();
  renderInspector();
  if (fromTree) renderTree();
}

/** 要素に合ったビューを開いて選択する。 */
export function openEntry(e: Entry): void {
  const ot = openTarget(e);
  if (!ot) {
    selectEntry(e);
    return;
  }
  if (isNarrow()) setTab("diagram");
  if (ot.mv) return openModelView(ot.mv);
  openTab(ot.view, ot.ctx ? (ibdContexts(S.M).concat(seqContexts(S.M)).find((n) => n.name === ot.ctx)?.key ?? ot.ctx) : null, { keepSel: true });
  S.treeSel = null;
  selectEntry(e);
}

const entryAt = (idx: string | undefined): Entry | undefined => (idx == null ? undefined : S.P.entries[Number(idx)]);

function initTree(): void {
  const tree = $("#tree");
  const wrapEl = $("#wrap");
  let suppressClick = false;
  tree.addEventListener("click", (ev) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const tg = closest(ev, "[data-toggle]");
    const row = closest(ev, ".ti");
    if (tg && tg.textContent && row) {
      S.treeOpen.set(tg.dataset["toggle"] ?? "", row.getAttribute("aria-expanded") !== "true");
      renderTree();
      return;
    }
    const bo = entryAt(closest(ev, "[data-open]")?.dataset["open"]);
    if (bo) {
      openEntry(bo);
      return;
    }
    const ba = entryAt(closest(ev, "[data-add]")?.dataset["add"]);
    if (ba) {
      const r = wrapEl.getBoundingClientRect();
      if (canAddToView(ba)) addToView(ba, dropPos(r.width / 2, r.height / 3));
      else placeUsageAt(ba.name, r.width / 2, r.height / 3);
      if (isNarrow()) setTab("diagram");
      return;
    }
    const bt = entryAt(closest(ev, "[data-totext]")?.dataset["totext"]);
    if (bt) {
      selectEntry(bt);
      setTab("text");
      return;
    }
    if (!row) return;
    const msg = row.dataset["msg"];
    if (msg) {
      const st = Number(msg);
      const ed = CC().edges.find((x) => x.rel && x.rel.start === st);
      clearSel();
      if (ed) S.selEdge = ed.id;
      S.textMark = [st, st + 1];
      scrollEditorTo(st);
      render();
      highlight();
      renderInspector();
      return;
    }
    const e = entryAt(row.dataset["idx"]);
    if (e) selectEntry(e);
  });
  tree.addEventListener("dblclick", (ev) => {
    const row = closest(ev, ".ti[data-idx]");
    const e = entryAt(row?.dataset["idx"]);
    if (e && !closest(ev, "button")) openEntry(e);
  });
  tree.addEventListener("keydown", (ev) => {
    const rows = [...tree.querySelectorAll<HTMLElement>(".ti")];
    const active = document.activeElement;
    const cur = active instanceof HTMLElement ? active.closest<HTMLElement>(".ti") : null;
    let i = cur ? rows.indexOf(cur) : -1;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      i = Math.max(0, Math.min(rows.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)));
      rows[i]?.focus();
    } else if (ev.key === "Enter" && cur) {
      const e = entryAt(cur.dataset["idx"]);
      if (e) openEntry(e);
    } else if (ev.key === " " && cur) {
      ev.preventDefault();
      cur.click();
    }
  });
  $<HTMLInputElement>("#treeSearch").addEventListener("input", (ev) => {
    S.treeQ = (ev.target as HTMLInputElement).value;
    renderTree();
  });

  // ツリーから図へドラッグ（マウス）
  let tdrag: { idx: number; x: number; y: number; on: boolean } | null = null;
  tree.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    const row = closest(ev, ".ti[data-idx]");
    if (!row || closest(ev, "button,[data-toggle]")) return;
    tdrag = { idx: Number(row.dataset["idx"]), x: ev.clientX, y: ev.clientY, on: false };
  });
  const insideWrap = (ev: PointerEvent): boolean => {
    const r = wrapEl.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  };
  const droppable = (e: Entry | undefined): boolean => !!e && (((S.view === "ibd" || S.view === "seq") && e.kind === "part def") || canAddToView(e));
  window.addEventListener("pointermove", (ev) => {
    if (!tdrag) return;
    const e = S.P.entries[tdrag.idx];
    if (!tdrag.on) {
      if (Math.hypot(ev.clientX - tdrag.x, ev.clientY - tdrag.y) < 6 || !e) return;
      tdrag.on = true;
      const g = document.createElement("div");
      g.className = "ghost";
      g.id = "ghost";
      g.innerHTML = kindIcon(e.kind) + esc(e.name);
      document.body.appendChild(g);
    }
    const g = $("#ghost");
    g.style.left = ev.clientX + 12 + "px";
    g.style.top = ev.clientY + 8 + "px";
    const inside = insideWrap(ev), ok = droppable(e);
    wrapEl.classList.toggle("dropok", inside && ok);
    g.classList.toggle("no", inside && !ok);
  });
  window.addEventListener("pointerup", (ev) => {
    if (!tdrag) return;
    const d = tdrag;
    tdrag = null;
    if (!d.on) return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    document.getElementById("ghost")?.remove();
    wrapEl.classList.remove("dropok");
    if (!insideWrap(ev)) return;
    const e = S.P.entries[d.idx];
    const [lx, ly] = local(ev.clientX, ev.clientY);
    if (e && canAddToView(e)) addToView(e, dropPos(lx, ly));
    else if (e && droppable(e)) placeUsageAt(e.name, lx, ly);
    else toast("ツリーからのドラッグは、保存された図に要素を入れるときと、内部ブロック図・シーケンス図に部品定義を置くときに使えます");
  });
}

/* ---- サブバー（対象ブロック・フェーズ・トレースの抜け） ---- */
export function renderSub(): void {
  const parts: string[] = [];
  const ctxSel = (cs: { key: string; name: string }[], cur: string | null, label: string): string =>
    cs.length ? `<label>${label}<select id="ctxSel">${cs.map((n) => `<option value="${esc(n.key)}" ${n.key === cur ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>` : "";
  const phases = S.M.phases;
  const mv = modelView();
  if (S.modelView) {
    // 保存された図（view）：中身と対象は expose で決まるので、選ばせない
    const ctx = S.view === "ibd" ? S.ibdCtx : S.view === "seq" ? S.seqCtx : null;
    const ctxName = ctx ? S.M.nodes.find((n) => n.key === ctx)?.name : undefined;
    parts.push(
      `<span class="mvnote" title="${editableView() ? "パレットから置くか、ツリーからドラッグすると、この図に入ります。外すときは要素を右クリックします" : "この図に出す要素は、保存された図の設定で決まります"}（view の expose・filter）">保存された図「${esc(S.modelView)}」：${esc(stdViewLabel(mv?.std ?? null))}${ctxName ? `（${esc(ctxName)}）` : ""}</span>`,
    );
  } else if (S.view === "ibd") {
    CC();
    parts.push(ctxSel(ibdContexts(S.M), S.ibdCtx, "対象ブロック"));
  } else if (S.view === "seq") {
    CC();
    parts.push(ctxSel(seqContexts(S.M), S.seqCtx, "シナリオ"));
  } else if (phases) {
    parts.push(
      `<label>フェーズ<select id="phaseFilter"><option value="">すべて</option>${phases.map((p) => `<option value="${esc(p)}" ${S.phase === p ? "selected" : ""}>${esc(phaseLabel(p))}（${S.M.nodes.filter((n) => n.phase === p).length}）</option>`).join("")}</select></label>`,
    );
  } else parts.push(`<button id="btnPhaseInit">フェーズ管理を始める</button>`);
  if (phases) {
    const gaps = S.M.problems.filter((p) => p.kind === "gap").length;
    parts.push(gaps ? `<button id="btnGaps" class="gapbtn">トレースの抜け ${gaps} 件</button>` : `<span class="okgap">トレースの抜けなし</span>`);
  }
  $("#subbar").innerHTML = parts.join("");
}

function initSub(): void {
  const sub = $("#subbar");
  sub.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.id === "ctxSel") {
      if (S.view === "ibd") S.ibdCtx = t.value;
      else S.seqCtx = t.value;
    } else if (t.id === "phaseFilter") S.phase = t.value;
    else return;
    clearSel();
    ensureLayout();
    render();
    renderInspector();
    fit();
    saveTabs();
    renderTabs();
  });
  sub.addEventListener("click", (ev) => {
    const b = closest(ev, "button");
    if (!b) return;
    if (b.id === "btnPhaseInit") void PHASEOPS.init();
    if (b.id === "btnGaps") {
      const g = S.M.problems.find((p) => p.kind === "gap");
      setTab("text");
      highlight();
      if (g) scrollEditorTo(g.pos);
      $("#problems").querySelector(".gap")?.scrollIntoView({ block: "nearest" });
    }
  });
}

/** パネル・パレット・ツリー・サブバー・キーボードのイベントを登録する。 */
export function initPanels(): void {
  initPanes();
  initPalette();
  initKeys();
  initTree();
  initSub();
}
