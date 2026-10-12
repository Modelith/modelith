// 無題の文書の下書きを、キーと値の保存先（ブラウザでは localStorage）に置く（F-FILE-11）。

import type { Draft, DraftStore } from "./workspace";

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const KEY = "modelith-drafts-v1";

const isDraft = (v: unknown): v is Draft =>
  !!v && typeof v === "object" && typeof (v as Draft).name === "string" && typeof (v as Draft).text === "string";

export function kvDraftStore(kv: KeyValue): DraftStore {
  return {
    load() {
      try {
        const v: unknown = JSON.parse(kv.get(KEY) ?? "[]");
        return Array.isArray(v) ? v.filter(isDraft) : [];
      } catch {
        return []; // 壊れた下書きは読まない
      }
    },
    save(drafts) {
      kv.set(KEY, JSON.stringify(drafts));
    },
  };
}
