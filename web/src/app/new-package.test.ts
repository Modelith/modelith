import { describe, expect, it } from "vitest";
import { appendPackage, isPackageName, packageNameFor } from "./new-package";

describe("packageNameFor（F-EDIT-7）", () => {
  it.each([
    ["untitled-1.sysml", "Untitled1"],
    ["electric_kettle.sysml", "ElectricKettle"],
    ["model.kerml", "Model"],
    ["MyModel.sysml", "MyModel"],
  ])("%s → %s", (file, name) => {
    // Arrange・Act・Assert
    expect(packageNameFor(file)).toBe(name);
  });

  it.each([["設計.sysml"], ["1st.sysml"], [".sysml"]])("名前に使える文字が無い・数字で始まる（%s）なら Model（境界値）", (file) => {
    // Arrange・Act・Assert
    expect(packageNameFor(file)).toBe("Model");
  });
});

describe("isPackageName", () => {
  it("英字か _ で始まる英数字だけを名前として認める", () => {
    // Arrange・Act
    const r = ["Kettle", "_k2", "2k", "my-pkg", "パッケージ", ""].map(isPackageName);
    // Assert
    expect(r).toEqual([true, true, false, false, false, false]);
  });
});

describe("appendPackage（F-EDIT-7）", () => {
  it("空のテキストには package だけを書く", () => {
    // Arrange・Act
    const r = appendPackage("", "Untitled1");
    // Assert
    expect(r.text).toBe("package Untitled1 {\n}\n");
    expect(r.pkg.name).toBe("Untitled1");
    expect([r.at, r.len]).toEqual([0, "package Untitled1 {\n}\n".length]);
  });

  it("コメントだけのテキストでは、その後ろに 1 行空けて足す", () => {
    // Arrange・Act
    const r = appendPackage("// メモ\n\n", "M");
    // Assert
    expect(r.text).toBe("// メモ\n\npackage M {\n}\n");
  });

  it("配置の @layout コメントがあれば、その前に足す", () => {
    // Arrange
    const text = "// メモ\n\n/* @layout {} */\n";
    // Act
    const r = appendPackage(text, "M");
    // Assert
    expect(r.text).toBe("// メモ\n\npackage M {\n}\n\n/* @layout {} */\n");
  });

  it("名前に使えない文字なら、テキストを変えずに失敗する（異常系）", () => {
    // Arrange・Act・Assert
    expect(() => appendPackage("", "my pkg")).toThrow(/使えません/);
  });
});
