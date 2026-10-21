// 起動中の表示（Q-5）。コアの準備ができるまで「読み込み中…」を示し、時間がかかれば案内に切り替える。
// 表示そのもの（#loading）は index.html にあり、スクリプトが動く前から見える。ここでは切り替えと消すことだけを行う。

/** 起動中の表示の文。index.html の #loading と同じ。 */
export const LOADING_TEXT = "読み込み中…";

/** 読み込みに時間がかかっているときの案内。 */
export const SLOW_LOADING_TEXT = "読み込みに時間がかかっています。通信が遅いか、ブラウザが古い可能性があります。ページを再読み込みしてください";

/** 起動中の表示を案内に切り替えるまでの時間（ミリ秒）。 */
export const SLOW_LOADING_MS = 15_000;

/** 起動中の表示。文を書き換える・画面から取り除く。 */
export interface LoadingView {
  /** 表示の文を text にする */
  show(text: string): void;
  /** 表示を画面から取り除く */
  remove(): void;
}

/**
 * 起動中の表示を見張る。slowMs たっても終わらなければ案内に切り替え、返した関数を呼んだら表示を取り除く。
 * 案内に切り替えた後も待ち続け、終わったら（返した関数を呼んだら）案内も取り除く。
 *
 * @param view 起動中の表示（すでに LOADING_TEXT を示しているもの）
 * @param slowMs 案内に切り替えるまでの時間（ミリ秒。既定は SLOW_LOADING_MS）
 * @returns 準備ができた・起動に失敗したときに呼ぶ関数。表示を取り除き、まだ切り替えていなければ切り替えない。2 回目以降は何もしない
 * @example
 * const done = watchLoading(view) // 15 秒たつと view.show(SLOW_LOADING_TEXT)
 * done()                          // → view.remove()（15 秒より前なら、案内には切り替えない）
 */
export function watchLoading(view: LoadingView, slowMs: number = SLOW_LOADING_MS): () => void {
  let finished = false;
  const timer = setTimeout(() => view.show(SLOW_LOADING_TEXT), slowMs);
  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    view.remove();
  };
}

/**
 * 画面の要素を起動中の表示として使う。要素が無ければ（何も示していなければ）何もしない表示を返す。
 *
 * @param el 起動中の表示の要素（index.html の #loading）。無ければ null
 * @returns 要素の文を書き換え、DOM から取り除く表示
 * @example
 * loadingView(document.querySelector("#loading")).remove() // → #loading が DOM から無くなる
 * loadingView(null).show("x")                              // → 何もしない
 */
export function loadingView(el: HTMLElement | null): LoadingView {
  return {
    show: (text) => {
      if (el) el.textContent = text;
    },
    remove: () => el?.remove(),
  };
}
