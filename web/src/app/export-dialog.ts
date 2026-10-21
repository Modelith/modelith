// 「ファイル」メニューの「エクスポート…」のダイアログ（F-EXP-1・F-EXP-2）。ファイル名と形式を選ばせ、表示中の図をファイルとしてダウンロードさせる。
// 開け閉めは modal.ts に任せる（Q-8：背景を inert にし、Esc で閉じたら開いたメニューへ入力を戻す）。名前の決め方は export-file.ts に置く。

import { $, esc } from "./dom";
import { drawioXml, download, svgExport } from "./export";
import { EXPORT_FORMATS, exportFileName, exportFormat, type ExportFormat } from "./export-file";
import { openModal } from "./modal";
import { activeTabLabel } from "./panels";
import { toast } from "./sync";

/** 形式ごとに、表示中の図からファイルの中身を作る関数。 */
const CONTENT: Record<string, () => string> = { svg: svgExport, drawio: drawioXml };

/** 開いているエクスポートのダイアログを閉じる操作（閉じていれば null）。 */
let closeDialog: (() => void) | null = null;

/** エクスポートのダイアログを閉じ、開く前の要素へ入力を戻す（Q-8）。閉じていれば何もしない。 */
function hideExportDialog(): void {
  closeDialog?.();
  closeDialog = null;
}

/**
 * 選択欄で選んでいる形式を返す。
 *
 * @returns 形式（知らない値なら既定の形式）
 * @example
 * // 選択欄で「draw.io（.drawio）」を選んでいる
 * selectedFormat().extension // → ".drawio"
 */
function selectedFormat(): ExportFormat {
  return exportFormat($<HTMLSelectElement>("#exportFormat").value);
}

/**
 * ファイル名の欄の名前を、選んでいる形式の拡張子に付け替え、拡張子の前までを選んだ状態にする（そのまま打てば名前を置き換えられる）。
 */
function syncNameToFormat(): void {
  const input = $<HTMLInputElement>("#exportName");
  const format = selectedFormat();
  input.value = exportFileName(input.value, format, activeTabLabel());
  input.setSelectionRange(0, input.value.length - format.extension.length);
}

/**
 * 入力した名前と選んだ形式で、表示中の図をファイルにしてダウンロードさせ、ダイアログを閉じて知らせる。
 */
function exportFile(): void {
  const format = selectedFormat();
  const name = exportFileName($<HTMLInputElement>("#exportName").value, format, activeTabLabel());
  const content = CONTENT[format.id];
  if (!content) return;
  download(name, content(), format.mediaType);
  hideExportDialog();
  toast(`「${name}」をダウンロードしました`);
}

/**
 * エクスポートのダイアログの形式の選択欄を形式の一覧から作り、ボタン・Enter・Esc・形式の切り替えに操作をつなぐ。起動時に 1 回呼ぶ。
 */
export function initExportDialog(): void {
  $("#exportFormat").innerHTML = EXPORT_FORMATS.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  $("#exportFormat").addEventListener("change", syncNameToFormat);
  $<HTMLFormElement>("#exportForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    exportFile();
  });
  $("#exportCancel").onclick = hideExportDialog;
  $("#exportDialog").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideExportDialog();
  });
}

/**
 * エクスポートのダイアログを開く。ファイル名の既定は表示中の図の名前で、入力はファイル名の欄に置く（Q-8）。
 */
export function showExportDialog(): void {
  closeDialog = openModal($("#exportDialog"));
  $<HTMLInputElement>("#exportName").value = activeTabLabel();
  $<HTMLInputElement>("#exportName").focus();
  syncNameToFormat();
}
