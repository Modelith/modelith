import { describe, expect, it } from "vitest";
import { parse } from "../core";
import { exposesOnlyFor, plainQualifiedName, qualifiedName, sysmlName, viewDeclaration } from "./view-text";

const entry = (text: string, name: string) => {
  const e = parse(text).entries.find((x) => x.name === name);
  if (!e) throw new Error(`見つかりません: ${name}`);
  return e;
};

describe("sysmlName（8.2.2.1 基本名・引用名）", () => {
  it("基本名に使える名前はそのまま書く", () => {
    // Arrange・Act
    const n = sysmlName("Kettle_1");
    // Assert
    expect(n).toBe("Kettle_1");
  });

  it("日本語・空白・予約語は引用名にする", () => {
    // Arrange・Act
    const ns = ["全体図", "my view", "part"].map(sysmlName);
    // Assert
    expect(ns).toEqual(["'全体図'", "'my view'", "'part'"]);
  });

  it("引用符は \\' と書く（境界値）", () => {
    // Arrange・Act
    const n = sysmlName("it's");
    // Assert
    expect(n).toBe("'it\\'s'");
  });
});

describe("qualifiedName", () => {
  it("親の package の名前をたどって P::Q::A と書く", () => {
    // Arrange
    const a = entry("package P { package Q { part def A; } }", "A");
    // Act・Assert
    expect(qualifiedName(a)).toBe("P::Q::A");
    expect(plainQualifiedName(a)).toBe("P::Q::A");
  });

  it("引用名の要素は、書くときだけ引用符を付ける", () => {
    // Arrange
    const a = entry("package P { part def '電気 ケトル'; }", "電気 ケトル");
    // Act・Assert
    expect(qualifiedName(a)).toBe("P::'電気 ケトル'");
    expect(plainQualifiedName(a)).toBe("P::電気 ケトル");
  });
});

describe("viewDeclaration（F-VIEW-8）", () => {
  it("要素を 1 つずつ expose する view を、字下げをそろえて書く", () => {
    // Arrange
    const text = "package P { part def A; requirement def R; }";
    const targets = [entry(text, "A"), entry(text, "R")];
    // Act
    const d = viewDeclaration("全体", "general", targets, "    ");
    // Assert
    expect(d).toBe("view '全体' : GeneralView {\n        expose P::A;\n        expose P::R;\n    }");
  });

  it("書いた view を読むと、同じ要素を同じ描き方で出す（往復）", () => {
    // Arrange
    const base = "package P {\n    part def A;\n    part def B;\n";
    const decl = viewDeclaration("v", "interconnection", [entry(base + "}", "A")], "    ");
    // Act
    const v = parse(base + "    " + decl + "\n}\n").entries.find((e) => e.kind === "view");
    // Assert
    expect(v?.type).toBe("InterconnectionView");
    expect(v?.exposes?.map((x) => x.target)).toEqual(["P::A"]);
  });

  it("要素が無ければ、expose の無い view を書く（境界値）", () => {
    // Arrange・Act
    const d = viewDeclaration("v", "sequence", [], "");
    // Assert
    expect(d).toBe("view v : SequenceView {\n}");
  });
});

describe("exposesOnlyFor（図から外す）", () => {
  it("その要素だけを出している expose を返し、中身をまとめて出す expose は返さない", () => {
    // Arrange
    const text = "package P { part def A; part def B; view v { expose P::A; expose P::*; expose P::B; } }";
    const view = entry(text, "v");
    // Act
    const forA = exposesOnlyFor(view, entry(text, "A"));
    // Assert
    expect(forA.map((x) => x.target)).toEqual(["P::A"]);
  });

  it("まとめてしか出していない要素には、外せる expose が無い（異常系）", () => {
    // Arrange
    const text = "package P { part def A; view v { expose P::*; } }";
    // Act
    const forA = exposesOnlyFor(entry(text, "v"), entry(text, "A"));
    // Assert
    expect(forA).toEqual([]);
  });
});
