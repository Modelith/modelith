// Modelith の起動。各モジュールのイベントを登録し、下書き（無ければ公開サンプル）を読み込む。
import "@fontsource/ibm-plex-sans-jp/400.css";
import "@fontsource/ibm-plex-sans-jp/500.css";
import "@fontsource/ibm-plex-sans-jp/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import SAMPLE from "./samples/electric-kettle.sysml?raw";
import SAMPLE_LAYOUT from "./samples/electric-kettle.layout.json?raw";
import { initCanvas, fit } from "./app/canvas";
import { initCtxMenu } from "./app/ctxmenu";
import { $, isFormField, store } from "./app/dom";
import { initEditor } from "./app/editor";
import { download, initExport, showDrawio, svgExport } from "./app/export";
import { initFiles } from "./app/files";
import { initHistory, redo, undo } from "./app/history";
import { initInspector, renderInspector } from "./app/inspector";
import { setSelection } from "./app/ops";
import { saveAsView } from "./app/view-ops";
import { applyPanes, initPanels, initTabs, loadUi, saveUi } from "./app/panels";
import { highlight, render, renderMinimap } from "./app/render";
import { S } from "./app/state";
import { DEFS } from "./app/svg";
import { attachCore, onAnalyzed, relayout, settled, toast } from "./app/sync";
import { CC } from "./app/views";
import { startCore } from "./core";
import CoreWorker from "./core/worker?worker";
import CORE_WASM from "./core/wasm/modelith_core_bg.wasm?url";

const EDGE_KEY = "modelith-edgestyle";

function setEdgeStyle(s: "ortho" | "curve"): void {
  S.edgeStyle = s;
  $("#btnEdge").textContent = s === "curve" ? "線：曲線" : "線：直角";
  store.set(EDGE_KEY, s);
}

function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

function initMenus(): void {
  document.addEventListener("click", (ev) => {
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
      if (!(ev.target instanceof Node) || !d.contains(ev.target)) d.open = false;
    });
  });
  $("#btnSaveSvg").onclick = () => {
    closeMenus();
    download(`modelith-${S.view}.svg`, svgExport(), "image/svg+xml");
  };
  $("#btnDrawio").onclick = () => {
    closeMenus();
    showDrawio();
  };
  $("#appVersion").textContent = __APP_VERSION__ + (__APP_COMMIT__ ? ` (${__APP_COMMIT__.slice(0, 7)})` : "");
  $("#appCopyright").textContent = __APP_COPYRIGHT__;
  // AGPL §13：動いている版のソースを指す
  if (__APP_COMMIT__) $<HTMLAnchorElement>("#sourceLink").href = `https://github.com/modelith/modelith/tree/${__APP_COMMIT__}`;
  // ライセンスの中身（AGPL-3.0・プラグイン例外・無保証）は、動いている版の GitHub のライセンスの節で読んでもらう
  if (__APP_COMMIT__) $<HTMLAnchorElement>("#licenseLink").href = `https://github.com/modelith/modelith/blob/${__APP_COMMIT__}/README.md#license`;
}

function initToolbar(): void {
  $("#btnSaveView").onclick = () => void saveAsView();
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

// 解析と図の操作に使う Rust のコア（wasm）を Worker で動かし、使える状態になってから画面を組み立てる（ADR-0015・ADR-0016）。
// 待つ間に読み込みの始まったフォントも待ち、図を画面に合わせる計算を毎回同じ文字の幅で行う
try {
  const [core] = await Promise.all([startCore(new CoreWorker(), new URL(CORE_WASM, location.href).href, onAnalyzed), document.fonts.ready]);
  attachCore(core);
} catch (e) {
  showStartupError(e);
  // 続きの組み立てはしない（解析できないまま画面を組み立てると、壊れた状態で操作できてしまう）
  await new Promise<never>(() => {});
}

/** 起動できなかったことを、画面の真ん中に出す（通信の失敗や、WebAssembly を使えない古いブラウザ）。 */
function showStartupError(e: unknown): void {
  const box = document.createElement("div");
  box.id = "startupError";
  box.setAttribute("role", "alert");
  box.innerHTML =
    "<b>Modelith を起動できませんでした</b>" +
    "<p>テキストを読み取る部品を読み込めませんでした。ページを読み込み直してください。" +
    "直らないときは、新しいブラウザ（Chrome・Edge・Firefox・Safari の最新版）で開いてください。</p>";
  const detail = document.createElement("small");
  detail.textContent = e instanceof Error ? e.message : String(e);
  box.append(detail);
  document.body.append(box);
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
initFiles({ name: "electric-kettle.sysml", text: SAMPLE, layout: SAMPLE_LAYOUT });
// タブの対象を選び、図を画面に合わせるのは、最初の解析結果が届いてから
await settled();
applyPanes();
initTabs();
