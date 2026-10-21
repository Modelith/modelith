import { afterEach, describe, expect, it, vi } from "vitest";
import { store } from "./dom";

/** localStorage の代わり。setItem が投げる例外を決められる。 */
function fakeStorage(failWith: Error | null = null) {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWith) throw failWith;
      items.set(k, v);
    },
    removeItem: (k: string) => void items.delete(k),
  });
  return items;
}

afterEach(() => vi.unstubAllGlobals());

describe("store.set（F-FILE-11）", () => {
  it("書けたら true を返し、値が残る", () => {
    // Arrange
    const items = fakeStorage();
    // Act
    const ok = store.set("modelith-drafts-v1", "[]");
    // Assert
    expect(ok).toBe(true);
    expect(items.get("modelith-drafts-v1")).toBe("[]");
  });

  it("保存領域がいっぱい（QuotaExceededError）なら false を返し、例外を出さない（異常系）", () => {
    // Arrange
    fakeStorage(new DOMException("quota", "QuotaExceededError"));
    // Act
    const ok = store.set("modelith-drafts-v1", "x".repeat(1000));
    // Assert
    expect(ok).toBe(false);
  });

  it("localStorage が使えない環境なら false を返す（境界）", () => {
    // Arrange
    vi.stubGlobal("localStorage", undefined);
    // Act
    const ok = store.set("k", "v");
    // Assert
    expect(ok).toBe(false);
  });
});

describe("store.remove（Q-6）", () => {
  it("消せたら true を返し、以後 get は null", () => {
    // Arrange
    const items = fakeStorage();
    items.set("modelith-tabs-v1", "{}");
    // Act
    const ok = store.remove("modelith-tabs-v1");
    // Assert
    expect(ok).toBe(true);
    expect(store.get("modelith-tabs-v1")).toBeNull();
  });

  it("もともと無いキーでも true（境界）", () => {
    // Arrange
    fakeStorage();
    // Act
    const ok = store.remove("missing");
    // Assert
    expect(ok).toBe(true);
  });

  it("localStorage が使えない環境なら false（異常系）", () => {
    // Arrange
    vi.stubGlobal("localStorage", undefined);
    // Act
    const ok = store.remove("k");
    // Assert
    expect(ok).toBe(false);
  });
});
