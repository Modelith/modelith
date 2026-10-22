// 公開する版を系列ごとに選ぶ（ADR-0020）。
import { describe, expect, it } from "vitest";
import { parseTag, pickChannels, type Release } from "./channels";

/**
 * 公開済みのリリースの一覧を作る。
 *
 * @param tags タグ
 * @returns 下書きでないリリース
 */
const published = (...tags: string[]): Release[] => tags.map((tagName) => ({ tagName, isDraft: false }));

describe("pickChannels（系列ごとに公開する版）", () => {
  it("正式版が無ければ、安定版は最新の rc、プレリリース版は最も新しい版", () => {
    // Arrange
    const releases = published("v0.1.0-beta.6", "v0.1.0-rc.1", "v0.2.0-alpha.2", "v0.1.0-alpha.3");
    // Act / Assert
    expect(pickChannels(releases)).toEqual({ stable: "v0.1.0-rc.1", preview: "v0.2.0-alpha.2" });
  });

  it("正式版があれば、安定版は最新の正式版（後の rc は安定版にしない）", () => {
    // Arrange
    const releases = published("v0.1.0-rc.1", "v0.1.0", "v0.2.0-rc.1", "v0.1.1");
    // Act / Assert
    expect(pickChannels(releases)).toEqual({ stable: "v0.1.1", preview: "v0.2.0-rc.1" });
  });

  it("最も新しい版が正式版なら、プレリリース版も同じ版", () => {
    // Act / Assert
    expect(pickChannels(published("v0.1.0-rc.1", "v0.1.0"))).toEqual({ stable: "v0.1.0", preview: "v0.1.0" });
  });

  it("番号は数として比べる（alpha.10 は alpha.9 の後）", () => {
    // Act / Assert
    expect(pickChannels(published("v0.2.0-alpha.9", "v0.2.0-alpha.10")).preview).toBe("v0.2.0-alpha.10");
  });

  it("下書きと、版のタグでないリリースは選ばない（異常系）", () => {
    // Arrange
    const releases: Release[] = [{ tagName: "v0.2.0-alpha.1", isDraft: true }, ...published("nightly", "v0.1.0-rc.1")];
    // Act / Assert
    expect(pickChannels(releases)).toEqual({ stable: "v0.1.0-rc.1", preview: "v0.1.0-rc.1" });
  });

  it("alpha・beta しか無ければ、安定版は無い（境界値）", () => {
    // Act / Assert
    expect(pickChannels(published("v0.1.0-alpha.1", "v0.1.0-beta.1"))).toEqual({ stable: null, preview: "v0.1.0-beta.1" });
  });

  it("リリースが無ければ、どちらも無い（境界値）", () => {
    // Act / Assert
    expect(pickChannels([])).toEqual({ stable: null, preview: null });
  });
});

describe("parseTag（タグを並べられる形にする）", () => {
  it("段階の無いタグは正式版、知らない形は読まない", () => {
    // Act / Assert
    expect(parseTag("v1.2.3")).toEqual({ tag: "v1.2.3", nums: [1, 2, 3], stage: 3, n: 0 });
    expect([parseTag("1.2.3"), parseTag("v1.2.3-dev.1"), parseTag("v1.2")]).toEqual([null, null, null]);
  });
});
