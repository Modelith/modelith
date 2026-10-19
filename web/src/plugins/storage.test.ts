// v1 のプラグイン用の保存場所（F-PLUG-7 の storage、ADR-0018 §3）の判断の単体テスト。
import { describe, expect, it } from "vitest";
import { PLUGIN_STORAGE_LIMIT, storageUpdate, storedValue, storedValues, utf8Bytes } from "./storage";

describe("storageUpdate", () => {
  it("値を足す（正常系）", () => {
    // Arrange・Act
    const got = storageUpdate('{"a":1}', "b", { n: [1, 2] }, PLUGIN_STORAGE_LIMIT);
    // Assert
    expect(got).toEqual({ json: '{"a":1,"b":{"n":[1,2]}}' });
  });

  it("同じキーは置き換える", () => {
    // Arrange・Act
    const got = storageUpdate('{"a":1}', "a", "要求", PLUGIN_STORAGE_LIMIT);
    // Assert
    expect(got).toEqual({ json: '{"a":"要求"}' });
  });

  it("null はキーを消し、最後のキーなら保存場所から消す（境界値）", () => {
    // Arrange・Act
    const some = storageUpdate('{"a":1,"b":2}', "a", null, PLUGIN_STORAGE_LIMIT);
    const last = storageUpdate('{"a":1}', "a", null, PLUGIN_STORAGE_LIMIT);
    // Assert
    expect(some).toEqual({ json: '{"b":2}' });
    expect(last).toEqual({ json: null });
  });

  it.each([
    ["上限ちょうど", 0, true],
    ["上限 + 1 バイト", 1, false],
  ])("%s（境界値。UTF-8 で数える）", (_, over, saved) => {
    // Arrange（{"k":"…"} の 8 バイトと、残りを 1 バイトの文字で埋める）
    const value = "x".repeat(100 - 8 + over);
    // Act
    const got = storageUpdate(null, "k", value, 100);
    // Assert
    expect("json" in got).toBe(saved);
  });

  it("上限を超えるときは、保存しない理由を返す（異常系）", () => {
    // Arrange・Act
    const got = storageUpdate(null, "大きな値", "要".repeat(PLUGIN_STORAGE_LIMIT / 3), PLUGIN_STORAGE_LIMIT);
    // Assert
    expect(got).toEqual({ refused: "プラグイン用の保存場所の上限（1 MB）を超えるため、「大きな値」を保存しませんでした" });
  });

  it("壊れた保存内容は空として扱い、上書きする（異常系）", () => {
    // Arrange・Act
    const got = storageUpdate("{", "a", 1, PLUGIN_STORAGE_LIMIT);
    // Assert
    expect(got).toEqual({ json: '{"a":1}' });
  });
});

describe("storedValue・storedValues", () => {
  it.each([
    ["保存したキー", '{"a":{"n":1}}', "a", { n: 1 }],
    ["保存していないキー", '{"a":1}', "b", undefined],
    ["何も保存していない", null, "a", undefined],
    ["継承したプロパティは値にしない", "{}", "toString", undefined],
  ])("%s", (_, json, key, expected) => {
    // Arrange・Act
    const got = storedValue(json, key);
    // Assert
    expect(got).toEqual(expected);
  });

  it.each([
    ["配列", "[1]"],
    ["数", "1"],
    ["null", "null"],
    ["壊れた JSON", "{"],
  ])("形の違う保存内容（%s）は空として扱う（異常系）", (_, json) => {
    // Arrange・Act
    const got = storedValues(json);
    // Assert
    expect(got).toEqual({});
  });

  it("UTF-8 のバイト数を数える", () => {
    // Arrange・Act
    const got = utf8Bytes("a要");
    // Assert
    expect(got).toBe(4);
  });
});
