import { describe, expect, it } from "vitest";
import { nextTabIndex, rovingStop, wrapFocus } from "./keyboard";

describe("wrapFocus（Q-8：ダイアログの中で Tab を回す）", () => {
  it("最後の要素で Tab を押すと、先頭へ回す（境界：末尾）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = wrapFocus(count, 2, false);
    // Assert
    expect(next).toBe(0);
  });

  it("先頭の要素で Shift+Tab を押すと、最後へ回す（境界：先頭）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = wrapFocus(count, 0, true);
    // Assert
    expect(next).toBe(2);
  });

  it("途中の要素では、ブラウザの順に任せる（正常系）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = [wrapFocus(count, 1, false), wrapFocus(count, 1, true), wrapFocus(count, 0, false), wrapFocus(count, 2, true)];
    // Assert
    expect(next).toEqual([null, null, null, null]);
  });

  it("要素が 1 つなら、どちらの向きでもその要素にとどめる（境界：1 つ）", () => {
    // Arrange
    const count = 1;
    // Act
    const next = [wrapFocus(count, 0, false), wrapFocus(count, 0, true)];
    // Assert
    expect(next).toEqual([0, 0]);
  });

  it("入力がダイアログの外にあれば、向きに合わせて端の要素へ入れる（異常系）", () => {
    // Arrange
    const count = 4;
    // Act
    const next = [wrapFocus(count, -1, false), wrapFocus(count, -1, true), wrapFocus(count, 4, false)];
    // Assert
    expect(next).toEqual([0, 3, 0]);
  });

  it("受け取れる要素が無ければ、何もしない（境界：0 個）", () => {
    // Arrange
    const count = 0;
    // Act
    const next = wrapFocus(count, -1, false);
    // Assert
    expect(next).toBeNull();
  });
});

describe("nextTabIndex（Q-8：図のタブを矢印キーで移る）", () => {
  it("右の矢印キーで次のタブへ、左の矢印キーで前のタブへ移る（正常系）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = [nextTabIndex(count, 1, "ArrowRight"), nextTabIndex(count, 1, "ArrowLeft")];
    // Assert
    expect(next).toEqual([2, 0]);
  });

  it("右端で右、左端で左を押すと、反対の端へ回る（境界：両端）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = [nextTabIndex(count, 2, "ArrowRight"), nextTabIndex(count, 0, "ArrowLeft")];
    // Assert
    expect(next).toEqual([0, 2]);
  });

  it("Home で先頭へ、End で最後のタブへ移る（正常系）", () => {
    // Arrange
    const count = 4;
    // Act
    const next = [nextTabIndex(count, 2, "Home"), nextTabIndex(count, 1, "End")];
    // Assert
    expect(next).toEqual([0, 3]);
  });

  it("タブが 1 つなら、どのキーでもそのタブのまま（境界：1 つ）", () => {
    // Arrange
    const count = 1;
    // Act
    const next = ["ArrowRight", "ArrowLeft", "Home", "End"].map((k) => nextTabIndex(count, 0, k));
    // Assert
    expect(next).toEqual([0, 0, 0, 0]);
  });

  it("タブを移すキーでなければ、移らない（異常系：上下の矢印・Enter・Tab）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = ["ArrowUp", "ArrowDown", "Enter", "Tab"].map((k) => nextTabIndex(count, 1, k));
    // Assert
    expect(next).toEqual([null, null, null, null]);
  });

  it("タブが無い・今の位置がタブの外なら、移らない（異常系）", () => {
    // Arrange
    const count = 3;
    // Act
    const next = [nextTabIndex(0, 0, "ArrowRight"), nextTabIndex(count, -1, "ArrowRight"), nextTabIndex(count, 3, "ArrowLeft")];
    // Assert
    expect(next).toEqual([null, null, null]);
  });
});

describe("rovingStop（Q-8：Tab でツリーに入る行）", () => {
  it("選んでいる行があれば、その行に入る（正常系）", () => {
    // Arrange
    const selected = [false, false, true, false];
    // Act
    const stop = rovingStop(selected);
    // Assert
    expect(stop).toBe(2);
  });

  it("選んでいる行が無ければ、先頭の行に入る（正常系）", () => {
    // Arrange
    const selected = [false, false, false];
    // Act
    const stop = rovingStop(selected);
    // Assert
    expect(stop).toBe(0);
  });

  it("選んでいる行が先頭・末尾でも、その行に入る（境界：両端）", () => {
    // Arrange
    const first = [true, false, false];
    const last = [false, false, true];
    // Act
    const stops = [rovingStop(first), rovingStop(last)];
    // Assert
    expect(stops).toEqual([0, 2]);
  });

  it("行が 1 つなら、選んでいなくてもその行に入る（境界：1 行）", () => {
    // Arrange
    const selected = [false];
    // Act
    const stop = rovingStop(selected);
    // Assert
    expect(stop).toBe(0);
  });

  it("行が無ければ、入る行は無い（境界：0 行）", () => {
    // Arrange
    const selected: boolean[] = [];
    // Act
    const stop = rovingStop(selected);
    // Assert
    expect(stop).toBe(-1);
  });
});
