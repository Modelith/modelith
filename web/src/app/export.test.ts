// draw.io への書き出しの線の形（F-EXP-2）。
import { describe, expect, it } from "vitest";
import { build, parse } from "../core";
import { flowContentOf } from "./action-flow";
import { drawioEdgeStyle, drawioFlowCell, drawioStateCell } from "./export";
import { stateContentOf } from "./state-machine";

describe("drawioEdgeStyle（F-EXP-2）", () => {
  it.each([["specialize"], ["subset"], ["redefine"], ["reference"]])("%s は白抜きの三角の実線にする", (kind) => {
    // Act
    const style = drawioEdgeStyle(kind);
    // Assert
    expect(style).toBe("endArrow=block;endFill=0;");
  });

  it("部品として持つ線と流れは、これまでどおり", () => {
    // Act
    const [comp, flow] = [drawioEdgeStyle("comp"), drawioEdgeStyle("flow")];
    // Assert
    expect(comp).toBe("startArrow=diamondThin;startFill=1;endArrow=none;");
    expect(flow).toBe("endArrow=block;endFill=1;strokeWidth=2;");
  });

  it.each([["bind"], ["connect"]])("結び付けと n 項の接続の線（%s）は矢印の無い実線にする", (kind) => {
    // Act
    const style = drawioEdgeStyle(kind);
    // Assert
    expect(style).toBe("endArrow=none;");
  });

  it("メモから要素への線（annotate）は矢印の無い破線にする（8.2.3.4 の annotation-link）", () => {
    // Act
    const style = drawioEdgeStyle("annotate");
    // Assert
    expect(style).toBe("dashed=1;endArrow=none;");
  });

  it.each([["derive"], ["allocate"]])("ほかの関係（%s）は破線と開いた矢印にする", (kind) => {
    // Act
    const style = drawioEdgeStyle(kind);
    // Assert
    expect(style).toBe("dashed=1;endArrow=open;");
  });
});

describe("アクションの流れの図の書き出し（F-EXP-2、8.2.3.17）", () => {
  it("順序は実線と開いた矢印、順序付きの流れは破線と開いた矢印にする", () => {
    // Act
    const [succession, flow] = [drawioEdgeStyle("succession"), drawioEdgeStyle("successionFlow")];
    // Assert
    expect(succession).toBe("endArrow=open;");
    expect(flow).toBe("dashed=1;endArrow=open;");
  });

  it("開始・終了・棒・ひし形・送信・アクションを、記号ごとの図形にする", () => {
    // Arrange
    const M = build(parse("package P { action def A { first start; then fork f; then decide d; then send S() to b; then action a; then done; } }"));
    const ctx = M.nodes.find((n) => n.key === "A");
    if (!ctx) throw new Error("A がありません");
    // Act
    const cells = flowContentOf(M, ctx).nodes.map(drawioFlowCell);
    // Assert
    expect(cells.map((c) => c.style.split(";")[0])).toEqual(["ellipse", "html=1", "rhombus", "shape=mxgraph.sysml.sendSigAct", "rounded=1", "ellipse"]);
    expect(cells[5]?.style).toContain("shape=endState;");
    expect(cells.map((c) => c.value)).toEqual(["", "f", "d", "«send»<br>S() to b", "<b>a</b>", ""]);
  });
});

describe("状態遷移の図の書き出し（F-EXP-2、8.2.3.18）", () => {
  it("遷移は実線と開いた矢印にする", () => {
    // Act
    const style = drawioEdgeStyle("transition");
    // Assert
    expect(style).toBe("endArrow=open;");
  });

  it("開始・状態・終了を、記号ごとの図形にし、状態には entry・do・exit の振る舞いを書く", () => {
    // Arrange
    const M = build(parse("package P { state def S { entry; then on; state on { entry action init; } transition first on then done; } }"));
    const ctx = M.nodes.find((n) => n.key === "S");
    if (!ctx) throw new Error("S がありません");
    // Act
    const cells = stateContentOf(M, ctx).nodes.map(drawioStateCell);
    // Assert
    expect(cells.map((c) => c.style.split(";")[0])).toEqual(["ellipse", "rounded=1", "ellipse"]);
    expect(cells[2]?.style).toContain("shape=endState;");
    expect(cells.map((c) => c.value)).toEqual(["", '<b>on</b><hr><div style="text-align:left;font-size:10px">entry / init</div>', ""]);
  });
});
