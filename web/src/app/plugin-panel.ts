// プラグイン（ADR-0018 §1・ADR-0019）の画面：プロジェクトとこのブラウザに追加したプラグインを読み込んでコアに渡し、
// 一覧・追加（追加先を選ぶ）・有効／無効の切り替え・削除を行う。
// 判断と画面の言葉は plugins.ts の純粋関数に任せ、ここはファイルとブラウザの保存場所の読み書きと描画だけを行う。

import type { FolderRef } from "../files/types";
import { hasFolderFiles, hasFolderTrees, type FolderFiles, type FolderTrees } from "../files/types";
import type { PluginFiles, PluginInfo, PluginSummary, ProjectFile, ProjectFileResult } from "../core";
import { PROJECT_FILE, type OpenFolder } from "../workspace/workspace";
import { ask } from "./dialog";
import { $, closest, esc } from "./dom";
import { openModal } from "./modal";
import {
  addPrompt, browserPluginFiles, browserRows, browserScriptPlugins, installFiles, isSafeName, MANIFEST_FILE, missingNotice, panelIntro, PLACE_LABEL, pluginNotes, pluginRows, PLUGINS_DIR,
  projectBlocked, removePrompt, scriptPlugins, SHADOWED_NOTICE, STATE_LABEL, type PanelPlace, type PluginPlace, type PluginRow,
} from "./plugins";
import type { BrowserPlugin, BrowserPluginStore, PluginDataStore } from "../plugins/browser-store";
import { allowScriptPlugin, initScriptHost, runInfo, startScriptPlugin, stopScriptPlugin, syncScriptPlugins } from "../plugins/host";
import { permissionLines } from "../plugins/permissions";
import { utf8Bytes } from "../plugins/storage";
import { RUN_STATE_LABEL, type RunState } from "../plugins/view";
import { projectTitle } from "./project";
import { S } from "./state";
import { coreClient, renderProblems, toast, toastFailure, updateSync } from "./sync";

/** 選んだプラグインのフォルダ（名前と、フォルダからの相対パス → テキスト）。 */
export interface PickedPluginFolder {
  name: string;
  files: Record<string, string>;
}

/** プラグインの画面が使う、ファイル操作の画面（files.ts）の状態と操作と、このブラウザの保存場所。 */
export interface PluginEnv {
  /** このブラウザでフォルダを開けるか。 */
  canOpenFolders: boolean;
  /** 開いているフォルダ。無ければ null。 */
  folder(): OpenFolder | null;
  /** 開いているフォルダのプロジェクトの設定を読み取った結果。設定ファイルが無い・まだ読み取っていなければ null。 */
  project(): ProjectFileResult | null;
  /** 開いているフォルダの一覧と設定ファイルを読み直し、プラグインも読み込み直す（reloadPlugins を呼ぶ）。 */
  refreshFolder(): Promise<void>;
  /** エクスプローラーを描き直す。 */
  rerender(): void;
  /** プラグインのフォルダを選ばせ、中のファイルを読む。選ばなければ null。読めなければ例外（Error）。 */
  pickPluginFolder(): Promise<PickedPluginFolder | null>;
  /** 読み込んだテキストを新しい無題の文書として開いて表示し、付けた名前を返す。 */
  openImported(fileName: string, text: string): string;
  /** 開いている文書があるか（F-FILE-14）。 */
  hasOpenDoc(): boolean;
  /** このブラウザに追加したプラグインの置き場所。 */
  browser: BrowserPluginStore;
  /** プラグイン用の保存場所。 */
  data: PluginDataStore;
}

/** 設定ファイルが他のアプリで変わっていたときの知らせ。 */
const PROJECT_CHANGED = "プロジェクトの設定（modelith.json）が他のアプリで変更されていたため、読み込み直しました。もう一度操作してください";

let env: PluginEnv | null = null;
/** コアが読み込んだプラグインのまとめ。 */
let summaries: PluginSummary[] = [];
/** 今の一覧の行（プロジェクトのもの、このブラウザのものの順）。 */
let rows: PluginRow[] = [];
/** このブラウザに追加したプラグイン。 */
let browserPlugins: BrowserPlugin[] = [];
/** このブラウザの保存場所を使えなかったことを、もう知らせたか（読み込むたびに知らせない）。 */
let browserErrorShown = false;
/** コアにプラグインを渡してあるか（渡していなければ、空にし直す必要が無い）。 */
let coreHasPlugins = false;
/** 読み込みの順番（古い読み込みの結果を捨てる）。 */
let loadSeq = 0;

/**
 * 初期化で受け取った、ファイル操作の画面の状態と操作を返す。
 *
 * @returns initPlugins で渡したもの。まだ初期化していなければ例外（Error）を投げる
 * @example
 * // initPlugins(e) の後
 * pluginEnv() // → e
 */
function pluginEnv(): PluginEnv {
  if (!env) throw new Error("プラグインの画面がまだ初期化されていません");
  return env;
}

/**
 * 開いているフォルダが、プラグインのファイルを読み書きできるプロバイダのものなら、そのフォルダとプロバイダを返す。
 *
 * @returns フォルダ・プロバイダ・設定ファイルのテキスト。フォルダが無い・読み書きできなければ null
 * @example
 * pluginFolder() // → { ref: { name: "project", … }, source: LocalFolderProvider, projectText: "{…}" }
 * pluginFolder() // → null（フォルダを開いていない）
 */
function pluginFolder(): { ref: FolderRef; source: FolderTrees & FolderFiles; projectText: string | null } | null {
  const f = pluginEnv().folder();
  if (!f) return null;
  const source = f.source;
  if (!hasFolderTrees(source) || !hasFolderFiles(source)) return null;
  return { ref: f.ref, source, projectText: f.projectText };
}

/**
 * 読み取れたプロジェクトの設定を返す。
 *
 * @returns 設定。プロジェクトでない・読み取れない・まだ読み取っていなければ null
 * @example
 * currentProject() // → { name: "給水システム", plugins: { "jp.x": {…} } }
 * currentProject() // → null（modelith.json の無いフォルダ）
 */
const currentProject = (): ProjectFile | null => pluginEnv().project()?.project ?? null;

/* ---- 読み込み ---- */

/**
 * プロジェクトが使うプラグインのファイルを `.modelith/plugins/<ID>/` から、このブラウザに追加したプラグインを保存場所から読み、コアに渡す（ADR-0018 §1）。
 * 同じ ID のプラグインがプロジェクトにあれば、このブラウザのものは渡さない（プロジェクトのものが優先）。
 * 結果（まとめ）から一覧・問題一覧・エクスプローラーの案内を描き直し、v1 のプラグイン（TypeScript）を、動かすものに合わせる（止める・許可を確かめて動かす）。
 * 起動したとき・フォルダを開いた・開き直した・一覧を更新した・設定ファイルが変わった・追加や削除や切り替えをしたときに呼ぶ。
 */
export async function reloadPlugins(): Promise<void> {
  const seq = ++loadSeq;
  const project = currentProject();
  const f = pluginFolder();
  const [projectFiles, browser] = await Promise.all([
    project && f ? Promise.all(Object.entries(project.plugins).map(async ([id, use]) => ({ id, enabled: use.enabled, files: await readPlugin(f, id) }))) : Promise.resolve<PluginFiles[]>([]),
    loadBrowserPlugins(),
  ]);
  if (seq !== loadSeq) return;
  browserPlugins = browser;
  const plugins = [...projectFiles, ...browserPluginFiles(browser, project)];
  if (plugins.length || coreHasPlugins) {
    const result = await coreClient().setPlugins(plugins);
    if (seq !== loadSeq) return;
    coreHasPlugins = plugins.length > 0;
    summaries = result.plugins;
    if (result.error) toast(result.error);
  } else {
    summaries = [];
  }
  publish(project);
  // v1 のプラグイン（TypeScript）は、許可を確かめてから隔離した場所で動かす（ADR-0018 §3・§5）
  void syncScriptPlugins([...scriptPlugins(project, summaries, projectFiles), ...browserScriptPlugins(browser, project, summaries)]);
}

/**
 * このブラウザに追加したプラグインを読む。保存場所を使えなければ、一度だけ知らせて、無いものとして続ける。
 *
 * @returns 追加したプラグイン。使えなければ空
 * @example
 * await loadBrowserPlugins() // → [{ id: "jp.example.review", enabled: true, … }]
 * await loadBrowserPlugins() // → []（プライベートモードなどで使えない。トーストで知らせる）
 */
async function loadBrowserPlugins(): Promise<BrowserPlugin[]> {
  try {
    return await pluginEnv().browser.list();
  } catch (e) {
    if (!browserErrorShown) toastFailure("このブラウザの保存場所を使えないため、このブラウザに追加したプラグインを読み込めません", e);
    browserErrorShown = true;
    return [];
  }
}

/**
 * プラグイン 1 つのフォルダのファイルを読む。
 *
 * @param f 開いているフォルダとプロバイダ
 * @param id プラグインの ID
 * @returns プラグインのフォルダからの相対パス → テキスト。未追加・ID がフォルダの名前にできない・読めないときは空
 *   （コアが「追加されていない」「ID の形が正しくない」と知らせる。読めなかった理由はトーストで知らせる）
 * @example
 * await readPlugin(f, "jp.x")  // → { "modelith-plugin.json": "{…}", "rules.yaml": "…" }
 * await readPlugin(f, "../x")  // → {}（読まない）
 */
async function readPlugin(f: { ref: FolderRef; source: FolderTrees }, id: string): Promise<Record<string, string>> {
  if (!isSafeName(id)) return {};
  try {
    return (await f.source.readTree(f.ref, `${PLUGINS_DIR}/${id}`)) ?? {};
  } catch (e) {
    toastFailure(`プラグイン「${id}」を読み込めませんでした`, e);
    return {};
  }
}

/**
 * まとめから一覧の行を作り直し、問題一覧・同期の状態・エクスプローラー・開いていればプラグインの一覧を描き直す。
 *
 * @param project 今のプロジェクトの設定（無ければ null）
 */
function publish(project: ProjectFile | null): void {
  rows = [...(project ? pluginRows(project, summaries) : []), ...browserRows(browserPlugins, project, summaries)];
  S.pluginNotes = pluginNotes(rows);
  S.pluginNames = new Map(rows.filter((r) => r.state !== "shadowed").map((r) => [r.id, r.name]));
  renderProblems();
  updateSync();
  pluginEnv().rerender();
  renderPanel();
}

/* ---- エクスプローラー ---- */

/**
 * エクスプローラーのプロジェクトの見出しの下に出す、「プラグイン」のボタンと、足りないプラグインの案内の HTML を作る（F-PLUG-9）。
 *
 * @returns HTML。プロジェクトでなければ ""
 * @example
 * pluginExplorerHtml() // → '<div class="mkproj"><button data-cmd="plugins" …>プラグイン</button></div><div class="msg plugnote">このプロジェクトで使うプラグイン「jp.x」が追加されていません。…<br><button data-cmd="addPlugin">追加…</button></div>'
 * pluginExplorerHtml() // → ""（modelith.json の無いフォルダ）
 */
export function pluginExplorerHtml(): string {
  if (!env || !currentProject()) return "";
  const projectRows = rows.filter((r) => r.place === "project");
  const button = `<div class="mkproj"><button data-cmd="plugins" title="このプロジェクトに追加したプラグイン（チェックルールなど）の一覧">プラグイン${projectRows.length ? `（${projectRows.length}）` : ""}</button></div>`;
  const notices = projectRows
    .filter((r) => r.enabled)
    .flatMap((r) => {
      const notice = missingNotice(r);
      return notice ? [`<div class="msg plugnote">${esc(notice)}<br><button data-cmd="addPlugin">追加…</button></div>`] : [];
    });
  return button + notices.join("");
}

/* ---- 一覧（パネル） ---- */

/**
 * 今の場面（フォルダを開けないブラウザ・フォルダ無し・プロジェクトでないフォルダ・読めない設定・プロジェクト）を決める。
 *
 * @returns プラグインの一覧の場面
 * @example
 * panelPlace() // → { kind: "project", projectName: "給水システム" }
 * panelPlace() // → { kind: "noFolder" }（フォルダを開いていない）
 */
function panelPlace(): PanelPlace {
  const e = pluginEnv();
  const f = e.folder();
  if (!e.canOpenFolders) return { kind: "unsupported" };
  if (!f || !pluginFolder()) return { kind: "noFolder" };
  if (f.projectText === null) return { kind: "folder", folderName: f.ref.name };
  const result = e.project();
  if (result && !result.project) return { kind: "brokenProject" };
  return { kind: "project", projectName: projectTitle(f.ref.name, result?.project ?? null) };
}

/**
 * プラグインの一覧の 1 行の HTML を作る（名前・状態・入れた先・ID・バージョン・ルールやコマンドの数・権限・案内・問題・有効の切り替え・削除）。
 * v1 のプラグイン（TypeScript）は、動かしている状態・権限・知らせと、許可・停止・開始のボタンも出す。
 *
 * @param r 一覧の行
 * @returns 行の HTML
 * @example
 * rowHtml({ id: "jp.x", name: "トレーサビリティのチェック", state: "ok", runtime: "rules", place: "project", … })
 * // → '<div class="plug" data-plugin="jp.x" data-place="project"><div class="ph"><b>トレーサビリティのチェック</b><span class="pst ok">有効</span><span class="ploc">このプロジェクト</span></div>…</div>'
 * rowHtml({ id: "jp.y", name: "要求の ID の補完", state: "ok", runtime: "browser", place: "browser", … }) // → '…<span class="pst running">実行中</span>…<button data-plugin-stop="jp.y">停止</button>…'
 */
function rowHtml(r: PluginRow): string {
  const script = r.runtime === "browser";
  const run = script && r.state === "ok" ? runInfo(r.id) : undefined;
  const version = r.version ?? "—";
  const wanted = r.wanted && r.wanted !== r.version ? `（設定では ${esc(r.wanted)}）` : "";
  const notice = r.enabled && r.place === "project" ? missingNotice(r) : null;
  const help = notice ? `<p class="pn">${esc(notice)} <button data-cmd="addPlugin">追加…</button></p>` : r.state === "shadowed" ? `<p class="pm">${esc(SHADOWED_NOTICE)}</p>` : "";
  const lines = [...(r.state !== "missing" ? r.problems : []), ...(run?.notices ?? [])];
  const problems = lines.length ? `<ul class="pp">${lines.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  const status = run ? `<span class="pst ${run.state}">${RUN_STATE_LABEL[run.state]}</span>` : `<span class="pst ${r.state}">${STATE_LABEL[r.state]}</span>`;
  // プロジェクトのものを優先しているプラグインは読み込まないので、ルールの数は分からない
  const count = r.state === "shadowed" ? "" : script ? `・コマンド ${r.commands} 件` : `・ルール ${r.rules} 件`;
  const at = `data-place="${r.place}"`;
  const removeButton = `<button data-remove="${esc(r.id)}" ${at} class="danger">削除</button>`;
  const permissions = script ? `<ul class="pperm" aria-label="権限">${permissionLines(r.permissions).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  return (
    `<div class="plug" data-plugin="${esc(r.id)}" ${at}>` +
    `<div class="ph"><b>${esc(r.name)}</b>${status}<span class="ploc" title="追加先">${PLACE_LABEL[r.place]}</span></div>` +
    `<div class="pm">ID：${esc(r.id)}・バージョン：${esc(version)}${wanted}${count}</div>${permissions}${help}${problems}` +
    `<div class="pa"><label><input type="checkbox" data-toggle="${esc(r.id)}" ${at}${r.enabled ? " checked" : ""}> 有効</label>` +
    (run ? `<span class="pbtns">${runButton(r.id, run.state)}${removeButton}</span>` : removeButton) +
    `</div>` +
    `</div>`
  );
}

/**
 * v1 のプラグインの、状態に応じたボタン（許可する・停止・開始）の HTML を作る。
 *
 * @param id プラグインの ID
 * @param state 動かしている状態
 * @returns ボタンの HTML。押せるボタンが無い状態（確認中など）では ""
 * @example
 * runButton("jp.y", "denied")  // → '<button data-plugin-allow="jp.y">許可する…</button>'
 * runButton("jp.y", "running") // → '<button data-plugin-stop="jp.y">停止</button>'
 * runButton("jp.y", "stopped") // → '<button data-plugin-start="jp.y">開始</button>'
 * runButton("jp.y", "asking")  // → ""
 */
function runButton(id: string, state: RunState): string {
  const at = esc(id);
  if (state === "denied") return `<button data-plugin-allow="${at}">許可する…</button>`;
  if (state === "running" || state === "starting") return `<button data-plugin-stop="${at}">停止</button>`;
  if (state === "stopped" || state === "failed") return `<button data-plugin-start="${at}">開始</button>`;
  return "";
}

/** プラグインの一覧を開いていれば、今の状態で描き直す。 */
function renderPanel(): void {
  const box = $("#plugins");
  if (box.hidden) return;
  const place = panelPlace();
  const intro = panelIntro(place, rows.filter((r) => r.place === "project").length);
  $("#pluginsBody").innerHTML = `<p>${esc(intro)}</p>` + rows.map(rowHtml).join("");
}

/** 開いているプラグインの一覧を閉じる操作（閉じていれば null）。 */
let closePanel: (() => void) | null = null;

/**
 * プラグインの一覧を開き、閉じるボタンに入力を移す（F-PLUG-8）。開いている間は背景を操作できない（Q-8）。
 */
export function openPlugins(): void {
  closePanel = openModal($("#plugins"));
  renderPanel();
  $<HTMLButtonElement>("#pluginsClose").focus();
}

/** プラグインの一覧を閉じ、開く前の要素へ入力を戻す（Q-8）。 */
function closePlugins(): void {
  closePanel?.();
  closePanel = null;
}

/* ---- 書き換え ---- */

/**
 * 設定ファイルが、読んだ後に他のアプリで変わっていないかを確かめる。変わっていれば読み直して知らせる（黙って上書きしない）。
 *
 * @param f 開いているフォルダ・プロバイダ・読んだときの設定ファイルのテキスト
 * @returns 変わっていなければ true
 * @example
 * await isProjectFresh(f) // → true
 * await isProjectFresh(f) // → false（他で書き換えられていた。一覧を読み直し、トーストで知らせる）
 */
async function isProjectFresh(f: { ref: FolderRef; source: FolderFiles; projectText: string | null }): Promise<boolean> {
  if ((await f.source.readInFolder(f.ref, PROJECT_FILE)) === f.projectText) return true;
  await pluginEnv().refreshFolder();
  toast(PROJECT_CHANGED);
  return false;
}

/**
 * プラグインの有効・無効を切り替える。プロジェクトのものは設定ファイルに書き（チームでそろう）、このブラウザのものは保存場所に書く（F-PLUG-8）。
 *
 * @param id プラグインの ID
 * @param place 入れた先
 * @param enabled 有効にするなら true
 */
async function setEnabled(id: string, place: PluginPlace, enabled: boolean): Promise<void> {
  const name = rows.find((r) => r.id === id && r.place === place)?.name ?? id;
  const done = enabled ? `プラグイン「${name}」を有効にしました` : `プラグイン「${name}」を無効にしました。このプラグインのチェック結果は表示されなくなります`;
  if (place === "browser") {
    const p = browserPlugins.find((x) => x.id === id);
    if (!p) return;
    try {
      await pluginEnv().browser.put({ ...p, enabled });
      await reloadPlugins();
      toast(done);
    } catch (e) {
      toastFailure("このブラウザに保存できませんでした", e);
    }
    return;
  }
  const f = pluginFolder();
  const text = f?.projectText;
  if (!f || text == null) return;
  const updated = await coreClient().updateProjectPlugin(text, id, { op: "setEnabled", enabled });
  if ("refused" in updated) return toast(updated.refused);
  try {
    if (!(await isProjectFresh(f))) return;
    await f.source.writeInFolder(f.ref, PROJECT_FILE, updated.text);
    await pluginEnv().refreshFolder();
    toast(done);
  } catch (e) {
    toastFailure("プロジェクトの設定を保存できませんでした", e);
  }
}

/**
 * 確かめてから、プラグインを削除する（F-PLUG-8）。プロジェクトのものはフォルダを削除して設定ファイルから登録を外し、このブラウザのものは保存場所から消す。
 * プラグインがこのブラウザにデータを保存していて、同じ ID のプラグインが残らないときは、データも削除するかを尋ねる（既定は残す）。
 *
 * @param id プラグインの ID
 * @param place 入れた先
 */
async function removePlugin(id: string, place: PluginPlace): Promise<void> {
  const row = rows.find((r) => r.id === id && r.place === place);
  if (!row) return;
  const otherCopy = rows.some((r) => r.id === id && r.place !== place);
  const prompt = removePrompt(row, await storedBytes(id), otherCopy);
  const r = await ask("プラグインを削除", prompt.text, [
    { id: "cancel", label: "やめる" },
    { id: "remove", label: "削除する", kind: "danger" },
  ], undefined, undefined, prompt.data ? {
    label: prompt.data.label,
    value: "keep",
    options: [
      { id: "keep", label: "残す", note: "同じプラグインをもう一度追加したときに使えます。" },
      { id: "delete", label: "削除する", note: "このプラグインが保存した設定や記録を消します。元に戻せません。" },
    ],
  } : undefined);
  if (r?.id !== "remove") return;
  const removed = place === "browser" ? await removeFromBrowser(id, row.name) : await removeFromProject(id, row.name);
  if (!removed || r.option !== "delete") return;
  try {
    await pluginEnv().data.write(id, null);
  } catch (e) {
    toastFailure("プラグインのデータを削除できませんでした", e);
  }
}

/**
 * このブラウザに保存された、プラグインのデータの大きさを求める（使えなければ 0）。
 *
 * @param id プラグインの ID
 * @returns UTF-8 のバイト数
 * @example
 * await storedBytes("jp.example.review") // → 13（'{"count":3}' など）
 * await storedBytes("jp.none")           // → 0
 */
async function storedBytes(id: string): Promise<number> {
  try {
    const json = await pluginEnv().data.read(id);
    return json === null ? 0 : utf8Bytes(json);
  } catch {
    return 0;
  }
}

/**
 * プラグインを、このプロジェクトから削除する（フォルダを削除し、設定ファイルから登録を外す）。
 *
 * @param id プラグインの ID
 * @param name 画面に出す名前
 * @returns 削除したら true。他のアプリで設定ファイルが変わっていた・書けなかったら false（理由はトーストで知らせる）
 * @example
 * await removeFromProject("jp.x", "トレーサビリティのチェック") // → true（.modelith/plugins/jp.x/ と modelith.json の登録が消える）
 */
async function removeFromProject(id: string, name: string): Promise<boolean> {
  const f = pluginFolder();
  const text = f?.projectText;
  if (!f || text == null) return false;
  const updated = await coreClient().updateProjectPlugin(text, id, { op: "remove" });
  if ("refused" in updated) {
    toast(updated.refused);
    return false;
  }
  try {
    if (!(await isProjectFresh(f))) return false;
    await f.source.writeInFolder(f.ref, PROJECT_FILE, updated.text);
    if (isSafeName(id)) await f.source.removeInFolder(f.ref, `${PLUGINS_DIR}/${id}`);
    await pluginEnv().refreshFolder();
    toast(`プラグイン「${name}」を削除しました`);
    return true;
  } catch (e) {
    toastFailure("プラグインを削除できませんでした", e);
    return false;
  }
}

/**
 * プラグインを、このブラウザから削除する。
 *
 * @param id プラグインの ID
 * @param name 画面に出す名前
 * @returns 削除したら true。保存場所を使えなければ false（理由はトーストで知らせる）
 * @example
 * await removeFromBrowser("jp.example.review", "レビューの記録") // → true
 */
async function removeFromBrowser(id: string, name: string): Promise<boolean> {
  try {
    await pluginEnv().browser.remove(id);
    await reloadPlugins();
    toast(`プラグイン「${name}」をこのブラウザから削除しました`);
    return true;
  } catch (e) {
    toastFailure("プラグインを削除できませんでした", e);
    return false;
  }
}

/**
 * 「追加」：プラグインのフォルダを選んでもらい、中身と追加先（このプロジェクト・このブラウザ）を示して確かめてから追加する（F-PLUG-8・F-PLUG-9）。
 * 「このプロジェクト」に追加できない場面（フォルダが無い・フォルダを開けないブラウザ・読めない設定）では、「このブラウザ」を選んでおく。
 * まだプロジェクトでないフォルダに追加するときは、同じ確認でプロジェクトの名前を尋ね、設定ファイルを作る（C-6：利用者の操作なしに書かない）。
 * 画面に機能を追加するプラグイン（TypeScript）は、使う権限も示す。WebAssembly で動くプラグインは、まだ追加できないと伝える。
 */
export async function addPlugin(): Promise<void> {
  try {
    const picked = await pluginEnv().pickPluginFolder();
    if (!picked) return;
    const manifest = picked.files[MANIFEST_FILE];
    if (manifest === undefined) return toast(`選んだフォルダ「${picked.name}」には、プラグインの情報（${MANIFEST_FILE}）がありません。プラグインのフォルダを選んでください`);
    const described = await coreClient().describePlugin(manifest);
    if ("refused" in described) return toast(`選んだフォルダのプラグインを読み込めません。${described.refused}`);
    const info = described.plugin;
    const blocked = projectBlocked(panelPlace());
    const prompt = addPrompt(info, {
      project: currentProject(),
      blocked,
      inProject: rows.some((r) => r.id === info.id && r.place === "project" && r.version !== null),
      inBrowser: browserPlugins.some((p) => p.id === info.id),
    });
    if ("refused" in prompt) {
      await ask("プラグインを追加", prompt.refused, [{ id: "ok", label: "閉じる", kind: "primary" }]);
      return;
    }
    const f = pluginFolder();
    const r = await ask(
      "プラグインを追加",
      prompt.text,
      [
        { id: "cancel", label: "やめる" },
        { id: "ok", label: "追加する", kind: "primary" },
      ],
      prompt.places.some((p) => p.askName) && f ? { value: f.ref.name, label: "プロジェクト名" } : undefined,
      prompt.items ? { items: prompt.items, warning: prompt.warning } : undefined,
      { label: "追加先", value: prompt.initial, options: prompt.places.map((p) => ({ id: p.id, label: p.label, note: p.note, disabled: p.disabled, confirm: p.confirm, input: p.askName })) },
    );
    if (r?.id !== "ok") return;
    if (r.option === "browser") return await installInBrowser(info, picked.files);
    const place = prompt.places.find((p) => p.id === "project");
    if (!f || !place || place.disabled) return;
    await install(f, picked.files, info, place.askName ? r.value.trim() || f.ref.name : null);
  } catch (e) {
    toastFailure("プラグインを追加できませんでした", e);
  }
}

/**
 * 選んだフォルダのプラグインを、`.modelith/plugins/<ID>/` にコピーし（前にあったものは消す）、設定ファイルに登録する。
 * 設定ファイルを先に計算し、他のアプリで変わっていないことを確かめてから書く。
 *
 * @param f 開いているフォルダ・プロバイダ・設定ファイルのテキスト
 * @param files 選んだプラグインのフォルダのファイル（フォルダからの相対パス → テキスト）
 * @param info マニフェストから読んだ、プラグインの情報
 * @param newProjectName まだプロジェクトでないときの、新しいプロジェクトの名前（プロジェクトなら null）
 * @returns 終わったら解決する Promise。読み書きの失敗は例外で拒否する（呼び出し側が知らせる）
 */
async function install(f: { ref: FolderRef; source: FolderTrees & FolderFiles; projectText: string | null }, files: Record<string, string>, info: PluginInfo, newProjectName: string | null): Promise<void> {
  const plan = installFiles(info.id, files);
  if ("refused" in plan) return toast(plan.refused);
  const base = newProjectName === null ? f.projectText : await createdProjectText(newProjectName);
  if (base === null) return;
  const updated = await coreClient().updateProjectPlugin(base, info.id, { op: "add", version: info.version });
  if ("refused" in updated) return toast(updated.refused);
  if (!(await isProjectFresh(f))) return;
  await f.source.removeInFolder(f.ref, `${PLUGINS_DIR}/${info.id}`);
  for (const [path, text] of plan.files) await f.source.writeInFolder(f.ref, path, text);
  await f.source.writeInFolder(f.ref, PROJECT_FILE, updated.text);
  await pluginEnv().refreshFolder();
  toast(`プラグイン「${info.name}」をこのプロジェクトに追加しました`);
}

/**
 * 選んだフォルダのプラグインを、このブラウザの保存場所に追加する（同じ ID のものは置き換える。有効にしておく）。
 * フォルダの外を指すパスがあれば追加しない（プロジェクトに追加するときと同じ確かめ方）。
 *
 * @param info マニフェストから読んだ、プラグインの情報
 * @param files 選んだプラグインのフォルダのファイル
 * @returns 終わったら解決する Promise。保存できなければ例外で拒否する（呼び出し側が知らせる）
 */
async function installInBrowser(info: PluginInfo, files: Record<string, string>): Promise<void> {
  const plan = installFiles(info.id, files);
  if ("refused" in plan) return toast(plan.refused);
  await pluginEnv().browser.put({ id: info.id, enabled: true, info, files });
  await reloadPlugins();
  toast(`プラグイン「${info.name}」をこのブラウザに追加しました`);
}

/**
 * 新しいプロジェクトの設定ファイルのテキストを、コアに作ってもらう。
 *
 * @param name プロジェクトの名前
 * @returns テキスト。作れなければ理由をトーストで知らせて null
 * @example
 * await createdProjectText("給水システム") // → '{\n  "name": "給水システム",\n  "plugins": {}\n}\n'
 */
async function createdProjectText(name: string): Promise<string | null> {
  const made = await coreClient().createProjectFile(name);
  if (!("refused" in made)) return made.text;
  toast(made.refused);
  return null;
}

/* ---- 登録 ---- */

/**
 * 入れた先の値（data-place）を読む。
 *
 * @param el 値を持つ要素
 * @returns 入れた先（無い・知らない値なら project）
 * @example
 * placeOf(<button data-place="browser">) // → "browser"
 * placeOf(<button>)                      // → "project"
 */
function placeOf(el: HTMLElement): PluginPlace {
  return el.dataset["place"] === "browser" ? "browser" : "project";
}

/**
 * プラグインの画面を初期化する。ファイルメニューの「プラグイン…」・一覧の操作（追加・有効・削除・許可・停止・開始・閉じる）・
 * 問題一覧の足りないプラグインの行（押すと追加）と、v1 のプラグインのホストをつなぎ、このブラウザに追加したプラグインを読み込む。起動時に 1 回呼ぶ。
 *
 * @param e ファイル操作の画面の状態と操作と、このブラウザの保存場所
 */
export function initPlugins(e: PluginEnv): void {
  env = e;
  initScriptHost({ onChange: renderPanel, openImported: (fileName, text) => e.openImported(fileName, text), hasOpenDoc: () => e.hasOpenDoc(), data: e.data });
  $("#btnPlugins").onclick = () => {
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
    openPlugins();
  };
  const box = $("#plugins");
  $("#pluginsClose").onclick = closePlugins;
  $("#pluginsAdd").onclick = () => void addPlugin();
  box.addEventListener("click", (ev) => {
    if (ev.target === box) return closePlugins();
    if (closest(ev, '[data-cmd="addPlugin"]')) return void addPlugin();
    const remove = closest(ev, "[data-remove]");
    if (remove) return void removePlugin(remove.dataset["remove"] ?? "", placeOf(remove));
    const allow = closest(ev, "[data-plugin-allow]")?.dataset["pluginAllow"];
    if (allow !== undefined) return allowScriptPlugin(allow);
    const stop = closest(ev, "[data-plugin-stop]")?.dataset["pluginStop"];
    if (stop !== undefined) return stopScriptPlugin(stop);
    const start = closest(ev, "[data-plugin-start]")?.dataset["pluginStart"];
    if (start !== undefined) startScriptPlugin(start);
  });
  box.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.dataset["toggle"] !== undefined) void setEnabled(t.dataset["toggle"], placeOf(t), t.checked);
  });
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closePlugins();
  });
  $("#problems").addEventListener("click", (ev) => {
    if (closest(ev, "[data-plugin-add]")) void addPlugin();
  });
  void reloadPlugins();
}
