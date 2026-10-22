import { describe, expect, it } from "vitest";
import { isPackageName, packageNameFor } from "./new-package";

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
