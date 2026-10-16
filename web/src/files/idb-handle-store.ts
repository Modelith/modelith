// フォルダのハンドルを IndexedDB に保存する（HandleStore のブラウザ実装）。
// ハンドルは構造化複製できるが localStorage には入らないため IndexedDB を使う。

import type { DirHandleLike, HandleStore } from "./local-folder";

const DB = "modelith";
const STORE = "handles";

/**
 * IndexedDB のデータベース（modelith）を開く。初めてならハンドルを入れる場所（handles）を作る。
 *
 * @returns 開いたデータベース。開けなければ（プライベートモードなど）Error で拒否する
 * @example
 * await openDb() // → IDBDatabase（name: "modelith"）
 * await openDb() // → Error で拒否（IndexedDB が使えないとき）
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB を開けません"));
  });
}

/**
 * ハンドルを入れる場所に対して、1 つの操作をトランザクションの中で行う。
 *
 * @param mode トランザクションの種類（"readonly" か "readwrite"）
 * @param op 入れる場所に対して依頼を作る関数（`(s) => s.get(key)` など）
 * @returns 依頼の結果。データベースを開けない・依頼が失敗したときは Error で拒否する
 * @example
 * await run("readonly", (s) => s.get("recent")) // → 覚えたハンドル（無ければ undefined）
 * await run("readonly", (s) => s.get("recent")) // → Error で拒否（IndexedDB が使えないとき）
 */
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
  /**
   * 覚えたフォルダのハンドルを引く。
   *
   * @param key 覚えたときのキー
   * @returns ハンドル。無いときや IndexedDB が使えないとき（プライベートモードなど）は undefined（例外は投げない）
   * @example
   * await idbHandleStore.get("recent") // → FileSystemDirectoryHandle（覚えているとき）
   * await idbHandleStore.get("nope")   // → undefined
   */
  async get(key) {
    try {
      return await run<DirHandleLike | undefined>("readonly", (s) => s.get(key));
    } catch {
      return undefined; // プライベートモードなどで使えなくても、前回のフォルダを覚えないだけ
    }
  },
  /**
   * フォルダのハンドルを覚える（同じキーがあれば置き換える）。IndexedDB が使えなければ何もしない（例外は投げない）。
   *
   * @param key キー
   * @param value 覚えるフォルダのハンドル
   */
  async set(key, value) {
    try {
      await run("readwrite", (s) => s.put(value, key));
    } catch {
      /* 同上 */
    }
  },
};
