// プロジェクトの一覧（F-PROJ-3）の決まりの単体テスト。
import { describe, expect, it } from "vitest";
import { forgetRecent, MAX_RECENT, nextRecentId, parseRecent, pushRecent, withProject, type RecentEntry } from "./recent-folders";

/** テストのハンドル（名前だけ）。 */
type H = { name: string };
const isH = (v: unknown): v is H => typeof v === "object" && v !== null && typeof (v as H).name === "string";
const e = (id: string, name: string, project: string | null = null): RecentEntry<H> => ({ id, handle: { name }, project });
const names = (list: RecentEntry<H>[]) => list.map((x) => x.handle.name);

describe("parseRecent（保存しておいた一覧の読み込み）", () => {
  it("形の合う項目だけを読み、プロジェクト名が無ければ null にする（正常系）", () => {
    // Arrange
    const raw = [{ id: "1", handle: { name: "a" }, project: "給水" }, { id: "2", handle: { name: "b" } }];
    // Act
    const list = parseRecent(raw, isH);
    // Assert
    expect(list).toEqual([e("1", "a", "給水"), e("2", "b")]);
  });

  it("名前やハンドルの無い項目・同じ名前の 2 つ目は捨てる（異常系）", () => {
    // Act
    const list = parseRecent([{ id: 1, handle: { name: "a" } }, { id: "2" }, null, { id: "3", handle: { name: "c" } }, { id: "3", handle: { name: "d" } }], isH);
    // Assert
    expect(names(list)).toEqual(["c"]);
  });

  it("配列でなければ空（異常系）", () => {
    // Assert
    expect(parseRecent(undefined, isH)).toEqual([]);
    expect(parseRecent({ id: "1" }, isH)).toEqual([]);
  });
});

describe("pushRecent（開いたフォルダを先頭に）", () => {
  it("新しいフォルダは、新しい名前で先頭に足す", () => {
    // Act
    const list = pushRecent([e("1", "a"), e("2", "b")], -1, { name: "c" });
    // Assert
    expect(list[0]).toEqual(e("3", "c"));
    expect(names(list)).toEqual(["c", "a", "b"]);
  });

  it("既にあるフォルダは先頭に移し、名前とプロジェクト名を残す", () => {
    // Act
    const list = pushRecent([e("1", "a"), e("2", "b", "給水")], 1, { name: "b" });
    // Assert
    expect(list).toEqual([e("2", "b", "給水"), e("1", "a")]);
  });

  it(`上限（${MAX_RECENT} 件）を超えたら、最後に開いたのが古いものから外す（境界値）`, () => {
    // Arrange
    const full = Array.from({ length: MAX_RECENT }, (_, i) => e(String(i + 1), `f${i + 1}`));
    // Act
    const list = pushRecent(full, -1, { name: "new" });
    // Assert
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]?.handle.name).toBe("new");
    expect(names(list)).not.toContain(`f${MAX_RECENT}`);
  });
});

describe("nextRecentId・forgetRecent・withProject", () => {
  it("名前は、数の名前の最大 + 1", () => {
    // Assert
    expect(nextRecentId([])).toBe("1");
    expect(nextRecentId([{ id: "3" }, { id: "x" }, { id: "1" }])).toBe("4");
  });

  it("一覧から外す。無い名前なら変えない", () => {
    // Assert
    expect(names(forgetRecent([e("1", "a"), e("2", "b")], "1"))).toEqual(["b"]);
    expect(names(forgetRecent([e("1", "a")], "9"))).toEqual(["a"]);
  });

  it("プロジェクト名を書き換え、変わったかを返す", () => {
    // Assert
    expect(withProject([e("1", "a")], "1", "給水")).toEqual({ list: [e("1", "a", "給水")], changed: true });
    expect(withProject([e("1", "a", "給水")], "1", "給水").changed).toBe(false);
    expect(withProject([e("1", "a")], "9", "給水").changed).toBe(false);
  });
});
