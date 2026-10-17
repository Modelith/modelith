// プロジェクト（ADR-0019、F-PROJ-1）の画面の言葉。判断だけの純粋関数。

import type { ProjectFile, ProjectProblem } from "../core";

/**
 * エクスプローラーのフォルダの見出しに出す名前を決める。プロジェクト名があればそれ、無ければフォルダ名。
 *
 * @param folderName 開いているフォルダの名前
 * @param project 読み取ったプロジェクトの設定（設定ファイルが無い・読み取れないときは null）
 * @returns 見出しに出す名前
 * @example
 * projectTitle("water", { name: "給水システム", plugins: {} }) // → "給水システム"
 * projectTitle("water", { plugins: {} })                     // → "water"（名前が無い）
 * projectTitle("water", { name: "  ", plugins: {} })         // → "water"（境界値: 空白だけの名前）
 * projectTitle("water", null)                                // → "water"
 */
export function projectTitle(folderName: string, project: ProjectFile | null): string {
  const name = project?.name?.trim();
  return name ? name : folderName;
}

/**
 * 設定ファイルの問題を、トーストに出す 1 つの文にする。誤りがあれば誤りを、無ければ注意を先に出す。
 *
 * @param problems 設定ファイルの問題（行・列は 1 始まり）
 * @returns トーストの文。問題が無ければ null
 * @example
 * projectNotice([]) // → null
 * projectNotice([{ severity: "warning", line: 3, column: 3, message: "知らない項目「x」があります。消さずに残します" }])
 * // → "プロジェクトの設定（modelith.json）の 3 行目：知らない項目「x」があります。消さずに残します"
 * projectNotice([warning, { severity: "error", line: 2, column: 5, message: "書き方に誤りがあるため読み取れません（…）" }])
 * // → "プロジェクトの設定（modelith.json）を使えません。2 行目：書き方に誤りがあるため読み取れません（…）（ほかに 1 件）"
 */
export function projectNotice(problems: readonly ProjectProblem[]): string | null {
  const first = problems.find((p) => p.severity === "error") ?? problems[0];
  if (!first) return null;
  const head = first.severity === "error" ? "プロジェクトの設定（modelith.json）を使えません。" : "プロジェクトの設定（modelith.json）の ";
  const more = problems.length > 1 ? `（ほかに ${problems.length - 1} 件）` : "";
  return `${head}${first.line} 行目：${first.message}${more}`;
}
