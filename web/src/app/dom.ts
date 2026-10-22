// DOM の小さな補助。

import { channelName } from "../channel";

/**
 * セレクタに合う最初の要素を返す。無ければ index.html との食い違いなので例外にする。
 *
 * @param sel CSS セレクタ（"#ed" など）
 * @returns 合った要素。見つからなければ Error を投げる
 * @example
 * $("#ed")      // → <textarea id="ed">（index.html にある）
 * $("#nothing") // → Error("element not found: #nothing") を投げる
 */
export function $<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`element not found: ${sel}`);
  return el;
}

/**
 * HTML・SVG の属性と本文に埋め込む文字列をエスケープする（& < > " の 4 文字）。文字列でない値は文字列にする。
 *
 * @param s 埋め込む値
 * @returns エスケープした文字列
 * @example
 * esc('<a href="x">&</a>') // → "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;"
 * esc(42)                  // → "42"
 * esc("'")                 // → "'"（単引用符はそのまま）
 */
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * イベントの発生元から、セレクタに合う最も近い祖先（自身を含む）を探す。
 *
 * @param ev イベント
 * @param sel CSS セレクタ
 * @returns 見つかった要素。発生元が要素でないか、合う祖先が無ければ null
 * @example
 * // <button data-pos="3"><span>…</span></button> の span をクリックした
 * closest(ev, "button")   // → その button
 * closest(ev, "textarea") // → null（合う祖先が無い）
 */
export function closest<T extends Element = HTMLElement>(ev: Event, sel: string): T | null {
  const t = ev.target;
  return t instanceof Element ? t.closest<T>(sel) : null;
}

/**
 * フォーム部品（入力欄・テキストエリア・選択欄）か。入力中はキーボードのショートカットを無視するために使う。
 *
 * @param t イベントの発生元
 * @returns INPUT・TEXTAREA・SELECT の要素なら true
 * @example
 * isFormField(document.querySelector("#ed")) // → true（textarea）
 * isFormField(document.body)                 // → false
 * isFormField(null)                          // → false（境界）
 */
export function isFormField(t: EventTarget | null): boolean {
  return t instanceof Element && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
}

/**
 * localStorage は使えない環境（プライベートモードなど）や、保存領域がいっぱいのとき（QuotaExceededError）があるため、失敗しても止めない。
 * 書けたかは戻り値で返すので、下書きのように失われては困るものを書く側は、それを見て知らせる（F-FILE-11）。
 * キーは公開の系列ごとに分ける（プレリリース版は `キー@preview`。ADR-0020）。
 */
export const store = {
  /**
   * localStorage から値を読む。使えない環境では null を返す。
   *
   * @param key 保存のキー
   * @returns 保存した値。無いか読めなければ null
   * @example
   * store.get("modelith.ui") // → '{"tab":…}'（保存済み）
   * store.get("missing")     // → null
   */
  get(key: string): string | null {
    try {
      return localStorage.getItem(channelName(key));
    } catch {
      return null;
    }
  },
  /**
   * localStorage に値を書く。保存できない環境・保存領域がいっぱいのときも例外を出さず、書けなかったことを返す。
   *
   * @param key 保存のキー
   * @param value 保存する文字列
   * @returns 書けたら true。保存領域がいっぱい（QuotaExceededError）・localStorage が使えない環境なら false
   * @example
   * store.set("modelith-ui-v1", '{"tree":true}') // → true
   * store.set("modelith-drafts-v1", huge)         // → false（保存領域がいっぱい）
   */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(channelName(key), value);
      return true;
    } catch {
      return false; // 保存できなくても編集は続けられる。知らせるかは呼ぶ側が決める
    }
  },
  /**
   * localStorage の値を消す。無いキーでも何もしない。
   *
   * @param key 消すキー
   * @returns 消せたら（無いキーを含む）true。localStorage が使えない環境なら false
   * @example
   * store.remove("modelith-tabs-v1") // → true（以後 store.get は null）
   * store.remove("missing")          // → true（もともと無い）
   */
  remove(key: string): boolean {
    try {
      localStorage.removeItem(channelName(key));
      return true;
    } catch {
      return false;
    }
  },
};
