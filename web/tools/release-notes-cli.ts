// リリースノートのひな形を作り、形を確かめる（docs/development/releasing.md）。判断は release-notes.ts。
//   node web/tools/release-notes-cli.ts new <版>       docs/releases/v<版>.md のひな形を作る（前の版は git のタグとノートから選ぶ）
//   node web/tools/release-notes-cli.ts check [<版>]   docs/releases/ のすべての形を確かめる。版を渡すと、その版のノートがあり、
//                                                       Cargo.toml と web/package.json の版と一致することも確かめる
//   node web/tools/release-notes-cli.ts current        Cargo.toml の版を出す
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isVersion, previousVersion, skeleton, validate } from "./release-notes.ts";

const root = new URL("../../", import.meta.url);
const dir = new URL("docs/releases/", root);
/**
 * リポジトリの中のファイルを読む。
 *
 * @param path リポジトリの根からのパス
 * @returns ファイルの中身（UTF-8）。無ければ例外
 * @example
 * read("Cargo.toml") // → "[workspace]\n…"
 */
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

/**
 * 版のリリースノートの場所。
 *
 * @param version 版
 * @returns docs/releases/v<版>.md の URL
 * @example
 * notePath("0.1.0-alpha.4") // → file:///…/docs/releases/v0.1.0-alpha.4.md
 */
const notePath = (version: string): URL => new URL(`v${version}.md`, dir);

/**
 * リリースノートのある版を集める。
 *
 * @returns docs/releases/ の v<版>.md の版。ディレクトリが無ければ空
 * @example
 * knownVersions() // → ["0.1.0-alpha.2", "0.1.0-alpha.4"]
 */
const knownVersions = (): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((f) => /^v(.+)\.md$/.exec(f)?.[1] ?? []) : []);

/**
 * 今の版（Cargo.toml の `version`）を読む。
 *
 * @returns 版。書かれていなければ undefined
 * @example
 * currentVersion() // → "0.1.0-alpha.4"
 */
const currentVersion = (): string | undefined => /^version = "(.+)"$/m.exec(read("Cargo.toml"))?.[1];

/**
 * 出した版（git のタグ v*）を集める。
 *
 * @returns タグの版。git が無いなどでタグを取れない環境では空
 * @example
 * taggedVersions() // → ["0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-alpha.3"]
 */
function taggedVersions(): string[] {
  try {
    return execSync("git tag --list v*", { cwd: root, encoding: "utf8" }).split("\n").flatMap((t) => /^v(.+)$/.exec(t.trim())?.[1] ?? []);
  } catch {
    return [];
  }
}

/**
 * エラーを出して終了する（終了コード 1）。
 *
 * @param message 画面に出す理由
 */
function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/**
 * 版のリリースノートのひな形を docs/releases/ に作る。前の版は git のタグとノートから選ぶ。
 * 版の形が違う・既にノートがあるときは、何も書かずに失敗する。
 *
 * @param version 作る版
 */
function newNote(version: string): void {
  if (!isVersion(version)) fail(`版の形が違います：${version}（例：0.1.0-alpha.4）`);
  const path = notePath(version);
  if (existsSync(path)) fail(`${path.pathname} は既にあります`);
  writeFileSync(path, skeleton(version, previousVersion(version, [...taggedVersions(), ...knownVersions()])));
  console.log(`docs/releases/v${version}.md を作りました。「（ここに書く）」を埋めてください`);
}

/**
 * docs/releases/ のすべてのノートの形を確かめる。問題があれば一覧を出して失敗し、無ければ「release notes: ok」を出す。
 *
 * @param version 渡すと、その版のノートがあり、Cargo.toml と web/package.json の版と一致することも確かめる
 */
function check(version?: string): void {
  const problems: string[] = [];
  for (const v of knownVersions()) {
    for (const p of validate(v, readFileSync(notePath(v), "utf8"))) problems.push(`docs/releases/v${v}.md：${p}`);
  }
  if (version) {
    if (!knownVersions().includes(version)) problems.push(`docs/releases/v${version}.md がありません（new で作ってください）`);
    const cargo = currentVersion();
    const web = (JSON.parse(read("web/package.json")) as { version: string }).version;
    if (cargo !== version) problems.push(`Cargo.toml の版が ${cargo ?? "（無し）"} です（${version} にしてください）`);
    if (web !== version) problems.push(`web/package.json の版が ${web} です（${version} にしてください）`);
  }
  if (problems.length) fail(`リリースノートに問題があります\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  console.log("release notes: ok");
}

const [command, version] = process.argv.slice(2);
if (command === "new" && version) newNote(version);
else if (command === "check") check(version);
else if (command === "current") console.log(currentVersion() ?? fail("Cargo.toml に版がありません"));
else fail("使い方：release-notes-cli.ts new <版> | check [<版>] | current");
