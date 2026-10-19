// plugin-sdk の TypeScript の型を web にコピーする・コピーが最新かを確かめる。判断は plugin-protocol.ts。
//   node web/tools/plugin-protocol-cli.ts sync    コピーを書き直す
//   node web/tools/plugin-protocol-cli.ts check   コピーが Cargo.toml で固定した plugin-sdk と同じかを確かめる（scripts/check.sh）
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CargoMetadata } from "./licenses.ts";
import { COPY_PATH, copyText, generatedTsPath, protocolCrate } from "./plugin-protocol.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Cargo が取得した plugin-sdk の生成物を読み、コピーの中身を作る。
 *
 * @returns コピーの中身。クレートや生成物が見つからなければ、理由を出して終了コード 1 で終わる
 * @example
 * expectedCopy() // → "// plugin-sdk の … のコピー。…\n\nexport const API_VERSION = \"0\";\n…"
 */
function expectedCopy(): string {
  const json = execSync("cargo metadata --format-version 1", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const crate = protocolCrate(JSON.parse(json) as CargoMetadata);
  const path = crate && generatedTsPath(crate.manifestPath);
  if (!crate || !path || !existsSync(path)) {
    console.error(`ERROR: plugin-sdk の TypeScript の生成物が見つかりません（${path ?? "modelith-plugin-protocol が依存に無い"}）`);
    process.exit(1);
  }
  return copyText(crate.source, readFileSync(path, "utf8"));
}

const mode = process.argv[2];
const target = join(root, COPY_PATH);
if (mode === "sync") {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, expectedCopy());
  console.log(`plugin protocol: ${COPY_PATH} を書き直しました`);
} else if (mode === "check") {
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current !== expectedCopy()) {
    console.error(`ERROR: ${COPY_PATH} が、Cargo.toml で固定した plugin-sdk の型と違います。node web/tools/plugin-protocol-cli.ts sync で書き直してください（手で編集しない）`);
    process.exit(1);
  }
  console.log("plugin protocol: ok");
} else {
  console.error("usage: node web/tools/plugin-protocol-cli.ts sync|check");
  process.exit(2);
}
