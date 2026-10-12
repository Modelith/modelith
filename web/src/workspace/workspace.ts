// ワークスペース：開いているファイル（文書）と未保存の変更、保存・競合・外部での変更・下書きを受け持つ（ADR-0010）。
// プロバイダのインタフェースにだけ依存し、DOM やブラウザの API を知らない。

import {
  ConflictError,
  isReadable,
  isWritable,
  type DirEntry,
  type FilePicker,
  type FileRef,
  type FolderRef,
  type FolderSource,
  type ProviderRegistry,
  type RecentFolders,
  type SaveAsTarget,
} from "../files/types";

/** 開いている文書。ref が null なら保存先の無い「無題」の文書。 */
export interface Doc {
  readonly key: string;
  ref: FileRef | null;
  name: string;
  text: string;
  /** 最後に保存した（読み込んだ）内容。 */
  savedText: string;
  /** 最後に保存した（読み込んだ）版。 */
  version: string | null;
  /** 開いた後に他のアプリで変更された（未保存の変更があるため読み直していない）。 */
  stale: boolean;
}

/** 無題の文書の下書き。 */
export interface Draft {
  name: string;
  text: string;
}

/** 下書きの保存先（ブラウザでは localStorage）。 */
export interface DraftStore {
  load(): Draft[];
  save(drafts: Draft[]): void;
}

export type SaveOutcome = "saved" | "conflict" | "cancelled";

export interface OpenFolder {
  source: FolderSource;
  ref: FolderRef;
  entries: DirEntry[];
}

const sameRef = (a: FileRef | null, b: FileRef): boolean => !!a && a.provider === b.provider && a.id === b.id;

export class Workspace {
  private readonly docs: Doc[] = [];
  private activeKey: string | null = null;
  private folderState: OpenFolder | null = null;
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly drafts: DraftStore,
  ) {}

  /* ---- 変更の通知（UI はこれを購読して描き直す） ---- */

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /* ---- 文書 ---- */

  list(): readonly Doc[] {
    return this.docs;
  }

  get(key: string): Doc | undefined {
    return this.docs.find((d) => d.key === key);
  }

  active(): Doc | null {
    return (this.activeKey && this.get(this.activeKey)) || null;
  }

  activate(key: string): void {
    if (!this.get(key)) return;
    this.activeKey = key;
    this.changed();
  }

  isDirty(doc: Doc): boolean {
    return doc.text !== doc.savedText;
  }

  /** 保存先に上書きできる文書か（自動保存の対象）。 */
  canWriteInPlace(doc: Doc): boolean {
    const p = doc.ref && this.providers.get(doc.ref.provider);
    return !!p && isWritable(p);
  }

  /** ページを離れると失われる変更があるか（無題の文書は下書きに残るので数えない）。 */
  hasUnsavedFiles(): boolean {
    return this.docs.some((d) => d.ref && this.isDirty(d));
  }

  /** 前回の下書きから無題の文書を戻す。戻した数を返す。 */
  restoreDrafts(): number {
    const ds = this.drafts.load();
    for (const d of ds) this.add({ ref: null, name: d.name, text: d.text, savedText: d.text, version: null });
    if (ds.length) this.changed();
    return ds.length;
  }

  newUntitled(name: string, text: string): Doc {
    const doc = this.add({ ref: null, name, text, savedText: text, version: null });
    this.activeKey = doc.key;
    this.persistDrafts();
    this.changed();
    return doc;
  }

  /** ファイルを開く（開いていればそれに切り替える）。 */
  async openRef(ref: FileRef): Promise<Doc> {
    const open = this.docs.find((d) => sameRef(d.ref, ref));
    if (open) {
      this.activate(open.key);
      return open;
    }
    const { text, version } = await this.readable(ref).read(ref);
    const doc = this.add({ ref, name: ref.name, text, savedText: text, version });
    this.activeKey = doc.key;
    this.changed();
    return doc;
  }

  /** ファイルを選んで開く（選ばなければ null）。 */
  async openWith(picker: FilePicker): Promise<Doc | null> {
    const ref = await picker.pickFile();
    return ref ? this.openRef(ref) : null;
  }

  setText(key: string, text: string): void {
    const doc = this.get(key);
    if (!doc || doc.text === text) return;
    const wasDirty = this.isDirty(doc);
    doc.text = text;
    if (!doc.ref) this.persistDrafts();
    if (wasDirty !== this.isDirty(doc)) this.changed();
  }

  /**
   * 保存する。上書きできる保存先があれば版を比べて上書きし（force なら比べない）、
   * 無ければ saveAs で保存先を選ばせる。
   */
  async save(key: string, saveAs: SaveAsTarget, opts: { force?: boolean } = {}): Promise<SaveOutcome> {
    const doc = this.get(key);
    if (!doc) return "cancelled";
    const p = doc.ref && this.providers.get(doc.ref.provider);
    if (!doc.ref || !p || !isWritable(p)) return this.saveAs(key, saveAs);
    try {
      doc.version = await p.write(doc.ref, doc.text, opts.force ? null : doc.version);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      doc.stale = true;
      this.changed();
      return "conflict";
    }
    doc.savedText = doc.text;
    doc.stale = false;
    this.changed();
    return "saved";
  }

  /** 保存先を選んで保存し、以後はその保存先の文書にする。 */
  async saveAs(key: string, target: SaveAsTarget): Promise<SaveOutcome> {
    const doc = this.get(key);
    if (!doc) return "cancelled";
    const r = await target.saveAs(doc.ref?.name ?? suggestName(doc.name), doc.text);
    if (!r) return "cancelled";
    const wasUntitled = !doc.ref;
    Object.assign(doc, { ref: r.ref, name: r.ref.name, savedText: doc.text, version: r.version, stale: false });
    if (wasUntitled) this.persistDrafts();
    this.changed();
    return "saved";
  }

  /** 未保存の変更を捨てて、保存先の内容を読み直す。 */
  async reload(key: string): Promise<void> {
    const doc = this.get(key);
    if (!doc?.ref) return;
    const { text, version } = await this.readable(doc.ref).read(doc.ref);
    Object.assign(doc, { text, savedText: text, version, stale: false });
    this.changed();
  }

  /** 文書を閉じる。閉じたのが表示中なら隣の文書に切り替える。 */
  close(key: string): void {
    const i = this.docs.findIndex((d) => d.key === key);
    const doc = this.docs[i];
    if (!doc) return;
    this.docs.splice(i, 1);
    if (!doc.ref) this.persistDrafts();
    if (this.activeKey === key) this.activeKey = (this.docs[i] ?? this.docs[i - 1])?.key ?? null;
    this.changed();
  }

  /**
   * 他のアプリでの変更を確かめる（画面に戻ったときに呼ぶ）。未保存の変更が無ければ読み直し、
   * あれば読み直さずに stale にする。読み直した文書の key を返す。
   */
  async checkExternal(): Promise<string[]> {
    const reloaded: string[] = [];
    let any = false;
    for (const doc of this.docs) {
      const p = doc.ref && this.providers.get(doc.ref.provider);
      if (!doc.ref || !p || !isWritable(p) || !isReadable(p)) continue;
      let cur;
      try {
        cur = await p.read(doc.ref);
      } catch {
        continue; // 消えた・読めないファイルは、保存するときに知らせる
      }
      if (cur.version === doc.version) continue;
      any = true;
      if (this.isDirty(doc)) doc.stale = true;
      else {
        Object.assign(doc, { text: cur.text, savedText: cur.text, version: cur.version, stale: false });
        reloaded.push(doc.key);
      }
    }
    if (any) this.changed();
    return reloaded;
  }

  /* ---- フォルダ ---- */

  folder(): OpenFolder | null {
    return this.folderState;
  }

  /** フォルダを選んで開く（選ばなければ false）。 */
  async openFolder(source: FolderSource): Promise<boolean> {
    return this.setFolder(source, await source.pickFolder());
  }

  /** 前回のフォルダを開き直す（許可されなければ false）。 */
  async reopenFolder(source: FolderSource & RecentFolders): Promise<boolean> {
    return this.setFolder(source, await source.reopenRecent());
  }

  async refreshFolder(): Promise<void> {
    const f = this.folderState;
    if (!f) return;
    f.entries = await f.source.list(f.ref);
    this.changed();
  }

  /** 開いているフォルダにファイルを作って開く。 */
  async createFile(path: string, text: string): Promise<Doc> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    const ref = await f.source.createFile(f.ref, path, text);
    f.entries = await f.source.list(f.ref);
    return this.openRef(ref);
  }

  private async setFolder(source: FolderSource, ref: FolderRef | null): Promise<boolean> {
    if (!ref) return false;
    this.folderState = { source, ref, entries: await source.list(ref) };
    this.changed();
    return true;
  }

  /* ---- 内部 ---- */

  private add(init: Omit<Doc, "key" | "stale">): Doc {
    const doc: Doc = { key: `doc:${++this.seq}`, stale: false, ...init };
    this.docs.push(doc);
    return doc;
  }

  private readable(ref: FileRef) {
    const p = this.providers.get(ref.provider);
    if (!p || !isReadable(p)) throw new Error(`「${ref.name}」を読めるストレージがありません`);
    return p;
  }

  private persistDrafts(): void {
    this.drafts.save(this.docs.filter((d) => !d.ref).map((d) => ({ name: d.name, text: d.text })));
  }
}

/** 無題の文書の保存名（拡張子が無ければ .sysml を付ける）。 */
export const suggestName = (name: string): string => (/\.(sysml|kerml)$/i.test(name) ? name : `${name.replace(/[\\/:*?"<>|]/g, "_")}.sysml`);
