// 図のエクスポートの形式の一覧とファイル名の決め方（F-EXP-1・F-EXP-2）の単体テスト。
import { describe, expect, it } from "vitest";
import { EXPORT_FORMATS, exportFileName, exportFormat } from "./export-file";

const SVG = exportFormat("svg");
const DRAWIO = exportFormat("drawio");
/** 既定の名前（表示中の図の名前）。 */
const VIEW = "トレーサビリティ";

describe("EXPORT_FORMATS・exportFormat（形式の一覧）", () => {
  it("SVG 画像と draw.io を、この順に選べる（先頭が既定）", () => {
    // Act
    const shown = EXPORT_FORMATS.map((f) => [f.id, f.label, f.extension, f.mediaType]);
    // Assert
    expect(shown).toEqual([
      ["svg", "SVG 画像（.svg）", ".svg", "image/svg+xml"],
      ["drawio", "draw.io（.drawio）", ".drawio", "application/vnd.jgraph.mxfile"],
    ]);
  });

  it("ID で形式を引ける（正常系）", () => {
    // Act
    const f = exportFormat("drawio");
    // Assert
    expect(f.extension).toBe(".drawio");
  });

  it.each([["png"], [""]])("知らない ID（%j）は既定の SVG 画像にする（異常系）", (id) => {
    // Act
    const f = exportFormat(id);
    // Assert
    expect(f.id).toBe("svg");
  });
});

describe("exportFileName（ファイル名と拡張子）", () => {
  it("拡張子の無い名前には、形式の拡張子を付ける（正常系）", () => {
    // Act
    const name = exportFileName("給水システム", DRAWIO, VIEW);
    // Assert
    expect(name).toBe("給水システム.drawio");
  });

  it("同じ形式の拡張子は、重ねて付けない", () => {
    // Act
    const name = exportFileName("給水システム.svg", SVG, VIEW);
    // Assert
    expect(name).toBe("給水システム.svg");
  });

  it.each([
    ["給水システム.svg", DRAWIO, "給水システム.drawio"],
    ["給水システム.drawio", SVG, "給水システム.svg"],
    ["給水システム.DrawIO", SVG, "給水システム.svg"],
  ])("違う形式の拡張子は、選んだ形式のものに付け替える（%s）", (input, format, expected) => {
    // Act
    const name = exportFileName(input, format, VIEW);
    // Assert
    expect(name).toBe(expected);
  });

  it("大文字の同じ拡張子は、小文字にそろえる", () => {
    // Act
    const name = exportFileName("給水システム.SVG", SVG, VIEW);
    // Assert
    expect(name).toBe("給水システム.svg");
  });

  it.each([
    ["v1.2", "v1.2.svg"],
    ["図.png", "図.png.svg"],
  ])("形式の拡張子でない点（%s）は、名前の一部として残す", (input, expected) => {
    // Act
    const name = exportFileName(input, SVG, VIEW);
    // Assert
    expect(name).toBe(expected);
  });

  it.each([[""], ["   "], [".svg"], ["dir/"]])("名前が何も残らない入力（%j）は、表示中の図の名前にする（境界値）", (input) => {
    // Act
    const name = exportFileName(input, SVG, VIEW);
    // Assert
    expect(name).toBe("トレーサビリティ.svg");
  });

  it("前後の空白は除く", () => {
    // Act
    const name = exportFileName("  給水システム  ", SVG, VIEW);
    // Assert
    expect(name).toBe("給水システム.svg");
  });

  it.each([
    ["図/給水システム", "給水システム.svg"],
    ["C:\\図\\給水システム.drawio", "給水システム.svg"],
    ["../給水システム", "給水システム.svg"],
  ])("パス区切りを含む名前（%s）は、最後の名前だけを使う", (input, expected) => {
    // Act
    const name = exportFileName(input, SVG, VIEW);
    // Assert
    expect(name).toBe(expected);
  });

  it("ファイル名に使えない文字は「_」にする（異常系）", () => {
    // Act
    const name = exportFileName('給水:システム?"*<>|', SVG, VIEW);
    // Assert
    expect(name).toBe("給水_システム______.svg");
  });

  it("末尾の点は除いてから、拡張子を付け替える", () => {
    // Act
    const name = exportFileName("給水システム.svg.", DRAWIO, VIEW);
    // Assert
    expect(name).toBe("給水システム.drawio");
  });

  it("表示中の図の名前も、パスの部分を除いて使う", () => {
    // Act
    const name = exportFileName("", SVG, "ibd 給水/排水");
    // Assert
    expect(name).toBe("排水.svg");
  });

  it("入力も表示中の図の名前も空なら、「図」にする（境界値）", () => {
    // Act
    const name = exportFileName("", DRAWIO, "");
    // Assert
    expect(name).toBe("図.drawio");
  });
});
