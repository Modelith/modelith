import { describe, expect, it } from "vitest";
import { applyEdits } from "./protocol";

const at = (line: number, character: number) => ({ line, character });

describe("applyEdits", () => {
  // --- 正常系 ---

  it("applies non-overlapping edits regardless of their order", () => {
    // Arrange
    const text = "part def A;\npart b : A;";
    const edits = [
      { range: { start: at(0, 9), end: at(0, 10) }, newText: "Engine" },
      { range: { start: at(1, 9), end: at(1, 10) }, newText: "Engine" },
    ];
    // Act
    const out = applyEdits(text, edits);
    // Assert
    expect(out).toBe("part def Engine;\npart b : Engine;");
  });

  it("returns the text unchanged for an empty edit list", () => {
    // Arrange（境界値: 編集 0 件）
    const text = "part def A;";
    // Act
    const out = applyEdits(text, []);
    // Assert
    expect(out).toBe(text);
  });

  it("counts columns in UTF-16 code units", () => {
    // Arrange（同値クラス: マルチバイト文字の後ろ）
    const edits = [{ range: { start: at(0, 6), end: at(0, 6) }, newText: "!" }];
    // Act
    const out = applyEdits("// 日本語\n", edits);
    // Assert
    expect(out).toBe("// 日本語!\n");
  });

  it("inserts at the start of the last line", () => {
    // Arrange（境界値: 最終行の先頭）
    const edits = [{ range: { start: at(1, 0), end: at(1, 0) }, newText: "x" }];
    // Act
    const out = applyEdits("a\nb", edits);
    // Assert
    expect(out).toBe("a\nxb");
  });

  // --- 異常系 ---

  it("rejects a line just past the last line", () => {
    // Arrange（境界値: 最終行 + 1）
    const edits = [{ range: { start: at(2, 0), end: at(2, 0) }, newText: "" }];
    // Act & Assert
    expect(() => applyEdits("a\nb", edits)).toThrow(RangeError);
  });
});
