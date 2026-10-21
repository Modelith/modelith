// v1 のプラグインから届くメッセージの上限（F-PLUG-7）と、答えを待つ期限（F-PLUG-8）の判断。入出力を持たない。
// プラグインが大量の・巨大なメッセージを送っても画面が動き続けるよう、コアに確かめてもらう前の入口で捨てる。
// 期限は、ホストがタイマーで数え、ここでは文と判断だけを決める。

import type { PendingRequest } from "./messages";

/** 入口で使う上限。 */
export interface MessageLimits {
  /** 1 つのメッセージの大きさの上限（文字列の長さと値の数を合わせた単位。messageUnits）。 */
  maxUnits: number;
  /** 扱い終わっていないメッセージの数の上限。これに達している間に届いたものは捨てる。 */
  maxQueued: number;
  /** 1 回の実行で捨てたメッセージがこの数に達したら、プラグインを止める。 */
  maxDropped: number;
}

/**
 * 1 つのメッセージの大きさの上限（messageUnits の単位）。20 MB のファイルの書き出し（base64 で約 28M 文字。transfer.ts の MAX_TRANSFER_BYTES）は通し、
 * それより大きいものは入口で捨てる。
 */
export const MAX_MESSAGE_UNITS = 32 * 1024 * 1024;
/** 扱い終わっていないメッセージの数の上限。 */
export const MAX_QUEUED_MESSAGES = 100;
/** 1 回の実行で捨てたメッセージがこの数に達したら、プラグインを止める。 */
export const MAX_DROPPED_MESSAGES = 1000;
/** 既定の入口の上限。 */
export const MESSAGE_LIMITS: MessageLimits = { maxUnits: MAX_MESSAGE_UNITS, maxQueued: MAX_QUEUED_MESSAGES, maxDropped: MAX_DROPPED_MESSAGES };

/** 1 回の診断で問題一覧に出す件数の上限。超えた分は捨てて、問題一覧でそのことを示す。 */
export const MAX_DIAGNOSTICS = 1000;
/** 利用者への知らせ（notify）の、1 秒あたりの上限。超えた分は捨てて数える。 */
export const MAX_NOTIFIES_PER_SECOND = 5;
/** 知らせの頻度を数える窓（ミリ秒）。 */
const NOTIFY_WINDOW_MS = 1000;

/** コマンド・取り込み・書き出しの答えを待つ期限（ミリ秒）。 */
export const REQUEST_TIMEOUT_MS = 30_000;
/** 起動（activate への ready）を待つ期限（ミリ秒）。 */
export const READY_TIMEOUT_MS = 10_000;

/** 1 つのプラグインの、入口の数え上げ。 */
export interface IntakeState {
  /** 扱い終わっていないメッセージの数。 */
  queued: number;
  /** 動かし始めてから捨てたメッセージの数。 */
  dropped: number;
}

/** 届いたメッセージの扱い。accept は待ちに入れる。drop は捨てて一覧で知らせる。halt は捨てたうえでプラグインを止めて知らせる。 */
export type Intake = { kind: "accept"; state: IntakeState } | { kind: "drop" | "halt"; state: IntakeState; notice: string };

/**
 * 届いたデータの大きさを、文字列の長さと値の数を合わせた単位で数える。上限を超えたら、そこで数えるのをやめる（巨大なデータを歩き切らない）。
 * 循環するデータは一度だけ歩く（JSON にできないものは、後で messageJson が捨てる）。
 *
 * @param data 届いたデータ（構造化複製された値）
 * @param limit 数える上限（超えたら limit + 1 以上の値で止まる）
 * @returns 大きさ。limit を超えていれば limit より大きい値（正確な大きさではない）
 * @example
 * messageUnits({ type: "ready" }, 100)                // → 7（オブジェクト 1 + キー 4 + 文字列 5 … の合計）
 * messageUnits("a".repeat(10), 5)                      // → 10（上限を超えたので、そこで止まる）
 * messageUnits({ items: Array(3).fill({ n: 1 }) }, 100) // → 15
 */
export function messageUnits(data: unknown, limit: number): number {
  let units = 0;
  const seen = new Set<object>();
  const stack: unknown[] = [data];
  while (stack.length > 0 && units <= limit) {
    const v = stack.pop();
    if (typeof v === "string") units += v.length;
    else if (typeof v !== "object" || v === null) units += 1;
    else if (!seen.has(v)) {
      seen.add(v);
      units += 1;
      if (Array.isArray(v)) stack.push(...v);
      else {
        for (const k of Object.keys(v)) {
          units += k.length;
          stack.push((v as Record<string, unknown>)[k]);
        }
      }
    }
  }
  return units;
}

/**
 * 届いたメッセージを待ちに入れるか、捨てるか、捨てたうえで止めるかを決める（F-PLUG-7）。
 * 待ちが上限に達している・大きさが上限を超えるものは捨てる。捨てた数が上限に達したら止める。
 *
 * @param state 今の数え上げ
 * @param data 届いたデータ（まだ確かめていない値）
 * @param limits 上限
 * @returns 扱いと、新しい数え上げ（accept なら queued が 1 増える。drop・halt なら dropped が 1 増える）
 * @example
 * intake({ queued: 0, dropped: 0 }, { type: "ready" }, MESSAGE_LIMITS)   // → { kind: "accept", state: { queued: 1, dropped: 0 } }
 * intake({ queued: 100, dropped: 0 }, { type: "ready" }, MESSAGE_LIMITS) // → { kind: "drop", state: { queued: 100, dropped: 1 }, notice: "届いたメッセージが多すぎるため、使いませんでした（待ちの上限 100 件）" }
 * intake({ queued: 0, dropped: 0 }, "x".repeat(MAX_MESSAGE_UNITS + 1), MESSAGE_LIMITS) // → { kind: "drop", …, notice: "大きすぎるメッセージが届いたため、使いませんでした（上限 32 MB）" }
 * intake({ queued: 100, dropped: 999 }, { type: "ready" }, MESSAGE_LIMITS) // → { kind: "halt", state: { queued: 100, dropped: 1000 }, notice: "届いたメッセージが多すぎるため、停止を指示しました（使わなかったメッセージ 1000 件）" }
 */
export function intake(state: IntakeState, data: unknown, limits: MessageLimits): Intake {
  const reason =
    state.queued >= limits.maxQueued
      ? `届いたメッセージが多すぎるため、使いませんでした（待ちの上限 ${limits.maxQueued} 件）`
      : messageUnits(data, limits.maxUnits) > limits.maxUnits
        ? `大きすぎるメッセージが届いたため、使いませんでした（上限 ${Math.round(limits.maxUnits / (1024 * 1024))} MB）`
        : null;
  if (reason === null) return { kind: "accept", state: { ...state, queued: state.queued + 1 } };
  const dropped = state.dropped + 1;
  if (dropped >= limits.maxDropped) return { kind: "halt", state: { ...state, dropped }, notice: `届いたメッセージが多すぎるため、停止を指示しました（使わなかったメッセージ ${dropped} 件）` };
  return { kind: "drop", state: { ...state, dropped }, notice: reason };
}

/**
 * 利用者への知らせ（notify）を出してよいかを決める（1 秒に perSecond 件まで。F-PLUG-7）。
 *
 * @param recent 最近出した知らせの時刻（ミリ秒。古い順）
 * @param now 今の時刻（ミリ秒）
 * @param perSecond 1 秒あたりの上限
 * @returns 出してよいかと、新しい最近の時刻（1 秒より前のものは除き、出したならその時刻を足す）
 * @example
 * notifyAllowance([], 1000, 5)                        // → { allowed: true, recent: [1000] }
 * notifyAllowance([0, 0, 0, 0], 999, 5)               // → { allowed: true, recent: [0, 0, 0, 0, 999] }（1 秒の中の 5 件目）
 * notifyAllowance([0, 0, 0, 0, 0], 999, 5)            // → { allowed: false, recent: [0, 0, 0, 0, 0] }（6 件目）
 * notifyAllowance([0, 0, 0, 0, 0], 1000, 5)           // → { allowed: true, recent: [1000] }（1 秒たてば数え直す）
 */
export function notifyAllowance(recent: readonly number[], now: number, perSecond: number): { allowed: boolean; recent: number[] } {
  const inWindow = recent.filter((t) => now - t < NOTIFY_WINDOW_MS);
  if (inWindow.length >= perSecond) return { allowed: false, recent: inWindow };
  return { allowed: true, recent: [...inWindow, now] };
}

/** 知らせを捨てたことの文の頭（数が変わるたびに、一覧の前の行を置き換えるための目印）。 */
export const DROPPED_NOTIFY_PREFIX = "知らせが多すぎるため、";

/**
 * 知らせを捨てたことを一覧に出す文。
 *
 * @param count これまでに捨てた知らせの数（1 以上）
 * @param perSecond 1 秒あたりの上限
 * @returns 一覧の文（DROPPED_NOTIFY_PREFIX で始まる）
 * @example
 * droppedNotifyNotice(3, 5) // → "知らせが多すぎるため、3 件を表示しませんでした（1 秒に 5 件まで）"
 */
export function droppedNotifyNotice(count: number, perSecond: number): string {
  return `${DROPPED_NOTIFY_PREFIX}${count} 件を表示しませんでした（1 秒に ${perSecond} 件まで）`;
}

/**
 * 診断の件数が上限を超えて捨てたことを、問題一覧に出す文。
 *
 * @param name プラグインの名前
 * @param dropped 捨てた件数（1 以上）
 * @param max 上限
 * @returns 問題一覧の文
 * @example
 * droppedDiagnosticsNote("レビューの記録", 20, 1000) // → "プラグイン「レビューの記録」の問題が多すぎるため、20 件を示していません（上限 1000 件）"
 */
export function droppedDiagnosticsNote(name: string, dropped: number, max: number): string {
  return `プラグイン「${name}」の問題が多すぎるため、${dropped} 件を示していません（上限 ${max} 件）`;
}

/**
 * 頼んだことのうち、期限を過ぎて、まだ知らせていないものの番号を求める（F-PLUG-8）。
 *
 * @param pending 頼んで、まだ答えの無いこと（依頼の番号 → 頼んだ時刻（ミリ秒）と、知らせたか）
 * @param now 今の時刻（ミリ秒）
 * @param timeoutMs 期限（ミリ秒）
 * @returns 期限を過ぎた依頼の番号（番号の順）。ちょうど期限の時刻も過ぎたとみなす
 * @example
 * overdueRequests(new Map([[1, { since: 0 }]]), 29_999, 30_000)                  // → []
 * overdueRequests(new Map([[1, { since: 0 }]]), 30_000, 30_000)                  // → [1]（境界値）
 * overdueRequests(new Map([[1, { since: 0, reported: true }]]), 30_001, 30_000)  // → []（知らせた後）
 */
export function overdueRequests(pending: ReadonlyMap<number, { since: number; reported?: boolean }>, now: number, timeoutMs: number): number[] {
  return [...pending].filter(([, r]) => !r.reported && now - r.since >= timeoutMs).map(([id]) => id).sort((a, b) => a - b);
}

/**
 * 頼んだことが期限までに終わらないときの、一覧の文（トーストでは頭にプラグインの名前を付ける）。
 *
 * @param request 頼んだこと。null なら起動（ready 待ち）
 * @param timeoutMs 期限（ミリ秒）
 * @returns 一覧の文。次の操作（「停止」）も示す
 * @example
 * stuckNotice({ kind: "command", title: "ID を付ける" }, 30_000) // → "コマンド「ID を付ける」が 30 秒たっても終わりません。「停止」で止められます"
 * stuckNotice(null, 10_000)                                     // → "起動が 10 秒たっても終わりません。「停止」で止められます"
 */
export function stuckNotice(request: PendingRequest | null, timeoutMs: number): string {
  const what = request === null ? "起動" : `${{ command: "コマンド", import: "読み込み", export: "書き出し" }[request.kind]}「${request.title}」`;
  return `${what}が ${Math.round(timeoutMs / 1000)} 秒たっても終わりません。「停止」で止められます`;
}
