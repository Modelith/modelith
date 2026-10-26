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
  type FolderEdits,
  type FolderFiles,
  type FolderRef,
  type FolderSource,
  type FolderTrees,
  type Readable,
  type RecentAccess,
  type RecentFolder,
  type RecentFolders,
  type SiblingFiles,
  type Writable,
} from "./types";
import { forgetRecent, parseRecent, pushRecent, withProject, type RecentEntry } from "./recent-folders";

/* ---- 使う API の範囲だけを型にする（lib.dom に無い部分を含むため） ---- */
export interface FileLike {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly lastModified: number;
  readonly size: number;
}
export interface WritableStreamLike {
  write(data: string | ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}
export type PermissionState = "granted" | "denied" | "prompt";
interface HandleBase {
  readonly name: string;
  queryPermission?(opts: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "readwrite" }): Promise<PermissionState>;
  /** other と同じファイルかフォルダか（同じフォルダを一覧に 2 度入れないため）。 */
  isSameEntry?(other: HandleBase): Promise<boolean>;
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
  /** 直下のファイルかフォルダを消す（recursive なら中身ごと）。無ければ NotFoundError。 */
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  /** h がこのフォルダの中にあれば、フォルダからのパスの各部分（無ければ null）。 */
  resolve(h: FileHandleLike): Promise<string[] | null>;
}
const PICKER_TYPES = [{ description: "SysML v2 / KerML", accept: { "text/plain": [".sysml", ".kerml"] } }];
export interface FsApi {
  showDirectoryPicker(opts: { mode: "read" | "readwrite"; id?: string; startIn?: FileHandleLike }): Promise<DirHandleLike>;
  showOpenFilePicker(opts: { types: typeof PICKER_TYPES; multiple: false }): Promise<FileHandleLike[]>;
}

/** ハンドルを保存する場所（開いたフォルダの一覧を覚えるため。ブラウザでは IndexedDB）。値は構造化複製できるもの。 */
export interface HandleStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
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
/** 以前の版が、前回のフォルダを 1 つだけ覚えていたキー（一覧が無いときに、一覧の最初の 1 件として読む）。 */
const RECENT_KEY = "recent-folder";
/** 開いたフォルダの一覧（プロジェクトの一覧。F-PROJ-3）を覚えるキー。 */
const RECENT_LIST_KEY = "recent-folders";

/**
 * フォルダのハンドルらしい値か（保存しておいた一覧を読むときに確かめる）。
 *
 * @param v 調べる値
 * @returns kind が "directory" で名前のあるオブジェクトなら true
 * @example
 * isDirHandle(new FakeDir("project")) // → true
 * isDirHandle({ name: "x" })          // → false
 */
const isDirHandle = (v: unknown): v is DirHandleLike =>
  typeof v === "object" && v !== null && (v as DirHandleLike).kind === "directory" && typeof (v as DirHandleLike).name === "string";
/** readTree で読むファイルの数の上限（プラグインではない大きなフォルダを選んだときに、読み続けないため）。 */
export const MAX_TREE_FILES = 200;

/**
 * フォルダからの相対パスを、区切りの列にする。フォルダの外を指すパスは受け付けない。
 *
 * @param path `/` 区切りの相対パス（空の区切りは無視する）
 * @returns 区切りの列（"" なら空の配列）。`.`・`..` の区切りや `\` を含むときは例外（Error）を投げる
 * @example
 * segmentsOf("a//b/c.json") // → ["a", "b", "c.json"]
 * segmentsOf("")            // → []
 * segmentsOf("a/../b")      // → Error「パス「a/../b」は、フォルダの外を指しています」を投げる
 */
export function segmentsOf(path: string): string[] {
  const segs = path.split("/").filter(Boolean);
  if (segs.some((s) => s === "." || s === ".." || s.includes("\\"))) throw new Error(`パス「${path}」は、フォルダの外を指しています`);
  return segs;
}

export class LocalFolderProvider
  implements Readable, Writable, FolderSource, FilePicker, RecentFolders, SiblingFiles, FileLocator, FolderFiles, FolderTrees, FolderEdits
{
  readonly id = "local";
  readonly label = "このコンピュータ";
  private readonly files = new Map<string, FileHandleLike>();
  private readonly folders = new Map<string, DirHandleLike>();
  /** 開いたフォルダの参照の id → プロジェクトの一覧の項目の名前。 */
  private readonly recentIds = new Map<string, string>();
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
    return this.remember(dir);
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
    return (await this.recentList())[0]?.handle.name ?? null;
  }

  /**
   * 前回開いたフォルダを、今の許可のまま開けるかを確かめる。許可は求めない（利用者の操作が無くても呼べる。F-FILE-13）。
   *
   * @returns 許可の状態。覚えていなければ "none"。許可を確かめられないハンドルなら "denied"
   * @example
   * await p.recentAccess() // → "granted"（許可が残っている）
   * await p.recentAccess() // → "prompt"（開き直すには許可を求める）
   * await p.recentAccess() // → "none"（初回）
   */
  async recentAccess(): Promise<RecentAccess> {
    const dir = (await this.recentList())[0]?.handle;
    if (!dir) return "none";
    return (await dir.queryPermission?.({ mode: "readwrite" })) ?? "denied";
  }

  /**
   * 前回開いたフォルダを開き直す。許可が無ければ求める（利用者の操作から呼ぶ）。
   *
   * @param opts `ask: false` なら許可を求めず、既に許可されているときだけ開く（既定 true）
   * @returns 開いたフォルダの参照。覚えていない・許可されなければ null
   * @example
   * await p.reopenRecent()                 // → { provider: "local", id: "dir:2", name: "project" }
   * await p.reopenRecent()                 // → null（許可されなかった）
   * await p.reopenRecent({ ask: false })   // → null（許可を求めないと開けない）
   */
  async reopenRecent(opts: { ask?: boolean } = {}): Promise<FolderRef | null> {
    const first = (await this.recentList())[0];
    return first ? this.openEntry(first.handle, opts) : null;
  }

  /**
   * 開いたフォルダの一覧（プロジェクトの一覧。F-PROJ-3）を返す。
   *
   * @returns 最後に開いた順の一覧。覚えていなければ空
   * @example
   * await p.recentFolders() // → [{ id: "2", name: "project", project: "給水" }, { id: "1", name: "old", project: null }]
   * await p.recentFolders() // → []（初回）
   */
  async recentFolders(): Promise<RecentFolder[]> {
    return (await this.recentList()).map((e) => ({ id: e.id, name: e.handle.name, project: e.project }));
  }

  /**
   * 一覧のフォルダを開き、一覧の先頭に移す（F-PROJ-3）。許可が無ければ求める（利用者の操作から呼ぶ）。
   *
   * @param id 一覧の項目の名前
   * @returns 開いたフォルダの参照。一覧に無い・許可されなければ null
   * @example
   * await p.openRecent("1") // → { provider: "local", id: "dir:3", name: "old" }
   * await p.openRecent("9") // → null（一覧に無い）
   */
  async openRecent(id: string): Promise<FolderRef | null> {
    const entry = (await this.recentList()).find((e) => e.id === id);
    return entry ? this.openEntry(entry.handle, {}) : null;
  }

  /**
   * フォルダを一覧から外す（F-PROJ-3）。フォルダそのものには触れない。
   *
   * @param id 一覧の項目の名前
   * @example
   * await p.forgetRecent("1") // → 一覧から id "1" が無くなる
   */
  async forgetRecent(id: string): Promise<void> {
    await this.store.set(RECENT_LIST_KEY, forgetRecent(await this.recentList(), id));
    for (const [folder, rid] of this.recentIds) if (rid === id) this.recentIds.delete(folder);
  }

  /**
   * 開いているフォルダが、一覧のどの項目かを返す。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @returns 一覧の項目の名前。一覧から開いていない・外したなら null
   * @example
   * p.recentIdOf(folder) // → "2"
   * p.recentIdOf(plugin) // → null（プラグインのフォルダは一覧に入れない）
   */
  recentIdOf(folder: FolderRef): string | null {
    return this.recentIds.get(folder.id) ?? null;
  }

  /**
   * 開いているフォルダのプロジェクト名を、一覧に覚える（一覧に名前を出すため。F-PROJ-3）。変わらなければ書かない。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param project プロジェクトの名前。プロジェクトでなければ null
   * @example
   * await p.setRecentProject(folder, "給水") // → p.recentFolders() のその項目の project が "給水"
   */
  async setRecentProject(folder: FolderRef, project: string | null): Promise<void> {
    const id = this.recentIds.get(folder.id);
    if (id === undefined) return;
    const r = withProject(await this.recentList(), id, project);
    if (r.changed) await this.store.set(RECENT_LIST_KEY, r.list);
  }

  /**
   * 覚えているフォルダの一覧を読む。一覧が無ければ、以前の版が覚えた前回のフォルダを 1 件目として読む。
   *
   * @returns 最後に開いた順の一覧
   * @example
   * await this.recentList() // → [{ id: "1", handle: project のハンドル, project: null }]
   */
  private async recentList(): Promise<RecentEntry<DirHandleLike>[]> {
    const raw = await this.store.get(RECENT_LIST_KEY);
    if (raw !== undefined) return parseRecent(raw, isDirHandle);
    const old = await this.store.get(RECENT_KEY);
    return isDirHandle(old) ? [{ id: "1", handle: old, project: null }] : [];
  }

  /**
   * 開いたフォルダを一覧の先頭に置き（同じフォルダが既にあれば移す）、参照を作る。
   *
   * @param dir 開いたフォルダのハンドル
   * @returns 新しい参照
   * @example
   * await this.remember(project) // → { provider: "local", id: "dir:1", name: "project" }（一覧の先頭が project）
   */
  private async remember(dir: DirHandleLike): Promise<FolderRef> {
    const list = await this.recentList();
    let at = -1;
    for (let i = 0; i < list.length && at < 0; i++) {
      const h = list[i]?.handle;
      if (h && (h === dir || (await h.isSameEntry?.(dir)))) at = i;
    }
    const next = pushRecent(list, at, dir);
    await this.store.set(RECENT_LIST_KEY, next);
    const ref = this.addFolder(dir);
    if (next[0]) this.recentIds.set(ref.id, next[0].id);
    return ref;
  }

  /**
   * 覚えているフォルダを、許可を確かめて開く。
   *
   * @param dir フォルダのハンドル
   * @param opts `ask: false` なら許可を求めず、既に許可されているときだけ開く
   * @returns 開いたフォルダの参照。許可されなければ null
   * @example
   * await this.openEntry(project, {})              // → { provider: "local", id: "dir:2", name: "project" }
   * await this.openEntry(project, { ask: false })  // → null（許可を求めないと開けない）
   */
  private async openEntry(dir: DirHandleLike, opts: { ask?: boolean }): Promise<FolderRef | null> {
    const granted = (await dir.queryPermission?.({ mode: "readwrite" })) === "granted";
    const ok = granted || (opts.ask !== false && (await dir.requestPermission?.({ mode: "readwrite" })) === "granted");
    return ok ? this.remember(dir) : null;
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
   * @returns 作ったファイルの参照。名前が空・フォルダの外を指すパス・同じ名前のファイルが既にあるときは例外（Error）を投げる
   * @example
   * await p.createFile(folder, "models/new.sysml", "package P;") // → { …, path: "models/new.sysml" }
   * await p.createFile(folder, "a.sysml", "")                   // → Error「「a.sysml」は既にあります」（あるとき）
   * await p.createFile(folder, "models/../x.sysml", "")         // → Error「パス「models/../x.sysml」は、フォルダの外を指しています」
   */
  async createFile(folder: FolderRef, path: string, text: string): Promise<FileRef> {
    const segs = segmentsOf(path);
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
   * @returns 内容と版（`更新時刻:大きさ`）。無ければ null。隣を扱えないファイルなら例外（Error）を投げる
   * @example
   * await p.readSibling(ref, "a.layout.json")      // → { text: "{}", version: "1001:2" }
   * await p.readSibling(ref, "none.layout.json")   // → null（まだ作っていない）
   * await p.readSibling(picked, "one.layout.json") // → Error「…（フォルダを開いてください）」を投げる
   */
  async readSibling(ref: FileRef, name: string): Promise<FileContent | null> {
    const dir = await this.parentDir(ref);
    if (!(await exists(dir, name))) return null;
    const f = await (await dir.getFileHandle(name)).getFile();
    return { text: await f.text(), version: versionOf(f) };
  }

  /**
   * 隣のファイル（同じ階層のファイル）に書く。無ければ作る。あれば expectedVersion と今の版を比べ、違えば書かずに ConflictError を投げる。
   * 隣を扱えないファイルなら例外（Error）を投げる。
   *
   * @param ref フォルダから開いたファイル
   * @param name 隣のファイルの名前（`a.layout.json` など）
   * @param text 書く内容
   * @param expectedVersion 読んだときの版。null なら比べずに上書きする（強制上書き・まだ読んでいない）
   * @returns 書いた後の新しい版
   * @example
   * await p.writeSibling(ref, "a.layout.json", "L", version) // → 新しい版（version とは違う）
   * await p.writeSibling(ref, "a.layout.json", "L", version) // → ConflictError を投げる（読んだ後に他で変更されていたとき）
   * await p.writeSibling(ref, "a.layout.json", "L", version) // → 新しい版（読んだ後に消されていたときは作り直す）
   */
  async writeSibling(ref: FileRef, name: string, text: string, expectedVersion: string | null): Promise<string> {
    const dir = await this.parentDir(ref);
    if (expectedVersion !== null && (await exists(dir, name))) {
      const current = await (await dir.getFileHandle(name)).getFile();
      if (versionOf(current) !== expectedVersion) throw new ConflictError(siblingRef(ref, name));
    }
    const fh = await dir.getFileHandle(name, { create: true });
    await writeText(fh, text);
    return versionOf(await fh.getFile());
  }

  /**
   * 開いたフォルダの中のファイルを読む（プロジェクトの設定ファイルなど。一覧に出ないファイルも読める）。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @returns 内容。ファイル（か途中のフォルダ）が無ければ null。開いていないフォルダ・フォルダの外を指すパスなら例外（Error）を投げる
   * @example
   * await p.readInFolder(folder, "modelith.json")  // → '{ "name": "給水" }'
   * await p.readInFolder(folder, "none/a.json")    // → null（途中のフォルダが無い）
   * await p.readInFolder(folder, "../a.json")      // → Error「パス「../a.json」は、フォルダの外を指しています」を投げる
   */
  async readInFolder(folder: FolderRef, path: string): Promise<string | null> {
    const segs = segmentsOf(path);
    const name = segs.pop();
    if (!name) return null;
    const dir = await descend(this.folderHandle(folder), segs);
    if (!dir || !(await exists(dir, name))) return null;
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }

  /**
   * 開いたフォルダの中のファイルに書く。無ければ作る（途中のフォルダも作る）。
   * 名前が空・開いていないフォルダ・フォルダの外を指すパスなら例外（Error）を投げる。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @param text 書く内容
   */
  async writeInFolder(folder: FolderRef, path: string, text: string): Promise<void> {
    const segs = segmentsOf(path);
    const name = segs.pop();
    if (!name) throw new Error("ファイル名がありません");
    let dir = this.folderHandle(folder);
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
    await writeText(await dir.getFileHandle(name, { create: true }), text);
  }

  /**
   * 読むためのフォルダ（プラグインのフォルダなど）を選ばせる。開いているフォルダは変えず、前回のフォルダとしても覚えない。
   *
   * @returns 選んだフォルダの参照（id は `dir:番号`）。キャンセルなら null。ほかの失敗はそのまま投げる
   * @example
   * await p.pickOtherFolder() // → { provider: "local", id: "dir:2", name: "trace-rules" }
   * await p.pickOtherFolder() // → null（キャンセル）
   */
  async pickOtherFolder(): Promise<FolderRef | null> {
    try {
      return this.addFolder(await this.api.showDirectoryPicker({ mode: "read", id: "modelith-plugin" }));
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }

  /**
   * フォルダの中のフォルダにあるファイルを、下のフォルダまですべてテキストで読む。
   * 隠しファイル・隠しフォルダ・node_modules は読まない。
   *
   * @param folder このプロバイダで開いた（選んだ）フォルダ
   * @param path フォルダからの相対パス（`/` 区切り。"" ならフォルダそのもの）
   * @returns path からの相対パス（`/` 区切り）→ テキスト。フォルダが無ければ null。
   *   ファイルが MAX_TREE_FILES 件を超える・フォルダの外を指すパス・開いていないフォルダなら例外（Error）を投げる
   * @example
   * await p.readTree(folder, ".modelith/plugins/jp.x") // → { "modelith-plugin.json": "{…}", "rules/a.yaml": "rules: …" }
   * await p.readTree(folder, ".modelith/plugins/none") // → null
   * await p.readTree(home, "")                          // → Error「ファイルが多すぎます（200 件まで）…」を投げる
   */
  async readTree(folder: FolderRef, path: string): Promise<Record<string, string> | null> {
    const dir = await descend(this.folderHandle(folder), segmentsOf(path));
    if (!dir) return null;
    const out: Record<string, string> = {};
    await readAll(dir, "", out);
    return out;
  }

  /**
   * フォルダの中のファイルかフォルダを、中身ごと消す。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @returns 消したら true。無ければ false。パスが空・フォルダの外を指す・開いていないフォルダなら例外（Error）を投げる
   * @example
   * await p.removeInFolder(folder, ".modelith/plugins/jp.x") // → true
   * await p.removeInFolder(folder, ".modelith/plugins/none") // → false
   * await p.removeInFolder(folder, "")                       // → Error「消す場所がありません」を投げる
   */
  async removeInFolder(folder: FolderRef, path: string): Promise<boolean> {
    const segs = segmentsOf(path);
    const name = segs.pop();
    if (!name) throw new Error("消す場所がありません");
    const dir = await descend(this.folderHandle(folder), segs);
    if (!dir || !((await exists(dir, name)) || (await childDir(dir, name)))) return false;
    await dir.removeEntry(name, { recursive: true });
    return true;
  }

  /**
   * フォルダの中に空のフォルダを作る（途中のフォルダも作る。F-FILE-19）。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path 作るフォルダの、フォルダからの相対パス（`/` 区切り）
   * @returns 作り終えたら解決する Promise。名前が空・フォルダの外を指す・同じ名前のファイルかフォルダが既にあるときは例外（Error）で拒否する
   * @example
   * await p.createFolder(folder, "models/parts") // → models/parts ができる
   * await p.createFolder(folder, "models")       // → Error「「models」は既にあります」（あるとき）
   */
  async createFolder(folder: FolderRef, path: string): Promise<void> {
    const segs = segmentsOf(path);
    const name = segs.pop();
    if (!name) throw new Error("フォルダ名がありません");
    let dir = this.folderHandle(folder);
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
    if ((await exists(dir, name)) || (await childDir(dir, name))) throw new Error(`「${path}」は既にあります`);
    await dir.getDirectoryHandle(name, { create: true });
  }

  /**
   * フォルダの中のファイルかフォルダを、別のパスへ動かす（名前の変更。F-FILE-19）。
   * ブラウザには、ローカルのフォルダの中で動かす方法がそろっていないので、中身をバイトのまま写してから元を消す。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param from 動かすもののパス
   * @param to 動かした先のパス（途中のフォルダは作る）
   * @returns 動かし終えたら解決する Promise。from が無い・to に既に何かある・to が from の中を指す・フォルダの外を指すときは例外（Error）で拒否する
   * @example
   * await p.moveInFolder(folder, "a.sysml", "b.sysml") // → a.sysml が b.sysml になる
   * await p.moveInFolder(folder, "models", "parts")    // → models の中身ごと parts になる
   * await p.moveInFolder(folder, "models", "models/x") // → Error「「models」を、その中へは動かせません」
   */
  async moveInFolder(folder: FolderRef, from: string, to: string): Promise<void> {
    const src = segmentsOf(from);
    const dst = segmentsOf(to);
    const srcName = src.pop();
    const dstName = dst.pop();
    if (!srcName || !dstName) throw new Error("動かす場所がありません");
    if (to.startsWith(`${from}/`)) throw new Error(`「${from}」を、その中へは動かせません`);
    const root = this.folderHandle(folder);
    const srcDir = await descend(root, src);
    const file = srcDir && (await exists(srcDir, srcName)) ? await srcDir.getFileHandle(srcName) : null;
    const dir = srcDir && !file ? await childDir(srcDir, srcName) : null;
    if (!srcDir || (!file && !dir)) throw new Error(`「${from}」が見つかりません`);
    let dstDir = root;
    for (const s of dst) dstDir = await dstDir.getDirectoryHandle(s, { create: true });
    if ((await exists(dstDir, dstName)) || (await childDir(dstDir, dstName))) throw new Error(`「${to}」は既にあります`);
    if (file) await copyFile(file, await dstDir.getFileHandle(dstName, { create: true }));
    else if (dir) await copyDir(dir, await dstDir.getDirectoryHandle(dstName, { create: true }));
    await srcDir.removeEntry(srcName, { recursive: true });
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
   * フォルダの中を再帰でたどり、モデルのファイルを含むフォルダと中が空のフォルダ（作ったばかりのフォルダ。F-FILE-1）を、フォルダ → ファイルの順・名前順で返す。
   * 見つけたファイルは `rootId/パス` の id で覚える（一覧し直しても同じ id になる）。
   *
   * @param dir たどるフォルダ
   * @param rootId 開いたフォルダの id
   * @param prefix dir までのパス（開いたフォルダの直下なら空文字列）
   * @returns ツリー。隠しフォルダ・node_modules・モデルのファイルを含まない（空ではない）フォルダは除く
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
        if (children.length || (await isEmptyDir(h))) dirs.push({ kind: "dir", name: h.name, path, children });
      } else if (isModelFile(h.name)) {
        files.push({ kind: "file", ref: this.addFile(h, `${rootId}/${path}`, path) });
      }
    }
    const byName = (a: DirEntry, b: DirEntry): number => nameOf(a).localeCompare(nameOf(b));
    return [...dirs.sort(byName), ...files.sort(byName)];
  }
}

/**
 * 隣のファイルの参照を作る（競合の知らせに、どのファイルかを書くため）。
 *
 * @param ref フォルダから開いたファイル（id とパスはファイル名で終わる）
 * @param name 隣のファイルの名前
 * @returns 同じ階層の name の参照（id とパスのファイル名を name に替えたもの）
 * @example
 * siblingRef({ provider: "local", id: "dir:1/models/a.sysml", name: "a.sysml", path: "models/a.sysml" }, "a.layout.json")
 * // → { provider: "local", id: "dir:1/models/a.layout.json", name: "a.layout.json", path: "models/a.layout.json" }
 */
function siblingRef(ref: FileRef, name: string): FileRef {
  const renamed = (s: string): string => s.slice(0, s.length - ref.name.length) + name;
  return { provider: ref.provider, id: renamed(ref.id), name, path: renamed(ref.path) };
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
 * フォルダの中が空か（ファイルもフォルダも無いか）。
 *
 * @param dir フォルダ
 * @returns 何も無ければ true
 * @example
 * await isEmptyDir(created) // → true（作ったばかりのフォルダ）
 * await isEmptyDir(docs)    // → false（README.md だけがある）
 */
async function isEmptyDir(dir: DirHandleLike): Promise<boolean> {
  for await (const _ of dir.values()) return false;
  return true;
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
 * フォルダから、区切りの列をたどって下のフォルダを引く。
 *
 * @param dir たどり始めるフォルダ
 * @param segs たどる区切りの列（空ならそのフォルダ）
 * @returns たどり着いたフォルダ。途中が無い（ファイルである）なら null
 * @example
 * await descend(root, ["a", "b"]) // → a/b のハンドル
 * await descend(root, [])         // → root
 * await descend(root, ["none"])   // → null
 */
async function descend(dir: DirHandleLike, segs: string[]): Promise<DirHandleLike | null> {
  let d = dir;
  for (const s of segs) {
    const sub = await childDir(d, s);
    if (!sub) return null;
    d = sub;
  }
  return d;
}

/**
 * フォルダの中のファイルを、下のフォルダまでテキストで読み、out に足す。隠しファイル・隠しフォルダ・node_modules は読まない。
 *
 * @param dir 読むフォルダ
 * @param prefix dir までのパス（読み始めたフォルダの直下なら ""）
 * @param out パス → テキスト（読んだファイルを足す）
 * @example
 * await readAll(plugin, "", out) // out → { "modelith-plugin.json": "…", "rules/a.yaml": "…" }
 * // ファイルが MAX_TREE_FILES 件を超えたら Error「ファイルが多すぎます（200 件まで）…」を投げる
 */
async function readAll(dir: DirHandleLike, prefix: string, out: Record<string, string>): Promise<void> {
  for await (const h of dir.values()) {
    if (SKIP_DIR.test(h.name)) continue;
    const path = prefix ? `${prefix}/${h.name}` : h.name;
    if (h.kind === "directory") {
      await readAll(h, path, out);
      continue;
    }
    if (Object.keys(out).length >= MAX_TREE_FILES) throw new Error(`ファイルが多すぎます（${MAX_TREE_FILES} 件まで）。プラグインのフォルダを選んでください`);
    out[path] = await (await h.getFile()).text();
  }
}

/**
 * ファイルの中身を、バイトのまま別のファイルへ写す。
 *
 * @param from 写すファイル
 * @param to 写し先のファイル（中身を置き換える）
 */
async function copyFile(from: FileHandleLike, to: FileHandleLike): Promise<void> {
  const data = await (await from.getFile()).arrayBuffer();
  const w = await to.createWritable();
  await w.write(data);
  await w.close();
}

/**
 * フォルダの中身を、下のフォルダまですべて別のフォルダへ写す（隠しファイルも含め、何も除かない）。
 *
 * @param from 写すフォルダ
 * @param to 写し先のフォルダ（空のフォルダを渡す）
 */
async function copyDir(from: DirHandleLike, to: DirHandleLike): Promise<void> {
  for await (const h of from.values()) {
    if (h.kind === "directory") await copyDir(h, await to.getDirectoryHandle(h.name, { create: true }));
    else await copyFile(h, await to.getFileHandle(h.name, { create: true }));
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
