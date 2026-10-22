// 画面の側から見たコア（ADR-0016 §4）。テキストを変えるたびに版を 1 つ上げてコアに送り、
// 返ってきた結果の版が今の版と同じときだけ使う。違えば捨てる（解析なら次の結果を待ち、編集なら適用しない）。

import { failedReply, projectReadProblem, type CoreReply, type CoreRequest, type CoreResponse, type ProjectFileText } from "./protocol";
import type { Permission } from "../plugins/generated/protocol";
import {
  fromAnalysis, type CheckedPluginMessage, type CreatedProjectFile, type DescribedPlugin, type EditResult, type FileReport, type Intent, type PluginChange, type PluginFiles, type PluginsResult, type ProjectFileResult,
  type Refused, type RuleFinding, type VersionedSnapshot,
} from "./rust";
import type { Model, ParseResult } from "./types";

/** コアとの通り道（Worker、またはテストでは同じスレッドの関数）。 */
export interface CorePort {
  post(req: CoreRequest): void;
  listen(fn: (res: CoreResponse) => void): void;
  /** コアが落ちた（Worker の `error`・`messageerror`）ことを聞く。同じスレッドのテストでは省ける。 */
  listenFailure?(fn: (reason: string) => void): void;
}

/** 編集の返事が古かったときの断り（ADR-0014 の言葉）。 */
export const STALE_EDIT = "テキストが変わったため、この操作はやめました。もう一度操作してください";

/** コアが止まった・返事をしないときに、待っていた図の操作に返す断りと、画面に出す知らせ（Q-7）。 */
export const CORE_STOPPED = "図の操作をやめました。テキストはそのまま残っています";

/** コアの返事を待つ期限（ミリ秒）。これを過ぎたら、コアは止まったと見なす（Q-7）。 */
export const CORE_REPLY_TIMEOUT_MS = 10_000;

/** 解析結果を受け取ったときの処理。findings はチェックルールの結果（プラグインが無ければ空）。 */
export type AnalyzedListener = (version: number, P: ParseResult, M: Model, findings: RuleFinding[]) => void;

/** コアの受け口の設定。 */
export interface CoreClientOptions {
  /** 返事を待つ期限（ミリ秒。既定は CORE_REPLY_TIMEOUT_MS） */
  timeoutMs?: number;
  /** コアが止まった（期限切れ・Worker のエラー・wasm の例外）ときに呼ぶ。待っていた依頼はすべて失敗にした後で呼ぶ */
  onDown?: (reason: string) => void;
}

/** コアへの依頼（起動の `init` を除く）。 */
type CoreCall = Exclude<CoreRequest, { type: "init" }>;

/** 返事を待っている依頼。期限のタイマーと、期限切れ・コアの停止のときに結果を失敗にする処理。 */
interface Pending {
  timer: ReturnType<typeof setTimeout>;
  fail: (reason: string) => void;
}

export class CoreClient {
  private version = 0;
  private sent: string | null = null;
  /** 送ったが、まだ解析の返事が来ていない版のテキスト。 */
  private readonly texts = new Map<number, string>();
  private nextId = 1;
  private readonly waiting = new Map<number, (r: EditResult | Refused) => void>();
  /** 設定ファイル（modelith.json）とプラグインの依頼のうち、返事を待っているもの（返事の JSON を受け取る）。 */
  private readonly jsonWaiting = new Map<number, (json: string) => void>();
  /** 今のテキストに対する依頼（プラグインに渡すモデル・プラグインのメッセージの確認）のうち、返事を待っているもの。返事と、その間にテキストが変わったかを受け取る。 */
  private readonly textWaiting = new Map<number, (res: { json: string; stale: boolean }) => void>();
  /** 返事を待っている依頼（解析は "v" + 版、ほかは "r" + id）。期限と、失敗にする処理。 */
  private readonly pending = new Map<string, Pending>();
  /** 最後にコアに読み込ませたプラグイン（つなぎ直したときに送り直す）。 */
  private plugins: PluginFiles[] = [];
  /** コアに覚えさせたプロジェクトのファイル（パス → テキスト。つなぎ直したときに送り直す。ADR-0021）。 */
  private readonly files = new Map<string, string>();
  /** 表示中のファイルのパス（フォルダの外のファイルなら null）。次に送るテキストに添える。 */
  private focusPath: string | null = null;
  /** 最後に送ったテキストに添えたパス。 */
  private sentPath: string | null = null;
  /** 今の通り道。コアが止まってから、つなぎ直すまでは null（その間の依頼はすぐ失敗にする）。 */
  private port: CorePort | null = null;
  private readonly timeoutMs: number;
  private readonly onDown: (reason: string) => void;

  /**
   * コアの受け口を作り、コアからの返事を聞き始める。
   *
   * @param port コアとの通り道（Worker、またはテストでは同じスレッドの関数）
   * @param onAnalyzed 今の版の解析結果を受け取ったときに呼ぶ処理
   * @param options 返事の期限と、コアが止まったときの処理
   */
  constructor(
    port: CorePort,
    private readonly onAnalyzed: AnalyzedListener,
    options: CoreClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? CORE_REPLY_TIMEOUT_MS;
    this.onDown = options.onDown ?? (() => {});
    this.connect(port);
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
   * 今の版のテキスト（最後に送ったテキスト）。
   *
   * @returns テキストの全文。まだ何も送っていなければ null
   * @example
   * new CoreClient(port, onAnalyzed).text // → null（まだ送っていない）
   * // c.sync("x") の後なら c.text // → "x"
   */
  get text(): string | null {
    return this.sent;
  }

  /**
   * コアにつながっているか（止まってから、つなぎ直すまでは false）。
   *
   * @returns つながっていれば true
   * @example
   * new CoreClient(port, onAnalyzed).connected // → true
   * // 返事の期限が切れた後 → false。c.reconnect(port) の後 → true
   */
  get connected(): boolean {
    return this.port !== null;
  }

  /**
   * 新しいコア（作り直した Worker）につなぎ直し、今のテキストとプラグインを送り直す（Q-7）。
   * プラグインを読み込ませていれば先に送り、テキストを送っていれば新しい版で送り直す（解析結果が届き、画面が描き直される）。
   *
   * @param port 新しいコアとの通り道（`ready` を返した後のもの）
   */
  reconnect(port: CorePort): void {
    this.connect(port);
    if (this.plugins.length) void this.request((id) => ({ type: "setPlugins", id, plugins: this.plugins }));
    if (this.files.size) void this.request((id) => ({ type: "projectFiles", id, clear: true, set: this.fileTexts(), remove: [] }));
    if (this.sent !== null) this.send(this.sent);
  }

  /**
   * 通り道をつなぎ、返事とコアの停止を聞き始める。古い通り道から届いた返事は捨てる。
   *
   * @param port コアとの通り道
   */
  private connect(port: CorePort): void {
    this.port = port;
    port.listen((res) => {
      if (this.port === port) this.receive(res);
    });
    port.listenFailure?.((reason) => {
      if (this.port === port) this.down(reason);
    });
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
    if (text === this.sent && this.focusPath === this.sentPath) return this.version;
    return this.send(text);
  }

  /**
   * 表示中のファイルのパスを決める（ADR-0021）。次に送るテキストに添え、コアはそのパスのファイルをほかのファイルとしてつながない。
   *
   * @param path プロジェクトのフォルダからのパス。フォルダの外のファイル・無題のファイルなら null
   * @example
   * c.focus("app.sysml"); c.sync(text) // → 同じテキストでも、パスが変われば送り直す
   */
  focus(path: string | null): void {
    this.focusPath = path;
  }

  /**
   * コアが覚えるプロジェクトのファイルを書き換え、今のテキストを解析し直してもらう（ADR-0021 §3）。
   *
   * @param change 覚える（置き換える）ファイル・忘れるパス・先にすべて忘れるか
   * @returns コアが覚え終えたら解決する Promise（例外は投げない）
   * @example
   * await c.updateFiles({ set: [{ path: "parts.sysml", text: "package Parts;" }], remove: [] })
   * await c.updateFiles({ clear: true, set: [], remove: [] }) // → フォルダを閉じたとき
   */
  async updateFiles(change: { clear?: boolean; set: ProjectFileText[]; remove: string[] }): Promise<void> {
    if (change.clear) this.files.clear();
    for (const path of change.remove) this.files.delete(path);
    for (const f of change.set) this.files.set(f.path, f.text);
    const pending = this.request((id) => ({ type: "projectFiles", id, clear: change.clear ?? false, set: change.set, remove: change.remove }));
    if (this.sent !== null) this.send(this.sent);
    await pending;
  }

  /**
   * コアにプロジェクトのファイルを覚えさせているか（フォルダを開いているか）。
   *
   * @returns 1 つでも覚えさせていれば true
   * @example
   * c.hasFiles // → false（フォルダを開いていない）
   */
  get hasFiles(): boolean {
    return this.files.size > 0;
  }

  /**
   * 覚えさせたほかのファイルごとの問題とチェックルールの結果を、今の版のテキストをつないでコアに数えてもらう（ADR-0021 §6）。
   *
   * @returns ファイルごとの問題と、数えたテキストの版。返事が来るまでにテキストが変わった・コアの返事が読めなければ null。例外は投げない
   * @example
   * await c.projectProblems() // → { version: 3, reports: [{ path: "parts.sysml", problems: [{ pos: 33, msg: "型「Wheel」が見つかりません（w）" }], findings: [] }] }
   */
  async projectProblems(): Promise<{ version: number; reports: FileReport[] } | null> {
    const version = this.version;
    const res = await this.requestForText((id) => ({ type: "projectProblems", version, id }));
    if (res.stale) return null;
    try {
      const reports = JSON.parse(res.json) as unknown;
      return Array.isArray(reports) ? { version, reports: reports as FileReport[] } : null;
    } catch {
      return null;
    }
  }

  /**
   * 覚えさせたプロジェクトのファイルの並び。
   *
   * @returns パスとテキストの並び（覚えさせた順）
   * @example
   * this.fileTexts() // → [{ path: "parts.sysml", text: "package Parts;" }]
   */
  private fileTexts(): ProjectFileText[] {
    return [...this.files].map(([path, text]) => ({ path, text }));
  }

  /**
   * テキストに新しい版を付けてコアに送る（`didChange`）。同じテキストでも送る。
   * コアが止まっている間は版とテキストを控えるだけにし、つなぎ直したときに送る。
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
    this.sentPath = this.focusPath;
    this.texts.set(this.version, text);
    if (this.port) this.post({ type: "didChange", version: this.version, text, path: this.focusPath }, `v${this.version}`, () => {});
    return this.version;
  }

  /**
   * text に意図を当てた編集をコアに求める。text が前に送ったものと違えば、先に送る（版が上がる）。
   *
   * @param text 編集の元にするテキストの全文
   * @param intent 図からの操作の意図（改名・削除など）
   * @returns 編集の結果（`TextEdit` の列など）。返事が来るまでにテキストが変わっていれば `{ refused: STALE_EDIT }`、
   *   コアの返事が読めなければ `{ refused: "操作できませんでした…" }`、コアが止まった・返事の期限が切れたときは `{ refused: CORE_STOPPED }`。例外は投げない
   * @example
   * await c.edit("package P { part def A; }", { op: "rename", key: "A", name: "B" })
   * // → { edits: [...] }（当てると "package P { part def B; }"）
   * // 返事の前に c.sync(別のテキスト) をしたとき → { refused: STALE_EDIT }
   * // 返事が期限（10 秒）までに来ないとき → { refused: CORE_STOPPED }
   */
  edit(text: string, intent: Intent): Promise<EditResult | Refused> {
    const version = this.sync(text);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.post({ type: "edit", version, id, intent }, `r${id}`, () => {
        this.waiting.delete(id);
        resolve({ refused: CORE_STOPPED });
      });
    });
  }

  /**
   * プロジェクトの設定ファイル（modelith.json）のテキストを、コアに読み取ってもらう（ADR-0019、F-PROJ-1）。
   * モデルのテキストの版とは関係しない（テキストが変わっても断らない）。
   *
   * @param text modelith.json のテキスト全体
   * @returns 読み取れた設定（誤りがあれば null）と問題の一覧。コアの返事が読めなければ、
   *   設定は null で「設定ファイルを読み込めませんでした…」の誤り 1 件。例外は投げない
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
   * // コアが壊れた返事をしたとき → { refused: "プロジェクトの設定ファイルを作成できませんでした（…）" }
   */
  async createProjectFile(name: string): Promise<CreatedProjectFile | Refused> {
    return parseCreated(await this.request((id) => ({ type: "createProject", id, name })));
  }

  /**
   * 設定ファイルの使うプラグインの項目を、コアに書き換えてもらう（「追加」・使う／止める・「削除」。ADR-0018 §1）。不明な項目は残る。
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
    return parseText(await this.request((id) => ({ type: "updateProject", id, text, plugin, change })), "プロジェクトの設定を変更できませんでした");
  }

  /**
   * チェックルールのプラグインをコアに読み込ませる（前のものは置き換える。ADR-0018 §2）。
   * 前にテキストを送っていれば、同じテキストを新しい版で送り直し、ルールの結果を付けた解析結果を受け取れるようにする。
   * 読み込ませたプラグインは控えておき、コアを作り直したときに送り直す。
   *
   * @param plugins プラグインごとの ID・使うか・ファイル（空なら、ルールを当てない）
   * @returns プラグインごとのまとめ。コアの返事が読めなければ、まとめは空で error に理由。例外は投げない
   * @example
   * await c.setPlugins([{ id: "jp.x", enabled: true, files: { "modelith-plugin.json": "…", "rules.yaml": "…" } }])
   * // → { plugins: [{ id: "jp.x", installed: true, rules: 1, problems: [], … }] }（続けて onAnalyzed に findings が届く）
   * await c.setPlugins([]) // → { plugins: [] }
   */
  async setPlugins(plugins: PluginFiles[]): Promise<PluginsResult> {
    this.plugins = plugins;
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
   * 今の版のテキストから、v1 のプラグインに渡すモデル（plugin-sdk の ModelSnapshot）をコアに作ってもらう（ADR-0018 §3 の `didChange`）。
   *
   * @returns モデルと、それを作ったテキストの版。返事が来るまでにテキストが変わった・コアの返事が読めなければ null。例外は投げない
   * @example
   * c.sync("package P { part def A; }")
   * await c.modelSnapshot() // → { version: 1, snapshot: { elements: [{ key: "A", … }], relations: [] } }
   * // 返事の前に c.sync(別のテキスト) をしたとき → null
   */
  async modelSnapshot(): Promise<VersionedSnapshot | null> {
    const version = this.version;
    const res = await this.requestForText((id) => ({ type: "modelSnapshot", version, id }));
    return res.stale ? null : parseSnapshot(version, res.json);
  }

  /**
   * プラグインから届いたメッセージ（JSON）を、今の版のテキストに対してコアに確かめてもらう（形・権限・範囲。ADR-0018 §3・§4）。
   *
   * @param message プラグインから届いたメッセージの JSON
   * @param permissions そのプラグインがマニフェストで宣言した権限
   * @returns 確かめたメッセージか断りと、確かめたテキストの版。stale は、返事が来るまでにテキストが変わったか
   *   （そのときの変更案・診断の位置は古いテキストのもの）。例外は投げない
   * @example
   * await c.checkPluginMessage('{"type":"ready"}', [])          // → { version: 1, stale: false, checked: { message: { type: "ready" } } }
   * await c.checkPluginMessage('{"type":"proposeEdits",…}', []) // → { version: 1, stale: false, checked: { refused: "宣言していない権限（edits:propose）…" } }
   * // 返事の前に c.sync(別のテキスト) をしたとき → { version: 1, stale: true, checked: … }
   */
  async checkPluginMessage(message: string, permissions: readonly Permission[]): Promise<{ version: number; stale: boolean; checked: CheckedPluginMessage | Refused }> {
    const version = this.version;
    const res = await this.requestForText((id) => ({ type: "checkPluginMessage", version, id, message, permissions: [...permissions] }));
    return { version, stale: res.stale, checked: parseChecked(res.json) };
  }

  /**
   * 今のテキストに対する依頼をコアに送り、返事の JSON を待つ。
   *
   * @param make 依頼の id から依頼を作る関数
   * @returns 同じ id の返事の JSON と、返事が来るまでにテキストが変わったか。コアが止まったときは、失敗の返事の JSON
   * @example
   * await this.requestForText((id) => ({ type: "modelSnapshot", version: 1, id })) // → { json: '{"elements":[],"relations":[]}', stale: false }
   */
  private requestForText(make: (id: number) => CoreCall): Promise<{ json: string; stale: boolean }> {
    const id = this.nextId++;
    const req = make(id);
    return new Promise((resolve) => {
      this.textWaiting.set(id, resolve);
      this.post(req, `r${id}`, (reason) => {
        this.textWaiting.delete(id);
        resolve({ json: failedReply(req, reason).json, stale: false });
      });
    });
  }

  /**
   * 設定ファイル・プラグインの依頼をコアに送り、返事の JSON を待つ。
   *
   * @param make 依頼の id から依頼を作る関数
   * @returns 同じ id の返事の JSON の文字列で解決する Promise。コアが止まったときは、失敗の返事の JSON
   * @example
   * await this.request((id) => ({ type: "parseProject", id, text: "{}" })) // → '{"project":{"plugins":{}},"problems":[]}'
   */
  private request(make: (id: number) => CoreCall): Promise<string> {
    const id = this.nextId++;
    const req = make(id);
    return new Promise((resolve) => {
      this.jsonWaiting.set(id, resolve);
      this.post(req, `r${id}`, (reason) => {
        this.jsonWaiting.delete(id);
        resolve(failedReply(req, reason).json);
      });
    });
  }

  /**
   * 依頼をコアに送り、返事の期限を付ける。期限までに返事が来なければ、コアは止まったと見なす（down）。
   * コアが止まっている間（つなぎ直すまで）は送らず、すぐ失敗にする。
   *
   * @param req 送る依頼
   * @param key 返事と結ぶ鍵（解析は "v" + 版、ほかは "r" + id）
   * @param fail 期限切れ・コアの停止のときに、この依頼の結果を失敗にする処理（理由を受け取る）
   */
  private post(req: CoreRequest, key: string, fail: (reason: string) => void): void {
    if (!this.port) {
      fail("図を読み込み直しています");
      return;
    }
    const timer = setTimeout(() => this.down(`${this.timeoutMs / 1000} 秒たっても返事がありません`), this.timeoutMs);
    this.pending.set(key, { timer, fail });
    this.port.post(req);
  }

  /**
   * 返事が来た依頼の期限を解く。
   *
   * @param key 依頼の鍵（"v" + 版、または "r" + id）
   */
  private settle(key: string): void {
    const p = this.pending.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(key);
  }

  /**
   * コアが止まった（返事の期限切れ・Worker のエラー・wasm の例外）。通り道を外し、待っていた依頼をすべて失敗にしてから、onDown に知らせる。
   * 送ったテキストは控えたままにし、つなぎ直したときに送り直す。
   *
   * @param reason 止まった理由（画面には出さず、作り直す側に渡す）
   */
  private down(reason: string): void {
    if (!this.port) return;
    this.port = null;
    const failed = [...this.pending.values()];
    this.pending.clear();
    this.texts.clear();
    for (const p of failed) {
      clearTimeout(p.timer);
      p.fail(reason);
    }
    this.onDown(reason);
  }

  /**
   * コアからの返事を 1 つ受け取る。今の版の解析結果なら onAnalyzed を呼び、編集の返事なら待っている edit を、
   * 設定ファイル・プラグインの返事なら、待っている依頼（parseProjectFile・setPlugins など）を解決する。
   * 古い版の解析結果は捨て、古い版の編集の返事は断り（STALE_EDIT）にし、モデル・メッセージの確認には古い版かどうかを添える。
   * wasm の例外による失敗の返事（failure 付き）は、そのまま解決したうえで、コアが止まったと見なす（壊れた wasm を使い続けない）。
   *
   * @param res コアからの返事
   */
  private receive(res: CoreResponse): void {
    if (res.type === "ready" || res.type === "failed") return;
    this.resolve(res);
    if (res.failure !== undefined) this.down(res.failure);
  }

  /**
   * 依頼への返事を、待っている処理に渡す。
   *
   * @param res 依頼への返事
   */
  private resolve(res: CoreReply): void {
    if (res.type === "analyzed") {
      this.settle(`v${res.version}`);
      const text = this.texts.get(res.version);
      for (const v of this.texts.keys()) if (v <= res.version) this.texts.delete(v);
      // 古い版の結果は捨てて、次の結果を待つ
      if (res.version !== this.version || text === undefined) return;
      const { P, M, findings } = fromAnalysis(res.json, text);
      this.onAnalyzed(res.version, P, M, findings);
      return;
    }
    this.settle(`r${res.id}`);
    if (res.type === "edited") {
      const resolve = this.waiting.get(res.id);
      this.waiting.delete(res.id);
      resolve?.(res.version === this.version ? parseEdited(res.json) : { refused: STALE_EDIT });
    } else if (res.type === "snapshotMade" || res.type === "pluginMessageChecked" || res.type === "problemsCounted") {
      const resolve = this.textWaiting.get(res.id);
      this.textWaiting.delete(res.id);
      resolve?.({ json: res.json, stale: res.version !== this.version });
    } else {
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
 * @returns 読み取りの結果。JSON が壊れている・形が違うときは、設定は null で「設定ファイルを読み込めませんでした…」の誤り 1 件（例外は投げない）
 * @example
 * parseProjectResult('{"project":null,"problems":[]}') // → { project: null, problems: [] }
 * parseProjectResult('{"error":"x"}')                  // → { project: null, problems: [{ …, message: "設定ファイルを読み込めませんでした（x）" }] }
 * parseProjectResult("{")                              // → { project: null, problems: [{ …, message: "設定ファイルを読み込めませんでした（…）" }] }
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
 * @returns テキストか断り。JSON が壊れている・形が違うときは「プロジェクトの設定ファイルを作成できませんでした…」の断り（例外は投げない）
 * @example
 * parseCreated('{"text":"{}\\n"}') // → { text: "{}\n" }
 * parseCreated('{"refused":"x"}')    // → { refused: "x" }
 * parseCreated("{")                  // → { refused: "プロジェクトの設定ファイルを作成できませんでした（…）" }
 */
function parseCreated(json: string): CreatedProjectFile | Refused {
  return parseText(json, "プロジェクトの設定ファイルを作成できませんでした");
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
 * @returns プラグインの情報か断り。JSON が壊れている・形が違うときは「プラグインを読み込めませんでした…」の断り（例外は投げない）
 * @example
 * parseDescribed('{"plugin":{"id":"jp.x",…}}') // → { plugin: { id: "jp.x", … } }
 * parseDescribed('{"refused":"x"}')           // → { refused: "x" }
 * parseDescribed("{")                         // → { refused: "プラグインを読み込めませんでした（…）" }
 */
function parseDescribed(json: string): DescribedPlugin | Refused {
  try {
    const r = JSON.parse(json) as Partial<DescribedPlugin & Refused>;
    if (r.plugin && typeof r.plugin.id === "string") return { plugin: r.plugin };
    if (typeof r.refused === "string") return { refused: r.refused };
    return { refused: "プラグインを読み込めませんでした（コアの返事の形が違います）" };
  } catch (e) {
    return { refused: `プラグインを読み込めませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/**
 * コアが返した、プラグインに渡すモデル（JSON）を読む。
 *
 * @param version モデルを作ったテキストの版
 * @param json wasm の `modelSnapshot` が返した JSON の文字列
 * @returns モデルと版。JSON が壊れている・形が違うときは null（例外は投げない）
 * @example
 * parseSnapshot(1, '{"elements":[],"relations":[]}') // → { version: 1, snapshot: { elements: [], relations: [] } }
 * parseSnapshot(1, '{"error":"x"}')                  // → null
 * parseSnapshot(1, "{")                              // → null
 */
function parseSnapshot(version: number, json: string): VersionedSnapshot | null {
  try {
    const r = JSON.parse(json) as Partial<VersionedSnapshot["snapshot"]>;
    if (!Array.isArray(r.elements) || !Array.isArray(r.relations)) return null;
    return { version, snapshot: { elements: r.elements, relations: r.relations } };
  } catch {
    return null;
  }
}

/**
 * コアが返した、プラグインのメッセージを確かめた結果（JSON）を読む。
 *
 * @param json wasm の `checkPluginMessage` が返した JSON の文字列
 * @returns 確かめたメッセージか断り。JSON が壊れている・形が違うときは「メッセージを確かめられませんでした…」の断り（例外は投げない）
 * @example
 * parseChecked('{"message":{"type":"ready"}}') // → { message: { type: "ready" } }
 * parseChecked('{"refused":"x"}')              // → { refused: "x" }
 * parseChecked("{")                            // → { refused: "メッセージを確かめられませんでした（…）" }
 */
function parseChecked(json: string): CheckedPluginMessage | Refused {
  try {
    const r = JSON.parse(json) as Partial<CheckedPluginMessage & Refused>;
    if (r.message && typeof r.message.type === "string") return { message: r.message, edits: r.edits, diagnostics: r.diagnostics };
    if (typeof r.refused === "string") return { refused: r.refused };
    return { refused: "メッセージを確かめられませんでした（コアの返事の形が違います）" };
  } catch (e) {
    return { refused: `メッセージを確かめられませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/**
 * Worker をコアとの通り道にする。返事は `message`、コアが落ちたことは `error`・`messageerror` で聞く。
 * `error` は、画面の側で受け取ったと印を付け（preventDefault）、ページ全体のエラーにしない。
 *
 * @param worker コアを動かす Worker（worker.ts を読み込んだもの）
 * @returns 通り道
 * @example
 * const port = workerPort(new CoreWorker());
 * port.listenFailure((reason) => …); // Worker が落ちると reason（エラーのメッセージ）で呼ばれる
 */
export function workerPort(worker: Worker): CorePort {
  return {
    post: (req) => worker.postMessage(req),
    listen: (fn) => worker.addEventListener("message", (ev: MessageEvent<CoreResponse>) => fn(ev.data)),
    listenFailure: (fn) => {
      worker.addEventListener("error", (ev) => {
        ev.preventDefault();
        fn(ev.message || "コアの Worker でエラーが起きました");
      });
      worker.addEventListener("messageerror", () => fn("コアの Worker からの返事を読めませんでした"));
    },
  };
}

/**
 * Worker の中でコアを動かし、使える状態になったら通り道を返す。Worker に `init` を送る。
 *
 * @param worker コアを動かす Worker（worker.ts を読み込んだもの）
 * @param wasmUrl コアの wasm の URL
 * @returns Worker が `ready` を返したら、通り道で解決する Promise。
 *   wasm を読み込めない（`failed`）・Worker を起動できないときは Error で拒否する
 * @example
 * await initWorker(worker, "/modelith_core_bg.wasm") // → CorePort
 * await initWorker(worker, "/missing.wasm")          // → Error で拒否
 */
export function initWorker(worker: Worker, wasmUrl: string): Promise<CorePort> {
  const port = workerPort(worker);
  return new Promise((resolve, reject) => {
    const first = (ev: MessageEvent<CoreResponse>): void => {
      if (ev.data.type === "ready") resolve(port);
      else if (ev.data.type === "failed") reject(new Error(ev.data.message));
      else return;
      worker.removeEventListener("message", first);
    };
    worker.addEventListener("message", first);
    worker.addEventListener("error", (ev) => reject(new Error(ev.message || "コアの Worker を起動できませんでした")), { once: true });
    port.post({ type: "init", wasmUrl });
  });
}

/**
 * Worker の中でコアを動かし、使える状態になったら受け口を返す。Worker に `init` を送る。
 * コアが止まったときの作り直しは supervisor.ts の `superviseCore` が行う。
 *
 * @param worker コアを動かす Worker（worker.ts を読み込んだもの）
 * @param wasmUrl コアの wasm の URL
 * @param onAnalyzed 今の版の解析結果を受け取ったときに呼ぶ処理
 * @param options 返事の期限と、コアが止まったときの処理
 * @returns Worker が `ready` を返したら、受け口（CoreClient）で解決する Promise。
 *   wasm を読み込めない（`failed`）・Worker を起動できないときは Error で拒否する（起動の失敗として画面に出す）
 * @example
 * await startCore(worker, "/modelith_core_bg.wasm", onAnalyzed) // → CoreClient（current は 0）
 * await startCore(worker, "/missing.wasm", onAnalyzed)           // → Error で拒否
 */
export async function startCore(worker: Worker, wasmUrl: string, onAnalyzed: AnalyzedListener, options: CoreClientOptions = {}): Promise<CoreClient> {
  return new CoreClient(await initWorker(worker, wasmUrl), onAnalyzed, options);
}
