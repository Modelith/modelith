// 線の形の調整（F-VIEW-16）：配置（ViewLayout）の曲がり角と付け替えた端を書き換える。判断だけの純粋関数。
// 画面の操作（つまみのドラッグ・ダブルクリック・インスペクタのボタン）は canvas.ts・inspector.ts が呼ぶ。

import type { Anchors, PinPos, Pos, ViewLayout } from "./layout";

/**
 * 線の曲がり角を動かす。
 *
 * @param L ビューの配置（書き換える）
 * @param id 線の ID
 * @param i 曲がり角の番号（0 から）
 * @param p 新しい位置（図の座標）
 * @example
 * moveBend(L, "e1", 0, [120, 80]) // → L.bends.e1[0] が [120, 80] になる（無い番号なら何もしない）
 */
export function moveBend(L: ViewLayout, id: string, i: number, p: Pos): void {
  const b = L.bends?.[id];
  if (b && i >= 0 && i < b.length) b[i] = p;
}

/**
 * 線の区間の中ほどに曲がり角を足す。区間 k は、始点・曲がり角・終点の k 番目と k + 1 番目の間。
 *
 * @param L ビューの配置（書き換える）
 * @param id 線の ID
 * @param k 区間の番号（0 から。曲がり角の数まで）
 * @param p 足す位置（図の座標）
 * @returns 足した曲がり角の番号（k と同じ）
 * @example
 * insertBend(L, "e1", 0, [50, 50]) // → 0（L.bends.e1 が [[50, 50]] になる）
 * insertBend(L, "e1", 1, [90, 50]) // → 1（L.bends.e1 が [[50, 50], [90, 50]] になる）
 */
export function insertBend(L: ViewLayout, id: string, k: number, p: Pos): number {
  const b = ((L.bends ||= {})[id] ||= []);
  const at = Math.max(0, Math.min(k, b.length));
  b.splice(at, 0, p);
  return at;
}

/**
 * 線の曲がり角を消す。曲がり角が無くなれば、その線の曲がり角の項目も消す。
 *
 * @param L ビューの配置（書き換える）
 * @param id 線の ID
 * @param i 曲がり角の番号（0 から）
 * @example
 * removeBend(L, "e1", 0) // → L.bends.e1 から 1 つ目を消す（最後の 1 つなら L.bends.e1 ごと消す）
 */
export function removeBend(L: ViewLayout, id: string, i: number): void {
  const b = L.bends?.[id];
  if (!b || i < 0 || i >= b.length) return;
  b.splice(i, 1);
  if (!b.length) delete L.bends?.[id];
}

/**
 * 線の端を、要素の縁の位置に付け替える。その端に接続点を指定していれば外す（付け替えた位置を使う）。
 *
 * @param L ビューの配置（書き換える）
 * @param id 線の ID
 * @param end 始点（"f"）か終点（"t"）か
 * @param at 縁の位置（`[向き, 縁に沿った割合]`）
 * @example
 * setAnchor(L, "e1", "t", ["l", 0.5]) // → L.anchors.e1 が [null, ["l", 0.5]] になる
 */
export function setAnchor(L: ViewLayout, id: string, end: "f" | "t", at: PinPos): void {
  const i = end === "f" ? 0 : 1;
  const a: Anchors = ((L.anchors ||= {})[id] ||= [null, null]);
  a[i] = at;
  const e = L.ends[id];
  if (e) {
    e[i] = null;
    if (!e[0] && !e[1]) delete L.ends[id];
  }
}

/**
 * 線に、利用者が調整した形（曲がり角・付け替えた端）があるか。
 *
 * @param L ビューの配置
 * @param id 線の ID
 * @returns 曲がり角か付け替えた端があれば true
 * @example
 * hasShape(L, "e1") // → true（曲がり角がある）
 * hasShape(emptyView(), "e1") // → false
 */
export const hasShape = (L: ViewLayout, id: string): boolean => !!L.bends?.[id]?.length || !!L.anchors?.[id];

/**
 * 線の形を元に戻す（曲がり角と付け替えた端を消し、自動の経路に戻す）。
 *
 * @param L ビューの配置（書き換える）
 * @param id 線の ID
 * @example
 * resetShape(L, "e1") // → L.bends.e1・L.anchors.e1 が無くなる
 */
export function resetShape(L: ViewLayout, id: string): void {
  delete L.bends?.[id];
  delete L.anchors?.[id];
}

/**
 * 要素のキーを変えたとき、線の ID（`種類|元のキー|先のキー|…`）を鍵にした表の鍵を付け替える（線の端・曲がり角・付け替えた端）。
 *
 * @param table 線の ID → 値の表（書き換える。無ければ何もしない）
 * @param oldKey 元の要素のキー
 * @param newKey 新しい要素のキー
 * @example
 * renameEdgeKeys({ "flow|A|B|#1": 1 }, "A", "X") // → 表が { "flow|X|B|#1": 1 } になる
 */
export function renameEdgeKeys<T>(table: Record<string, T> | undefined, oldKey: string, newKey: string): void {
  if (!table) return;
  for (const [k, val] of Object.entries(table)) {
    const parts = k.split("|");
    if (parts[1] !== oldKey && parts[2] !== oldKey) continue;
    table[parts.map((s, i) => ((i === 1 || i === 2) && s === oldKey ? newKey : s)).join("|")] = val;
    delete table[k];
  }
}

/**
 * 無くなった線の、曲がり角と付け替えた端を消す。
 *
 * @param L ビューの配置（書き換える）
 * @param ids 今ある線の ID
 * @example
 * pruneShapes(L, new Set(["e2"])) // → L.bends・L.anchors から e2 以外を消す
 */
export function pruneShapes(L: ViewLayout, ids: ReadonlySet<string>): void {
  for (const k of Object.keys(L.bends ?? {})) if (!ids.has(k)) delete L.bends?.[k];
  for (const k of Object.keys(L.anchors ?? {})) if (!ids.has(k)) delete L.anchors?.[k];
}
