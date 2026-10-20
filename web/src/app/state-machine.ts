// 状態遷移の図（StateTransitionView、8.2.3.18）の中身を、モデルの状態遷移の図から作る。
// 要素のキーと線の ID は Rust のコア（crates/modelith-core/src/model/states.rs）が決めたもの。図の操作（edit/states.rs）も同じものを探す（ADR-0016）。

import type { Entry, Model, ModelEdge, ModelNode } from "../core";
import { kindLabel } from "./labels";

/** 状態遷移の図に描く要素と線。`regions` は、中の要素を破線で区切った領域に描く並行の状態のキー（状態定義そのものが並行なら ""）。 */
export interface StateContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
  regions: string[];
}

/**
 * 状態遷移の図にできる状態定義を集める。
 *
 * @param M モデル
 * @returns state def のノード（モデルの順）。無ければ空
 * @example
 * // state def KettleStates と part def Heater がある
 * stateContexts(M).map((n) => n.key) // → ["KettleStates"]
 */
export const stateContexts = (M: Model): ModelNode[] => M.nodes.filter((n) => n.kind === "state def");

/**
 * 状態遷移の図の既定の対象（遷移の最も多い状態定義。同数なら先のもの）を選ぶ。
 *
 * @param M モデル
 * @returns 対象のノード。状態定義が無ければ null
 * @example
 * // KettleStates に遷移が 6 本、Lamp に 0 本
 * defaultStateContext(M)?.key // → "KettleStates"
 * // 状態定義が無い
 * defaultStateContext(M)      // → null
 */
export function defaultStateContext(M: Model): ModelNode | null {
  const lines = (n: ModelNode): number => M.stateMachines?.find((f) => f.key === n.key)?.edges.length ?? 0;
  return stateContexts(M).reduce<ModelNode | null>((best, n) => (!best || lines(n) > lines(best) ? n : best), null);
}

/**
 * 状態遷移の図の中身を作る。モデルの状態遷移の図の要素を、種類 `state` の図の要素にし（開始・終了の宣言は対象の状態定義）、
 * 入れ子の状態は外の状態を `container` に持たせる。線（遷移）はそのまま使う。
 *
 * @param M モデル
 * @param ctx 図の対象（状態定義のノード）
 * @returns 要素・線・並行の領域を持つ状態のキー。対象の状態遷移の図が無ければ空
 * @example
 * // state def S { entry; then off; state off; state on parallel { state a; state b; } } のとき
 * stateContentOf(M, S) // → { nodes: [s:#start, s:off, s:on, s:on.a, s:on.b], edges: [{ id: "transition|s:#start|s:off|#1", … }], regions: ["s:on"] }
 */
export function stateContentOf(M: Model, ctx: ModelNode): StateContent {
  const f = M.stateMachines?.find((x) => x.key === ctx.key);
  if (!f) return { nodes: [], edges: [], regions: [] };
  const nodes = f.nodes.map(
    (n): ModelNode => ({
      key: n.key, name: n.name, short: "", kind: n.kind, isDef: false, entry: n.entry ?? ctx.entry, fam: "beh", trans: [], ports: [],
      state: true, phase: null, phaseOwn: false,
      ...(n.container ? { container: n.container } : {}),
      ...(n.parallel ? { parallel: true } : {}),
    }),
  );
  const regions = [...(f.parallel ? [""] : []), ...nodes.filter((n) => n.parallel && nodes.some((c) => c.container === n.key)).map((n) => n.key)];
  return { nodes, edges: f.edges, regions };
}

/**
 * 状態の entry・do・exit の振る舞いを、区画の行の文字列にする（8.2.3.18 の state の区画）。`action a` は `a` と書く。
 *
 * @param e 状態の宣言
 * @returns 行の文字列（`entry / 振る舞い` の形。振る舞いが無ければ空の配列）
 * @example
 * stateActionLines(state on { entry action init; do heat; exit send Off() to h; }) // → ["entry / init", "do / heat", "exit / send Off() to h"]
 * stateActionLines(state off;)                                                    // → []
 */
export const stateActionLines = (e: Entry): string[] =>
  (e.stateActions ?? []).map((a) => `${a.kind} / ${a.text.replace(/^action\s+(?=\S)/, "")}`);

/**
 * 状態遷移の図の要素が、開始・終了の記号（宣言を持たない）か。
 *
 * @param n 状態遷移の図の要素
 * @returns 開始・終了の記号なら true
 * @example
 * isPseudoState(s:#start) // → true
 * isPseudoState(s:off)    // → false
 */
export const isPseudoState = (n: ModelNode): boolean => !!n.state && (n.kind === "start" || n.kind === "done");

/**
 * 状態遷移の図の要素を、画面に出す名前にする。開始・終了の記号と名前の無い状態は、種類の画面の言葉にする（ADR-0014）。
 *
 * @param n 状態遷移の図の要素
 * @returns 画面に出す名前
 * @example
 * stateName(state off)  // → "off"
 * stateName(start)      // → "開始"
 * stateName(state;)     // → "状態"（名前が無い）
 */
export const stateName = (n: ModelNode): string => (isPseudoState(n) || !n.name ? kindLabel(n.kind) : n.name);

/**
 * 遷移（8.2.2.18）を a から b へ引けるか。両方が状態遷移の図の別の要素で、開始・終了の記号から始まらず、開始の記号へ向かわず、
 * 名前の無い状態（テキストで参照できない）を含まず、終了の記号へは同じ状態の中の状態から向かうときに引ける。
 *
 * @param a 線の元
 * @param b 線の先
 * @returns 引けるなら true
 * @example
 * canTransition(off, on)        // → true
 * canTransition(off, start)     // → false（開始の記号へは向かわない）
 * canTransition(on.low, done)   // → false（終了の記号は別の本体）
 * canTransition(off, 名前の無い状態) // → false
 */
export const canTransition = (a: ModelNode, b: ModelNode): boolean =>
  !!a.state && !!b.state && a.key !== b.key && !isPseudoState(a) && b.kind !== "start" &&
  !!a.name && (isPseudoState(b) || !!b.name) && (b.kind !== "done" || a.container === b.container);

/**
 * 状態の名前を変えたときの、図の要素のキーの付け替え（配置を新しいキーに移すのに使う）。状態のキーの最後の名前を変え、
 * 中の要素（`s:外.中`・`s:外#start` など）のキーの頭も変える。
 *
 * @param key 名前を変える状態のキー（`s:on`・`s:on.low`）
 * @param name 新しい名前
 * @param keys 図の要素のキー
 * @returns （古いキー, 新しいキー）の組。先頭は名前を変える状態
 * @example
 * renamedStateKeys("s:on", "run", ["s:on", "s:on.low", "s:on#start", "s:off"]) // → [["s:on", "s:run"], ["s:on.low", "s:run.low"], ["s:on#start", "s:run#start"]]
 * renamedStateKeys("s:on.low", "dim", ["s:on.low"])                           // → [["s:on.low", "s:on.dim"]]
 */
export function renamedStateKeys(key: string, name: string, keys: readonly string[]): [string, string][] {
  const renamed = key.replace(/(^s:|\.)[^.]*$/, (_, head: string) => head + name);
  const inner = keys.filter((k) => k.startsWith(key + ".") || k.startsWith(key + "#"));
  return [[key, renamed], ...inner.map((k): [string, string] => [k, renamed + k.slice(key.length)])];
}
