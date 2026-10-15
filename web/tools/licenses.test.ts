import { describe, expect, it } from "vitest";
import { appLicense, chooseLicenses, thirdPartyNotices, viteCoreLicense, wasmRuntimeCrates, type CargoMetadata, type CargoPackage } from "./licenses";

describe("viteCoreLicense", () => {
  it("Vite 本体の MIT の部分だけを取り出し、同梱依存の一覧は除く", () => {
    // Arrange
    const md = "# Vite core license\nMIT License\n\nCopyright (c) Vite\n\n# Licenses of bundled dependencies\nApache-2.0, ISC\n";
    // Act
    const core = viteCoreLicense(md);
    // Assert
    expect(core).toBe("# Vite core license\nMIT License\n\nCopyright (c) Vite");
  });

  it("形式が変わって切り出せなければ、黙って続けずに失敗する（異常系）", () => {
    // Arrange
    const md = "MIT License\n";
    // Act・Assert
    expect(() => viteCoreLicense(md)).toThrow(/形式が変わった/);
  });
});

describe("thirdPartyNotices", () => {
  it("同梱物の一覧と、それぞれのライセンス全文を並べる", () => {
    // Arrange
    const parts = [
      { name: "font-a", license: "OFL-1.1", usage: "画面の文字", text: "OFL TEXT\n" },
      { name: "vite", license: "MIT", usage: "読み込みのコード", text: "MIT TEXT" },
    ];
    // Act
    const out = thirdPartyNotices(parts);
    // Assert
    expect(out).toContain("- font-a（OFL-1.1）：画面の文字\n- vite（MIT）：読み込みのコード");
    expect(out).toContain("==== font-a（OFL-1.1） ====\n\nOFL TEXT\n\n==== vite（MIT） ====\n\nMIT TEXT\n");
  });
});

describe("appLicense", () => {
  it("著作権表示、AGPL の全文、プラグイン例外の順に並べる", () => {
    // Arrange・Act
    const out = appLicense("Copyright (C) 2026 X", "AGPL\n", "EXCEPTION\n");
    // Assert
    expect(out.startsWith("Copyright (C) 2026 X\n")).toBe(true);
    expect(out.indexOf("AGPL")).toBeLessThan(out.indexOf("EXCEPTION"));
  });
});

describe("wasmRuntimeCrates", () => {
  const pkg = (name: string, kinds = ["lib"], source: string | null = "registry"): CargoPackage => ({
    id: name, name, version: "1.0.0", license: "MIT", source, manifest_path: `/r/${name}/Cargo.toml`, targets: [{ kind: kinds }],
  });
  const dep = (pkg: string, kind: string | null = null) => ({ pkg, dep_kinds: [{ kind }] });

  it("通常の依存をたどり、手続きマクロ・ビルド用の依存・Modelith 自身のクレートは除く", () => {
    // Arrange
    const meta: CargoMetadata = {
      packages: [pkg("root", ["cdylib"], null), pkg("core", ["lib"], null), pkg("rowan"), pkg("hashbrown"), pkg("derive", ["proc-macro"]), pkg("syn"), pkg("cc")],
      resolve: {
        nodes: [
          { id: "root", deps: [dep("core"), dep("cc", "build")] },
          { id: "core", deps: [dep("rowan"), dep("derive")] },
          { id: "rowan", deps: [dep("hashbrown")] },
          { id: "derive", deps: [dep("syn")] },
        ],
      },
    };
    // Act
    const names = wasmRuntimeCrates(meta, "root").map((p) => p.name);
    // Assert
    expect(names).toEqual(["hashbrown", "rowan"]);
  });

  it("起点のクレートが無ければ失敗する（異常系）", () => {
    // Arrange
    const meta: CargoMetadata = { packages: [], resolve: { nodes: [] } };
    // Act・Assert
    expect(() => wasmRuntimeCrates(meta, "root")).toThrow(/root/);
  });
});

describe("chooseLicenses", () => {
  it.each([
    ["MIT OR Apache-2.0", ["MIT"]],
    ["Apache-2.0/MIT", ["MIT"]],
    ["Unlicense OR MIT", ["MIT"]],
    ["MIT", ["MIT"]],
    ["(MIT OR Apache-2.0) AND Unicode-3.0", ["MIT", "Unicode-3.0"]],
    ["Apache-2.0", ["Apache-2.0"]],
  ])("%s → %j", (spdx, expected) => {
    // Act・Assert
    expect(chooseLicenses(spdx)).toEqual(expected);
  });
});
