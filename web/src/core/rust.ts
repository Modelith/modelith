// Rust のコア（wasm）が返す解析結果を、暫定コアと同じオブジェクトの形に戻す（ADR-0015）。
// Rust は要素どうしの参照を番号で返すので、ここで親・子・持ち主のオブジェクトの参照につなぎ直す。
// `@layout` コメント（移行期の形式）は、ここで読む。

import { readLayout } from "./parser";
import type { Block, Entry, ParseResult, Rel, Scope, Unsupported } from "./types";
import initWasm, { parse as parseJson } from "./wasm/modelith_core.js";

/**
 * Rust のコア（wasm）を読み込む。アプリは起動時に一度だけ待つ（ADR-0015：alpha.3 では画面と同じスレッドで同期で呼ぶ）。
 * テストは testing/setup.ts が先に読み込んでおく。
 */
export async function initCore(wasmUrl: string): Promise<void> {
  await initWasm({ module_or_path: wasmUrl });
}

/**
 * テキストを解析して宣言・関係・構文エラー・配置情報を返す（Rust のパーサ）。例外は投げない。
 * コアの中で予期しない失敗が起きたときは、要素の無い結果と、そのことを伝える構文エラーを返す（テキストには触れない）。
 */
export function parse(text: string): ParseResult {
  return safeParse(text, parseJson);
}

/** `parseJson` が失敗しても例外を投げずに結果を返す（`parseJson` を差し替えてテストできるように分けている）。 */
export function safeParse(text: string, parseJson: (text: string) => string): ParseResult {
  try {
    return fromRust(parseJson(text), text);
  } catch (e) {
    const errors = [{ pos: 0, msg: `テキストを読み取れませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` }];
    return { entries: [], rels: [], errors, layout: readLayout(text, errors), unsupported: [] };
  }
}

/** 持ち主の番号（名前のある宣言か、名前の無いブロック）。 */
type RawScope = { e: number } | { b: number };

type RawEntry = Omit<Entry, "owner" | "pe" | "children" | "phaseBlock"> & {
  owner: RawScope | null;
  pe: number | null;
  children: number[];
  phaseBlock?: RawScope;
};
type RawBlock = Omit<Block, "anon" | "owner"> & { owner: RawScope | null };
/** 関係（相手は文字列、文の持ち主と接続の使用は番号）。 */
type RawRel = { rel: Rel["rel"]; pe: number | null; usage?: number; start: number; end: number } & Record<string, unknown>;

/** Rust の `ParseResult`（JSON）。 */
export interface RawParseResult {
  entries: RawEntry[];
  blocks: RawBlock[];
  rels: RawRel[];
  errors: { pos: number; msg: string }[];
  unsupported: Unsupported[];
}

/** Rust の解析結果（JSON の文字列）を、暫定コアと同じ `ParseResult` にする。 */
export function fromRust(json: string, text: string): ParseResult {
  const raw = JSON.parse(json) as RawParseResult;
  const entries: Entry[] = raw.entries.map((e) => ({ ...e, owner: null, pe: null, children: [], phaseBlock: undefined }));
  const blocks: Block[] = raw.blocks.map((b) => ({ ...b, anon: true, owner: null }));
  const scope = (s: RawScope | null | undefined): Scope | null => {
    if (!s) return null;
    return ("e" in s ? entries[s.e] : blocks[s.b]) ?? null;
  };
  const entry = (i: number | null | undefined): Entry | null => (i == null ? null : (entries[i] ?? null));
  raw.entries.forEach((r, i) => {
    const e = entries[i]!;
    e.owner = scope(r.owner);
    e.pe = entry(r.pe);
    e.children = r.children.flatMap((c) => entry(c) ?? []);
    if (r.phaseBlock) e.phaseBlock = scope(r.phaseBlock) ?? undefined;
    else delete e.phaseBlock;
  });
  raw.blocks.forEach((r, i) => {
    blocks[i]!.owner = scope(r.owner);
  });
  const rels = raw.rels.map((r) => {
    const { usage, ...rest } = r;
    const rel = r.rel === "connect" ? { ...rest, pe: entry(r.pe), usage: entry(usage) } : { ...rest, pe: entry(r.pe) };
    return rel as unknown as Rel;
  });
  const errors = [...raw.errors];
  return { entries, rels, errors, layout: readLayout(text, errors), unsupported: raw.unsupported };
}
