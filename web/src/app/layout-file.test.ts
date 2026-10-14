import { describe, expect, it } from "vitest";
import { isEmptyLayout, parseLayoutFile, serializeLayout } from "./layout-file";
import type { Layout } from "./layout";

const L: Layout = {
  trace: { pos: { B: [10, 20], A: [0, 0] }, pins: { A: { a2: ["r", 0.5], a1: ["l", 0.3] } }, ends: { "e|A|B": ["a1", null] } },
  ibd: { pos: {}, pins: {}, ends: {} },
};

describe("serializeLayout（ADR-0005）", () => {
  it("キー順を固定し、要素ごとに 1 行で書く（空のビューは書かない）", () => {
    // Arrange・Act
    const text = serializeLayout(L);
    // Assert
    expect(text).toBe(`{
  "modelith": "layout",
  "format": 1,
  "views": {
    "trace": {
      "@ends": {
        "e|A|B": ["a1",null]
      },
      "@pins": {
        "A": {"a1":["l",0.3],"a2":["r",0.5]}
      },
      "A": [0,0],
      "B": [10,20]
    }
  }
}
`);
  });

  it("書く順は、配置を作った順に左右されない（同じ配置なら同じ文字列）", () => {
    // Arrange
    const other: Layout = { trace: { pos: { A: [0, 0], B: [10, 20] }, pins: { A: { a1: ["l", 0.3], a2: ["r", 0.5] } }, ends: L.trace!.ends } };
    // Act・Assert
    expect(serializeLayout(other)).toBe(serializeLayout(L));
  });

  it("空の配置も、読み直せる形で書く（境界値）", () => {
    // Arrange・Act
    const text = serializeLayout({});
    // Assert
    expect(parseLayoutFile(text)).toEqual({ layout: {}, error: null });
  });
});

describe("parseLayoutFile（ADR-0005）", () => {
  it("書いたものを読み直すと、同じ配置に戻る（空のビューを除く）", () => {
    // Arrange
    const text = serializeLayout(L);
    // Act
    const r = parseLayoutFile(text);
    // Assert
    expect(r.error).toBeNull();
    expect(r.layout).toEqual({ trace: L.trace });
  });

  it("空のファイルは、空の配置として読む（境界値）", () => {
    // Arrange・Act・Assert
    expect(parseLayoutFile("  \n")).toEqual({ layout: {}, error: null });
  });

  it.each([
    ["{ broken", "配置ファイルを読めません（JSON の形が壊れています）"],
    ['{"views":{}}', "配置ファイルの形が違います"],
    ['{"modelith":"layout","format":2,"views":{}}', "配置ファイルの形式（2）に対応していません"],
  ])("読めない内容（%s）は、理由を添えて空の配置にする（異常系）", (text, error) => {
    // Arrange・Act
    const r = parseLayoutFile(text);
    // Assert
    expect(r).toEqual({ layout: {}, error });
  });
});

describe("isEmptyLayout", () => {
  it("座標・接続点・線の端のどれかがあれば空ではない", () => {
    // Arrange・Act・Assert
    expect(isEmptyLayout({})).toBe(true);
    expect(isEmptyLayout({ v: { pos: {}, pins: {}, ends: {} } })).toBe(true);
    expect(isEmptyLayout(L)).toBe(false);
  });
});
