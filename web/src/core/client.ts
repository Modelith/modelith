// 画面の側から見たコア（ADR-0016 §4）。テキストを変えるたびに版を 1 つ上げてコアに送り、
// 返ってきた結果の版が今の版と同じときだけ使う。違えば捨てる（解析なら次の結果を待ち、編集なら適用しない）。

import { projectReadProblem, type CoreRequest, type CoreResponse } from "./protocol";
import {
  fromAnalysis, type CreatedProjectFile, type DescribedPlugin, type EditResult, type Intent, type PluginChange, type PluginFiles, type PluginsResult, type ProjectFileResult,
  type Refused, type RuleFinding,
} from "./rust";
import type { Model, ParseResult } from "./types";

/** コアとの通り道（Worker、またはテストでは同じスレッドの関数）。 */
export interface CorePort {
  post(req: CoreRequest): void;
  listen(fn: (res: CoreResponse) => void): void;
}

/** 編集の返事が古かったときの断り（ADR-0014 の言葉）。 */
export const STALE_EDIT = "テキストが変わったため、この操作はやめました。もう一度操作してください";

/** 解析結果を受け取ったときの処理。findings は検査ルールの結果（プラグインが無ければ空）。 */
export type AnalyzedListener = (version: number, P: ParseResult, M: Model, findings: RuleFinding[]) => void;

export class CoreClient {
  private version = 0;
  private sent: string | null = null;
  /** 送ったが、まだ解析の返事が来ていない版のテキスト。 */
  private readonly texts = new Map<number, string>();
  private nextId = 1;
  private readonly waiting = new Map<number, (r: EditResult | Refused) => void>();
  /** 設定ファイル（modelith.json）とプラグインの依頼のうち、返事を待っているもの（返事の JSON を受け取る）。 */
  private readonly jsonWaiting = new Map<number, (json: string) => void>();

  /**
   * コアの受け口を作り、コアからの返事を聞き始める。
   *
   * @param port コアとの通り道（Worker、またはテストでは同じスレッドの関数）
   * @param onAnalyzed 今の版の解析結果を受け取ったときに呼ぶ処理
   */
  constructor(
    private readonly port: CorePort,
    private readonly onAnalyzed: AnalyzedListener,
  ) {
    port.listen((res) => this.receive(res));
  }

  /**
   * 今の版（最後に送ったテキストの版）。
   *
   * @returns 版の番号。まだ何も送っていなければ 0
   * @example
   * new CoreClient(port, onAnalyzed).current // → 0（まだ送っていない）
   * // c.sync("x") の後なら c.current // → 1
   */
  get current(): number {
    return this.version;
  }

  /**
   * テキストをコアに送る（コアに `didChange` を投げる）。前に送ったものと同じなら送らない。
   *
   * @param text 今のテキストの全文
   * @returns 送ったテキストの版。同じテキストを送り直さなかったときは今の版のまま
   * @example
   * c.sync("x") // → 1
   * c.sync("x") // → 1（同じテキストは送り直さない）
   * c.sync("y") // → 2
   */
  sync(text: string): number {
    if (text === this.sent) return this.version;
    return this.send(text);
  }

  /**
   * テキストに新しい版を付けてコアに送る（`didChange`）。同じテキストでも送る。
   *
   * @param text 今のテキストの全文
   * @returns 送ったテキストの版
   * @example
   * this.send("x") // → 1
   * this.send("x") // → 2（同じテキストでも版を上げて送る）
   */
  private send(text: string): number {
    this.version += 1;
    this.sent = text;
    this.texts.set(this.version, text);
    this.port.post({ type: "didChange", version: this.version, text });
    return this.version;
  }

  /**
   * text に意図を当てた編集をコアに求める。text が前に送ったものと違えば、先に送る（版が上がる）。
   *
   * @param text 編集の元にするテキストの全文
   * @param intent 図からの操作の意図（改名・削除など）
   * @returns 編集の結果（`TextEdit` の列など）。返事が来るまでにテキストが変わっていれば `{ refused: STALE_EDIT }`、
   *   コアの返事が読めなければ `{ refused: "操作できませんでした…" }`。例外は投げない
   * @example
   * await c.edit("package P { part def A; }", { op: "rename", key: "A", name: "B" })
   * // → { edits: [...] }（当てると "package P { part def B; }"）
   * // 返事の前に c.sync(別のテキスト) をしたとき → { refused: STALE_EDIT }
   */
  edit(text: string, intent: Intent): Promise<EditResult | Refused> {
    const version = this.sync(text);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.port.post({ type: "edit", version, id, intent });
    });
  }

  /**
   * プロジェクトの設定ファイル（modelith.json）のテキストを、コアに読み取ってもらう（ADR-0019、F-PROJ-1）。
   * モデルのテキストの版とは関係しない（テキストが変わっても断らない）。
   *
   * @param text modelith.json のテキスト全体
   * @returns 読み取れた設定（誤りがあれば null）と問題の一覧。コアの返事が読めなければ、
   *   設定は null で「設定ファイルを読み取れませんでした…」の誤り 1 件。例外は投げない
   * @example
   * await c.parseProjectFile('{ "name": "給水" }') // → { project: { name: "給水", plugins: {} }, problems: [] }
   * await c.parseProjectFile("{")                   // → { project: null, problems: [{ severity: "error", line: 1, column: 1, … }] }
   */
  async parseProjectFile(text: string): Promise<ProjectFileResult> {
    return parseProjectResult(await this.request((id) => ({ type: "parseProject", id, text })));
  }

  /**
   * 新しいプロジェクトの設定ファイル（modelith.json）のテキストを、コアに作ってもらう（「プロジェクトにする」）。
   *
   * @param name プロジェクト名（前後の空白は除く。空なら名前を書かない）
   * @returns 作ったテキスト。コアの返事が読めなければ、作れなかった旨の断り。例外は投げない
   * @example
   * await c.createProjectFile("給水") // → { text: '{\n  "name": "給水",\n  "plugins": {}\n}\n' }
   * // コアが壊れた返事をしたとき → { refused: "プロジェクトの設定ファイルを作れませんでした（…）" }
   */
  async createProjectFile(name: string): Promise<CreatedProjectFile | Refused> {
    return parseCreated(await this.request((id) => ({ type: "createProject", id, name })));
  }

  /**
   * 設定ファイルの使うプラグインの項目を、コアに書き換えてもらう（「追加」・使う／止める・「削除」。ADR-0018 §1）。知らない項目は残る。
   *
   * @param text 今の modelith.json のテキスト全体
   * @param plugin プラグインの ID
   * @param change 変更（加える・使う／止める・外す）
   * @returns 書き換えた後のテキスト。書き換えられなければ理由の断り。例外は投げない
   * @example
   * await c.updateProjectPlugin("{}", "jp.x", { op: "add", version: "0.1.0" }) // → { text: '{\n  "plugins": {\n    "jp.x": {…}\n  }\n}\n' }
   * await c.updateProjectPlugin("{}", "jp.x", { op: "remove" })                // → { refused: "プロジェクトの設定（modelith.json）に、プラグイン「jp.x」がありません" }
   */
  async updateProjectPlugin(text: string, plugin: string, change: PluginChange): Promise<CreatedProjectFile | Refused> {
    return parseText(await this.request((id) => ({ type: "updateProject", id, text, plugin, change })), "プロジェクトの設定を書き換えられませんでした");
  }

  /**
   * 検査ルールのプラグインをコアに読み込ませる（前のものは置き換える。ADR-0018 §2）。
   * 前にテキストを送っていれば、同じテキストを新しい版で送り直し、ルールの結果を付けた解析結果を受け取れるようにする。
   *
   * @param plugins プラグインごとの ID・使うか・ファイル（空なら、ルールを当てない）
   * @returns プラグインごとのまとめ。コアの返事が読めなければ、まとめは空で error に理由。例外は投げない
   * @example
   * await c.setPlugins([{ id: "jp.x", enabled: true, files: { "modelith-plugin.json": "…", "rules.yaml": "…" } }])
   * // → { plugins: [{ id: "jp.x", installed: true, rules: 1, problems: [], … }] }（続けて onAnalyzed に findings が届く）
   * await c.setPlugins([]) // → { plugins: [] }
   */
  async setPlugins(plugins: PluginFiles[]): Promise<PluginsResult> {
    const pending = this.request((id) => ({ type: "setPlugins", id, plugins }));
    if (this.sent !== null) this.send(this.sent);
    return parsePlugins(await pending);
  }

  /**
   * プラグインのマニフェスト（modelith-plugin.json）を、コアに読んでもらう（「追加」の確認に使う）。
   *
   * @param text マニフェストのテキスト
   * @returns 名前・版・種類。読めなければ、どこが悪いかの断り。例外は投げない
   * @example
   * await c.describePlugin('{"id":"jp.x","name":"例",…,"runtime":"rules",…}') // → { plugin: { id: "jp.x", name: "例", version: "0.1.0", runtime: "rules" } }
   * await c.describePlugin("{")                                               // → { refused: "modelith-plugin.json の 1 行目：…" }
   */
  async describePlugin(text: string): Promise<DescribedPlugin | Refused> {
    return parseDescribed(await this.request((id) => ({ type: "describePlugin", id, text })));
  }

  /**
   * 設定ファイル・プラグインの依頼をコアに送り、返事の JSON を待つ。
   *
   * @param make 依頼の id から依頼を作る関数
   * @returns 同じ id の返事の JSON の文字列で解決する Promise
   * @example
   * await this.request((id) => ({ type: "parseProject", id, text: "{}" })) // → '{"project":{"plugins":{}},"problems":[]}'
   */
  private request(make: (id: number) => CoreRequest): Promise<string> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.jsonWaiting.set(id, resolve);
      this.port.post(make(id));
    });
  }

  /**
   * コアからの返事を 1 つ受け取る。今の版の解析結果なら onAnalyzed を呼び、編集の返事なら待っている edit を、
   * 設定ファイル・プラグインの返事なら、待っている依頼（parseProjectFile・setPlugins など）を解決する。
   * 古い版の解析結果は捨て、古い版の編集の返事は断り（STALE_EDIT）にする。
   *
   * @param res コアからの返事
   */
  private receive(res: CoreResponse): void {
    if (res.type === "analyzed") {
      const text = this.texts.get(res.version);
      for (const v of this.texts.keys()) if (v <= res.version) this.texts.delete(v);
      // 古い版の結果は捨てて、次の結果を待つ
      if (res.version !== this.version || text === undefined) return;
      const { P, M, findings } = fromAnalysis(res.json, text);
      this.onAnalyzed(res.version, P, M, findings);
    } else if (res.type === "edited") {
      const resolve = this.waiting.get(res.id);
      this.waiting.delete(res.id);
      resolve?.(res.version === this.version ? parseEdited(res.json) : { refused: STALE_EDIT });
    } else if (res.type !== "ready" && res.type !== "failed") {
      const resolve = this.jsonWaiting.get(res.id);
      this.jsonWaiting.delete(res.id);
      resolve?.(res.json);
    }
  }
}

/**
 * コアが返した編集の JSON を読む。
 *
 * @param json wasm の `edit` が返した JSON の文字列
 * @returns 編集の結果か断り。JSON が壊れていれば、テキストはそのまま残っている旨の断り（例外は投げない）
 * @example
 * parseEdited('{"refused":"x"}') // → { refused: "x" }
 * parseEdited("{")               // → { refused: "操作できませんでした。テキストはそのまま残っています（…）" }
 */
function parseEdited(json: string): EditResult | Refused {
  try {
    return JSON.parse(json) as EditResult | Refused;
  } catch (e) {
    return { refused: `操作できませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/**
 * コアが返した設定ファイルの読み取りの結果（JSON）を読む。
 *
 * @param json wasm の `parseProjectFile` が返した JSON の文字列
 * @returns 読み取りの結果。JSON が壊れている・形が違うときは、設定は null で「設定ファイルを読み取れませんでした…」の誤り 1 件（例外は投げない）
 * @example
 * parseProjectResult('{"project":null,"problems":[]}') // → { project: null, problems: [] }
 * parseProjectResult('{"error":"x"}')                  // → { project: null, problems: [{ …, message: "設定ファイルを読み取れませんでした（x）" }] }
 * parseProjectResult("{")                              // → { project: null, problems: [{ …, message: "設定ファイルを読み取れませんでした（…）" }] }
 */
function parseProjectResult(json: string): ProjectFileResult {
  try {
    const r = JSON.parse(json) as Partial<ProjectFileResult> & { error?: string };
    if (Array.isArray(r.problems) && r.project !== undefined) return { project: r.project, problems: r.problems };
    return { project: null, problems: [projectReadProblem(r.error ?? "コアの返事の形が違います")] };
  } catch (e) {
    return { project: null, problems: [projectReadProblem(e instanceof Error ? e.message : String(e))] };
  }
}

/**
 * コアが返した、新しい設定ファイルのテキスト（JSON）を読む。
 *
 * @param json wasm の `createProjectFile` が返した JSON の文字列
 * @returns テキストか断り。JSON が壊れている・形が違うときは「プロジェクトの設定ファイルを作れませんでした…」の断り（例外は投げない）
 * @example
 * parseCreated('{"text":"{}\\n"}') // → { text: "{}\n" }
 * parseCreated('{"refused":"x"}')    // → { refused: "x" }
 * parseCreated("{")                  // → { refused: "プロジェクトの設定ファイルを作れませんでした（…）" }
 */
function parseCreated(json: string): CreatedProjectFile | Refused {
  return parseText(json, "プロジェクトの設定ファイルを作れませんでした");
}

/**
 * コアが返した、設定ファイルのテキストか断りの JSON（`{ text }`・`{ refused }`）を読む。
 *
 * @param json wasm が返した JSON の文字列
 * @param failure 読めなかったときの断りの文の頭（理由は括弧に入れて足す）
 * @returns テキストか断り。JSON が壊れている・形が違うときは「failure（理由）」の断り（例外は投げない）
 * @example
 * parseText('{"text":"{}"}', "作れませんでした")    // → { text: "{}" }
 * parseText('{"refused":"x"}', "作れませんでした")  // → { refused: "x" }
 * parseText("{}", "作れませんでした")               // → { refused: "作れませんでした（コアの返事の形が違います）" }
 */
function parseText(json: string, failure: string): CreatedProjectFile | Refused {
  try {
    const r = JSON.parse(json) as Partial<CreatedProjectFile & Refused>;
    if (typeof r.text === "string") return { text: r.text };
    if (typeof r.refused === "string") return { refused: r.refused };
    return { refused: `${failure}（コアの返事の形が違います）` };
  } catch (e) {
    return { refused: `${failure}（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/**
 * コアが返した、プラグインのまとめ（JSON）を読む。
 *
 * @param json `RulePlugins.summary` が返した JSON の文字列（失敗したときは `{ error }`）
 * @returns まとめ。JSON が壊れている・形が違う・コアが失敗したときは、まとめは空で error に理由（例外は投げない）
 * @example
 * parsePlugins('{"plugins":[]}')  // → { plugins: [] }
 * parsePlugins('{"error":"x"}')   // → { plugins: [], error: "x" }
 * parsePlugins("{")               // → { plugins: [], error: "プラグインを読み込めませんでした（…）" }
 */
function parsePlugins(json: string): PluginsResult {
  try {
    const r = JSON.parse(json) as Partial<PluginsResult>;
    if (Array.isArray(r.plugins)) return { plugins: r.plugins };
    return { plugins: [], error: r.error ?? "プラグインを読み込めませんでした（コアの返事の形が違います）" };
  } catch (e) {
    return { plugins: [], error: `プラグインを読み込めませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/**
 * コアが返した、マニフェストを読んだ結果（JSON）を読む。
 *
 * @param json wasm の `describePlugin` が返した JSON の文字列
 * @returns プラグインの情報か断り。JSON が壊れている・形が違うときは「プラグインを読み取れませんでした…」の断り（例外は投げない）
 * @example
 * parseDescribed('{"plugin":{"id":"jp.x",…}}') // → { plugin: { id: "jp.x", … } }
 * parseDescribed('{"refused":"x"}')           // → { refused: "x" }
 * parseDescribed("{")                         // → { refused: "プラグインを読み取れませんでした（…）" }
 */
function parseDescribed(json: string): DescribedPlugin | Refused {
  try {
    const r = JSON.parse(json) as Partial<DescribedPlugin & Refused>;
    if (r.plugin && typeof r.plugin.id === "string") return { plugin: r.plugin };
    if (typeof r.refused === "string") return { refused: r.refused };
    return { refused: "プラグインを読み取れませんでした（コアの返事の形が違います）" };
  } catch (e) {
    return { refused: `プラグインを読み取れませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/**
 * Worker の中でコアを動かし、使える状態になったら受け口を返す。Worker に `init` を送る。
 *
 * @param worker コアを動かす Worker（worker.ts を読み込んだもの）
 * @param wasmUrl コアの wasm の URL
 * @param onAnalyzed 今の版の解析結果を受け取ったときに呼ぶ処理
 * @returns Worker が `ready` を返したら、受け口（CoreClient）で解決する Promise。
 *   wasm を読み込めない（`failed`）・Worker を起動できないときは Error で拒否する（起動の失敗として画面に出す）
 * @example
 * await startCore(worker, "/modelith_core_bg.wasm", onAnalyzed) // → CoreClient（current は 0）
 * await startCore(worker, "/missing.wasm", onAnalyzed)           // → Error で拒否
 */
export function startCore(worker: Worker, wasmUrl: string, onAnalyzed: AnalyzedListener): Promise<CoreClient> {
  return new Promise((resolve, reject) => {
    const port: CorePort = {
      post: (req) => worker.postMessage(req),
      listen: (fn) => worker.addEventListener("message", (ev: MessageEvent<CoreResponse>) => fn(ev.data)),
    };
    const first = (ev: MessageEvent<CoreResponse>): void => {
      if (ev.data.type === "ready") resolve(new CoreClient(port, onAnalyzed));
      else if (ev.data.type === "failed") reject(new Error(ev.data.message));
      else return;
      worker.removeEventListener("message", first);
    };
    worker.addEventListener("message", first);
    worker.addEventListener("error", (ev) => reject(new Error(ev.message || "コアの Worker を起動できませんでした")), { once: true });
    worker.postMessage({ type: "init", wasmUrl } satisfies CoreRequest);
  });
}
