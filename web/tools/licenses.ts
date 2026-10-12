// 配布物に添えるライセンス文を組み立てる（純粋関数）。ファイルの読み込みは呼び出し側（vite.config.ts）が渡す。

/** 同梱する第三者の部品。text はその部品のライセンス文。 */
export interface BundledPart {
  name: string;
  /** SPDX のライセンス ID。 */
  license: string;
  /** 配布物のどこに入っているか。 */
  usage: string;
  text: string;
}

/** Vite の LICENSE.md から、Vite 本体（MIT）の部分だけを取り出す。配布物に入るのは Vite 本体の小さな実行時コードだけで、Vite が同梱する依存は入らない。 */
export function viteCoreLicense(licenseMd: string): string {
  const end = licenseMd.indexOf("\n# Licenses of bundled dependencies");
  if (end < 0) throw new Error("Vite の LICENSE.md の形式が変わった：本体の部分を切り出せない");
  return licenseMd.slice(0, end).trim();
}

/** licenses.txt：同梱物の一覧と、それぞれのライセンス全文。 */
export function thirdPartyNotices(parts: BundledPart[]): string {
  const list = parts.map((p) => `- ${p.name}（${p.license}）：${p.usage}`).join("\n");
  const bodies = parts.map((p) => `==== ${p.name}（${p.license}） ====\n\n${p.text.trim()}`).join("\n\n");
  return `Modelith に同梱している第三者の部品とライセンス\n\n${list}\n\n${bodies}\n`;
}

/** LICENSE.txt：Modelith 本体のライセンス（著作権表示・AGPL-3.0 全文・プラグイン例外）。 */
export function appLicense(copyright: string, agpl: string, pluginException: string): string {
  return `${copyright}\n\nModelith は GNU Affero General Public License version 3（以下の全文）に、Modelith Plugin Exception（末尾）を加えた条件で提供します。\n\n${agpl.trim()}\n\n${pluginException.trim()}\n`;
}
