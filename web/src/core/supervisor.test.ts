// コアの Worker の作り直し（Q-7）。Worker の代わりに、`init` に `ready` を返すだけの偽の Worker を使い、
// 止まったと知らせる・作り直す・あきらめる、の判断を確かめる。
import { describe, expect, it } from "vitest";
import { CORE_STOPPED } from "./client";
import { MAX_RESTARTS, RESTART_WINDOW_MS, restartAllowed, superviseCore, type CoreSupervisorHooks } from "./supervisor";

/** `init` に `ready`（または失敗）を返し、terminate を数える偽の Worker。crash() で Worker のエラーを起こす。 */
class FakeWorker extends EventTarget {
  terminated = false;
  constructor(private readonly boots: "ready" | "failed" = "ready") {
    super();
  }
  postMessage(req: { type: string }): void {
    if (req.type !== "init") return;
    const data = this.boots === "ready" ? { type: "ready" } : { type: "failed", message: "wasm を読み込めません" };
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
  }
  terminate(): void {
    this.terminated = true;
  }
  crash(message: string): void {
    const ev = new Event("error", { cancelable: true });
    Object.defineProperty(ev, "message", { value: message });
    this.dispatchEvent(ev);
  }
}

/** 偽の Worker を作る関数と、作った Worker の一覧。boots は何個目の Worker が起動に失敗するか。 */
function spawner(failAt = -1) {
  const workers: FakeWorker[] = [];
  const spawn = (): Worker => {
    const w = new FakeWorker(workers.length === failAt ? "failed" : "ready");
    workers.push(w);
    return w as unknown as Worker;
  };
  return { spawn, workers };
}

/** 呼ばれた順を記録するフック。 */
function recorder() {
  const calls: string[] = [];
  const hooks: CoreSupervisorHooks = {
    onDown: (reason) => calls.push(`down:${reason}`),
    onGaveUp: (reason) => calls.push(`gaveUp:${reason}`),
  };
  return { calls, hooks };
}

/** 作り直しが終わる（マイクロタスクが片付く）まで待つ。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("restartAllowed（作り直しの上限）", () => {
  it.each<[string, number[], number, boolean]>([
    ["まだ一度も作り直していない（境界値: 0 回）", [], 0, true],
    ["期間の中で上限の 1 つ手前（境界値: N - 1 回）", [0, 1], 2, true],
    ["期間の中で上限に達した（境界値: N 回）", [0, 1, 2], 3, false],
    ["古い作り直しは期間の外に出る（境界値: ちょうど期間）", [0, 1, 2], RESTART_WINDOW_MS, true],
    ["期間の 1 ms 手前はまだ数える", [0, 1, 2], RESTART_WINDOW_MS - 1, false],
  ])("%s", (_name, restarts, now, allowed) => {
    // Arrange・Act
    const r = restartAllowed(restarts, now, MAX_RESTARTS, RESTART_WINDOW_MS);
    // Assert
    expect(r).toBe(allowed);
  });
});

describe("superviseCore（コアの作り直し、Q-7）", () => {
  it("Worker がエラーを起こすと、終了して作り直し、受け口は新しい Worker につながる（正常系）", async () => {
    // Arrange
    const { spawn, workers } = spawner();
    const { calls, hooks } = recorder();
    const c = await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => 0 });
    c.sync("package P;");
    // Act
    workers[0]!.crash("boom");
    await flush();
    // Assert
    expect(calls).toEqual(["down:boom"]);
    expect([workers[0]!.terminated, workers.length, c.connected]).toEqual([true, 2, true]);
  });

  it("作り直している間の図の操作は断る（異常系）", async () => {
    // Arrange
    const { spawn, workers } = spawner();
    const { hooks } = recorder();
    const c = await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => 0 });
    workers[0]!.crash("boom");
    // Act
    const r = await c.edit("package P;", { op: "delete", keys: [] });
    // Assert
    expect(r).toEqual({ refused: CORE_STOPPED });
  });

  it("1 分の間に上限の回数までは作り直す（境界値: N 回）", async () => {
    // Arrange
    const { spawn, workers } = spawner();
    const { calls, hooks } = recorder();
    await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => 0, maxRestarts: 2, windowMs: 60_000 });
    // Act
    for (let i = 0; i < 2; i++) {
      workers.at(-1)!.crash(`boom${i}`);
      await flush();
    }
    // Assert
    expect(calls).toEqual(["down:boom0", "down:boom1"]);
    expect([workers.length, workers.every((w, i) => w.terminated === (i < 2))]).toEqual([3, true]);
  });

  it("1 分の間に上限を超えて止まったらあきらめ、Worker は作らない（境界値: N + 1 回）", async () => {
    // Arrange
    const { spawn, workers } = spawner();
    const { calls, hooks } = recorder();
    const c = await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => 0, maxRestarts: 2, windowMs: 60_000 });
    for (let i = 0; i < 2; i++) {
      workers.at(-1)!.crash(`boom${i}`);
      await flush();
    }
    // Act
    workers.at(-1)!.crash("boom2");
    await flush();
    // Assert
    expect(calls.slice(2)).toEqual(["down:boom2", "gaveUp:boom2"]);
    expect([workers.length, workers.at(-1)!.terminated, c.connected]).toEqual([3, true, false]);
  });

  it("期間を過ぎれば、また作り直す", async () => {
    // Arrange
    let now = 0;
    const { spawn, workers } = spawner();
    const { calls, hooks } = recorder();
    await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => now, maxRestarts: 1, windowMs: 60_000 });
    workers.at(-1)!.crash("boom0");
    await flush();
    now = 60_000;
    // Act
    workers.at(-1)!.crash("boom1");
    await flush();
    // Assert
    expect(calls).toEqual(["down:boom0", "down:boom1"]);
    expect(workers).toHaveLength(3);
  });

  it("作り直した Worker が起動に失敗したらあきらめる（異常系）", async () => {
    // Arrange
    const { spawn, workers } = spawner(1);
    const { calls, hooks } = recorder();
    await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => 0 });
    // Act
    workers[0]!.crash("boom");
    await flush();
    // Assert
    expect(calls).toEqual(["down:boom", "gaveUp:wasm を読み込めません"]);
  });

  it("最初の起動に失敗したら Error で拒否する（起動の失敗として画面に出す）", async () => {
    // Arrange
    const { spawn } = spawner(0);
    const { hooks } = recorder();
    // Act & Assert
    await expect(superviseCore(spawn, "core.wasm", () => {}, hooks)).rejects.toThrow("wasm を読み込めません");
  });
});
