// アクションの流れの図（ActionFlowView、8.2.3.17）の中身を、モデルのアクションの流れから作る。
// 要素のキーと線の ID は Rust のコア（crates/modelith-core/src/model/flows.rs）が決めたもの。図の操作（edit/flow.rs）も同じものを探す（ADR-0016）。

import type { Entry, Model, ModelEdge, ModelNode } from "../core";

/** アクションの流れの図に描く要素と線。 */
export interface FlowContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
}

/** 要素の形（8.2.3.17 の記号）。start は塗った丸、done は丸の中の塗った丸、bar は太い棒（fork・join）、diamond はひし形（decide・merge）、
 * send は右が尖った五角形、accept は左がへこんだ五角形、action は角の丸い四角。 */
export type FlowShape = "start" | "done" | "bar" | "diamond" | "send" | "accept" | "action";

const SHAPES: Record<string, FlowShape> = { start: "start", done: "done", fork: "bar", join: "bar", decide: "diamond", merge: "diamond", send: "send", accept: "accept" };

/**
 * 要素の種類から、アクションの流れの図での形を決める（8.2.3.17）。
 *
 * @param kind 要素の種類（`action`・`fork`・`send`・`start` など）
 * @returns 形。アクション・代入・終わらせる・if・while などは角の丸い四角（action）
 * @example
 * flowShape("fork")   // → "bar"
 * flowShape("decide") // → "diamond"
 * flowShape("assign") // → "action"
 */
export const flowShape = (kind: string): FlowShape => SHAPES[kind] ?? "action";

/**
 * アクションの流れの図にできるアクション定義を集める。
 *
 * @param M モデル
 * @returns action def のノード（モデルの順）。無ければ空
 * @example
 * // action def Control と part def Heater がある
 * flowContexts(M).map((n) => n.key) // → ["Control"]
 */
export const flowContexts = (M: Model): ModelNode[] => M.nodes.filter((n) => n.kind === "action def");

/**
 * アクションの流れの図の既定の対象（線の最も多いアクション定義。同数なら先のもの）を選ぶ。
 *
 * @param M モデル
 * @returns 対象のノード。アクション定義が無ければ null
 * @example
 * // Control に線が 3 本、Idle に 0 本
 * defaultFlowContext(M)?.key // → "Control"
 * // アクション定義が無い
 * defaultFlowContext(M)      // → null
 */
export function defaultFlowContext(M: Model): ModelNode | null {
  const lines = (n: ModelNode): number => M.actionFlows?.find((f) => f.key === n.key)?.edges.length ?? 0;
  return flowContexts(M).reduce<ModelNode | null>((best, n) => (!best || lines(n) > lines(best) ? n : best), null);
}

/**
 * アクションの流れの図の中身を作る。モデルのアクションの流れの要素を、種類 `flow` の図の要素にし（開始・終了の宣言は対象のアクション定義）、
 * 線（継起・順序付きの流れ）はそのまま使う。
 *
 * @param M モデル
 * @param ctx 図の対象（アクション定義のノード）
 * @returns 要素と線。対象のアクションの流れが無ければ空
 * @example
 * // action def A { first start; then action a; } のとき
 * flowContentOf(M, A) // → { nodes: [a:start, a:a], edges: [{ id: "succession|a:start|a:a|#1", kind: "succession", … }] }
 */
export function flowContentOf(M: Model, ctx: ModelNode): FlowContent {
  const f = M.actionFlows?.find((x) => x.key === ctx.key);
  if (!f) return { nodes: [], edges: [] };
  const nodes = f.nodes.map(
    (n): ModelNode => ({
      key: n.key, name: n.name, short: "", kind: n.kind, isDef: false, entry: n.entry ?? ctx.entry, fam: "beh", trans: [], ports: [],
      flow: true, phase: null, phaseOwn: false,
    }),
  );
  return { nodes, edges: f.edges };
}

/**
 * 要素の名前の後に書く中身（送るもの・受けるもの・代入・条件・型）。文の頭から、名前と種類の語より前を除いたもの。
 *
 * @param n アクションの流れの図の要素
 * @returns 中身の文字列。書くことが無ければ空文字列
 * @example
 * flowDetail(send S() to b)          // → "S() to b"
 * flowDetail(action s send x)        // → "x"
 * flowDetail(if x > 0 { … })         // → "x > 0"
 * flowDetail(action a : Heat)        // → ": Heat"（アクションは型）
 * flowDetail(fork f)                 // → ""
 */
export function flowDetail(n: ModelNode): string {
  if (n.kind === "action" || n.kind === "perform action" || n.kind === "state") return n.entry.type ? `: ${n.entry.type}` : "";
  if (flowShape(n.kind) !== "send" && flowShape(n.kind) !== "accept" && flowShape(n.kind) !== "action") return "";
  const words = n.entry.head.split(" ");
  const at = words.indexOf(n.kind);
  return at < 0 ? "" : words.slice(at + 1).join(" ");
}

/**
 * if・while・loop・for の本体のアクションの名前を、区画の行の文字列にする。if は then の本体と else の本体を分ける。
 *
 * @param e if・while・loop・for の宣言
 * @returns 行の文字列（本体が無ければ空の配列）
 * @example
 * flowBodyLines(if x { action a; action b; } else { action c; }) // → ["then: a, b", "else: c"]
 * flowBodyLines(if x { action a; } else if y { action b; })       // → ["then: a", "else: if"]
 * flowBodyLines(loop { action a; })                              // → ["a"]
 */
export function flowBodyLines(e: Entry): string[] {
  const name = (c: Entry): string => c.name || c.kind;
  // else の本体と else if は、then の本体の閉じ括弧より後ろにある
  const isElse = (c: Entry): boolean => e.close != null && c.start > e.close;
  if (e.kind !== "if") return e.children.length ? [e.children.map(name).join(", ")] : [];
  const then = e.children.filter((c) => !isElse(c)).map(name);
  const other = e.children.filter(isElse).map(name);
  return [...(then.length ? [`then: ${then.join(", ")}`] : []), ...(other.length ? [`else: ${other.join(", ")}`] : [])];
}
