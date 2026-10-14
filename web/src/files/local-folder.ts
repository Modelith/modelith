// ローカルのフォルダとファイルを File System Access API で扱うプロバイダ（ADR-0010、F-FILE-1・2・3・9）。
// ブラウザの API は FsApi として外から渡し、単体テストでは偽のハンドルに差し替える。

import {
  ConflictError,
  isModelFile,
  type DirEntry,
  type FileContent,
  type FilePicker,
  type FileRef,
  type FolderRef,
  type FolderSource,
  type Readable,
  type RecentFolders,
  type SaveAsTarget,
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
}
const PICKER_TYPES = [{ description: "SysML v2 / KerML", accept: { "text/plain": [".sysml", ".kerml"] } }];
export interface FsApi {
  showDirectoryPicker(opts: { mode: "readwrite"; id?: string }): Promise<DirHandleLike>;
  showOpenFilePicker(opts: { types: typeof PICKER_TYPES; multiple: false }): Promise<FileHandleLike[]>;
  showSaveFilePicker(opts: { suggestedName: string; types: typeof PICKER_TYPES }): Promise<FileHandleLike>;
}

/** ハンドルを保存する場所（前回のフォルダを覚えるため。ブラウザでは IndexedDB）。 */
export interface HandleStore {
  get(key: string): Promise<DirHandleLike | undefined>;
  set(key: string, value: DirHandleLike): Promise<void>;
}

/** このブラウザで File System Access API が使えるか。 */
export const hasFsAccess = (w: object): boolean => "showDirectoryPicker" in w && "showOpenFilePicker" in w && "showSaveFilePicker" in w;

/** 利用者が選択ダイアログを閉じた（エラーではない）。 */
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";
const versionOf = (f: FileLike): string => `${f.lastModified}:${f.size}`;
/** 一覧に出さないフォルダ。 */
const SKIP_DIR = /^(\.|node_modules$)/;
const RECENT_KEY = "recent-folder";

export class LocalFolderProvider implements Readable, Writable, FolderSource, FilePicker, SaveAsTarget, RecentFolders, SiblingFiles {
  readonly id = "local";
  readonly label = "このコンピュータ";
  private readonly files = new Map<string, FileHandleLike>();
  private readonly folders = new Map<string, DirHandleLike>();
  private seq = 0;

  constructor(
    private readonly api: FsApi,
    private readonly store: HandleStore,
  ) {}

  async pickFolder(): Promise<FolderRef | null> {
    let dir: DirHandleLike;
    try {
      dir = await this.api.showDirectoryPicker({ mode: "readwrite", id: "modelith" });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    await this.store.set(RECENT_KEY, dir);
    return this.addFolder(dir);
  }

  async recentFolder(): Promise<string | null> {
    return (await this.store.get(RECENT_KEY))?.name ?? null;
  }

  async reopenRecent(): Promise<FolderRef | null> {
    const dir = await this.store.get(RECENT_KEY);
    if (!dir) return null;
    const ok = (await dir.queryPermission?.({ mode: "readwrite" })) === "granted" || (await dir.requestPermission?.({ mode: "readwrite" })) === "granted";
    return ok ? this.addFolder(dir) : null;
  }

  async list(folder: FolderRef): Promise<DirEntry[]> {
    return this.walk(this.folderHandle(folder), folder.id, "");
  }

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

  async saveAs(suggestedName: string, text: string): Promise<{ ref: FileRef; version: string } | null> {
    let fh: FileHandleLike;
    try {
      fh = await this.api.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    await writeText(fh, text);
    return { ref: this.addFile(fh, `file:${++this.seq}`, fh.name), version: versionOf(await fh.getFile()) };
  }

  async read(ref: FileRef): Promise<FileContent> {
    const f = await this.fileHandle(ref).getFile();
    return { text: await f.text(), version: versionOf(f) };
  }

  async write(ref: FileRef, text: string, expectedVersion: string | null): Promise<string> {
    const fh = this.fileHandle(ref);
    if (expectedVersion !== null && versionOf(await fh.getFile()) !== expectedVersion) throw new ConflictError(ref);
    await writeText(fh, text);
    return versionOf(await fh.getFile());
  }

  hasSiblings(ref: FileRef): boolean {
    return this.parentOf(ref) !== null;
  }

  async readSibling(ref: FileRef, name: string): Promise<string | null> {
    const dir = await this.parentDir(ref);
    if (!(await exists(dir, name))) return null;
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }

  async writeSibling(ref: FileRef, name: string, text: string): Promise<void> {
    const dir = await this.parentDir(ref);
    await writeText(await dir.getFileHandle(name, { create: true }), text);
  }

  /** フォルダから開いたファイルなら、そのフォルダ（id）と、ファイルのある階層までのパス。 */
  private parentOf(ref: FileRef): { folder: DirHandleLike; segs: string[] } | null {
    if (ref.provider !== this.id) return null;
    const slash = ref.id.indexOf("/");
    const folder = slash > 0 ? this.folders.get(ref.id.slice(0, slash)) : undefined;
    if (!folder) return null;
    return { folder, segs: ref.path.split("/").slice(0, -1) };
  }

  private async parentDir(ref: FileRef): Promise<DirHandleLike> {
    const p = this.parentOf(ref);
    if (!p) throw new Error(`「${ref.name}」の隣のファイルは扱えません（フォルダを開いてください）`);
    let dir = p.folder;
    for (const s of p.segs) dir = await dir.getDirectoryHandle(s);
    return dir;
  }

  private addFolder(dir: DirHandleLike): FolderRef {
    const id = `dir:${++this.seq}`;
    this.folders.set(id, dir);
    return { provider: this.id, id, name: dir.name };
  }

  private addFile(fh: FileHandleLike, id: string, path: string): FileRef {
    this.files.set(id, fh);
    return { provider: this.id, id, name: fh.name, path };
  }

  private folderHandle(folder: FolderRef): DirHandleLike {
    const dir = this.folders.get(folder.id);
    if (!dir) throw new Error(`フォルダ「${folder.name}」は開かれていません`);
    return dir;
  }

  private fileHandle(ref: FileRef): FileHandleLike {
    const fh = this.files.get(ref.id);
    if (!fh) throw new Error(`ファイル「${ref.path}」は開かれていません`);
    return fh;
  }

  /** モデルのファイルを含むフォルダだけを、フォルダ → ファイルの順・名前順で返す。 */
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

const nameOf = (e: DirEntry): string => (e.kind === "dir" ? e.name : e.ref.name);

async function exists(dir: DirHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function writeText(fh: FileHandleLike, text: string): Promise<void> {
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
