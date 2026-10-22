// フォルダのすべてのファイルの問題（ADR-0021 §6、F-FILE-16）。問題一覧の行とファイルの一覧の色・件数を決める。
// コアが数えたファイルごとの問題を受け取り、ここでは重さの分け方・件数・行の文だけを決める（描くのは sync.ts・files.ts）。

import { lineOf, type FileReport, type Problem, type RuleFinding } from "../core";
import { findingText, SEVERITY_MARK } from "./plugins";

/** ファイルのエラーと警告の件数。 */
export interface FileStatus {
  errors: number;
  warnings: number;
}

/** 問題一覧の、ほかのファイルの 1 行。 */
export interface FileProblemRow {
  /** そのファイルの中の位置（UTF-16）。 */
  pos: number;
  /** 1 から数えた行。 */
  line: number;
  /** 行の見た目（問題の種類か、チェックルールの重さ）。 */
  cls: string;
  /** 行の頭の印（⚠・△・ℹ）。 */
  mark: string;
  /** 行の文。 */
  text: string;
}

/** ほかのファイル 1 つの、問題一覧に出す行と件数。 */
export interface FileProblems {
  path: string;
  status: FileStatus;
  rows: FileProblemRow[];
}

/** モデルの問題の印（エラー・トレースの抜け・まだ扱えない構文）。表示中のファイルの行と同じ。 */
const PROBLEM_MARK = { gap: "△", unsupported: "ℹ" } as const;

/**
 * モデルの問題とチェックルールの結果から、エラーと警告の件数を数える。エラーは構文エラー・見つからない型など（種類の無い問題）とルールのエラー、
 * 警告はトレースの抜けとルールの警告。まだ扱えない構文と、情報・ヒントのルールは数えない。
 *
 * @param problems モデルの問題
 * @param findings チェックルールの結果
 * @returns エラーと警告の件数
 * @example
 * fileStatus([{ pos: 0, msg: "…" }, { pos: 9, msg: "…", kind: "gap" }], [{ severity: "error", … }]) // → { errors: 2, warnings: 1 }
 * fileStatus([{ pos: 0, msg: "…", kind: "unsupported" }], [])                                     // → { errors: 0, warnings: 0 }
 */
export function fileStatus(problems: readonly Problem[], findings: readonly RuleFinding[]): FileStatus {
  const errors = problems.filter((p) => p.kind === undefined).length + findings.filter((f) => f.severity === "error").length;
  const warnings = problems.filter((p) => p.kind === "gap").length + findings.filter((f) => f.severity === "warning").length;
  return { errors, warnings };
}

/**
 * コアが数えたほかのファイル 1 つの問題を、問題一覧の行にする。表示中のファイルと同じく、エラー → ルールの結果 → 抜けとまだ扱えない構文の順に並べる。
 *
 * @param report コアが数えたファイルの問題
 * @param text そのファイルのテキスト（行を数える。無ければ 1 行目とする）
 * @param names プラグインの ID → 画面に出す名前
 * @returns 行と件数
 * @example
 * fileProblems({ path: "parts.sysml", problems: [{ pos: 33, msg: "型「Wheel」が見つかりません（w）" }], findings: [] }, partsText, new Map())
 * // → { path: "parts.sysml", status: { errors: 1, warnings: 0 }, rows: [{ pos: 33, line: 2, cls: "", mark: "⚠", text: "型「Wheel」が見つかりません（w）" }] }
 */
export function fileProblems(report: FileReport, text: string | undefined, names: ReadonlyMap<string, string>): FileProblems {
  const line = (pos: number): number => (text === undefined ? 1 : lineOf(text, pos));
  const model = (p: Problem): FileProblemRow => ({ pos: p.pos, line: line(p.pos), cls: p.kind ?? "", mark: p.kind ? PROBLEM_MARK[p.kind] : "⚠", text: p.msg });
  const rule = (f: RuleFinding): FileProblemRow => ({ pos: f.pos, line: line(f.pos), cls: `rule ${f.severity}`, mark: SEVERITY_MARK[f.severity], text: findingText(f, names) });
  const rows = [...report.problems.filter((p) => !p.kind).map(model), ...report.findings.map(rule), ...report.problems.filter((p) => p.kind).map(model)];
  return { path: report.path, status: fileStatus(report.problems, report.findings), rows };
}

/**
 * フォルダの中の（入れ子も含む）ファイルの件数を足す。エラーのあるファイルを中に持つフォルダに印を付けるのに使う。
 *
 * @param statuses ファイルのパス → 件数
 * @param dir フォルダのパス（フォルダからの相対パス）
 * @returns フォルダの中のファイルの件数の合計
 * @example
 * folderStatus(new Map([["lib/a.sysml", { errors: 1, warnings: 0 }], ["lib/b/c.sysml", { errors: 0, warnings: 2 }], ["x.sysml", { errors: 5, warnings: 0 }]]), "lib")
 * // → { errors: 1, warnings: 2 }
 */
export function folderStatus(statuses: ReadonlyMap<string, FileStatus>, dir: string): FileStatus {
  const sum: FileStatus = { errors: 0, warnings: 0 };
  for (const [path, s] of statuses) {
    if (!path.startsWith(`${dir}/`)) continue;
    sum.errors += s.errors;
    sum.warnings += s.warnings;
  }
  return sum;
}

/**
 * ファイルの一覧に添える件数の印の HTML。エラーがあれば赤、警告だけなら黄色の件数（ツールチップに内訳）。無ければ空。
 *
 * @param s 件数
 * @returns `<span class="cnt err" title="エラー 2 件・警告 1 件">3</span>` のような HTML。どちらも 0 なら ""
 * @example
 * statusBadge({ errors: 2, warnings: 1 }) // → '<span class="cnt err" title="エラー 2 件・警告 1 件">3</span>'
 * statusBadge({ errors: 0, warnings: 0 }) // → ""
 */
export function statusBadge(s: FileStatus): string {
  const n = s.errors + s.warnings;
  if (!n) return "";
  return `<span class="cnt ${s.errors ? "err" : "warn"}" title="エラー ${s.errors} 件・警告 ${s.warnings} 件">${n}</span>`;
}

/**
 * ファイルの一覧の行に付ける、件数に合った見た目の名前（エラーは赤・警告だけは黄色）。
 *
 * @param s 件数（無ければ問題なし）
 * @returns " err"・" warn"・""（行の class に足す）
 * @example
 * statusClass({ errors: 1, warnings: 3 }) // → " err"
 * statusClass({ errors: 0, warnings: 3 }) // → " warn"
 * statusClass(undefined)                  // → ""
 */
export function statusClass(s: FileStatus | undefined): string {
  if (!s) return "";
  return s.errors ? " err" : s.warnings ? " warn" : "";
}
