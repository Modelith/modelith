// 公開する版を系列ごとに選び、GitHub Actions の出力の形（stable=…・preview=…）で書く（ADR-0020）。判断は channels.ts。
//   gh release list --limit 200 --json tagName,isDraft | node web/tools/channels-cli.ts
import { readFileSync } from "node:fs";
import { pickChannels, type Release } from "./channels.ts";

const releases = JSON.parse(readFileSync(0, "utf8")) as Release[];
const { stable, preview } = pickChannels(releases);
process.stdout.write(`stable=${stable ?? ""}\npreview=${preview ?? ""}\n`);
