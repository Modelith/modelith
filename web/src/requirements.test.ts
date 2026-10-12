// 要求仕様（docs/reference/requirements.sysml、ADR-0011）が SSoT として成り立っていることを確かめる。
// 書き方の誤り・ID の重複・導出や充足の抜けを、要求を変えたその PR で検出する。
import { describe, expect, it } from "vitest";
import SPEC from "../../docs/reference/requirements.sysml?raw";
import { build, parse } from "./core";

const P = parse(SPEC);
const M = build(P);
const reqDefs = P.entries.filter((e) => e.kind === "requirement def");

describe("要求仕様（requirements.sysml）", () => {
  it("構文エラーや参照切れがない", () => {
    // Arrange
    const problems = M.problems.filter((p) => p.kind !== "gap");
    // Act
    const msgs = problems.map((p) => p.msg);
    // Assert
    expect(msgs).toEqual([]);
  });

  it("すべての要求に ID（短い名前）と説明（doc）がある", () => {
    // Arrange
    const incomplete = reqDefs.filter((e) => !e.short || !e.doc);
    // Act
    const names = incomplete.map((e) => e.name);
    // Assert
    expect(names).toEqual([]);
  });

  it("要求の ID が重複していない", () => {
    // Arrange
    const ids = reqDefs.map((e) => e.short);
    // Act
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    // Assert
    expect(dup).toEqual([]);
  });

  it("利用者要求はどれもシステム要求に展開され、システム要求はどれも導出元と充足する部品を持つ", () => {
    // Arrange（verify の抜けは「未実装・未検証」を表すので許す）
    const gaps = M.problems.filter((p) => p.kind === "gap");
    // Act
    const structural = gaps.filter((p) => !p.msg.includes("（verify）")).map((p) => p.msg);
    // Assert
    expect(structural).toEqual([]);
  });
});
