// テストで使う 2 つのコア（暫定の TS と、Rust の wasm）。同じテストを両方で動かす（ADR-0015・ADR-0016）。
// wasm は scripts/build-wasm.sh が web/src/core/wasm/ に書き出し（scripts/check.sh が先に実行する）、testing/setup.ts が読み込む。

import { build as tsBuild } from "../model";
import { parse as tsParse } from "../parser";
import { build as rustBuild, parse as rustParse } from "../rust";
import type { Model, ParseResult } from "../types";

/** テストで比べる、パーサとモデル構築の組。名前はテスト名に出す。 */
export const PARSERS: [name: string, parse: (text: string) => ParseResult, build: (P: ParseResult) => Model][] = [
  ["TS", tsParse, tsBuild],
  ["Rust", rustParse, rustBuild],
];
