import { describe, expect, it } from "vitest";
import { parseSavedTabs } from "./saved-tabs";

const VIEWS = ["trace", "ibd"];
const trace = { id: 1, view: "trace", ctx: null, phase: "" };
const ibd = { id: 2, view: "ibd", ctx: "P", phase: "design" };

describe("parseSavedTabs（F-VIEW-2）", () => {
  it("形の合うタブと表示していたタブを戻す（正常系）", () => {
    // Arrange
    const json = JSON.stringify({ tabs: [trace, ibd], active: 2 });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved).toEqual({ tabs: [trace, ibd], active: 2 });
  });

  it("テキストに書かれた view の名前（mv）は文字列なら残す", () => {
    // Arrange
    const json = JSON.stringify({ tabs: [{ ...trace, mv: "Pkg::V" }], active: 1 });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved?.tabs).toEqual([{ ...trace, mv: "Pkg::V" }]);
  });

  it("ctx と phase が無いタブは既定（null・\"\"）で戻す（境界）", () => {
    // Arrange
    const json = JSON.stringify({ tabs: [{ id: 1, view: "trace" }] });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved).toEqual({ tabs: [trace], active: null });
  });

  it.each<[string, unknown]>([
    ["null の項目", null],
    ["id が整数でない", { ...trace, id: 1.5 }],
    ["id が文字列", { ...trace, id: "1" }],
    ["知らないビュー", { ...trace, view: "gone" }],
    ["view が文字列でない", { ...trace, view: 3 }],
    ["ctx が文字列でも null でもない", { ...trace, ctx: 7 }],
    ["phase が文字列でない", { ...trace, phase: {} }],
    ["オブジェクトでない項目", "trace"],
  ])("形の合わない項目（%s）は捨て、残りを戻す（異常系）", (_, bad) => {
    // Arrange
    const json = JSON.stringify({ tabs: [bad, ibd], active: 2 });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved).toEqual({ tabs: [ibd], active: 2 });
  });

  it("文字列でない mv は、その項目を捨てずに mv だけ無いものとして扱う", () => {
    // Arrange
    const json = JSON.stringify({ tabs: [{ ...trace, mv: 2 }] });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved?.tabs).toEqual([trace]);
  });

  it("id が重なったタブは 2 つ目から捨てる（境界）", () => {
    // Arrange
    const json = JSON.stringify({ tabs: [trace, { ...ibd, id: 1 }], active: 1 });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved).toEqual({ tabs: [trace], active: 1 });
  });

  it("表示していたタブが残ったタブに無ければ null にする", () => {
    // Arrange
    const json = JSON.stringify({ tabs: [trace, { ...ibd, view: "gone" }], active: 2 });
    // Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved).toEqual({ tabs: [trace], active: null });
  });

  it.each<[string, string | null]>([
    ["記憶が無い", null],
    ["JSON でない", "{not json"],
    ["オブジェクトでない", '"abc"'],
    ["null", "null"],
    ["tabs が配列でない", '{"tabs":"abc"}'],
    ["tabs が無い", '{"active":1}'],
    ["tabs が空（境界）", '{"tabs":[]}'],
    ["形の合う項目が 1 つも無い", '{"tabs":[null]}'],
  ])("戻せるタブが無いとき（%s）は null（異常系）", (_, json) => {
    // Arrange・Act
    const saved = parseSavedTabs(json, VIEWS);
    // Assert
    expect(saved).toBeNull();
  });
});
