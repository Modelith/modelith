// v1 のプラグイン（TypeScript、ADR-0018 §3〜§5）のホスト。プロジェクトかこのブラウザに入れたプラグインを、許可を確かめてから隔離した場所で動かし、
// テキストの変更を知らせ、届いたメッセージをコアに確かめてもらってから使う。コマンド・読み込み・書き出しをメニューから頼み、
// プラグイン用の保存場所（storage）をプラグインごとに分けて貸す。
// 判断は純粋関数（trust.ts・messages.ts・view.ts・permissions.ts・storage.ts・transfer.ts）とコア（Rust）に任せ、ここは状態の出し入れと画面の操作だけを行う。

import { applyTextEdits, type VersionedSnapshot } from "../core";
import { ask } from "../app/dialog";
import { $, closest, esc, store } from "../app/dom";
import { download } from "../app/export";
import { S } from "../app/state";
import { coreClient, onAnalyzedVersion, renderProblems, setText, toast, updateSync } from "../app/sync";
import { modelView } from "../app/views";
import type { PluginDataStore } from "./browser-store";
import { API_VERSION, type HostMessage, type Permission } from "./generated/protocol";
import { addNotice, decideMessage, flashRange, messageJson, STALE_PLUGIN_EDIT, type HostAction, type PendingRequest } from "./messages";
import { sandboxPage } from "./permissions";
import { startSandbox, type Sandbox } from "./sandbox";
import { PLUGIN_STORAGE_LIMIT, storageUpdate, storedValue } from "./storage";
import { base64ToBytes, bytesToBase64, MAX_TRANSFER_BYTES, sizeText } from "./transfer";
import { parseTrustStore, trustCheck, trustPrompt, trustRecord, type TrustCheck, type TrustRecord } from "./trust";
import { commandItems, exportItems, importItems, stopNotice, type CommandItem, type RunState, type ScriptPlugin } from "./view";

/** ホストが使う、画面の他の部分の操作と保存場所（初期化のときに受け取る）。 */
export interface HostEnv {
  /** 動かしているプラグインの状態が変わったときに呼ぶ処理（プラグインの一覧を描き直す）。 */
  onChange(): void;
  /** 読み込んだテキストを新しい無題の文書として開いて表示し、付けた名前を返す（既存のファイルは書き換えない。C-6）。 */
  openImported(fileName: string, text: string): string;
  /** 開いている文書があるか（無ければ、コマンドと書き出しは対象が無いので行わない。F-FILE-14）。 */
  hasOpenDoc(): boolean;
  /** プラグイン用の保存場所。 */
  data: PluginDataStore;
}

/** 一覧に出す、動かしているプラグインの状態と知らせ。 */
export interface RunInfo {
  state: RunState;
  /** 知らせ（新しいものが先）。 */
  notices: string[];
}

/** 動かしているプラグイン 1 つの状態。 */
interface Entry {
  plugin: ScriptPlugin;
  sha256: string;
  state: RunState;
  notices: string[];
  sandbox: Sandbox | null;
  /** 頼んで、まだ答えの無いこと（依頼の番号 → コマンド・読み込み・書き出しと、その表示名）。 */
  pending: Map<number, PendingRequest>;
  nextRequest: number;
  /** 届いたメッセージを、届いた順に 1 つずつ扱うためのつなぎ。 */
  queue: Promise<void>;
  /** 動かし始めるたびに増える番号。止めた後に届いた古い知らせを捨てる。 */
  run: number;
}

/** 開いているファイルが無いときに、コマンドや書き出しを頼まれたときの知らせ（F-FILE-14）。 */
const NO_OPEN_FILE = "開いているファイルがありません。ファイルを開いてから実行してください";

/** 許可を覚える localStorage のキー（形は trust.ts の TrustStore）。 */
const TRUST_KEY = "modelith-plugin-trust";

const entries = new Map<string, Entry>();
/** 画面の他の部分の操作と保存場所（initScriptHost で受け取る）。 */
let env: HostEnv | null = null;
/** 一覧が変わったときに呼ぶ処理（プラグインの一覧を描き直す）。 */
let changed: () => void = () => {};
/** プラグインの一覧を合わせる処理のつなぎ（許可の確認を挟むので、順に行う）。 */
let syncing: Promise<void> = Promise.resolve();
/** 最後に作った、プラグインに渡すモデル（同じ版で何度も作らない）。 */
let snapshotCache: { version: number; snapshot: Promise<VersionedSnapshot | null> } | null = null;

/**
 * ホストを初期化する。解析結果の反映のたびにプラグインへ didChange を送り、ファイルメニューのコマンド・読み込み・書き出しをつなぐ。起動時に 1 回呼ぶ。
 *
 * @param e 画面の他の部分の操作と保存場所
 */
export function initScriptHost(e: HostEnv): void {
  env = e;
  changed = () => e.onChange();
  onAnalyzedVersion((version) => {
    for (const x of entries.values()) if (x.state === "running" && version === coreClient().current) void sendDidChange(x);
  });
  $("#pluginCommands").addEventListener("click", (ev) => {
    const b = closest(ev, "[data-plugin]");
    if (!b) return;
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => (d.open = false));
    const plugin = b.dataset["plugin"] ?? "";
    const item = b.dataset["item"] ?? "";
    if (b.dataset["kind"] === "import") void runImport(plugin, item);
    else if (b.dataset["kind"] === "export") runExport(plugin, item);
    else runCommand(plugin, item);
  });
}

/**
 * 初期化で受け取った、画面の他の部分の操作と保存場所を返す。
 *
 * @returns initScriptHost で渡したもの。まだ初期化していなければ例外（Error）を投げる
 * @example
 * // initScriptHost(e) の後
 * hostEnv() // → e
 */
function hostEnv(): HostEnv {
  if (!env) throw new Error("プラグインのホストがまだ初期化されていません");
  return env;
}

/**
 * 動かすプラグインの一覧に合わせる。一覧に無くなったものは止め、新しいもの・中身や権限が変わったものは、許可を確かめてから動かす。
 * 呼ばれた順に 1 つずつ行う（許可の確認を待つあいだに次の一覧が来ても、追い越さない）。
 *
 * @param plugins 動かすプラグイン（プロジェクトに入れ、有効で、読み込みの問題が無いもの）
 * @returns 合わせ終わったら解決する Promise（許可の確認の答えも待つ）
 */
export function syncScriptPlugins(plugins: readonly ScriptPlugin[]): Promise<void> {
  syncing = syncing.then(() => applyPlugins(plugins)).catch((e: unknown) => toast(`プラグインを起動できませんでした：${e instanceof Error ? e.message : String(e)}`));
  return syncing;
}

/**
 * 動かすプラグインの一覧に合わせる（syncScriptPlugins の中身）。
 *
 * @param plugins 動かすプラグイン
 * @returns 合わせ終わったら解決する Promise
 */
async function applyPlugins(plugins: readonly ScriptPlugin[]): Promise<void> {
  const ids = new Set(plugins.map((p) => p.id));
  for (const [id, e] of entries) {
    if (ids.has(id)) continue;
    halt(e);
    entries.delete(id);
  }
  changed();
  for (const plugin of plugins) {
    const old = entries.get(plugin.id);
    let sha256: string;
    try {
      sha256 = await sha256Hex(plugin.code);
    } catch {
      if (old) halt(old);
      replace(plugin, "", "failed", ["このページは安全な接続（https）で開かれていないため、プラグインを確かめられません"]);
      continue;
    }
    if (old && old.sha256 === sha256 && old.plugin.version === plugin.version && samePermissions(old.plugin.permissions, plugin.permissions)) {
      old.plugin = plugin;
      continue;
    }
    if (old) halt(old);
    await admit(replace(plugin, sha256, "checking", []));
  }
  changed();
}

/**
 * プラグインの状態を新しく作って置き換える。
 *
 * @param plugin プラグイン
 * @param sha256 プログラムのファイルのハッシュ
 * @param state 始めの状態
 * @param notices 始めの知らせ
 * @returns 作った状態
 * @example
 * replace(plugin, "ab…", "checking", []) // → { plugin, sha256: "ab…", state: "checking", notices: [], sandbox: null, … }
 */
function replace(plugin: ScriptPlugin, sha256: string, state: RunState, notices: string[]): Entry {
  const e: Entry = { plugin, sha256, state, notices, sandbox: null, pending: new Map(), nextRequest: 1, queue: Promise.resolve(), run: 0 };
  entries.set(plugin.id, e);
  return e;
}

/**
 * 2 つの権限の並びが、順を問わず同じか。
 *
 * @param a 権限の並び
 * @param b 権限の並び
 * @returns 同じ権限の集まりなら true
 * @example
 * samePermissions(["network", "model:read"], ["model:read", "network"]) // → true
 * samePermissions([], ["model:read"])                                    // → false
 */
function samePermissions(a: readonly Permission[], b: readonly Permission[]): boolean {
  return a.length === b.length && a.every((p) => b.includes(p));
}

/**
 * 覚えている許可を確かめ、要るなら尋ねてから動かす（ADR-0018 §5、F-PLUG-6）。
 *
 * @param e プラグインの状態
 * @returns 動かし始めた・許可されなかったら解決する Promise
 */
async function admit(e: Entry): Promise<void> {
  const subject = { permissions: e.plugin.permissions, version: e.plugin.version, sha256: e.sha256 };
  const check = trustCheck(parseTrustStore(store.get(TRUST_KEY)).plugins[e.plugin.id], subject);
  if (check.kind === "denied") return setState(e, "denied");
  if (check.kind === "allowed") {
    // 尋ねずに動かすときも、今のバージョン・ファイルを覚え直す（次に変わったかを比べるため）
    remember(e.plugin.id, trustRecord("allowed", subject));
    return start(e);
  }
  await askTrust(e, check);
}

/**
 * 実行してよいかを利用者に尋ね、答えを覚える。許可されたら動かす。
 * 「許可しない」は覚え、一覧の「許可する…」で尋ね直すまで尋ねない。Esc・枠外で閉じたときは、今回だけ動かさない。
 *
 * @param e プラグインの状態
 * @param check 尋ねる理由と、増えた権限
 * @returns 答えを受けて処理したら解決する Promise
 */
async function askTrust(e: Entry, check: Extract<TrustCheck, { kind: "ask" }>): Promise<void> {
  setState(e, "asking");
  const prompt = trustPrompt({ ...e.plugin }, check);
  const r = await ask(prompt.title, prompt.text, [
    { id: "deny", label: prompt.cancel },
    { id: "allow", label: prompt.confirm, kind: "primary" },
  ], undefined, { items: prompt.items, warning: prompt.warning });
  if (entries.get(e.plugin.id) !== e) return;
  const subject = { permissions: e.plugin.permissions, version: e.plugin.version, sha256: e.sha256 };
  if (r?.id === "allow") {
    remember(e.plugin.id, trustRecord("allowed", subject));
    return start(e);
  }
  if (r?.id === "deny") remember(e.plugin.id, trustRecord("denied", subject));
  setState(e, "denied");
}

/**
 * 利用者の答えを、このブラウザに覚える（使えない環境では覚えずに続ける）。
 *
 * @param id プラグインの ID
 * @param record 覚える答え
 */
function remember(id: string, record: TrustRecord): void {
  const trust = parseTrustStore(store.get(TRUST_KEY));
  trust.plugins[id] = record;
  store.set(TRUST_KEY, JSON.stringify(trust));
}

/**
 * プラグインを隔離した場所で動かし始め、activate を送る（答えの ready を待って、テキストを送る）。
 *
 * @param e プラグインの状態（starting にする）
 */
function start(e: Entry): void {
  const run = ++e.run;
  const page = new URL(`${import.meta.env.BASE_URL}${sandboxPage(e.plugin.permissions)}`, location.href).href;
  e.sandbox = startSandbox(page, e.plugin.code, {
    message: (data) => {
      e.queue = e.queue.then(() => receive(e, run, data));
    },
    error: (message) => {
      if (e.run !== run) return;
      notice(e, `プラグインの中でエラーが発生しました：${message || "（詳細は不明です）"}`);
      if (e.state === "starting") setState(e, "failed");
    },
  });
  setState(e, "starting");
  const activate: HostMessage = { type: "activate", apiVersion: API_VERSION, pluginId: e.plugin.id };
  e.sandbox.post(e.plugin.settings === undefined ? activate : { ...activate, settings: e.plugin.settings });
}

/**
 * プラグインを止める（iframe を取り除く）。答えを待っているコマンドと、出していた診断は捨てる。
 *
 * @param e プラグインの状態
 */
function halt(e: Entry): void {
  e.run++;
  e.sandbox?.stop();
  e.sandbox = null;
  e.pending.clear();
  clearDiagnostics(e.plugin.id);
}

/**
 * 状態を変え、一覧とメニューを描き直す。
 *
 * @param e プラグインの状態
 * @param state 新しい状態
 */
function setState(e: Entry, state: RunState): void {
  e.state = state;
  renderCommands();
  changed();
}

/**
 * プラグインの一覧に知らせを足し、描き直す。
 *
 * @param e プラグインの状態
 * @param text 知らせの文
 */
function notice(e: Entry, text: string): void {
  e.notices = addNotice(e.notices, text);
  changed();
}

/**
 * プラグインから届いたデータを、コアに確かめてもらってから扱う（ADR-0018 §3：形と権限、§4：変更案）。
 *
 * @param e プラグインの状態
 * @param run 届いたときの、動かし始めた番号（止めた後なら捨てる）
 * @param data 届いたデータ（まだ確かめていない値）
 * @returns 扱い終わったら解決する Promise
 */
async function receive(e: Entry, run: number, data: unknown): Promise<void> {
  const json = messageJson(data);
  if (json === null) return notice(e, "JSON にできないメッセージが届いたため、使いませんでした");
  const result = await coreClient().checkPluginMessage(json, e.plugin.permissions);
  if (e.run !== run) return;
  await act(e, decideMessage(result, e.pending));
}

/**
 * 決めたことを行う。保存場所の読み書きは、終わるまで待つ（次のメッセージを追い越させない）。
 *
 * @param e プラグインの状態
 * @param a 行うこと
 * @returns 行い終えたら解決する Promise
 */
async function act(e: Entry, a: HostAction): Promise<void> {
  const name = e.plugin.name;
  switch (a.kind) {
    case "ready":
      setState(e, "running");
      void sendDidChange(e);
      return;
    case "diagnostics":
      S.pluginDiagnostics = [...S.pluginDiagnostics.filter((d) => d.plugin !== e.plugin.id), { plugin: e.plugin.id, version: a.version, items: a.items }];
      renderProblems();
      updateSync();
      return;
    case "applyEdits":
      return applyEdits(e, a.version, a.edits, a.label);
    case "refuseEdits":
      toast(a.notice);
      return notice(e, a.notice);
    case "commandDone":
      e.pending.delete(a.requestId);
      return;
    case "imported": {
      e.pending.delete(a.requestId);
      const doc = hostEnv().openImported(a.fileName, a.text);
      toast(`「${a.title}」で読み込んだ結果を、新しいファイル「${doc}」として開きました（プラグイン「${name}」）。保存するまでファイルには書き込みません`);
      return;
    }
    case "exported":
      e.pending.delete(a.requestId);
      download(a.fileName, base64ToBytes(a.base64), a.mediaType);
      toast(`「${a.title}」で書き出した「${a.fileName}」をダウンロードしました（プラグイン「${name}」）`);
      return;
    case "requestFailed":
      e.pending.delete(a.requestId);
      toast(`プラグイン「${name}」の${a.notice}`);
      return notice(e, a.notice);
    case "storageGet":
    case "storageSet":
      return useStorage(e, a);
    case "notify":
      toast(`プラグイン「${name}」：${a.message}`);
      if (a.level !== "info") notice(e, a.message);
      return;
    case "drop":
      return notice(e, a.notice);
    case "ignore":
      return;
  }
}

/**
 * プラグイン用の保存場所を読み書きし、storageResult で答える（ADR-0018 §3。プラグインごとに分け、上限を設ける）。
 * 上限を超える・保存場所が使えないときは保存せず、値なしで答えて、トーストとプラグインの一覧で知らせる。
 *
 * @param e プラグインの状態
 * @param a 読む（storageGet）か、書く（storageSet）か
 * @returns 答えを送ったら解決する Promise
 */
async function useStorage(e: Entry, a: Extract<HostAction, { kind: "storageGet" | "storageSet" }>): Promise<void> {
  const data = hostEnv().data;
  const reply = (value?: unknown): void => e.sandbox?.post(value === undefined ? { type: "storageResult", requestId: a.requestId } : { type: "storageResult", requestId: a.requestId, value });
  try {
    const json = await data.read(e.plugin.id);
    if (a.kind === "storageGet") return reply(storedValue(json, a.key));
    const updated = storageUpdate(json, a.key, a.value, PLUGIN_STORAGE_LIMIT);
    if ("refused" in updated) {
      toast(`プラグイン「${e.plugin.name}」：${updated.refused}`);
      notice(e, updated.refused);
      return reply();
    }
    await data.write(e.plugin.id, updated.json);
    reply();
  } catch (err) {
    const text = `プラグイン用の保存場所を使えませんでした：${err instanceof Error ? err.message : String(err)}`;
    notice(e, text);
    reply();
  }
}

/**
 * 確かめた変更案を、1 回の「元に戻す」で取り消せる 1 つの編集として当てる（ADR-0018 §4、F-PLUG-5）。
 * 確かめた後にテキストが変わっていた（入力の反映待ちを含む）ときは当てずに知らせる。
 *
 * @param e プラグインの状態
 * @param version 変更案を確かめたテキストの版
 * @param edits 当てる変更（始まりの順。位置は UTF-16）
 * @param label 変更の名前（プラグインが付けたもの）
 */
function applyEdits(e: Entry, version: number, edits: readonly { start: number; end: number; text: string }[], label: string | undefined): void {
  const core = coreClient();
  if (core.current !== version || core.text !== S.text) {
    toast(STALE_PLUGIN_EDIT);
    return notice(e, STALE_PLUGIN_EDIT);
  }
  const next = applyTextEdits(S.text, edits);
  if (next === S.text) return;
  setText(next, { changeAt: edits[0]?.start ?? 0, flash: flashRange(edits) });
  toast(label ? `「${label}」を適用しました（プラグイン「${e.plugin.name}」）` : `プラグイン「${e.plugin.name}」の変更を適用しました`);
}

/**
 * 今のテキスト（と、model:read を宣言していればモデル）を、プラグインに送る（didChange）。
 * モデルを作っている間にテキストが変わったら送らない（次の解析の後で送り直す）。
 *
 * @param e プラグインの状態（実行中のもの）
 * @returns 送り終えたら解決する Promise
 */
async function sendDidChange(e: Entry): Promise<void> {
  const core = coreClient();
  const version = core.current;
  const text = core.text;
  if (text === null) return;
  if (!e.plugin.permissions.includes("model:read")) return e.sandbox?.post({ type: "didChange", version, text });
  if (snapshotCache?.version !== version) snapshotCache = { version, snapshot: core.modelSnapshot() };
  const made = await snapshotCache.snapshot;
  if (!made || made.version !== version || e.state !== "running") return;
  e.sandbox?.post({ type: "didChange", version, text, model: made.snapshot });
}

/**
 * プラグインのコマンドを実行する（runCommand を送り、答えを待つ）。開いているファイルが無ければ、送らずに知らせる（F-FILE-14）。
 *
 * @param id プラグインの ID
 * @param command コマンドの ID
 */
function runCommand(id: string, command: string): void {
  if (!hostEnv().hasOpenDoc()) return toast(NO_OPEN_FILE);
  const e = entries.get(id);
  const c = e?.plugin.commands.find((x) => x.id === command);
  if (!e || !c || e.state !== "running") return toast("プラグインがまだ準備できていないため、コマンドを実行できません");
  const requestId = e.nextRequest++;
  e.pending.set(requestId, { kind: "command", title: c.title });
  e.sandbox?.post({ type: "runCommand", requestId, command });
}

/**
 * プラグインの読み込み（取り込み）を実行する。対応する拡張子で絞ってファイルを選ばせ、中身を base64 で送る（F-PLUG-4）。
 * 結果（imported）は、新しい無題のファイルとして開く。上限より大きいファイルは送らずに知らせる。
 *
 * @param id プラグインの ID
 * @param importer 取り込みの ID
 * @returns 送り終えた（選ばなかった・送れなかった）ら解決する Promise
 */
async function runImport(id: string, importer: string): Promise<void> {
  const e = entries.get(id);
  const imp = e?.plugin.importers.find((x) => x.id === importer);
  if (!e || !imp || e.state !== "running") return toast("プラグインがまだ準備できていないため、読み込めません");
  const item = importItems([{ ...e.plugin, state: e.state }]).find((x) => x.command === importer);
  const file = await pickFile(item?.accept ?? "");
  if (!file) return;
  if (file.size > MAX_TRANSFER_BYTES) return toast(`「${file.name}」は大きすぎるため読み込めません（${sizeText(file.size)}。上限 ${sizeText(MAX_TRANSFER_BYTES)}）`);
  const run = e.run;
  const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  if (e.run !== run || e.state !== "running") return toast("プラグインが停止したため、読み込めませんでした");
  const requestId = e.nextRequest++;
  e.pending.set(requestId, { kind: "import", title: imp.label });
  e.sandbox?.post({ type: "import", requestId, importer, fileName: file.name, base64 });
}

/**
 * プラグインの書き出しを実行する。表示中の保存された図があれば、その名前を添える（F-PLUG-4）。
 * 結果（exported）は、ダウンロードさせる（プロジェクトのフォルダには書かない）。開いているファイルが無ければ、送らずに知らせる（F-FILE-14）。
 *
 * @param id プラグインの ID
 * @param exporter 書き出しの ID
 */
function runExport(id: string, exporter: string): void {
  if (!hostEnv().hasOpenDoc()) return toast(NO_OPEN_FILE);
  const e = entries.get(id);
  const x = e?.plugin.exporters.find((y) => y.id === exporter);
  if (!e || !x || e.state !== "running") return toast("プラグインがまだ準備できていないため、書き出せません");
  const requestId = e.nextRequest++;
  e.pending.set(requestId, { kind: "export", title: x.label, extension: x.extension });
  const view = modelView()?.name;
  e.sandbox?.post(view === undefined ? { type: "export", requestId, exporter } : { type: "export", requestId, exporter, view });
}

/**
 * 読み込むファイルを 1 つ選ばせる（ファイルメニューの「ファイルを開く」とは別の、隠したファイルの入力欄を使う）。
 *
 * @param accept 選べるファイルの絞り込み（例：".reqif,.xml"。"" なら絞らない）
 * @returns 選んだファイル。選ばずに閉じたら null
 * @example
 * await pickFile(".reqif") // → File（要求一覧.reqif）
 * await pickFile(".reqif") // → null（キャンセル）
 */
function pickFile(accept: string): Promise<File | null> {
  const input = $<HTMLInputElement>("#pluginFileInput");
  return new Promise((resolve) => {
    input.value = "";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * プラグインの診断を、問題一覧から消す。
 *
 * @param id プラグインの ID
 */
function clearDiagnostics(id: string): void {
  if (!S.pluginDiagnostics.some((d) => d.plugin === id)) return;
  S.pluginDiagnostics = S.pluginDiagnostics.filter((d) => d.plugin !== id);
  renderProblems();
  updateSync();
}

/** ファイルメニューの「プラグインのコマンド」「プラグインで読み込む」「プラグインで書き出す」を、実行中のプラグインのもので描き直す（無ければ隠す）。 */
function renderCommands(): void {
  const plugins = [...entries.values()].map((e) => ({ ...e.plugin, state: e.state }));
  const sections: [string, string, CommandItem[]][] = [
    ["プラグインのコマンド", "command", commandItems(plugins)],
    ["プラグインで読み込む", "import", importItems(plugins)],
    ["プラグインで書き出す", "export", exportItems(plugins)],
  ];
  const html = sections
    .filter(([, , items]) => items.length)
    .map(
      ([head, kind, items]) =>
        `<div class="phead">${head}</div>` +
        items.map((i) => `<button data-plugin="${esc(i.plugin)}" data-kind="${kind}" data-item="${esc(i.command)}" title="${esc(i.tooltip)}">${esc(i.label)}</button>`).join(""),
    )
    .join("");
  const box = $("#pluginCommands");
  box.hidden = !html;
  box.innerHTML = html;
}

/**
 * 一覧に出す、動かしているプラグインの状態と知らせを返す。
 *
 * @param id プラグインの ID
 * @returns 状態と知らせ。動かしていない（v1 のプラグインでない・無効など）なら undefined
 * @example
 * runInfo("jp.example.fill") // → { state: "running", notices: [] }
 * runInfo("jp.example.rules") // → undefined（チェックルールのプラグイン）
 */
export function runInfo(id: string): RunInfo | undefined {
  const e = entries.get(id);
  return e ? { state: e.state, notices: e.notices } : undefined;
}

/**
 * 一覧の「停止」：プラグインを止める。止まったとは言い切らず、止める操作をしたことを知らせる（ADR-0018 §3.1）。
 *
 * @param id プラグインの ID
 */
export function stopScriptPlugin(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  halt(e);
  setState(e, "stopped");
  toast(stopNotice(e.plugin.name));
}

/**
 * 一覧の「開始」：止めた・エラーで止まったプラグインを、もう一度動かす（許可は確かめ直す）。
 *
 * @param id プラグインの ID
 */
export function startScriptPlugin(id: string): void {
  const e = entries.get(id);
  if (!e || (e.state !== "stopped" && e.state !== "failed")) return;
  halt(e);
  e.notices = [];
  void admit(e);
}

/**
 * 一覧の「許可する…」：許可しなかったプラグインについて、もう一度尋ねる。
 *
 * @param id プラグインの ID
 */
export function allowScriptPlugin(id: string): void {
  const e = entries.get(id);
  if (!e || e.state !== "denied") return;
  void askTrust(e, { kind: "ask", reason: "first", added: [] });
}

/**
 * 文字列の SHA-256 を 16 進で求める（許可を覚えるときの、ファイルのハッシュ）。
 *
 * @param text プログラムのファイルの中身
 * @returns 16 進の小文字 64 文字。安全な接続でないページ（crypto.subtle が無い）では例外で拒否する
 * @example
 * await sha256Hex("") // → "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
