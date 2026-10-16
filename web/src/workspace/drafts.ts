// 無題の文書の下書きを、キーと値の保存先（ブラウザでは localStorage）に置く（F-FILE-11）。

import type { Draft, DraftStore } from "./workspace";

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const KEY = "modelith-drafts-v1";

/**
 * 保存先から読んだ値が下書きの形か（name と text が文字列か）。
 *
 * @param v JSON から読んだ値
 * @returns 下書きの形なら true（型を Draft に絞る）
 * @example
 * isDraft({ name: "無題.sysml", text: "package P;" }) // → true
 * isDraft({ name: "x" })                              // → false（text が無い）
 * isDraft(null)                                       // → false
 */
const isDraft = (v: unknown): v is Draft =>
  !!v && typeof v === "object" && typeof (v as Draft).name === "string" && typeof (v as Draft).text === "string";

/**
 * キーと値の保存先（ブラウザでは localStorage）に下書きを置く DraftStore を作る（F-FILE-11）。
 * 下書きはまとめて 1 つのキー（modelith-drafts-v1）に JSON で置く。
 *
 * @param kv キーと値の保存先
 * @returns 下書きの読み書き
 * @example
 * kvDraftStore(kv).load()                          // → []（まだ何も置いていない）
 * kvDraftStore({ get: () => "{not json", set }).load() // → []（壊れた下書きは読まない）
 */
export function kvDraftStore(kv: KeyValue): DraftStore {
  return {
    /**
     * 置いてある下書きを読む。
     *
     * @returns 下書きの一覧。無い・JSON が壊れている・配列でないときは空。下書きの形でない項目は除く
     * @example
     * load() // → [{ name: "無題.sysml", text: "package P;" }]
     * load() // → []（JSON が壊れている）
     */
    load() {
      try {
        const v: unknown = JSON.parse(kv.get(KEY) ?? "[]");
        return Array.isArray(v) ? v.filter(isDraft) : [];
      } catch {
        return []; // 壊れた下書きは読まない
      }
    },
    /**
     * 下書きの一覧をまとめて置き換える。
     *
     * @param drafts 置く下書きの一覧（空なら空の一覧を置く）
     */
    save(drafts) {
      kv.set(KEY, JSON.stringify(drafts));
    },
  };
}
