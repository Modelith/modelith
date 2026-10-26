// プロジェクトの一覧（開いたフォルダを覚えた一覧。F-PROJ-3）の決まり。並べ方・上限・読み込みを決めるだけの純粋関数。
// ハンドルの読み書きと、同じフォルダかの確かめ（非同期）は local-folder.ts。

/** 一覧に覚えるフォルダの数の上限。 */
export const MAX_RECENT = 10;

/** 一覧の 1 件（H はフォルダのハンドルの型）。 */
export interface RecentEntry<H> {
  /** 一覧の中で変わらない名前（開く・外すときに使う）。 */
  id: string;
  handle: H;
  /** プロジェクトの名前（modelith.json の name）。プロジェクトでない・まだ読んでいなければ null。 */
  project: string | null;
}

/**
 * 保存しておいた一覧を読み込む。形の合わない項目は捨てる（壊れていても、残りは使う）。
 *
 * @param raw 保存しておいた値
 * @param isHandle フォルダのハンドルかを確かめる関数
 * @returns 一覧（多くても MAX_RECENT 件）。配列でなければ空
 * @example
 * parseRecent([{ id: "1", handle: dir, project: null }], isDir) // → [{ id: "1", handle: dir, project: null }]
 * parseRecent([{ id: 1 }, { id: "2", handle: dir }], isDir)     // → [{ id: "2", handle: dir, project: null }]
 * parseRecent(undefined, isDir)                                 // → []
 */
export function parseRecent<H>(raw: unknown, isHandle: (v: unknown) => v is H): RecentEntry<H>[] {
  if (!Array.isArray(raw)) return [];
  const list: RecentEntry<H>[] = [];
  for (const v of raw as unknown[]) {
    if (typeof v !== "object" || v === null) continue;
    const { id, handle, project } = v as Record<string, unknown>;
    if (typeof id !== "string" || !isHandle(handle) || list.some((e) => e.id === id)) continue;
    list.push({ id, handle, project: typeof project === "string" ? project : null });
  }
  return list.slice(0, MAX_RECENT);
}

/**
 * 開いたフォルダを一覧の先頭に置く。既にあればその項目を先頭に移し（名前とプロジェクト名は残す）、無ければ新しい名前で足す。
 * 上限を超えたら、最後に開いたのが古いものから外す。
 *
 * @param list 今の一覧（最後に開いた順）
 * @param at 同じフォルダの項目の位置。無ければ -1
 * @param handle 開いたフォルダのハンドル
 * @returns 新しい一覧
 * @example
 * pushRecent([a, b], 1, dirB)  // → [b（ハンドルは dirB）, a]
 * pushRecent([a, b], -1, dirC) // → [{ id: "3", handle: dirC, project: null }, a, b]
 */
export function pushRecent<H>(list: readonly RecentEntry<H>[], at: number, handle: H): RecentEntry<H>[] {
  const old = at >= 0 ? list[at] : undefined;
  const entry: RecentEntry<H> = old ? { ...old, handle } : { id: nextRecentId(list), handle, project: null };
  return [entry, ...list.filter((_, i) => i !== at)].slice(0, MAX_RECENT);
}

/**
 * 一覧で使われていない名前を作る（使われている数の名前の最大 + 1）。
 *
 * @param list 今の一覧
 * @returns 新しい名前
 * @example
 * nextRecentId([])                          // → "1"
 * nextRecentId([{ id: "3" }, { id: "x" }]) // → "4"（数でない名前は数えない）
 */
export function nextRecentId(list: readonly { id: string }[]): string {
  const max = Math.max(0, ...list.map((e) => (/^\d+$/.test(e.id) ? Number(e.id) : 0)));
  return String(max + 1);
}

/**
 * 項目を一覧から外す（フォルダそのものには触れない）。
 *
 * @param list 今の一覧
 * @param id 外す項目の名前
 * @returns 新しい一覧。無ければ元と同じ並び
 * @example
 * forgetRecent([a, b], a.id) // → [b]
 * forgetRecent([a, b], "x")  // → [a, b]
 */
export function forgetRecent<H>(list: readonly RecentEntry<H>[], id: string): RecentEntry<H>[] {
  return list.filter((e) => e.id !== id);
}

/**
 * 項目のプロジェクト名を書き換える（並びは変えない）。
 *
 * @param list 今の一覧
 * @param id 項目の名前
 * @param project プロジェクトの名前。プロジェクトでなくなったら null
 * @returns 新しい一覧と、変わったか
 * @example
 * withProject([a], a.id, "給水") // → { list: [{ …a, project: "給水" }], changed: true }
 * withProject([a], "x", "給水")  // → { list: [a], changed: false }
 */
export function withProject<H>(list: readonly RecentEntry<H>[], id: string, project: string | null): { list: RecentEntry<H>[]; changed: boolean } {
  let changed = false;
  const next = list.map((e) => {
    if (e.id !== id || e.project === project) return e;
    changed = true;
    return { ...e, project };
  });
  return { list: next, changed };
}
