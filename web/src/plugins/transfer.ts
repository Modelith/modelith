// v1 のプラグインの取り込み（import）と書き出し（export）の判断（ADR-0018 §3・§4）。入出力を持たない。
// ファイルの中身は base64 でやり取りする。大きさの上限、新しい文書の名前、ダウンロードするファイルの名前と種類をここで決める。

/** 取り込むファイルと、書き出されたファイルの大きさの上限（バイト）。ブラウザのメモリとメッセージの受け渡しに無理のない大きさにする。 */
export const MAX_TRANSFER_BYTES = 20 * 1024 * 1024;

/** ファイル名に使えない文字（Windows と macOS の両方で困るもの）。 */
const BAD_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * バイト数を、画面に出す大きさの言葉にする（1024 を単位にする）。
 *
 * @param bytes バイト数（0 以上）
 * @returns 「20 MB」「512 KB」「10 バイト」のような言葉（小数は 1 桁まで、.0 は省く）
 * @example
 * sizeText(20 * 1024 * 1024) // → "20 MB"
 * sizeText(1536)             // → "1.5 KB"
 * sizeText(10)               // → "10 バイト"
 * sizeText(0)                // → "0 バイト"（境界値）
 */
export function sizeText(bytes: number): string {
  const units: [number, string][] = [[1024 * 1024, "MB"], [1024, "KB"]];
  for (const [unit, label] of units) if (bytes >= unit) return `${Number((bytes / unit).toFixed(1))} ${label}`;
  return `${bytes} バイト`;
}

/**
 * base64 の文字列を確かめ、元のバイト数を求める（デコードはしない）。
 *
 * @param base64 base64 の文字列（改行や空白を含まない、標準の文字と = の詰め物）
 * @returns 元のバイト数。base64 として正しくなければ null
 * @example
 * base64Bytes("YWJj")  // → 3
 * base64Bytes("YQ==")  // → 1
 * base64Bytes("")      // → 0（境界値: 空のファイル）
 * base64Bytes("YWJ")   // → null（長さが 4 の倍数でない）
 * base64Bytes("Y*==")  // → null（使えない文字）
 */
export function base64Bytes(base64: string): number | null {
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/**
 * バイト列を base64 にする（大きなファイルでも呼び出しの引数の上限を超えないよう、区切って変換する）。
 *
 * @param bytes バイト列
 * @returns base64 の文字列
 * @example
 * bytesToBase64(new Uint8Array([97, 98, 99])) // → "YWJj"
 * bytesToBase64(new Uint8Array([]))           // → ""（境界値）
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/**
 * base64 をバイト列に戻す。
 *
 * @param base64 base64 の文字列（base64Bytes で確かめたもの）
 * @returns バイト列。正しくない文字列なら例外（DOMException）を投げる
 * @example
 * base64ToBytes("YWJj") // → Uint8Array [97, 98, 99]
 * base64ToBytes("")     // → Uint8Array []（境界値）
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * パスの最後の名前を取り出し、ファイル名に使えない文字を「_」に置き換える。
 *
 * @param fileName プラグインが示したファイル名（パスを含むこともある）
 * @returns 整えた名前（前後の空白と点を除く）。何も残らなければ ""
 * @example
 * baseName("dir/要求一覧.reqif") // → "要求一覧.reqif"
 * baseName("a:b?.csv")           // → "a_b_.csv"
 * baseName("  ")                 // → ""（境界値）
 */
function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? "";
  return last.replace(BAD_NAME_CHARS, "_").trim().replace(/^\.+|\.+$/g, "");
}

/**
 * 取り込んだテキストを開く、新しい無題の文書の名前を決める（拡張子を .sysml にし、開いている文書と重ならない番号を付ける。C-6）。
 *
 * @param fileName プラグインが示したファイル名（`imported` の fileName）
 * @param used 開いている文書の名前
 * @returns 文書の名前
 * @example
 * importedDocName("要求一覧.reqif", new Set())                  // → "要求一覧.sysml"
 * importedDocName("要求一覧.reqif", new Set(["要求一覧.sysml"])) // → "要求一覧-2.sysml"
 * importedDocName("model.sysml", new Set())                     // → "model.sysml"
 * importedDocName("../", new Set())                             // → "imported.sysml"（境界値: 名前が残らない）
 */
export function importedDocName(fileName: string, used: ReadonlySet<string>): string {
  const name = baseName(fileName);
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name) || "imported";
  let candidate = `${stem}.sysml`;
  for (let n = 2; used.has(candidate); n++) candidate = `${stem}-${n}.sysml`;
  return candidate;
}

/**
 * 書き出されたファイルを保存する名前を決める。拡張子が無ければ、書き出しの拡張子を付ける。
 *
 * @param fileName プラグインが示したファイル名（`exported` の fileName）
 * @param extension 書き出しの拡張子（マニフェストの `extension`。例：".csv"）
 * @returns ファイル名
 * @example
 * exportFileName("要求一覧.csv", ".csv") // → "要求一覧.csv"
 * exportFileName("要求一覧", ".csv")     // → "要求一覧.csv"
 * exportFileName("../x/a?.csv", ".csv")  // → "a_.csv"
 * exportFileName("", ".csv")             // → "export.csv"（境界値）
 */
export function exportFileName(fileName: string, extension: string): string {
  const name = baseName(fileName) || "export";
  return name.includes(".") ? name : `${name}${extension.startsWith(".") || extension === "" ? "" : "."}${extension}`;
}

/**
 * ダウンロードするファイルの種類（MIME タイプ）を決める。形の正しくないものは、ただのバイト列として扱う。
 *
 * @param mediaType プラグインが示した種類（`exported` の mediaType）
 * @returns 種類
 * @example
 * mediaTypeOf("text/csv")                  // → "text/csv"
 * mediaTypeOf("text/csv; charset=utf-8")   // → "text/csv; charset=utf-8"
 * mediaTypeOf("<script>")                  // → "application/octet-stream"
 * mediaTypeOf("")                          // → "application/octet-stream"（境界値）
 */
export function mediaTypeOf(mediaType: string): string {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(\s*;\s*[a-z0-9_-]+=[a-z0-9_.-]+)*$/i.test(mediaType) ? mediaType : "application/octet-stream";
}

/**
 * ファイルを選ぶ画面に渡す、選べるファイルの絞り込み（input の accept）を作る。
 *
 * @param extensions 取り込みが対応する拡張子（例：[".reqif", "xml"]）
 * @returns accept の値（点の付いた拡張子をカンマでつなぐ）
 * @example
 * acceptOf([".reqif", "xml"]) // → ".reqif,.xml"
 * acceptOf([])                // → ""（境界値: 絞り込まない）
 */
export function acceptOf(extensions: readonly string[]): string {
  return extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)).join(",");
}
