// ファイル操作の UI（ADR-0010）：エクスプローラー・ファイルメニュー・ショートカット・未保存の警告・外部での変更の読み直し。
// 判断はワークスペース（web/src/workspace）に任せ、ここは操作を受けて結果を画面に出すだけ。

import { parse, removeLayoutComment } from "../core";
import { BrowserFileProvider, type PickedFile } from "../files/browser-file";
import { idbHandleStore } from "../files/idb-handle-store";
import { hasFsAccess, LocalFolderProvider, type FsApi } from "../files/local-folder";
import { ProviderRegistry, type DirEntry, type FileProvider } from "../files/types";
import { AutoSaver, browserTimer } from "../workspace/autosave";
import { kvDraftStore } from "../workspace/drafts";
import { layoutNameFor, suggestName, Workspace, type Doc } from "../workspace/workspace";
import { fit } from "./canvas";
import { ask } from "./dialog";
import { $, closest, esc, store } from "./dom";
import { flushEdit } from "./editor";
import { download } from "./export";
import { dropHistory, recordHistory, useHistory } from "./history";
import { layoutFromJson, type Layout } from "./layout";
import { isEmptyLayout, parseLayoutFile, serializeLayout } from "./layout-file";
import { clearSel, S } from "./state";
import { loadLayout, onLayoutChange, onTextChange, setText, toast } from "./sync";

const AUTOSAVE_KEY = "modelith-autosave";
const SIDE_KEY = "modelith-side";

let ws: Workspace;
let local: LocalFolderProvider | null = null;
let browser: BrowserFileProvider;
let auto: AutoSaver;
let autoSave = false;
let recentName: string | null = null;
/**
 * テキスト欄に表示している文書。編集はこの文書に書き込む。
 * ワークスペースの「表示中」は開く操作の途中で先に切り替わるため、それに頼ると入力の反映待ちが別の文書に入る。
 */
let shownKey: string | null = null;
/** 開いているフォルダのツリーで、閉じているフォルダのパス。 */
const collapsed = new Set<string>();
/** 古い形式の配置を移すか、もう尋ねた文書（ファイルを開いたときに一度だけ尋ねる、C-6）。 */
const legacyAsked = new Set<string>();

/** まだ使われていない無題の名前。 */
function untitledName(): string {
  const used = new Set(ws.list().map((d) => d.name));
  let n = 1;
  while (used.has(`untitled-${n}.sysml`)) n++;
  return `untitled-${n}.sysml`;
}

/** テキスト欄に表示している文書の名前（新しい package の名前の候補に使う）。 */
export const shownDocName = (): string => (shownKey ? ws.get(shownKey)?.name : undefined) ?? "untitled.sysml";

/* ---- 文書の表示 ---- */

/**
 * 文書の配置を読む。配置ファイルが無ければ、古い形式（テキスト内の @layout コメント）から読む（ADR-0005 の移行）。
 * 古い形式から読んだ配置は、開いたときの状態として扱い、変更の印は付けない。
 */
function layoutOf(doc: Doc): { layout: Layout; legacy: boolean } {
  if (doc.layout) {
    const { layout, error } = parseLayoutFile(doc.layout);
    if (error) toast(`${doc.name}：${error}`);
    return { layout, legacy: false };
  }
  const layout = layoutFromJson(parse(doc.text).layout);
  const legacy = !isEmptyLayout(layout);
  if (legacy) ws.initLayout(doc.key, serializeLayout(layout));
  return { layout, legacy };
}

/** 文書を表示中にし、テキストと図をその内容にする。 */
function showDoc(key: string): void {
  flushEdit(); // 反映待ちの入力は、切り替える前の文書（shownKey）に書き込む
  const doc = ws.get(key);
  if (!doc) return;
  shownKey = key;
  ws.activate(key);
  useHistory(key);
  clearSel();
  S.prevSig = new Map();
  const { layout, legacy } = layoutOf(doc);
  loadLayout(layout);
  setText(doc.text, { noHistory: true });
  recordHistory();
  fit();
  // 配置ファイルに移せるときだけ尋ねる（保存先の無い文書では移せない）
  if (legacy && doc.layoutHome === "sibling" && !legacyAsked.has(key)) void offerLegacyMove(key);
}

/** 古い形式の配置（@layout コメント）を配置ファイルに移すかを尋ねる。黙って消さない（ADR-0005、C-6）。 */
async function offerLegacyMove(key: string): Promise<void> {
  legacyAsked.add(key);
  const doc = ws.get(key);
  if (!doc) return;
  const r = await ask("古い形式の配置", `「${doc.name}」のテキストには、図の配置（@layout コメント）が書かれています。配置ファイル ${layoutNameFor(doc.name)} に移して、テキストからコメントを消しますか？ 保存するまで、ファイルは変わりません。`, [
    { id: "keep", label: "そのままにする" },
    { id: "move", label: "配置ファイルに移す", kind: "primary" },
  ]);
  if (r?.id !== "move" || shownKey !== key) return;
  const text = removeLayoutComment(doc.text);
  ws.moveLegacyLayout(key, text);
  setText(text, { fromText: true });
  toast(`保存すると、配置は ${layoutNameFor(doc.name)} に移ります`);
}

/** 表示中の文書が無くなったら、空の無題の文書を作る（テキストは常に 1 つ表示する）。 */
function ensureDoc(): void {
  const doc = ws.active() ?? ws.list()[0];
  showDoc(doc ? doc.key : ws.newUntitled(untitledName(), "").key);
}

/* ---- コマンド ---- */

async function openFile(): Promise<void> {
  const picker = local ?? browser;
  try {
    const doc = await ws.openWith(picker);
    if (doc) showDoc(doc.key);
  } catch (e) {
    toast(`開けませんでした：${(e as Error).message}`);
  }
}

async function openFolder(reopen = false): Promise<void> {
  if (!local) return;
  try {
    const ok = reopen ? await ws.reopenFolder(local) : await ws.openFolder(local);
    if (ok) showSide("files");
    else if (reopen) toast("フォルダを開く許可が得られませんでした");
  } catch (e) {
    toast(`フォルダを開けませんでした：${(e as Error).message}`);
  }
}

function newUntitled(): void {
  showDoc(ws.newUntitled(untitledName(), "").key);
}

/** モデルのファイル名として使えるか（使えなければ理由を伝える）。 */
function isModelPath(path: string): boolean {
  if (/\.(sysml|kerml)$/i.test(path)) return true;
  toast("ファイル名は .sysml か .kerml で終えてください");
  return false;
}

async function newFileInFolder(): Promise<void> {
  const r = await ask("新しいファイル", "フォルダからの相対パスで入力してください。", [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "作成", kind: "primary" },
  ], { value: "untitled.sysml", label: "ファイル名" });
  if (r?.id !== "ok") return;
  const path = r.value.trim();
  if (!isModelPath(path)) return;
  try {
    showDoc((await ws.createFile(path, "")).key);
  } catch (e) {
    toast(`作れませんでした：${(e as Error).message}`);
  }
}

/**
 * 保存する（as なら名前を付けて保存）。競合したら利用者に選ばせる。
 * 配置の保存先が無いときは、保存先を選んでもらう（ADR-0005、F-VIEW-6）。
 */
async function save(key: string, as = false): Promise<void> {
  flushEdit();
  const doc = ws.get(key);
  if (!doc) return;
  try {
    // フォルダを扱えるブラウザでは、新しいファイルはフォルダと名前を選んでもらい、配置ファイルも隣に作る
    if (local && (as || !doc.ref)) return await saveIntoFolder(key);
    const outcome = as ? await ws.saveAs(key, browser) : await ws.save(key, browser);
    if (outcome === "conflict") return await resolveConflict(key);
    if (outcome !== "saved") return;
    toast(ws.canWriteInPlace(doc) ? `「${doc.name}」を保存しました` : `「${doc.name}」をダウンロードしました`);
    if (ws.layoutUnsaved(doc)) await offerFolderForLayout(key);
  } catch (e) {
    toast(`保存できませんでした：${(e as Error).message}`);
  }
}

/** 保存先のフォルダ（開いていなければ選んでもらう）と名前を選んでもらい、モデルと配置ファイルを一緒に作る。 */
async function saveIntoFolder(key: string): Promise<void> {
  if (!local) return;
  if (!ws.folder()) {
    if (!(await ws.openFolder(local))) return;
    showSide("files");
  }
  const doc = ws.get(key);
  const f = ws.folder();
  if (!doc || !f) return;
  const r = await ask("名前を付けて保存", `フォルダ「${f.ref.name}」に保存します。フォルダからの相対パスで入力してください。図の配置は、隣の配置ファイル（.layout.json）に一緒に保存します。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "保存", kind: "primary" },
  ], { value: doc.ref?.path ?? suggestName(doc.name), label: "ファイル名" });
  if (r?.id !== "ok") return;
  const path = r.value.trim();
  if (!isModelPath(path)) return;
  await ws.saveToFolder(key, path);
  toast(`「${doc.name}」を保存しました`);
}

/** 1 つだけ開いたファイルの配置に保存先が無いとき、そのファイルのあるフォルダを開くよう尋ねる（F-VIEW-6）。 */
async function offerFolderForLayout(key: string): Promise<void> {
  const doc = ws.get(key);
  if (!doc || !local) return;
  const layoutName = layoutNameFor(doc.name);
  const r = await ask("配置の保存先", `「${doc.name}」だけを開いているため、図の配置を保存する場所がありません。このファイルのあるフォルダを開くと、隣の ${layoutName} に配置を保存できます。`, [
    { id: "later", label: "あとで" },
    { id: "open", label: "フォルダを開く", kind: "primary" },
  ]);
  if (r?.id !== "open") return;
  const outcome = await ws.attachToFolder(key, local);
  if (outcome === "notInFolder") return toast(`選んだフォルダに「${doc.name}」がありません。配置は未保存のままです`);
  if (outcome !== "attached") return;
  showSide("files");
  if ((await ws.save(key, browser)) === "saved") toast(`配置を ${layoutName} に保存しました`);
}

async function resolveConflict(key: string): Promise<void> {
  const doc = ws.get(key);
  if (!doc) return;
  const r = await ask("ファイルが他で変更されています", `「${doc.name}」は開いた後に他のアプリで変更されました。どうしますか？`, [
    { id: "cancel", label: "やめる" },
    { id: "reload", label: "ファイルの内容を読み込む（自分の変更を捨てる）" },
    { id: "overwrite", label: "自分の内容で上書きする", kind: "danger" },
  ]);
  if (r?.id === "overwrite") {
    await ws.save(key, browser, { force: true });
    toast(`「${doc.name}」を上書きしました`);
  } else if (r?.id === "reload") {
    await ws.reload(key);
    if (shownKey === key) showDoc(key);
  }
}

/** 文書を閉じる。失われる変更があれば確かめる。 */
async function closeDoc(key: string): Promise<void> {
  const doc = ws.get(key);
  if (!doc) return;
  if (ws.isDirty(doc) || (!doc.ref && doc.text.trim())) {
    const r = await ask("閉じる前に", doc.ref ? `「${doc.name}」の変更を保存しますか？` : `「${doc.name}」は保存先がありません。保存しますか？`, [
      { id: "cancel", label: "やめる" },
      { id: "discard", label: "保存しない", kind: "danger" },
      { id: "save", label: "保存する", kind: "primary" },
    ]);
    if (!r || r.id === "cancel") return;
    if (r.id === "save") {
      await save(key);
      if (ws.isDirty(doc) || !doc.ref) return; // 保存をやめた・競合した
    }
  }
  const wasActive = shownKey === key;
  ws.close(key);
  dropHistory(key);
  if (wasActive) ensureDoc();
}

/* ---- 描画 ---- */

const dirtyMark = (d: Doc): string => (ws.isDirty(d) ? `<span class="dot" title="未保存の変更があります">●</span>` : "");
/** 配置を変えたが保存先が無い（F-VIEW-6）。 */
const layoutMark = (d: Doc): string =>
  d.ref && ws.layoutUnsaved(d) ? `<span class="lu" title="このファイルの配置の保存先がありません。フォルダを開くと、隣の配置ファイルに保存できます">配置は未保存</span>` : "";
const staleMark = (d: Doc): string => (d.stale ? `<span class="st" title="他のアプリで変更されています">⚠</span>` : "");

function renderFiles(): void {
  const active = ws.active();
  const docs = ws.list()
    .map((d) => {
      const where = d.ref ? (ws.canWriteInPlace(d) ? d.ref.path : `${d.ref.name}（ダウンロードで保存）`) : "保存先なし（ブラウザに下書き保存）";
      return `<div class="fi${d.key === active?.key ? " sel" : ""}" data-doc="${esc(d.key)}" title="${esc(where)}" style="--d:0"><span class="ic">${d.ref ? "▤" : "✎"}</span><span class="nm">${esc(d.name)}</span>${staleMark(d)}${dirtyMark(d)}${layoutMark(d)}<button class="x" data-close="${esc(d.key)}" aria-label="閉じる">×</button></div>`;
    })
    .join("");
  let h = `<div class="sec"><span class="grow">開いているファイル</span><button data-cmd="new" title="新しいファイル">＋</button></div>${docs}`;
  const f = ws.folder();
  if (f) {
    h += `<div class="sec"><span class="grow" title="${esc(f.ref.name)}">${esc(f.ref.name.toUpperCase())}</span><button data-cmd="newInFolder" title="このフォルダに新しいファイル">＋</button><button data-cmd="refresh" title="一覧を更新">↻</button></div>`;
    h += f.entries.length ? folderRows(f.entries, 0) : `<div class="msg">.sysml / .kerml のファイルがありません。</div>`;
  } else if (local) {
    h += `<div class="sec"><span class="grow">フォルダ</span></div><div class="msg">フォルダを開くと、中の .sysml ファイルを一覧して編集・上書き保存できます。<br><button data-cmd="openFolder" class="primary">フォルダを開く</button>`;
    if (recentName) h += `<br><button data-cmd="reopen">前回のフォルダ「${esc(recentName)}」を開く</button>`;
    h += `</div>`;
  } else {
    h += `<div class="sec"><span class="grow">フォルダ</span></div><div class="msg">このブラウザではフォルダを開けません（Chrome・Edge で使えます）。「ファイルを開く」で読み込み、保存はダウンロードになります。図の配置ファイル（.layout.json）は、モデルと一緒に選ぶと読み込みます。</div>`;
  }
  $("#explorer").innerHTML = h;
  // テキスト欄の見出しとタブの題名
  if (active) {
    $("#docName").innerHTML = esc(active.name) + staleMark(active) + (ws.isDirty(active) ? " ●" : "") + layoutMark(active);
    document.title = `${ws.isDirty(active) ? "● " : ""}${active.name} — Modelith`;
  }
}

function folderRows(entries: DirEntry[], depth: number): string {
  const active = ws.active();
  return entries
    .map((e) => {
      if (e.kind === "dir") {
        const open = !collapsed.has(e.path);
        return `<div class="fi" data-dir="${esc(e.path)}" style="--d:${depth}"><span class="ic">${open ? "▾" : "▸"}</span><span class="nm">${esc(e.name)}</span></div>` + (open ? folderRows(e.children, depth + 1) : "");
      }
      const doc = ws.list().find((d) => d.ref?.provider === e.ref.provider && d.ref.id === e.ref.id);
      const sel = !!doc && doc.key === active?.key;
      return `<div class="fi${sel ? " sel" : ""}" data-file="${esc(e.ref.id)}" style="--d:${depth}" title="${esc(e.ref.path)}"><span class="ic">▤</span><span class="nm">${esc(e.ref.name)}</span>${doc ? staleMark(doc) + dirtyMark(doc) : ""}</div>`;
    })
    .join("");
}

function findEntry(entries: DirEntry[], id: string): DirEntry | undefined {
  for (const e of entries) {
    if (e.kind === "file" && e.ref.id === id) return e;
    if (e.kind === "dir") {
      const hit = findEntry(e.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

function showSide(which: "files" | "model"): void {
  $("#filesSide").hidden = which !== "files";
  $("#modelSide").hidden = which !== "model";
  $("#sideFiles").setAttribute("aria-selected", String(which === "files"));
  $("#sideModel").setAttribute("aria-selected", String(which === "model"));
  store.set(SIDE_KEY, which);
}

/* ---- 登録 ---- */

/** ファイルを選ばせる。モデルと配置ファイルを一緒に選べる（ADR-0005）。 */
function chooseFiles(): Promise<PickedFile[]> {
  const input = $<HTMLInputElement>("#fileInput");
  return new Promise((resolve) => {
    input.value = "";
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

function initMenu(): void {
  const cmd = (id: string, fn: () => void): void => {
    $(id).onclick = () => {
      closeMenus();
      fn();
    };
  };
  cmd("#btnNew", newUntitled);
  cmd("#btnOpen", () => void openFile());
  cmd("#btnOpenFolder", () => void openFolder());
  cmd("#btnSave", () => void save(shownKey ?? ""));
  cmd("#btnSaveAs", () => void save(shownKey ?? "", true));
  $<HTMLButtonElement>("#btnOpenFolder").disabled = !local;
  $("#fileNote").textContent = local ? "保存先の無いファイルは、このブラウザに下書き保存されます" : "このブラウザでは、保存はダウンロードになります。図の配置は .layout.json として一緒にダウンロードされ、開くときに 2 つを一緒に選ぶと戻ります";
  const auto = $<HTMLInputElement>("#autoSave");
  auto.checked = autoSave;
  auto.onchange = () => {
    autoSave = auto.checked;
    store.set(AUTOSAVE_KEY, autoSave ? "1" : "0");
    if (autoSave && shownKey) onEdited(shownKey);
  };
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const k = ev.key.toLowerCase();
    const key = shownKey ?? "";
    if (k === "s") {
      ev.preventDefault();
      void save(key, ev.shiftKey);
    } else if (k === "o") {
      ev.preventDefault();
      void openFile();
    }
  });
}

function initExplorer(): void {
  $("#sideFiles").onclick = () => showSide("files");
  $("#sideModel").onclick = () => showSide("model");
  showSide(store.get(SIDE_KEY) === "model" ? "model" : "files");
  $("#explorer").addEventListener("click", (ev) => {
    const close = closest(ev, "[data-close]");
    if (close) {
      ev.stopPropagation();
      void closeDoc(close.dataset["close"] ?? "");
      return;
    }
    const c = closest(ev, "[data-cmd]")?.dataset["cmd"];
    if (c === "new") return newUntitled();
    if (c === "newInFolder") return void newFileInFolder();
    if (c === "refresh") return void ws.refreshFolder();
    if (c === "openFolder") return void openFolder();
    if (c === "reopen") return void openFolder(true);
    const doc = closest(ev, "[data-doc]")?.dataset["doc"];
    if (doc) return showDoc(doc);
    const dir = closest(ev, "[data-dir]")?.dataset["dir"];
    if (dir !== undefined) {
      if (collapsed.has(dir)) collapsed.delete(dir);
      else collapsed.add(dir);
      return renderFiles();
    }
    const id = closest(ev, "[data-file]")?.dataset["file"];
    const f = ws.folder();
    const e = id && f ? findEntry(f.entries, id) : undefined;
    if (e?.kind === "file") {
      void ws.openRef(e.ref).then(
        (d) => showDoc(d.key),
        (err: Error) => toast(`開けませんでした：${err.message}`),
      );
    }
  });
}

/** 文書が編集されたとき（ワークスペースへの反映と自動保存）。 */
function onEdited(key: string): void {
  auto.notify(key);
}

/** 画面に戻ったとき、他のアプリでの変更を確かめる（F-FILE-8）。 */
async function checkExternal(): Promise<void> {
  const reloaded = await ws.checkExternal();
  const active = shownKey ? ws.get(shownKey) : undefined;
  if (!active) return;
  if (reloaded.includes(active.key)) {
    flushEdit();
    setText(active.text, { fromText: true });
    toast(`「${active.name}」が他のアプリで変更されたため、読み直しました`);
  } else if (active.stale) toast(`「${active.name}」が他のアプリで変更されています。保存するときに選べます`);
}

/** ファイル操作を初期化し、前回の下書き（無ければサンプル）を表示する。 */
export function initFiles(sample: { name: string; text: string; layout: string }): void {
  const w = window as unknown as FsApi;
  local = hasFsAccess(window) ? new LocalFolderProvider(w, idbHandleStore) : null;
  browser = new BrowserFileProvider({ choose: chooseFiles, download: (name, text) => download(name, text, "text/plain;charset=utf-8") });
  const providers: FileProvider[] = local ? [local, browser] : [browser];
  ws = new Workspace(new ProviderRegistry(providers), kvDraftStore(store));
  autoSave = store.get(AUTOSAVE_KEY) === "1";
  auto = new AutoSaver(ws, browserTimer, () => autoSave, (key, outcome) => {
    if (outcome === "conflict") toast(`「${ws.get(key)?.name ?? ""}」は他のアプリで変更されたため、自動保存しませんでした。保存（Ctrl+S）で選べます`);
  });
  onTextChange((text) => {
    if (!shownKey) return;
    ws.setText(shownKey, text);
    onEdited(shownKey);
  });
  onLayoutChange((layout) => {
    if (!shownKey) return;
    ws.setLayout(shownKey, layout);
    onEdited(shownKey);
  });
  ws.subscribe(renderFiles);
  initMenu();
  initExplorer();
  $("#btnSample").onclick = () => {
    closeMenus();
    showDoc(ws.newUntitled(sample.name, sample.text, sample.layout).key);
  };
  window.addEventListener("beforeunload", (ev) => {
    flushEdit();
    if (ws.hasUnsavedFiles()) ev.preventDefault();
  });
  window.addEventListener("focus", () => void checkExternal());
  if (!ws.restoreDrafts()) ws.newUntitled(sample.name, sample.text, sample.layout);
  ensureDoc();
  renderFiles();
  void local?.recentFolder().then((name) => {
    recentName = name;
    renderFiles();
  });
}
