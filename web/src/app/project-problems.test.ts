// フォルダのすべてのファイルの問題（ADR-0021 §6、F-FILE-16）。
import { describe, expect, it } from "vitest";
import type { RuleFinding } from "../core";
import { fileProblems, fileStatus, folderStatus, otherFiles, statusBadge, statusClass } from "./project-problems";

const finding = (severity: RuleFinding["severity"], pos = 0): RuleFinding => ({ plugin: "jp.x", rule: "r1", severity, message: "m", element: "A", pos });

describe("fileStatus（F-FILE-16）", () => {
  it("エラーは種類の無い問題とルールのエラー、警告はトレースの抜けとルールの警告", () => {
    // Act
    const s = fileStatus(
      [{ pos: 0, msg: "e" }, { pos: 1, msg: "g", kind: "gap" }, { pos: 2, msg: "u", kind: "unsupported" }],
      [finding("error"), finding("warning"), finding("information"), finding("hint")],
    );
    // Assert（まだ扱えない構文・情報・ヒントは数えない）
    expect(s).toEqual({ errors: 2, warnings: 2 });
  });

  it("何も無ければ 0 件（境界値）", () => {
    expect(fileStatus([], [])).toEqual({ errors: 0, warnings: 0 });
  });
});

describe("fileProblems（F-FILE-16）", () => {
  it("行をエラー → ルール → 抜けとまだ扱えない構文の順に並べ、そのファイルの行を数える", () => {
    // Arrange
    const text = "package P {\n  part x : Nope;\n  part def A;\n}\n";
    // Act
    const f = fileProblems(
      { path: "p.sysml", problems: [{ pos: 30, msg: "抜け", kind: "gap" }, { pos: 14, msg: "型「Nope」が見つかりません（x）" }], findings: [finding("warning", 30)] },
      text,
      new Map([["jp.x", "トレース"]]),
    );
    // Assert
    expect(f.rows.map((r) => [r.line, r.mark, r.cls])).toEqual([
      [2, "⚠", "lv-error"],
      [3, "△", "rule warning"],
      [3, "△", "gap lv-warning"],
    ]);
    expect(f.rows[1]?.text).toBe("m（プラグイン「トレース」のルール r1）");
    expect(f.status).toEqual({ errors: 1, warnings: 2 });
  });

  it("F-EDIT-11: プロジェクトで選んだ重さで並べ、印と件数を決める", () => {
    // Arrange（トレースの抜けをエラーにした）
    const report = { path: "p.sysml", problems: [{ pos: 0, msg: "まだ", kind: "unsupported" as const }, { pos: 0, msg: "抜け", kind: "gap" as const, level: "error" as const }], findings: [] };
    // Act
    const f = fileProblems(report, "x", new Map());
    // Assert（エラーにした抜けが先頭）
    expect(f.rows.map((r) => [r.text, r.mark, r.cls])).toEqual([
      ["抜け", "⚠", "gap lv-error"],
      ["まだ", "ℹ", "unsupported lv-info"],
    ]);
    expect(f.status).toEqual({ errors: 1, warnings: 0 });
  });

  it("テキストが無ければ 1 行目とする（異常系：読めなかったファイル）", () => {
    const f = fileProblems({ path: "p.sysml", problems: [{ pos: 99, msg: "e" }], findings: [] }, undefined, new Map());
    expect(f.rows[0]?.line).toBe(1);
  });
});

describe("folderStatus・statusBadge・statusClass（F-FILE-16）", () => {
  it("フォルダの中の入れ子までのファイルの件数を足し、名前が前方一致するだけのフォルダは入れない", () => {
    // Arrange
    const statuses = new Map([
      ["lib/a.sysml", { errors: 1, warnings: 0 }],
      ["lib/b/c.sysml", { errors: 0, warnings: 2 }],
      ["library/x.sysml", { errors: 5, warnings: 0 }],
    ]);
    // Act・Assert
    expect(folderStatus(statuses, "lib")).toEqual({ errors: 1, warnings: 2 });
  });

  it("エラーがあれば赤、警告だけなら黄色、無ければ印を付けない", () => {
    expect(statusClass({ errors: 1, warnings: 3 })).toBe(" err");
    expect(statusClass({ errors: 0, warnings: 3 })).toBe(" warn");
    expect(statusClass({ errors: 0, warnings: 0 })).toBe("");
    expect(statusClass(undefined)).toBe("");
    expect(statusBadge({ errors: 2, warnings: 1 })).toBe('<span class="cnt err" title="エラー 2 件・警告 1 件">3</span>');
    expect(statusBadge({ errors: 0, warnings: 0 })).toBe("");
  });
});

describe("otherFiles（F-FILE-16）", () => {
  const a = { path: "a.sysml", status: { errors: 1, warnings: 0 }, rows: [] };
  const b = { path: "models/b.sysml", status: { errors: 0, warnings: 1 }, rows: [] };

  it("表示中のファイルは、数えた結果に入っていても除く（正常系）", () => {
    // Act
    const out = otherFiles([a, b], "a.sysml");
    // Assert
    expect(out).toEqual([b]);
  });

  it("表示中のファイルがフォルダの外・無題なら、何も除かない（境界値: null）", () => {
    // Assert
    expect(otherFiles([a, b], null)).toEqual([a, b]);
  });

  it("名前だけ同じで、パスの違うファイルは除かない", () => {
    // Assert
    expect(otherFiles([a, b], "b.sysml")).toEqual([a, b]);
  });
});
