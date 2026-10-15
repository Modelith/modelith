import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { appLicense, chooseLicenses, LICENSE_FILES, thirdPartyNotices, viteCoreLicense, wasmRuntimeCrates, type BundledPart, type CargoMetadata } from "./tools/licenses";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** ビルドしたコミット。AGPL §13 のソースへのリンクを、動いている版に合わせるために埋め込む。 */
function commitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** 著作権表示。画面（index.html）と LICENSE.txt に出す。 */
const COPYRIGHT = "Copyright (C) 2026 The Modelith Authors";

/** Rust のコア（wasm）に組み込まれる第三者のクレートと、そのライセンス文（ADR-0015）。 */
function rustCrateParts(): BundledPart[] {
  const json = execSync("cargo metadata --format-version 1 --filter-platform wasm32-unknown-unknown", {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return wasmRuntimeCrates(JSON.parse(json) as CargoMetadata, "modelith-wasm").map((p) => {
    const licenses = chooseLicenses(p.license ?? "");
    const texts = licenses.map((l) => {
      const file = (LICENSE_FILES[l] ?? []).map((f) => join(dirname(p.manifest_path), f)).find((f) => existsSync(f));
      if (!file) throw new Error(`${p.name} ${p.version} の ${l} のライセンス文が見つかりません`);
      return readFileSync(file, "utf8");
    });
    return { name: `${p.name} ${p.version}`, license: licenses.join(" AND "), usage: "Rust のコア（wasm）の部品", text: texts.join("\n\n") };
  });
}

/**
 * 配布物にライセンス文を添える（AGPL §5(d)・OFL・MIT）。
 * - LICENSE.txt：Modelith 本体のライセンス（AGPL-3.0 全文とプラグイン例外）
 * - licenses.txt：同梱する第三者の部品（フォント・Vite の実行時コード・Rust のコアのクレート）のライセンス
 */
function bundledLicenses(): Plugin {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
  return {
    name: "modelith-licenses",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "LICENSE.txt", source: appLicense(COPYRIGHT, read("../LICENSE"), read("../PLUGIN-EXCEPTION.md")) });
      const parts: BundledPart[] = [
        { name: "@fontsource/ibm-plex-sans-jp", license: "OFL-1.1", usage: "画面の文字（IBM Plex Sans JP）", text: read("./node_modules/@fontsource/ibm-plex-sans-jp/LICENSE") },
        { name: "@fontsource/ibm-plex-mono", license: "OFL-1.1", usage: "テキスト欄の文字（IBM Plex Mono）", text: read("./node_modules/@fontsource/ibm-plex-mono/LICENSE") },
        { name: "vite", license: "MIT", usage: "スクリプトを読み込む小さな実行時コード", text: viteCoreLicense(read("./node_modules/vite/LICENSE.md")) },
        ...rustCrateParts(),
      ];
      this.emitFile({ type: "asset", fileName: "licenses.txt", source: thirdPartyNotices(parts) });
    },
  };
}

export default defineConfig({
  // GitHub Pages ではリポジトリ名のパス（/modelith/）の下に置く。CI が MODELITH_BASE で渡す
  base: process.env.MODELITH_BASE ?? "/",
  define: { __APP_COPYRIGHT__: JSON.stringify(COPYRIGHT), __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT__: JSON.stringify(commitSha()) },
  plugins: [bundledLicenses()],
  server: { fs: { allow: [".."] } },
  // e2e（e2e/*.spec.ts）は Playwright で動かすので、Vitest は src と tools の単体・結合テストだけを拾う
  test: { include: ["src/**/*.test.ts", "tools/**/*.test.ts"], setupFiles: ["src/core/testing/setup.ts"] },
});
