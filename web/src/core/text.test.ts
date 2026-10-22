import { describe, expect, it } from "vitest";
import type { ParseError } from "./types";
import { applyTextEdits, diffRange, lineStart, readLayout, removeLayoutComment, removeRange } from "./text";

describe("lineStart", () => {
  it("先頭行の位置は 0（境界値: pos = 0）", () => {
    // Arrange
    const t = "ab\ncd";
    // Act
    const p = lineStart(t, 0);
    // Assert
    expect(p).toBe(0);
  });

  it("2 行目の途中なら改行の直後を返す", () => {
    // Arrange
    const t = "ab\ncd";
    // Act
    const p = lineStart(t, 4);
    // Assert
    expect(p).toBe(3);
  });
});

describe("applyTextEdits", () => {
  it("複数の編集を位置がずれないように適用する", () => {
    // Arrange
    const edits = [{ start: 0, end: 1, text: "A" }, { start: 4, end: 5, text: "EE" }];
    // Act
    const t = applyTextEdits("abcde", edits);
    // Assert
    expect(t).toBe("AbcdEE");
  });

  it("編集が空ならテキストを変えない（境界値: 0 件）", () => {
    // Arrange
    const text = "abc";
    // Act
    const t = applyTextEdits(text, []);
    // Assert
    expect(t).toBe("abc");
  });
});

describe("removeRange", () => {
  it("範囲が行全体なら改行ごと消す", () => {
    // Arrange
    const t = "a;\n  b;\nc;";
    // Act
    const r = removeRange(t, 5, 7);
    // Assert
    expect(r).toEqual({ text: "a;\nc;", at: 3 });
  });

  it("行の一部なら後ろの空白だけを詰める", () => {
    // Arrange
    const t = "a; b; c;";
    // Act
    const r = removeRange(t, 3, 5);
    // Assert
    expect(r).toEqual({ text: "a; c;", at: 3 });
  });

  it("末尾の行（改行なし）も消せる（境界値: テキストの末尾）", () => {
    // Arrange
    const t = "a;\nb;";
    // Act
    const r = removeRange(t, 3, 5);
    // Assert
    expect(r).toEqual({ text: "a;\n", at: 3 });
  });
});

describe("removeLayoutComment（ADR-0005 の移行）", () => {
  it("末尾の @layout を、前の空行ごと消す", () => {
    // Arrange
    const text = 'package P {}\n\n/* @layout {\n  "trace": {"A":[0,0]}\n} */\n';
    // Act
    const t = removeLayoutComment(text);
    // Assert
    expect(t).toBe("package P {}\n");
  });

  it("途中の行にある @layout は、その行だけを消す", () => {
    // Arrange
    const text = 'x\n/* @layout {"a":{}} */\ny\n';
    // Act
    const t = removeLayoutComment(text);
    // Assert
    expect(t).toBe("x\ny\n");
  });

  it("@layout が無ければ変えない（境界値）", () => {
    // Arrange
    const text = "package P;\n/* note */\n";
    // Act
    const t = removeLayoutComment(text);
    // Assert
    expect(t).toBe(text);
  });

  it("@layout だけのテキストは空になる（境界値）", () => {
    // Arrange
    const text = '/* @layout {} */\n';
    // Act
    const t = removeLayoutComment(text);
    // Assert
    expect(t).toBe("");
  });
});

describe("diffRange", () => {
  it("挿入された範囲を返す", () => {
    // Arrange
    const [a, b] = ["abcd", "abXYcd"];
    // Act
    const r = diffRange(a, b);
    // Assert
    expect(r).toEqual([2, 4]);
  });

  it("同じなら空の範囲（境界値: 差分なし）", () => {
    // Arrange
    const s = "abc";
    // Act
    const r = diffRange(s, s);
    // Assert
    expect(r).toEqual([3, 3]);
  });

  it("削除なら開始と終了が同じ位置になる", () => {
    // Arrange
    const [a, b] = ["abXcd", "abcd"];
    // Act
    const r = diffRange(a, b);
    // Assert
    expect(r).toEqual([2, 2]);
  });
});

describe("readLayout（ADR-0005 の移行）", () => {
  it("@layout コメントの JSON を読む", () => {
    // Arrange
    const errors: ParseError[] = [];
    // Act
    const layout = readLayout('package P;\n/* @layout {"A":{"x":1}} */\n', errors);
    // Assert
    expect(layout).toEqual({ A: { x: 1 } });
    expect(errors).toEqual([]);
  });

  it("@layout が無ければ空のオブジェクト（境界値）", () => {
    // Arrange
    const errors: ParseError[] = [];
    // Act
    const layout = readLayout("package P;", errors);
    // Assert
    expect(layout).toEqual({});
    expect(errors).toEqual([]);
  });

  it("JSON が読めなければ、空のオブジェクトにしてコメントの位置に誤りを足す（異常系）", () => {
    // Arrange
    const errors: ParseError[] = [];
    // Act
    const layout = readLayout("package P;\n/* @layout {x */", errors);
    // Assert
    expect(layout).toEqual({});
    expect(errors).toEqual([{ pos: 11, msg: "@layout コメントを読み込めません" }]);
  });
});
