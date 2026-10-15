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

/** `cargo metadata` の出力のうち、ここで使う部分。 */
export interface CargoPackage {
  id: string;
  name: string;
  version: string;
  license: string | null;
  /** 取得元。リポジトリの中のクレート（Modelith 自身）は null。 */
  source: string | null;
  manifest_path: string;
  targets: { kind: string[] }[];
}
export interface CargoMetadata {
  packages: CargoPackage[];
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] };
}

/**
 * wasm に組み込まれる第三者のクレート。`root` から通常の依存（ビルド用・テスト用を除く）をたどる。
 * 手続きマクロとその依存はビルドのときだけ使い、配布物に入らないので、たどらない。Modelith 自身のクレートは除く。
 */
export function wasmRuntimeCrates(meta: CargoMetadata, root: string): CargoPackage[] {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const rootId = meta.packages.find((p) => p.name === root)?.id;
  if (!rootId) throw new Error(`cargo metadata に ${root} がありません`);
  const seen = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const d of nodes.get(stack.pop()!)?.deps ?? []) {
      const p = byId.get(d.pkg);
      const normal = d.dep_kinds.some((k) => k.kind === null);
      const macro = p?.targets.some((t) => t.kind.includes("proc-macro"));
      if (!p || !normal || macro || seen.has(d.pkg)) continue;
      seen.add(d.pkg);
      stack.push(d.pkg);
    }
  }
  return [...seen]
    .flatMap((id) => byId.get(id) ?? [])
    .filter((p) => p.source !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * SPDX の式から、同梱するときに従うライセンスを選ぶ。選べるとき（OR）は MIT を選び、AND はすべてに従う。
 * 例: `MIT OR Apache-2.0` → MIT、`(MIT OR Apache-2.0) AND Unicode-3.0` → MIT と Unicode-3.0。
 */
export function chooseLicenses(spdx: string): string[] {
  return spdx
    .replace(/[()]/g, "")
    .split(/\s+AND\s+/)
    .map((clause) => {
      const options = clause.split(/\s+OR\s+|\//).map((s) => s.trim());
      return options.includes("MIT") ? "MIT" : options[0]!;
    });
}

/** ライセンスごとの、クレートに入っているライセンス文のファイル名（先にあるものを使う）。 */
export const LICENSE_FILES: Record<string, string[]> = {
  MIT: ["LICENSE-MIT", "LICENSE-MIT.md", "LICENSE"],
  "Apache-2.0": ["LICENSE-APACHE", "LICENSE"],
  "Unicode-3.0": ["LICENSE-UNICODE"],
};
