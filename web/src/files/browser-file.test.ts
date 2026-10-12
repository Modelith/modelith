import { describe, expect, it } from "vitest";
import { BrowserFileProvider, type BrowserFileIo, type PickedFile } from "./browser-file";
import { isWritable } from "./types";

function setup(picked: PickedFile | null = null) {
  const downloads: { name: string; text: string }[] = [];
  const io: BrowserFileIo = { choose: async () => picked, download: (name, text) => downloads.push({ name, text }) };
  return { p: new BrowserFileProvider(io), downloads };
}

describe("BrowserFileProvider（F-FILE-10）", () => {
  it("選んだファイルを読める", async () => {
    // Arrange
    const { p } = setup({ name: "m.sysml", text: async () => "package M;" });
    // Act
    const ref = await p.pickFile();
    // Assert
    expect(ref?.name).toBe("m.sysml");
    expect((await p.read(ref!)).text).toBe("package M;");
  });

  it("選ばなければ null（異常系: キャンセル）", async () => {
    // Arrange
    const { p } = setup(null);
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
