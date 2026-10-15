// テストで使う 2 つのパーサ（暫定の TS と、Rust の wasm）。同じテストを両方で動かす（ADR-0015）。
// wasm は scripts/build-wasm.sh が web/src/core/wasm/ に書き出し（scripts/check.sh が先に実行する）、testing/setup.ts が読み込む。

import { parse as tsParse } from "../parser";
import { parse as rustParse } from "../rust";
import type { ParseResult } from "../types";

/** テストで比べるパーサ。名前はテスト名に出す。 */
export const PARSERS: [name: string, parse: (text: string) => ParseResult][] = [
  ["TS", tsParse],
  ["Rust", rustParse],
];
