// Rust のコア（wasm）との境界（ADR-0015）。解析は例外を投げず、失敗しても画面に知らせる（Q-5）。
import { describe, expect, it } from "vitest";
import { build, edit, parse, safeEdit, safeParse } from "./rust";
import { applyTextEdits } from "./text-ops";

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
    expect(P.errors).toEqual([{ pos: 0, msg: "テキストを解析できませんでした。テキストはそのまま残っています（unreachable）" }]);
  });

  it("壊れた JSON が返っても例外を投げない（異常系）", () => {
    // Act
    const P = safeParse("", () => "{");
    // Assert
    expect(P.errors).toHaveLength(1);
  });
});

describe("edit（Rust の図の操作、ADR-0016）", () => {
  it("意図を当てた編集は UTF-16 の位置で返り、そのまま当てられる（正常系）", () => {
    // Arrange（境界値：前にサロゲートペアがある）
    const text = "// 🚀\npackage P { part def A; }";
    // Act
    const r = edit(text, { op: "rename", key: "A", name: "Motor" });
    // Assert
    if ("refused" in r) throw new Error(r.refused);
    expect(applyTextEdits(text, r.edits)).toBe("// 🚀\npackage P { part def Motor; }");
    expect(r.select).toBe("Motor");
  });

  it("操作できないときは理由を返す（異常系）", () => {
    // Act
    const r = edit("package P { part def A; }", { op: "rename", key: "Gone", name: "B" });
    // Assert
    expect(r).toEqual({ refused: expect.stringContaining("Gone") as unknown });
  });

  it("Q-5: コアが失敗しても例外を投げず、操作できなかったことを返す（異常系）", () => {
    // Arrange
    const failing = (): string => {
      throw new Error("unreachable");
    };
    // Act
    const r = safeEdit("", { op: "delete", keys: [] }, failing);
    // Assert
    expect(r).toEqual({ refused: "操作できませんでした。テキストはそのまま残っています（unreachable）" });
  });
});

describe("build（Rust のモデル構築）", () => {
  it("アクションの流れの図を、宣言の参照に戻す（開始・終了は宣言を持たない、8.2.3.17）", () => {
    // Arrange
    const text = "package P { action def A { first start; then action a; } }";
    // Act
    const flow = build(parse(text)).actionFlows?.[0];
    // Assert
    expect(flow?.entry.name).toBe("A");
    expect(flow?.nodes.map((n) => [n.key, n.entry?.name ?? null])).toEqual([
      ["a:start", null],
      ["a:a", "a"],
    ]);
    expect(flow?.edges.map((e) => e.id)).toEqual(["succession|a:start|a:a|#1"]);
  });
});

describe("build（Rust のモデル構築）の状態遷移の図", () => {
  it("状態遷移の図を、宣言の参照に戻す（開始・終了は宣言を持たない、入れ子の状態は外の状態を指す、8.2.3.18）", () => {
    // Arrange
    const text = "package P { state def S { entry; then on; state on { state low; } } }";
    // Act
    const sm = build(parse(text)).stateMachines?.[0];
    // Assert
    expect(sm?.entry.name).toBe("S");
    expect(sm?.nodes.map((n) => [n.key, n.entry?.name ?? null, n.container ?? null])).toEqual([
      ["s:#start", null, null],
      ["s:on", "on", null],
      ["s:on.low", "low", "s:on"],
    ]);
    expect(sm?.edges.map((e) => e.id)).toEqual(["transition|s:#start|s:on|#1"]);
  });
});
