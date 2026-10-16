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

  constructor(
    private readonly port: CorePort,
    private readonly onAnalyzed: AnalyzedListener,
  ) {
    port.listen((res) => this.receive(res));
  }

  /** 今の版（最後に送ったテキストの版）。 */
  get current(): number {
    return this.version;
  }

  /** テキストをコアに送る。前に送ったものと同じなら送らない。送ったテキストの版を返す。 */
  sync(text: string): number {
    if (text === this.sent) return this.version;
    this.version += 1;
    this.sent = text;
    this.texts.set(this.version, text);
    this.port.post({ type: "didChange", version: this.version, text });
    return this.version;
  }

  /** text に意図を当てた編集を求める。返事が来るまでにテキストが変わっていれば、断りを返す。 */
  edit(text: string, intent: Intent): Promise<EditResult | Refused> {
    const version = this.sync(text);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.port.post({ type: "edit", version, id, intent });
    });
  }

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

function parseEdited(json: string): EditResult | Refused {
  try {
    return JSON.parse(json) as EditResult | Refused;
  } catch (e) {
    return { refused: `操作できませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` };
  }
}

/** Worker の中でコアを動かし、使える状態になったら受け口を返す。読み込めなければ例外にする（起動の失敗として画面に出す）。 */
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
