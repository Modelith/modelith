// テスト用の偽の File System Access API（メモリ上のフォルダとファイル）。
import type { DirHandleLike, FileHandleLike, FileLike, FsApi, HandleStore, PermissionState, WritableStreamLike } from "./local-folder";

let clock = 1000;

export class FakeFile implements FileHandleLike {
  readonly kind = "file";
  lastModified = ++clock;

  /**
   * メモリ上のファイルを作る（更新時刻は作るたびに進む）。
   *
   * @param name ファイルの名前
   * @param content 内容（既定は空）
   */
  constructor(
    readonly name: string,
    public content = "",
  ) {}

  /**
   * 他のアプリが書き換えたことにする（内容を変え、更新時刻を進める）。
   *
   * @param text 新しい内容
   */
  externalWrite(text: string): void {
    this.content = text;
    this.lastModified = ++clock;
  }

  /**
   * 今の内容を、ブラウザの File の代わりとして返す。
   *
   * @returns 内容を読む関数・更新時刻・大きさ（UTF-8 のバイト数）
   * @example
   * await new FakeFile("a.sysml", "あ").getFile() // → { text: …, lastModified: 1001 など, size: 3 }
   * await new FakeFile("a.sysml").getFile()       // → { …, size: 0 }（空のファイル）
   */
  async getFile(): Promise<FileLike> {
    const { content, lastModified } = this;
    const bytes = new TextEncoder().encode(content);
    return { text: async () => content, arrayBuffer: async () => bytes.slice().buffer, lastModified, size: bytes.length };
  }

  /**
   * 書き込みの流れを作る。write でためた内容は、close したときに内容になり、更新時刻が進む。
   *
   * @returns write・close を持つ書き込みの流れ
   * @example
   * const w = await f.createWritable(); await w.write("x"); await w.close(); f.content // → "x"
   * // close しなければ f.content は変わらない
   */
  async createWritable(): Promise<WritableStreamLike> {
    let buf = "";
    return {
      write: async (d: string | ArrayBuffer) => {
        buf += typeof d === "string" ? d : new TextDecoder().decode(d);
      },
      close: async () => {
        this.content = buf;
        this.lastModified = ++clock;
      },
    };
  }
}

export class FakeDir implements DirHandleLike {
  readonly kind = "directory";
  readonly entries = new Map<string, FakeFile | FakeDir>();
  permission: PermissionState = "granted";
  /** requestPermission で返す状態。 */
  grantOnRequest: PermissionState = "granted";
  /** 他のアプリで消されたことにする（true なら中身を読むと NotFoundError）。 */
  removed = false;

  /**
   * メモリ上の空のフォルダを作る（許可は "granted"）。
   *
   * @param name フォルダの名前
   */
  constructor(readonly name: string) {}

  /**
   * パス（a/b/c.sysml）でファイルを作る。途中のフォルダが無ければ作り、同じ名前のファイルがあれば置き換える。
   *
   * @param path このフォルダからの相対パス（`/` 区切り）
   * @param text ファイルの内容
   * @returns 作ったファイル
   * @example
   * root.put("a/b.sysml", "package B;") // → FakeFile { name: "b.sysml", content: "package B;" }（フォルダ a も作る）
   * root.put("m.sysml", "")             // → FakeFile { name: "m.sysml", content: "" }（このフォルダの直下）
   */
  put(path: string, text: string): FakeFile {
    const segs = path.split("/");
    const name = segs.pop() as string;
    let d: FakeDir = this;
    for (const s of segs) {
      const next = d.entries.get(s);
      if (next instanceof FakeDir) d = next;
      else {
        const nd = new FakeDir(s);
        d.entries.set(s, nd);
        d = nd;
      }
    }
    const f = new FakeFile(name, text);
    d.entries.set(name, f);
    return f;
  }

  /**
   * 直下のファイルとフォルダを、作った順に返す。
   *
   * @returns 直下の項目を順に返す非同期の反復。空のフォルダなら何も返さない。消されたフォルダ（removed）なら NotFoundError を投げる
   * @example
   * for await (const e of root.values()) names.push(e.name) // names → ["m.sysml", "a"]（m.sysml、a/b.sysml の順に put したとき）
   */
  async *values(): AsyncIterable<FakeFile | FakeDir> {
    if (this.removed) throw new DOMException(`${this.name} is gone`, "NotFoundError");
    yield* this.entries.values();
  }

  /**
   * 直下のファイルを名前で引く。
   *
   * @param name ファイルの名前
   * @param opts `create: true` なら、無いときに空のファイルを作る
   * @returns ファイル。無くて create でなければ NotFoundError の DOMException を投げる
   * @example
   * await root.getFileHandle("m.sysml")                   // → FakeFile（あるとき）
   * await root.getFileHandle("new.sysml", { create: true }) // → 空の FakeFile を作って返す
   * await root.getFileHandle("nope.sysml")                // → NotFoundError を投げる
   */
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    const e = this.entries.get(name);
    if (e instanceof FakeFile) return e;
    if (!opts?.create) throw new DOMException("not found", "NotFoundError");
    const f = new FakeFile(name);
    this.entries.set(name, f);
    return f;
  }

  /**
   * 直下のフォルダを名前で引く。
   *
   * @param name フォルダの名前
   * @param opts `create: true` なら、無いときに空のフォルダを作る
   * @returns フォルダ。無くて create でなければ NotFoundError の DOMException を投げる
   * @example
   * await root.getDirectoryHandle("a")                   // → FakeDir（あるとき）
   * await root.getDirectoryHandle("new", { create: true }) // → 空の FakeDir を作って返す
   * await root.getDirectoryHandle("nope")                // → NotFoundError を投げる
   */
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    const e = this.entries.get(name);
    if (e instanceof FakeDir) return e;
    if (!opts?.create) throw new DOMException("not found", "NotFoundError");
    const d = new FakeDir(name);
    this.entries.set(name, d);
    return d;
  }

  /**
   * 直下のファイルかフォルダを消す。
   *
   * @param name 消す項目の名前
   * @param opts `recursive: true` なら、中身のあるフォルダも消す
   * @example
   * await root.removeEntry("a.sysml")                  // → a.sysml が無くなる
   * await root.removeEntry("a", { recursive: true })    // → フォルダ a を中身ごと消す
   * await root.removeEntry("a")                        // → 中身があれば InvalidModificationError、無ければ NotFoundError を投げる
   */
  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const e = this.entries.get(name);
    if (!e) throw new DOMException("not found", "NotFoundError");
    if (e instanceof FakeDir && e.entries.size && !opts?.recursive) throw new DOMException("not empty", "InvalidModificationError");
    this.entries.delete(name);
  }

  /**
   * ファイルがこのフォルダの中のどこにあるかを、入れ子をたどって探す。
   *
   * @param h 探すファイル（同じオブジェクトかで比べる）
   * @returns このフォルダからのパスの区切りの列。中に無ければ null
   * @example
   * await root.resolve(root.put("a/b.sysml", "")) // → ["a", "b.sysml"]
   * await root.resolve(new FakeFile("x.sysml"))  // → null（中に無い）
   */
  async resolve(h: FileHandleLike): Promise<string[] | null> {
    for (const [name, e] of this.entries) {
      if (e === h) return [name];
      if (e instanceof FakeDir) {
        const sub = await e.resolve(h);
        if (sub) return [name, ...sub];
      }
    }
    return null;
  }

  /**
   * 今の許可の状態を返す（`permission` の値）。
   *
   * @returns 許可の状態
   * @example
   * await dir.queryPermission() // → "granted"（既定）
   * // dir.permission = "prompt" の後なら → "prompt"
   */
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }

  /**
   * 許可を求めたことにし、`permission` を `grantOnRequest` の値にする。
   *
   * @returns 求めた後の許可の状態
   * @example
   * await dir.requestPermission() // → "granted"（既定）
   * // dir.grantOnRequest = "denied" の後なら → "denied"
   */
  async requestPermission(): Promise<PermissionState> {
    this.permission = this.grantOnRequest;
    return this.permission;
  }
}

/**
 * 利用者がピッカーをキャンセルしたときと同じ例外を作る。
 *
 * @returns 名前が "AbortError" の DOMException
 * @example
 * abort().name // → "AbortError"
 */
const abort = (): DOMException => new DOMException("cancelled", "AbortError");

/** ピッカーが返すものを決められる偽の API。null は利用者がキャンセルしたことを表す。 */
export class FakeFsApi implements FsApi {
  folder: FakeDir | null = null;
  openFile: FakeFile | null = null;
  /** 最後にフォルダを選び始めた場所。 */
  startIn: FileHandleLike | undefined;
  /** 最後にフォルダを選んだときの読み書きの別。 */
  mode: "read" | "readwrite" | undefined;

  /**
   * フォルダのピッカーを開いたことにする。選び始めた場所を `startIn` に、読み書きの別を `mode` に覚える。
   *
   * @param opts `startIn` は選び始める場所（そのファイルのある場所）、`mode` は読むだけか読み書きか
   * @returns `folder` に決めたフォルダ。`folder` が null ならキャンセルとして AbortError を投げる
   * @example
   * await api.showDirectoryPicker({}) // → api.folder
   * await api.showDirectoryPicker({}) // → AbortError を投げる（api.folder が null のとき）
   */
  async showDirectoryPicker(opts: { startIn?: FileHandleLike; mode?: "read" | "readwrite" }): Promise<FakeDir> {
    this.startIn = opts.startIn;
    this.mode = opts.mode;
    if (!this.folder) throw abort();
    return this.folder;
  }

  /**
   * ファイルのピッカーを開いたことにする。
   *
   * @returns `openFile` に決めたファイル 1 つの配列。`openFile` が null ならキャンセルとして AbortError を投げる
   * @example
   * await api.showOpenFilePicker() // → [api.openFile]
   * await api.showOpenFilePicker() // → AbortError を投げる（api.openFile が null のとき）
   */
  async showOpenFilePicker(): Promise<FakeFile[]> {
    if (!this.openFile) throw abort();
    return [this.openFile];
  }
}

export class MemoryHandleStore implements HandleStore {
  readonly map = new Map<string, unknown>();

  /**
   * 覚えた値を引く。
   *
   * @param key 覚えたときのキー
   * @returns 覚えた値。無ければ undefined
   * @example
   * await store.get("recent-folder") // → FakeDir（set("recent-folder", dir) の後）
   * await store.get("nope")          // → undefined
   */
  async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }

  /**
   * 値を覚える（同じキーがあれば置き換える）。
   *
   * @param key キー
   * @param value 覚える値
   */
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
}
