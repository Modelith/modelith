// 線の記法（8.2.3）。図の種類ごとの破線と矢印。
import { describe, expect, it } from "vitest";
import { edgeStroke } from "./svg";

describe("edgeStroke（8.2.3 の線の記法）", () => {
  it.each([
    ["specialize", ' marker-end="url(#mTri)"'],
    ["subset", ' marker-end="url(#mTri)"'],
    ["redefine", ' marker-end="url(#mRedef)"'],
    ["reference", ' marker-end="url(#mRef)"'],
  ])("%s は実線で、白抜きの三角の矢印を付ける", (kind, expected) => {
    // Act
    const attrs = edgeStroke(kind);
    // Assert
    expect(attrs).toBe(expected);
  });

  it("満たす関係は、これまでどおり破線と開いた矢印", () => {
    // Act
    const attrs = edgeStroke("satisfy");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("依存は破線で、供給する側に開いた矢印を付ける（8.2.3.3）", () => {
    // Act
    const attrs = edgeStroke("dependency");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("割り当ては破線で、割り当て先に開いた矢印を付ける（8.2.3.15 の allocate-relationship）", () => {
    // Act
    const attrs = edgeStroke("allocate");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("部品として持つ線は、始まりの端にひし形を付ける", () => {
    // Act
    const attrs = edgeStroke("comp");
    // Assert
    expect(attrs).toBe(' marker-start="url(#mDiamond)"');
  });

  it("知らない種類は、開いた矢印にする（境界）", () => {
    // Act
    const attrs = edgeStroke("bogus");
    // Assert
    expect(attrs).toBe(' marker-end="url(#mOpen)"');
  });
});
