// 一般の図のメモ（comment、8.2.3.4）。注釈する要素が図にあれば、メモを図の要素として足し、要素へ破線を引く。

import type { ModelEdge, ModelNode, ModelNote } from "../core";
import type { ViewContent } from "./views";

/**
 * 一般の図の内容に、図に出した要素を注釈するメモと、メモから要素への線（annotate）を足す。
 * メモは種類 `comment` の図の要素（`note: true`、`entry` はコメントの宣言）にする。
 * 図に出した要素の別の言語での表し方（`rep`）も、種類 `rep` のメモ（キーは `rep:要素のキー#番号`、`entry` は持ち主の宣言の写しで、
 * 名前・言語（`type`）・本文（`body`）を rep のものにしたもの）として足す（8.2.3.4 の textual-representation-node）。
 *
 * @param notes モデルのメモ（無ければ undefined）
 * @param c メモを足す前の図の内容
 * @returns メモと線を足した内容。足すメモが無ければ c をそのまま返す
 * @example
 * // メモ note:#1 が A と B を注釈し、図には A だけがある
 * withNotes([note1], { nodes: [A], edges: [] })
 * // → { nodes: [A, note:#1], edges: [{ id: "annotate|note:#1|A", kind: "annotate", from: "note:#1", to: "A", … }] }
 * withNotes([note1], { nodes: [C], edges: [] }) // → そのまま（注釈する要素が図に無い）
 * // 図の A に rep inOCL language "OCL" /* … *\/ がある
 * withNotes([], { nodes: [A], edges: [] }).nodes.map((n) => n.key) // → ["A", "rep:A#1"]
 */
export function withNotes(notes: readonly ModelNote[] | undefined, c: ViewContent): ViewContent {
  const shown = new Set(c.nodes.map((n) => n.key));
  const nodes: ModelNode[] = [];
  const edges: ModelEdge[] = [];
  for (const note of notes ?? []) {
    const targets = note.targets.filter((t) => shown.has(t));
    if (!targets.length) continue;
    const e = note.entry;
    nodes.push({ key: note.key, name: e.name, short: e.short, kind: "comment", isDef: false, fam: "other", entry: e, trans: [], ports: [], phase: null, phaseOwn: false, note: true });
    for (const t of targets) edges.push({ id: `annotate|${note.key}|${t}`, kind: "annotate", from: note.key, to: t, label: "", src: { start: e.start, end: e.end } });
  }
  // 別の言語での表し方（rep）は、持ち主の要素に付けたメモとして描く（8.2.3.4 の textual-representation-node）
  for (const n of c.nodes) {
    (n.entry.reps ?? []).forEach((r, k) => {
      const key = `rep:${n.key}#${k + 1}`;
      const e = { ...n.entry, kind: "rep", name: r.name, type: r.language, body: r.body, reps: [] };
      nodes.push({ key, name: r.name, short: "", kind: "rep", isDef: false, fam: "other", entry: e, trans: [], ports: [], phase: null, phaseOwn: false, note: true });
      edges.push({ id: `annotate|${key}|${n.key}`, kind: "annotate", from: key, to: n.key, label: "", src: { start: n.entry.start, end: n.entry.end } });
    });
  }
  return nodes.length ? { ...c, nodes: [...c.nodes, ...nodes], edges: [...c.edges, ...edges] } : c;
}
