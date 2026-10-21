// 起動に失敗したときの案内（Q-5・Q-6）。白い画面のままにせず、画面の真ん中に理由と対処を出す。
// 文は純粋な関数で作り（テストする）、画面に足すのは showStartupBox だけ。

import { failureReason } from "../workspace/autosave";
import { esc } from "./dom";

/** 起動の途中で失敗したときに示す操作の文言。 */
export const RESET_LABEL = "保存した設定を初期化して読み直す";

/**
 * 起動に必要な部品（wasm）を読み込めなかったときの案内の HTML（通信の失敗や、WebAssembly を使えない古いブラウザ）。
 *
 * @param e 起動のときに投げられた値（Error ならそのメッセージを詳しい内容として出す）
 * @returns 案内の HTML（見出し・対処・詳しい内容）
 * @example
 * startupErrorHtml(new Error("fetch failed")) // → "<b>Modelith を起動できませんでした</b><p>テキストの解析に…</p><small>fetch failed</small>"
 */
export function startupErrorHtml(e: unknown): string {
  return (
    "<b>Modelith を起動できませんでした</b>" +
    "<p>テキストの解析に必要なモジュール（WebAssembly）を読み込めませんでした。ページを再読み込みしてください。" +
    "解決しないときは、新しいブラウザ（Chrome・Edge・Firefox・Safari の最新版）で開いてください。</p>" +
    `<small>${esc(failureReason(e))}</small>`
  );
}

/**
 * 画面を組み立てる途中で失敗したときの案内の HTML。保存した設定（パネルの配置・図のタブ）を初期化して読み直す操作を示し、
 * 下書き・前回の続き・プラグインの許可は消えないと伝える（Q-6）。
 *
 * @param e 組み立てのときに投げられた値（Error ならそのメッセージを詳しい内容として出す）
 * @returns 案内の HTML（見出し・対処・ボタン #btnResetSettings・詳しい内容）
 * @example
 * recoveryHtml(new TypeError("x is not a function")) // → "<b>Modelith を起動できませんでした</b>…<button id=\"btnResetSettings\" …>保存した設定を初期化して読み直す</button>…<small>x is not a function</small>"
 * recoveryHtml("<b>")                                // → …<small>&lt;b&gt;</small>（詳しい内容はエスケープする）
 */
export function recoveryHtml(e: unknown): string {
  return (
    "<b>Modelith を起動できませんでした</b>" +
    "<p>画面を組み立てる途中で問題が起きました。保存した設定（パネルの配置・図のタブ）が壊れている可能性があります。" +
    "設定を初期化して読み直すと、直ることがあります。下書き・前回の続き・プラグインの許可は消えません。</p>" +
    `<p><button id="btnResetSettings" type="button">${RESET_LABEL}</button></p>` +
    `<small>${esc(failureReason(e))}</small>`
  );
}

/**
 * 起動の失敗の案内を、画面の真ん中（body の最後、#startupError）に足す。
 *
 * @param html 案内の HTML（startupErrorHtml・recoveryHtml が作る）
 * @returns 足した要素（ボタンに操作をつなぐため）
 * @example
 * showStartupBox(recoveryHtml(e)).querySelector("#btnResetSettings") // → <button>
 */
export function showStartupBox(html: string): HTMLElement {
  const box = document.createElement("div");
  box.id = "startupError";
  box.setAttribute("role", "alert");
  box.innerHTML = html;
  document.body.append(box);
  return box;
}
