// v1 のプラグインのメニューの項目（F-PLUG-4、ADR-0018 §3）の単体テスト。
import { describe, expect, it } from "vitest";
import { commandItems, exportItems, importItems } from "./view";
import type { RunState } from "./view";

/** インポートとエクスポートを持つプラグイン。 */
const plugin = (state: RunState) => ({
  id: "jp.x",
  name: "要求の表",
  state,
  commands: [{ id: "fill", title: "要求に ID を付ける" }],
  importers: [{ id: "reqif", label: "ReqIF ファイル", extensions: [".reqif", "xml"] }],
  exporters: [{ id: "csv", label: "要求の表（CSV）", extension: ".csv" }],
});

describe("importItems・exportItems・commandItems", () => {
  it("実行中のプラグインのインポートは、拡張子で絞る項目にする（正常系）", () => {
    // Arrange・Act
    const got = importItems([plugin("running")]);
    // Assert
    expect(got).toEqual([
      { plugin: "jp.x", command: "reqif", label: "ReqIF ファイル…", tooltip: "プラグイン「要求の表」で、ファイル（.reqif,.xml）をインポートして新しいファイルとして開きます", accept: ".reqif,.xml" },
    ]);
  });

  it("拡張子を書いていないインポートは、すべてのファイルを選べる（境界値: 0 個）", () => {
    // Arrange
    const p = { ...plugin("running"), importers: [{ id: "any", label: "何でも", extensions: [] }] };
    // Act
    const got = importItems([p]);
    // Assert
    expect(got[0]).toMatchObject({ accept: "", tooltip: "プラグイン「要求の表」で、ファイル（すべて）をインポートして新しいファイルとして開きます" });
  });

  it("実行中のプラグインのエクスポートは、ダウンロードする項目にする（正常系）", () => {
    // Arrange・Act
    const got = exportItems([plugin("running")]);
    // Assert
    expect(got).toEqual([{ plugin: "jp.x", command: "csv", label: "要求の表（CSV）", tooltip: "プラグイン「要求の表」で、モデル（作成した図を表示中なら、その図）を .csv のファイルにエクスポートしてダウンロードします" }]);
  });

  it.each<RunState>(["starting", "stopped", "denied", "failed"])("実行中でない（%s）プラグインの項目は出さない（異常系）", (state) => {
    // Arrange・Act
    const got = [...commandItems([plugin(state)]), ...importItems([plugin(state)]), ...exportItems([plugin(state)])];
    // Assert
    expect(got).toEqual([]);
  });
});
