// Rust のコア（wasm）との境界（ADR-0015）。解析は例外を投げず、失敗しても画面に知らせる（Q-5）。
import { describe, expect, it } from "vitest";
import { parse, safeParse } from "./rust";

describe("parse（Rust のパーサ）", () => {
  it("Q-5: とても深い入れ子でも例外を投げず、問題として知らせる（異常系）", () => {
    // Arrange
    const text = "package P {".repeat(20_000);
    // Act
    const P = parse(text);
    // Assert
    expect(P.errors.some((e) => e.msg.startsWith("入れ子が深すぎる"))).toBe(true);
  });

  it("Q-5: コアが失敗しても例外を投げず、要素の無い結果とエラーを返す（異常系）", () => {
    // Arrange
    const failing = (): string => {
      throw new Error("unreachable");
    };
    // Act
    const P = safeParse("package P;", failing);
    // Assert
    expect(P.entries).toEqual([]);
    expect(P.errors).toEqual([{ pos: 0, msg: "テキストを読み取れませんでした。テキストはそのまま残っています（unreachable）" }]);
  });

  it("壊れた JSON が返っても例外を投げない（異常系）", () => {
    // Act
    const P = safeParse("", () => "{");
    // Assert
    expect(P.errors).toHaveLength(1);
  });
});
