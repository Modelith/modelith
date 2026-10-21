import { describe, expect, it } from "vitest";
import { nextMenuIndex, nextMenuItem, nextTabIndex, rovingStop, wrapFocus } from "./keyboard";

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

describe("nextMenuIndex（Q-9：メニューバーで左右の矢印キーを押して隣のメニューへ移る）", () => {
  it("右の矢印キーで次の、左の矢印キーで前のメニューへ移る（正常系）", () => {
    // Arrange
    const count = 6;
    // Act
    const next = [nextMenuIndex(count, 2, "ArrowRight"), nextMenuIndex(count, 2, "ArrowLeft")];
    // Assert
    expect(next).toEqual([3, 1]);
  });

  it("右端で右へ進むと先頭へ、左端で左へ戻ると最後へ回る（境界：両端）", () => {
    // Arrange
    const count = 6;
    // Act
    const next = [nextMenuIndex(count, 5, "ArrowRight"), nextMenuIndex(count, 0, "ArrowLeft")];
    // Assert
    expect(next).toEqual([0, 5]);
  });

  it("メニューが 1 つなら、そのメニューにとどまる（境界：1 つ）", () => {
    // Arrange
    const count = 1;
    // Act
    const next = [nextMenuIndex(count, 0, "ArrowRight"), nextMenuIndex(count, 0, "ArrowLeft")];
    // Assert
    expect(next).toEqual([0, 0]);
  });

  it("左右の矢印キーでなければ移らない（Home・End・上下も含む。異常系）", () => {
    // Arrange
    const keys = ["Home", "End", "ArrowDown", "ArrowUp", "Enter"];
    // Act
    const next = keys.map((key) => nextMenuIndex(6, 2, key));
    // Assert
    expect(next).toEqual([null, null, null, null, null]);
  });

  it("メニューが無い・今の位置がメニューの外なら移らない（境界：0 個・範囲外）", () => {
    // Arrange
    const cases: [number, number][] = [[0, 0], [6, -1], [6, 6]];
    // Act
    const next = cases.map(([count, current]) => nextMenuIndex(count, current, "ArrowRight"));
    // Assert
    expect(next).toEqual([null, null, null]);
  });
});

describe("nextMenuItem（Q-9：開いているメニューで上下の矢印キーを押して項目を移る）", () => {
  it("下の矢印キーで次の、上の矢印キーで前の項目へ移る（正常系）", () => {
    // Arrange
    const usable = [true, true, true];
    // Act
    const next = [nextMenuItem(usable, 1, "ArrowDown"), nextMenuItem(usable, 1, "ArrowUp")];
    // Assert
    expect(next).toEqual([2, 0]);
  });

  it("最後の項目から下へは先頭へ、先頭の項目から上へは最後へ回る（境界：両端）", () => {
    // Arrange
    const usable = [true, true, true];
    // Act
    const next = [nextMenuItem(usable, 2, "ArrowDown"), nextMenuItem(usable, 0, "ArrowUp")];
    // Assert
    expect(next).toEqual([0, 2]);
  });

  it("見出しにいるときは、下へは先頭の、上へは最後の項目へ入る（境界：-1）", () => {
    // Arrange
    const usable = [true, true, true];
    // Act
    const next = [nextMenuItem(usable, -1, "ArrowDown"), nextMenuItem(usable, -1, "ArrowUp")];
    // Assert
    expect(next).toEqual([0, 2]);
  });

  it("押せない項目は飛ばす（端を回るときも。同値：無効な項目）", () => {
    // Arrange
    const usable = [false, true, false, true, false];
    // Act
    const next = [nextMenuItem(usable, 1, "ArrowDown"), nextMenuItem(usable, 3, "ArrowDown"), nextMenuItem(usable, 1, "ArrowUp"), nextMenuItem(usable, -1, "ArrowDown")];
    // Assert
    expect(next).toEqual([3, 1, 3, 1]);
  });

  it("押せる項目が 1 つだけなら、その項目にとどまる（境界：1 つ）", () => {
    // Arrange
    const usable = [false, true, false];
    // Act
    const next = [nextMenuItem(usable, 1, "ArrowDown"), nextMenuItem(usable, 1, "ArrowUp")];
    // Assert
    expect(next).toEqual([1, 1]);
  });

  it("押せる項目が無い・項目が 0 個なら移らない（境界：0 個）", () => {
    // Arrange
    const cases: boolean[][] = [[false, false], []];
    // Act
    const next = cases.map((usable) => nextMenuItem(usable, -1, "ArrowDown"));
    // Assert
    expect(next).toEqual([null, null]);
  });

  it("上下の矢印キーでなければ移らない（異常系）", () => {
    // Arrange
    const usable = [true, true, true];
    // Act
    const next = ["ArrowLeft", "ArrowRight", "Tab", "Home"].map((key) => nextMenuItem(usable, 0, key));
    // Assert
    expect(next).toEqual([null, null, null, null]);
  });
});
