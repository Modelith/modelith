// 図のエクスポートの形式の一覧と、ファイル名・画像の倍率の決め方（F-EXP-1〜F-EXP-4）。入出力を持たない。
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
  /** 画像か（範囲を選べ、「画像をコピー」を使える。F-EXP-4・F-EXP-5）。 */
  image: boolean;
  /** 点の並びの画像か（倍率を選べる。F-EXP-3）。 */
  raster: boolean;
  /** 背景を透明にできるか（F-EXP-4）。 */
  transparent: boolean;
}

/** エクスポートできる形式（選択欄の並び順。先頭が既定）。 */
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: "svg", label: "SVG 画像（.svg）", extension: ".svg", mediaType: "image/svg+xml", image: true, raster: false, transparent: true },
  { id: "png", label: "PNG 画像（.png）", extension: ".png", mediaType: "image/png", image: true, raster: true, transparent: true },
  { id: "jpeg", label: "JPEG 画像（.jpg）", extension: ".jpg", mediaType: "image/jpeg", image: true, raster: true, transparent: false },
  { id: "drawio", label: "draw.io（.drawio）", extension: ".drawio", mediaType: "application/vnd.jgraph.mxfile", image: false, raster: false, transparent: false },
];

/** 選べる倍率（F-EXP-3）。 */
export const EXPORT_SCALES: readonly number[] = [1, 2, 3];

/** 画像の 1 辺の上限（点の数。多くのブラウザの canvas の上限）。 */
const MAX_SIDE = 16384;

/** 画像の面積の上限（点の数。canvas の上限がいちばん小さいブラウザ（Safari）に合わせる）。 */
const MAX_AREA = 4096 * 4096;

/** 名前が何も残らないときのファイル名（拡張子を除く）。 */
const FALLBACK_NAME = "図";

/**
 * ID からエクスポートの形式を探す。知らない ID なら先頭（既定）の形式を返す。
 *
 * @param id 形式の ID（"svg"・"png"・"jpeg"・"drawio"）
 * @returns 形式
 * @example
 * exportFormat("drawio").extension // → ".drawio"
 * exportFormat("gif").id           // → "svg"（知らない ID は既定）
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
 * withoutExportExtension("図.jpg")    // → "図"
 * withoutExportExtension("v1.2")      // → "v1.2"（形式の拡張子でない）
 */
function withoutExportExtension(name: string): string {
  const lower = name.toLowerCase();
  const known = EXPORT_FORMATS.find((f) => lower.endsWith(f.extension));
  return known ? name.slice(0, name.length - known.extension.length) : name;
}

/**
 * エクスポートするファイルの名前を決める。パスの部分と使えない文字を除き、拡張子を形式に合わせて付ける。
 * 名前がエクスポートの形式の拡張子（.svg・.png・.jpg・.drawio）で終わっていれば、選んだ形式のものに付け替える。
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

/**
 * 画像に書き出す倍率を決める。選んだ倍率で画像がブラウザの扱える大きさ（1 辺 16384・面積 4096×4096 の点）を超えるなら、収まるまで下げる（F-EXP-3）。
 *
 * @param width 図の幅（倍率 1 の点の数）
 * @param height 図の高さ（倍率 1 の点の数）
 * @param scale 選んだ倍率
 * @returns 書き出す倍率と、下げたかどうか（下げた倍率は小数第 2 位までに切り捨てる）
 * @example
 * rasterScale(800, 600, 2)    // → { scale: 2, reduced: false }
 * rasterScale(4000, 3000, 3)  // → { scale: 1.18, reduced: true }（面積の上限）
 * rasterScale(20000, 100, 1)  // → { scale: 0.81, reduced: true }（1 辺の上限）
 */
export function rasterScale(width: number, height: number, scale: number): { scale: number; reduced: boolean } {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const limit = Math.min(MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
  if (scale <= limit) return { scale, reduced: false };
  return { scale: Math.floor(limit * 100) / 100, reduced: true };
}
