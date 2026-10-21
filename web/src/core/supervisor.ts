// コアの Worker が止まった・返事をしないときに作り直す（Q-7、ADR-0016）。
// 判断（作り直してよいか）は restartAllowed に集め、Worker の起動と終了はここで行う。

import { CORE_REPLY_TIMEOUT_MS, CoreClient, initWorker, type AnalyzedListener, type CorePort } from "./client";

/** 1 分（RESTART_WINDOW_MS）の間に作り直す回数の上限。これを超えたらあきらめる。 */
export const MAX_RESTARTS = 3;

/** 作り直しの回数を数える期間（ミリ秒）。 */
export const RESTART_WINDOW_MS = 60_000;

/** 作り直した Worker が、期限（返事の期限と同じ）までに `ready` を返さなかったときの理由（止まったものとして扱う）。 */
export const RESTART_TIMED_OUT = "作り直したコアが期限までに起動しませんでした";

/** コアが止まったとき・あきらめたときに、画面に知らせる処理。作り直せたときは、送り直したテキストの解析結果が届く。 */
export interface CoreSupervisorHooks {
  /** コアが止まった（返事の期限切れ・Worker のエラー・wasm の例外）。待っていた図の操作は、もうやめている */
  onDown(reason: string): void;
  /** 短い間に作り直しが続いた・作り直せなかったので、あきらめた。以後、図の操作と解析はできない */
  onGaveUp(reason: string): void;
}

/** 作り直しの設定（テストで差し替える）。 */
export interface CoreSupervisorOptions {
  /** 返事を待つ期限と、作り直した Worker の起動を待つ期限（ミリ秒。既定は CORE_REPLY_TIMEOUT_MS） */
  timeoutMs?: number;
  /** 作り直す回数の上限（既定は MAX_RESTARTS） */
  maxRestarts?: number;
  /** 回数を数える期間（ミリ秒。既定は RESTART_WINDOW_MS） */
  windowMs?: number;
  /** 今の時刻（ミリ秒。既定は Date.now） */
  now?: () => number;
}

/**
 * もう一度作り直してよいかを決める。期間の中で作り直した回数が上限に達していなければよい。
 *
 * @param restarts これまでに作り直した時刻（ミリ秒）
 * @param now 今の時刻（ミリ秒）
 * @param max 期間の中で作り直す回数の上限
 * @param windowMs 回数を数える期間（ミリ秒。now からさかのぼる）
 * @returns 作り直してよければ true
 * @example
 * restartAllowed([], 0, 3, 60_000)                       // → true
 * restartAllowed([0, 10_000], 20_000, 3, 60_000)         // → true（3 回目）
 * restartAllowed([0, 10_000, 20_000], 30_000, 3, 60_000) // → false（4 回目）
 * restartAllowed([0, 10_000, 20_000], 60_000, 3, 60_000) // → true（最初の 1 回は期間の外に出た）
 */
export function restartAllowed(restarts: readonly number[], now: number, max: number, windowMs: number): boolean {
  return restarts.filter((t) => now - t < windowMs).length < max;
}

/**
 * Worker の起動（`ready`）を、期限まで待つ。期限が切れた後に起動・失敗しても、その結果は使わない。
 *
 * @param init Worker の起動を待つ Promise（initWorker が返すもの）
 * @param timeoutMs 待つ期限（ミリ秒）
 * @returns 期限までに起動すれば通り道、期限が切れれば null。期限までに起動に失敗すれば、その Error で拒否する
 * @example
 * await readyWithin(initWorker(worker, wasmUrl), 10_000) // → CorePort（10 秒以内に ready）
 * await readyWithin(new Promise(() => {}), 10_000)        // → null（10 秒たっても ready が来ない）
 */
export function readyWithin(init: Promise<CorePort>, timeoutMs: number): Promise<CorePort | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    init.then(
      (port) => {
        clearTimeout(timer);
        resolve(port);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Worker の中でコアを動かして受け口を返し、コアが止まったら Worker を終了して作り直す（Q-7）。
 * 作り直したら、受け口が今のテキストとプラグインを送り直す。作り直した Worker が期限までに起動しなければ、止まったものとして終了し、また作り直す。
 * 短い間に作り直しが続いたとき・作り直せなかったときはあきらめ、
 * 以後の依頼はすぐ断られる（テキストの編集と保存は画面の側で続けられる）。
 *
 * @param spawn コアを動かす Worker を作る関数（worker.ts を読み込んだもの。作り直すたびに呼ぶ）
 * @param wasmUrl コアの wasm の URL
 * @param onAnalyzed 今の版の解析結果を受け取ったときに呼ぶ処理
 * @param hooks 止まった・作り直した・あきらめたときに画面に知らせる処理
 * @param options 返事の期限・作り直しの上限と期間・時刻
 * @returns 最初の Worker が `ready` を返したら、受け口（CoreClient）で解決する Promise。最初の起動に失敗すれば Error で拒否する（起動の失敗として画面に出す）
 * @example
 * await superviseCore(() => new CoreWorker(), wasmUrl, onAnalyzed, hooks) // → CoreClient
 * // Worker がエラーを起こすと hooks.onDown → 作り直し（受け口はつながったまま、解析結果が届き直す）
 * // 1 分に 4 回目の停止では hooks.onDown → hooks.onGaveUp
 * // 作り直した Worker が期限までに ready を返さないと、それも停止として数える（上限を超えたら hooks.onGaveUp）
 */
export async function superviseCore(spawn: () => Worker, wasmUrl: string, onAnalyzed: AnalyzedListener, hooks: CoreSupervisorHooks, options: CoreSupervisorOptions = {}): Promise<CoreClient> {
  const now = options.now ?? Date.now;
  const max = options.maxRestarts ?? MAX_RESTARTS;
  const windowMs = options.windowMs ?? RESTART_WINDOW_MS;
  const timeoutMs = options.timeoutMs ?? CORE_REPLY_TIMEOUT_MS;
  const restarts: number[] = [];
  let worker = spawn();
  let client: CoreClient | null = null;
  /** 今の Worker を終了して作り直す。期限までに起動しなければ、もう一度作り直す。作り直せなければあきらめる。 */
  const restart = async (reason: string): Promise<void> => {
    worker.terminate();
    const at = now();
    if (!restartAllowed(restarts, at, max, windowMs)) {
      hooks.onGaveUp(reason);
      return;
    }
    restarts.push(at);
    let port: CorePort | null;
    try {
      worker = spawn();
      port = await readyWithin(initWorker(worker, wasmUrl), timeoutMs);
    } catch (e) {
      hooks.onGaveUp(e instanceof Error ? e.message : String(e));
      return;
    }
    if (port) client?.reconnect(port);
    else await restart(RESTART_TIMED_OUT);
  };
  /** 止まったときの処理。画面に知らせてから作り直す。 */
  const onDown = async (reason: string): Promise<void> => {
    hooks.onDown(reason);
    await restart(reason);
  };
  client = new CoreClient(await initWorker(worker, wasmUrl), onAnalyzed, { timeoutMs, onDown: (reason) => void onDown(reason) });
  return client;
}
