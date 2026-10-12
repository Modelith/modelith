import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

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

/** 同梱するフォント（OFL）のライセンス文を licenses.txt として出力する。OFL は再配布時に添付が必要。 */
function bundledLicenses(): Plugin {
  const fonts = ["@fontsource/ibm-plex-sans-jp", "@fontsource/ibm-plex-mono"];
  return {
    name: "modelith-licenses",
    generateBundle() {
      const parts = fonts.map((f) => `==== ${f} ====\n\n${readFileSync(new URL(`./node_modules/${f}/LICENSE`, import.meta.url), "utf8")}`);
      this.emitFile({ type: "asset", fileName: "licenses.txt", source: parts.join("\n\n") });
    },
  };
}

export default defineConfig({
  // GitHub Pages ではリポジトリ名のパス（/modelith/）の下に置く。CI が MODELITH_BASE で渡す
  base: process.env.MODELITH_BASE ?? "/",
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_COMMIT__: JSON.stringify(commitSha()) },
  plugins: [bundledLicenses()],
  server: { fs: { allow: [".."] } },
  // e2e（e2e/*.spec.ts）は Playwright で動かすので、Vitest は src と tools の単体・結合テストだけを拾う
  test: { include: ["src/**/*.test.ts", "tools/**/*.test.ts"] },
});
