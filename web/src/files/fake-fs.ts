// テスト用の偽の File System Access API（メモリ上のフォルダとファイル）。
import type { DirHandleLike, FileHandleLike, FileLike, FsApi, HandleStore, PermissionState, WritableStreamLike } from "./local-folder";

let clock = 1000;

export class FakeFile implements FileHandleLike {
  readonly kind = "file";
  lastModified = ++clock;

  constructor(
    readonly name: string,
    public content = "",
  ) {}

  /** 他のアプリが書き換えたことにする。 */
  externalWrite(text: string): void {
    this.content = text;
    this.lastModified = ++clock;
  }

  async getFile(): Promise<FileLike> {
    const { content, lastModified } = this;
    return { text: async () => content, lastModified, size: new TextEncoder().encode(content).length };
  }

  async createWritable(): Promise<WritableStreamLike> {
    let buf = "";
    return {
      write: async (d: string) => {
        buf += d;
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

  constructor(readonly name: string) {}

  /** パス（a/b/c.sysml）でファイルを作る。 */
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

  async *values(): AsyncIterable<FakeFile | FakeDir> {
    yield* this.entries.values();
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    const e = this.entries.get(name);
    if (e instanceof FakeFile) return e;
    if (!opts?.create) throw new DOMException("not found", "NotFoundError");
    const f = new FakeFile(name);
    this.entries.set(name, f);
    return f;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    const e = this.entries.get(name);
    if (e instanceof FakeDir) return e;
    if (!opts?.create) throw new DOMException("not found", "NotFoundError");
    const d = new FakeDir(name);
    this.entries.set(name, d);
    return d;
  }

  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    this.permission = this.grantOnRequest;
    return this.permission;
  }
}

const abort = (): DOMException => new DOMException("cancelled", "AbortError");

/** ピッカーが返すものを決められる偽の API。null は利用者がキャンセルしたことを表す。 */
export class FakeFsApi implements FsApi {
  folder: FakeDir | null = null;
  openFile: FakeFile | null = null;
  saveTo: FakeFile | null = null;

  async showDirectoryPicker(): Promise<FakeDir> {
    if (!this.folder) throw abort();
    return this.folder;
  }

  async showOpenFilePicker(): Promise<FakeFile[]> {
    if (!this.openFile) throw abort();
    return [this.openFile];
  }

  async showSaveFilePicker(): Promise<FakeFile> {
    if (!this.saveTo) throw abort();
    return this.saveTo;
  }
}

export class MemoryHandleStore implements HandleStore {
  readonly map = new Map<string, DirHandleLike>();

  async get(key: string): Promise<DirHandleLike | undefined> {
    return this.map.get(key);
  }

  async set(key: string, value: DirHandleLike): Promise<void> {
    this.map.set(key, value);
  }
}
