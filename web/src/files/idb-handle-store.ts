// フォルダのハンドルを IndexedDB に保存する（HandleStore のブラウザ実装）。
// ハンドルは構造化複製できるが localStorage には入らないため IndexedDB を使う。

import type { DirHandleLike, HandleStore } from "./local-folder";

const DB = "modelith";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB を開けません"));
  });
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB の操作に失敗しました"));
      }),
  );
}

export const idbHandleStore: HandleStore = {
  async get(key) {
    try {
      return await run<DirHandleLike | undefined>("readonly", (s) => s.get(key));
    } catch {
      return undefined; // プライベートモードなどで使えなくても、前回のフォルダを覚えないだけ
    }
  },
  async set(key, value) {
    try {
      await run("readwrite", (s) => s.put(value, key));
    } catch {
      /* 同上 */
    }
  },
};
