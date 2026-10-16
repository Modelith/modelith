// 図の配置情報（座標・接続点・線の端）の型と、`@layout` の JSON との相互変換。

export type Side = "t" | "b" | "l" | "r";
export type Pos = [number, number];
export type PinPos = [Side, number];
/** 線の両端の接続点 ID（未指定は null）。 */
export type Ends = [string | null, string | null];

export interface ViewLayout {
  /** 要素のキー → 左上の座標。 */
  pos: Record<string, Pos>;
  /** 要素のキー → 接続点 ID → 縁の位置。 */
  pins: Record<string, Record<string, PinPos>>;
  /** 線の ID → 両端の接続点。 */
  ends: Record<string, Ends>;
}

/** ビューのキー（`trace`・`ibd:<文脈>` など）→ 配置。 */
export type Layout = Record<string, ViewLayout>;

/**
 * 空のビューの配置を作る（呼ぶたびに新しいオブジェクト）。
 *
 * @returns 座標・接続点・線の端がすべて空の配置
 * @example
 * emptyView() // → { pos: {}, pins: {}, ends: {} }
 */
export const emptyView = (): ViewLayout => ({ pos: {}, pins: {}, ends: {} });

/**
 * 値が（配列でない）オブジェクトか。
 *
 * @param v 調べる値（JSON から読んだもの）
 * @returns オブジェクトなら true。null・配列・数値などは false
 * @example
 * isObj({ a: 1 }) // → true
 * isObj([1, 2])   // → false
 * isObj(null)     // → false
 */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/**
 * 値が縁の向き（`t`・`b`・`l`・`r`）か。
 *
 * @param v 調べる値
 * @returns 上下左右のどれかなら true
 * @example
 * isSide("l") // → true
 * isSide("z") // → false
 */
const isSide = (v: unknown): v is Side => v === "t" || v === "b" || v === "l" || v === "r";
/**
 * 値が座標（数 2 つの配列）か。
 *
 * @param v 調べる値
 * @returns `[x, y]` の形なら true
 * @example
 * isPos([10, 20]) // → true
 * isPos([1])      // → false（要素が 1 つ）
 */
const isPos = (v: unknown): v is Pos => Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
/**
 * 値が接続点の縁の位置（`[向き, 縁に沿った割合]`）か。
 *
 * @param v 調べる値
 * @returns `[Side, number]` の形なら true
 * @example
 * isPinPos(["r", 0.5]) // → true
 * isPinPos(["z", 0.5]) // → false（向きが違う）
 */
const isPinPos = (v: unknown): v is PinPos => Array.isArray(v) && v.length === 2 && isSide(v[0]) && typeof v[1] === "number";
/**
 * 値が線の端の接続点 ID（文字列か、未指定の null）か。
 *
 * @param v 調べる値
 * @returns 文字列か null なら true
 * @example
 * isEndId("a1") // → true
 * isEndId(null) // → true
 * isEndId(3)    // → false
 */
const isEndId = (v: unknown): v is string | null => v === null || typeof v === "string";
/**
 * 値が線の両端（接続点 ID か null の 2 つの配列）か。
 *
 * @param v 調べる値
 * @returns `[端, 端]` の形なら true
 * @example
 * isEnds(["a1", null]) // → true
 * isEnds(["a1"])       // → false（要素が 1 つ）
 */
const isEnds = (v: unknown): v is Ends => Array.isArray(v) && v.length === 2 && isEndId(v[0]) && isEndId(v[1]);

/**
 * `@layout` の JSON（ビューのキー → 要素のキー → 座標、と `@pins`・`@ends`）を読み取る。形の合わない値は捨てる。
 *
 * @param raw JSON から読んだオブジェクト（ビューのキー → その中身）
 * @returns ビューごとの配置。オブジェクトでないビューは除く
 * @example
 * layoutFromJson({ trace: { A: [10, 20], "@pins": { A: { a1: ["r", 0.5] } } } })
 * // → { trace: { pos: { A: [10, 20] }, pins: { A: { a1: ["r", 0.5] } }, ends: {} } }
 * layoutFromJson({ trace: { A: [1], B: "x" }, broken: 3 })
 * // → { trace: { pos: {}, pins: {}, ends: {} } }（形の合わない値を捨てる）
 */
export function layoutFromJson(raw: Record<string, unknown>): Layout {
  const out: Layout = {};
  for (const [vk, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const view = emptyView();
    for (const [k, x] of Object.entries(v)) {
      if (k === "@pins" && isObj(x)) {
        for (const [nk, pv] of Object.entries(x)) {
          if (!isObj(pv)) continue;
          const pins: Record<string, PinPos> = {};
          for (const [id, p] of Object.entries(pv)) if (isPinPos(p)) pins[id] = p;
          view.pins[nk] = pins;
        }
      } else if (k === "@ends" && isObj(x)) {
        for (const [ek, e] of Object.entries(x)) if (isEnds(e)) view.ends[ek] = e;
      } else if (isPos(x)) view.pos[k] = x;
    }
    out[vk] = view;
  }
  return out;
}

/**
 * 配置を `@layout` に書き出す JSON の形にする（layoutFromJson の逆）。空の接続点・線の端は書かない。
 *
 * @param layout ビューごとの配置
 * @returns ビューのキー → 要素のキー → 座標（と `@pins`・`@ends`）のオブジェクト
 * @example
 * layoutToJson({ v: { pos: { A: [0, 0] }, pins: { A: {} }, ends: {} } }) // → { v: { A: [0, 0] } }（空の接続点は書かない）
 */
export function layoutToJson(layout: Layout): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [vk, v] of Object.entries(layout)) {
    const o: Record<string, unknown> = { ...v.pos };
    const pins = Object.fromEntries(Object.entries(v.pins).filter(([, pv]) => Object.keys(pv).length));
    if (Object.keys(pins).length) o["@pins"] = pins;
    if (Object.keys(v.ends).length) o["@ends"] = v.ends;
    out[vk] = o;
  }
  return out;
}
