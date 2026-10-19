// v1 のプラグインを、サンドボックス化した iframe の中の Worker で動かす（ADR-0018 §3.1）。ここは DOM とメッセージの出入りだけを行う。
// iframe は同じ場所に置いた静的なページ（web/public/plugin-sandbox*.html）を sandbox="allow-scripts" で読み込む（独自のオリジンを持たない）。
// ホストが MessageChannel を作り、一方の口を iframe に渡し、iframe がそれを Worker に渡す。以後のやり取りはこの口だけを使う。

import type { HostMessage } from "./generated/protocol";

/** 隔離用のページとプラグインからの知らせを受け取る処理。 */
export interface SandboxListener {
  /** プラグインから届いたデータ（まだ確かめていない値）。 */
  message(data: unknown): void;
  /** 隔離用のページが Worker を作れなかった・Worker の中でエラーが起きた。 */
  error(message: string): void;
}

/** 動かしているプラグイン 1 つへの口。 */
export interface Sandbox {
  /** プラグインにメッセージを送る。 */
  post(message: HostMessage): void;
  /** iframe を取り除いて止める（Chromium では Worker が 2 秒ほど動き続けることがある）。以後の知らせは届かない。 */
  stop(): void;
}

/** 隔離用のページとの取り決め（ページの中の文字列と同じ）。 */
const READY = "modelith:sandbox-ready";
const ERROR = "modelith:sandbox-error";
const START = "modelith:start";

/**
 * プラグインのコードを、隔離用のページの中の Worker で動かし始める。iframe は画面に出さずに body の最後に置く。
 *
 * @param pageUrl 隔離用のページの URL（外部と通信できるかで 2 つから選ぶ）
 * @param code プラグインのプログラム（1 つのファイルにまとめた、従来型のスクリプト）
 * @param listener プラグインからの知らせを受け取る処理
 * @returns プラグインへの口
 * @example
 * const box = startSandbox("/plugin-sandbox.html", "self.addEventListener('message', …)", { message: console.log, error: console.error });
 * box.post({ type: "activate", apiVersion: "0", pluginId: "jp.example.fill" });
 * box.stop();
 */
export function startSandbox(pageUrl: string, code: string, listener: SandboxListener): Sandbox {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.className = "plugin-sandbox";
  frame.title = "プラグイン";
  frame.hidden = true;
  frame.src = pageUrl;
  const channel = new MessageChannel();
  let stopped = false;
  channel.port1.onmessage = (ev: MessageEvent<unknown>) => {
    if (!stopped) listener.message(ev.data);
  };
  // 独自のオリジンを持たないので、origin では区別できない。送り元がこの iframe のウィンドウであるものだけを受け取る
  let portSent = false;
  const onWindowMessage = (ev: MessageEvent<unknown>): void => {
    const target = frame.contentWindow;
    if (stopped || !target || ev.source !== target) return;
    const data = ev.data as { type?: unknown; message?: unknown } | null;
    if (data?.type === READY && !portSent) {
      portSent = true;
      target.postMessage({ type: START, code }, "*", [channel.port2]);
    } else if (data?.type === ERROR) listener.error(String(data.message ?? ""));
  };
  window.addEventListener("message", onWindowMessage);
  document.body.append(frame);
  return {
    post: (message) => {
      if (!stopped) channel.port1.postMessage(message);
    },
    stop: () => {
      stopped = true;
      window.removeEventListener("message", onWindowMessage);
      channel.port1.close();
      frame.remove();
    },
  };
}
