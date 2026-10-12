import { describe, expect, it } from "vitest";
import { counts, idsIn, summarize, toHtml, toMarkdown, type TestResult } from "./requirements-report";

const SPEC = `package R {
    metadata def Phase { attribute stage : PhaseKind; }
    enum def PhaseKind { enum StakeholderNeeds; enum SystemRequirements; }
    requirement def <'N-1'> Need { doc /* 利用者の要求 */ }
    requirement def <'F-A-1'> TestedReq { doc /* e2e がある | 縦棒入り */ }
    requirement def <'F-A-2'> UnitReq { doc /* 単体テストだけ */ }
    requirement def <'Q-1'> TodoReq { doc /* まだ */ }
    verification def UnitTest { objective { verify UnitReq; } }
}`;

const t = (title: string, status: TestResult["status"] = "passed"): TestResult => ({ title, status });

describe("idsIn", () => {
  it("テスト名から要求 ID を重複なく取り出す（区切りの無い ID・複数・なし）", () => {
    // Arrange
    const titles = ["F-FILE-2: 保存", "C-2 と Q-1、また C-2", "名前だけ", "F-EDIT-10: 境界"];
    // Act
    const ids = titles.map(idsIn);
    // Assert
    expect(ids).toEqual([["F-FILE-2"], ["C-2", "Q-1"], [], ["F-EDIT-10"]]);
  });
});

describe("summarize", () => {
  it("利用者要求を除いたシステム要求ごとに、テストと検証を対応づける", () => {
    // Arrange
    const results = [t("F-A-1: 合格する"), t("関係ないテスト")];
    // Act
    const rows = summarize(SPEC, results);
    // Assert
    expect(rows.map((r) => [r.id, r.state, r.tests.length, r.verifiedBy])).toEqual([
      ["F-A-1", "ok", 1, []],
      ["F-A-2", "other-tests", 0, ["UnitTest"]],
      ["Q-1", "unverified", 0, []],
    ]);
  });

  it("1 つでも失敗があれば失敗にする（異常系）", () => {
    // Arrange
    const results = [t("F-A-1: 1"), t("F-A-1: 2", "failed")];
    // Act
    const [row] = summarize(SPEC, results);
    // Assert
    expect(row?.state).toBe("failed");
  });

  it("スキップしたテストしか無ければ、テストが無いのと同じに扱う（境界値）", () => {
    // Arrange
    const results = [t("F-A-1: とばす", "skipped")];
    // Act
    const [row] = summarize(SPEC, results);
    // Assert
    expect(row?.state).toBe("unverified");
  });
});

describe("出力", () => {
  const rows = summarize(SPEC, [t("F-A-1: 合格する")]);

  it("件数を状態ごとに数える", () => {
    // Arrange・Act
    const c = counts(rows);
    // Assert
    expect(c).toEqual({ ok: 1, failed: 0, "other-tests": 1, unverified: 1 });
  });

  it("Markdown の表では、内容の縦棒をエスケープする", () => {
    // Arrange・Act
    const md = toMarkdown(rows);
    // Assert
    expect(md).toContain("| F-A-1 | e2e がある \\| 縦棒入り | ✅ | 1/1 | — |");
    expect(md).toContain("| F-A-2 | 単体テストだけ | ☑️ | — | UnitTest |");
  });

  it("HTML では、テスト名などをエスケープする", () => {
    // Arrange
    const r = summarize(SPEC, [t("F-A-1: <b>太字</b>")]);
    // Act
    const out = toHtml(r, { version: "0.1.0", commit: "0123456789abcdef", date: "2026-10-12" });
    // Assert
    expect(out).toContain("&lt;b&gt;太字&lt;/b&gt;");
    expect(out).toContain("0.1.0（0123456）");
  });
});
