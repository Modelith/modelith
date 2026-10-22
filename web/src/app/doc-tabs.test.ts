// ファイルごとの図のタブ（F-VIEW-17）の単体テスト。
import { describe, expect, it } from "vitest";
import { docTabsId, firstTabs, nothingInFile, parseDocTabs, rememberDocTabs } from "./doc-tabs";
import type { SavedTabs } from "./saved-tabs";

/** id のタブ 1 つの記憶。 */
const one = (id: number, view = "trace"): SavedTabs => ({ tabs: [{ id, view, ctx: null, phase: "" }], active: id });

describe("docTabsId（記憶の名前）", () => {
  it("保存先のあるファイルは保存先、無題の文書は文書のキー", () => {
    // Assert
    expect(docTabsId({ key: "d3", ref: { provider: "local", path: "models/a.sysml" } })).toBe("local:models/a.sysml");
    expect(docTabsId({ key: "d4", ref: null })).toBe("draft:d4");
  });
});

describe("firstTabs（初めて開くファイル）", () => {
  it("「すべて」の図のタブ 1 つ", () => {
    // Assert
    expect(firstTabs()).toEqual({ tabs: [{ id: 1, view: "all", ctx: null, phase: "" }], active: 1 });
  });
});

describe("parseDocTabs（記憶の読み込み）", () => {
  it("ファイルごとのタブを、記憶した順に戻す（正常系）", () => {
    // Act
    const m = parseDocTabs(JSON.stringify({ "local:a": one(1), "local:b": one(2, "all") }), ["trace", "all"]);
    // Assert
    expect([...m.keys()]).toEqual(["local:a", "local:b"]);
    expect(m.get("local:b")).toEqual(one(2, "all"));
  });

  it("戻せないファイルの記憶だけを捨てる（異常系）", () => {
    // Act
    const m = parseDocTabs(JSON.stringify({ "local:a": one(1), "local:b": { tabs: "x" }, "local:c": one(3, "gone") }), ["trace"]);
    // Assert
    expect([...m.keys()]).toEqual(["local:a"]);
  });

  it.each([[null], ["{not json"], ["[1]"], ['"x"']])("記憶が無い・壊れている（%j）なら空", (json) => {
    // Assert
    expect(parseDocTabs(json, ["trace"]).size).toBe(0);
  });
});

describe("rememberDocTabs（記憶に入れる）", () => {
  it("入れたものを最後（新しいもの）に置く", () => {
    // Arrange
    const m = new Map([["a", one(1)], ["b", one(2)]]);
    // Act
    rememberDocTabs(m, "a", one(5), 3);
    // Assert
    expect([...m.keys()]).toEqual(["b", "a"]);
    expect(m.get("a")).toEqual(one(5));
  });

  it("上限を超えたら、古いものから捨てる（境界値）", () => {
    // Arrange
    const m = new Map([["a", one(1)], ["b", one(2)]]);
    // Act
    rememberDocTabs(m, "c", one(3), 2);
    // Assert
    expect([...m.keys()]).toEqual(["b", "c"]);
  });
});

describe("nothingInFile（このファイルの要素が無い図の案内）", () => {
  it("ファイルに要素があるのに、図に描くものが無ければ案内する", () => {
    // Assert
    expect(nothingInFile({ nodes: [] }, 7)).toBe(true);
  });

  it("図が自分の案内を出すとき・シーケンス図・ファイルが空・描くものがあるときは案内しない", () => {
    // Assert
    expect(nothingInFile({ nodes: [], empty: "シナリオがまだありません。" }, 7)).toBe(false);
    expect(nothingInFile({ nodes: [], seq: true }, 7)).toBe(false);
    expect(nothingInFile({ nodes: [] }, 0)).toBe(false);
    expect(nothingInFile({ nodes: [{ key: "A" } as never] }, 7)).toBe(false);
  });
});
