// SysML v2 仕様に合わせるケース（ADR-0013）。期待値はモックではなく仕様から手で書き、根拠の BNF 規則と章を添える。
// 章番号は SysML 2.1 Beta 2（SysML-v2-Release 2026-08）のもの。docs/reference/sysml-conformance.md も参照。
import { describe, expect, it } from "vitest";
import SAMPLE from "../samples/electric-kettle.sysml?raw";
import { build } from "./model";
import { parse } from "./parser";

const entry = (text: string, name: string) => parse(text).entries.find((e) => e.name === name);
const problems = (text: string): string[] => build(parse(text)).problems.map((p) => p.msg);

describe("前置メタデータ（PrefixMetadataMember、8.2.2.27）", () => {
  it("#M を前に付けた宣言も、モデルから消えずに読める", () => {
    // Arrange
    const text = "package P { metadata def M; #M part def A; part def B; }";
    // Act
    const a = entry(text, "A");
    // Assert
    expect(a?.kind).toBe("part def");
    expect(a?.meta?.["M"]).toEqual({});
  });

  it("複数の #M を前に付けられる（境界値）", () => {
    // Arrange
    const text = "package P { metadata def M; metadata def N; #M #N part def A; }";
    // Act
    const a = entry(text, "A");
    // Assert
    expect(Object.keys(a?.meta ?? {})).toEqual(["M", "N"]);
  });

  it("#derivation dependency はこれまでどおり関係として読む（正常系）", () => {
    // Arrange
    const text = "package P { requirement def A; requirement def B; #derivation dependency from B to A; }";
    // Act
    const rels = parse(text).rels.map((r) => r.rel);
    // Assert
    expect(rels).toEqual(["derive"]);
  });
});

describe("部分集合・再定義・参照（Subsets / Redefines / References、8.2.2.6）", () => {
  it("使用の :> は型ではなく部分集合なので、型として探さない", () => {
    // Arrange
    const text = "package P { part def A; part def W { part a : A; part b :> a; } }";
    // Act
    const b = entry(text, "b");
    // Assert
    expect(b?.type).toBe("");
    expect(problems(text)).toEqual([]);
  });

  it.each([["subsets"], ["references"], ["::>"]])("%s も型として扱わない", (op) => {
    // Arrange
    const text = `package P { part def A; part def W { part a : A; part b ${op} a; } }`;
    // Act
    const b = entry(text, "b");
    // Assert
    expect(b?.type).toBe("");
    expect(problems(text)).toEqual([]);
  });

  it("型と部分集合を両方書けば、型だけを型として読む", () => {
    // Arrange
    const text = "package P { part def A; part def B; part def W { part a : A; part b : B :> a; } }";
    // Act
    const b = entry(text, "b");
    // Assert
    expect(b?.type).toBe("B");
    expect(problems(text)).toEqual([]);
  });

  it("名前の無い :>> は、再定義する特徴の名前を名前にする", () => {
    // Arrange
    const text = "package P { part def A { attribute mass; } part def B :> A { attribute :>> mass = 1500; } }";
    // Act
    const e = parse(text).entries.find((x) => x.pe?.name === "B");
    // Assert
    expect(e?.name).toBe("mass");
    expect(e?.type).toBe("");
    expect(e?.value).toBe("1500");
  });

  it("redefines は名前ではなく、再定義のキーワードとして読む", () => {
    // Arrange
    const text = "package P { part def A { attribute x; } part def B :> A { attribute redefines x = 1; } }";
    // Act
    const names = parse(text).entries.map((e) => e.name);
    // Assert
    expect(names).not.toContain("redefines");
    expect(names.filter((n) => n === "x")).toHaveLength(2);
  });

  it("定義の :> は特殊化として、これまでどおり記録する（モックと同じ）", () => {
    // Arrange
    const text = "package P { part def A; part def B :> A; }";
    // Act
    const b = entry(text, "B");
    // Assert
    expect(b?.type).toBe("A");
  });
});

describe("名前（NAME・Identification、8.2.2.1〜2）", () => {
  it("引用名 'Fuel Tank' を名前として読み、型の参照にも使える", () => {
    // Arrange
    const text = "package P { part def 'Fuel Tank'; part def Car { part t : 'Fuel Tank'; } }";
    // Act
    const t = entry(text, "t");
    // Assert
    expect(entry(text, "Fuel Tank")?.kind).toBe("part def");
    expect(t?.type).toBe("Fuel Tank");
    expect(problems(text)).toEqual([]);
  });

  it("引用なしの短い名前 <R1> も読む", () => {
    // Arrange
    const text = "package P { requirement def <R1> Req1; }";
    // Act
    const r = entry(text, "Req1");
    // Assert
    expect(r?.short).toBe("R1");
  });

  it("引用付きの短い名前 <'R-1'> はこれまでどおり読む（正常系）", () => {
    // Arrange
    const text = "package P { requirement def <'R-1'> Req1; }";
    // Act
    const r = entry(text, "Req1");
    // Assert
    expect(r?.short).toBe("R-1");
  });
});

describe("まだ扱えない文（F-EDIT-5・C-6 の趣旨：黙って捨てない）", () => {
  it("知らない文は捨てずに「まだ扱えない」と知らせる", () => {
    // Arrange
    const text = "package P { case def C; part def A; }";
    // Act
    const M = build(parse(text));
    // Assert
    const info = M.problems.filter((p) => p.kind === "unsupported");
    expect(info.map((p) => p.msg)).toEqual(["「case def C」は Modelith ではまだ扱えないため、図とツリーに出ません"]);
  });

  it("まだ扱えない文は、エラーとして数えない", () => {
    // Arrange
    const text = "package P { case def C; }";
    // Act
    const errors = build(parse(text)).problems.filter((p) => !p.kind);
    // Assert
    expect(errors).toEqual([]);
  });

  it("式や、扱いを決めて読み飛ばしている文（import・doc など）は知らせない", () => {
    // Arrange
    const text = "package P { private import ISQ::*; constraint def C { in x : Real; x >= 0 } }";
    // Act
    const info = build(parse(text)).problems.filter((p) => p.kind === "unsupported");
    // Assert
    expect(info).toEqual([]);
  });

  it("公開サンプルには、まだ扱えない文が無い", () => {
    // Arrange・Act
    const info = build(parse(SAMPLE)).problems.filter((p) => p.kind === "unsupported");
    // Assert
    expect(info).toEqual([]);
  });
});
