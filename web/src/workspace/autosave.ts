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

  /**
   * 自動保存を作る（notify が呼ばれるまで何もしない）。
   *
   * @param ws 保存する文書を持つワークスペース
   * @param timer タイマー（テストでは差し替える）
   * @param isEnabled 自動保存が有効かを答える関数（保存を予約するときに聞く）
   * @param onSaved 保存の結果（競合など）を利用者に知らせる
   * @param delay 編集が止まってから保存するまでの時間（ミリ秒。既定は 1000）
   */
  constructor(
    private readonly ws: Workspace,
    private readonly timer: Timer,
    private readonly isEnabled: () => boolean,
    /** 保存の結果（競合など）を利用者に知らせる。 */
    private readonly onSaved: (key: string, outcome: SaveOutcome) => void,
    private readonly delay = 1000,
  ) {}

  /**
   * 文書が編集されたときに呼ぶ。編集が止まってから delay ミリ秒後に、未保存なら上書き保存し、結果を onSaved で知らせる。
   * 続けて呼ぶと待ち時間をやり直す。自動保存が切ってある・上書きできる保存先が無い・外で変更された文書は何もしない。
   *
   * @param key 文書のキー（Workspace の文書の key）
   */
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
