import { describe, expect, it } from "vitest";
import { BrowserFileProvider, type BrowserFileIo, type PickedFile } from "./browser-file";
import { isWritable } from "./types";

function setup(picked: PickedFile[] = []) {
  const downloads: { name: string; text: string }[] = [];
  const io: BrowserFileIo = { choose: async () => picked, download: (name, text) => downloads.push({ name, text }) };
  return { p: new BrowserFileProvider(io), downloads };
}

describe("BrowserFileProvider（F-FILE-10）", () => {
  it("選んだファイルを読める", async () => {
    // Arrange
    const { p } = setup([{ name: "m.sysml", text: async () => "package M;" }]);
    // Act
    const ref = await p.pickFile();
    // Assert
    expect(ref?.name).toBe("m.sysml");
    expect((await p.read(ref!)).text).toBe("package M;");
  });

  it("選ばなければ null（異常系: キャンセル）", async () => {
    // Arrange
    const { p } = setup([]);
    // Act
    const ref = await p.pickFile();
    // Assert
    expect(ref).toBeNull();
  });

  it("保存はダウンロードになり、その内容を読み直せる", async () => {
    // Arrange
    const { p, downloads } = setup();
    // Act
    const r = await p.saveAs("out.sysml", "text");
    // Assert
    expect(downloads).toEqual([{ name: "out.sysml", text: "text" }]);
    expect((await p.read(r.ref)).text).toBe("text");
  });

  it("上書きはできない（Writable ではない）", () => {
    // Arrange
    const { p } = setup();
    // Act
    const writable = isWritable(p);
    // Assert
    expect(writable).toBe(false);
  });
});

describe("BrowserFileProvider: 配置ファイル（ADR-0005、F-VIEW-6）", () => {
  it("モデルと配置ファイルを一緒に選ぶと、モデルを開き、配置ファイルを隣のファイルとして読める", async () => {
    // Arrange
    const { p } = setup([
      { name: "m.layout.json", text: async () => "L" },
      { name: "m.sysml", text: async () => "package M;" },
    ]);
    // Act
    const ref = await p.pickFile();
    // Assert
    expect(ref?.name).toBe("m.sysml");
    expect(await p.readSibling(ref!, "m.layout.json")).toBe("L");
  });

  it("モデルだけを選んだら、隣のファイルは無い（境界値）", async () => {
    // Arrange
    const { p } = setup([{ name: "m.sysml", text: async () => "" }]);
    // Act
    const ref = await p.pickFile();
    // Assert
    expect(await p.readSibling(ref!, "m.layout.json")).toBeNull();
  });

  it("隣のファイルへの書き込みはダウンロードになり、その内容を読み直せる", async () => {
    // Arrange
    const { p, downloads } = setup();
    const { ref } = await p.saveAs("m.sysml", "package M;");
    // Act
    await p.writeSibling(ref, "m.layout.json", "L2");
    // Assert
    expect(downloads.map((d) => d.name)).toEqual(["m.sysml", "m.layout.json"]);
    expect(await p.readSibling(ref, "m.layout.json")).toBe("L2");
  });
});
