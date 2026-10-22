// 図のエクスポートの形式の一覧と、ファイル名の決め方（F-EXP-1・F-EXP-2）。入出力を持たない。
// 形式はデータで持ち、ダイアログの選択欄はこの一覧から作る（形式を足すときは、一覧に足して中身を作る関数をつなぐ）。

import { baseName } from "../plugins/transfer";

/** エクスポートの形式 1 つ。 */
export interface ExportFormat {
  /** 形式の ID（選択欄の値）。 */
  id: string;
  /** 画面に出す名前（選択欄の項目）。 */
  label: string;
  /** ファイルの拡張子（点を含む小文字）。 */
  extension: string;
  /** ダウンロードするファイルの種類（MIME タイプ）。 */
  mediaType: string;
}

/** エクスポートできる形式（選択欄の並び順。先頭が既定）。 */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: "svg", label: "SVG 画像（.svg）", extension: ".svg", mediaType: "image/svg+xml" },
  { id: "drawio", label: "draw.io（.drawio）", extension: ".drawio", mediaType: "application/vnd.jgraph.mxfile" },
];

/** 名前が何も残らないときのファイル名（拡張子を除く）。 */
const FALLBACK_NAME = "図";

/**
 * ID からエクスポートの形式を探す。知らない ID なら先頭（既定）の形式を返す。
 *
 * @param id 形式の ID（"svg"・"drawio"）
 * @returns 形式
 * @example
 * exportFormat("drawio").extension // → ".drawio"
 * exportFormat("png").id           // → "svg"（知らない ID は既定）
 */
export function exportFormat(id: string): ExportFormat {
  return EXPORT_FORMATS.find((f) => f.id === id) ?? (EXPORT_FORMATS[0] as ExportFormat);
}

/**
 * 名前から、エクスポートの形式の拡張子（大文字と小文字は問わない）を 1 つ取り除く。ほかの拡張子や点は名前の一部として残す。
 *
 * @param name ファイル名
 * @returns 拡張子を除いた名前
 * @example
 * withoutExportExtension("図.SVG")   // → "図"
 * withoutExportExtension("図.drawio") // → "図"
 * withoutExportExtension("v1.2")      // → "v1.2"（形式の拡張子でない）
 */
function withoutExportExtension(name: string): string {
  const lower = name.toLowerCase();
  const known = EXPORT_FORMATS.find((f) => lower.endsWith(f.extension));
  return known ? name.slice(0, name.length - known.extension.length) : name;
}

/**
 * エクスポートするファイルの名前を決める。パスの部分と使えない文字を除き、拡張子を形式に合わせて付ける。
 * 名前がエクスポートの形式の拡張子（.svg・.drawio）で終わっていれば、選んだ形式のものに付け替える。
 * それ以外の点（「v1.2」など）は名前の一部として残す。名前が何も残らなければ、既定の名前（表示中の図の名前）を使う。
 *
 * @param input 利用者が入力した名前
 * @param format 選んだ形式
 * @param fallback 名前が何も残らないときに使う名前（表示中の図の名前）
 * @returns ファイル名（拡張子つき）
 * @example
 * exportFileName("給水システム", svg, "トレーサビリティ")        // → "給水システム.svg"（拡張子なし）
 * exportFileName("給水システム.svg", drawio, "トレーサビリティ") // → "給水システム.drawio"（違う形式の拡張子を付け替える）
 * exportFileName("給水システム.SVG", svg, "トレーサビリティ")    // → "給水システム.svg"
 * exportFileName("  ", svg, "トレーサビリティ")                  // → "トレーサビリティ.svg"（境界値: 空白だけ）
 * exportFileName("a/b\\図:1", svg, "x")                          // → "図_1.svg"（パスと使えない文字）
 * exportFileName(".svg", svg, "トレーサビリティ")               // → "トレーサビリティ.svg"（拡張子だけ）
 * exportFileName("", svg, "")                                    // → "図.svg"（境界値: 何も残らない）
 */
export function exportFileName(input: string, format: ExportFormat, fallback: string): string {
  // 拡張子は、使えない文字と前後の点を除く前と後の両方で外す（「.svg」だけの名前を「svg」と読まず、「図.svg.」の末尾の点も許す）
  const clean = (name: string): string => withoutExportExtension(baseName(withoutExportExtension(name.split(/[\\/]/).pop()?.trim() ?? "")));
  const name = clean(input) || clean(fallback) || FALLBACK_NAME;
  return name + format.extension;
}
