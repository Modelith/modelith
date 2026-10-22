// 「このブラウザ」に追加したプラグインと、プラグイン用の保存場所（storage）を、ブラウザの IndexedDB に置く（ADR-0018 §1・§3）。
// IndexedDB を選んだのは、フォルダを開けないブラウザ（Firefox・Safari）を含むすべての対象のブラウザで、画面のスレッドから
// 読み書きでき、1 回の操作をトランザクションで行えるため（OPFS は、ブラウザによって画面のスレッドから書けない）。
// ここは読み書きだけを行い、判断（上限・優先・行の作り方）は storage.ts と app/plugins.ts の純粋関数に任せる。

import type { PluginInfo } from "../core";

/** このブラウザに追加したプラグイン 1 つ。 */
export interface BrowserPlugin {
  id: string;
  enabled: boolean;
  /** 追加したときにマニフェストから読んだ情報（同じ ID のプロジェクトのプラグインが優先されるときにも、一覧に名前を出すため）。 */
  info: PluginInfo;
  /** プラグインのフォルダからの相対パス（`/` 区切り）→ テキスト。 */
  files: Record<string, string>;
}

/** このブラウザに追加したプラグインの置き場所。 */
export interface BrowserPluginStore {
  /** 追加したプラグインを ID の順に返す。使えない（プライベートモードなど）ときは Error で拒否する。 */
  list(): Promise<BrowserPlugin[]>;
  /** 追加する（同じ ID があれば置き換える）。 */
  put(plugin: BrowserPlugin): Promise<void>;
  /** 削除する（無ければ何もしない）。 */
  remove(id: string): Promise<void>;
}

/** プラグイン用の保存場所（プラグインごとに、キー → 値の JSON のテキストを 1 つ持つ）。 */
export interface PluginDataStore {
  /** 保存してある JSON のテキスト。無ければ null。 */
  read(id: string): Promise<string | null>;
  /** JSON のテキストを保存する。null なら消す。 */
  write(id: string, json: string | null): Promise<void>;
}

const DB = "modelith-plugins";
const INSTALLED = "installed";
const DATA = "data";

/**
 * IndexedDB のデータベース（modelith-plugins）を開く。初めてなら、追加したプラグイン（installed）と保存場所（data）の入れ物を作る。
 *
 * @returns 開いたデータベース。開けなければ（プライベートモード・使えないブラウザ）Error で拒否する
 * @example
 * await openDb() // → IDBDatabase（name: "modelith-plugins"）
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      req.result.createObjectStore(INSTALLED, { keyPath: "id" });
      req.result.createObjectStore(DATA, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("このブラウザの保存場所（IndexedDB）を開けません"));
  });
}

/**
 * 入れ物 1 つに対して、1 つの操作をトランザクションの中で行い、書き込みなら確定するまで待つ。
 *
 * @param store 入れ物の名前（installed か data）
 * @param mode トランザクションの種類
 * @param op 入れ物に対して依頼を作る関数
 * @returns 依頼の結果。開けない・失敗したときは Error で拒否する
 * @example
 * await run("installed", "readonly", (s) => s.getAll()) // → [{ id: "jp.x", … }]
 */
async function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = op(tx.objectStore(store));
      let result: T;
      req.onsuccess = () => {
        result = req.result as T;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error("このブラウザの保存場所（IndexedDB）の操作に失敗しました"));
      tx.onabort = () => reject(tx.error ?? new Error("このブラウザの保存場所（IndexedDB）の操作が中止されました"));
    });
  } finally {
    db.close();
  }
}

/** このブラウザに追加したプラグインの置き場所（IndexedDB）。 */
export const idbBrowserPlugins: BrowserPluginStore = {
  /**
   * 追加したプラグインを返す。
   *
   * @returns プラグイン（ID の順）。使えなければ Error で拒否する
   * @example
   * await idbBrowserPlugins.list() // → [{ id: "jp.example.review", enabled: true, info: {…}, files: {…} }]
   */
  list: () => run<BrowserPlugin[]>(INSTALLED, "readonly", (s) => s.getAll()),
  /**
   * 追加する（同じ ID があれば置き換える）。
   *
   * @param plugin プラグイン
   * @returns 書き終えたら解決する Promise。書けなければ Error で拒否する
   */
  put: (plugin) => run<void>(INSTALLED, "readwrite", (s) => s.put(plugin)),
  /**
   * 削除する。
   *
   * @param id プラグインの ID
   * @returns 消し終えたら解決する Promise。使えなければ Error で拒否する
   */
  remove: (id) => run<void>(INSTALLED, "readwrite", (s) => s.delete(id)),
};

/** プラグイン用の保存場所（IndexedDB）。 */
export const idbPluginData: PluginDataStore = {
  /**
   * 保存してある JSON のテキストを読む。
   *
   * @param id プラグインの ID
   * @returns JSON のテキスト。無ければ null。使えなければ Error で拒否する
   * @example
   * await idbPluginData.read("jp.example.review") // → '{"count":3}'
   * await idbPluginData.read("jp.none")           // → null
   */
  read: async (id) => (await run<{ id: string; json: string } | undefined>(DATA, "readonly", (s) => s.get(id)))?.json ?? null,
  /**
   * JSON のテキストを保存する。null なら消す。
   *
   * @param id プラグインの ID
   * @param json 保存する JSON のテキスト（null なら消す）
   * @returns 書き終えたら解決する Promise。書けなければ Error で拒否する
   */
  write: (id, json) => run<void>(DATA, "readwrite", (s) => (json === null ? s.delete(id) : s.put({ id, json }))),
};
