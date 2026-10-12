// 自動保存（F-FILE-6）。編集が止まってから delay ミリ秒後に保存する。
// 上書きできる保存先がある文書だけを対象にし、保存先を選ばせる操作（ダイアログ・ダウンロード）は勝手に始めない。

import type { SaveAsTarget } from "../files/types";
import type { SaveOutcome, Workspace } from "./workspace";

/** タイマー（テストでは差し替える）。 */
export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const browserTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class AutoSaver {
  private readonly pending = new Map<string, unknown>();

  constructor(
    private readonly ws: Workspace,
    private readonly timer: Timer,
    private readonly isEnabled: () => boolean,
    /** 保存の結果（競合など）を利用者に知らせる。 */
    private readonly onSaved: (key: string, outcome: SaveOutcome) => void,
    private readonly delay = 1000,
  ) {}

  /** 文書が編集されたときに呼ぶ。 */
  notify(key: string): void {
    const doc = this.ws.get(key);
    if (!doc || !this.isEnabled() || !this.ws.canWriteInPlace(doc) || doc.stale) return;
    this.timer.clear(this.pending.get(key));
    this.pending.set(
      key,
      this.timer.set(() => {
        this.pending.delete(key);
        const d = this.ws.get(key);
        if (!d || !this.ws.isDirty(d)) return;
        void this.ws.save(key, NO_SAVE_AS).then((o) => this.onSaved(key, o));
      }, this.delay),
    );
  }
}

/** 自動保存では保存先を選ばせない（canWriteInPlace の文書だけが対象なので呼ばれない）。 */
const NO_SAVE_AS: SaveAsTarget = { id: "none", label: "", saveAs: async () => null };
