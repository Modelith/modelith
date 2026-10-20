// タッチの判定（F-EDIT-10）。指を置いて離すまでがタップか、続く 2 回のタップがダブルタップかを決める。
// 画面のイベントは扱わず、点と時刻だけで判断する（イベントをつなぐのは word-help.ts）。

/** 指を置いた点・離した点と、その時刻。 */
export interface TouchPoint {
  /** 画面の x 座標（clientX） */
  x: number;
  /** 画面の y 座標（clientY） */
  y: number;
  /** 時刻（ミリ秒。イベントの timeStamp） */
  time: number;
}

/** タップとみなす、指を置いてから離すまでの動きの上限（px）。これより動いたらスクロール。 */
const TAP_SLOP = 10;
/** タップとみなす、指を置いてから離すまでの時間の上限（ミリ秒）。これより長いと長押し。 */
const TAP_TIME = 500;
/** ダブルタップとみなす、1 回目と 2 回目のタップの間の時間の上限（ミリ秒）。 */
const DOUBLE_TAP_GAP = 400;
/** ダブルタップとみなす、1 回目と 2 回目のタップの点の離れ方の上限（px）。指の太さのぶれを許す。 */
const DOUBLE_TAP_DISTANCE = 24;

/**
 * 2 つの点の距離。
 *
 * @param a 点
 * @param b 点
 * @returns 距離（px）
 * @example
 * distance({ x: 0, y: 0, time: 0 }, { x: 3, y: 4, time: 0 }) // → 5
 */
const distance = (a: TouchPoint, b: TouchPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 指を置いて離すまでが、タップか（スクロールや長押しでないか）。
 *
 * @param start 指を置いた点と時刻
 * @param end 指を離した点と時刻
 * @returns ほとんど動かさず、すぐに離したなら true
 * @example
 * isTap({ x: 10, y: 10, time: 0 }, { x: 12, y: 11, time: 80 })  // → true
 * isTap({ x: 10, y: 10, time: 0 }, { x: 10, y: 60, time: 80 })  // → false（スクロール）
 * isTap({ x: 10, y: 10, time: 0 }, { x: 10, y: 10, time: 900 }) // → false（長押し）
 */
export const isTap = (start: TouchPoint, end: TouchPoint): boolean =>
  distance(start, end) <= TAP_SLOP && end.time - start.time >= 0 && end.time - start.time <= TAP_TIME;

/**
 * 続く 2 回のタップが、ダブルタップか。
 *
 * @param first 1 回目のタップで指を離した点と時刻
 * @param second 2 回目のタップで指を離した点と時刻
 * @returns 2 回目が 1 回目からすぐに、ほぼ同じ所で起きたなら true
 * @example
 * isDoubleTap({ x: 10, y: 10, time: 0 }, { x: 14, y: 12, time: 250 }) // → true
 * isDoubleTap({ x: 10, y: 10, time: 0 }, { x: 10, y: 10, time: 700 }) // → false（間が空いた）
 * isDoubleTap({ x: 10, y: 10, time: 0 }, { x: 90, y: 10, time: 250 }) // → false（離れた所）
 */
export const isDoubleTap = (first: TouchPoint, second: TouchPoint): boolean =>
  distance(first, second) <= DOUBLE_TAP_DISTANCE && second.time - first.time >= 0 && second.time - first.time <= DOUBLE_TAP_GAP;
