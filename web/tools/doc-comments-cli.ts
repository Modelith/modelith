// 関数の doc コメントを検査する（programming-principles §4）。判断は doc-comments.ts。
//   node web/tools/doc-comments-cli.ts <ディレクトリかファイル>…
// 渡したディレクトリの下の .rs・.ts（テストと生成物を除く）を調べ、足りないものがあれば一覧を出して失敗する。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkRust, checkTs, type Finding } from "./doc-comments.ts";

/**
 * 検査するファイルか（テスト・生成物・型定義を除く）。
 *
 * @param path ファイルのパス
 * @returns 検査するなら true
 * @example
 * isTarget("web/src/app/ops.ts")       // → true
 * isTarget("web/src/app/ops.test.ts")  // → false
 * isTarget("crates/x/src/tests.rs")    // → false
 */
function isTarget(path: string): boolean {
  if (/(^|\/)(node_modules|target|wasm|tests|e2e)\//.test(path)) return false;
  if (/\.test\.ts$|\.d\.ts$|\/tests\.rs$/.test(path)) return false;
  return /\.(rs|ts)$/.test(path);
}

/**
 * パスの下にある、検査するファイルを集める。
 *
 * @param path ディレクトリかファイル
 * @returns 検査するファイルのパス（名前の順）
 * @example
 * collect("web/tools") // → ["web/tools/doc-comments-cli.ts", "web/tools/doc-comments.ts", …]
 */
function collect(path: string): string[] {
  if (!statSync(path).isDirectory()) return isTarget(path) ? [path] : [];
  return readdirSync(path)
    .sort()
    .flatMap((name) => collect(join(path, name)));
}

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error("usage: node web/tools/doc-comments-cli.ts <ディレクトリかファイル>…");
  process.exit(2);
}
const findings: { file: string; f: Finding }[] = paths.flatMap(collect).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return (file.endsWith(".rs") ? checkRust(source) : checkTs(source)).map((f) => ({ file, f }));
});
for (const { file, f } of findings) console.error(`${file}:${f.line}: ${f.name}：${f.message}`);
if (findings.length) {
  console.error(`ERROR: 関数の doc コメントの不足が ${findings.length} 件あります（.claude/skills/programming-principles/SKILL.md §4）`);
  process.exit(1);
}
console.log("doc comments: ok");
