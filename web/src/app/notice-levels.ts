// 知らせの重さ（F-EDIT-11）の画面の言葉と、問題の重さの決め方。判断だけの純粋関数。
// 重さを当てるのはコア（levels）。ここでは、コアが付けた重さ（無ければ既定）を印・数え方・選ぶ画面の行にする。

import type { Problem, ProblemKind, ProblemLevel } from "../core";

/** 問題一覧に出す重さ（出さないものは一覧に来ない）。 */
export type ShownLevel = Exclude<ProblemLevel, "off">;

/** 重さの、画面に出す名前（選択欄の項目）。 */
export const LEVEL_LABEL: Record<ProblemLevel, string> = { error: "エラー", warning: "警告", info: "情報", off: "出さない" };

/** 重さの、問題一覧の行の頭の印。 */
export const LEVEL_MARK: Record<ShownLevel, string> = { error: "⚠", warning: "△", info: "ℹ" };

/**
 * モデルの問題の重さ。プロジェクトで選んだ重さがあればそれ、無ければ種類の既定（エラー・トレースの抜けは警告・まだ扱えない書き方は情報）。
 *
 * @param p モデルの問題
 * @returns 重さ
 * @example
 * problemLevel({ pos: 0, msg: "…" })                                  // → "error"
 * problemLevel({ pos: 0, msg: "…", kind: "gap" })                     // → "warning"
 * problemLevel({ pos: 0, msg: "…", kind: "unsupported" })             // → "info"
 * problemLevel({ pos: 0, msg: "…", kind: "gap", level: "error" })     // → "error"（プロジェクトで選んだ重さ）
 */
export function problemLevel(p: Problem): ShownLevel {
  if (p.level) return p.level;
  return p.kind === "gap" ? "warning" : p.kind === "unsupported" ? "info" : "error";
}

/** 知らせの重さを選ぶ画面の 1 行。 */
export interface LevelRow {
  /** 設定に書く種類の名前（`trace.verify`・`プラグインの ID/ルールの ID`）。 */
  kind: string;
  /** 画面に出す名前。 */
  label: string;
  /** 「既定」の項目の名前（「既定（警告）」など）。 */
  defaultLabel: string;
  /** 選んでいる重さ。既定のままなら null。 */
  value: ProblemLevel | null;
}

/** 読み込んだチェックルールのプラグイン 1 つ（重さを選ぶ画面に並べる）。 */
export interface RuleSet {
  /** プラグインの ID。 */
  plugin: string;
  /** 画面に出すプラグインの名前。 */
  name: string;
  /** ルールの ID（書いた順）。 */
  rules: string[];
}

/**
 * 知らせの重さを選ぶ画面の行を作る。モデルの知らせの種類を先に、続けてプラグインごとのチェックルールを並べる。
 * 設定に書いてあるが、今は読み込んでいないルールの種類も、消せるように最後に並べる。
 *
 * @param kinds モデルの知らせの種類（コアの並び順）
 * @param rules 読み込んだチェックルールのプラグイン
 * @param levels 設定に書いてある重さ（種類 → 重さ）
 * @returns 行の並び
 * @example
 * levelRows([{ code: "unsupported", label: "まだ扱えない書き方", default: "info" }], [{ plugin: "jp.x", name: "チェック", rules: ["r1"] }], { "jp.x/r1": "off" })
 * // → [{ kind: "unsupported", label: "まだ扱えない書き方", defaultLabel: "既定（情報）", value: null },
 * //    { kind: "jp.x/r1", label: "チェックルール：チェック／r1", defaultLabel: "既定（ルールに書いた重さ）", value: "off" }]
 */
export function levelRows(kinds: readonly ProblemKind[], rules: readonly RuleSet[], levels: Readonly<Record<string, ProblemLevel>>): LevelRow[] {
  const model = kinds.map((k) => ({ kind: k.code, label: k.label, defaultLabel: `既定（${LEVEL_LABEL[k.default]}）`, value: levels[k.code] ?? null }));
  const ruleRow = (kind: string, label: string): LevelRow => ({ kind, label, defaultLabel: "既定（ルールに書いた重さ）", value: levels[kind] ?? null });
  const loaded = rules.flatMap((s) => s.rules.map((r) => ruleRow(`${s.plugin}/${r}`, `チェックルール：${s.name}／${r}`)));
  const shown = new Set([...model, ...loaded].map((r) => r.kind));
  const rest = Object.keys(levels).filter((k) => !shown.has(k)).sort().map((k) => ruleRow(k, `チェックルール：${k}（読み込んでいません）`));
  return [...model, ...loaded, ...rest];
}
