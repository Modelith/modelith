// Modelith の起動。各モジュールのイベントを登録し、前回の続き（無ければ公開サンプル）を読み込む。
import "@fontsource/ibm-plex-sans-jp/400.css";
import "@fontsource/ibm-plex-sans-jp/500.css";
import "@fontsource/ibm-plex-sans-jp/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import SAMPLE from "./samples/electric-kettle.sysml?raw";
import SAMPLE_LAYOUT from "./samples/electric-kettle.layout.json?raw";
import { initCanvas, fit } from "./app/canvas";
import { stageLabel } from "./app/stage";
import { initCtxMenu } from "./app/ctxmenu";
import { $, isFormField, store } from "./app/dom";
import { initEditor } from "./app/editor";
import { initWordHelp } from "./app/word-help";
import { initTextMode } from "./app/text-mode";
import { download, initExport, showDrawio, svgExport } from "./app/export";
import { initFiles } from "./app/files";
import { initHistory, redo, undo } from "./app/history";
import { initInspector, renderInspector } from "./app/inspector";
import { setSelection } from "./app/ops";
import { saveAsView } from "./app/view-ops";
import { applyPanes, initPanels, initTabs, loadUi, resumeTabs, saveUi, TABS_KEY, UI_KEY } from "./app/panels";
import { loadingView, watchLoading } from "./app/loading";
import { recoveryHtml, showStartupBox, startupErrorHtml } from "./app/recovery";
import { highlight, render, renderMinimap } from "./app/render";
import { S } from "./app/state";
import { DEFS } from "./app/svg";
import { attachCore, coreHooks, onAnalyzed, relayout, settled, toast } from "./app/sync";
import { installUnexpectedErrorHandlers } from "./app/unexpected";
import { CC } from "./app/views";
import { superviseCore } from "./core";
import CoreWorker from "./core/worker?worker";
import CORE_WASM from "./core/wasm/modelith_core_bg.wasm?url";

const EDGE_KEY = "modelith-edgestyle";

// 予期しない例外（捕まえていない例外・結果を待たない処理の失敗）の受け口は、ここに 1 つだけ置く（Q-7）。
// 黙って止まらずにトーストで知らせ、詳しい内容はコンソールに残す
installUnexpectedErrorHandlers(window, toast, (detail) => console.error("予期しない問題:", detail));

/**
 * 線の描き方を切り替え、ボタンの文言を合わせ、選んだ描き方を覚える（次に開いたときも使う）。図の描き直しはしない。
 *
 * @param s 線の描き方（"ortho" は直角、"curve" は曲線）
 */
function setEdgeStyle(s: "ortho" | "curve"): void {
  S.edgeStyle = s;
  $("#btnEdge").textContent = s === "curve" ? "線：曲線" : "線：直角";
  store.set(EDGE_KEY, s);
}

/** 開いているメニュー（details.menu）をすべて閉じる。 */
function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

/**
 * メニューを組み立てる。メニューの外をクリックしたら閉じ、SVG の保存・draw.io への書き出しのボタンをつなぎ、
 * 版・著作権・動いている版のソースとライセンスへのリンク（AGPL §13）を入れる。
 */
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
  // 見出しの札と「ヘルプ」の開発段階は、版の名前（alpha・beta・rc）から決める。正式版では出さない
  const stage = stageLabel(__APP_VERSION__);
  const badge = $("#stageBadge");
  badge.hidden = !stage;
  if (stage) {
    badge.textContent = stage.badge;
    badge.title = `${stage.note}です。保存形式や操作は予告なく変わります`;
  }
  $("#stageNote").textContent = stage ? `（${stage.note}）` : "";
  $("#appCopyright").textContent = __APP_COPYRIGHT__;
  // AGPL §13：動いている版のソースを指す
  if (__APP_COMMIT__) $<HTMLAnchorElement>("#sourceLink").href = `https://github.com/modelith/modelith/tree/${__APP_COMMIT__}`;
  // ライセンスの中身（AGPL-3.0・プラグイン例外・無保証）は、動いている版の GitHub のライセンスの節で読んでもらう
  if (__APP_COMMIT__) $<HTMLAnchorElement>("#licenseLink").href = `https://github.com/modelith/modelith/blob/${__APP_COMMIT__}/README.md#license`;
}

/**
 * ツールバーのボタン（ビューとして保存・線の描き方・並べ直し・ミニマップ）と、
 * キーボードの近道（Ctrl/⌘+A ですべて選ぶ、Ctrl/⌘+Z で元に戻す、Ctrl/⌘+Shift+Z・Ctrl/⌘+Y でやり直す）をつなぐ。
 */
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
// コアが止まった・返事をしないときは作り直す（Q-7）。待つ間に読み込みの始まったフォントも待ち、図を画面に合わせる計算を毎回同じ文字の幅で行う。
// 待つ間は「読み込み中…」（index.html の #loading）を示し、時間がかかれば案内に切り替えて待ち続ける（Q-5）
const loaded = watchLoading(loadingView(document.querySelector<HTMLElement>("#loading")));
try {
  const [core] = await Promise.all([superviseCore(() => new CoreWorker(), new URL(CORE_WASM, location.href).href, onAnalyzed, coreHooks), document.fonts.ready]);
  loaded();
  attachCore(core);
} catch (e) {
  loaded();
  showStartupBox(startupErrorHtml(e));
  // 続きの組み立てはしない（解析できないまま画面を組み立てると、壊れた状態で操作できてしまう）
  await new Promise<never>(() => {});
}

/**
 * 保存した設定（パネルの配置・図のタブ）を消して、ページを読み直す（Q-7）。下書き・前回の続き・プラグインの許可は消さない。
 */
function resetSettingsAndReload(): void {
  for (const key of [UI_KEY, TABS_KEY]) store.remove(key);
  location.reload();
}

// 画面の組み立て。途中で失敗したら、白い画面のままにせず、保存した設定を初期化して読み直す操作を示す（Q-7）
try {
  $("#defs").innerHTML = DEFS;
  loadUi();
  if (store.get(EDGE_KEY) === "curve") setEdgeStyle("curve");
  initInspector();
  initPanels();
  initCanvas();
  initCtxMenu();
  initEditor();
  initWordHelp();
  initTextMode();
  initHistory();
  initExport();
  initMenus();
  initToolbar();
  await initFiles({ name: "electric-kettle.sysml", text: SAMPLE, layout: SAMPLE_LAYOUT }, { onResumed: resumeTabs });
  // タブの対象を選び、図を画面に合わせるのは、最初の解析結果が届いてから
  await settled();
  applyPanes();
  initTabs();
} catch (e) {
  console.error("起動に失敗:", e);
  const box = showStartupBox(recoveryHtml(e));
  box.querySelector<HTMLButtonElement>("#btnResetSettings")?.addEventListener("click", resetSettingsAndReload);
}
