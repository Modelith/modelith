// 「ファイル」メニューの「エクスポート…」のダイアログ（F-EXP-1〜F-EXP-5）。ファイル名・形式・範囲・倍率・背景を選ばせ、
// 表示中の図をファイルとしてダウンロードさせるか、PNG 画像としてクリップボードに入れる。
// 開け閉めは modal.ts に任せる（Q-8：背景を inert にし、Esc で閉じたら開いたメニューへ入力を戻す）。名前と倍率の決め方は export-file.ts に置く。

import { $, esc } from "./dom";
import { copyImage, drawioXml, download, rasterize, svgExport, type DiagramImage } from "./export";
import { EXPORT_FORMATS, EXPORT_SCALES, exportFileName, exportFormat, rasterScale, type ExportFormat } from "./export-file";
import { openModal } from "./modal";
import { activeTabLabel } from "./panels";
import { S } from "./state";
import { toast, toastFailure } from "./sync";

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
 * 範囲・背景の選択から、SVG の図を作る（F-EXP-4）。範囲が「選んだ要素」なら選んでいる要素だけを、背景が「透明」で形式が透明にできるなら透明な背景で描く。
 *
 * @param format 選んでいる形式（JPEG は背景を透明にしない）
 * @returns SVG の図と大きさ
 * @example
 * // 範囲「選んだ要素」・背景「透明」で、要素 A を選んでいる
 * selectedImage(exportFormat("png")) // → A だけを透明な背景で描いた { svg, width, height }
 */
function selectedImage(format: ExportFormat): DiagramImage {
  const selection = $<HTMLSelectElement>("#exportRange").value === "selection" && S.selSet.size > 0;
  return svgExport({ keys: selection ? S.selSet : null, transparent: transparentBackground(format) });
}

/**
 * 背景を透明にするか（背景の選択が「透明」で、形式が透明にできる）。
 *
 * @param format 選んでいる形式
 * @returns 透明にするなら true
 * @example
 * // 背景の選択が「透明」
 * transparentBackground(exportFormat("png"))  // → true
 * transparentBackground(exportFormat("jpeg")) // → false（JPEG は透明にできない）
 */
function transparentBackground(format: ExportFormat): boolean {
  return format.transparent && $<HTMLSelectElement>("#exportBg").value === "transparent";
}

/**
 * 選んでいる倍率で、画像が大きすぎるときは下げた倍率を返す（F-EXP-3）。
 *
 * @param image SVG の図と大きさ
 * @returns 書き出す倍率と、下げたかどうか
 */
function selectedScale(image: DiagramImage): { scale: number; reduced: boolean } {
  return rasterScale(image.width, image.height, Number($<HTMLSelectElement>("#exportScale").value) || 1);
}

/**
 * 倍率を下げたときに、知らせの文の後ろに添える文。
 *
 * @param s 書き出した倍率と、下げたかどうか
 * @returns 下げたなら「（図が大きいため、倍率を 1.18 倍に下げました）」、下げていなければ ""
 * @example
 * reducedNote({ scale: 1.18, reduced: true }) // → "（図が大きいため、倍率を 1.18 倍に下げました）"
 * reducedNote({ scale: 2, reduced: false })   // → ""
 */
const reducedNote = (s: { scale: number; reduced: boolean }): string => (s.reduced ? `（図が大きいため、倍率を ${s.scale} 倍に下げました）` : "");

/**
 * 形式に合わせて、選べる項目（範囲・倍率・背景・画像のコピー）を出し入れする。範囲の「選んだ要素」は、要素を選んでいてシーケンス図でないときだけ選べる。
 */
function syncFields(): void {
  const format = selectedFormat();
  $("#exportRangeField").hidden = !format.image;
  $("#exportScaleField").hidden = !format.raster;
  $("#exportBgField").hidden = !format.transparent;
  $("#exportCopy").hidden = !format.image;
  const range = $<HTMLSelectElement>("#exportRange");
  const canSelect = S.selSet.size > 0 && S.view !== "seq";
  const option = range.querySelector<HTMLOptionElement>('option[value="selection"]');
  if (option) option.disabled = !canSelect;
  if (!canSelect) range.value = "all";
}

/**
 * ファイル名の欄の名前を、選んでいる形式の拡張子に付け替え、拡張子の前までを選んだ状態にする（そのまま打てば名前を置き換えられる）。
 */
function syncNameToFormat(): void {
  const input = $<HTMLInputElement>("#exportName");
  const format = selectedFormat();
  input.value = exportFileName(input.value, format, activeTabLabel());
  input.setSelectionRange(0, input.value.length - format.extension.length);
  syncFields();
}

/**
 * 入力した名前と選んだ形式で、表示中の図をファイルにしてダウンロードさせ、ダイアログを閉じて知らせる。
 */
async function exportFile(): Promise<void> {
  const format = selectedFormat();
  const name = exportFileName($<HTMLInputElement>("#exportName").value, format, activeTabLabel());
  let note = "";
  if (!format.image) download(name, drawioXml(), format.mediaType);
  else if (!format.raster) download(name, selectedImage(format).svg, format.mediaType);
  else {
    const image = selectedImage(format);
    const scale = selectedScale(image);
    try {
      download(name, await rasterize(image, scale.scale, format.mediaType, transparentBackground(format)), format.mediaType);
    } catch (e) {
      toastFailure("画像を作れませんでした", e);
      return;
    }
    note = reducedNote(scale);
  }
  hideExportDialog();
  toast(`「${name}」をダウンロードしました${note}`);
}

/**
 * 選んだ範囲・倍率・背景の図を PNG 画像にしてクリップボードに入れ、ダイアログを閉じて知らせる（F-EXP-5）。
 * ブラウザが許さないときは、ファイルとしてエクスポートするよう知らせる（ダイアログは開いたまま）。
 */
async function copyToClipboard(): Promise<void> {
  const format = selectedFormat();
  const image = selectedImage(format);
  const scale = selectedScale(image);
  try {
    // 押した直後に書き込みを始める（Safari は、画像ができるのを待ってから書くと断る）
    await copyImage(rasterize(image, scale.scale, "image/png", transparentBackground(format)));
  } catch (e) {
    console.error(e);
    toast("画像をコピーできませんでした。このブラウザでは、PNG 画像としてエクスポートしてください");
    return;
  }
  hideExportDialog();
  toast(`図を画像としてコピーしました。ほかのアプリに貼り付けられます${reducedNote(scale)}`);
}

/**
 * エクスポートのダイアログの形式・倍率の選択欄を一覧から作り、ボタン・Enter・Esc・形式の切り替えに操作をつなぐ。起動時に 1 回呼ぶ。
 */
export function initExportDialog(): void {
  $("#exportFormat").innerHTML = EXPORT_FORMATS.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  $("#exportScale").innerHTML = EXPORT_SCALES.map((n) => `<option value="${n}">${n} 倍</option>`).join("");
  $<HTMLSelectElement>("#exportScale").value = "2";
  $("#exportFormat").addEventListener("change", syncNameToFormat);
  $<HTMLFormElement>("#exportForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    void exportFile();
  });
  $("#exportCopy").onclick = () => void copyToClipboard();
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
