import { describe, expect, it } from "vitest";
import type { ProjectProblem } from "../core";
import { projectNotice, projectTitle } from "./project";

describe("projectTitle（F-PROJ-1）", () => {
  it.each([
    ["プロジェクト名がある", { name: "給水システム", plugins: {} }, "給水システム"],
    ["名前の前後の空白は除く", { name: " 給水システム ", plugins: {} }, "給水システム"],
    ["名前が無い", { plugins: {} }, "water"],
    ["名前が空白だけ（境界値）", { name: "  ", plugins: {} }, "water"],
    ["設定ファイルが無い・読み取れない", null, "water"],
  ])("%s → %s", (_case, project, expected) => {
    // Arrange・Act
    const title = projectTitle("water", project);
    // Assert
    expect(title).toBe(expected);
  });
});

describe("projectNotice（F-PROJ-1）", () => {
  const warning: ProjectProblem = { severity: "warning", line: 3, column: 3, message: "不明な項目「x」があります。削除せずに残します" };
  const error: ProjectProblem = { severity: "error", line: 2, column: 5, message: "書式にエラーがあるため読み込めません（JSON：trailing comma）" };

  it("問題が無ければ知らせない（境界値: 0 件）", () => {
    // Arrange・Act
    const notice = projectNotice([]);
    // Assert
    expect(notice).toBeNull();
  });

  it("注意 1 件は、その行と文を出す", () => {
    // Arrange・Act
    const notice = projectNotice([warning]);
    // Assert
    expect(notice).toBe("プロジェクトの設定（modelith.json）の 3 行目：不明な項目「x」があります。削除せずに残します");
  });

  it("誤りがあれば、後ろにあっても誤りを先に出し、残りの件数を添える", () => {
    // Arrange・Act
    const notice = projectNotice([warning, error]);
    // Assert
    expect(notice).toBe("プロジェクトの設定（modelith.json）を読み込めません。2 行目：書式にエラーがあるため読み込めません（JSON：trailing comma）（ほかに 1 件）");
  });
});
