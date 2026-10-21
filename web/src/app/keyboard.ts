// キーボード操作の判断（Q-8）。DOM には触れず、要素の数と位置から、次に入力を移す位置を決める。

/**
 * ダイアログの中で Tab を押したときに、入力を移す先を決める。端から外へ出ようとしたときだけ、反対の端へ回す。
 * それ以外はブラウザの順のままにする（null）。
 *
 * @param count ダイアログの中の、入力を受け取れる要素の数
 * @param current 今入力を受け取っている要素の位置（0 から。ダイアログの外にあれば -1）
 * @param backward Shift+Tab（前へ戻る）なら true
 * @returns 入力を移す要素の位置。ブラウザに任せてよいとき・要素が無いときは null
 * @example
 * wrapFocus(3, 2, false) // → 0（最後から次へ：先頭へ回す）
 * wrapFocus(3, 0, true)  // → 2（先頭から前へ：最後へ回す）
 * wrapFocus(3, 1, false) // → null（途中はブラウザの順のまま）
 * wrapFocus(3, -1, true) // → 2（外にあれば、向きに合わせて端へ入れる）
 * wrapFocus(0, -1, false) // → null（受け取れる要素が無い）
 */
export function wrapFocus(count: number, current: number, backward: boolean): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  if (current < 0 || current > last) return backward ? last : 0;
  if (!backward && current === last) return 0;
  if (backward && current === 0) return last;
  return null;
}
