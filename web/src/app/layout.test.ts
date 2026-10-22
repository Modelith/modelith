import { describe, expect, it } from "vitest";
import { layoutFromJson, layoutToJson } from "./layout";

describe("layoutFromJson", () => {
  it("座標・接続点・線の端を読み分ける", () => {
    // Arrange
    const raw = { trace: { A: [10, 20], "@pins": { A: { a1: ["r", 0.5] } }, "@ends": { "flow|A|B|#1": ["a1", null] } } };
    // Act
    const L = layoutFromJson(raw);
    // Assert
    expect(L).toEqual({ trace: { pos: { A: [10, 20] }, pins: { A: { a1: ["r", 0.5] } }, ends: { "flow|A|B|#1": ["a1", null] } } });
  });

  it("形の合わない値は捨てる（異常系）", () => {
    // Arrange
    const raw = { trace: { A: [1], B: "x", "@pins": { A: { a1: ["z", 0.5] } } }, broken: 3 };
    // Act
    const L = layoutFromJson(raw);
    // Assert
    expect(L).toEqual({ trace: { pos: {}, pins: { A: {} }, ends: {} } });
  });
});

describe("layoutToJson", () => {
  it("読み取った形に戻す（往復で変わらない）", () => {
    // Arrange
    const raw = { ibd: { "u:a": [0, 0], "@pins": { "u:a": { "port:p": ["l", 0.3] } }, "@ends": { e: [null, "port:p"] } } };
    // Act
    const back = layoutToJson(layoutFromJson(raw));
    // Assert
    expect(back).toEqual(raw);
  });

  it("空の接続点・線の端は書かない（境界値: 空）", () => {
    // Arrange
    const L = { v: { pos: { A: [0, 0] as [number, number] }, pins: { A: {} }, ends: {} } };
    // Act
    const json = layoutToJson(L);
    // Assert
    expect(json).toEqual({ v: { A: [0, 0] } });
  });
});
