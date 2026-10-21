// 予期しない例外の受け口（Q-6）。捕まえていない例外と、結果を待たない処理（Promise）の失敗を、例外 1 つにつき 1 回知らせ、
// 詳しい内容はコンソールに残す。テキストは画面に残っているので、「失われていない」ことも伝える。

/** 予期しない例外を知らせる文。 */
export const UNEXPECTED_MESSAGE = "予期しない問題が起きました。テキストはそのまま残っています";

/** 例外の出どころ（ブラウザでは window）。error は捕まえていない例外、unhandledrejection は結果を待たない処理の失敗。 */
export interface ErrorSource {
  addEventListener(type: "error", listener: (ev: { error?: unknown; message?: string }) => void): void;
  addEventListener(type: "unhandledrejection", listener: (ev: { reason?: unknown }) => void): void;
}

/**
 * 捕まえていない例外と、結果を待たない処理の失敗の受け口を、それぞれ 1 つだけ登録する。
 * どちらも、例外 1 つにつき、詳しい内容を log に渡してから、notify で UNEXPECTED_MESSAGE を 1 回知らせる。
 *
 * @param source 例外の出どころ（ブラウザでは window）
 * @param notify 利用者に知らせる関数（トースト）
 * @param log 詳しい内容（例外そのもの）を残す関数（console.error）
 */
export function installUnexpectedErrorHandlers(source: ErrorSource, notify: (message: string) => void, log: (detail: unknown) => void): void {
  source.addEventListener("error", (ev) => report(ev.error ?? ev.message, notify, log));
  source.addEventListener("unhandledrejection", (ev) => report(ev.reason, notify, log));
}

/**
 * 1 つの予期しない例外を、詳しい内容を残してから知らせる。
 *
 * @param detail 例外そのもの（無ければメッセージの文字列）
 * @param notify 利用者に知らせる関数
 * @param log 詳しい内容を残す関数
 */
function report(detail: unknown, notify: (message: string) => void, log: (detail: unknown) => void): void {
  log(detail);
  notify(UNEXPECTED_MESSAGE);
}
