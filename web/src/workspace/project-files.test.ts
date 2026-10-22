// プロジェクトのファイルの計算（ADR-0021、F-FILE-15）。
import { describe, expect, it } from "vitest";
import type { DirEntry, FileRef } from "../files/types";
import { filesChange, modelFiles, projectTexts } from "./project-files";

const ref = (path: string): FileRef => ({ provider: "local", id: `dir:1/${path}`, name: path.split("/").pop() ?? path, path });

describe("project-files（F-FILE-15）", () => {
  it("modelFiles は入れ子のフォルダまで .sysml と .kerml を並べ、ほかの拡張子は入れない", () => {
    // Arrange
    const entries: DirEntry[] = [
      { kind: "file", ref: ref("a.sysml") },
      { kind: "dir", name: "lib", path: "lib", children: [{ kind: "file", ref: ref("lib/b.KERML") }, { kind: "file", ref: ref("lib/c.layout.json") }] },
      { kind: "file", ref: ref("notes.md") },
    ];
    // Act
    const got = modelFiles(entries).map((r) => r.path);
    // Assert
    expect(got).toEqual(["a.sysml", "lib/b.KERML"]);
  });

  it("projectTexts は開いている文書のテキストを優先し、読めなかったファイルは入れない", () => {
    // Arrange
    const a = ref("a.sysml");
    const b = ref("b.sysml");
    const c = ref("c.sysml");
    // Act
    const got = projectTexts([a, b, c], new Map([["a.sysml", "A0"], ["b.sysml", "B0"]]), [{ ref: a, text: "A1" }, { ref: null, text: "無題" }]);
    // Assert
    expect(got).toEqual(new Map([["a.sysml", "A1"], ["b.sysml", "B0"]]));
  });

  it("filesChange は変わった・増えたファイルを覚え直し、無くなったファイルを忘れる", () => {
    // Arrange
    const prev = new Map([["a", "1"], ["b", "2"], ["d", "9"]]);
    const next = new Map([["a", "1"], ["b", "3"], ["c", "4"]]);
    // Act
    const got = filesChange(prev, next);
    // Assert
    expect(got).toEqual({ set: [{ path: "b", text: "3" }, { path: "c", text: "4" }], remove: ["d"] });
  });

  it("filesChange は同じなら何も送らない（境界値）", () => {
    // Arrange・Act
    const got = filesChange(new Map([["a", "1"]]), new Map([["a", "1"]]));
    // Assert
    expect(got).toEqual({ set: [], remove: [] });
  });
});
