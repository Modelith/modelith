// 起動中の表示（Q-5）。偽のタイマーと、書き換えを記録する表示で、案内への切り替えと取り除くことを確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOADING_TEXT, SLOW_LOADING_MS, SLOW_LOADING_TEXT, watchLoading, type LoadingView } from "./loading";

/** 表示の今の状態（文と、取り除かれたか）を記録する表示。 */
function recorder() {
  const state = { text: LOADING_TEXT, removed: false };
  const view: LoadingView = {
    show: (text) => {
      state.text = text;
    },
    remove: () => {
      state.removed = true;
    },
  };
  return { state, view };
}

describe("watchLoading（起動中の表示、Q-5）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("15 秒の 1 ms 手前は「読み込み中…」のまま（境界値: 期限 - 1）", () => {
    // Arrange
    const { state, view } = recorder();
    watchLoading(view);
    // Act
    vi.advanceTimersByTime(SLOW_LOADING_MS - 1);
    // Assert
    expect(state).toEqual({ text: LOADING_TEXT, removed: false });
  });

  it("15 秒たつと案内に切り替え、待ち続ける（境界値: ちょうど期限）", () => {
    // Arrange
    const { state, view } = recorder();
    watchLoading(view);
    // Act
    vi.advanceTimersByTime(SLOW_LOADING_MS);
    // Assert
    expect(state).toEqual({ text: SLOW_LOADING_TEXT, removed: false });
  });

  it("期限の前に準備ができたら取り除き、後で案内に切り替えない（正常系）", () => {
    // Arrange
    const { state, view } = recorder();
    const done = watchLoading(view);
    // Act
    done();
    vi.advanceTimersByTime(SLOW_LOADING_MS);
    // Assert
    expect(state).toEqual({ text: LOADING_TEXT, removed: true });
  });

  it("案内に切り替えた後に準備ができても、案内を取り除く", () => {
    // Arrange
    const { state, view } = recorder();
    const done = watchLoading(view);
    vi.advanceTimersByTime(SLOW_LOADING_MS);
    // Act
    done();
    // Assert
    expect(state.removed).toBe(true);
  });

  it("切り替えまでの時間を差し替えられる", () => {
    // Arrange
    const { state, view } = recorder();
    watchLoading(view, 100);
    // Act
    vi.advanceTimersByTime(100);
    // Assert
    expect(state.text).toBe(SLOW_LOADING_TEXT);
  });

  it("2 回呼んでも、取り除くのは 1 回だけ（境界値: 2 回目）", () => {
    // Arrange
    const remove = vi.fn();
    const done = watchLoading({ show: () => {}, remove });
    done();
    // Act
    done();
    // Assert
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
