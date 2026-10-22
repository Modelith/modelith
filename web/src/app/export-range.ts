// エクスポートの範囲「選んだ要素」（F-EXP-4）。図に描く中身を、選んだ要素とその中の要素、それらの間の線に絞る。入出力を持たない。

import type { PackageFrame, ViewContent } from "./views";

/**
 * 選んだ要素と、その中に入れ子で描く要素（内部ブロック図の部品の中の部品など）のキーを集める。
 *
 * @param content 図に描く中身
 * @param keys 選んだ要素のキー
 * @returns 描く要素のキー（図に無いキーは入れない）
 * @example
 * // 部品 a の中に a.b、その中に a.b.c がある
 * withInnerKeys(content, new Set(["a"])) // → Set { "a", "a.b", "a.b.c" }
 */
export function withInnerKeys(content: ViewContent, keys: ReadonlySet<string>): Set<string> {
  const out = new Set(content.nodes.filter((n) => keys.has(n.key)).map((n) => n.key));
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of content.nodes) {
      if (n.container && out.has(n.container) && !out.has(n.key)) {
        out.add(n.key);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * package の枠を、残す要素を含むものだけにし、枠の中の要素と入れ子の枠の番号を付け直す。
 *
 * @param frames 図の package の枠
 * @param kept 残す要素のキー
 * @returns 残す枠（`inner` は残した枠の中の番号）
 * @example
 * keepFrames([{ name: "P", keys: ["A", "B"], inner: [1] }, { name: "Q", keys: ["C"], inner: [] }], new Set(["A"]))
 * // → [{ name: "P", keys: ["A"], inner: [] }]（Q は要素が残らないので消え、P の中の番号からも外す）
 */
function keepFrames(frames: readonly PackageFrame[], kept: ReadonlySet<string>): PackageFrame[] {
  const holds = (i: number, seen = new Set<number>()): boolean => {
    const f = frames[i];
    if (!f || seen.has(i)) return false;
    seen.add(i);
    return f.keys.some((k) => kept.has(k)) || f.inner.some((j) => holds(j, seen));
  };
  const index = new Map<number, number>();
  frames.forEach((_, i) => {
    if (holds(i)) index.set(i, index.size);
  });
  return [...index.keys()].map((i) => {
    const f = frames[i] as PackageFrame;
    return { name: f.name, keys: f.keys.filter((k) => kept.has(k)), inner: f.inner.flatMap((j) => index.get(j) ?? []) };
  });
}

/**
 * 図に描く中身を、選んだ要素の範囲に絞る（F-EXP-4）。選んだ要素とその中の要素、両端がそれらにある線、それらを含む package の枠と区画だけを残す。
 * 図の外枠（内部ブロック図・アクティビティ図の対象）と、その上のポート・パラメータは描かない。
 *
 * @param content 図に描く中身（書き換えない）
 * @param keys 選んだ要素のキー
 * @returns 絞った中身
 * @example
 * // 要素 A・B・C と線 A→B・B→C がある図で、A と B を選んだ
 * selectionContent(content, new Set(["A", "B"])) // → 要素 A・B と線 A→B だけ
 */
export function selectionContent(content: ViewContent, keys: ReadonlySet<string>): ViewContent {
  const kept = withInnerKeys(content, keys);
  const out: ViewContent = {
    ...content,
    nodes: content.nodes.filter((n) => kept.has(n.key)),
    edges: content.edges.filter((e) => kept.has(e.from) && kept.has(e.to)),
  };
  delete out.frame;
  delete out.boundary;
  if (content.packages) out.packages = keepFrames(content.packages, kept);
  if (content.lanes) out.lanes = content.lanes.map((l) => ({ ...l, nodes: l.nodes.filter((k) => kept.has(k)) })).filter((l) => l.nodes.length);
  return out;
}
