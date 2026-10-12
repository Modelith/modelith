// ファイル操作の UI（ADR-0010）：エクスプローラー・ファイルメニュー・ショートカット・未保存の警告・外部での変更の読み直し。
// 判断はワークスペース（web/src/workspace）に任せ、ここは操作を受けて結果を画面に出すだけ。

import { BrowserFileProvider, type PickedFile } from "../files/browser-file";
import { idbHandleStore } from "../files/idb-handle-store";
import { hasFsAccess, LocalFolderProvider, type FsApi } from "../files/local-folder";
import { ProviderRegistry, type DirEntry, type FileProvider, type SaveAsTarget } from "../files/types";
import { AutoSaver, browserTimer } from "../workspace/autosave";
import { kvDraftStore } from "../workspace/drafts";
import { Workspace, type Doc } from "../workspace/workspace";
import { fit } from "./canvas";
import { ask } from "./dialog";
import { $, closest, esc, store } from "./dom";
import { flushEdit } from "./editor";
import { download } from "./export";
import { dropHistory, recordHistory, useHistory } from "./history";
import { clearSel, S } from "./state";
import { onTextChange, setText, toast } from "./sync";

const AUTOSAVE_KEY = "modelith-autosave";
const SIDE_KEY = "modelith-side";

let ws: Workspace;
let local: LocalFolderProvider | null = null;
let browser: BrowserFileProvider;
let auto: AutoSaver;
let autoSave = false;
let recentName: string | null = null;
/** 開いているフォルダのツリーで、閉じているフォルダのパス。 */
const collapsed = new Set<string>();

/** まだ使われていない無題の名前。 */
function untitledName(): string {
  const used = new Set(ws.list().map((d) => d.name));
  let n = 1;
  while (used.has(`untitled-${n}.sysml`)) n++;
  return `untitled-${n}.sysml`;
}

/** 保存先を選ばせるときの保存先（フォルダを扱えればローカル、無理ならダウンロード）。 */
const saveTarget = (): SaveAsTarget => local ?? browser;

/* ---- 文書の表示 ---- */

/** 文書を表示中にし、テキストと図をその内容にする。 */
function showDoc(key: string): void {
  flushEdit();
  const doc = ws.get(key);
  if (!doc) return;
  ws.activate(key);
  useHistory(key);
  clearSel();
  S.prevSig = new Map();
  setText(doc.text, { noHistory: true });
  recordHistory();
  fit();
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

async function newFileInFolder(): Promise<void> {
  const r = await ask("新しいファイル", "フォルダからの相対パスで入力してください。", [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "作成", kind: "primary" },
  ], { value: "untitled.sysml", label: "ファイル名" });
  if (r?.id !== "ok") return;
  const path = r.value.trim();
  if (!/\.(sysml|kerml)$/i.test(path)) {
    toast("ファイル名は .sysml か .kerml で終えてください");
    return;
  }
  try {
    showDoc((await ws.createFile(path, "")).key);
  } catch (e) {
    toast(`作れませんでした：${(e as Error).message}`);
  }
}

/** 保存する（as なら名前を付けて保存）。競合したら利用者に選ばせる。 */
async function save(key: string, as = false): Promise<void> {
  flushEdit();
  const doc = ws.get(key);
  if (!doc) return;
  try {
    const wasUntitled = !doc.ref;
    const outcome = as ? await ws.saveAs(key, saveTarget()) : await ws.save(key, saveTarget());
    // 新しく作ったファイルが開いているフォルダの中かもしれないので、一覧を更新する
    if (outcome === "saved" && (as || wasUntitled)) await ws.refreshFolder();
    if (outcome === "conflict") await resolveConflict(key);
    else if (outcome === "saved") toast(ws.canWriteInPlace(doc) ? `「${doc.name}」を保存しました` : `「${doc.name}」をダウンロードしました`);
  } catch (e) {
    toast(`保存できませんでした：${(e as Error).message}`);
  }
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
    await ws.save(key, saveTarget(), { force: true });
    toast(`「${doc.name}」を上書きしました`);
  } else if (r?.id === "reload") {
    await ws.reload(key);
    if (ws.active()?.key === key) showDoc(key);
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
  const wasActive = ws.active()?.key === key;
  ws.close(key);
  dropHistory(key);
  if (wasActive) ensureDoc();
}

/* ---- 描画 ---- */

const dirtyMark = (d: Doc): string => (ws.isDirty(d) ? `<span class="dot" title="未保存の変更があります">●</span>` : "");
const staleMark = (d: Doc): string => (d.stale ? `<span class="st" title="他のアプリで変更されています">⚠</span>` : "");

function renderFiles(): void {
  const active = ws.active();
  const docs = ws.list()
    .map((d) => {
      const where = d.ref ? (ws.canWriteInPlace(d) ? d.ref.path : `${d.ref.name}（ダウンロードで保存）`) : "保存先なし（ブラウザに下書き保存）";
      return `<div class="fi${d.key === active?.key ? " sel" : ""}" data-doc="${esc(d.key)}" title="${esc(where)}" style="--d:0"><span class="ic">${d.ref ? "▤" : "✎"}</span><span class="nm">${esc(d.name)}</span>${staleMark(d)}${dirtyMark(d)}<button class="x" data-close="${esc(d.key)}" aria-label="閉じる">×</button></div>`;
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
    h += `<div class="sec"><span class="grow">フォルダ</span></div><div class="msg">このブラウザではフォルダを開けません（Chrome・Edge で使えます）。「ファイルを開く」で読み込み、保存はダウンロードになります。</div>`;
  }
  $("#explorer").innerHTML = h;
  // テキスト欄の見出しとタブの題名
  if (active) {
    $("#docName").innerHTML = esc(active.name) + staleMark(active) + (ws.isDirty(active) ? " ●" : "");
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

function chooseFile(): Promise<PickedFile | null> {
  const input = $<HTMLInputElement>("#fileInput");
  return new Promise((resolve) => {
    input.value = "";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
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
  cmd("#btnSave", () => void save(ws.active()?.key ?? ""));
  cmd("#btnSaveAs", () => void save(ws.active()?.key ?? "", true));
  $<HTMLButtonElement>("#btnOpenFolder").disabled = !local;
  $("#fileNote").textContent = local ? "保存先の無いファイルは、このブラウザに下書き保存されます" : "このブラウザでは、保存はダウンロードになります";
  const auto = $<HTMLInputElement>("#autoSave");
  auto.checked = autoSave;
  auto.onchange = () => {
    autoSave = auto.checked;
    store.set(AUTOSAVE_KEY, autoSave ? "1" : "0");
    const d = ws.active();
    if (autoSave && d) onEdited(d.key);
  };
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const k = ev.key.toLowerCase();
    const key = ws.active()?.key ?? "";
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
  const active = ws.active();
  if (!active) return;
  if (reloaded.includes(active.key)) {
    flushEdit();
    setText(active.text, { fromText: true });
    toast(`「${active.name}」が他のアプリで変更されたため、読み直しました`);
  } else if (active.stale) toast(`「${active.name}」が他のアプリで変更されています。保存するときに選べます`);
}

/** ファイル操作を初期化し、前回の下書き（無ければサンプル）を表示する。 */
export function initFiles(sample: { name: string; text: string }): void {
  const w = window as unknown as FsApi;
  local = hasFsAccess(window) ? new LocalFolderProvider(w, idbHandleStore) : null;
  browser = new BrowserFileProvider({ choose: chooseFile, download: (name, text) => download(name, text, "text/plain;charset=utf-8") });
  const providers: FileProvider[] = local ? [local, browser] : [browser];
  ws = new Workspace(new ProviderRegistry(providers), kvDraftStore(store));
  autoSave = store.get(AUTOSAVE_KEY) === "1";
  auto = new AutoSaver(ws, browserTimer, () => autoSave, (key, outcome) => {
    if (outcome === "conflict") toast(`「${ws.get(key)?.name ?? ""}」は他のアプリで変更されたため、自動保存しませんでした。保存（Ctrl+S）で選べます`);
  });
  onTextChange((text) => {
    const d = ws.active();
    if (!d) return;
    ws.setText(d.key, text);
    onEdited(d.key);
  });
  ws.subscribe(renderFiles);
  initMenu();
  initExplorer();
  $("#btnSample").onclick = () => {
    closeMenus();
    showDoc(ws.newUntitled(sample.name, sample.text).key);
  };
  window.addEventListener("beforeunload", (ev) => {
    flushEdit();
    if (ws.hasUnsavedFiles()) ev.preventDefault();
  });
  window.addEventListener("focus", () => void checkExternal());
  if (!ws.restoreDrafts()) ws.newUntitled(sample.name, sample.text);
  ensureDoc();
  renderFiles();
  void local?.recentFolder().then((name) => {
    recentName = name;
    renderFiles();
  });
}
