import { describe, expect, it } from "vitest";
import { wrapFocus } from "./keyboard";

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
