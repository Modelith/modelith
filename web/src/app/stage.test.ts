// 版の名前から開発段階の表示を決める（見出しの札と「ヘルプ」）。
import { describe, expect, it } from "vitest";
import { stageLabel } from "./stage";

describe("stageLabel（開発段階の表示）", () => {
  it.each([
    ["0.1.0-alpha.10", "alpha", "開発中の alpha 版"],
    ["0.1.0-beta.1", "beta", "機能を固定した beta 版"],
    ["0.1.0-rc.1", "rc", "正式版の候補（rc）"],
  ])("プレリリースの %s は、札「%s」と説明を返す", (version, badge, note) => {
    // Arrange・Act
    const label = stageLabel(version);
    // Assert
    expect(label).toEqual({ badge, note });
  });

  it.each([["0.1.0"], ["1.2.3"], ["0.1.0-dev.1"], ["beta"], [""]])("正式版・知らない段階・読めない版 %j は、表示しない", (version) => {
    // Arrange・Act
    const label = stageLabel(version);
    // Assert
    expect(label).toBeNull();
  });
});
