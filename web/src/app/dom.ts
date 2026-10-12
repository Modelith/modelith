// DOM の小さな補助。

/** セレクタに合う要素を返す。無ければ index.html との食い違いなので例外にする。 */
export function $<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`element not found: ${sel}`);
  return el;
}

/** HTML・SVG の属性と本文に埋め込む文字列をエスケープする。 */
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** イベントの発生元から、セレクタに合う最も近い祖先を探す。 */
export function closest<T extends Element = HTMLElement>(ev: Event, sel: string): T | null {
  const t = ev.target;
  return t instanceof Element ? t.closest<T>(sel) : null;
}

/** フォーム部品（入力中はショートカットを無視する）か。 */
export function isFormField(t: EventTarget | null): boolean {
  return t instanceof Element && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
}

/** localStorage は使えない環境（プライベートモードなど）があるため、失敗しても止めない。 */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 保存できなくても編集は続けられる */
    }
  },
};
