// 図の幾何計算（ノードの大きさ・接続点・線の経路・自動配置）。DOM に依存しない純粋関数。

import type { Entry, ModelEdge, ModelNode, Port, PortDir } from "../core";
import { flowBodyLines, flowDetail, flowShape } from "./action-flow";
import { isPseudoState, stateActionLines } from "./state-machine";
import type { Pos, Side, ViewLayout } from "./layout";
import type { ViewDef } from "./views";

export const W = 224;
export const HEAD = 44;
export const LH = 15;

/**
 * 1 文字の幅の目安（11px の文字）。全角（CJK・全角記号）は 11、それ以外は 6.3。
 *
 * @param ch 1 文字
 * @returns 幅（図の座標の単位）
 * @example
 * cw("a")  // → 6.3
 * cw("部") // → 11
 */
const cw = (ch: string): number => (/[　-鿿＀-￯]/.test(ch) ? 11 : 6.3);
/**
 * 文字列の幅の目安（11px の文字）。1 文字ずつの幅（全角 11・半角 6.3）を足す。
 *
 * @param s 測る文字列
 * @returns 幅（図の座標の単位）。空文字列なら 0
 * @example
 * textWidth("ab")   // → 12.6
 * textWidth("部品") // → 22
 * textWidth("")     // → 0（境界）
 */
export const textWidth = (s: string): number => [...s].reduce((w, ch) => w + cw(ch), 0);

/**
 * 幅に収まるように折り返す。行数を超えたら最後の行の末尾を「…」に置き換えて切る。
 *
 * @param s 折り返す文字列
 * @param maxW 1 行の幅の上限（図の座標の単位。既定はノードの幅 W から余白を引いた 206）
 * @param maxLines 行数の上限（既定 3）
 * @returns 折り返した各行。空文字列なら空の配列
 * @example
 * wrap("abc", 13, 3)      // → ["ab", "c"]
 * wrap("abcdefgh", 13, 2) // → ["ab", "c…"]（行数を超えたので切る）
 * wrap("")                // → []（境界）
 */
export function wrap(s: string, maxW = W - 18, maxLines = 3): string[] {
  const out: string[] = [];
  let cur = "";
  let w = 0;
  for (const ch of s) {
    const c = cw(ch);
    if (w + c > maxW) {
      out.push(cur);
      cur = "";
      w = 0;
      if (out.length >= maxLines) break;
    }
    cur += ch;
    w += c;
  }
  if (out.length < maxLines && cur) out.push(cur);
  else if (out.length >= maxLines) {
    const last = out[maxLines - 1] ?? "";
    out[maxLines - 1] = last.slice(0, -1) + "…";
  }
  return out.slice(0, maxLines);
}

/**
 * 要素の見出しに «» で囲んで書くキーワード（8.2.3 の記法）。個体（`individual`、8.2.2.9）なら、種類の前に `individual` を付ける。
 *
 * @param n 図の要素
 * @returns «» の中に書く文字列
 * @example
 * keywordOf(part def Car)            // → "part def"
 * keywordOf(individual part def Car) // → "individual part def"
 * keywordOf(individual def Earth)    // → "individual occurrence def"（種類のキーワードを省いた形も、種類を書く）
 */
export function keywordOf(n: ModelNode): string {
  const individual = (n.entry.mods ?? "").split(" ").includes("individual");
  return individual ? `individual ${n.kind}` : n.kind;
}

/** 区画に書く、特殊化の種類の記号（テキスト記法と同じ。8.2.2.6）。 */
const SPEC_SYMBOL: Record<string, string> = { specializes: ":>", subsets: ":>", redefines: ":>>", references: "::>" };

/**
 * 区画に書く、属性・パラメータの 1 行（8.2.3 の usage-cp：テキスト記法の宣言と値）。
 * 多重度も特殊化の相手も無ければ、これまでどおり `名前 = 値` か `名前 : 型` にする。値は書いた記号のまま
 * （初期値は `名前 := 値`、既定値は `名前 default 値`。8.2.2.6 の FeatureValue）。
 * あれば `名前 : 型 [多重度] :>> 相手 = 値` の順に書き、名前を書かずに再定義した特性（`:>> mass`）は名前を省く。
 *
 * @param c 属性かパラメータの宣言
 * @returns 区画の 1 行
 * @example
 * featureText(attribute mass : Real)                 // → "mass : Real"
 * featureText(attribute w : Wheel[4] ordered)        // → "w : Wheel [4] ordered"
 * featureText(attribute :>> mass = 1500)             // → ":>> mass = 1500"（名前は再定義した特性から）
 * featureText(attribute b : B :> a, c)               // → "b : B :> a :> c"
 * featureText(attribute m := 10)                     // → "m := 10"（初期値）
 * featureText(attribute m : Real default 10)         // → "m default 10"（既定値。型は書かない）
 */
export function featureText(c: Entry): string {
  const specs = c.specs ?? [], m = c.multiplicity;
  const value = c.value ? `${c.valueOp ?? "="} ${c.value}` : "";
  if (!specs.length && !m) return value ? `${c.name} ${value}` : `${c.name} : ${c.type}`;
  const first = specs[0];
  const unnamed = !!first && first.target.split(/::|\./).pop() === c.name;
  const parts = [unnamed ? "" : c.name];
  if (c.type) parts.push(`: ${c.type}`);
  if (m?.range) parts.push(`[${m.range}]`);
  if (m?.ordered) parts.push("ordered");
  if (m?.nonunique) parts.push("nonunique");
  for (const s of specs) parts.push(`${SPEC_SYMBOL[s.op] ?? ":>"} ${s.target}`);
  parts.push(value);
  return parts.filter(Boolean).join(" ");
}

export interface Line {
  t: string;
  cls: "doc" | "expr" | "attr" | "more";
}

/**
 * ノードの区画（説明・式・属性など）に書く行を作る。要求などの説明（doc）、要求の require 式・制約の式、
 * part の属性、状態の一覧と遷移、アクションの手順を並べ、8 行を超えたら最後を「… ほか N 行」にまとめる。
 * メモ（`note`）は本文の行（`noteLines`）にする。
 *
 * @param n 図のノード
 * @returns 区画の行（文字列と種類）。書くことが無ければ空の配列
 * @example
 * // part def で、属性 mass : Real を 1 つ持つ
 * compartment(n) // → [{ t: "mass : Real", cls: "attr" }]
 * // part def で、名前を書かずに再定義した属性 :>> mass = 1500 を持つ
 * compartment(n) // → [{ t: ":>> mass = 1500", cls: "attr" }]
 * // 要求で、説明「速く走る」と require 式 v > 10 を持つ
 * compartment(n) // → [{ t: "速く走る", cls: "doc" }, { t: "{ v > 10 }", cls: "expr" }]
 * // 中身の無い part def
 * compartment(n) // → []（境界）
 * // 本文「安全のため」のメモ
 * compartment(n) // → [{ t: "安全のため", cls: "doc" }]
 * // アクションの流れの図の if x { action a; } else { action b; }
 * compartment(n) // → [{ t: "then: a", cls: "attr" }, { t: "else: b", cls: "attr" }]
 * // 状態遷移の図の state on { entry action init; }
 * compartment(n) // → [{ t: "entry / init", cls: "attr" }]
 */
export function compartment(n: ModelNode): Line[] {
  if (n.note) return noteLines(n.entry.body ?? "");
  // 状態遷移の図の状態は、entry・do・exit の振る舞いを書く（開始・終了の記号は書かない）
  if (n.state) return isPseudoState(n) ? [] : stateActionLines(n.entry).flatMap((t) => wrap(t, STATE_MAX_W - 18, 1).map((x) => ({ t: x, cls: "attr" as const })));
  // アクションの流れの図の if・while・loop・for は、本体のアクションの名前を書く
  if (n.flow) return flowBodyLines(n.entry).flatMap((t) => wrap(t, FLOW_W - 18, 1).map((x) => ({ t: x, cls: "attr" as const })));
  const e = n.entry;
  const L: Line[] = [];
  const push = (t: string, cls: Line["cls"], max = 2): void => {
    for (const x of wrap(t, W - 18, max)) L.push({ t: x, cls });
  };
  if (e.doc && ["req", "concern", "ver", "con"].includes(n.fam)) push(e.doc, "doc", 3);
  if (n.fam === "req") for (const x of e.exprs) if (x.via === "require" || !x.via) push(`{ ${x.text} }`, "expr");
  if (n.fam === "con") for (const x of e.exprs) push(x.text, "expr", 3);
  if (["part", "other"].includes(n.fam)) {
    for (const c of e.children) if (c.kind === "attribute" || c.kind === "param") push(featureText(c), "attr", 1);
  }
  if (n.kind === "state def") {
    const st = e.children.filter((c) => c.kind === "state").map((c) => c.name);
    if (st.length) push("states: " + st.join(", "), "attr");
    for (const t of n.trans) push(t, "expr", 1);
  }
  if (n.kind === "action def") {
    e.children.filter((c) => c.kind === "action").forEach((c, k) => push(`${k + 1}. ${c.name}`, "attr", 1));
  }
  const MAX = 8;
  if (L.length > MAX) {
    const rest = L.length - (MAX - 1);
    L.length = MAX - 1;
    L.push({ t: `… ほか ${rest} 行`, cls: "more" });
  }
  return L;
}

/** メモに書く本文の行数の上限。 */
const NOTE_MAX_LINES = 6;

/**
 * メモ（8.2.3.4 の comment）に書く本文の行を作る。本文の改行を保ち、幅に収まるよう折り返し、6 行を超えたら最後の行を「…」で切る。
 *
 * @param body コメントの本文（行は改行でつなぐ）
 * @returns 本文の行（種類はすべて doc）。本文が空なら空の配列
 * @example
 * noteLines("安全のため")       // → [{ t: "安全のため", cls: "doc" }]
 * noteLines("1 行目\n2 行目")   // → [{ t: "1 行目", cls: "doc" }, { t: "2 行目", cls: "doc" }]
 * noteLines("")                 // → []（境界）
 */
export function noteLines(body: string): Line[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const ws = line ? wrap(line, W - 36, NOTE_MAX_LINES + 1) : [""];
    out.push(...ws);
    if (out.length > NOTE_MAX_LINES) break;
  }
  if (out.length > NOTE_MAX_LINES) {
    out.length = NOTE_MAX_LINES;
    const last = out[NOTE_MAX_LINES - 1] ?? "";
    out[NOTE_MAX_LINES - 1] = last.endsWith("…") ? last : [...last].slice(0, -1).join("") + "…";
  }
  return body ? out.map((t) => ({ t, cls: "doc" as const })) : [];
}

/**
 * メモの本文の 1 行目の上端（メモの上端から）。名前のあるメモは、上に «comment» と名前の行を書く。
 *
 * @param n メモ（`note` の図の要素）
 * @returns 本文の上の余白（図の座標の単位）
 * @example
 * noteTop(名前の無いメモ) // → 10
 * noteTop(名前 c のメモ)  // → 28
 */
export const noteTop = (n: ModelNode): number => (n.name ? 28 : 10);

const linesCache = new WeakMap<ModelNode, Line[]>();
/**
 * 区画の行を返す。compartment の結果をノードごとにキャッシュする（同じノードには同じ配列を返す）。
 *
 * @param n 図のノード
 * @returns 区画の行（compartment と同じ）
 * @example
 * // 中身の無い part def
 * linesOf(n)                 // → []
 * linesOf(n) === linesOf(n)  // → true（キャッシュ）
 */
export function linesOf(n: ModelNode): Line[] {
  let L = linesCache.get(n);
  if (!L) {
    L = compartment(n);
    linesCache.set(n, L);
  }
  return L;
}

/**
 * ノードの高さ。見出しの高さ HEAD（44）に、区画があれば行数 × LH（15）と余白 12 を足す。
 * メモは見出しを持たず、本文の上の余白（noteTop）に、本文の行数（少なくとも 1）× LH と下の余白 8 を足す。
 * アクションの流れの図の要素は、形ごとの大きさ（flowSize）、状態遷移の図の要素は stateSize。
 *
 * @param n 図のノード
 * @returns 高さ（図の座標の単位）
 * @example
 * // 属性を 1 行だけ持つ part def
 * nodeH(n) // → 71
 * // 区画の行が無い
 * nodeH(n) // → 44（境界）
 * // 名前の無いメモで、本文が 2 行
 * nodeH(n) // → 10 + 2 × 15 + 8 = 48
 * // アクションの流れの図の fork
 * nodeH(n) // → 8（flowSize の高さ）
 */
export function nodeH(n: ModelNode): number {
  if (n.flow) return flowSize(n).h;
  if (n.state) return stateSize(n).h;
  const L = linesOf(n);
  if (n.note) return noteTop(n) + Math.max(1, L.length) * LH + 8;
  return HEAD + (L.length ? L.length * LH + 12 : 0);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** n 項の接続の点（8.2.3.13 の n-ary-connection-dot）の大きさ（四方）。 */
export const DOT = 12;
/** アクションの流れの図の、アクション（角の丸い四角・五角形）の幅。 */
export const FLOW_W = 168;
/** アクションの流れの図の、記号だけの要素の大きさ（開始・終了は四方、棒は幅と高さ、ひし形は四方）。 */
const FLOW_SYMBOL: Record<string, [number, number]> = { start: [22, 22], done: [26, 26], bar: [120, 8], diamond: [34, 34] };

/**
 * アクションの流れの図（8.2.3.17）の要素の大きさ。記号だけの要素（開始・終了・棒・ひし形）は決まった大きさ、
 * アクション・送る・受けるは幅 FLOW_W で、高さは見出し HEAD（名前と中身の両方を書くときは 14 足す）に、本体の行数 × LH と余白 12 を足す。
 *
 * @param n アクションの流れの図の要素
 * @returns 幅と高さ（図の座標の単位）
 * @example
 * flowSize(start)                         // → { w: 22, h: 22 }
 * flowSize(fork f)                        // → { w: 120, h: 8 }
 * flowSize(action a)                      // → { w: 168, h: 44 }
 * flowSize(action s send x)               // → { w: 168, h: 58 }（名前と中身の 2 行）
 * flowSize(if x { action a; })            // → { w: 168, h: 71 }（本体の 1 行）
 */
export function flowSize(n: ModelNode): { w: number; h: number } {
  const shape = flowShape(n.kind);
  const symbol = FLOW_SYMBOL[shape];
  if (symbol) return { w: symbol[0], h: symbol[1] };
  const L = linesOf(n);
  const both = !!n.name && !!flowDetail(n) && !["action", "perform action", "state"].includes(n.kind);
  return { w: FLOW_W, h: HEAD + (both ? 14 : 0) + (L.length ? L.length * LH + 12 : 0) };
}

/** 状態遷移の図の、状態（角の丸い四角）の幅の最小と最大、見出しの高さ。 */
export const STATE_W = 150;
const STATE_MAX_W = 280;
export const STATE_HEAD = 36;
/** 状態遷移の図の、開始・終了の記号の大きさ（四方）。 */
const STATE_SYMBOL: Record<string, number> = { start: 22, done: 26 };

/**
 * 状態遷移の図の見出しに書く文字（状態の名前。型があれば `名前 : 型`）。
 *
 * @param n 状態遷移の図の要素
 * @returns 見出しの文字列
 * @example
 * stateTitle(state off)          // → "off"
 * stateTitle(state m : Modes)    // → "m : Modes"
 */
export const stateTitle = (n: ModelNode): string => n.name + (n.entry.type && !isPseudoState(n) ? ` : ${n.entry.type}` : "");

/**
 * 状態遷移の図（8.2.3.18）の要素の大きさ。開始・終了は決まった大きさの丸。状態は、名前と区画の行が収まる幅（STATE_W 〜 280）で、
 * 高さは見出し STATE_HEAD に、区画（entry・do・exit）があれば行数 × LH と余白 10 を足す。中に状態を描く状態の大きさは boxesOf が決める。
 *
 * @param n 状態遷移の図の要素
 * @returns 幅と高さ（図の座標の単位）
 * @example
 * stateSize(start)                       // → { w: 22, h: 22 }
 * stateSize(state off)                   // → { w: 150, h: 36 }
 * stateSize(state on { entry a; do b; }) // → { w: 150, h: 76 }（区画の 2 行）
 */
export function stateSize(n: ModelNode): { w: number; h: number } {
  const symbol = STATE_SYMBOL[n.kind];
  if (symbol && isPseudoState(n)) return { w: symbol, h: symbol };
  const L = linesOf(n);
  const text = Math.max(textWidth(stateTitle(n)) * 1.15 + 28, ...L.map((l) => textWidth(l.t) + 24));
  const w = Math.min(STATE_MAX_W, Math.max(STATE_W, Math.ceil(text / 10) * 10));
  return { w, h: STATE_HEAD + (L.length ? L.length * LH + 10 : 0) };
}

/**
 * 要素の幅。n 項の接続の点は DOT、アクションの流れの図の要素は flowSize の幅、状態遷移の図の要素は stateSize の幅、ほかは W。
 *
 * @param n 図の要素
 * @returns 幅（図の座標の単位）
 * @example
 * nodeW(part def A) // → 224
 * nodeW(decide d)   // → 34
 * nodeW(state off)  // → 150
 */
export const nodeW = (n: ModelNode): number => (n.junction ? DOT : n.flow ? flowSize(n).w : n.state ? stateSize(n).w : W);
/** 中に部品を描く部品（内部ブロック図の入れ子）の、中の部品の周りの余白（左右・下）と、見出しの分を含む上の余白。 */
export const NEST_PAD = 20;
export const NEST_TOP = HEAD + 10;

/**
 * 中に要素を描く要素の、中の要素の上の余白（見出しの分を含む）。内部ブロック図の部品は NEST_TOP、
 * 状態遷移の図の状態は、見出しと区画（entry・do・exit）の高さに 14 を足す。
 *
 * @param n 中に要素を描く要素
 * @returns 上の余白（図の座標の単位）
 * @example
 * nestTop(部品 a)                  // → 54
 * nestTop(state on { entry a; … }) // → 36 + 15 + 10 + 14 = 75
 */
export const nestTop = (n: ModelNode): number => (n.state ? stateSize(n).h + 14 : NEST_TOP);
/** 中に部品を描く部品の、中の部品どうしの縦の間隔。 */
const NEST_GAP = 30;

/**
 * 図の要素の矩形を、配置の座標から求める。n 項の接続の点は DOT 四方、アクションの流れの図・状態遷移の図の要素は形ごとの大きさ、
 * 中に要素を描く要素（`container` で指される部品・状態）は
 * 中の要素をすべて囲む矩形（左右・下に NEST_PAD、上に見出しの分 nestTop の余白。中の要素がさらに中に要素を描くなら、その矩形を囲む）、
 * ほかは幅 W・高さ nodeH。
 *
 * @param nodes 図に描く要素
 * @param pos 要素のキーから左上の座標への対応（座標の無い要素は (0, 0) に置く）
 * @returns 要素のキーから矩形への対応（nodes の順）
 * @example
 * // A（行なし）が (10, 20)、点 j:#1 が (300, 40)
 * boxesOf([A, J], pos) // → Map { "A" → { x: 10, y: 20, w: 224, h: 44 }, "j:#1" → { x: 300, y: 40, w: 12, h: 12 } }
 * // u:a の中の部品 u:a.x が (100, 100)
 * boxesOf([a, ax], pos).get("u:a") // → { x: 80, y: 46, w: 264, h: 118 }（u:a 自身の座標は使わない）
 * boxesOf([], pos)     // → Map {}
 */
export function boxesOf(nodes: readonly ModelNode[], pos: Record<string, Pos>): Map<string, Box> {
  const out = new Map<string, Box>();
  const boxOf = (n: ModelNode, seen: Set<string>): Box => {
    const done = out.get(n.key);
    if (done) return done;
    const p = pos[n.key] ?? [0, 0];
    // 中の要素の中の要素も囲む（状態遷移の図の入れ子。輪があっても止まる）
    const inner = seen.has(n.key) ? [] : nodes.filter((c) => c.container === n.key).map((c) => boxOf(c, new Set([...seen, n.key])));
    let b: Box;
    if (!inner.length) {
      b = n.junction ? { x: p[0], y: p[1], w: DOT, h: DOT } : { x: p[0], y: p[1], w: nodeW(n), h: nodeH(n) };
    } else {
      const x0 = Math.min(...inner.map((r) => r.x)) - NEST_PAD, y0 = Math.min(...inner.map((r) => r.y)) - nestTop(n);
      const x1 = Math.max(...inner.map((r) => r.x + r.w), x0 + NEST_PAD + nodeW(n)) + NEST_PAD, y1 = Math.max(...inner.map((r) => r.y + r.h)) + NEST_PAD;
      b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    out.set(n.key, b);
    return b;
  };
  for (const n of nodes) boxOf(n, new Set());
  return new Map(nodes.map((n) => [n.key, out.get(n.key) as Box]));
}

/**
 * 中に部品を描く部品の、自動で並べるときの高さ（中の部品を縦に積んだ高さ。中の部品がさらに中に部品を描くなら、その高さで数える）。中に部品が無ければ nodeH。
 *
 * @param n 図の要素
 * @param nodes 図に描く要素（中の部品を探す）
 * @param depth たどった深さ（呼び出し側は省く）
 * @returns 高さ（図の座標の単位）
 * @example
 * // u:a の中に、行の無い部品が 2 つ
 * stackedHeight(a, nodes) // → 54 + 44 + 30 + 44 + 20 = 192
 * stackedHeight(b, nodes) // → 44（中に部品が無い）
 */
export function stackedHeight(n: ModelNode, nodes: readonly ModelNode[], depth = 0): number {
  const inner = depth > NEST_DEPTH ? [] : nodes.filter((c) => c.container === n.key);
  if (!inner.length) return nodeH(n);
  return NEST_TOP + inner.reduce((h, c) => h + stackedHeight(c, nodes, depth + 1), 0) + NEST_GAP * (inner.length - 1) + NEST_PAD;
}

/** 中の部品をたどる深さの上限（輪があっても止まるように）。 */
const NEST_DEPTH = 16;

/**
 * 中に部品を描く部品の、自動で並べるときの幅（中の部品を、左右に NEST_PAD の余白を付けて囲んだ幅。中の中の部品も）。中に部品が無ければ nodeW。
 *
 * @param n 図の要素
 * @param nodes 図に描く要素（中の部品を探す）
 * @param depth たどった深さ（呼び出し側は省く）
 * @returns 幅（図の座標の単位）
 * @example
 * // u:a の中に、中に部品の無い部品が 1 つ
 * stackedWidth(a, nodes) // → 20 + 224 + 20 = 264
 * // u:a の中の u:a.x の中に、さらに部品が 1 つ（3 段の入れ子）
 * stackedWidth(a, nodes) // → 20 + 264 + 20 = 304
 * stackedWidth(b, nodes) // → 224（中に部品が無い）
 */
export function stackedWidth(n: ModelNode, nodes: readonly ModelNode[], depth = 0): number {
  const inner = depth > NEST_DEPTH ? [] : nodes.filter((c) => c.container === n.key);
  if (!inner.length) return nodeW(n);
  return Math.max(nodeW(n), ...inner.map((c) => stackedWidth(c, nodes, depth + 1))) + 2 * NEST_PAD;
}

/**
 * 座標の無い中の部品を、外の部品の中に縦に積んで置く（pos を変更する）。外の部品の中にすでに置いた部品があれば、その下に足す。
 * 外の部品に座標が無ければ置かない（先に外の部品を並べること）。
 *
 * @param nodes 図に描く要素（中の部品は `container` を持つ）
 * @param pos 要素のキーから左上の座標への対応。中の部品の座標を書き込む
 * @example
 * // u:a が (0, 0)、中の部品 u:a.x・u:a.y に座標が無い
 * placeNested(nodes, pos) // → pos["u:a.x"] = [20, 54]、pos["u:a.y"] = [20, 128]（44 + 30 下）
 * // u:a に座標が無い
 * placeNested(nodes, pos) // → pos を変えない
 */
export function placeNested(nodes: readonly ModelNode[], pos: Record<string, Pos>): void {
  for (const outer of nodes) {
    const at = pos[outer.key];
    const inner = nodes.filter((c) => c.container === outer.key);
    if (!at || !inner.length) continue;
    const placed = inner.flatMap((c) => {
      const p = pos[c.key];
      return p ? [p[1] + nodeH(c)] : [];
    });
    let y = placed.length ? Math.max(...placed) + NEST_GAP : at[1] + NEST_TOP;
    const x = placed.length ? Math.min(...inner.flatMap((c) => (pos[c.key] ? [pos[c.key]?.[0] ?? 0] : []))) : at[0] + NEST_PAD;
    for (const c of inner) {
      if (pos[c.key]) continue;
      pos[c.key] = [x, y];
      // 中の部品がさらに中に部品を描くなら、その高さの分だけ下げる（3 段目から先の入れ子）
      y += stackedHeight(c, nodes) + NEST_GAP;
    }
  }
}

/** 状態遷移の図の自動の配置で、列の間（遷移のラベルを書く分）と、列の中の状態の間の空き。 */
const STATE_GAP_X = 110;
const STATE_GAP_Y = 50;

/**
 * 状態遷移の図の要素を、本体ごとに左から右へ並べた座標（自動の配置、8.2.3.18）。内側の本体から先に並べ、中に状態を描く状態の大きさを決めてから、
 * 外側の本体に並べる。本体の中は、遷移の向きに最も長い道のりの列にし（遷移の端は、その本体の直下の要素まで外へたどる。戻りの遷移は数えない）、
 * 列の中は上から書いた順に積み、列を縦の中央でそろえる。並行の状態の中（`regions` のキー。状態定義そのものは ""）は、領域を上から下へ積む。
 *
 * @param nodes 図に描く要素（中の要素は `container` を持つ）
 * @param edges 図の線（遷移）
 * @param regions 中を破線で区切った領域に描く並行の状態のキー（状態定義そのものが並行なら ""）
 * @returns 要素のキーから左上の座標への対応（中に状態を描く状態は、その矩形の左上）。外側の本体の左上が (0, 0)
 * @example
 * // 開始 → off → on（off・on は 150 × 36）
 * layoutStates([start, off, on], edges, []) // → { "s:#start": [0, 7], "s:off": [132, 0], "s:on": [392, 0] }
 * layoutStates([], [], [])                  // → {}
 */
export function layoutStates(nodes: readonly ModelNode[], edges: readonly ModelEdge[], regions: readonly string[]): Record<string, Pos> {
  const rel = new Map<string, Pos>();
  const size = new Map<string, { w: number; h: number }>();
  const children = (k: string): ModelNode[] => nodes.filter((n) => (n.container ?? "") === k);
  const parentOf = new Map(nodes.map((n) => [n.key, n.container ?? ""]));
  // 線の端を、本体 k の直下の要素までたどる
  const under = (key: string, k: string): string | null => {
    for (let at: string | undefined = key, i = 0; at !== undefined && i < nodes.length + 1; at = parentOf.get(at), i++) {
      if (parentOf.get(at) === k) return at;
    }
    return null;
  };
  const place = (k: string, seen: Set<string>): { w: number; h: number } => {
    const kids = children(k);
    for (const c of kids) {
      if (!seen.has(c.key) && children(c.key).length) {
        const inner = place(c.key, new Set([...seen, c.key]));
        size.set(c.key, { w: Math.max(inner.w + 2 * NEST_PAD, nodeW(c) + 2 * NEST_PAD), h: inner.h + nestTop(c) + NEST_PAD });
      } else size.set(c.key, { w: nodeW(c), h: nodeH(c) });
    }
    const sz = (c: ModelNode): { w: number; h: number } => size.get(c.key) ?? { w: 0, h: 0 };
    if (regions.includes(k)) {
      // 並行の状態の領域は、上から下へ積む
      let y = 0;
      for (const c of kids) {
        rel.set(c.key, [0, y]);
        y += sz(c).h + STATE_GAP_Y;
      }
      return { w: Math.max(0, ...kids.map((c) => sz(c).w)), h: Math.max(0, y - STATE_GAP_Y) };
    }
    const pairs = edges.flatMap((e) => {
      const a = under(e.from, k), b = under(e.to, k);
      return a && b && a !== b ? [[a, b] as const] : [];
    });
    const column = stateColumns(kids.map((c) => c.key), pairs);
    const cols: ModelNode[][] = [];
    for (const c of kids) (cols[column.get(c.key) ?? 0] ||= []).push(c);
    const heights = cols.map((col) => (col ?? []).reduce((h, c) => h + sz(c).h, 0) + STATE_GAP_Y * Math.max(0, (col ?? []).length - 1));
    const tallest = Math.max(0, ...heights);
    let x = 0;
    cols.forEach((col, i) => {
      if (!col?.length) return;
      const width = Math.max(...col.map((c) => sz(c).w));
      let y = ((tallest - (heights[i] ?? 0)) / 2);
      for (const c of col) {
        rel.set(c.key, [x + (width - sz(c).w) / 2, y]);
        y += sz(c).h + STATE_GAP_Y;
      }
      x += width + STATE_GAP_X;
    });
    return { w: Math.max(0, x - STATE_GAP_X), h: tallest };
  };
  place("", new Set());
  const out: Record<string, Pos> = {};
  const absolute = (k: string, ox: number, oy: number): void => {
    for (const c of children(k)) {
      const r = rel.get(c.key) ?? [0, 0];
      const at: Pos = [Math.round(ox + r[0]), Math.round(oy + r[1])];
      out[c.key] = at;
      if (children(c.key).length) absolute(c.key, at[0] + NEST_PAD, at[1] + nestTop(c));
    }
  };
  absolute("", 0, 0);
  return out;
}

/**
 * 状態遷移の図の、座標の無い要素を置く（pos を変更する）。どれにも座標が無ければ自動の配置（layoutStates）のとおりに置く。
 * 置いてある要素があれば、自動の配置での位置関係を保ったまま、外側の要素は置いてある要素の一番下から 80 下に、
 * 置いてある状態の中に新しく入った要素は、その状態の中の一番下に置く（その要素の中の要素も、一緒に動かした位置に置く）。
 *
 * @param nodes 図に描く要素（外の要素が、その中の要素より前にあること）
 * @param edges 図の線（遷移）
 * @param regions 中を破線で区切った領域に描く並行の状態のキー
 * @param pos 要素のキーから左上の座標への対応。置いた座標を書き込む
 * @example
 * // どれにも座標が無い
 * placeStates(nodes, edges, [], pos) // → pos は layoutStates(nodes, edges, []) と同じ
 * // s:off（0, 0、150 × 36）だけ置いてあり、s:on が新しい
 * placeStates([off, on], edges, [], pos) // → pos["s:on"] = [自動の配置の x, 116]（36 + 80 下）
 */
export function placeStates(nodes: readonly ModelNode[], edges: readonly ModelEdge[], regions: readonly string[], pos: Record<string, Pos>): void {
  const missing = new Set(nodes.filter((n) => !pos[n.key]).map((n) => n.key));
  if (!missing.size) return;
  const full = layoutStates(nodes, edges, regions);
  const placedAtStart = nodes.filter((n) => !missing.has(n.key));
  if (!placedAtStart.length) {
    Object.assign(pos, full);
    return;
  }
  const bottom = Math.max(...[...boxesOf(placedAtStart, pos).values()].map((b) => b.y + b.h));
  const tops = nodes.filter((n) => !n.container && missing.has(n.key)).map((n) => full[n.key]?.[1] ?? 0);
  const dy = bottom + 80 - (tops.length ? Math.min(...tops) : 0);
  const shift = new Map<string, Pos>();
  for (const n of nodes) {
    if (!missing.has(n.key)) continue;
    const f = full[n.key] ?? [0, 0];
    const c = n.container;
    let d: Pos;
    if (!c) d = [0, dy];
    else if (missing.has(c)) d = shift.get(c) ?? [0, dy];
    else {
      // 置いてある状態の中に新しく入った要素は、その状態の中の一番下に置く
      const outer = nodes.find((x) => x.key === c);
      const cb = outer ? boxesOf(nodes.filter((x) => pos[x.key]), pos).get(c) : undefined;
      const at: Pos = cb ? [cb.x + NEST_PAD, cb.y + cb.h - NEST_PAD + NEST_GAP] : [f[0], f[1] + dy];
      d = [at[0] - f[0], at[1] - f[1]];
    }
    shift.set(n.key, d);
    pos[n.key] = [f[0] + d[0], f[1] + d[1]];
  }
}

/**
 * 状態遷移の図の本体の中の、要素ごとの列（0 から）。遷移の元から先へ、最も長い道のりの列にする。
 * 深さ優先でたどったときに戻る遷移（繰り返し）と、自分への遷移は数えない。どの遷移にもつながらない要素は 0。
 *
 * @param keys 本体の直下の要素のキー（書いた順）
 * @param pairs 遷移の元と先（どちらも keys のどれか）
 * @returns 要素のキーから列への対応
 * @example
 * stateColumns(["start", "off", "on"], [["start", "off"], ["off", "on"], ["on", "off"]]) // → start: 0, off: 1, on: 2（on → off は戻り）
 * stateColumns(["a"], [])                                                               // → a: 0
 */
export function stateColumns(keys: readonly string[], pairs: readonly (readonly [string, string])[]): Map<string, number> {
  const state = new Map<string, "open" | "done">();
  const back = new Set<readonly [string, string]>();
  const visit = (k: string): void => {
    state.set(k, "open");
    for (const p of pairs.filter((x) => x[0] === k)) {
      const st = state.get(p[1]);
      if (st === "open") back.add(p);
      else if (!st) visit(p[1]);
    }
    state.set(k, "done");
  };
  const roots = keys.filter((k) => !pairs.some((p) => p[1] === k));
  for (const k of [...roots, ...keys]) if (!state.has(k)) visit(k);
  const dag = pairs.filter((p) => !back.has(p));
  const column = new Map(keys.map((k) => [k, 0]));
  const pending = new Map(keys.map((k) => [k, dag.filter((p) => p[1] === k).length]));
  const queue = keys.filter((k) => !pending.get(k));
  while (queue.length) {
    const k = queue.shift() as string;
    for (const p of dag.filter((x) => x[0] === k)) {
      column.set(p[1], Math.max(column.get(p[1]) ?? 0, (column.get(k) ?? 0) + 1));
      const left = (pending.get(p[1]) ?? 1) - 1;
      pending.set(p[1], left);
      if (!left) queue.push(p[1]);
    }
  }
  return column;
}

/**
 * 並行の状態の領域を区切る破線の位置（8.2.3.18）。領域（中の要素）を上から並べ、隣り合う 2 つの間の真ん中に、
 * 外の矩形の左端から右端まで横に引く。
 *
 * @param outer 外の矩形（並行の状態の矩形、状態定義そのものなら対象の枠）
 * @param areas 領域の矩形
 * @returns 破線の両端（y は同じ）。領域が 1 つ以下なら空
 * @example
 * regionSeparators({ x: 0, y: 0, w: 300, h: 200 }, [{ x: 20, y: 50, w: 100, h: 40 }, { x: 20, y: 140, w: 100, h: 40 }])
 * // → [{ x1: 0, x2: 300, y: 115 }]
 */
export function regionSeparators(outer: Box, areas: readonly Box[]): { x1: number; x2: number; y: number }[] {
  const sorted = [...areas].sort((a, b) => a.y - b.y);
  return sorted.slice(1).map((b, i) => {
    const a = sorted[i] as Box;
    return { x1: outer.x, x2: outer.x + outer.w, y: Math.round((a.y + a.h + b.y) / 2) };
  });
}

/**
 * n 項の接続の点の位置を、点につながる要素の中心の平均（重心）にする。重心が要素に重なるときは、つながる要素の下に 60 離して置く。
 * 座標の無い点だけを pos に書き込む（pos を変更する）。
 *
 * @param nodes 図に描く要素（点を含む）
 * @param edges 図の線（点から端への線で、つながる要素を決める）
 * @param pos 要素のキーから左上の座標への対応。点の座標を書き込む
 * @example
 * // 点 j:#1 が A（0, 0）と B（400, 0）につながり、どちらも幅 224・高さ 44
 * placeJunctions([A, B, J], edges, pos)    // → pos["j:#1"] = [306, 16]（中心の平均 (312, 22) から DOT の半分を引く）
 * // A（0, 0）・B（300, 0）・C（600, 0）につながる
 * placeJunctions([A, B, C, J], edges, pos) // → pos["j:#1"] = [406, 98]（中心の平均 (412, 22) は B に重なるので、下端 44 から 60 下）
 * // 点につながる要素に座標が無い
 * placeJunctions([J], edges, pos)       // → pos を変えない
 */
export function placeJunctions(nodes: readonly ModelNode[], edges: readonly ModelEdge[], pos: Record<string, Pos>): void {
  const boxes = boxesOf(nodes, pos);
  for (const j of nodes) {
    if (!j.junction || pos[j.key]) continue;
    const ends = edges.flatMap((e) => {
      const other = e.from === j.key ? e.to : e.to === j.key ? e.from : null;
      const b = other && pos[other] ? boxes.get(other) : undefined;
      return b ? [b] : [];
    });
    if (!ends.length) continue;
    const cx = ends.reduce((a, b) => a + b.x + b.w / 2, 0) / ends.length;
    let cy = ends.reduce((a, b) => a + b.y + b.h / 2, 0) / ends.length;
    const covered = [...boxes.entries()].some(([k, b]) => k !== j.key && pos[k] && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    if (covered) cy = Math.max(...ends.map((b) => b.y + b.h)) + 60;
    pos[j.key] = [Math.round(cx - DOT / 2), Math.round(cy - DOT / 2)];
  }
}

/** メモと、注釈する要素の間の空き。 */
const NOTE_GAP = 40;

/**
 * 座標の無いメモを、注釈する要素の近くに置く（pos を変更する）。最初の相手の右・上・左・下の順に、ほかの要素と重ならない所を選ぶ。
 * どこも重なるなら右に置く。相手に座標が無ければ置かない（先に相手を並べること）。
 *
 * @param nodes 図に描く要素（メモを含む）
 * @param edges 図の線（メモから相手への線で、相手を決める）
 * @param pos 要素のキーから左上の座標への対応。メモの座標を書き込む
 * @example
 * // メモ note:#1 が A（0, 0、幅 224・高さ 44）を注釈し、ほかに要素が無い
 * placeNotes([A, N], edges, pos) // → pos["note:#1"] = [264, 0]（A の右に 40 空けて）
 * // A の右に B（264, 0）がある
 * placeNotes([A, B, N], edges, pos) // → pos["note:#1"] = [0, -73]（A の上。メモの高さ 33 と 40 を空けて）
 * // 相手に座標が無い
 * placeNotes([N], edges, pos) // → pos を変えない
 */
export function placeNotes(nodes: readonly ModelNode[], edges: readonly ModelEdge[], pos: Record<string, Pos>): void {
  for (const n of nodes) {
    if (!n.note || pos[n.key]) continue;
    const target = edges.find((e) => e.from === n.key && pos[e.to])?.to;
    if (!target) continue;
    const boxes = boxesOf(nodes.filter((x) => pos[x.key]), pos);
    const t = boxes.get(target);
    if (!t) continue;
    const h = nodeH(n);
    const tries: Pos[] = [
      [t.x + t.w + NOTE_GAP, t.y],
      [t.x, t.y - h - NOTE_GAP],
      [t.x - W - NOTE_GAP, t.y],
      [t.x, t.y + t.h + NOTE_GAP],
    ];
    const free = (p: Pos): boolean =>
      ![...boxes.values()].some((b) => p[0] < b.x + b.w + 10 && p[0] + W + 10 > b.x && p[1] < b.y + b.h + 10 && p[1] + h + 10 > b.y);
    pos[n.key] = tries.find(free) ?? (tries[0] as Pos);
  }
}

export interface Pin {
  id: string;
  side: Side;
  t: number;
  port?: Port;
}

export interface NodeBox extends Box {
  n: ModelNode;
  pins: Pin[];
  /** 中に部品を描く部品（内部ブロック図の入れ子）。線の経路で避けるブロックにしない。 */
  holds?: boolean;
}

const DEF_SIDE: Record<PortDir, Side> = { in: "l", out: "r", inout: "b" };

/**
 * ブロック縁上の接続点を集める。ポート由来（port:名前）と自由な接続点（a1, a2…）がある。
 * ポートは配置に位置が無ければ向きで辺を決め（in は左・out は右・inout は下）、同じ向きの中で等間隔に並べる。
 * トレース・振る舞いのビューでは、配置に位置の無いポートは出さない。
 *
 * @param n 図のノード
 * @param L ビューの配置（無ければ undefined）
 * @param view ビューの ID（"trace"・"behavior" ならポートを位置のあるものだけにする）
 * @returns 接続点の一覧（ポート由来を in・out・inout の順に、続けて自由な接続点）
 * @example
 * // ノード A が in のポート p・q と out のポート o を持ち、配置が無い
 * pinsOf(n, undefined, "bdd")
 * // → [{ id: "port:p", side: "l", t: 1/3, port }, { id: "port:q", side: "l", t: 2/3, port }, { id: "port:o", side: "r", t: 0.5, port }]
 * // 同じノードで、配置に自由な接続点 a1 だけがある
 * pinsOf(n, { pins: { A: { a1: ["t", 0.3] } }, … }, "trace") // → [{ id: "a1", side: "t", t: 0.3 }]（ポートは出さない）
 */
export function pinsOf(n: ModelNode, L: ViewLayout | undefined, view: string): Pin[] {
  const stored = L?.pins[n.key] ?? {};
  const res: Pin[] = [];
  const g: Record<PortDir, Port[]> = { in: [], out: [], inout: [] };
  const hideUnplaced = view === "trace" || view === "behavior";
  for (const p of n.ports) if (!hideUnplaced || stored["port:" + p.name]) g[p.dir].push(p);
  for (const d of ["in", "out", "inout"] as const) {
    g[d].forEach((p, i, arr) => {
      const id = "port:" + p.name;
      const s = stored[id];
      res.push({ id, side: s ? s[0] : DEF_SIDE[d], t: s ? s[1] : (i + 1) / (arr.length + 1), port: p });
    });
  }
  for (const [id, v] of Object.entries(stored)) if (!id.startsWith("port:")) res.push({ id, side: v[0], t: v[1] });
  return res;
}

export interface BorderPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/**
 * 縁上の位置（辺と 0〜1 の割合）を座標と外向きの法線にする。
 *
 * @param b ブロックの矩形
 * @param side 辺（t：上・b：下・l：左・r：右）
 * @param t 辺に沿った位置の割合（0〜1。上下の辺は左から、左右の辺は上から）
 * @returns 縁上の座標（x, y）と外向きの単位法線（nx, ny）
 * @example
 * pinPoint({ x: 0, y: 0, w: 100, h: 50 }, "r", 0.5) // → { x: 100, y: 25, nx: 1, ny: 0 }
 * pinPoint({ x: 0, y: 0, w: 100, h: 50 }, "t", 0)   // → { x: 0, y: 0, nx: 0, ny: -1 }（角）
 */
export function pinPoint(b: Box, side: Side, t: number): BorderPoint {
  if (side === "t") return { x: b.x + t * b.w, y: b.y, nx: 0, ny: -1 };
  if (side === "b") return { x: b.x + t * b.w, y: b.y + b.h, nx: 0, ny: 1 };
  if (side === "l") return { x: b.x, y: b.y + t * b.h, nx: -1, ny: 0 };
  return { x: b.x + b.w, y: b.y + t * b.h, nx: 1, ny: 0 };
}

/**
 * 値を範囲に収める。
 *
 * @param v 値
 * @param a 下限
 * @param c 上限
 * @returns a 以上 c 以下に収めた値
 * @example
 * clamp(5, 0, 10)  // → 5
 * clamp(-3, 0, 10) // → 0（下限）
 */
const clamp = (v: number, a: number, c: number): number => Math.max(a, Math.min(c, v));

/**
 * 点に最も近い縁の位置を求める（10 単位に丸め、角から 8 以上離す）。
 *
 * @param b ブロックの矩形
 * @param px 点の x（図の座標）
 * @param py 点の y（図の座標）
 * @returns 辺・辺に沿った割合 t（小数 3 桁）・点から縁までの距離 d
 * @example
 * nearestBorder({ x: 0, y: 0, w: 100, h: 50 }, 53, -5) // → { side: "t", t: 0.5, d: 5 }
 * nearestBorder({ x: 0, y: 0, w: 100, h: 50 }, -3, 1)  // → { side: "l", t: 0.16, d: 3 }（角の近くは 8 離す）
 */
export function nearestBorder(b: Box, px: number, py: number): { side: Side; t: number; d: number } {
  const sides: { side: Side; along: number; len: number; d: number }[] = [
    { side: "t", along: clamp(px, b.x, b.x + b.w) - b.x, len: b.w, d: Math.hypot(px - clamp(px, b.x, b.x + b.w), py - b.y) },
    { side: "b", along: clamp(px, b.x, b.x + b.w) - b.x, len: b.w, d: Math.hypot(px - clamp(px, b.x, b.x + b.w), py - (b.y + b.h)) },
    { side: "l", along: clamp(py, b.y, b.y + b.h) - b.y, len: b.h, d: Math.hypot(px - b.x, py - clamp(py, b.y, b.y + b.h)) },
    { side: "r", along: clamp(py, b.y, b.y + b.h) - b.y, len: b.h, d: Math.hypot(px - (b.x + b.w), py - clamp(py, b.y, b.y + b.h)) },
  ];
  const s = sides.reduce((a, c) => (c.d < a.d ? c : a));
  const along = clamp(Math.round(s.along / 10) * 10, 8, s.len - 8);
  return { side: s.side, t: +(along / s.len).toFixed(3), d: s.d };
}

/**
 * 線の両端の接続点 ID を返す。配置で指定があればそれを、なければモデルのポートを使う。
 *
 * @param e 線
 * @param L ビューの配置（無ければ undefined）
 * @returns 始点 f と終点 t の接続点 ID。どちらも決まっていなければ null
 * @example
 * edgeEnds({ id: "e1", fromPort: "port:out", … }, undefined)  // → { f: "port:out", t: null }
 * edgeEnds({ id: "e1", … }, { ends: { e1: ["a1", "a2"] }, … }) // → { f: "a1", t: "a2" }（配置の指定が優先）
 */
export function edgeEnds(e: ModelEdge, L: ViewLayout | undefined): { f: string | null; t: string | null } {
  const o = L?.ends[e.id];
  return o ? { f: o[0], t: o[1] } : { f: e.fromPort ?? null, t: e.toPort ?? null };
}

/* ---- 線のルーティング ---- */
type Pt = [number, number];
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 相手の位置から、線を出す辺を選ぶ。縦のすき間が横のすき間以上なら上下、そうでなければ左右の辺にする。
 *
 * @param b 線を出すブロックの矩形
 * @param o 相手の矩形（点なら幅・高さ 0）
 * @returns 辺（t・b・l・r）
 * @example
 * chooseSide({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 0, w: 100, h: 50 }) // → "r"
 * chooseSide({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 }) // → "b"
 * chooseSide({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 100, h: 50 })   // → "t"（重なっているとき）
 */
export function chooseSide(b: Box, o: Box): Side {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ox = o.x + o.w / 2, oy = o.y + o.h / 2;
  const dx = ox - cx, dy = oy - cy;
  const gx = Math.abs(dx) - (b.w + o.w) / 2, gy = Math.abs(dy) - (b.h + o.h) / 2;
  if (gy >= gx) return dy > 0 ? "b" : "t";
  return dx > 0 ? "r" : "l";
}

/**
 * 水平・垂直の線分が矩形の内側を横切るか。縁に沿うだけなら横切らない。斜めの線分は常に false。
 *
 * @param a 線分の一端
 * @param b 線分の他端
 * @param r 矩形（x0, y0 が左上、x1, y1 が右下）
 * @returns 横切るなら true
 * @example
 * segHits([0, 5], [20, 5], { x0: 5, y0: 0, x1: 10, y1: 10 }) // → true
 * segHits([0, 0], [20, 0], { x0: 5, y0: 0, x1: 10, y1: 10 }) // → false（縁に沿うだけ）
 */
function segHits(a: Pt, b: Pt, r: Rect): boolean {
  if (a[1] === b[1]) {
    const y = a[1];
    if (y <= r.y0 || y >= r.y1) return false;
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    return hi > r.x0 && lo < r.x1;
  }
  if (a[0] === b[0]) {
    const x = a[0];
    if (x <= r.x0 || x >= r.x1) return false;
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    return hi > r.y0 && lo < r.y1;
  }
  return false;
}

/**
 * 折れ線から重複点と一直線上（水平・垂直）の中間点を除く。座標は小数 1 桁に丸める。
 *
 * @param pts 折れ線の点
 * @returns 簡単にした点の列。空なら空
 * @example
 * simplifyPath([[0, 0], [0, 0], [10, 0], [20, 0], [20, 5]]) // → [[0, 0], [20, 0], [20, 5]]
 * simplifyPath([[0.04, 0]])                                 // → [[0, 0]]（丸め）
 * simplifyPath([])                                          // → []（境界）
 */
export function simplifyPath(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q: Pt = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    const l = out[out.length - 1];
    if (l && l[0] === q[0] && l[1] === q[1]) continue;
    const a = out[out.length - 2];
    if (l && a && ((a[0] === l[0] && l[0] === q[0]) || (a[1] === l[1] && l[1] === q[1]))) {
      out[out.length - 1] = q;
      continue;
    }
    out.push(q);
  }
  return out;
}

/**
 * 直角の経路の候補から、短く・曲がりが少なく・ブロックを横切らず・出口と入口で折り返さないものを選ぶ。
 * 端点から法線の向きに 18 だけ出た点を経由する候補を作り、長さ・曲がりの数・横切りの数で費用を比べる。
 *
 * @param P1 始点（図の座標）
 * @param N1 始点の外向きの法線（[1, 0] など）
 * @param P2 終点（図の座標）
 * @param N2 終点の外向きの法線
 * @param obs 避けるブロックの矩形
 * @returns 経路の点の列（simplifyPath 済み。始点と終点を含む）
 * @example
 * orthoRoute([0, 0], [1, 0], [100, 0], [-1, 0], [])  // → [[0, 0], [100, 0]]（一直線）
 * orthoRoute([0, 0], [1, 0], [100, 50], [-1, 0], []) // → [[0, 0], [82, 0], [82, 50], [100, 50]]
 */
export function orthoRoute(P1: Pt, N1: Pt, P2: Pt, N2: Pt, obs: Rect[]): Pt[] {
  const s = 18;
  const S1: Pt = [P1[0] + N1[0] * s, P1[1] + N1[1] * s], S2: Pt = [P2[0] + N2[0] * s, P2[1] + N2[1] * s];
  const x0 = Math.min(S1[0], S2[0]) - 260, x1 = Math.max(S1[0], S2[0]) + 260, y0 = Math.min(S1[1], S2[1]) - 260, y1 = Math.max(S1[1], S2[1]) + 260;
  const near = obs.filter((r) => r.x1 > x0 && r.x0 < x1 && r.y1 > y0 && r.y0 < y1);
  const ys = new Set([(S1[1] + S2[1]) / 2, S1[1], S2[1]]), xs = new Set([(S1[0] + S2[0]) / 2, S1[0], S2[0]]);
  for (const r of near) {
    ys.add(r.y0 - 12);
    ys.add(r.y1 + 12);
    xs.add(r.x0 - 12);
    xs.add(r.x1 + 12);
  }
  const cands: Pt[][] = [[S1, [S2[0], S1[1]], S2], [S1, [S1[0], S2[1]], S2]];
  for (const m of ys) cands.push([S1, [S1[0], m], [S2[0], m], S2]);
  for (const m of xs) cands.push([S1, [m, S1[1]], [m, S2[1]], S2]);
  let best: Pt[] = [P1, P2];
  let bc = Infinity;
  for (const c of cands) {
    const pts = simplifyPath([P1, ...c, P2]);
    let len = 0, hits = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i] as Pt, q = pts[i - 1] as Pt;
      len += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
    }
    for (let i = 0; i < c.length - 1; i++) for (const r of near) if (segHits(c[i] as Pt, c[i + 1] as Pt, r)) hits++;
    // 出口・入口で折り返さない
    const c1 = c[1] as Pt, cl = c[c.length - 2] as Pt;
    const d1 = [c1[0] - S1[0], c1[1] - S1[1]] as Pt, dl = [S2[0] - cl[0], S2[1] - cl[1]] as Pt;
    let back = 0;
    if (d1[0] * N1[0] + d1[1] * N1[1] < -0.1) back++;
    if (dl[0] * N2[0] + dl[1] * N2[1] > 0.1) back++;
    const cost = len + (pts.length - 2) * 26 + hits * 4000 + back * 3000;
    if (cost < bc) {
      bc = cost;
      best = pts;
    }
  }
  return best;
}

/**
 * 折れ線の角を丸めた SVG パスを作る。角の丸めの半径は、前後の区間の半分を超えない。
 *
 * @param pts 折れ線の点（2 点以上）
 * @param r 角の丸めの半径（図の座標の単位。既定 9）
 * @returns SVG の path の d 属性の文字列
 * @example
 * roundedPath([[0, 0], [100, 0], [100, 100]]) // → "M0,0 L91,0 Q100,0 100,9 L100,100"
 * roundedPath([[0, 0], [4, 0], [4, 4]])       // → "M0,0 L2,0 Q4,0 4,2 L4,4"（短い区間では半径を縮める）
 * roundedPath([[0, 0], [10, 0]])              // → "M0,0 L10,0"（角が無い）
 */
export function roundedPath(pts: Pt[], r = 9): string {
  const f = (p: Pt): string => `${p[0]},${p[1]}`;
  let d = `M${f(pts[0] as Pt)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Pt, c = pts[i] as Pt, b = pts[i + 1] as Pt;
    const l1 = Math.hypot(c[0] - a[0], c[1] - a[1]), l2 = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1: Pt = [c[0] - ((c[0] - a[0]) / l1) * rr, c[1] - ((c[1] - a[1]) / l1) * rr];
    const p2: Pt = [c[0] + ((b[0] - c[0]) / l2) * rr, c[1] + ((b[1] - c[1]) / l2) * rr];
    d += ` L${f(p1)} Q${f(c)} ${f(p2)}`;
  }
  return d + ` L${f(pts[pts.length - 1] as Pt)}`;
}

export interface RouteEnd {
  P: Pt;
  N: Pt;
  side: Side;
  t: number;
  pin: Pin | null;
}

export interface Route {
  d: string;
  lab: { x: number; y: number; a: "middle" | "start" };
  from: RouteEnd;
  to: RouteEnd;
}

interface RouteRec {
  e: ModelEdge;
  A: NodeBox;
  B: NodeBox;
  fp: Pin | undefined;
  tp: Pin | undefined;
  fs: Side;
  ts: Side;
  ft: number;
  tt: number;
}

/**
 * すべての線について、出口・入口の位置と経路を決める。接続点の決まっていない端は、
 * 同じ辺から出る線を相手の位置の順に等間隔に並べ、固定の接続点を避ける（アクションの流れの図・状態遷移の図の丸とひし形は、辺の中央に集める）。ラベルの位置も決める。
 *
 * @param box ノードのキーから、ノードの矩形と接続点への対応
 * @param edges 描く線
 * @param L ビューの配置（無ければ undefined）
 * @param style 線の形（"ortho"：直角に折れる・"curve"：曲線）
 * @returns 線の ID から経路（SVG パス・ラベルの位置・両端）への対応。両端のノードが box に無い線は含めない
 * @example
 * // A が (0, 0, 100×50)、B が (300, 0, 100×50) にあり、接続点は無い
 * computeRoutes(box, [{ id: "e1", from: "A", to: "B", … }], undefined, "ortho").get("e1")
 * // → { d: "M100,25 L300,25", lab: { x: 200, y: 38, a: "middle" }, from: { P: [100, 25], side: "r", … }, to: { P: [300, 25], side: "l", … } }
 * computeRoutes(box, [{ id: "e1", from: "A", to: "X", … }], undefined, "ortho").size // → 0（相手が図に無い）
 */
export function computeRoutes(box: Map<string, NodeBox>, edges: ModelEdge[], L: ViewLayout | undefined, style: "ortho" | "curve"): Map<string, Route> {
  const recs: RouteRec[] = [];
  const groups = new Map<string, { rec: RouteRec; end: "f" | "t"; o: Pt }[]>();
  const pointBox = (q: BorderPoint): Box => ({ x: q.x, y: q.y, w: 0, h: 0 });
  const addGroup = (k: string, it: { rec: RouteRec; end: "f" | "t"; o: Pt }): void => {
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  };
  for (const e of edges) {
    const A = box.get(e.from), B = box.get(e.to);
    if (!A || !B) continue;
    const en = edgeEnds(e, L);
    const fp = en.f ? A.pins.find((p) => p.id === en.f) : undefined;
    const tp = en.t ? B.pins.find((p) => p.id === en.t) : undefined;
    const qa = fp ? pinPoint(A, fp.side, fp.t) : null, qb = tp ? pinPoint(B, tp.side, tp.t) : null;
    const rec: RouteRec = {
      e, A, B, fp, tp,
      fs: fp ? fp.side : chooseSide(A, qb ? pointBox(qb) : B),
      ts: tp ? tp.side : chooseSide(B, qa ? pointBox(qa) : A),
      ft: 0.5, tt: 0.5,
    };
    const other = (q: BorderPoint | null, ob: Box): Pt => (q ? [q.x, q.y] : [ob.x + ob.w / 2, ob.y + ob.h / 2]);
    if (!fp) addGroup(A.n.key + "|" + rec.fs, { rec, end: "f", o: other(qb, B) });
    if (!tp) addGroup(B.n.key + "|" + rec.ts, { rec, end: "t", o: other(qa, A) });
    recs.push(rec);
  }
  // 同じ辺から出る線は、相手の位置の順に等間隔に並べ、固定の接続点を避ける
  for (const [k, list] of groups) {
    const nk = k.slice(0, k.lastIndexOf("|"));
    const side = k.slice(k.lastIndexOf("|") + 1) as Side;
    const b = box.get(nk);
    if (!b) continue;
    const horiz = side === "t" || side === "b";
    const len = horiz ? b.w : b.h;
    list.sort((u, v) => (horiz ? u.o[0] - v.o[0] : u.o[1] - v.o[1]));
    const fixed = b.pins.filter((p) => p.side === side).map((p) => p.t * len);
    // 開始・終了の丸とひし形は、線をその頂点（辺の中央）に集める
    const point = (!!b.n.flow && ["start", "done", "diamond"].includes(flowShape(b.n.kind))) || isPseudoState(b.n);
    list.forEach((it, i) => {
      if (point) {
        if (it.end === "f") it.rec.ft = 0.5;
        else it.rec.tt = 0.5;
        return;
      }
      let pos = (len * (i + 1)) / (list.length + 1);
      for (let g = 0; g < 3; g++) {
        const hit = fixed.find((f) => Math.abs(f - pos) < 16);
        if (hit == null) break;
        pos = hit + (pos >= hit ? 16 : -16);
      }
      pos = Math.max(8, Math.min(len - 8, pos));
      if (it.end === "f") it.rec.ft = pos / len;
      else it.rec.tt = pos / len;
    });
  }
  // 中に部品を描く部品は、中へ入る線が通れるよう、避けるブロックにしない
  const obs: Rect[] = [...box.values()].filter((b) => !b.holds).map((b) => ({ x0: b.x - 6, y0: b.y - 6, x1: b.x + b.w + 6, y1: b.y + b.h + 6 }));
  const out = new Map<string, Route>();
  const endOf = (b: Box, pin: Pin | undefined, side: Side, t: number): RouteEnd => {
    if (pin) {
      const q = pinPoint(b, pin.side, pin.t);
      const o = pin.port ? 7 : 0;
      return { P: [q.x + q.nx * o, q.y + q.ny * o], N: [q.nx, q.ny], side: pin.side, t: pin.t, pin };
    }
    const q = pinPoint(b, side, t);
    return { P: [q.x, q.y], N: [q.nx, q.ny], side, t, pin: null };
  };
  for (const r of recs) {
    const a = endOf(r.A, r.fp, r.fs, r.ft), z = endOf(r.B, r.tp, r.ts, r.tt);
    let d: string;
    let lab: Route["lab"];
    if (style === "curve") {
      const dd = Math.hypot(z.P[0] - a.P[0], z.P[1] - a.P[1]);
      const kk = Math.max(28, Math.min(150, dd * 0.45));
      const C1: Pt = [a.P[0] + a.N[0] * kk, a.P[1] + a.N[1] * kk], C2: Pt = [z.P[0] + z.N[0] * kk, z.P[1] + z.N[1] * kk];
      d = `M${a.P.join(",")} C${C1.join(",")} ${C2.join(",")} ${z.P.join(",")}`;
      lab = {
        x: 0.125 * a.P[0] + 0.375 * C1[0] + 0.375 * C2[0] + 0.125 * z.P[0],
        y: 0.125 * a.P[1] + 0.375 * C1[1] + 0.375 * C2[1] + 0.125 * z.P[1] - 4,
        a: "middle",
      };
    } else {
      const pts = orthoRoute(a.P, a.N, z.P, z.N, obs);
      d = roundedPath(pts);
      // ラベルは最も長い区間に置く
      let li = 1, ll = -1;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i] as Pt, q = pts[i - 1] as Pt;
        const l = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
        if (l > ll) {
          ll = l;
          li = i;
        }
      }
      const a0 = pts[li - 1] as Pt, a1 = pts[li] as Pt;
      lab = a0[1] === a1[1] ? { x: (a0[0] + a1[0]) / 2, y: a0[1] + 13, a: "middle" } : { x: a0[0] + 5, y: (a0[1] + a1[1]) / 2 + 4, a: "start" };
    }
    out.set(r.e.id, { d, lab, from: a, to: z });
  }
  return out;
}

/**
 * 線の端に書く文字（多重度など）の位置。端のある辺の外側に置き、線に重ならないよう線の横にずらす。
 *
 * @param end 線の端（位置 P と、辺の外向きの向き N）
 * @returns 文字の位置（x・y はベースライン）と揃え
 * @example
 * endLabelPos({ P: [100, 50], N: [0, -1], … }) // → { x: 104, y: 44, a: "start" }（上の辺：線の右、辺の上）
 * endLabelPos({ P: [100, 50], N: [0, 1], … })  // → { x: 104, y: 64, a: "start" }（下の辺：線の右、辺の下）
 * endLabelPos({ P: [0, 25], N: [-1, 0], … })   // → { x: -6, y: 20, a: "end" }（左の辺：線の上、辺の左）
 */
export function endLabelPos(end: RouteEnd): { x: number; y: number; a: "start" | "end" } {
  const [x, y] = end.P, [nx, ny] = end.N;
  if (nx !== 0) return { x: x + nx * 6, y: y - 5, a: nx > 0 ? "start" : "end" };
  return { x: x + 4, y: ny < 0 ? y - 6 : y + 14, a: "start" };
}

/** 一般な側を上に置く線の種類（特殊化・部分集合・再定義・参照。線は特殊な側から一般な側へ向く）。 */
const UPWARD_EDGES = ["specialize", "subset", "redefine", "reference"];

/**
 * 深さで並べるときの、線の上下の向き（上の要素、下の要素）。特殊化などは一般な側（線の終わり）を上にし、ほかは線の始まりを上にする。
 *
 * @param e 図の線
 * @returns [上に置く要素のキー, 下に置く要素のキー]
 * @example
 * downward({ kind: "comp", from: "V", to: "W", … })       // → ["V", "W"]（持ち主が上）
 * downward({ kind: "specialize", from: "B", to: "A", … }) // → ["A", "B"]（一般な A が上）
 */
export function downward(e: ModelEdge): [string, string] {
  return UPWARD_EDGES.includes(e.kind) ? [e.to, e.from] : [e.from, e.to];
}

/** 自動配置で上から並べる順位。 */
const RANK: Record<string, number> = {
  "concern def": 0, requirement: 1, "requirement def": 2, part: 3, "part def": 3, "verification def": 3, "attribute def": 5,
  "analysis def": 5, "constraint def": 5, "calc def": 5, "state def": 5, "action def": 5, "occurrence def": 5, "port def": 6,
  "interface def": 6, "item def": 7,
};

/**
 * 配置済みの要素の下に、未配置の要素を段ごとに並べ、座標を pos に書き込む（pos を変更する）。
 * 段は、ビューが段の決め方（`layer`）を持てばそれで、深さで並べるなら線の向きの深さ（特殊化などは一般な側を上に。`downward`）、
 * そうでなければ種類の順位（RANK）で決める。
 * 段の中は前の段とのつながりの重心で並べ替えて線の交差を減らし、1 段は 7 個までで折り返す。
 *
 * @param list 並べる（未配置の）ノード
 * @param edges 図の線（段と並び順の計算に使う）
 * @param pos ノードのキーから座標への対応。並べた座標を書き込む
 * @param v ビューの定義（layer があればそれで、depth が真なら線の深さで段を決める。control・ibd では信号の上流を左に置く）
 * @param firstPhase 最初の段階の名前。その段階の requirement def を requirement の上の段に置く。無ければ null
 * @param oy 最初の段の y 座標（既定 0。配置済みの要素の下端を渡す）
 * @param heightOf 要素の高さ（既定 nodeH。中に部品を描く部品は、中の部品を積んだ高さを渡す）
 * @param widthOf 要素の幅（既定はすべて W。W より狭い要素は列の中央に置く）
 */
export function autoPlace(
  list: ModelNode[], edges: ModelEdge[], pos: Record<string, Pos>, v: ViewDef, firstPhase: string | null, oy = 0,
  heightOf: (n: ModelNode) => number = nodeH, widthOf: (n: ModelNode) => number = () => W,
): void {
  const keys = new Set(list.map((n) => n.key));
  let layer = new Map<string, number>();
  if (v.layer) {
    layer = v.layer(list, edges);
  } else if (v.depth) {
    const down = edges.map(downward);
    const inc = new Map(list.map((n) => [n.key, 0]));
    for (const [from, to] of down) if (keys.has(to) && keys.has(from)) inc.set(to, (inc.get(to) ?? 0) + 1);
    const q = list.filter((n) => !inc.get(n.key)).map((n) => n.key);
    for (const k of q) layer.set(k, 0);
    while (q.length) {
      const k = q.shift() as string;
      for (const [from, to] of down) {
        if (from === k && keys.has(to) && !layer.has(to)) {
          layer.set(to, (layer.get(k) ?? 0) + 1);
          q.push(to);
        }
      }
    }
    for (const n of list) if (!layer.has(n.key)) layer.set(n.key, 0);
  } else {
    for (const n of list) layer.set(n.key, n.kind === "requirement def" && firstPhase && n.phase === firstPhase ? 0.5 : (RANK[n.kind] ?? 8));
  }
  const rows = [...new Set(layer.values())].sort((a, b) => a - b);
  const byRow = rows.map((r) => list.filter((n) => layer.get(n.key) === r));
  if (v.id === "control" || v.id === "ibd") {
    // 信号の流れの上流を左に
    const flows = edges.filter((e) => e.kind === "flow");
    const score = (n: ModelNode): number => {
      let s = 0, k = 0;
      for (const e of flows) {
        if (e.to === n.key) { s += 1; k++; }
        if (e.from === n.key) { s -= 1; k++; }
      }
      return k ? s / k : 0;
    };
    for (const row of byRow) row.sort((a, b) => score(a) - score(b));
  }
  // 前の段とのつながりの重心で並べ替え、線の交差を減らす
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r < byRow.length; r++) {
      const prev = (byRow[r - 1] ?? []).map((n) => n.key);
      const bc = (n: ModelNode): number => {
        const xs: number[] = [];
        for (const e of edges) {
          if (e.from === n.key && prev.includes(e.to)) xs.push(prev.indexOf(e.to));
          if (e.to === n.key && prev.includes(e.from)) xs.push(prev.indexOf(e.from));
        }
        return xs.length ? xs.reduce((a, b) => a + b) / xs.length : 999;
      };
      byRow[r]?.sort((a, b) => bc(a) - bc(b));
    }
  }
  let y = oy;
  const GX = 70, maxPer = 7;
  const widest = Math.min(maxPer, Math.max(...byRow.map((r) => r.length)));
  for (const row of byRow) {
    for (let i = 0; i < row.length; i += maxPer) {
      const chunk = row.slice(i, i + maxPer);
      const off = ((widest - chunk.length) * (W + GX)) / 2;
      chunk.forEach((n, k) => {
        // 幅の狭い要素（アクションの流れの図の記号）は、列の中央に置く
        pos[n.key] = [Math.round((off + k * (W + GX) + (W - widthOf(n)) / 2) / 10) * 10, y];
      });
      y += Math.max(...chunk.map(heightOf)) + 110;
    }
  }
}

/** package の枠の余白（左右・下）と、名前の札の分を含む上の余白。 */
export const PKG_PAD = 18;
export const PKG_TAB = 30;

/**
 * package の枠の位置と大きさ（F-VIEW-9）。枠は、中の要素と、中の枠をすべて囲む。
 * 左右・下に PKG_PAD（18）、上に名前の札の分 PKG_TAB（30）の余白をとる。
 * 中に描く要素が 1 つも無い枠は null（描かない）。`inner` に輪があっても止まる。
 *
 * @param frames 枠ごとの、中の要素のキー（keys）と、中の枠の番号（inner。frames の添字）
 * @param boxOf 要素のキーから矩形を返す関数。図に無ければ undefined
 * @returns 枠ごとの矩形（frames と同じ順）。描かない枠は null
 * @example
 * // A が (0, 0, 100×50)、B が (200, 100, 100×50)
 * packageRects([{ keys: ["A", "B"], inner: [] }], boxOf) // → [{ x: -18, y: -30, w: 336, h: 198 }]
 * packageRects([{ keys: ["Gone"], inner: [] }], boxOf)   // → [null]（中に描く要素が無い）
 */
export function packageRects(frames: readonly { keys: readonly string[]; inner: readonly number[] }[], boxOf: (key: string) => Box | undefined): (Box | null)[] {
  const memo = new Map<number, Box | null>();
  const rect = (i: number, seen: Set<number>): Box | null => {
    const hit = memo.get(i);
    if (hit !== undefined) return hit;
    const f = frames[i];
    if (!f || seen.has(i)) return null;
    const next = new Set(seen).add(i);
    const parts = [...f.keys.flatMap((k) => boxOf(k) ?? []), ...f.inner.flatMap((j) => rect(j, next) ?? [])];
    if (!parts.length) {
      memo.set(i, null);
      return null;
    }
    const x0 = Math.min(...parts.map((b) => b.x)) - PKG_PAD;
    const y0 = Math.min(...parts.map((b) => b.y)) - PKG_TAB;
    const x1 = Math.max(...parts.map((b) => b.x + b.w)) + PKG_PAD;
    const y1 = Math.max(...parts.map((b) => b.y + b.h)) + PKG_PAD;
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    memo.set(i, r);
    return r;
  };
  return frames.map((_, i) => rect(i, new Set()));
}
