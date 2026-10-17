// プラグイン（ADR-0018 §1・ADR-0019）の画面：プロジェクトに入れたプラグインを読み込んでコアに渡し、一覧・追加・使う／止める・削除を行う。
// 判断と画面の言葉は plugins.ts の純粋関数に任せ、ここはファイルの読み書きと描画だけを行う。

import type { FolderRef } from "../files/types";
import { hasFolderFiles, hasFolderTrees, type FolderFiles, type FolderTrees } from "../files/types";
import type { PluginFiles, PluginInfo, PluginSummary, ProjectFile, ProjectFileResult } from "../core";
import { PROJECT_FILE, type OpenFolder } from "../workspace/workspace";
import { ask } from "./dialog";
import { $, closest, esc } from "./dom";
import {
  addPrompt, installFiles, isSafeName, MANIFEST_FILE, missingNotice, panelIntro, pluginNotes, pluginRows, PLUGINS_DIR, STATE_LABEL, type PanelPlace, type PluginRow,
} from "./plugins";
import { projectTitle } from "./project";
import { S } from "./state";
import { coreClient, renderProblems, toast, updateSync } from "./sync";

/** プラグインの画面が使う、ファイル操作の画面（files.ts）の状態と操作。 */
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
}

/** 設定ファイルが他のアプリで変わっていたときの知らせ。 */
const PROJECT_CHANGED = "プロジェクトの設定（modelith.json）が他のアプリで変更されていたため、読み直しました。もう一度操作してください";

let env: PluginEnv | null = null;
/** コアが読み込んだプラグインのまとめ。 */
let summaries: PluginSummary[] = [];
/** 今の一覧の行（プロジェクトが無ければ空）。 */
let rows: PluginRow[] = [];
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
 * currentProject() // → { name: "給水", plugins: { "jp.x": {…} } }
 * currentProject() // → null（modelith.json の無いフォルダ）
 */
const currentProject = (): ProjectFile | null => pluginEnv().project()?.project ?? null;

/* ---- 読み込み ---- */

/**
 * プロジェクトが使うプラグインのファイルを `.modelith/plugins/<ID>/` から読み、コアに渡す（ADR-0018 §1）。
 * プロジェクトが無ければ、コアのプラグインを空にする。結果（まとめ）から一覧・問題一覧・エクスプローラーの案内を描き直す。
 * フォルダを開いた・開き直した・一覧を更新した・設定ファイルが変わった・追加や削除をしたときに呼ぶ。
 */
export async function reloadPlugins(): Promise<void> {
  const seq = ++loadSeq;
  const project = currentProject();
  const f = pluginFolder();
  const plugins: PluginFiles[] = project && f ? await Promise.all(Object.entries(project.plugins).map(async ([id, use]) => ({ id, enabled: use.enabled, files: await readPlugin(f, id) }))) : [];
  if (seq !== loadSeq) return;
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
}

/**
 * プラグイン 1 つのフォルダのファイルを読む。
 *
 * @param f 開いているフォルダとプロバイダ
 * @param id プラグインの ID
 * @returns プラグインのフォルダからの相対パス → テキスト。入っていない・ID がフォルダの名前にできない・読めないときは空
 *   （コアが「入っていない」「ID の形が正しくない」と知らせる。読めなかった理由はトーストで知らせる）
 * @example
 * await readPlugin(f, "jp.x")  // → { "modelith-plugin.json": "{…}", "rules.yaml": "…" }
 * await readPlugin(f, "../x")  // → {}（読まない）
 */
async function readPlugin(f: { ref: FolderRef; source: FolderTrees }, id: string): Promise<Record<string, string>> {
  if (!isSafeName(id)) return {};
  try {
    return (await f.source.readTree(f.ref, `${PLUGINS_DIR}/${id}`)) ?? {};
  } catch (e) {
    toast(`プラグイン「${id}」を読み込めませんでした：${(e as Error).message}`);
    return {};
  }
}

/**
 * まとめから一覧の行を作り直し、問題一覧・同期の状態・エクスプローラー・開いていればプラグインの一覧を描き直す。
 *
 * @param project 今のプロジェクトの設定（無ければ null）
 */
function publish(project: ProjectFile | null): void {
  rows = project ? pluginRows(project, summaries) : [];
  S.pluginNotes = pluginNotes(rows);
  S.pluginNames = new Map(rows.map((r) => [r.id, r.name]));
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
 * pluginExplorerHtml() // → '<div class="mkproj"><button data-cmd="plugins" …>プラグイン</button></div><div class="msg plugnote">このプロジェクトはプラグイン「jp.x」を使っていますが、…<br><button data-cmd="addPlugin">追加…</button></div>'
 * pluginExplorerHtml() // → ""（modelith.json の無いフォルダ）
 */
export function pluginExplorerHtml(): string {
  if (!env || !currentProject()) return "";
  const button = `<div class="mkproj"><button data-cmd="plugins" title="このプロジェクトに入れたプラグイン（検査ルールなど）の一覧">プラグイン${rows.length ? `（${rows.length}）` : ""}</button></div>`;
  const notices = rows
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
 * panelPlace() // → { kind: "project", projectName: "給水" }
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
 * プラグインの一覧の 1 行の HTML を作る（名前・状態・ID・版・ルールの数・案内・問題・使うの切り替え・削除）。
 *
 * @param r 一覧の行
 * @returns 行の HTML
 * @example
 * rowHtml({ id: "jp.x", name: "トレース", state: "ok", … })
 * // → '<div class="plug" data-plugin="jp.x"><div class="ph"><b>トレース</b><span class="pst ok">使える</span></div>…</div>'
 */
function rowHtml(r: PluginRow): string {
  const version = r.version ?? "—";
  const wanted = r.wanted && r.wanted !== r.version ? `（設定では ${esc(r.wanted)}）` : "";
  const notice = r.enabled ? missingNotice(r) : null;
  const help = notice ? `<p class="pn">${esc(notice)} <button data-cmd="addPlugin">追加…</button></p>` : "";
  const problems = r.problems.length && r.state !== "missing" ? `<ul class="pp">${r.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  return (
    `<div class="plug" data-plugin="${esc(r.id)}">` +
    `<div class="ph"><b>${esc(r.name)}</b><span class="pst ${r.state}">${STATE_LABEL[r.state]}</span></div>` +
    `<div class="pm">ID：${esc(r.id)}・版：${esc(version)}${wanted}・ルール ${r.rules} 件</div>${help}${problems}` +
    `<div class="pa"><label><input type="checkbox" data-toggle="${esc(r.id)}"${r.enabled ? " checked" : ""}> 使う</label><button data-remove="${esc(r.id)}" class="danger">削除</button></div>` +
    `</div>`
  );
}

/** プラグインの一覧を開いていれば、今の状態で描き直す。 */
function renderPanel(): void {
  const box = $("#plugins");
  if (box.hidden) return;
  const intro = panelIntro(panelPlace(), rows.length);
  $("#pluginsBody").innerHTML = `<p>${esc(intro.text)}</p>` + rows.map(rowHtml).join("");
  $<HTMLButtonElement>("#pluginsAdd").disabled = !intro.canAdd;
}

/** プラグインの一覧を開き、閉じるボタンに入力を移す（F-PLUG-8）。 */
export function openPlugins(): void {
  $("#plugins").hidden = false;
  renderPanel();
  $<HTMLButtonElement>("#pluginsClose").focus();
}

/** プラグインの一覧を閉じる。 */
function closePlugins(): void {
  $("#plugins").hidden = true;
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
 * プラグインを使うか止めるかを、設定ファイルに書く（F-PLUG-8。チームでそろう）。
 *
 * @param id プラグインの ID
 * @param enabled 使うなら true
 */
async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const f = pluginFolder();
  const text = f?.projectText;
  if (!f || text == null) return;
  const name = rows.find((r) => r.id === id)?.name ?? id;
  const updated = await coreClient().updateProjectPlugin(text, id, { op: "setEnabled", enabled });
  if ("refused" in updated) return toast(updated.refused);
  try {
    if (!(await isProjectFresh(f))) return;
    await f.source.writeInFolder(f.ref, PROJECT_FILE, updated.text);
    await pluginEnv().refreshFolder();
    toast(enabled ? `プラグイン「${name}」を使うようにしました` : `プラグイン「${name}」を止めました。このプラグインの検査の結果は出なくなります`);
  } catch (e) {
    toast(`プロジェクトの設定を書き換えられませんでした：${(e as Error).message}`);
  }
}

/**
 * 確かめてから、プラグインをプロジェクトから削除する（フォルダを消し、設定ファイルから外す。F-PLUG-8）。
 *
 * @param id プラグインの ID
 */
async function removePlugin(id: string): Promise<void> {
  const f = pluginFolder();
  const text = f?.projectText;
  if (!f || text == null) return;
  const name = rows.find((r) => r.id === id)?.name ?? id;
  const r = await ask("プラグインを削除", `プラグイン「${name}」を、このプロジェクトから削除しますか？ ${PLUGINS_DIR}/${id}/ のファイルを消し、プロジェクトの設定（modelith.json）からも外します。`, [
    { id: "cancel", label: "やめる" },
    { id: "remove", label: "削除する", kind: "danger" },
  ]);
  if (r?.id !== "remove") return;
  const updated = await coreClient().updateProjectPlugin(text, id, { op: "remove" });
  if ("refused" in updated) return toast(updated.refused);
  try {
    if (!(await isProjectFresh(f))) return;
    await f.source.writeInFolder(f.ref, PROJECT_FILE, updated.text);
    if (isSafeName(id)) await f.source.removeInFolder(f.ref, `${PLUGINS_DIR}/${id}`);
    await pluginEnv().refreshFolder();
    toast(`プラグイン「${name}」を削除しました`);
  } catch (e) {
    toast(`プラグインを削除できませんでした：${(e as Error).message}`);
  }
}

/**
 * 「追加」：プラグインのフォルダを選んでもらい、中身を示して確かめてから、このプロジェクトに入れる（F-PLUG-8・F-PLUG-9）。
 * まだプロジェクトでないフォルダなら、同じ確認でプロジェクトの名前を尋ね、設定ファイルを作る（C-6：利用者の操作なしに書かない）。
 * 検査ルール以外のプラグインは、まだ追加できないと伝える。
 */
export async function addPlugin(): Promise<void> {
  const f = pluginFolder();
  if (!f) return toast("プラグインを追加するには、先に「ファイル → フォルダを開く…」でモデルのフォルダを開いてください");
  if (f.projectText !== null && !currentProject()) return toast("プロジェクトの設定（modelith.json）に誤りがあるため、プラグインを追加できません。先に設定ファイルを直してください");
  try {
    const picked = await f.source.pickOtherFolder();
    if (!picked) return;
    const manifest = await f.source.readInFolder(picked, MANIFEST_FILE);
    if (manifest === null) return toast(`選んだフォルダ「${picked.name}」には、プラグインの説明（${MANIFEST_FILE}）がありません。プラグインのフォルダを選んでください`);
    const described = await coreClient().describePlugin(manifest);
    if ("refused" in described) return toast(`選んだフォルダのプラグインを読み取れません。${described.refused}`);
    const info = described.plugin;
    const prompt = addPrompt(info, currentProject(), summaries.some((s) => s.id === info.id && s.installed));
    if ("refused" in prompt) {
      await ask("プラグインを追加", prompt.refused, [{ id: "ok", label: "閉じる", kind: "primary" }]);
      return;
    }
    const r = await ask("プラグインを追加", prompt.text, [
      { id: "cancel", label: "やめる" },
      { id: "ok", label: prompt.confirm, kind: "primary" },
    ], prompt.askName ? { value: f.ref.name, label: "プロジェクトの名前" } : undefined);
    if (r?.id !== "ok") return;
    await install(f, picked, info, prompt.askName ? r.value.trim() || f.ref.name : null);
  } catch (e) {
    toast(`プラグインを追加できませんでした：${(e as Error).message}`);
  }
}

/**
 * 選んだフォルダのプラグインを、`.modelith/plugins/<ID>/` に写し（前にあったものは消す）、設定ファイルに書き加える。
 * 設定ファイルを先に計算し、他のアプリで変わっていないことを確かめてから書く。
 *
 * @param f 開いているフォルダ・プロバイダ・設定ファイルのテキスト
 * @param picked 選んだプラグインのフォルダ
 * @param info マニフェストから読んだ、プラグインの情報
 * @param newProjectName まだプロジェクトでないときの、新しいプロジェクトの名前（プロジェクトなら null）
 * @returns 終わったら解決する Promise。読み書きの失敗は例外で拒否する（呼び出し側が知らせる）
 */
async function install(f: { ref: FolderRef; source: FolderTrees & FolderFiles; projectText: string | null }, picked: FolderRef, info: PluginInfo, newProjectName: string | null): Promise<void> {
  const plan = installFiles(info.id, (await f.source.readTree(picked, "")) ?? {});
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
  toast(`プラグイン「${info.name}」を、このプロジェクトに追加しました`);
}

/**
 * 新しいプロジェクトの設定ファイルのテキストを、コアに作ってもらう。
 *
 * @param name プロジェクトの名前
 * @returns テキスト。作れなければ理由をトーストで知らせて null
 * @example
 * await createdProjectText("給水") // → '{\n  "name": "給水",\n  "plugins": {}\n}\n'
 */
async function createdProjectText(name: string): Promise<string | null> {
  const made = await coreClient().createProjectFile(name);
  if (!("refused" in made)) return made.text;
  toast(made.refused);
  return null;
}

/* ---- 登録 ---- */

/**
 * プラグインの画面を初期化する。ファイルメニューの「プラグイン…」・一覧の操作（追加・使う・削除・閉じる）・
 * 問題一覧の足りないプラグインの行（押すと追加）をつなぐ。起動時に 1 回呼ぶ。
 *
 * @param e ファイル操作の画面の状態と操作
 */
export function initPlugins(e: PluginEnv): void {
  env = e;
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
    const remove = closest(ev, "[data-remove]")?.dataset["remove"];
    if (remove !== undefined) void removePlugin(remove);
  });
  box.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.dataset["toggle"] !== undefined) void setEnabled(t.dataset["toggle"], t.checked);
  });
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closePlugins();
  });
  $("#problems").addEventListener("click", (ev) => {
    if (closest(ev, "[data-plugin-add]")) void addPlugin();
  });
}
