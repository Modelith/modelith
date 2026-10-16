// DOM の小さな補助。

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

/** localStorage は使えない環境（プライベートモードなど）があるため、失敗しても止めない。 */
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
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /**
   * localStorage に値を書く。保存できない環境でも例外を出さずに何もしない。
   *
   * @param key 保存のキー
   * @param value 保存する文字列
   */
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 保存できなくても編集は続けられる */
    }
  },
};
