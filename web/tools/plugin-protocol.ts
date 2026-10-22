// plugin-sdk の TypeScript の型（生成物）を web にコピーするための判断（純粋関数）。
// コピー元は、Cargo が取得した plugin-sdk（Cargo.toml で固定したコミット）の packages/typescript/src/generated/protocol.ts。
// Rust と TypeScript が同じコミットの型を使うので、契約の定義元は plugin-sdk の 1 か所のまま（CLAUDE.md・ADR-0004）。
// ファイルの読み書きと cargo metadata の実行は plugin-protocol-cli.ts が行う。

import type { CargoMetadata } from "./licenses.ts";

/** 契約のクレートの名前。 */
export const PROTOCOL_CRATE = "modelith-plugin-protocol";
/** web の中のコピー先（リポジトリの一番上からのパス）。 */
export const COPY_PATH = "web/src/plugins/generated/protocol.ts";

/**
 * cargo metadata から、契約のクレートの置き場所と取得元を探す。
 *
 * @param meta `cargo metadata --format-version 1` の出力
 * @returns クレートの Cargo.toml のパスと取得元（`git+https://…?rev=…#…`）。見つからなければ null
 * @example
 * protocolCrate({ packages: [{ name: "modelith-plugin-protocol", manifest_path: "/c/git/checkouts/plugin-sdk-1/9fb8f90/crates/modelith-plugin-protocol/Cargo.toml", source: "git+https://github.com/modelith/plugin-sdk?rev=9fb8f90#9fb8f90", … }], … })
 * // → { manifestPath: "/c/git/…/Cargo.toml", source: "git+https://github.com/modelith/plugin-sdk?rev=9fb8f90#9fb8f90" }
 * protocolCrate({ packages: [], … }) // → null
 */
export function protocolCrate(meta: Pick<CargoMetadata, "packages">): { manifestPath: string; source: string } | null {
  const p = meta.packages.find((x) => x.name === PROTOCOL_CRATE);
  return p ? { manifestPath: p.manifest_path.replace(/\\/g, "/"), source: p.source ?? "" } : null;
}

/**
 * 契約のクレートの Cargo.toml の場所から、同じリポジトリの TypeScript の生成物の場所を求める（plugin-sdk のフォルダの形に従う）。
 *
 * @param manifestPath クレートの Cargo.toml のパス（`…/crates/modelith-plugin-protocol/Cargo.toml`）
 * @returns `…/packages/typescript/src/generated/protocol.ts`。形が違えば null
 * @example
 * generatedTsPath("/c/sdk/crates/modelith-plugin-protocol/Cargo.toml") // → "/c/sdk/packages/typescript/src/generated/protocol.ts"
 * generatedTsPath("/c/other/Cargo.toml")                                // → null
 */
export function generatedTsPath(manifestPath: string): string | null {
  const m = /^(.*)\/crates\/modelith-plugin-protocol\/Cargo\.toml$/.exec(manifestPath);
  return m ? `${m[1]}/packages/typescript/src/generated/protocol.ts` : null;
}

/**
 * コピーの中身を作る。元の生成物の前に、どこからコピーしたかと、更新のしかたを書く。
 *
 * @param source クレートの取得元（コミットが分かるように書く）
 * @param generated plugin-sdk の生成物の中身
 * @returns コピーの中身
 * @example
 * copyText("git+https://github.com/modelith/plugin-sdk?rev=9fb8f90#9fb8f90", "export type A = string;\n")
 * // → "// plugin-sdk の packages/typescript/src/generated/protocol.ts のコピー。編集しないこと。\n// 取得元: git+…#9fb8f90\n// 更新: …\n\nexport type A = string;\n"
 */
export function copyText(source: string, generated: string): string {
  return (
    "// plugin-sdk の packages/typescript/src/generated/protocol.ts のコピー。編集しないこと。\n" +
    `// 取得元: ${source}\n` +
    "// 更新: Cargo.toml の plugin-sdk の rev を変えてから node web/tools/plugin-protocol-cli.ts sync（scripts/check.sh が古さを検出する）\n\n" +
    generated
  );
}
