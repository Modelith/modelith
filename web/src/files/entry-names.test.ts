// ファイルとフォルダの名前とパスの決まり（F-FILE-19）の単体テスト。
import { describe, expect, it } from "vitest";
import { childPath, movedPath, nameProblem, parentPath, pathFromFolder, renameSelectionEnd } from "./entry-names";

describe("nameProblem（使える名前か）", () => {
  it("使える名前なら null（正常系）", () => {
    // Assert
    expect(nameProblem("b.sysml", ["a.sysml"], { model: true })).toBeNull();
    expect(nameProblem("parts", ["models"])).toBeNull();
    expect(nameProblem("  c.kerml  ", [], { model: true })).toBeNull();
  });

  it.each([
    ["", "名前を入力してください"],
    ["   ", "名前を入力してください"],
    ["a/b.sysml", '名前に \\ / : * ? " < > | は使えません'],
    ["a\\b.sysml", '名前に \\ / : * ? " < > | は使えません'],
    ["a:b.sysml", '名前に \\ / : * ? " < > | は使えません'],
    ["..", "名前の終わりに「.」は使えません"],
    ["models.", "名前の終わりに「.」は使えません"],
  ])("使えない名前（%j）は理由を返す（異常系）", (name, reason) => {
    // Assert
    expect(nameProblem(name, [])).toBe(reason);
  });

  it("同じ場所に同じ名前があれば使えない（大文字と小文字は区別しない）", () => {
    // Assert
    expect(nameProblem("A.sysml", ["a.sysml"])).toBe("同じ場所に「a.sysml」があります");
  });

  it("モデルのファイルは、.sysml・.kerml で終わる名前だけ（境界値）", () => {
    // Assert
    expect(nameProblem("a.txt", [], { model: true })).toBe("モデルのファイルの名前は「.sysml」か「.kerml」で終わるようにしてください");
    expect(nameProblem("a.txt", [])).toBeNull();
  });
});

describe("parentPath・childPath（親と子のパス）", () => {
  it("一番上と、フォルダの中", () => {
    // Assert
    expect(parentPath("models/a.sysml")).toBe("models");
    expect(parentPath("a.sysml")).toBe("");
    expect(childPath("models", "a.sysml")).toBe("models/a.sysml");
    expect(childPath("", "a.sysml")).toBe("a.sysml");
  });
});

describe("movedPath（動かした後のパス）", () => {
  it("動かしたものそのものと、その中のパスを移す", () => {
    // Assert
    expect(movedPath("a.sysml", "a.sysml", "b.sysml")).toBe("b.sysml");
    expect(movedPath("models/a.sysml", "models", "parts")).toBe("parts/a.sysml");
    expect(movedPath("models/sub/a.sysml", "models", "parts")).toBe("parts/sub/a.sysml");
  });

  it("名前の始まりが同じだけの別のものは移さない（境界値）", () => {
    // Assert
    expect(movedPath("models2/a.sysml", "models", "parts")).toBeNull();
    expect(movedPath("x.sysml", "models", "parts")).toBeNull();
  });
});

describe("pathFromFolder（パスのコピー）", () => {
  it("開いたフォルダの名前から始める", () => {
    // Assert
    expect(pathFromFolder("project", "models/a.sysml")).toBe("project/models/a.sysml");
    expect(pathFromFolder("project", "")).toBe("project");
  });
});

describe("renameSelectionEnd（書き換え始めに選ぶ範囲）", () => {
  it("ファイルは拡張子の前まで、フォルダと拡張子の無い名前は全体", () => {
    // Assert
    expect(renameSelectionEnd("app.sysml", true)).toBe(3);
    expect(renameSelectionEnd("models", false)).toBe(6);
    expect(renameSelectionEnd("a.b.sysml", true)).toBe(3);
    expect(renameSelectionEnd(".hidden", true)).toBe(7);
  });
});
