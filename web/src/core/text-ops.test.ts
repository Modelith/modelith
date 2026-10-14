import { describe, expect, it } from "vitest";
import { applyEdits, diffRange, indentAt, insertInto, lineStart, removeLayoutComment, removeRange } from "./text-ops";

describe("lineStart / indentAt", () => {
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

  it("行頭の空白とタブを字下げとして返す", () => {
    // Arrange
    const t = "x\n \t  y";
    // Act
    const ind = indentAt(t, 5);
    // Assert
    expect(ind).toBe(" \t  ");
  });
});

describe("applyEdits", () => {
  it("複数の編集を位置がずれないように適用する", () => {
    // Arrange
    const edits = [{ at: 0, del: 1, ins: "A" }, { at: 4, del: 1, ins: "EE" }];
    // Act
    const t = applyEdits("abcde", edits);
    // Assert
    expect(t).toBe("AbcdEE");
  });

  it("編集が空ならテキストを変えない（境界値: 0 件）", () => {
    // Arrange
    const text = "abc";
    // Act
    const t = applyEdits(text, []);
    // Assert
    expect(t).toBe("abc");
  });
});

describe("insertInto", () => {
  it("閉じ括弧だけの行があれば、その前に字下げした行を足す", () => {
    // Arrange
    const t = "part def A {\n}\n";
    // Act
    const r = insertInto(t, { start: 0, headEnd: 11, close: 13 }, "part b : B;");
    // Assert
    expect(r.text).toBe("part def A {\n    part b : B;\n}\n");
  });

  it("閉じ括弧が同じ行にあれば、空白を挟んで括弧の前に入れる", () => {
    // Arrange
    const t = "part def A {}";
    // Act
    const r = insertInto(t, { start: 0, headEnd: 11, close: 12 }, "part b : B;");
    // Assert
    expect(r.text).toBe("part def A { part b : B; }");
  });

  it("; で終わる宣言はブロックに書き換える", () => {
    // Arrange
    const t = "  part def A;";
    // Act
    const r = insertInto(t, { start: 2, headEnd: 12 }, "part b : B;");
    // Assert
    expect(r.text).toBe("  part def A {\n      part b : B;\n  }");
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
