// 画面に出す名前（ADR-0014、docs/development/ui-writing.md）。
import { describe, expect, it } from "vitest";
import { stdViewLabel } from "../core";
import { diagramName, savedViewHint, tabTitle, v2ViewNote, viewHint } from "./labels";
import { VIEWS } from "./views";

describe("diagramName（ビューの名前を「〜の図」と呼べる形にする）", () => {
  it("「図」で終わらない名前には「の図」を付ける", () => {
    // Arrange
    const label = "トレーサビリティ";
    // Act
    const name = diagramName(label);
    // Assert
    expect(name).toBe("トレーサビリティの図");
  });

  it("「図」で終わる名前はそのまま返す（「ブロック定義図の図」にしない）", () => {
    // Arrange
    const label = "ブロック定義図";
    // Act
    const name = diagramName(label);
    // Assert
    expect(name).toBe("ブロック定義図");
  });

  it("「図」が途中にあるだけなら「の図」を付ける（境界値）", () => {
    // Arrange
    const label = "図面";
    // Act
    const name = diagramName(label);
    // Assert
    expect(name).toBe("図面の図");
  });
});

describe("stdViewLabel（標準ビューの、広く知られた名前。ui-writing の決まり 9）", () => {
  const cases: [string, string][] = [
    ["GeneralView", "一般ビュー"],
    ["InterconnectionView", "内部ブロック図"],
    ["StateTransitionView", "状態遷移図"],
    ["SequenceView", "シーケンス図"],
    ["ActionFlowView", "アクティビティ図"],
    ["GeometryView", "ジオメトリビュー"],
    ["GridView", "グリッドビュー"],
    ["BrowserView", "ブラウザビュー"],
  ];
  for (const [std, label] of cases) {
    it(`${std} は「${label}」と呼ぶ`, () => {
      // Arrange（標準ビュー定義ごとの同値クラス）
      const name = std;
      // Act
      const shown = stdViewLabel(name);
      // Assert
      expect(shown).toBe(label);
    });
  }

  it("型の無い図は「一般ビュー」と呼ぶ（null）", () => {
    // Arrange
    const std = null;
    // Act
    const shown = stdViewLabel(std);
    // Assert
    expect(shown).toBe("一般ビュー");
  });
});

describe("v2ViewNote・viewHint（SysML v2 の標準ビューの補足）", () => {
  it("画面の名前が標準ビューの名前と同じなら、標準ビューの名前だけを添える", () => {
    // Arrange
    const [label, std] = ["アクティビティ図", "ActionFlowView"];
    // Act
    const hint = viewHint(label, std);
    // Assert
    expect(hint).toBe("アクティビティ図（SysML v2 では ActionFlowView）");
  });

  it("Modelith 独自の図は「〜で描く図」と添える", () => {
    // Arrange
    const [label, std] = ["トレーサビリティ", "GeneralView"];
    // Act
    const note = v2ViewNote(label, std);
    // Assert
    expect(note).toBe("SysML v2 では GeneralView で描く図");
  });

  it("表に無い標準ビューの名前でも、名前をそのまま添える（異常系）", () => {
    // Arrange（stdViewLabel は知らない名前をそのまま返すので、同じ名前とみなす）
    const [label, std] = ["MyView", "MyView"];
    // Act
    const hint = viewHint(label, std);
    // Assert
    expect(hint).toBe("MyView（SysML v2 では MyView）");
  });

  it("8 つの自動の図のツールチップは、当たる標準ビューを添える", () => {
    // Arrange
    const views = VIEWS;
    // Act
    const hints = views.map((v) => viewHint(v.label, v.std));
    // Assert
    expect(hints).toEqual([
      "トレーサビリティ（SysML v2 では GeneralView で描く図）",
      "ブロック定義図（SysML v2 では GeneralView で描く図）",
      "制御ループ（SysML v2 では GeneralView で描く図）",
      "内部ブロック図（SysML v2 では InterconnectionView）",
      "振る舞い（SysML v2 では GeneralView で描く図）",
      "シーケンス図（SysML v2 では SequenceView）",
      "アクティビティ図（SysML v2 では ActionFlowView）",
      "すべて（SysML v2 では GeneralView で描く図）",
    ]);
  });
});

describe("savedViewHint（保存された図の種類のツールチップ）", () => {
  it("型のある view は、その標準ビューの名前で書く", () => {
    // Arrange
    const std = "InterconnectionView";
    // Act
    const hint = savedViewHint(std);
    // Assert
    expect(hint).toBe("内部ブロック図（SysML v2 では InterconnectionView）");
  });

  it("型の無い view は、一般ビュー（GeneralView）として書く（null）", () => {
    // Arrange
    const std = null;
    // Act
    const hint = savedViewHint(std);
    // Assert
    expect(hint).toBe("一般ビュー（SysML v2 では GeneralView）");
  });
});

describe("tabTitle（タブのツールチップ）", () => {
  it("タブの名前が図の種類の名前と同じなら、補足つきの文だけにする", () => {
    // Arrange
    const hint = "すべて（SysML v2 では GeneralView で描く図）";
    // Act
    const title = tabTitle("すべて", hint);
    // Assert
    expect(title).toBe(hint);
  });

  it("対象の付いたタブは、名前の下の行に補足つきの文を出す", () => {
    // Arrange
    const hint = "内部ブロック図（SysML v2 では InterconnectionView）";
    // Act
    const title = tabTitle("ibd Vehicle", hint);
    // Assert
    expect(title).toBe("ibd Vehicle\n内部ブロック図（SysML v2 では InterconnectionView）");
  });

  it("名前が図の種類の名前の頭の一部でしかなければ、同じとみなさない（境界値）", () => {
    // Arrange
    const hint = "すべて（SysML v2 では GeneralView で描く図）";
    // Act
    const title = tabTitle("すべ", hint);
    // Assert
    expect(title).toBe(`すべ\n${hint}`);
  });
});
