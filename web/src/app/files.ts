// ファイル操作の UI（ADR-0010）：エクスプローラー・ファイルメニュー・ショートカット・未保存の警告・外部での変更の読み直し。
// 判断はワークスペース（web/src/workspace）に任せ、ここは操作を受けて結果を画面に出すだけ。

import { readLayout, removeLayoutComment, type ProjectFileResult } from "../core";
import { BrowserFileProvider, type PickedFile } from "../files/browser-file";
import { idbHandleStore } from "../files/idb-handle-store";
import { hasFsAccess, LocalFolderProvider, type FsApi } from "../files/local-folder";
import { hasFolderFiles, ProviderRegistry, type DirEntry, type FileProvider } from "../files/types";
import { AutoSaver, browserTimer } from "../workspace/autosave";
import { kvDraftStore } from "../workspace/drafts";
import { layoutNameFor, PROJECT_FILE, suggestName, Workspace, type Doc } from "../workspace/workspace";
import { fit } from "./canvas";
import { ask } from "./dialog";
import { $, closest, esc, store } from "./dom";
import { flushEdit } from "./editor";
import { download } from "./export";
import { dropHistory, recordHistory, useHistory } from "./history";
import { layoutFromJson, type Layout } from "./layout";
import { isEmptyLayout, parseLayoutFile, serializeLayout } from "./layout-file";
import { clearSel, S } from "./state";
import { projectNotice, projectTitle } from "./project";
import { coreClient, loadLayout, onLayoutChange, onTextChange, setText, settled, toast } from "./sync";
import { opsIdle } from "./intent";

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
/** 読み取りを頼んだプロジェクトの設定ファイル（フォルダの id と設定ファイルのテキスト）。無ければ null。 */
let projectKey: string | null = null;
/** 開いているフォルダのプロジェクトの設定を読み取った結果（ADR-0019）。まだ読み取っていない・設定ファイルが無ければ null。 */
let project: ProjectFileResult | null = null;

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
  shownKey = key;
  ws.activate(key);
  useHistory(key);
  clearSel();
  S.prevSig = new Map();
  const { layout, legacy } = layoutOf(doc);
  loadLayout(layout);
  setText(doc.text, { noHistory: true });
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

/** 表示中の文書が無くなったら、空の無題の文書を作る（テキストは常に 1 つ表示する）。 */
function ensureDoc(): void {
  const doc = ws.active() ?? ws.list()[0];
  showDoc(doc ? doc.key : ws.newUntitled(untitledName(), "").key);
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
    toast(`開けませんでした：${(e as Error).message}`);
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
    if (ok) showSide("files");
    else if (reopen) toast("フォルダを開く許可が得られませんでした");
  } catch (e) {
    toast(`フォルダを開けませんでした：${(e as Error).message}`);
  }
}

/**
 * 空の無題の文書を作って表示する（F-FILE-3）。
 */
function newUntitled(): void {
  showDoc(ws.newUntitled(untitledName(), "").key);
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
    toast(`作れませんでした：${(e as Error).message}`);
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
    toast(`保存できませんでした：${(e as Error).message}`);
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
 * 保存しようとしたファイルが他のアプリで変わっていたとき、上書き・読み直し・やめるを選ばせる（F-FILE-7）。
 *
 * @param key 文書のキー
 */
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

/**
 * 文書を閉じる。失われる変更（未保存の変更、保存先の無い文書の中身）があれば、保存するかを確かめる（F-FILE-5）。
 * 表示中の文書を閉じたら、残りの文書（無ければ新しい無題の文書）を表示する。履歴も捨てる。
 *
 * @param key 文書のキー
 */
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

/**
 * 開いているフォルダのプロジェクトの設定ファイル（modelith.json）が変わったら、コアに読み取ってもらう（ADR-0019、F-PROJ-1）。
 * ワークスペースの変更のたびに呼ぶ。読み取れたらエクスプローラーを描き直し、問題があればトーストで知らせる（黙って捨てない）。
 * 同じフォルダの同じテキストなら、読み直さない。
 */
function syncProject(): void {
  const f = ws.folder();
  const text = f?.projectText ?? null;
  const key = f && text !== null ? `${f.ref.id}\n${text}` : null;
  if (key === projectKey) return;
  projectKey = key;
  project = null;
  if (key === null || text === null) return;
  void coreClient()
    .parseProjectFile(text)
    .then((result) => {
      // 読み取る間に、別のフォルダを開いた・設定ファイルが変わった
      if (projectKey !== key) return;
      project = result;
      const notice = projectNotice(result.problems);
      if (notice) toast(notice);
      renderFiles();
    });
}

/**
 * 開いているフォルダをプロジェクトにする（ADR-0019、F-PROJ-1）。プロジェクトの名前を尋ね（既定はフォルダ名）、
 * コアで設定ファイルを作って、フォルダの一番上に書く。利用者が選んだときだけ書く（C-6）。できなければ理由をトーストで知らせる。
 */
async function makeProject(): Promise<void> {
  const f = ws.folder();
  if (!f) return;
  const r = await ask("プロジェクトにする", `フォルダ「${f.ref.name}」をプロジェクトにします。プロジェクトの名前を入力してください。チームで共有する設定ファイル（${PROJECT_FILE}）を、フォルダの一番上に作ります。`, [
    { id: "cancel", label: "やめる" },
    { id: "ok", label: "作成", kind: "primary" },
  ], { value: f.ref.name, label: "プロジェクトの名前" });
  if (r?.id !== "ok") return;
  const name = r.value.trim() || f.ref.name;
  const made = await coreClient().createProjectFile(name);
  if ("refused" in made) return toast(made.refused);
  try {
    await ws.makeProject(made.text);
    toast(`フォルダ「${f.ref.name}」を、プロジェクト「${name}」にしました`);
  } catch (e) {
    toast(`プロジェクトにできませんでした：${(e as Error).message}`);
  }
}

/* ---- 描画 ---- */

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
 * // d.stale が true
 * staleMark(d) // → '<span class="st" title="他のアプリで変更されています">⚠</span>'
 * // d.stale が false
 * staleMark(d) // → ""
 */
const staleMark = (d: Doc): string => (d.stale ? `<span class="st" title="他のアプリで変更されています">⚠</span>` : "");

/**
 * エクスプローラー（開いているファイルと、開いているフォルダの中身）を描き直す（F-FILE-1・F-FILE-4）。
 * 表示中の文書の名前と印をテキスト欄の見出しに、未保存の印をページの題名に出す。
 */
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
    h += folderHeader();
    h += f.entries.length ? folderRows(f.entries, 0) : `<div class="msg">モデルのファイル（.sysml）がありません。</div>`;
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

/**
 * エクスプローラーの、開いているフォルダの見出しの HTML を作る（F-FILE-1・F-PROJ-1）。
 * プロジェクトならプロジェクト名、そうでなければフォルダ名を出す。設定ファイルの無いフォルダには、見出しの下に「プロジェクトにする」を出す。
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
    ? `<div class="mkproj"><button data-cmd="makeProject" title="名前と、使うプラグインなどの設定を、チームで共有できるようにします（設定ファイル ${PROJECT_FILE} を作ります）">プロジェクトにする</button></div>`
    : "";
  return `<div class="sec"><span class="grow" data-folder title="${esc(title)}">${esc((named ?? f.ref.name).toUpperCase())}</span><button data-cmd="newInFolder" title="このフォルダに新しいファイル">＋</button><button data-cmd="refresh" title="一覧を更新">↻</button></div>${make}`;
}

/**
 * フォルダの中身をツリーの行の HTML にする。閉じたフォルダの中は出さない。開いているファイルには印を付ける。
 *
 * @param entries フォルダの中身
 * @param depth 入れ子の深さ（0 が最上位）
 * @returns 行の HTML。中身が無ければ ""
 * @example
 * // models フォルダ（開いている）の中に a.sysml がある
 * folderRows(entries, 0)
 * // → '<div class="fi" data-dir="models" style="--d:0">…models…</div><div class="fi" data-file="…" style="--d:1" …>…a.sysml…</div>'
 * folderRows([], 0) // → ""
 */
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
 * 横のパネルを、ファイル（エクスプローラー）とモデル（ツリー）のどちらかに切り替え、選んだ方を保存する。
 *
 * @param which "files"：ファイル・"model"：モデル
 */
function showSide(which: "files" | "model"): void {
  $("#filesSide").hidden = which !== "files";
  $("#modelSide").hidden = which !== "model";
  $("#sideFiles").setAttribute("aria-selected", String(which === "files"));
  $("#sideModel").setAttribute("aria-selected", String(which === "model"));
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
 * 開いているメニュー（details.menu）をすべて閉じる。
 */
function closeMenus(): void {
  document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
}

/**
 * ファイルメニュー・自動保存の切り替え（F-FILE-6）・ショートカット（Ctrl+S で保存、Ctrl+Shift+S で名前を付けて保存、Ctrl+O で開く）に操作をつなぐ。
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

/**
 * エクスプローラーに操作をつなぐ。文書を押して表示・閉じる、フォルダの開閉、フォルダのファイルを開く、
 * 新しいファイル・一覧の更新・プロジェクトにする・フォルダを開くのボタン。前回選んだ横のパネルを戻す。
 */
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
    if (c === "makeProject") return void makeProject();
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

/**
 * ファイル操作を初期化し、前回の下書き（無ければサンプル）を表示する（F-FILE-11）。起動時に 1 回呼ぶ。
 * テキストと配置の変更をワークスペースに反映し、未保存のままページを離れるときに警告し（F-FILE-5）、
 * 画面に戻ったときに他のアプリでの変更を確かめる（F-FILE-8）。
 *
 * @param sample サンプルの文書（名前・テキスト・配置ファイルの文字列）
 */
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
  // 設定ファイルの読み取りの状態を先に変えてから描く
  ws.subscribe(syncProject);
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
