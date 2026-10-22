// 「表示」メニューの「知らせの重さ…」のダイアログ（F-EDIT-11）。知らせの種類ごとに重さを選ばせ、プロジェクトの設定（modelith.json）に書く。
// 行の作り方は notice-levels.ts、設定ファイルの書き換えは plugin-panel.ts（changeProjectFile）に任せる。

import type { ProblemLevel } from "../core";
import { $, esc } from "./dom";
import { openModal } from "./modal";
import { LEVEL_LABEL, levelRows, type LevelRow } from "./notice-levels";
import { changeProjectFile, projectLevels, ruleSets } from "./plugin-panel";
import { coreClient } from "./sync";

/** 開いているダイアログを閉じる操作（閉じていれば null）。 */
let closeDialog: (() => void) | null = null;

/** 選択欄に並べる重さ（既定の後に、この順で）。 */
const CHOICES: readonly ProblemLevel[] = ["error", "warning", "info", "off"];

/**
 * 知らせの重さのダイアログを閉じ、開く前の要素へ入力を戻す（Q-8）。閉じていれば何もしない。
 */
function hideLevelsDialog(): void {
  closeDialog?.();
  closeDialog = null;
}

/**
 * 重さを選ぶ 1 行の HTML。
 *
 * @param r 行
 * @param editable 選べるか（プロジェクトが無ければ選べない）
 * @returns 行の HTML
 * @example
 * rowHtml({ kind: "unsupported", label: "まだ扱えない書き方", defaultLabel: "既定（情報）", value: "off" }, true)
 * // → '<label class="lvrow"><span>まだ扱えない書き方</span><select data-kind="unsupported"><option value="">既定（情報）</option>…<option value="off" selected>出さない</option></select></label>'
 */
function rowHtml(r: LevelRow, editable: boolean): string {
  const options = [`<option value="">${esc(r.defaultLabel)}</option>`, ...CHOICES.map((l) => `<option value="${l}"${r.value === l ? " selected" : ""}>${LEVEL_LABEL[l]}</option>`)];
  return `<label class="lvrow"><span>${esc(r.label)}</span><select data-kind="${esc(r.kind)}"${editable ? "" : " disabled"}>${options.join("")}</select></label>`;
}

/**
 * 知らせの重さのダイアログの中身を作る。プロジェクトが無ければ、選べないことと、選べるようにする方法を示す。
 */
async function renderLevels(): Promise<void> {
  const levels = projectLevels();
  const rows = levelRows(await coreClient().problemKinds(), ruleSets(), levels ?? {});
  $("#levelsText").textContent = levels
    ? "問題一覧に出す知らせの重さを、種類ごとに選びます。選んだ重さはプロジェクトの設定（modelith.json）に保存し、チームの全員とコマンドラインのチェックに使われます。構文エラーと見つからない型の重さは変えられません。"
    : "知らせの重さは、プロジェクトの設定（modelith.json）に保存します。フォルダを開いて「プロジェクトにする」を選ぶと、変えられるようになります。";
  $("#levelsList").innerHTML = rows.map((r) => rowHtml(r, levels !== null)).join("");
}

/**
 * 選んだ重さをプロジェクトの設定に書く（既定を選んだら、その項目を消す）。
 *
 * @param kind 知らせの種類
 * @param value 選んだ重さ（空文字列なら既定）
 */
async function chooseLevel(kind: string, value: string): Promise<void> {
  const level = (CHOICES as readonly string[]).includes(value) ? (value as ProblemLevel) : null;
  await changeProjectFile((text) => coreClient().updateProjectLevel(text, kind, level), "知らせの重さを変更しました");
}

/**
 * 知らせの重さのダイアログの操作（選択・閉じる・Esc）をつなぐ。起動時に 1 回呼ぶ。
 */
export function initLevelsDialog(): void {
  $("#levelsList").addEventListener("change", (ev) => {
    const sel = ev.target as HTMLSelectElement;
    const kind = sel.dataset["kind"];
    if (kind !== undefined) void chooseLevel(kind, sel.value);
  });
  $("#levelsClose").onclick = hideLevelsDialog;
  $("#levelsDialog").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideLevelsDialog();
  });
}

/**
 * 知らせの重さのダイアログを開く（F-EDIT-11）。
 */
export function showLevelsDialog(): void {
  closeDialog = openModal($("#levelsDialog"));
  $("#levelsClose").focus();
  void renderLevels();
}
