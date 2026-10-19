// plugin-sdk の型のコピー（plugin-protocol.ts）の単体テスト。
import { describe, expect, it } from "vitest";
import { copyText, generatedTsPath, protocolCrate } from "./plugin-protocol";

const CRATE = {
  id: "x",
  name: "modelith-plugin-protocol",
  version: "0.1.0",
  license: "MIT",
  source: "git+https://github.com/modelith/plugin-sdk?rev=9fb8f90#9fb8f90",
  manifest_path: "C:\\c\\git\\checkouts\\plugin-sdk-1\\9fb8f90\\crates\\modelith-plugin-protocol\\Cargo.toml",
  targets: [],
};

describe("protocolCrate", () => {
  it("契約のクレートの場所を / 区切りにして返す（Windows のパスも）", () => {
    // Arrange
    const meta = { packages: [{ ...CRATE, name: "serde" }, CRATE] };
    // Act
    const got = protocolCrate(meta);
    // Assert
    expect(got).toEqual({ manifestPath: "C:/c/git/checkouts/plugin-sdk-1/9fb8f90/crates/modelith-plugin-protocol/Cargo.toml", source: CRATE.source });
  });

  it("依存に無ければ null を返す（異常系）", () => {
    // Arrange
    const meta = { packages: [] };
    // Act
    const got = protocolCrate(meta);
    // Assert
    expect(got).toBeNull();
  });
});

describe("generatedTsPath", () => {
  it("同じリポジトリの TypeScript の生成物の場所を返す", () => {
    // Arrange
    const manifest = "/c/sdk/crates/modelith-plugin-protocol/Cargo.toml";
    // Act
    const got = generatedTsPath(manifest);
    // Assert
    expect(got).toBe("/c/sdk/packages/typescript/src/generated/protocol.ts");
  });

  it("plugin-sdk の形でなければ null を返す（異常系）", () => {
    // Arrange
    const manifest = "/c/other/Cargo.toml";
    // Act
    const got = generatedTsPath(manifest);
    // Assert
    expect(got).toBeNull();
  });
});

describe("copyText", () => {
  it("取得元と更新のしかたを書いてから、生成物をそのまま続ける", () => {
    // Arrange
    const generated = "export type A = string;\n";
    // Act
    const got = copyText(CRATE.source, generated);
    // Assert
    expect(got.split("\n").slice(0, 2)).toEqual(["// plugin-sdk の packages/typescript/src/generated/protocol.ts のコピー。編集しないこと。", `// 取得元: ${CRATE.source}`]);
    expect(got.endsWith("\n\nexport type A = string;\n")).toBe(true);
  });
});
