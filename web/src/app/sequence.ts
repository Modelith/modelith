// シーケンス図（SequenceView、9.2.20.2.7・8.2.3.9）の中身を、モデルのシーケンス図から作る。
// ライフライン・イベントのキーと線の ID は Rust のコア（crates/modelith-core/src/model/sequences.rs）が決めたもの。
// 図の操作（edit）も同じものを探す（ADR-0016）。

import type { Model, ModelEdge, ModelNode, ModelSequenceEvent } from "../core";

/** シーケンス図に描くライフライン・線（メッセージと、イベントの間の順序）・イベントと、段の数。 */
export interface SequenceContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
  events: ModelSequenceEvent[];
  rows: number;
}

/**
 * シーケンス図の中身を作る。ライフラインを `l:名前` の図の要素にし、メッセージを段の順に番号（idx）と段（row）付きの線にして、
 * 続けてイベントの間の順序（succession）の線を並べる。
 *
 * @param M モデル
 * @param ctx 図の対象（シナリオのノード）
 * @returns ライフライン・線・イベント・段の数。対象のシーケンス図が無ければ空
 * @example
 * // occurrence def S { part a { event occurrence e; } part b { event occurrence r; } message m from a.e to b.r; } のとき
 * seqContentOf(M, S)
 * // → { nodes: [l:a, l:b], edges: [{ id: "msg|0|m", kind: "message", idx: 0, row: 0, from: "l:a", to: "l:b", … }],
 * //     events: [e:a.e（段 0）, e:b.r（段 0）], rows: 1 }
 */
export function seqContentOf(M: Model, ctx: ModelNode): SequenceContent {
  const s = M.sequences?.find((x) => x.key === ctx.key);
  if (!s) return { nodes: [], edges: [], events: [], rows: 0 };
  const nodes = s.lifelines.map(
    (l): ModelNode => ({
      key: l.key, name: l.name, short: "", kind: l.entry.kind, isDef: false, fam: "part", entry: l.entry, trans: [], ports: [],
      lifeline: true, phase: null, phaseOwn: false,
    }),
  );
  const messages = s.messages.flatMap((m, i): ModelEdge[] => {
    const r = m.rel;
    if (r.rel !== "message") return [];
    return [{ id: m.id, kind: "message", idx: i, row: m.row, from: m.from, to: m.to, label: r.name, type: r.item, rel: r, src: { start: r.start, end: r.end + 1 } }];
  });
  return { nodes, edges: [...messages, ...s.successions], events: s.events, rows: s.rows };
}

/**
 * シーケンス図のイベントの、画面での名前（ライフラインの名前と、イベントの札）。
 *
 * @param events シーケンス図のイベント
 * @param lifelines シーケンス図のライフライン
 * @param key イベントのキー
 * @returns `a.sub.ev` の形の名前。イベントが無ければ null
 * @example
 * eventName(events, lifelines, "e:a.sub.ev") // → "a.sub.ev"
 * eventName(events, lifelines, "l:a")        // → null（イベントでない）
 */
export function eventName(events: readonly ModelSequenceEvent[], lifelines: readonly ModelNode[], key: string): string | null {
  const ev = events.find((e) => e.key === key);
  if (!ev) return null;
  return (lifelines.find((l) => l.key === ev.lifeline)?.name ?? "") + ev.label;
}
