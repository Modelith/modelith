// ファイルごとの図のタブ（F-VIEW-17）。どのファイルにどのタブを持たせるかと、記憶の読み書きの形を決める。判断だけの純粋関数。
// localStorage への読み書きと、タブの切り替えは panels.ts が行う。

import { movedPath } from "../files/entry-names";
import { parseSavedTabs, type SavedTabs } from "./saved-tabs";
import type { ViewContent } from "./views";

/** 記憶しておくファイルの数の上限（古いものから捨てる）。 */
export const MAX_DOC_TABS = 50;

/** 表示中の図に、このファイルの要素が無いときの案内（F-VIEW-17）。 */
export const NOTHING_IN_FILE = "この図には、このファイルの要素がありません。ほかの図は、タブの「＋」から開けます。";

/**
 * 文書の、タブを記憶するときの名前。保存先のあるファイルはプロバイダとフォルダからのパス（参照の id は開くたびに変わるので使わない）、無題の文書は文書のキー。
 *
 * @param doc 文書（キーと保存先）
 * @returns 記憶の名前
 * @example
 * docTabsId({ key: "d3", ref: { provider: "local", path: "models/a.sysml" } }) // → "local:models/a.sysml"
 * docTabsId({ key: "d4", ref: null })                                          // → "draft:d4"
 */
export function docTabsId(doc: { key: string; ref: { provider: string; path: string } | null }): string {
  return doc.ref ? `${doc.ref.provider}:${doc.ref.path}` : `draft:${doc.key}`;
}

/**
 * 初めて開くファイルのタブ（「すべて」の図だけ）。
 *
 * @returns タブ 1 つと、それを表示中にした記憶
 * @example
 * firstTabs() // → { tabs: [{ id: 1, view: "all", ctx: null, phase: "" }], active: 1 }
 */
export function firstTabs(): SavedTabs {
  return { tabs: [{ id: 1, view: "all", ctx: null, phase: "" }], active: 1 };
}

/**
 * 記憶したファイルごとのタブ（JSON）を読む。ファイルごとの中身は、記憶したタブと同じ決まりで確かめ（parseSavedTabs）、戻せないものは捨てる。
 *
 * @param json 記憶した JSON（`{ "記憶の名前": { "tabs": [...], "active": 1 } }`。無ければ null）
 * @param viewIds 知っているビューの id
 * @returns 記憶の名前 → タブ（記憶した順。古いものが先）。無い・壊れていれば空
 * @example
 * parseDocTabs('{"local:a.sysml":{"tabs":[{"id":1,"view":"trace"}],"active":1}}', ["trace"])
 * // → Map { "local:a.sysml" → { tabs: [{ id: 1, view: "trace", ctx: null, phase: "" }], active: 1 } }
 * parseDocTabs("{not json", ["trace"]) // → Map {}
 */
export function parseDocTabs(json: string | null, viewIds: readonly string[]): Map<string, SavedTabs> {
  const out = new Map<string, SavedTabs>();
  if (json === null) return out;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return out;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [id, saved] of Object.entries(v as Record<string, unknown>)) {
    const tabs = parseSavedTabs(JSON.stringify(saved), viewIds);
    if (tabs) out.set(id, tabs);
  }
  return out;
}

/**
 * ファイルのタブを記憶に入れる（新しいものとして最後に置く）。上限を超えたら、古いものから捨てる。
 *
 * @param all 記憶したファイルごとのタブ（書き換える）
 * @param id 記憶の名前
 * @param tabs そのファイルのタブ
 * @param max 記憶しておくファイルの数の上限
 * @example
 * rememberDocTabs(new Map([["a", A], ["b", B]]), "a", A2, 2) // → Map { "b" → B, "a" → A2 }（a を新しいものにする）
 * rememberDocTabs(new Map([["a", A], ["b", B]]), "c", C, 2)  // → Map { "b" → B, "c" → C }（古い a を捨てる）
 */
export function rememberDocTabs(all: Map<string, SavedTabs>, id: string, tabs: SavedTabs, max = MAX_DOC_TABS): void {
  all.delete(id);
  all.set(id, tabs);
  for (const old of all.keys()) {
    if (all.size <= max) break;
    all.delete(old);
  }
}

/**
 * ファイルかフォルダの名前を変えた・消したときに、その中のファイルの記憶を移す・消す（F-FILE-19）。記憶の順は保つ。
 *
 * @param all 記憶したファイルごとのタブ（書き換える）
 * @param provider ファイルのプロバイダ（記憶の名前の前半）
 * @param from 名前を変えた・消したもののパス
 * @param to 新しいパス。消したなら null
 * @example
 * moveDocTabs(m, "local", "models", "parts") // m の "local:models/a.sysml" → "local:parts/a.sysml"
 * moveDocTabs(m, "local", "a.sysml", null)   // m から "local:a.sysml" を消す
 */
export function moveDocTabs(all: Map<string, SavedTabs>, provider: string, from: string, to: string | null): void {
  const next: [string, SavedTabs][] = [];
  for (const [id, tabs] of all) {
    const moved = movedDocId(id, provider, from, to);
    if (moved !== null) next.push([moved, tabs]);
  }
  all.clear();
  for (const [id, tabs] of next) all.set(id, tabs);
}

/**
 * ファイルかフォルダの名前を変えた・消した後の、記憶の名前（F-FILE-19）。
 *
 * @param id 記憶の名前（docTabsId）
 * @param provider 名前を変えた・消したもののプロバイダ
 * @param from 名前を変えた・消したもののパス
 * @param to 新しいパス。消したなら null
 * @returns 新しい記憶の名前。影響が無ければ id のまま、消したものなら null
 * @example
 * movedDocId("local:models/a.sysml", "local", "models", "parts") // → "local:parts/a.sysml"
 * movedDocId("local:b.sysml", "local", "models", "parts")        // → "local:b.sysml"（影響なし）
 * movedDocId("local:a.sysml", "local", "a.sysml", null)          // → null（消した）
 */
export function movedDocId(id: string, provider: string, from: string, to: string | null): string | null {
  const prefix = `${provider}:`;
  const moved = id.startsWith(prefix) ? movedPath(id.slice(prefix.length), from, to ?? from) : null;
  if (moved === null) return id;
  return to === null ? null : prefix + moved;
}

/**
 * 表示中の図に、このファイルの要素が無いことを案内するか（F-VIEW-17）。図が自分の案内（対象が無いなど）を出すときと、ファイルに要素が無いときは出さない。
 *
 * @param content 表示中の図に描く中身
 * @param fileNodes ファイルの要素の数
 * @returns 案内するなら true
 * @example
 * nothingInFile({ nodes: [], edges: [] }, 7)                       // → true（ファイルには要素があるのに、この図に描くものが無い）
 * nothingInFile({ nodes: [], edges: [], empty: "シナリオが…" }, 7) // → false（図が自分の案内を出す）
 * nothingInFile({ nodes: [], edges: [] }, 0)                       // → false（ファイルが空）
 */
export function nothingInFile(content: Pick<ViewContent, "nodes" | "empty" | "seq">, fileNodes: number): boolean {
  return !content.empty && !content.seq && content.nodes.length === 0 && fileNodes > 0;
}
