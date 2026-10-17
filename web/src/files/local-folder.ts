// ローカルのフォルダとファイルを File System Access API で扱うプロバイダ（ADR-0010、F-FILE-1・2・3・9）。
// ブラウザの API は FsApi として外から渡し、単体テストでは偽のハンドルに差し替える。

import {
  ConflictError,
  isModelFile,
  type DirEntry,
  type FileContent,
  type FileLocator,
  type FilePicker,
  type FileRef,
  type FolderFiles,
  type FolderRef,
  type FolderSource,
  type Readable,
  type RecentFolders,
  type SiblingFiles,
  type Writable,
} from "./types";

/* ---- 使う API の範囲だけを型にする（lib.dom に無い部分を含むため） ---- */
export interface FileLike {
  text(): Promise<string>;
  readonly lastModified: number;
  readonly size: number;
}
export interface WritableStreamLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
export type PermissionState = "granted" | "denied" | "prompt";
interface HandleBase {
  readonly name: string;
  queryPermission?(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "readwrite" }): Promise<PermissionState>;
}
export interface FileHandleLike extends HandleBase {
  readonly kind: "file";
  getFile(): Promise<FileLike>;
  createWritable(): Promise<WritableStreamLike>;
}
export interface DirHandleLike extends HandleBase {
  readonly kind: "directory";
  values(): AsyncIterable<FileHandleLike | DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  /** h がこのフォルダの中にあれば、フォルダからのパスの各部分（無ければ null）。 */
  resolve(h: FileHandleLike): Promise<string[] | null>;
}
const PICKER_TYPES = [{ description: "SysML v2 / KerML", accept: { "text/plain": [".sysml", ".kerml"] } }];
export interface FsApi {
  showDirectoryPicker(opts: { mode: "readwrite"; id?: string; startIn?: FileHandleLike }): Promise<DirHandleLike>;
  showOpenFilePicker(opts: { types: typeof PICKER_TYPES; multiple: false }): Promise<FileHandleLike[]>;
}

/** ハンドルを保存する場所（前回のフォルダを覚えるため。ブラウザでは IndexedDB）。 */
export interface HandleStore {
  get(key: string): Promise<DirHandleLike | undefined>;
  set(key: string, value: DirHandleLike): Promise<void>;
}

/**
 * このブラウザで File System Access API が使えるか（F-FILE-10 の代替に切り替える判断）。
 *
 * @param w 調べるオブジェクト（ふつうは window）
 * @returns `showDirectoryPicker` と `showOpenFilePicker` の両方があれば true
 * @example
 * hasFsAccess({ showDirectoryPicker() {}, showOpenFilePicker() {} }) // → true
 * hasFsAccess({})                                                   // → false（Firefox・Safari など）
 */
export const hasFsAccess = (w: object): boolean => "showDirectoryPicker" in w && "showOpenFilePicker" in w;

/**
 * 利用者が選択ダイアログを閉じた（エラーではない）ことを表す例外か。
 *
 * @param e 投げられた値
 * @returns 名前が "AbortError" の Error（DOMException を含む）なら true
 * @example
 * isAbort(new DOMException("cancelled", "AbortError")) // → true
 * isAbort(new Error("x"))                              // → false
 */
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";
/**
 * ファイルの版を、更新時刻と大きさから作る（変われば内容が変わった可能性がある）。
 *
 * @param f ファイル
 * @returns `更新時刻:大きさ` の文字列
 * @example
 * versionOf({ lastModified: 1001, size: 10, text }) // → "1001:10"
 * versionOf({ lastModified: 0, size: 0, text })     // → "0:0"（空のファイル）
 */
const versionOf = (f: FileLike): string => `${f.lastModified}:${f.size}`;
/** 一覧に出さないフォルダ。 */
const SKIP_DIR = /^(\.|node_modules$)/;
const RECENT_KEY = "recent-folder";

export class LocalFolderProvider implements Readable, Writable, FolderSource, FilePicker, RecentFolders, SiblingFiles, FileLocator, FolderFiles {
  readonly id = "local";
  readonly label = "このコンピュータ";
  private readonly files = new Map<string, FileHandleLike>();
  private readonly folders = new Map<string, DirHandleLike>();
  private seq = 0;

  /**
   * ローカルのフォルダとファイルを扱うプロバイダを作る。
   *
   * @param api File System Access API（テストでは偽のハンドルに差し替える）
   * @param store 前回のフォルダを覚える場所（ブラウザでは IndexedDB）
   */
  constructor(
    private readonly api: FsApi,
    private readonly store: HandleStore,
  ) {}

  /**
   * フォルダの選択ダイアログを開き、選んだフォルダを開く。選んだフォルダは前回のフォルダとして覚える。
   *
   * @param near このファイルのある場所から選び始める（このプロバイダで開いたファイルのとき）
   * @returns 開いたフォルダの参照（id は `dir:番号`）。キャンセルなら null。ほかの失敗はそのまま投げる
   * @example
   * await p.pickFolder()   // → { provider: "local", id: "dir:1", name: "project" }
   * await p.pickFolder()   // → null（キャンセル）
   */
  async pickFolder(near?: FileRef): Promise<FolderRef | null> {
    const startIn = near && this.files.get(near.id);
    let dir: DirHandleLike;
    try {
      dir = await this.api.showDirectoryPicker({ mode: "readwrite", id: "modelith", ...(startIn ? { startIn } : {}) });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    await this.store.set(RECENT_KEY, dir);
    return this.addFolder(dir);
  }

  /**
   * 前回開いたフォルダの名前を返す。
   *
   * @returns フォルダの名前。覚えていなければ null
   * @example
   * await p.recentFolder() // → "project"
   * await p.recentFolder() // → null（初回）
   */
  async recentFolder(): Promise<string | null> {
    return (await this.store.get(RECENT_KEY))?.name ?? null;
  }

  /**
   * 前回開いたフォルダを開き直す。許可が無ければ求める（利用者の操作から呼ぶ）。
   *
   * @returns 開いたフォルダの参照。覚えていない・許可されなければ null
   * @example
   * await p.reopenRecent() // → { provider: "local", id: "dir:2", name: "project" }
   * await p.reopenRecent() // → null（許可されなかった）
   */
  async reopenRecent(): Promise<FolderRef | null> {
    const dir = await this.store.get(RECENT_KEY);
    if (!dir) return null;
    const ok = (await dir.queryPermission?.({ mode: "readwrite" })) === "granted" || (await dir.requestPermission?.({ mode: "readwrite" })) === "granted";
    return ok ? this.addFolder(dir) : null;
  }

  /**
   * フォルダの中のモデルのファイルを、ツリーとして一覧する（ADR-0010、F-FILE-2）。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @returns フォルダ → ファイルの順・名前順のツリー。モデルのファイルを含まないフォルダ・隠しフォルダ・node_modules は除く。
   *   開いていないフォルダなら例外（Error）を投げる
   * @example
   * paths(await p.list(folder)) // → ["sub/", "sub/c.sysml", "a.kerml", "b.sysml"]
   * await p.list(empty)         // → []（モデルのファイルが無い）
   */
  async list(folder: FolderRef): Promise<DirEntry[]> {
    return this.walk(this.folderHandle(folder), folder.id, "");
  }

  /**
   * フォルダの中にファイルを作り、テキストを書く。途中のフォルダが無ければ作る。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @param text 書く内容
   * @returns 作ったファイルの参照。名前が空・同じ名前のファイルが既にあるときは例外（Error）を投げる
   * @example
   * await p.createFile(folder, "models/new.sysml", "package P;") // → { …, path: "models/new.sysml" }
   * await p.createFile(folder, "a.sysml", "")                   // → Error「「a.sysml」は既にあります」（あるとき）
   */
  async createFile(folder: FolderRef, path: string, text: string): Promise<FileRef> {
    const segs = path.split("/").filter(Boolean);
    const name = segs.pop();
    if (!name) throw new Error("ファイル名がありません");
    let dir = this.folderHandle(folder);
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
    if (await exists(dir, name)) throw new Error(`「${path}」は既にあります`);
    const fh = await dir.getFileHandle(name, { create: true });
    await writeText(fh, text);
    return this.addFile(fh, `${folder.id}/${segs.concat(name).join("/")}`, segs.concat(name).join("/"));
  }

  /**
   * ファイルの選択ダイアログを開き、選んだファイルを 1 つだけ開く（フォルダの外のファイルとして扱う）。
   *
   * @returns 開いたファイルの参照（id は `file:番号`）。キャンセルなら null。ほかの失敗はそのまま投げる
   * @example
   * await p.pickFile() // → { provider: "local", id: "file:1", name: "one.sysml", path: "one.sysml" }
   * await p.pickFile() // → null（キャンセル）
   */
  async pickFile(): Promise<FileRef | null> {
    let handles: FileHandleLike[];
    try {
      handles = await this.api.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    const fh = handles[0];
    return fh ? this.addFile(fh, `file:${++this.seq}`, fh.name) : null;
  }

  /**
   * ファイルを読む。
   *
   * @param ref このプロバイダで開いたファイル
   * @returns 内容と版（`更新時刻:大きさ`）。開いていないファイルなら例外（Error）を投げる
   * @example
   * await p.read(ref)   // → { text: "package P;", version: "1001:10" }
   * await p.read(other) // → Error「ファイル「x.sysml」は開かれていません」を投げる
   */
  async read(ref: FileRef): Promise<FileContent> {
    const f = await this.fileHandle(ref).getFile();
    return { text: await f.text(), version: versionOf(f) };
  }

  /**
   * ファイルを上書きする。expectedVersion と今の版が違えば、書かずに ConflictError を投げる。
   *
   * @param ref このプロバイダで開いたファイル
   * @param text 書く内容
   * @param expectedVersion 読んだときの版。null なら比べずに上書きする（強制上書き）
   * @returns 書いた後の新しい版
   * @example
   * await p.write(ref, "new", version) // → 新しい版（version とは違う）
   * await p.write(ref, "new", version) // → ConflictError を投げる（読んだ後に他で変更されていたとき）
   */
  async write(ref: FileRef, text: string, expectedVersion: string | null): Promise<string> {
    const fh = this.fileHandle(ref);
    if (expectedVersion !== null && versionOf(await fh.getFile()) !== expectedVersion) throw new ConflictError(ref);
    await writeText(fh, text);
    return versionOf(await fh.getFile());
  }

  /**
   * 1 つだけ開いたファイルを、開いたフォルダの中から探し、フォルダから開いたファイルとしての参照を作る（ADR-0005）。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param ref このプロバイダで開いたファイル
   * @returns フォルダから開いたファイルとしての参照。フォルダの中に無ければ null
   * @example
   * await p.locate(folder, one) // → { …, path: "sub/one.sysml" }
   * await p.locate(other, one)  // → null（別のフォルダ）
   */
  async locate(folder: FolderRef, ref: FileRef): Promise<FileRef | null> {
    const fh = this.fileHandle(ref);
    const segs = await this.folderHandle(folder).resolve(fh);
    if (!segs) return null;
    const path = segs.join("/");
    return this.addFile(fh, `${folder.id}/${path}`, path);
  }

  /**
   * このファイルの隣を扱えるか（フォルダから開いたファイルだけ。1 つだけ選んだファイルは扱えない）。
   *
   * @param ref ファイルの参照
   * @returns フォルダから開いたファイルなら true
   * @example
   * p.hasSiblings(fromFolder) // → true
   * p.hasSiblings(picked)     // → false（1 つだけ選んだ）
   */
  hasSiblings(ref: FileRef): boolean {
    return this.parentOf(ref) !== null;
  }

  /**
   * 隣のファイル（同じ階層のファイル）を読む。
   *
   * @param ref フォルダから開いたファイル
   * @param name 隣のファイルの名前（`a.layout.json` など）
   * @returns 内容。無ければ null。隣を扱えないファイルなら例外（Error）を投げる
   * @example
   * await p.readSibling(ref, "a.layout.json")      // → "{}"
   * await p.readSibling(ref, "none.layout.json")   // → null（まだ作っていない）
   * await p.readSibling(picked, "one.layout.json") // → Error「…（フォルダを開いてください）」を投げる
   */
  async readSibling(ref: FileRef, name: string): Promise<string | null> {
    const dir = await this.parentDir(ref);
    if (!(await exists(dir, name))) return null;
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }

  /**
   * 隣のファイル（同じ階層のファイル）に書く。無ければ作る。隣を扱えないファイルなら例外（Error）を投げる。
   *
   * @param ref フォルダから開いたファイル
   * @param name 隣のファイルの名前（`a.layout.json` など）
   * @param text 書く内容
   */
  async writeSibling(ref: FileRef, name: string, text: string): Promise<void> {
    const dir = await this.parentDir(ref);
    await writeText(await dir.getFileHandle(name, { create: true }), text);
  }

  /**
   * 開いたフォルダの中のファイルを読む（プロジェクトの設定ファイルなど。一覧に出ないファイルも読める）。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @returns 内容。ファイル（か途中のフォルダ）が無ければ null。開いていないフォルダなら例外（Error）を投げる
   * @example
   * await p.readInFolder(folder, "modelith.json")  // → '{ "name": "給水" }'
   * await p.readInFolder(folder, "none/a.json")    // → null（途中のフォルダが無い）
   */
  async readInFolder(folder: FolderRef, path: string): Promise<string | null> {
    const segs = path.split("/").filter(Boolean);
    const name = segs.pop();
    if (!name) return null;
    let dir = this.folderHandle(folder);
    for (const s of segs) {
      const sub = await childDir(dir, s);
      if (!sub) return null;
      dir = sub;
    }
    if (!(await exists(dir, name))) return null;
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }

  /**
   * 開いたフォルダの中のファイルに書く。無ければ作る（途中のフォルダも作る）。
   * 名前が空・開いていないフォルダなら例外（Error）を投げる。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @param text 書く内容
   */
  async writeInFolder(folder: FolderRef, path: string, text: string): Promise<void> {
    const segs = path.split("/").filter(Boolean);
    const name = segs.pop();
    if (!name) throw new Error("ファイル名がありません");
    let dir = this.folderHandle(folder);
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
    await writeText(await dir.getFileHandle(name, { create: true }), text);
  }

  /**
   * フォルダから開いたファイルなら、そのフォルダと、ファイルのある階層までのパスを返す。
   *
   * @param ref ファイルの参照
   * @returns 開いたフォルダのハンドルと、パスの区切り（ファイル名を除く）。フォルダから開いたファイルでなければ null
   * @example
   * this.parentOf({ provider: "local", id: "dir:1/models/a.sysml", name: "a.sysml", path: "models/a.sysml" })
   * // → { folder: dir:1 のハンドル, segs: ["models"] }
   * this.parentOf({ provider: "local", id: "file:2", name: "one.sysml", path: "one.sysml" }) // → null
   */
  private parentOf(ref: FileRef): { folder: DirHandleLike; segs: string[] } | null {
    if (ref.provider !== this.id) return null;
    const slash = ref.id.indexOf("/");
    const folder = slash > 0 ? this.folders.get(ref.id.slice(0, slash)) : undefined;
    if (!folder) return null;
    return { folder, segs: ref.path.split("/").slice(0, -1) };
  }

  /**
   * ファイルのある階層のフォルダを返す。
   *
   * @param ref フォルダから開いたファイル
   * @returns ファイルのある階層のフォルダのハンドル。フォルダから開いたファイルでなければ例外（Error）を投げる
   * @example
   * await this.parentDir(fromFolder) // → models フォルダのハンドル（path が "models/a.sysml" のとき）
   * await this.parentDir(picked)     // → Error「「one.sysml」の隣のファイルは扱えません（フォルダを開いてください）」を投げる
   */
  private async parentDir(ref: FileRef): Promise<DirHandleLike> {
    const p = this.parentOf(ref);
    if (!p) throw new Error(`「${ref.name}」の隣のファイルは扱えません（フォルダを開いてください）`);
    let dir = p.folder;
    for (const s of p.segs) dir = await dir.getDirectoryHandle(s);
    return dir;
  }

  /**
   * フォルダのハンドルを覚え、参照を作る。
   *
   * @param dir フォルダのハンドル
   * @returns 新しい参照（id は `dir:番号`）
   * @example
   * this.addFolder(project) // → { provider: "local", id: "dir:1", name: "project" }
   */
  private addFolder(dir: DirHandleLike): FolderRef {
    const id = `dir:${++this.seq}`;
    this.folders.set(id, dir);
    return { provider: this.id, id, name: dir.name };
  }

  /**
   * ファイルのハンドルを id で覚え、参照を作る（同じ id なら置き換える）。
   *
   * @param fh ファイルのハンドル
   * @param id 参照の id（フォルダから開いたものは `フォルダの id/パス`、1 つだけ選んだものは `file:番号`）
   * @param path 表示用のパス（フォルダからの相対パス）
   * @returns 新しい参照
   * @example
   * this.addFile(fh, "dir:1/sub/c.sysml", "sub/c.sysml") // → { provider: "local", id: "dir:1/sub/c.sysml", name: "c.sysml", path: "sub/c.sysml" }
   */
  private addFile(fh: FileHandleLike, id: string, path: string): FileRef {
    this.files.set(id, fh);
    return { provider: this.id, id, name: fh.name, path };
  }

  /**
   * 開いたフォルダのハンドルを引く。
   *
   * @param folder フォルダの参照
   * @returns フォルダのハンドル。開いていなければ例外（Error）を投げる
   * @example
   * this.folderHandle({ provider: "local", id: "dir:1", name: "project" }) // → project のハンドル
   * this.folderHandle({ provider: "local", id: "dir:9", name: "x" })       // → Error「フォルダ「x」は開かれていません」を投げる
   */
  private folderHandle(folder: FolderRef): DirHandleLike {
    const dir = this.folders.get(folder.id);
    if (!dir) throw new Error(`フォルダ「${folder.name}」は開かれていません`);
    return dir;
  }

  /**
   * 開いたファイルのハンドルを引く。
   *
   * @param ref ファイルの参照
   * @returns ファイルのハンドル。開いていなければ例外（Error）を投げる
   * @example
   * this.fileHandle(ref)   // → ファイルのハンドル
   * this.fileHandle(other) // → Error「ファイル「x.sysml」は開かれていません」を投げる
   */
  private fileHandle(ref: FileRef): FileHandleLike {
    const fh = this.files.get(ref.id);
    if (!fh) throw new Error(`ファイル「${ref.path}」は開かれていません`);
    return fh;
  }

  /**
   * フォルダの中を再帰でたどり、モデルのファイルを含むフォルダだけを、フォルダ → ファイルの順・名前順で返す。
   * 見つけたファイルは `rootId/パス` の id で覚える（一覧し直しても同じ id になる）。
   *
   * @param dir たどるフォルダ
   * @param rootId 開いたフォルダの id
   * @param prefix dir までのパス（開いたフォルダの直下なら空文字列）
   * @returns ツリー。隠しフォルダ・node_modules・モデルのファイルを含まないフォルダは除く
   * @example
   * paths(await this.walk(root, "dir:1", "")) // → ["sub/", "sub/c.sysml", "a.kerml", "b.sysml"]
   * await this.walk(empty, "dir:1", "")       // → []
   */
  private async walk(dir: DirHandleLike, rootId: string, prefix: string): Promise<DirEntry[]> {
    const dirs: DirEntry[] = [];
    const files: DirEntry[] = [];
    for await (const h of dir.values()) {
      const path = prefix ? `${prefix}/${h.name}` : h.name;
      if (h.kind === "directory") {
        if (SKIP_DIR.test(h.name)) continue;
        const children = await this.walk(h, rootId, path);
        if (children.length) dirs.push({ kind: "dir", name: h.name, path, children });
      } else if (isModelFile(h.name)) {
        files.push({ kind: "file", ref: this.addFile(h, `${rootId}/${path}`, path) });
      }
    }
    const byName = (a: DirEntry, b: DirEntry): number => nameOf(a).localeCompare(nameOf(b));
    return [...dirs.sort(byName), ...files.sort(byName)];
  }
}

/**
 * ツリーの項目の名前（並べ替えに使う）。
 *
 * @param e ツリーの項目
 * @returns フォルダならフォルダの名前、ファイルならファイル名
 * @example
 * nameOf({ kind: "dir", name: "sub", path: "sub", children: [] }) // → "sub"
 * nameOf({ kind: "file", ref })                                   // → ref.name
 */
const nameOf = (e: DirEntry): string => (e.kind === "dir" ? e.name : e.ref.name);

/**
 * フォルダの直下に、その名前のファイルがあるか。
 *
 * @param dir フォルダ
 * @param name ファイルの名前
 * @returns あれば true。引けなければ（無い・フォルダである）false
 * @example
 * await exists(root, "a.sysml")    // → true
 * await exists(root, "none.sysml") // → false
 */
async function exists(dir: DirHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * フォルダの直下の、その名前のフォルダを引く。
 *
 * @param dir フォルダ
 * @param name フォルダの名前
 * @returns フォルダのハンドル。引けなければ（無い・ファイルである）null
 * @example
 * await childDir(root, "models") // → models のハンドル
 * await childDir(root, "none")   // → null
 */
async function childDir(dir: DirHandleLike, name: string): Promise<DirHandleLike | null> {
  try {
    return await dir.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

/**
 * ファイルの内容をテキストで置き換える（書き込みの流れを作り、書いて閉じる）。
 *
 * @param fh ファイルのハンドル
 * @param text 書く内容
 */
async function writeText(fh: FileHandleLike, text: string): Promise<void> {
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
