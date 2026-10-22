// 作成する図の種類と、図の名前の変更・削除の判断（F-VIEW-8・F-VIEW-11）。
import { describe, expect, it } from "vitest";
import type { ModelNode } from "../core";
import { emptyView, type Layout } from "./layout";
import type { Tab } from "./state";
import { DIAGRAM_KINDS, renameViewLayout, renameViewTabs, targetCandidates } from "./diagram-kinds";

const node = (name: string, kind: string, extra: Partial<ModelNode> = {}): ModelNode => ({ key: name, name, kind, isDef: true, ...extra }) as ModelNode;

describe("DIAGRAM_KINDS（作成できる図の種類）", () => {
  it("一般の図は対象を選ばず、ほかの 4 つは対象の定義の種類を持つ（正常系）", () => {
    // Act
    const defs = Object.fromEntries(DIAGRAM_KINDS.map((k) => [k.id, k.def?.kind ?? null]));
    // Assert
    expect(defs).toEqual({ general: null, interconnection: "part def", actionFlow: "action def", stateTransition: "state def", sequence: "occurrence def" });
  });
});

describe("targetCandidates（図に描ける対象）", () => {
  it("種類の合う定義だけを、名前の順に返す（正常系）", () => {
    // Arrange
    const nodes = [node("ブレーキ", "part def"), node("Engine", "part def"), node("R1", "requirement def"), node("engine", "part usage", { isDef: false, usage: true })];
    // Act
    const got = targetCandidates(nodes, "part def").map((n) => n.name);
    // Assert
    expect(got).toEqual(["Engine", "ブレーキ"]);
  });

  it("合う定義が無ければ空（境界値）", () => {
    // Act / Assert
    expect(targetCandidates([node("A", "part def")], "action def")).toEqual([]);
    expect(targetCandidates([], "part def")).toEqual([]);
  });
});

describe("renameViewLayout（図の名前を変えたときの配置）", () => {
  it("view:旧 の配置を view:新 に移す（正常系）", () => {
    // Arrange
    const L: Layout = { "view:旧": { ...emptyView(), pos: { A: [10, 20] } }, all: emptyView() };
    // Act
    renameViewLayout(L, "旧", "新");
    // Assert
    expect(Object.keys(L).sort()).toEqual(["all", "view:新"]);
    expect(L["view:新"]?.pos).toEqual({ A: [10, 20] });
  });

  it("配置の無い図なら何も変えない（異常系）", () => {
    // Arrange
    const L: Layout = { all: emptyView() };
    // Act
    renameViewLayout(L, "無い", "新");
    // Assert
    expect(Object.keys(L)).toEqual(["all"]);
  });
});

describe("renameViewTabs（図の名前を変えたときのタブ）", () => {
  it("その図を開いているタブだけ名前を付け替え、数を返す（正常系）", () => {
    // Arrange
    const tabs: Tab[] = [
      { id: 1, view: "all", ctx: null, phase: "", mv: "旧" },
      { id: 2, view: "all", ctx: null, phase: "" },
      { id: 3, view: "ibd", ctx: null, phase: "", mv: "別" },
    ];
    // Act
    const n = renameViewTabs(tabs, "旧", "新");
    // Assert
    expect(n).toBe(1);
    expect(tabs.map((t) => t.mv)).toEqual(["新", undefined, "別"]);
  });
});
