// リリースノートのひな形を作り、形を確かめる（docs/development/releasing.md）。判断は release-notes.ts。
//   node web/tools/release-notes-cli.ts new <版>       docs/releases/v<版>.md のひな形を作る
//   node web/tools/release-notes-cli.ts check [<版>]   docs/releases/ のすべての形を確かめる。版を渡すと、その版のノートがあり、
//                                                       Cargo.toml と web/package.json の版と一致することも確かめる
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isVersion, previousVersion, skeleton, validate } from "./release-notes.ts";

const root = new URL("../../", import.meta.url);
const dir = new URL("docs/releases/", root);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
const notePath = (version: string): URL => new URL(`v${version}.md`, dir);
const knownVersions = (): string[] => (existsSync(dir) ? readdirSync(dir).flatMap((f) => /^v(.+)\.md$/.exec(f)?.[1] ?? []) : []);

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function newNote(version: string): void {
  if (!isVersion(version)) fail(`版の形が違います：${version}（例：0.1.0-alpha.4）`);
  const path = notePath(version);
  if (existsSync(path)) fail(`${path.pathname} は既にあります`);
  writeFileSync(path, skeleton(version, previousVersion(version, knownVersions())));
  console.log(`docs/releases/v${version}.md を作りました。「（ここに書く）」を埋めてください`);
}

function check(version?: string): void {
  const problems: string[] = [];
  for (const v of knownVersions()) {
    for (const p of validate(v, readFileSync(notePath(v), "utf8"))) problems.push(`docs/releases/v${v}.md：${p}`);
  }
  if (version) {
    if (!knownVersions().includes(version)) problems.push(`docs/releases/v${version}.md がありません（new で作ってください）`);
    const cargo = /^version = "(.+)"$/m.exec(read("Cargo.toml"))?.[1];
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
else fail("使い方：release-notes-cli.ts new <版> | check [<版>]");
