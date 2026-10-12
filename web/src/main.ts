// Modelith の起動。各モジュールのイベントを登録し、下書き（無ければ公開サンプル）を読み込む。
import "@fontsource/ibm-plex-sans-jp/400.css";
import "@fontsource/ibm-plex-sans-jp/500.css";
import "@fontsource/ibm-plex-sans-jp/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import SAMPLE from "./samples/electric-kettle.sysml?raw";
import { initCanvas, fit } from "./app/canvas";
import { initCtxMenu } from "./app/ctxmenu";
import { $, isFormField, store } from "./app/dom";
import { initEditor } from "./app/editor";
import { download, initExport, showDrawio, svgExport } from "./app/export";
import { initHistory, recordHistory, redo, undo } from "./app/history";
import { initInspector, renderInspector } from "./app/inspector";
import { setSelection } from "./app/ops";
import { applyPanes, initPanels, initTabs, loadUi, saveUi } from "./app/panels";
import { highlight, render, renderMinimap } from "./app/render";
import { S } from "./app/state";
import { DEFS } from "./app/svg";
import { loadDraft, relayout, setText, toast } from "./app/sync";
import { CC } from "./app/views";

const EDGE_KEY = "modelith-edgestyle";

function setEdgeStyle(s: "ortho" | "curve"): void {
  S.edgeStyle = s;
  $("#btnEdge").textContent = s === "curve" ? "線：曲線" : "線：直角";
  store.set(EDGE_KEY, s);
}

function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

/** 新しいテキストを読み込む（選択と変化の比較をリセットする）。 */
function load(text: string): void {
  S.sel = null;
  S.selEdge = null;
  S.prevSig = new Map();
  setText(text);
  fit();
}

function initMenus(): void {
  document.addEventListener("click", (ev) => {
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
      if (!(ev.target instanceof Node) || !d.contains(ev.target)) d.open = false;
    });
  });
  const input = $<HTMLInputElement>("#fileInput");
  $("#btnOpen").onclick = () => {
    closeMenus();
    input.click();
  };
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const t = await f.text();
    input.value = "";
    load(t);
    toast(`「${f.name}」を読み込みました`);
  };
  $("#btnSaveText").onclick = () => {
    closeMenus();
    download("model.sysml", S.text, "text/plain;charset=utf-8");
  };
  $("#btnSaveSvg").onclick = () => {
    closeMenus();
    download(`modelith-${S.view}.svg`, svgExport(), "image/svg+xml");
  };
  $("#btnDrawio").onclick = () => {
    closeMenus();
    showDrawio();
  };
  $("#btnReset").onclick = () => {
    closeMenus();
    load(SAMPLE);
    toast("サンプルに戻しました");
  };
  $("#appVersion").textContent = __APP_VERSION__ + (__APP_COMMIT__ ? ` (${__APP_COMMIT__.slice(0, 7)})` : "");
  // AGPL §13：動いている版のソースを指す
  if (__APP_COMMIT__) $<HTMLAnchorElement>("#sourceLink").href = `https://github.com/modelith/modelith/tree/${__APP_COMMIT__}`;
}

function initToolbar(): void {
  $("#btnEdge").onclick = () => {
    setEdgeStyle(S.edgeStyle === "curve" ? "ortho" : "curve");
    render();
  };
  $("#btnLayout").onclick = () => {
    relayout();
    fit();
    toast("このビューを並べ直しました");
  };
  $("#miniHide").onclick = (ev) => {
    ev.stopPropagation();
    S.ui.mini = false;
    saveUi();
    renderMinimap();
  };
  $("#zMini").onclick = () => {
    S.ui.mini = !S.ui.mini;
    saveUi();
    renderMinimap();
  };
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    if (ev.target instanceof HTMLInputElement) return;
    const k = ev.key.toLowerCase();
    if (k === "a" && !isFormField(ev.target)) {
      ev.preventDefault();
      setSelection(CC().nodes.map((n) => n.key));
      render();
      highlight();
      renderInspector();
    } else if (k === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    } else if (k === "y") {
      ev.preventDefault();
      redo();
    }
  });
}

$("#defs").innerHTML = DEFS;
loadUi();
if (store.get(EDGE_KEY) === "curve") setEdgeStyle("curve");
initInspector();
initPanels();
initCanvas();
initCtxMenu();
initEditor();
initHistory();
initExport();
initMenus();
initToolbar();
const draft = loadDraft();
setText(draft?.trim() ? draft : SAMPLE, { noHistory: true });
recordHistory();
applyPanes();
initTabs();
