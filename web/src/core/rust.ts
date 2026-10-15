// Rust のコア（wasm）が返す解析結果を、暫定コアと同じオブジェクトの形に戻す（ADR-0015）。
// Rust は要素どうしの参照を番号で返すので、ここで親・子・持ち主のオブジェクトの参照につなぎ直す。
// `@layout` コメント（移行期の形式）は、ここで読む。

import { readLayout } from "./parser";
import type { Block, Entry, ParseResult, Rel, Scope, Unsupported } from "./types";

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
