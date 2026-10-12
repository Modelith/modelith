import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // GitHub Pages ではリポジトリ名のパス（/modelith/）の下に置く。CI が MODELITH_BASE で渡す
  base: process.env.MODELITH_BASE ?? "/",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { fs: { allow: [".."] } },
});
