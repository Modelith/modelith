// コアの Worker の作り直し（Q-7）。Worker の代わりに、`init` に `ready` を返すだけの偽の Worker を使い、
// 止まったと知らせる・作り直す・あきらめる、の判断を確かめる。
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_STOPPED } from "./client";
import { MAX_RESTARTS, RESTART_TIMED_OUT, RESTART_WINDOW_MS, restartAllowed, superviseCore, type CoreSupervisorHooks } from "./supervisor";

/** 起動の仕方。ready は起動する、failed は wasm を読み込めない、hang は返事をしない、manual は boot() を呼ぶまで返事をしない。 */
type Boot = "ready" | "failed" | "hang" | "manual";

/** `init` に `ready`（または失敗）を返し、terminate を数える偽の Worker。crash() で Worker のエラーを起こす。 */
class FakeWorker extends EventTarget {
  terminated = false;
  constructor(private readonly boots: Boot = "ready") {
    super();
  }
  postMessage(req: { type: string }): void {
    if (req.type !== "init" || this.boots === "hang" || this.boots === "manual") return;
    const data = this.boots === "ready" ? { type: "ready" } : { type: "failed", message: "wasm を読み込めません" };
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
  }
  terminate(): void {
    this.terminated = true;
  }
  boot(): void {
    this.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }));
  }
  crash(message: string): void {
    const ev = new Event("error", { cancelable: true });
    Object.defineProperty(ev, "message", { value: message });
    this.dispatchEvent(ev);
  }
}

/** 偽の Worker を作る関数と、作った Worker の一覧。failAt は何個目（0 から）の Worker が起動に失敗するか。boots は何個目の Worker をどう起動するか（failAt より優先）。 */
function spawner(failAt = -1, boots: (index: number) => Boot | undefined = () => undefined) {
  const workers: FakeWorker[] = [];
  const spawn = (): Worker => {
    const w = new FakeWorker(boots(workers.length) ?? (workers.length === failAt ? "failed" : "ready"));
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

describe("superviseCore（作り直した Worker の起動の期限、Q-7）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 1 つ目の Worker は起動し、2 つ目からは boots の通りに起動する偽の Worker で、コアを起動する。 */
  async function start(boots: (index: number) => Boot | undefined, maxRestarts: number) {
    vi.useFakeTimers();
    const { spawn, workers } = spawner(-1, (i) => (i === 0 ? "ready" : boots(i)));
    const { calls, hooks } = recorder();
    const c = await superviseCore(spawn, "core.wasm", () => {}, hooks, { now: () => 0, timeoutMs: 1_000, maxRestarts, windowMs: 60_000 });
    return { c, calls, workers };
  }

  it("期限の 1 ms 手前に起動すれば、その Worker につなぎ直す（境界値: 期限 - 1）", async () => {
    // Arrange
    const { c, calls, workers } = await start(() => "manual", 1);
    workers[0]!.crash("boom");
    await vi.advanceTimersByTimeAsync(999);
    // Act
    workers[1]!.boot();
    await vi.advanceTimersByTimeAsync(1);
    // Assert
    expect(calls).toEqual(["down:boom"]);
    expect([workers.length, workers[1]!.terminated, c.connected]).toEqual([2, false, true]);
  });

  it("期限までに起動しなければ、終了して作り直す（境界値: ちょうど期限）", async () => {
    // Arrange
    const { calls, workers } = await start((i) => (i === 1 ? "hang" : "ready"), 2);
    workers[0]!.crash("boom");
    await vi.advanceTimersByTimeAsync(999);
    // Act
    await vi.advanceTimersByTimeAsync(1);
    // Assert
    expect(calls).toEqual(["down:boom"]);
    expect([workers.length, workers[1]!.terminated, workers[2]!.terminated]).toEqual([3, true, false]);
  });

  it("起動しない Worker も作り直しの回数に数え、上限の回数目に起動すれば、あきらめない（境界値: N 回）", async () => {
    // Arrange（上限 2 回。1 回目に作った Worker は起動せず、2 回目に作った Worker は起動する）
    const { c, calls, workers } = await start((i) => (i === 1 ? "hang" : "ready"), 2);
    // Act
    workers[0]!.crash("boom");
    await vi.advanceTimersByTimeAsync(1_000);
    // Assert
    expect(calls).toEqual(["down:boom"]);
    expect([workers.length, c.connected]).toEqual([3, true]);
  });

  it("作り直した Worker が上限の回数を超えて起動しなければ、あきらめる（境界値: N + 1 回）", async () => {
    // Arrange（上限 2 回。作り直した Worker はどれも起動しない）
    const { c, calls, workers } = await start(() => "hang", 2);
    // Act
    workers[0]!.crash("boom");
    await vi.advanceTimersByTimeAsync(2_000);
    // Assert
    expect(calls).toEqual(["down:boom", `gaveUp:${RESTART_TIMED_OUT}`]);
    expect([workers.length, workers.every((w) => w.terminated), c.connected]).toEqual([3, true, false]);
  });

  it("期限が切れた後に届いた起動は使わない（異常系）", async () => {
    // Arrange（上限 1 回。作り直した Worker は期限の後に起動する）
    const { c, calls, workers } = await start(() => "manual", 1);
    workers[0]!.crash("boom");
    await vi.advanceTimersByTimeAsync(1_000);
    // Act
    workers[1]!.boot();
    await vi.advanceTimersByTimeAsync(0);
    // Assert
    expect(calls).toEqual(["down:boom", `gaveUp:${RESTART_TIMED_OUT}`]);
    expect(c.connected).toBe(false);
  });
});
