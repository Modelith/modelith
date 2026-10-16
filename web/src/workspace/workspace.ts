// ワークスペース：開いているファイル（文書）と未保存の変更、保存・競合・外部での変更・下書きを受け持つ（ADR-0010）。
// プロバイダのインタフェースにだけ依存し、DOM やブラウザの API を知らない。

import {
  ConflictError,
  hasSiblingFiles,
  isReadable,
  isWritable,
  type DirEntry,
  type FileLocator,
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
  /** 図の配置（配置ファイルの文字列。空なら配置なし）。テキストとは別に持つ（ADR-0005）。 */
  layout: string;
  /** 最後に保存した（読み込んだ）配置。 */
  savedLayout: string;
  /** 配置の保存先。sibling は隣の配置ファイル、none は保存先が無い（ファイルを 1 つだけ開いた・無題）。 */
  layoutHome: "sibling" | "none";
}

/** 無題の文書の下書き。 */
export interface Draft {
  name: string;
  text: string;
  /** 配置（無ければ空）。 */
  layout?: string;
}

/** 下書きの保存先（ブラウザでは localStorage）。 */
export interface DraftStore {
  load(): Draft[];
  save(drafts: Draft[]): void;
}

export type SaveOutcome = "saved" | "conflict" | "cancelled";

/** 1 つだけ開いたファイルのフォルダを開いた結果。notInFolder は、選んだフォルダにそのファイルが無かった。 */
export type AttachOutcome = "attached" | "notInFolder" | "cancelled";

export interface OpenFolder {
  source: FolderSource;
  ref: FolderRef;
  entries: DirEntry[];
}

/**
 * 2 つのファイルの参照が同じファイルを指すか（プロバイダと id で比べる）。
 *
 * @param a 文書の参照（無題の文書なら null）
 * @param b 比べる参照
 * @returns 同じファイルなら true。a が null なら false
 * @example
 * sameRef({ provider: "local", id: "dir:1/a.sysml", … }, { provider: "local", id: "dir:1/a.sysml", … }) // → true
 * sameRef(null, ref)                                                                                // → false（無題）
 */
const sameRef = (a: FileRef | null, b: FileRef): boolean => !!a && a.provider === b.provider && a.id === b.id;

export class Workspace {
  private readonly docs: Doc[] = [];
  private activeKey: string | null = null;
  private folderState: OpenFolder | null = null;
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  /**
   * 空のワークスペースを作る（下書きは restoreDrafts で戻す）。
   *
   * @param providers 使うファイルのプロバイダ
   * @param drafts 無題の文書の下書きの保存先
   */
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly drafts: DraftStore,
  ) {}

  /* ---- 変更の通知（UI はこれを購読して描き直す） ---- */

  /**
   * 変更の通知を購読する（UI はこれで描き直す）。
   *
   * @param fn 文書・フォルダ・未保存の印などが変わったときに呼ぶ関数
   * @returns 購読をやめる関数
   * @example
   * const off = ws.subscribe(render) // → off() で購読をやめる
   * off()                             // → 以後 render は呼ばれない
   */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 購読しているすべての関数を呼び、変更を知らせる。 */
  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /* ---- 文書 ---- */

  /**
   * 開いている文書を、開いた順に返す。
   *
   * @returns 文書の一覧（ワークスペースが持つ配列そのもの。書き換えないこと）。無ければ空
   * @example
   * ws.list().map((d) => d.name) // → ["a.sysml", "b.sysml"]
   * new Workspace(providers, drafts).list() // → []
   */
  list(): readonly Doc[] {
    return this.docs;
  }

  /**
   * 文書をキーで引く。
   *
   * @param key 文書のキー（`doc:番号`）
   * @returns 文書。無ければ（閉じた後など）undefined
   * @example
   * ws.get(doc.key)  // → doc
   * ws.get("doc:99") // → undefined
   */
  get(key: string): Doc | undefined {
    return this.docs.find((d) => d.key === key);
  }

  /**
   * 表示中の文書を返す。
   *
   * @returns 表示中の文書。無ければ null
   * @example
   * ws.active() // → 最後に開いた・切り替えた文書
   * ws.active() // → null（すべて閉じた後）
   */
  active(): Doc | null {
    return (this.activeKey && this.get(this.activeKey)) || null;
  }

  /**
   * 表示中の文書を切り替え、変更を知らせる。key の文書が無ければ何もしない。
   *
   * @param key 文書のキー
   */
  activate(key: string): void {
    if (!this.get(key)) return;
    this.activeKey = key;
    this.changed();
  }

  /**
   * 保存すれば保存先に書ける変更があるか（テキスト、または保存先のある配置）。
   *
   * @param doc 文書
   * @returns テキストが保存した内容と違うか、配置の保存先（sibling）があって配置が違えば true
   * @example
   * ws.isDirty(doc) // → false（開いたまま）
   * // ws.setText(doc.key, "edited") の後なら → true
   * // 保存先の無い（none）配置だけを変えたなら → false（layoutUnsaved が true）
   */
  isDirty(doc: Doc): boolean {
    return doc.text !== doc.savedText || (doc.layoutHome === "sibling" && doc.layout !== doc.savedLayout);
  }

  /**
   * 配置を変えたが、配置の保存先が無いか（F-VIEW-6）。
   *
   * @param doc 文書
   * @returns 配置の保存先が無く（none）、配置が保存した（開いた）ときと違えば true
   * @example
   * // 1 つだけ選んで開いた文書で ws.setLayout(doc.key, "L") の後
   * ws.layoutUnsaved(doc) // → true
   * // フォルダから開いた文書（sibling）なら → false
   */
  layoutUnsaved(doc: Doc): boolean {
    return doc.layoutHome === "none" && doc.layout !== doc.savedLayout;
  }

  /**
   * 保存先に上書きできる文書か（自動保存の対象、F-FILE-6）。
   *
   * @param doc 文書
   * @returns 保存先があり、そのプロバイダが上書きできれば true
   * @example
   * ws.canWriteInPlace(localDoc)    // → true（このコンピュータのファイル）
   * ws.canWriteInPlace(untitledDoc) // → false（保存先が無い）
   * ws.canWriteInPlace(browserDoc)  // → false（ダウンロードしかできない）
   */
  canWriteInPlace(doc: Doc): boolean {
    const p = doc.ref && this.providers.get(doc.ref.provider);
    return !!p && isWritable(p);
  }

  /**
   * ページを離れると失われる変更があるか（無題の文書は下書きに残るので数えない。保存先の無い配置は数える）。
   *
   * @returns 保存先のある文書のどれかに、未保存のテキストか配置があれば true
   * @example
   * ws.hasUnsavedFiles() // → true（フォルダから開いた文書を編集したとき）
   * ws.hasUnsavedFiles() // → false（無題の文書だけを編集したとき）
   */
  hasUnsavedFiles(): boolean {
    return this.docs.some((d) => d.ref && (this.isDirty(d) || this.layoutUnsaved(d)));
  }

  /**
   * 前回の下書きから無題の文書を戻す（F-FILE-11）。戻したら変更を知らせる。
   *
   * @returns 戻した文書の数。下書きが無ければ 0
   * @example
   * ws.restoreDrafts() // → 1（前回、無題の文書を 1 つ残したとき）
   * ws.restoreDrafts() // → 0（下書きが無い・壊れている）
   */
  restoreDrafts(): number {
    const ds = this.drafts.load();
    for (const d of ds) this.add({ ref: null, name: d.name, text: d.text, savedText: d.text, version: null, ...this.noLayoutHome(d.layout ?? "") });
    if (ds.length) this.changed();
    return ds.length;
  }

  /**
   * 無題の文書を作って表示中にする。下書きにも残し、変更を知らせる。
   *
   * @param name 文書の名前（保存するときの名前の候補）
   * @param text 初めのテキスト（保存した内容としても扱う）
   * @param layout 初めの配置（配置ファイルの文字列。既定は空）
   * @returns 作った文書（key は `doc:番号`）
   * @example
   * ws.newUntitled("untitled", "package U;") // → { key: "doc:1", ref: null, name: "untitled", text: "package U;", layoutHome: "none", … }
   */
  newUntitled(name: string, text: string, layout = ""): Doc {
    const doc = this.add({ ref: null, name, text, savedText: text, version: null, ...this.noLayoutHome(layout) });
    this.activeKey = doc.key;
    this.persistDrafts();
    this.changed();
    return doc;
  }

  /**
   * ファイルを開いて表示中にする（開いていれば、読み直さずにそれに切り替える）。隣の配置ファイルがあれば一緒に読む。
   *
   * @param ref 開くファイルの参照
   * @returns 開いた（切り替えた）文書。読めるプロバイダが無い・読めないときは例外を投げる
   * @example
   * await ws.openRef(ref)  // → { ref, name: "a.sysml", text: "package A;", … }
   * await ws.openRef(ref)  // → 同じ文書（2 回目。未保存の変更も残る）
   */
  async openRef(ref: FileRef): Promise<Doc> {
    const open = this.docs.find((d) => sameRef(d.ref, ref));
    if (open) {
      this.activate(open.key);
      return open;
    }
    const { text, version } = await this.readable(ref).read(ref);
    const doc = this.add({ ref, name: ref.name, text, savedText: text, version, ...(await this.readLayout(ref)) });
    this.activeKey = doc.key;
    this.changed();
    return doc;
  }

  /**
   * ファイルを選んで開く。
   *
   * @param picker ファイルを選べるプロバイダ
   * @returns 開いた文書。選ばなければ null
   * @example
   * await ws.openWith(browser) // → 選んだファイルの文書
   * await ws.openWith(browser) // → null（キャンセル）
   */
  async openWith(picker: FilePicker): Promise<Doc | null> {
    const ref = await picker.pickFile();
    return ref ? this.openRef(ref) : null;
  }

  /**
   * 文書のテキストを変える。無題の文書なら下書きにも残し、未保存の印が変われば変更を知らせる。
   *
   * @param key 文書のキー
   * @param text 新しいテキスト
   */
  setText(key: string, text: string): void {
    this.update(key, (doc) => (doc.text = text));
  }

  /**
   * 配置を変える。無題の文書なら下書きにも残し、未保存の印が変われば変更を知らせる。
   *
   * @param key 文書のキー
   * @param layout 新しい配置（配置ファイルの文字列）
   */
  setLayout(key: string, layout: string): void {
    this.update(key, (doc) => (doc.layout = layout));
  }

  /**
   * 開いたときの配置を決める（古い @layout コメントから読んだ配置など）。保存済みとして扱い、変更の印は付けない。
   * key の文書が無ければ何もしない。
   *
   * @param key 文書のキー
   * @param layout 配置（配置ファイルの文字列）
   */
  initLayout(key: string, layout: string): void {
    const doc = this.get(key);
    if (!doc) return;
    doc.layout = doc.savedLayout = layout;
  }

  /**
   * 古い形式の配置を配置ファイルに移す（ADR-0005 の移行）。テキストからコメントを消し、
   * 配置はまだ配置ファイルに無いものとして扱う（次の保存で、テキストと配置ファイルを一緒に書く）。
   *
   * @param key 文書のキー
   * @param textWithoutComment `@layout` コメントを消したテキスト
   */
  moveLegacyLayout(key: string, textWithoutComment: string): void {
    this.update(key, (doc) => {
      doc.text = textWithoutComment;
      doc.savedLayout = "";
    });
  }

  /**
   * 保存する。上書きできる保存先があれば版を比べて上書きし（force なら比べない）、
   * 無ければ saveAs で保存先を選ばせる。配置だけを変えたときは配置ファイルだけを書く（C-6）。
   *
   * @param key 文書のキー
   * @param saveAs 上書きできないときに保存先を選ばせる先（ダイアログ・ダウンロード）
   * @param opts `force: true` なら、他で変更されていても版を比べずに上書きする
   * @returns "saved"（保存した）・"conflict"（読んだ後に他で変更されていた。文書に stale の印を付ける）・
   *   "cancelled"（文書が無い・保存先を選ばなかった）。ConflictError 以外の失敗はそのまま投げる
   * @example
   * await ws.save(doc.key, browser)                    // → "saved"
   * await ws.save(doc.key, browser)                    // → "conflict"（他のアプリで書き換えられていた）
   * await ws.save(doc.key, browser, { force: true })   // → "saved"（強制上書き）
   */
  async save(key: string, saveAs: SaveAsTarget, opts: { force?: boolean } = {}): Promise<SaveOutcome> {
    const doc = this.get(key);
    if (!doc) return "cancelled";
    const p = doc.ref && this.providers.get(doc.ref.provider);
    if (!doc.ref || !p || !isWritable(p)) return this.saveAs(key, saveAs);
    // 配置だけを変えたときは、テキストのファイルに触らない（C-6）
    if (doc.text !== doc.savedText || opts.force) {
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
    }
    await this.writeLayout(doc);
    this.changed();
    return "saved";
  }

  /**
   * 保存先を選んで保存し、以後はその保存先の文書にする。配置があれば隣の配置ファイルにも書く。
   *
   * @param key 文書のキー
   * @param target 保存先を選ばせる先
   * @returns 保存したら "saved"。文書が無い・保存先を選ばなかったら "cancelled"
   * @example
   * await ws.saveAs(doc.key, browser) // → "saved"（model.sysml としてダウンロード）
   * await ws.saveAs(doc.key, picker)  // → "cancelled"（キャンセル）
   */
  async saveAs(key: string, target: SaveAsTarget): Promise<SaveOutcome> {
    const doc = this.get(key);
    if (!doc) return "cancelled";
    const r = await target.saveAs(doc.ref?.name ?? suggestName(doc.name), doc.text);
    if (!r) return "cancelled";
    await this.moveTo(doc, r.ref, r.version);
    return "saved";
  }

  /**
   * 開いているフォルダの中に、path（フォルダからの相対パス）という名前で保存し、以後はそのファイルの文書にする。
   * 配置も隣の配置ファイルに一緒に書く（ADR-0005）。同じ名前のファイルがあれば失敗する（例外を投げ、無題のまま）。
   * フォルダが開かれていなければ例外を投げる。key の文書が無ければ何もしない。
   *
   * @param key 文書のキー
   * @param path フォルダからの相対パス（`models/u.sysml` など）
   */
  async saveToFolder(key: string, path: string): Promise<void> {
    const doc = this.get(key);
    const f = this.folderState;
    if (!doc) return;
    if (!f) throw new Error("フォルダが開かれていません");
    const ref = await f.source.createFile(f.ref, path, doc.text);
    const { version } = await this.readable(ref).read(ref);
    f.entries = await f.source.list(f.ref);
    await this.moveTo(doc, ref, version);
  }

  /**
   * 1 つだけ開いたファイルについて、そのファイルのあるフォルダを選んでもらって開き、
   * 以後はフォルダの中のファイルとして扱う（隣の配置ファイルに保存できるようになる、F-VIEW-6）。書き込みは save で行う。
   *
   * @param key 文書のキー
   * @param source フォルダを選べて、その中からファイルを探せるプロバイダ
   * @returns "attached"（フォルダの中のファイルにした）・"notInFolder"（選んだフォルダにそのファイルが無い。フォルダは開く）・
   *   "cancelled"（文書が無い・無題・フォルダを選ばなかった）
   * @example
   * await ws.attachToFolder(doc.key, local) // → "attached"
   * await ws.attachToFolder(doc.key, local) // → "notInFolder"（別のフォルダを選んだ）
   */
  async attachToFolder(key: string, source: FolderSource & FileLocator): Promise<AttachOutcome> {
    const doc = this.get(key);
    if (!doc?.ref) return "cancelled";
    const folder = await source.pickFolder(doc.ref);
    if (!(await this.setFolder(source, folder)) || !folder) return "cancelled";
    const ref = await source.locate(folder, doc.ref);
    if (!ref) return "notInFolder";
    doc.ref = ref;
    doc.layoutHome = "sibling";
    this.changed();
    return "attached";
  }

  /**
   * 未保存の変更を捨てて、保存先の内容（テキストと配置）を読み直し、変更を知らせる。無題の文書なら何もしない。
   *
   * @param key 文書のキー
   */
  async reload(key: string): Promise<void> {
    const doc = this.get(key);
    if (!doc?.ref) return;
    const { text, version } = await this.readable(doc.ref).read(doc.ref);
    Object.assign(doc, { text, savedText: text, version, stale: false, ...(await this.readLayout(doc.ref)) });
    this.changed();
  }

  /**
   * 文書を閉じる。閉じたのが表示中なら隣の文書（後ろ、無ければ前）に切り替え、最後の 1 つなら表示中を無くす。
   * 無題の文書なら下書きからも消す。key の文書が無ければ何もしない。
   *
   * @param key 文書のキー
   */
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
   * あれば読み直さずに stale にする。上書きできない保存先と、読めないファイルは確かめない。
   *
   * @returns 読み直した文書の key の一覧。変更が無ければ空
   * @example
   * await ws.checkExternal() // → [a.key]（a は変更なし、b は未保存の変更ありで stale になった）
   * await ws.checkExternal() // → []（他で変更されていない）
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
        Object.assign(doc, { text: cur.text, savedText: cur.text, version: cur.version, stale: false, ...(await this.readLayout(doc.ref)) });
        reloaded.push(doc.key);
      }
    }
    if (any) this.changed();
    return reloaded;
  }

  /* ---- フォルダ ---- */

  /**
   * 開いているフォルダを返す。
   *
   * @returns フォルダと、そのプロバイダ・中身の一覧。開いていなければ null
   * @example
   * ws.folder()?.ref.name // → "project"
   * ws.folder()           // → null（まだ開いていない）
   */
  folder(): OpenFolder | null {
    return this.folderState;
  }

  /**
   * フォルダを選んで開き、中身を一覧する。
   *
   * @param source フォルダを選べるプロバイダ
   * @returns 開いたら true。選ばなければ false（何も変えない）
   * @example
   * await ws.openFolder(local) // → true
   * await ws.openFolder(local) // → false（キャンセル）
   */
  async openFolder(source: FolderSource): Promise<boolean> {
    return this.setFolder(source, await source.pickFolder());
  }

  /**
   * 前回のフォルダを開き直し、中身を一覧する（利用者の操作から呼ぶ）。
   *
   * @param source 前回のフォルダを覚えているプロバイダ
   * @returns 開いたら true。覚えていない・許可されなければ false
   * @example
   * await ws.reopenFolder(local) // → true
   * await ws.reopenFolder(local) // → false（許可されなかった）
   */
  async reopenFolder(source: FolderSource & RecentFolders): Promise<boolean> {
    return this.setFolder(source, await source.reopenRecent());
  }

  /** 開いているフォルダの中身を一覧し直し、変更を知らせる。フォルダが開かれていなければ何もしない。 */
  async refreshFolder(): Promise<void> {
    const f = this.folderState;
    if (!f) return;
    f.entries = await f.source.list(f.ref);
    this.changed();
  }

  /**
   * 開いているフォルダにファイルを作り、一覧し直して開く。
   *
   * @param path フォルダからの相対パス
   * @param text 初めのテキスト
   * @returns 開いた文書。フォルダが開かれていない・同じ名前のファイルがあるときは例外を投げる
   * @example
   * await ws.createFile("new.sysml", "package N;") // → { ref: { path: "new.sysml", … }, text: "package N;", … }
   * await ws.createFile("a.sysml", "")             // → Error「「a.sysml」は既にあります」（あるとき）
   */
  async createFile(path: string, text: string): Promise<Doc> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    const ref = await f.source.createFile(f.ref, path, text);
    f.entries = await f.source.list(f.ref);
    return this.openRef(ref);
  }

  /**
   * フォルダを開いているフォルダにし、中身を一覧して変更を知らせる。
   *
   * @param source フォルダのプロバイダ
   * @param ref 開くフォルダ。null（選ばなかった）なら何も変えない
   * @returns 開いたら true。ref が null なら false
   * @example
   * await this.setFolder(local, folder) // → true
   * await this.setFolder(local, null)   // → false
   */
  private async setFolder(source: FolderSource, ref: FolderRef | null): Promise<boolean> {
    if (!ref) return false;
    this.folderState = { source, ref, entries: await source.list(ref) };
    this.changed();
    return true;
  }

  /* ---- 内部 ---- */

  /**
   * 文書を書き換える。テキストか配置が変わったら、無題の文書なら下書きに残し、未保存の印が変われば変更を知らせる。
   * key の文書が無ければ何もしない。
   *
   * @param key 文書のキー
   * @param fn 文書を書き換える関数
   */
  private update(key: string, fn: (doc: Doc) => void): void {
    const doc = this.get(key);
    if (!doc) return;
    const before = { text: doc.text, layout: doc.layout, dirty: this.isDirty(doc), unsaved: this.layoutUnsaved(doc) };
    fn(doc);
    if (doc.text === before.text && doc.layout === before.layout) return;
    if (!doc.ref) this.persistDrafts();
    if (before.dirty !== this.isDirty(doc) || before.unsaved !== this.layoutUnsaved(doc)) this.changed();
  }

  /**
   * 文書を新しい保存先（保存したばかりのファイル）に移す。新しい保存先には配置がまだ無いので、配置があれば書く。
   * 無題だった文書は下書きから消す。
   *
   * @param doc 文書
   * @param ref 新しい保存先
   * @param version 保存したファイルの版
   */
  private async moveTo(doc: Doc, ref: FileRef, version: string): Promise<void> {
    const wasUntitled = !doc.ref;
    Object.assign(doc, { ref, name: ref.name, savedText: doc.text, version, stale: false });
    doc.layoutHome = this.siblingsOf(ref) ? "sibling" : "none";
    if (doc.layout) await this.writeLayout(doc, true);
    if (wasUntitled) this.persistDrafts();
    this.changed();
  }

  /**
   * 隣の配置ファイルを扱えるプロバイダを返す。
   *
   * @param ref ファイルの参照
   * @returns ref の隣を扱えるプロバイダ。扱えなければ（1 つだけ開いたファイルなど）null
   * @example
   * this.siblingsOf(fromFolder) // → LocalFolderProvider
   * this.siblingsOf(picked)     // → null（1 つだけ選んで開いた）
   */
  private siblingsOf(ref: FileRef) {
    const p = this.providers.get(ref.provider);
    return p && hasSiblingFiles(p) && p.hasSiblings(ref) ? p : null;
  }

  /**
   * 開いたファイルの配置を、隣の配置ファイル（`名前.layout.json`）から読む。
   *
   * @param ref 開いたファイルの参照
   * @returns 配置と配置の保存先。隣を扱えなければ空の配置と "none"、隣に配置ファイルが無ければ空の配置と "sibling"
   * @example
   * await this.readLayout(fromFolder) // → { layout: "L", savedLayout: "L", layoutHome: "sibling" }
   * await this.readLayout(picked)     // → { layout: "", savedLayout: "", layoutHome: "none" }
   */
  private async readLayout(ref: FileRef): Promise<Pick<Doc, "layout" | "savedLayout" | "layoutHome">> {
    const p = this.siblingsOf(ref);
    if (!p) return this.noLayoutHome("");
    const layout = (await p.readSibling(ref, layoutNameFor(ref.name))) ?? "";
    return { layout, savedLayout: layout, layoutHome: "sibling" };
  }

  /**
   * 保存先のある配置を、変わっていれば（force なら変わっていなくても）隣の配置ファイルに書く。
   * 隣を扱えない文書なら何もしない。
   *
   * @param doc 文書
   * @param force true なら、配置が変わっていなくても書く（新しい保存先に移したとき）
   */
  private async writeLayout(doc: Doc, force = false): Promise<void> {
    const p = doc.ref && this.siblingsOf(doc.ref);
    if (!doc.ref || !p || (!force && doc.layout === doc.savedLayout)) return;
    await p.writeSibling(doc.ref, layoutNameFor(doc.ref.name), doc.layout);
    doc.savedLayout = doc.layout;
  }

  /**
   * 配置の保存先が無い文書の、配置の初めの値を作る。
   *
   * @param layout 配置（配置ファイルの文字列）
   * @returns 保存済みとして扱う配置と、保存先 "none"
   * @example
   * this.noLayoutHome("") // → { layout: "", savedLayout: "", layoutHome: "none" }
   */
  private noLayoutHome(layout: string): Pick<Doc, "layout" | "savedLayout" | "layoutHome"> {
    return { layout, savedLayout: layout, layoutHome: "none" };
  }

  /**
   * 文書に新しいキーを付けて一覧の最後に加える（変更は知らせない）。
   *
   * @param init key と stale を除いた文書の中身
   * @returns 加えた文書（key は `doc:番号`、stale は false）
   * @example
   * this.add({ ref: null, name: "u", text: "", savedText: "", version: null, layout: "", savedLayout: "", layoutHome: "none" })
   * // → { key: "doc:1", stale: false, … }
   */
  private add(init: Omit<Doc, "key" | "stale">): Doc {
    const doc: Doc = { key: `doc:${++this.seq}`, stale: false, ...init };
    this.docs.push(doc);
    return doc;
  }

  /**
   * ファイルを読めるプロバイダを引く。
   *
   * @param ref ファイルの参照
   * @returns 読めるプロバイダ。無ければ例外（Error「「名前」を読めるストレージがありません」）を投げる
   * @example
   * this.readable(localRef)                                // → LocalFolderProvider
   * this.readable({ provider: "nope", name: "a.sysml", … }) // → Error「「a.sysml」を読めるストレージがありません」を投げる
   */
  private readable(ref: FileRef) {
    const p = this.providers.get(ref.provider);
    if (!p || !isReadable(p)) throw new Error(`「${ref.name}」を読めるストレージがありません`);
    return p;
  }

  /** 無題の文書すべてを下書きの保存先に書く（配置があれば一緒に）。 */
  private persistDrafts(): void {
    this.drafts.save(this.docs.filter((d) => !d.ref).map((d) => ({ name: d.name, text: d.text, ...(d.layout ? { layout: d.layout } : {}) })));
  }
}

/**
 * モデルのファイル名に対応する配置ファイルの名前（ADR-0005）。
 *
 * @param fileName モデルのファイル名（拡張子を含む）
 * @returns 拡張子 .sysml・.kerml（大文字・小文字は区別しない）を `.layout.json` に替えた名前。ほかの拡張子なら後ろに足す
 * @example
 * layoutNameFor("model.sysml") // → "model.layout.json"
 * layoutNameFor("M.KERML")     // → "M.layout.json"
 * layoutNameFor("notes.txt")   // → "notes.txt.layout.json"
 */
export const layoutNameFor = (fileName: string): string => `${fileName.replace(/\.(sysml|kerml)$/i, "")}.layout.json`;

/**
 * 無題の文書の保存名を作る。拡張子が無ければ、ファイル名に使えない文字を `_` にして .sysml を付ける。
 *
 * @param name 文書の名前
 * @returns 保存名。拡張子 .sysml・.kerml（大文字・小文字は区別しない）があれば name のまま
 * @example
 * suggestName("model")   // → "model.sysml"
 * suggestName("b.KERML") // → "b.KERML"
 * suggestName("x/y:z")   // → "x_y_z.sysml"（使えない文字を置き換える）
 */
export const suggestName = (name: string): string => (/\.(sysml|kerml)$/i.test(name) ? name : `${name.replace(/[\\/:*?"<>|]/g, "_")}.sysml`);
