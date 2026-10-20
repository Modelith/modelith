// draw.io への書き出しの線の形（F-EXP-2）。
import { describe, expect, it } from "vitest";
import { drawioEdgeStyle } from "./export";

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

  it("結び付けは矢印の無い実線にする", () => {
    // Act
    const style = drawioEdgeStyle("bind");
    // Assert
    expect(style).toBe("endArrow=none;");
  });

  it.each([["derive"], ["allocate"]])("ほかの関係（%s）は破線と開いた矢印にする", (kind) => {
    // Act
    const style = drawioEdgeStyle(kind);
    // Assert
    expect(style).toBe("dashed=1;endArrow=open;");
  });
});
