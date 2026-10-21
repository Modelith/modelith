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

/**
 * ツリーの行のうち、Tab で入る行（tabindex="0" にする 1 行）を決める。選んでいる行があればその行、無ければ先頭の行にする（ARIA のツリーの型）。
 *
 * @param selected 行ごとの、選んでいるか（上から順）
 * @returns Tab で入る行の位置（0 から）。行が無ければ -1
 * @example
 * rovingStop([false, true, false]) // → 1（選んでいる行）
 * rovingStop([false, false])       // → 0（選んでいなければ先頭）
 * rovingStop([])                   // → -1（行が無い）
 */
export function rovingStop(selected: readonly boolean[]): number {
  if (!selected.length) return -1;
  return Math.max(0, selected.indexOf(true));
}

/**
 * 横に並んだタブで、矢印キー・Home・End を押したときに移る先を決める。左右の端では反対の端へ回る。
 *
 * @param count タブの数
 * @param current 今入力を受け取っているタブの位置（0 から）
 * @param key 押したキー（KeyboardEvent.key）
 * @returns 移る先のタブの位置。タブを移すキーでない・タブが無い・今の位置がタブの外なら null
 * @example
 * nextTabIndex(3, 0, "ArrowRight") // → 1
 * nextTabIndex(3, 2, "ArrowRight") // → 0（右端から先頭へ回る）
 * nextTabIndex(3, 0, "ArrowLeft")  // → 2（左端から最後へ回る）
 * nextTabIndex(3, 1, "End")        // → 2
 * nextTabIndex(3, 1, "Enter")      // → null（タブを移すキーでない）
 */
export function nextTabIndex(count: number, current: number, key: string): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
