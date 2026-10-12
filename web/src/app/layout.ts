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

export const emptyView = (): ViewLayout => ({ pos: {}, pins: {}, ends: {} });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isSide = (v: unknown): v is Side => v === "t" || v === "b" || v === "l" || v === "r";
const isPos = (v: unknown): v is Pos => Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
const isPinPos = (v: unknown): v is PinPos => Array.isArray(v) && v.length === 2 && isSide(v[0]) && typeof v[1] === "number";
const isEndId = (v: unknown): v is string | null => v === null || typeof v === "string";
const isEnds = (v: unknown): v is Ends => Array.isArray(v) && v.length === 2 && isEndId(v[0]) && isEndId(v[1]);

/** `@layout` の JSON を読み取る。形の合わない値は捨てる。 */
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

/** `@layout` に書き出す JSON の形にする。空の接続点・線の端は書かない。 */
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
