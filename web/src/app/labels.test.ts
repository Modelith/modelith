// 画面に出す名前（ADR-0014、docs/development/ui-writing.md）。
import { describe, expect, it } from "vitest";
import { diagramName } from "./labels";

describe("diagramName（ビューの名前を「〜の図」と呼べる形にする）", () => {
  it("「図」で終わらない名前には「の図」を付ける", () => {
    // Arrange
    const label = "トレーサビリティ";
    // Act
    const name = diagramName(label);
    // Assert
    expect(name).toBe("トレーサビリティの図");
  });

  it("「図」で終わる名前はそのまま返す（「ブロック定義図の図」にしない）", () => {
    // Arrange
    const label = "ブロック定義図";
    // Act
    const name = diagramName(label);
    // Assert
    expect(name).toBe("ブロック定義図");
  });

  it("「図」が途中にあるだけなら「の図」を付ける（境界値）", () => {
    // Arrange
    const label = "図面";
    // Act
    const name = diagramName(label);
    // Assert
    expect(name).toBe("図面の図");
  });
});
