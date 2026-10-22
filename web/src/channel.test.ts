// 公開の系列ごとの保存の名前（ADR-0020）。
import { describe, expect, it } from "vitest";
import { channelName } from "./channel";

describe("channelName（系列ごとの保存の名前）", () => {
  it("安定版は名前をそのまま使い、それまでの保存を引き継ぐ", () => {
    // Act / Assert
    expect(channelName("modelith-ui-v1", "stable")).toBe("modelith-ui-v1");
  });

  it("プレリリース版は @preview を付けて、安定版の保存と分ける", () => {
    // Act / Assert
    expect(channelName("modelith-ui-v1", "preview")).toBe("modelith-ui-v1@preview");
  });

  it("系列の無いビルド（手元・テスト）や知らない系列は、安定版と同じ（境界値・異常系）", () => {
    // Act / Assert
    expect([channelName("modelith", ""), channelName("modelith", "nightly")]).toEqual(["modelith", "modelith"]);
  });
});
