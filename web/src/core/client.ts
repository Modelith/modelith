// 画面の側から見たコア（ADR-0016 §4）。テキストを変えるたびに版を 1 つ上げてコアに送り、
// 返ってきた結果の版が今の版と同じときだけ使う。違えば捨てる（解析なら次の結果を待ち、編集なら適用しない）。

import type { CoreRequest, CoreResponse } from "./protocol";
import { fromAnalysis, type EditResult, type Intent, type Refused } from "./rust";
import type { Model, ParseResult } from "./types";

/** コアとの通り道（Worker、またはテストでは同じスレッドの関数）。 */
export interface CorePort {
  post(req: CoreRequest): void;
  listen(fn: (res: CoreResponse) => void): void;
}

/** 編集の返事が古かったときの断り（ADR-0014 の言葉）。 */
export const STALE_EDIT = "テキストが変わったため、この操作はやめました。もう一度操作してください";

/** 解析結果を受け取ったときの処理。 */
export type AnalyzedListener = (version: number, P: ParseResult, M: Model) => void;

export class CoreClient {
  private version = 0;
  private sent: string | null = null;
  /** 送ったが、まだ解析の返事が来ていない版のテキスト。 */
  private readonly texts = new Map<number, string>();
  private nextId = 1;
  private readonly waiting = new Map<number, (r: EditResult | Refused) => void>();

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
   * コアからの返事を 1 つ受け取る。今の版の解析結果なら onAnalyzed を呼び、編集の返事なら待っている edit を解決する。
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
      const { P, M } = fromAnalysis(res.json, text);
      this.onAnalyzed(res.version, P, M);
    } else if (res.type === "edited") {
      const resolve = this.waiting.get(res.id);
      this.waiting.delete(res.id);
      resolve?.(res.version === this.version ? parseEdited(res.json) : { refused: STALE_EDIT });
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
