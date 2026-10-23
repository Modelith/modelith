// ファイル操作の UI（ADR-0010）：エクスプローラー・ファイルメニュー・ショートカット・未保存の警告・外部での変更の読み直し。
// 判断はワークスペース（web/src/workspace）に任せ、ここは操作を受けて結果を画面に出すだけ。

import { readLayout, removeLayoutComment, type ProjectFileResult } from "../core";
import { BrowserFileProvider, type PickedFile } from "../files/browser-file";
import { idbHandleStore } from "../files/idb-handle-store";
import { hasFsAccess, LocalFolderProvider, MAX_TREE_FILES, type FsApi } from "../files/local-folder";
import { hasFolderFiles, ProviderRegistry, type DirEntry, type FileProvider } from "../files/types";
import { AutoSaver, browserTimer } from "../workspace/autosave";
import { kvDraftStore } from "../workspace/drafts";
import { filesChange } from "../workspace/project-files";
import { afterRestore, findFile, kvSessionStore, planStart, sampleDraft, type Session } from "../workspace/session";
import { layoutNameFor, PROJECT_FILE, suggestName, Workspace, type Doc, type StartWith } from "../workspace/workspace";
import { fit } from "./canvas";
import { ask } from "./dialog";
import { $, closest, esc, store } from "./dom";
import { flushEdit } from "./editor";
import { download } from "./export";
import { dropHistory, recordHistory, useHistory } from "./history";
import { layoutFromJson, type Layout } from "./layout";
import { isEmptyLayout, parseLayoutFile, serializeLayout } from "./layout-file";
import { clearSel, S } from "./state";
import { addPlugin, initPlugins, openPlugins, pluginExplorerHtml, reloadPlugins, type PickedPluginFolder } from "./plugin-panel";
import { pluginFolderPath } from "./plugins";
import { idbBrowserPlugins, idbPluginData } from "../plugins/browser-store";
import { importedDocName } from "../plugins/transfer";
import { projectNotice, projectTitle } from "./project";
import { coreClient, loadLayout, onAnalyzedProject, onLayoutChange, onTextChange, renderProblems, setText, settled, toast, toastFailure } from "./sync";
import { switchDocTabs } from "./panels";
import { docTabsId } from "./doc-tabs";
import { fileProblems, fileStatus, folderStatus, statusBadge, statusClass, type FileStatus } from "./project-problems";
import { scrollEditorTo } from "./render";
import { opsIdle } from "./intent";
import { onOpenProjectFile } from "./other-file";

const AUTOSAVE_KEY = "modelith-autosave";
const SIDE_KEY = "modelith-side";

/** 仮に開いたファイルの案内（F-FILE-17）。 */
const PREVIEW_HINT = "仮に開いています。編集するか、ダブルクリックすると開いたままになります";
/** 横のパネルの種類。 */
type Side = "files" | "model" | "views";
/** 設定「起動時にサンプルを開く」を有効にしたら "1" を置くキー（F-FILE-13）。 */
const START_SAMPLE_KEY = "modelith-start-sample";

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
/** 読み取りを頼んだプロジェクトの設定ファイル（フォルダの id と設定ファイルのテキスト）。無ければ null。 */
let projectKey: string | null = null;
/** 開いているフォルダのプロジェクトの設定を読み取った結果（ADR-0019）。まだ読み取っていない・設定ファイルが無ければ null。 */
let project: ProjectFileResult | null = null;
/** サンプルの文書（起動したときに開く）。 */
let sampleDoc: Sample;
/**
 * 「前回の続きを開く」を示して、利用者の操作を待っている前回の続き（F-FILE-13）。フォルダを開く許可が要るときだけ。
 * folder は前回のフォルダの名前、drafts は起動したときに下書きを戻した結果。待っていなければ null。
 */
let resumeAsk: { session: Session; folder: string; drafts: StartWith } | null = null;
/** 「前回の続きを開く」で前回の続きを戻し、その解析結果が届いた後に呼ぶ（図のタブを戻す）。 */
let onResumed: () => void = () => {};

/**
 * まだ使われていない無題の名前を作る（untitled-1.sysml から順に空いている番号）。
 *
 * @returns 無題のファイル名
 * @example
 * // 開いている文書が無い
 * untitledName() // → "untitled-1.sysml"
 * // untitled-1.sysml を開いている
 * untitledName() // → "untitled-2.sysml"
 */
function untitledName(): string {
  const used = new Set(ws.list().map((d) => d.name));
  let n = 1;
  while (used.has(`untitled-${n}.sysml`)) n++;
  return `untitled-${n}.sysml`;
}

/**
 * テキスト欄に表示している文書の名前を返す（新しい package の名前の候補に使う。F-EDIT-7）。
 *
 * @returns 文書の名前。表示している文書が無ければ "untitled.sysml"
 * @example
 * // vehicle.sysml を表示中
 * shownDocName() // → "vehicle.sysml"
 * // 表示している文書が無い
 * shownDocName() // → "untitled.sysml"
 */
export const shownDocName = (): string => (shownKey ? ws.get(shownKey)?.name : undefined) ?? "untitled.sysml";

/* ---- 文書の表示 ---- */

/**
 * 文書の配置を読む。配置ファイルが無ければ、古い形式（テキスト内の @layout コメント）から読む（ADR-0005 の移行）。
 * 古い形式から読んだ配置は、開いたときの状態として扱い、変更の印は付けない（ワークスペースの配置の初期値にする）。
 * 配置ファイルが読めなければ、理由をトーストで知らせる。
 *
 * @param doc 文書
 * @returns 配置と、古い形式から読んだか（legacy）
 * @example
 * // 配置ファイルのある文書
 * layoutOf(doc) // → { layout: 配置ファイルの配置, legacy: false }
 * // 配置ファイルが無く、テキストに @layout コメントも無い
 * layoutOf(doc) // → { layout: 空の配置, legacy: false }
 */
function layoutOf(doc: Doc): { layout: Layout; legacy: boolean } {
  if (doc.layout) {
    const { layout, error } = parseLayoutFile(doc.layout);
    if (error) toast(`${doc.name}：${error}`);
    return { layout, legacy: false };
  }
  const layout = layoutFromJson(readLayout(doc.text, []));
  const legacy = !isEmptyLayout(layout);
  if (legacy) ws.initLayout(doc.key, serializeLayout(layout));
  return { layout, legacy };
}

/**
 * 文書を表示中にし、テキストと図をその内容にする（F-FILE-4）。反映待ちの入力は切り替える前の文書に書き込み、
 * 履歴を文書のものに切り替え、選択を解く。解析結果が届いたら図を画面に合わせ、
 * 古い形式の配置があれば配置ファイルに移すかを一度だけ尋ねる。key の文書が無ければ何もしない。
 *
 * @param key 文書のキー
 */
function showDoc(key: string): void {
  flushEdit(); // 反映待ちの入力は、切り替える前の文書（shownKey）に書き込む
  const doc = ws.get(key);
  if (!doc) return;
  endResumeAsk();
  shownKey = key;
  coreClient().focus(ws.folderPath(key));
  ws.activate(key);
  useHistory(key);
  clearSel();
  S.prevSig = new Map();
  const { layout, legacy } = layoutOf(doc);
  loadLayout(layout);
  setText(doc.text, { noHistory: true });
  // 図のタブは、ファイルごとに最後に開いていたものに戻す（F-VIEW-17）
  switchDocTabs(docTabsId(doc));
  recordHistory();
  // 図を画面に合わせるのは、その文書の解析結果が届いてから（ADR-0016）
  void settled().then(() => {
    if (shownKey === key) fit();
  });
  // 配置ファイルに移せるときだけ尋ねる（保存先の無い文書では移せない）
  if (legacy && doc.layoutHome === "sibling" && !legacyAsked.has(key)) void offerLegacyMove(key);
}

/**
 * 古い形式の配置（@layout コメント）を配置ファイルに移すかを尋ねる。黙って消さない（ADR-0005、C-6）。
 * 移すを選べば、テキストからコメントを消して配置ファイル側に移す（保存するまでファイルは変わらない）。
 *
 * @param key 文書のキー
 */
async function offerLegacyMove(key: string): Promise<void> {
  legacyAsked.add(key);
  const doc = ws.get(key);
  if (!doc) return;
  const r = await ask("図の配置を整理します", `「${doc.name}」には、以前の Modelith がモデルのテキストの中に書き込んだ図の配置（要素の位置）があります。配置を別のファイル（${layoutNameFor(doc.name)}）に移して、モデルのテキストからは消しますか？ 図の見た目は変わりません。保存するまでファイルは変わりません。`, [
    { id: "keep", label: "そのままにする" },
    { id: "move", label: "移して整理する", kind: "primary" },
  ]);
  if (r?.id !== "move" || shownKey !== key) return;
  const text = removeLayoutComment(doc.text);
  ws.moveLegacyLayout(key, text);
  setText(text, { fromText: true });
  toast("保存すると、図の配置が別のファイルに移ります");
}

/**
 * 開いている文書が無い状態にする（F-FILE-14）。新しい文書は作らず、テキストと図を空にし、
 * どの文書にも属さない空の履歴に切り替え、選択を解いて、開いているファイルが無いことの案内を出す。
 */
function showNoDoc(): void {
  shownKey = null;
  coreClient().focus(null);
  useHistory(null);
  clearSel();
  S.prevSig = new Map();
  loadLayout({});
  setText("", { noHistory: true });
  renderFiles();
}

/** 表示中の文書（無ければ最初の文書）を表示する。開いている文書が無ければ、その案内を出す（F-FILE-14）。 */
function showCurrent(): void {
  const doc = ws.active() ?? ws.list()[0];
  if (doc) showDoc(doc.key);
  else showNoDoc();
}

/* ---- コマンド ---- */

/**
 * ファイルを選ばせて開き、表示する（F-FILE-2・F-FILE-10）。開けなければ理由をトーストで知らせる。
 */
async function openFile(): Promise<void> {
  const picker = local ?? browser;
  try {
    const doc = await ws.openWith(picker);
    if (doc) showDoc(doc.key);
  } catch (e) {
    toastFailure("開けませんでした", e);
  }
}

/**
 * フォルダを開き、エクスプローラーを表示する（F-FILE-1・F-FILE-9）。フォルダを扱えないブラウザでは何もしない。
 *
 * @param reopen 前回のフォルダを開き直すなら true（既定 false：新しく選ばせる）
 */
async function openFolder(reopen = false): Promise<void> {
  if (!local) return;
  try {
    const ok = reopen ? await ws.reopenFolder(local) : await ws.openFolder(local);
    if (ok) {
      endResumeAsk();
      showSide("files");
    }
    else if (reopen) toast("フォルダを開く許可が得られませんでした");
  } catch (e) {
    toastFailure("フォルダを開けませんでした", e);
  }
}

/**
 * 空の無題の文書を作って表示する（F-FILE-3）。
 */
function newUntitled(): void {
  showDoc(ws.newUntitled(untitledName(), "").key);
}

/**
 * サンプルを、新しい無題の文書として開いて表示する（「サンプルを開く」）。
 *
 * @param sample サンプルの文書（名前・テキスト・配置ファイルの文字列）
 */
function openSample(sample: Sample): void {
  showDoc(ws.newUntitled(sample.name, sample.text, sample.layout).key);
}

/**
 * モデルのファイル名として使えるか（拡張子が .sysml か .kerml。大文字・小文字は問わない）。使えなければ理由をトーストで伝える。
 *
 * @param path ファイル名（フォルダからの相対パス）
 * @returns 使えるなら true
 * @example
 * isModelPath("models/a.sysml") // → true
 * isModelPath("a.KERML")        // → true
 * isModelPath("a.txt")          // → false（トーストで知らせる）
 */
function isModelPath(path: string): boolean {
  if (/\.(sysml|kerml)$/i.test(path)) return true;
  toast("ファイル名の最後は .sysml にしてください（例：model.sysml）");
  return false;
}

/**
 * 開いているフォルダに新しいファイルを作る（F-FILE-3）。ファイル名を尋ね、作れたら表示する。作れなければ理由をトーストで知らせる。
 */
async function newFileInFolder(): Promise<void> {
  const r = await ask("新しいファイル", "ファイル名を入力してください。フォルダの中のフォルダに作るときは「models/a.sysml」のように書けます。", [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "作成", kind: "primary" },
  ], { value: "untitled.sysml", label: "ファイル名" });
  if (r?.id !== "ok") return;
  const path = r.value.trim();
  if (!isModelPath(path)) return;
  try {
    showDoc((await ws.createFile(path, "")).key);
  } catch (e) {
    toastFailure("作成できませんでした", e);
  }
}

/**
 * 保存する（as なら名前を付けて保存。F-FILE-2・F-FILE-3）。競合したら利用者に選ばせる（F-FILE-7）。
 * 配置の保存先が無いときは、保存先を選んでもらう（ADR-0005、F-VIEW-6）。保存の前に、図の操作と入力の反映を待つ。
 *
 * @param key 文書のキー
 * @param as 名前を付けて保存するなら true（既定 false）
 */
async function save(key: string, as = false): Promise<void> {
  // 直前の図の操作（コアの返事待ち）と、反映待ちの入力を、保存する内容に入れる
  await opsIdle();
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
    toastFailure("保存できませんでした", e);
  }
}

/**
 * 保存先のフォルダ（開いていなければ選んでもらう）と名前を選んでもらい、モデルと配置ファイルを一緒に作る（F-VIEW-6）。
 *
 * @param key 文書のキー
 */
async function saveIntoFolder(key: string): Promise<void> {
  if (!local) return;
  if (!ws.folder()) {
    if (!(await ws.openFolder(local))) return;
    showSide("files");
  }
  const doc = ws.get(key);
  const f = ws.folder();
  if (!doc || !f) return;
  const r = await ask("名前を付けて保存", `フォルダ「${f.ref.name}」に保存します。ファイル名を入力してください。図の配置（要素の位置）も、同じ名前のファイルに一緒に保存します。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "保存", kind: "primary" },
  ], { value: doc.ref?.path ?? suggestName(doc.name), label: "ファイル名" });
  if (r?.id !== "ok") return;
  const path = r.value.trim();
  if (!isModelPath(path)) return;
  await ws.saveToFolder(key, path);
  toast(`「${doc.name}」を保存しました`);
}

/**
 * 1 つだけ開いたファイルの配置に保存先が無いとき、そのファイルのあるフォルダを開くよう尋ねる（F-VIEW-6）。
 * 開いたフォルダにそのファイルがあれば、配置も保存する。無ければその旨をトーストで知らせる。
 *
 * @param key 文書のキー
 */
async function offerFolderForLayout(key: string): Promise<void> {
  const doc = ws.get(key);
  if (!doc || !local) return;
  const r = await ask("図の配置を保存する場所", `「${doc.name}」だけを開いているため、図の配置（要素の位置）を保存できません。このファイルが入っているフォルダを開くと、配置も一緒に保存できるようになります。`, [
    { id: "later", label: "あとで" },
    { id: "open", label: "フォルダを開く", kind: "primary" },
  ]);
  if (r?.id !== "open") return;
  const outcome = await ws.attachToFolder(key, local);
  if (outcome === "notInFolder") return toast(`選んだフォルダに「${doc.name}」がありません。図の配置はまだ保存されていません`);
  if (outcome !== "attached") return;
  showSide("files");
  if ((await ws.save(key, browser)) === "saved") toast("図の配置も保存しました");
}

/**
 * 保存しようとしたファイル（か、その図の配置を保存する配置ファイル）が他のアプリで変わっていたとき、上書き・読み直し・やめるを選ばせる（F-FILE-7）。
 *
 * @param key 文書のキー
 */
async function resolveConflict(key: string): Promise<void> {
  const doc = ws.get(key);
  if (!doc) return;
  const what = doc.stale ? `「${doc.name}」` : `「${doc.name}」の図の配置（要素の位置）`;
  const r = await ask("ファイルが他で変更されています", `${what}は開いた後に他のアプリで変更されました。どうしますか？`, [
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

/**
 * 文書を閉じる。反映待ちの入力を先に表示中の文書に書き込み、失われる変更（未保存の変更、保存先の無い文書の中身）があれば、保存するかを確かめる（F-FILE-5）。
 * 表示中の文書を閉じたら、残りの文書を表示する。残りが無ければ新しい文書は作らず、開いているファイルが無いことの案内を出す（F-FILE-14）。履歴も捨てる。
 *
 * @param key 文書のキー
 */
async function closeDoc(key: string): Promise<void> {
  flushEdit();
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
  if (wasActive) showCurrent();
}

/**
 * 開いているフォルダのファイルをパスで開いて表示する（ほかのファイルの要素の案内・問題一覧のほかのファイルの行から。ADR-0021 §5・§6）。
 * 位置を渡せば、開いた後にテキストのその位置へ移る。見つからない・開けないときは、トーストで知らせる。
 *
 * @param path フォルダからのパス
 * @param at 開いた後に移るテキストの位置（UTF-16。無ければ移らない）
 */
function openInFolder(path: string, at?: number): void {
  const f = ws.folder();
  const ref = f ? findFile(f.entries, path) : null;
  if (!ref) return toast(`「${path}」が見つかりません。フォルダの一覧を更新してください`);
  flushEdit();
  void ws.openRef(ref, { preview: true }).then(
    (d) => {
      showDoc(d.key);
      if (at !== undefined) moveCaret(at);
    },
    (err: unknown) => toastFailure("開けませんでした", err),
  );
}

/**
 * テキストの位置へカーソルを移し、その行が見えるようにする（問題一覧の行を押したときと同じ）。
 *
 * @param at テキストの位置（UTF-16）
 */
function moveCaret(at: number): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  ed.focus();
  ed.setSelectionRange(at, at);
  scrollEditorTo(at);
}

let problemsTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * フォルダのほかのファイルの問題を、少し待ってから数え直す（解析のたびに呼ぶ。続けて打っている間は数えない）。
 */
function scheduleProjectProblems(): void {
  clearTimeout(problemsTimer);
  problemsTimer = setTimeout(() => void countProjectProblems(), 500);
}

/**
 * フォルダのほかのファイルの問題をコアに数えてもらい、問題一覧とファイルの一覧を描き直す（ADR-0021 §6）。
 * フォルダを開いていなければ、前の結果を消す。数える間にテキストが変わったら、次の解析の後に数え直すので捨てる。
 */
async function countProjectProblems(): Promise<void> {
  const client = coreClient();
  if (!client.hasFiles) {
    if (!S.fileProblems.length) return;
    S.fileProblems = [];
  } else {
    const counted = await client.projectProblems();
    if (!counted) return;
    const texts = ws.projectTexts();
    S.fileProblems = counted.reports.map((r) => fileProblems(r, texts.get(r.path), S.pluginNames));
  }
  renderProblems();
  renderFiles();
}

/** コアに渡したプロジェクトのファイル（パス → テキスト。ADR-0021）と、そのフォルダの id（フォルダを開いていなければ null）。 */
let sentFiles = new Map<string, string>();
let filesFolder: string | null = null;

/**
 * 開いているフォルダのモデルのファイルを、1 つのモデルとしてコアに渡す（ADR-0021 §1・§3）。ワークスペースの変更のたびに呼び、
 * 変わったファイルだけを送る。表示中のファイルは、テキストの送り（didChange）で渡すので、ここでは送らない。
 * 別のフォルダを開いた・フォルダを閉じたときは、前のファイルをすべて忘れさせる。
 */
function syncProjectFiles(): void {
  const folder = ws.folder()?.ref.id ?? null;
  const next = ws.projectTexts();
  const shown = shownKey ? ws.folderPath(shownKey) : null;
  if (shown) next.delete(shown);
  const clear = folder !== filesFolder;
  const change = clear ? { set: [...next].map(([path, text]) => ({ path, text })), remove: [] } : filesChange(sentFiles, next);
  filesFolder = folder;
  sentFiles = next;
  if (!clear && !change.set.length && !change.remove.length) return;
  void coreClient().updateFiles({ clear, ...change });
}

/**
 * 開いているフォルダのプロジェクトの設定ファイル（modelith.json）が変わったら、コアに読み取ってもらう（ADR-0019、F-PROJ-1）。
 * ワークスペースの変更のたびに呼ぶ。読み取れたらエクスプローラーを描き直し、問題があればトーストで知らせる（黙って捨てない）。
 * 読み取った設定で、プロジェクトのプラグインを読み込み直す（ADR-0018）。プロジェクトでなくなったら、プラグインを外す。知らせの重さ（F-EDIT-11）もコアに渡す。
 * 同じフォルダの同じテキストなら、読み直さない。
 */
function syncProject(): void {
  const f = ws.folder();
  const text = f?.projectText ?? null;
  const key = f && text !== null ? `${f.ref.id}\n${text}` : null;
  if (key === projectKey) return;
  projectKey = key;
  project = null;
  if (key === null || text === null) {
    // プロジェクトでなければ、知らせは既定の重さ（F-EDIT-11）
    void coreClient().setLevels({});
    void reloadPlugins();
    return;
  }
  void coreClient()
    .parseProjectFile(text)
    .then((result) => {
      // 読み取る間に、別のフォルダを開いた・設定ファイルが変わった
      if (projectKey !== key) return;
      project = result;
      // プロジェクトで選んだ知らせの重さで解析し直す（F-EDIT-11）
      void coreClient().setLevels(result.project?.levels ?? {});
      const notice = projectNotice(result.problems);
      if (notice) toast(notice);
      renderFiles();
      void reloadPlugins();
    });
}

/**
 * 開いているフォルダの一覧と設定ファイルを読み直し、プロジェクトのプラグインも読み込み直す（「一覧を更新」・プラグインの追加や削除の後）。
 * 設定ファイルが変われば、その読み取りの後に読み込み直されるので、ここでは変わらなかったときだけ読み込み直す。
 */
async function refreshFolder(): Promise<void> {
  const before = ws.folder()?.projectText ?? null;
  await ws.refreshFolder();
  if ((ws.folder()?.projectText ?? null) === before) await reloadPlugins();
}

/**
 * 開いているフォルダをプロジェクトにする（ADR-0019、F-PROJ-1）。プロジェクトの名前を尋ね（既定はフォルダ名）、
 * コアで設定ファイルを作って、フォルダの一番上に書く。利用者が選んだときだけ書く（C-6）。できなければ理由をトーストで知らせる。
 */
async function makeProject(): Promise<void> {
  const f = ws.folder();
  if (!f) return;
  const r = await ask("プロジェクトにする", `フォルダ「${f.ref.name}」をプロジェクトにします。プロジェクト名を入力してください。チームで共有する設定ファイル（${PROJECT_FILE}）を、フォルダの直下に作成します。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "作成", kind: "primary" },
  ], { value: f.ref.name, label: "プロジェクト名" });
  if (r?.id !== "ok") return;
  const name = r.value.trim() || f.ref.name;
  const made = await coreClient().createProjectFile(name);
  if ("refused" in made) return toast(made.refused);
  try {
    await ws.makeProject(made.text);
    toast(`フォルダ「${f.ref.name}」を、プロジェクト「${name}」にしました`);
  } catch (e) {
    toastFailure("プロジェクトにできませんでした", e);
  }
}

/* ---- 描画 ---- */

/** 下書きを置けないことを、もう知らせたか（置けるようになったら戻し、次に置けなくなったときにまた知らせる）。 */
let lostDraftsWarned = false;

/**
 * 下書きを置けなくなったとき（ブラウザの保存領域がいっぱい）に、1 回だけ知らせる（F-FILE-11）。
 * 置けている間は何もしない。ワークスペースの変更の通知で呼ぶ。
 */
function warnLostDrafts(): void {
  const lost = ws.hasLostDrafts();
  if (lost && !lostDraftsWarned) toast("下書きを保存できません（ブラウザの保存領域がいっぱいです）。「名前を付けて保存」で保存してください");
  lostDraftsWarned = lost;
}

/**
 * 未保存の変更がある文書の印（●）の HTML を作る（F-FILE-5）。
 *
 * @param d 文書
 * @returns 印の HTML。変更が無ければ ""
 * @example
 * // テキストを編集して保存していない
 * dirtyMark(d) // → '<span class="dot" title="未保存の変更があります">●</span>'
 * // 保存済み
 * dirtyMark(d) // → ""
 */
const dirtyMark = (d: Doc): string => (ws.isDirty(d) ? `<span class="dot" title="未保存の変更があります">●</span>` : "");
/**
 * 配置を変えたが保存先が無い文書の印（「配置は未保存」）の HTML を作る（F-VIEW-6）。保存先の無い（無題の）文書には付けない。
 *
 * @param d 文書
 * @returns 印の HTML。当たらなければ ""
 * @example
 * // ファイルを 1 つだけ開き、要素を動かした
 * layoutMark(d) // → '<span class="lu" title="…">配置は未保存</span>'
 * // 無題の文書
 * layoutMark(d) // → ""
 */
const layoutMark = (d: Doc): string =>
  d.ref && ws.layoutUnsaved(d) ? `<span class="lu" title="図の配置（要素の位置）を保存する場所がありません。このファイルが入っているフォルダを開くと保存できます">配置は未保存</span>` : "";
/**
 * 他のアプリで変更された文書の印（⚠）の HTML を作る（F-FILE-8）。
 *
 * @param d 文書
 * @returns 印の HTML。変更されていなければ ""
 * @example
 * // d.stale か d.layoutStale が true
 * staleMark(d) // → '<span class="st" title="他のアプリで変更されています">⚠</span>'
 * // どちらも false
 * staleMark(d) // → ""
 */
const staleMark = (d: Doc): string => (d.stale || d.layoutStale ? `<span class="st" title="他のアプリで変更されています">⚠</span>` : "");

/**
 * エクスプローラー（開いているファイルと、開いているフォルダの中身）を描き直す（F-FILE-1・F-FILE-4）。
 * 表示中の文書の名前と印をテキスト欄の見出しに、未保存の印をページの題名に出す。
 */
function renderFiles(): void {
  const active = ws.active();
  const docs = ws.list()
    .map((d) => {
      const base = d.ref ? (ws.canWriteInPlace(d) ? d.ref.path : `${d.ref.name}（ダウンロードで保存）`) : "保存先なし（ブラウザに下書き保存）";
      // 仮に開いたファイルは名前を斜体にし、開いたままにする方法を添える（F-FILE-17）
      const where = d.preview ? `${base}\n${PREVIEW_HINT}` : base;
      return `<div class="fi${d.key === active?.key ? " sel" : ""}${d.preview ? " pv" : ""}" data-doc="${esc(d.key)}" title="${esc(where)}" style="--d:0"><span class="ic">${d.ref ? "▤" : "✎"}</span><span class="nm">${esc(d.name)}</span>${staleMark(d)}${dirtyMark(d)}${layoutMark(d)}<button class="x" data-close="${esc(d.key)}" aria-label="閉じる">×</button></div>`;
    })
    .join("");
  let h = `<div class="sec"><span class="grow">開いているファイル</span><button data-cmd="new" title="新しいファイル">＋</button></div>${docs || `<div class="msg">開いているファイルはありません。</div>`}`;
  const f = ws.folder();
  if (f) {
    h += folderHeader();
    h += f.entries.length ? folderRows(f.entries, 0, fileStatuses()) : `<div class="msg">モデルのファイル（.sysml）がありません。</div>`;
  } else if (local) {
    h += `<div class="sec"><span class="grow">フォルダ</span></div><div class="msg">フォルダを開くと、中の .sysml ファイルを一覧して編集・上書き保存できます。<br><button data-cmd="openFolder" class="primary">フォルダを開く</button>`;
    if (recentName) h += `<br><button data-cmd="reopen">前回のフォルダ「${esc(recentName)}」を開く</button>`;
    h += `</div>`;
  } else {
    h += `<div class="sec"><span class="grow">フォルダ</span></div><div class="msg">このブラウザではフォルダを開けません（Chrome・Edge で使えます）。「ファイルを開く」で読み込み、保存はダウンロードになります。図の配置ファイル（.layout.json）は、モデルと一緒に選ぶと読み込みます。</div>`;
  }
  $("#explorer").innerHTML = h;
  // テキスト欄の見出しとタブの題名、問題をコピーするときのファイル名（F-EDIT-13）
  S.docPath = active ? (ws.folderPath(active.key) ?? active.name) : "";
  if (active) {
    $("#docName").innerHTML = esc(active.name) + staleMark(active) + (ws.isDirty(active) ? " ●" : "") + layoutMark(active);
    $("#docName").classList.toggle("pv", !!active.preview);
    $("#docName").title = active.preview ? PREVIEW_HINT : "";
    document.title = `${ws.isDirty(active) ? "● " : ""}${active.name} — Modelith`;
  } else {
    $("#docName").textContent = "";
    document.title = "Modelith";
  }
  renderNoDoc();
}

/** 開いている文書が無いときに押せなくする、メニューの項目（ファイル・編集・表示・図のメニュー）。 */
const NEEDS_DOC = ["#btnSave", "#btnSaveAs", "#menuSelectAll", "#menuZoomIn", "#menuZoomOut", "#menuFit", "#menuMini", "#menuSaveView", "#menuEdgeOrtho", "#menuEdgeCurve", "#menuLayout", "#btnExport"];

/**
 * 開いている文書が無いときの案内（図とテキストの場所を覆う）を出し入れする（F-FILE-14）。
 * 案内を出している間は、図とテキストを操作できなくし、文書が要るメニューの項目（保存・名前を付けて保存・図の操作・エクスポート）を押せなくする。
 */
function renderNoDoc(): void {
  const none = shownKey === null;
  $("#noDoc").hidden = !none;
  renderResumeAsk();
  $("#main").toggleAttribute("data-nodoc", none);
  for (const pane of document.querySelectorAll<HTMLElement>(".diagrampane, .textpane")) pane.inert = none;
  for (const id of NEEDS_DOC) $<HTMLButtonElement>(id).disabled = none;
}

/**
 * 開いている文書が無いときの案内を、「前回の続きを開く」を待っているかに合わせる（F-FILE-13）。
 * 待っている間は、見出しと説明を前回の続きのものにし、「前回の続きを開く」を主なボタンとして先頭に出す。
 */
function renderResumeAsk(): void {
  const ask = resumeAsk;
  $("#noDocTitle").textContent = ask ? "前回の続きから始められます" : "開いているファイルはありません";
  $("#noDocText").hidden = !!ask;
  const text = $("#noDocResume");
  text.hidden = !ask;
  text.textContent = ask ? `前回は、フォルダ「${ask.folder}」のファイルを開いていました。「前回の続きを開く」を押して、ブラウザの確認でフォルダの編集を許可すると、続きから始めます。` : "";
  $('#noDoc [data-nodoc="resume"]').hidden = !ask;
  $('#noDoc [data-nodoc="new"]').classList.toggle("primary", !ask);
}

/**
 * 「前回の続きを開く」を待つのをやめる（文書を表示した・フォルダを開いた）。以後は、今の状態を前回の続きとして書く（F-FILE-13）。
 * 待っていなければ何もしない。
 */
function endResumeAsk(): void {
  if (!resumeAsk) return;
  resumeAsk = null;
  ws.holdSession(false);
}

/**
 * 前回の続きを戻し、表示する（F-FILE-13）。フォルダを開いていたなら開き直し（ask なら許可を求める）、
 * 前回の順番で文書を戻して、表示していた文書を表示する。見つからなかったファイル・開けなかったフォルダは、トーストで知らせる。
 * 戻せる文書が無ければ、フォルダを開いたか、すべて閉じて終えたなら何も開かず、そうでなければサンプルを開く。
 *
 * @param session 前回の続き
 * @param drafts 起動したときに下書きを戻した結果
 * @param folder フォルダを開き直すか（"no"：開かない・"quiet"：許可を求めない・"ask"：許可を求める）
 * @returns 戻したら true。ask で許可が得られなかったら、何も変えずに false
 * @example
 * await resumeFrom(session, "drafts", "quiet") // → true（フォルダを開き直して続きを表示した）
 * await resumeFrom(session, "drafts", "ask")   // → false（許可が得られなかった）
 */
async function resumeFrom(session: Session, drafts: StartWith, folder: "no" | "quiet" | "ask"): Promise<boolean> {
  let opened = false;
  let gone = false;
  if (folder !== "no" && local) {
    try {
      opened = await ws.reopenFolder(local, { ask: folder === "ask" });
    } catch {
      gone = true;
      toast(`前回のフォルダ「${(await local.recentFolder()) ?? ""}」を開けませんでした。移動したか、削除された可能性があります`);
    }
  }
  // 許可が得られなければ、もう一度押せるように待ち続ける（フォルダが無くなっていたら、待たずに下書きだけを戻す）
  if (folder === "ask" && !opened && !gone) {
    toast("フォルダを開く許可が得られませんでした");
    return false;
  }
  const missing = await ws.resumeSession(session);
  if (missing.length === 1) toast(`前回開いていた「${missing[0] ?? ""}」が見つかりませんでした`);
  else if (missing.length > 1) toast(`前回開いていたファイルのうち、${missing.length} 個が見つかりませんでした`);
  if (afterRestore(ws.list().length, opened, drafts) === "sample") ws.newUntitled(sampleDoc.name, sampleDoc.text, sampleDoc.layout);
  showCurrent();
  return true;
}

/**
 * 「前回の続きを開く」を押したときに、フォルダを開く許可を求めて前回の続きを戻す（F-FILE-13）。
 * 許可が得られなければ、トーストで知らせて待ち続ける。戻したら、その解析結果が届いてから図のタブを戻す。
 */
async function resumeAsked(): Promise<void> {
  const ask = resumeAsk;
  if (!ask || !(await resumeFrom(ask.session, ask.drafts, "ask"))) return;
  endResumeAsk();
  renderFiles();
  await settled();
  onResumed();
}

/**
 * 起動したときに、何から始めるかを決めて表示する（F-FILE-11・F-FILE-13・F-FILE-14）。
 * 前回の続きが無ければ今までどおり（下書き、無ければサンプル。すべて閉じて終えたなら何も開かない）。
 * 設定「起動時にサンプルを開く」が有効なら、下書きを戻したうえでサンプルを表示する（手を付けていないサンプルがあればそれを使う）。
 * フォルダを開く許可が残っていれば、フォルダを開き直して続きを表示する。許可が要るなら「前回の続きを開く」を示して待つ。
 * 戻し終えたら、今の状態を前回の続きとして書き始める（待つ間は書かない）。
 */
async function start(): Promise<void> {
  const session = kvSessionStore(store).load();
  const sampleAtStart = store.get(START_SAMPLE_KEY) === "1";
  const access = local && session?.folder && !sampleAtStart ? await local.recentAccess() : "none";
  const plan = planStart(session, sampleAtStart, access);
  const drafts = ws.restoreDrafts();
  if (plan === "ask" && session && local) {
    resumeAsk = { session, folder: (await local.recentFolder()) ?? "", drafts };
    showNoDoc();
    return;
  }
  if (plan === "default") {
    if (drafts === "sample") ws.newUntitled(sampleDoc.name, sampleDoc.text, sampleDoc.layout);
    showCurrent();
  } else if (plan === "sample") {
    showDoc(sampleDraft(ws.list(), sampleDoc) ?? ws.newUntitled(sampleDoc.name, sampleDoc.text, sampleDoc.layout).key);
  } else if (session) {
    await resumeFrom(session, drafts, plan === "resume" ? "quiet" : "no");
  }
  ws.holdSession(false);
}

/**
 * エクスプローラーの、開いているフォルダの見出しの HTML を作る（F-FILE-1・F-PROJ-1）。
 * プロジェクトならプロジェクト名、そうでなければフォルダ名を出す。設定ファイルの無いフォルダには、見出しの下に「プロジェクトにする」を出す。
 * プロジェクトには、見出しの下に「プラグイン」と、足りないプラグインの案内を出す（F-PLUG-9）。
 *
 * @returns 見出し（と「プロジェクトにする」の行）の HTML。フォルダを開いていなければ ""
 * @example
 * // フォルダ water に { "name": "給水" } の modelith.json がある
 * folderHeader() // → '<div class="sec"><span class="grow" data-folder title="プロジェクト「給水」（フォルダ「water」）">給水</span><button data-cmd="newInFolder" …>＋</button>…</div>'
 * // modelith.json の無いフォルダ water
 * folderHeader() // → '<div class="sec"><span class="grow" data-folder title="water">WATER</span>…</div><div class="mkproj"><button data-cmd="makeProject" …>プロジェクトにする</button></div>'
 */
function folderHeader(): string {
  const f = ws.folder();
  if (!f) return "";
  const named = project?.project ? projectTitle(f.ref.name, project.project) : null;
  const title = named ? `プロジェクト「${named}」（フォルダ「${f.ref.name}」）` : f.ref.name;
  // 見出しに並べるとフォルダ名が隠れるので、見出しのすぐ下の行に出す
  const make = f.projectText === null && hasFolderFiles(f.source)
    ? `<div class="mkproj"><button data-cmd="makeProject" title="プロジェクト名やプラグインなどの設定を、チームで共有できるようにします（設定ファイル ${PROJECT_FILE} を作成します）">プロジェクトにする</button></div>`
    : "";
  return `<div class="sec"><span class="grow" data-folder title="${esc(title)}">${esc((named ?? f.ref.name).toUpperCase())}</span><button data-cmd="newInFolder" title="このフォルダに新しいファイル">＋</button><button data-cmd="refresh" title="一覧を更新">↻</button></div>${make}${pluginExplorerHtml()}`;
}

/**
 * フォルダの中身をツリーの行の HTML にする。閉じたフォルダの中は出さない。開いているファイルには印を付ける。
 * エラーのあるファイルの名前は赤く、警告だけのファイルの名前は黄色くして件数を添え、エラーのあるファイルを中に持つフォルダの名前も赤くする（ADR-0021 §6）。
 *
 * @param entries フォルダの中身
 * @param depth 入れ子の深さ（0 が最上位）
 * @param statuses ファイルのパス → エラーと警告の件数
 * @returns 行の HTML。中身が無ければ ""
 * @example
 * // models フォルダ（開いている）の中に a.sysml がある
 * folderRows(entries, 0, new Map())
 * // → '<div class="fi" data-dir="models" style="--d:0">…models…</div><div class="fi" data-file="…" style="--d:1" …>…a.sysml…</div>'
 * folderRows(entries, 0, new Map([["models/a.sysml", { errors: 1, warnings: 0 }]]))
 * // → '<div class="fi err" data-dir="models" …>…</div><div class="fi err" data-file="…" …>…a.sysml…<span class="cnt err" …>1</span></div>'
 * folderRows([], 0, new Map()) // → ""
 */
function folderRows(entries: DirEntry[], depth: number, statuses: ReadonlyMap<string, FileStatus>): string {
  const active = ws.active();
  return entries
    .map((e) => {
      if (e.kind === "dir") {
        const open = !collapsed.has(e.path);
        const mark = folderStatus(statuses, e.path).errors ? " err" : "";
        return `<div class="fi${mark}" data-dir="${esc(e.path)}" style="--d:${depth}"><span class="ic">${open ? "▾" : "▸"}</span><span class="nm">${esc(e.name)}</span></div>` + (open ? folderRows(e.children, depth + 1, statuses) : "");
      }
      const doc = ws.list().find((d) => d.ref?.provider === e.ref.provider && d.ref.id === e.ref.id);
      const sel = !!doc && doc.key === active?.key;
      const st = statuses.get(e.ref.path);
      return `<div class="fi${sel ? " sel" : ""}${statusClass(st)}" data-file="${esc(e.ref.id)}" style="--d:${depth}" title="${esc(e.ref.path)}"><span class="ic">▤</span><span class="nm">${esc(e.ref.name)}</span>${st ? statusBadge(st) : ""}${doc ? staleMark(doc) + dirtyMark(doc) : ""}</div>`;
    })
    .join("");
}

/**
 * ファイルの一覧に出す、フォルダのファイルごとのエラーと警告の件数。ほかのファイルはコアが数えたもの、表示中のファイルは今の解析結果のもの。
 *
 * @returns ファイルのパス → 件数
 * @example
 * fileStatuses() // → Map { "parts.sysml" → { errors: 1, warnings: 0 }, "app.sysml" → { errors: 0, warnings: 2 } }
 */
function fileStatuses(): Map<string, FileStatus> {
  const statuses = new Map(S.fileProblems.map((f) => [f.path, f.status]));
  const shown = shownKey ? ws.folderPath(shownKey) : null;
  if (shown) statuses.set(shown, fileStatus(S.M.problems, S.findings));
  return statuses;
}

/**
 * フォルダの中身から、ID の合うファイルを入れ子まで探す。
 *
 * @param entries フォルダの中身
 * @param id ファイルの ID（FileRef の id）
 * @returns 見つかったファイルの項目。無ければ undefined
 * @example
 * // フォルダ models の中に、ID が "f1" のファイル a.sysml がある
 * findEntry(entries, "f1")?.kind // → "file"（入れ子の中も探す）
 * findEntry(entries, "nope")     // → undefined
 */
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

/**
 * 横のパネルを、ファイル（エクスプローラー）・モデル（ツリー）・図（作成した図の一覧、F-VIEW-11）のどれかに切り替え、選んだ方を保存する。
 *
 * @param which "files"：ファイル・"model"：モデル・"views"：図
 */
function showSide(which: Side): void {
  for (const [side, pane, tab] of [["files", "#filesSide", "#sideFiles"], ["model", "#modelSide", "#sideModel"], ["views", "#viewsSide", "#sideViews"]] as const) {
    $(pane).hidden = which !== side;
    $(tab).setAttribute("aria-selected", String(which === side));
  }
  store.set(SIDE_KEY, which);
}

/* ---- 登録 ---- */

/**
 * ファイルを選ばせる。モデルと配置ファイルを一緒に選べる（ADR-0005、F-FILE-10）。
 *
 * @returns 選んだファイルを返す Promise。選ばずに閉じたら空の配列
 * @example
 * // model.sysml と model.layout.json を選んだ
 * await chooseFiles() // → [File(model.sysml), File(model.layout.json)]
 * // 選ばずに閉じた
 * await chooseFiles() // → []
 */
function chooseFiles(): Promise<PickedFile[]> {
  const input = $<HTMLInputElement>("#fileInput");
  return new Promise((resolve) => {
    input.value = "";
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * プラグインのフォルダを選ばせ、中のファイルをテキストで読む（プラグインの追加、ADR-0018 §1）。
 * フォルダを開けるブラウザではフォルダのピッカーを、開けないブラウザ（Firefox・Safari）ではフォルダを選ぶ入力欄（webkitdirectory）を使う。
 * 隠しファイル・隠しフォルダ・node_modules は読まない。
 *
 * @returns フォルダの名前とファイル（フォルダからの相対パス → テキスト）。選ばなければ null。
 *   ファイルが多すぎる（MAX_TREE_FILES 件を超える）・読めないときは例外（Error）を投げる
 * @example
 * await pickPluginFolder() // → { name: "trace-rules", files: { "modelith-plugin.json": "{…}", "rules.yaml": "…" } }
 * await pickPluginFolder() // → null（キャンセル）
 */
async function pickPluginFolder(): Promise<PickedPluginFolder | null> {
  if (local) {
    const picked = await local.pickOtherFolder();
    if (!picked) return null;
    return { name: picked.name, files: (await local.readTree(picked, "")) ?? {} };
  }
  const chosen = await chooseFolderFiles();
  const files: Record<string, string> = {};
  for (const file of chosen) {
    const path = pluginFolderPath(file.webkitRelativePath);
    if (path === null) continue;
    if (Object.keys(files).length >= MAX_TREE_FILES) throw new Error(`ファイルが多すぎます（${MAX_TREE_FILES} 件まで）。プラグインのフォルダを選んでください`);
    files[path] = await file.text();
  }
  const first = chosen[0]?.webkitRelativePath.split("/")[0];
  return first === undefined ? null : { name: first, files };
}

/**
 * フォルダを選ぶ入力欄（webkitdirectory）でフォルダを選ばせる。
 *
 * @returns 選んだフォルダの中のファイル（下のフォルダのものも含む）。選ばずに閉じたら空
 * @example
 * await chooseFolderFiles() // → [File(trace-rules/modelith-plugin.json), File(trace-rules/rules.yaml)]
 */
function chooseFolderFiles(): Promise<File[]> {
  const input = $<HTMLInputElement>("#pluginDirInput");
  return new Promise((resolve) => {
    input.value = "";
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * プラグインが読み込んだテキストを、新しい無題の文書として開いて表示する（既存のファイルは書き換えない。ADR-0018 §4、C-6）。
 *
 * @param fileName プラグインが示したファイル名（拡張子を .sysml にし、開いている文書と重ならない名前にする）
 * @param text 読み込んだテキスト
 * @returns 付けた文書の名前
 * @example
 * openImported("要求一覧.reqif", "package 要求一覧;") // → "要求一覧.sysml"
 */
function openImported(fileName: string, text: string): string {
  const name = importedDocName(fileName, new Set(ws.list().map((d) => d.name)));
  showDoc(ws.newUntitled(name, text).key);
  return name;
}

/**
 * 開いているメニュー（details.menu）をすべて閉じる。
 */
function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

/**
 * ファイルメニュー・自動保存の切り替え（F-FILE-6）・起動時にサンプルを開く設定（F-FILE-13）・ショートカット（Ctrl+S で保存、Ctrl+Shift+S で名前を付けて保存、Ctrl+O で開く）に操作をつなぐ。
 * 開いている文書が無いときの Ctrl+S は、そのことをトーストで知らせる（F-FILE-14）。
 */
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
  const startSample = $<HTMLInputElement>("#startSample");
  startSample.checked = store.get(START_SAMPLE_KEY) === "1";
  startSample.onchange = () => store.set(START_SAMPLE_KEY, startSample.checked ? "1" : "0");
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
    if (k === "s") {
      ev.preventDefault();
      if (shownKey) void save(shownKey, ev.shiftKey);
      else toast("開いているファイルがありません");
    } else if (k === "o") {
      ev.preventDefault();
      void openFile();
    }
  });
}

/**
 * エクスプローラーに操作をつなぐ。文書を押して表示・閉じる、フォルダの開閉、フォルダのファイルを開く、
 * 新しいファイル・一覧の更新・プロジェクトにする・プラグイン・プラグインの追加・フォルダを開くのボタン。前回選んだ横のパネルを戻す。
 */
function initExplorer(): void {
  $("#sideFiles").onclick = () => showSide("files");
  $("#sideModel").onclick = () => showSide("model");
  $("#sideViews").onclick = () => showSide("views");
  const side = store.get(SIDE_KEY);
  showSide(side === "model" || side === "views" ? side : "files");
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
    if (c === "refresh") return void refreshFolder();
    if (c === "makeProject") return void makeProject();
    if (c === "plugins") return openPlugins();
    if (c === "addPlugin") return void addPlugin();
    if (c === "openFolder") return void openFolder();
    if (c === "reopen") return void openFolder(true);
    // ダブルクリック（2 回目のクリック）は、仮に開いたファイルを開いたままにする（F-FILE-17）。
    // 1 回目のクリックで一覧を描き直すため dblclick は届かないことがあり、クリックの回数で見分ける
    const twice = ev.detail >= 2;
    const doc = closest(ev, "[data-doc]")?.dataset["doc"];
    if (doc) {
      if (twice) ws.pin(doc);
      return showDoc(doc);
    }
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
      // 1 回クリックは仮に開く（F-FILE-17）。反映待ちの入力を先に書き込み、編集中の仮のファイルを置き換えないようにする
      flushEdit();
      void ws.openRef(e.ref, { preview: !twice }).then(
        (d) => showDoc(d.key),
        (err: unknown) => toastFailure("開けませんでした", err),
      );
    }
  });
}

/**
 * 文書が編集されたことを自動保存に知らせる（有効なら、編集が止まってから保存する。F-FILE-6）。
 *
 * @param key 文書のキー
 */
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

/** サンプルの文書（名前・テキスト・配置ファイルの文字列）。 */
interface Sample {
  name: string;
  text: string;
  layout: string;
}

/**
 * 開いているファイルが無いときの案内のボタン（前回の続きを開く・新しいファイル・ファイルを開く・フォルダを開く・サンプルを開く）に操作をつなぐ（F-FILE-13・F-FILE-14）。
 * フォルダを開けないブラウザでは、フォルダを開くボタンを出さない。
 *
 * @param sample サンプルの文書
 */
function initNoDoc(sample: Sample): void {
  $('#noDoc [data-nodoc="openFolder"]').hidden = !local;
  $("#noDoc").addEventListener("click", (ev) => {
    const c = closest(ev, "[data-nodoc]")?.dataset["nodoc"];
    if (c === "resume") void resumeAsked();
    else if (c === "new") newUntitled();
    else if (c === "open") void openFile();
    else if (c === "openFolder") void openFolder();
    else if (c === "sample") openSample(sample);
  });
}

/**
 * ファイル操作を初期化し、前回の続き（開いていたフォルダとファイル・下書き・表示していたファイル）から始める（F-FILE-11・F-FILE-13）。
 * 前回の続きが無ければサンプルを表示し、前回すべてのファイルを閉じて終えたなら、開いているファイルが無いことの案内を出す（F-FILE-14）。
 * フォルダを開く許可が要るときは、「前回の続きを開く」を示す。起動時に 1 回呼ぶ。
 * テキストと配置の変更をワークスペースに反映し、未保存のままページを離れるときに警告し（F-FILE-5）、
 * 画面に戻ったときに他のアプリでの変更を確かめる（F-FILE-8）。
 *
 * @param sample サンプルの文書（名前・テキスト・配置ファイルの文字列）
 * @param opts onResumed は、「前回の続きを開く」で戻した文書の解析結果が届いた後に呼ぶ関数（図のタブを戻す）
 * @returns 始め方を決めて表示し終えたら解決する Promise（「前回の続きを開く」を示したときは、押されるのを待たずに解決する）
 * @example
 * await initFiles(SAMPLE_DOC, { onResumed: resumeTabs }) // → 前回の続き（無ければサンプル）を表示している
 */
export async function initFiles(sample: Sample, opts: { onResumed?: () => void } = {}): Promise<void> {
  sampleDoc = sample;
  if (opts.onResumed) onResumed = opts.onResumed;
  const w = window as unknown as FsApi;
  local = hasFsAccess(window) ? new LocalFolderProvider(w, idbHandleStore) : null;
  browser = new BrowserFileProvider({ choose: chooseFiles, download: (name, text) => download(name, text, "text/plain;charset=utf-8") });
  const providers: FileProvider[] = local ? [local, browser] : [browser];
  ws = new Workspace(new ProviderRegistry(providers), kvDraftStore(store), kvSessionStore(store));
  autoSave = store.get(AUTOSAVE_KEY) === "1";
  auto = new AutoSaver(ws, browserTimer, () => autoSave, (key, outcome) => {
    if (outcome === "conflict") toast(`「${ws.get(key)?.name ?? ""}」は他のアプリで変更されたため、自動保存しませんでした。保存（Ctrl+S）で選べます`);
    // 失敗しても文書は未保存のまま（●）なので、知らせるだけにして、保存（Ctrl+S）で試し直してもらう（F-FILE-6）
    else if (typeof outcome === "object") toastFailure(`「${ws.get(key)?.name ?? ""}」を自動保存できませんでした`, outcome.failed);
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
  // 設定ファイルの読み取りの状態を先に変えてから描く
  onOpenProjectFile((path) => openInFolder(path));
  onAnalyzedProject(scheduleProjectProblems);
  $("#problems").addEventListener("click", (ev) => {
    // ほかのファイルの行は、そのファイルを開いてその行へ移る（ADR-0021 §6）
    const b = closest(ev, "button[data-path]");
    const path = b?.dataset["path"];
    if (path !== undefined) openInFolder(path, Number(b?.dataset["at"] ?? 0));
  });
  ws.subscribe(syncProject);
  ws.subscribe(syncProjectFiles);
  ws.subscribe(renderFiles);
  ws.subscribe(warnLostDrafts);
  initMenu();
  initExplorer();
  initPlugins({
    canOpenFolders: !!local,
    folder: () => ws.folder(),
    project: () => project,
    refreshFolder,
    rerender: renderFiles,
    pickPluginFolder,
    openImported,
    hasOpenDoc: () => shownKey !== null,
    browser: idbBrowserPlugins,
    data: idbPluginData,
  });
  initNoDoc(sample);
  $("#btnSample").onclick = () => {
    closeMenus();
    openSample(sample);
  };
  window.addEventListener("beforeunload", (ev) => {
    flushEdit();
    if (ws.hasUnsavedFiles()) ev.preventDefault();
  });
  window.addEventListener("focus", () => void checkExternal());
  await start();
  renderFiles();
  void local?.recentFolder().then((name) => {
    recentName = name;
    renderFiles();
  });
}
