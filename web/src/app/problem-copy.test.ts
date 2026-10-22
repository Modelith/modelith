// 問題一覧のコピー（F-EDIT-13）の単体テスト。
import { describe, expect, it } from "vitest";
import { copiedText, problemLine, problemsText } from "./problem-copy";

describe("problemLine（1 行の文）", () => {
  it("ファイル名・行・メッセージを「ファイル名:行: メッセージ」にする（正常系）", () => {
    // Act
    const s = problemLine({ path: "models/app.sysml", line: 12, text: "型「Wheel」が見つかりません（w）" });
    // Assert
    expect(s).toBe("models/app.sysml:12: 型「Wheel」が見つかりません（w）");
  });

  it("行の無い問題は、ファイル名とメッセージだけ", () => {
    // Act
    const s = problemLine({ path: "app.sysml", line: null, text: "x" });
    // Assert
    expect(s).toBe("app.sysml: x");
  });

  it("ファイルに属さない行は、メッセージだけ", () => {
    // Act
    const s = problemLine({ path: null, line: null, text: "プラグイン「要求の同期」がありません" });
    // Assert
    expect(s).toBe("プラグイン「要求の同期」がありません");
  });

  it("メッセージの中の改行は空白にして、1 件を 1 行に保つ（境界値）", () => {
    // Act
    const s = problemLine({ path: "a.sysml", line: 1, text: "前の行\n  次の行" });
    // Assert
    expect(s).toBe("a.sysml:1: 前の行 次の行");
  });
});

describe("problemsText（すべてコピー）", () => {
  it("1 行に 1 件、一覧の順につなぐ", () => {
    // Act
    const s = problemsText([
      { path: "a.sysml", line: 1, text: "x" },
      { path: "b.sysml", line: 3, text: "y" },
    ]);
    // Assert
    expect(s).toBe("a.sysml:1: x\nb.sysml:3: y");
  });

  it("行が無ければ空（境界値）", () => {
    // Assert
    expect(problemsText([])).toBe("");
  });
});

describe("copiedText（知らせ）", () => {
  it.each([
    [1, "問題を 1 件コピーしました"],
    [12, "問題を 12 件コピーしました"],
  ])("%i 件 → %j", (n, expected) => {
    // Assert
    expect(copiedText(n)).toBe(expected);
  });
});
