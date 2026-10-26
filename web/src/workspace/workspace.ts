// ワークスペース：開いているファイル（文書）と未保存の変更、保存・競合・外部での変更・下書きを受け持つ（ADR-0010）。
// プロバイダのインタフェースにだけ依存し、DOM やブラウザの API を知らない。

import {
  ConflictError,
  hasFolderEdits,
  hasFolderFiles,
  hasFolderTrees,
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
import { childPath, movedPath, parentPath } from "../files/entry-names";
import { modelFiles, projectTexts } from "./project-files";
import { findFile, hasContent, restoreOrder, sessionFrom, type Session, type SessionStore } from "./session";

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
  /** 最後に保存した（読み込んだ）配置ファイルの版。配置ファイルが無い・保存先が無ければ null。 */
  layoutVersion: string | null;
  /** 配置ファイルが開いた後に他のアプリで変更された（保存で競合した）。 */
  layoutStale: boolean;
  /** 仮に開いている（次に仮に開くファイルと置き換える。編集・ダブルクリックで開いたままにする。F-FILE-17）。 */
  preview?: boolean;
}

/** 無題の文書の下書き。 */
export interface Draft {
  name: string;
  text: string;
  /** 配置（無ければ空）。 */
  layout?: string;
}

/** 下書きの保存先に置く、前回の終わりの状態。 */
export interface DraftState {
  /** 無題の文書の下書き（中身の無いものは置かない）。 */
  drafts: Draft[];
  /** すべての文書を閉じて終えたか（F-FILE-14）。 */
  closedAll: boolean;
}

/** 下書きの保存先（ブラウザでは localStorage）。save は置けたかを返す（保存領域がいっぱいなら false。F-FILE-11）。 */
export interface DraftStore {
  load(): DraftState;
  save(state: DraftState): boolean;
}

/** 起動したときに表示するもの。drafts は戻した下書き、nothing は何も開かない（F-FILE-14）、sample はサンプル。 */
export type StartWith = "drafts" | "nothing" | "sample";

export type SaveOutcome = "saved" | "conflict" | "cancelled";

/** 1 つだけ開いたファイルのフォルダを開いた結果。notInFolder は、選んだフォルダにそのファイルが無かった。 */
export type AttachOutcome = "attached" | "notInFolder" | "cancelled";

export interface OpenFolder {
  source: FolderSource;
  ref: FolderRef;
  entries: DirEntry[];
  /** フォルダの一番上のプロジェクトの設定ファイル（modelith.json）のテキスト。無ければ null（ADR-0019）。 */
  projectText: string | null;
}

/** プロジェクトの設定ファイルの名前（フォルダの一番上に置く、ADR-0019 §1）。 */
export const PROJECT_FILE = "modelith.json";

/**
 * フォルダの一番上のプロジェクトの設定ファイルを読む。
 *
 * @param source フォルダのプロバイダ
 * @param ref 開いたフォルダ
 * @returns 設定ファイルのテキスト。無い・フォルダの中のファイルを読めないプロバイダなら null。読む途中の失敗はそのまま投げる
 * @example
 * await readProjectText(local, folder) // → '{ "name": "給水" }'
 * await readProjectText(local, empty)  // → null（modelith.json が無い）
 */
async function readProjectText(source: FolderSource, ref: FolderRef): Promise<string | null> {
  return hasFolderFiles(source) ? source.readInFolder(ref, PROJECT_FILE) : null;
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

/**
 * ファイルの参照を見分ける文字列（読み込み中のファイルを覚えるのに使う）。
 *
 * @param ref ファイルの参照
 * @returns プロバイダと id をつないだ文字列
 * @example
 * refKey({ provider: "local", id: "dir:1/a.sysml", … }) // → "local\u0000dir:1/a.sysml"
 */
const refKey = (ref: FileRef): string => `${ref.provider}\u0000${ref.id}`;

export class Workspace {
  private readonly docs: Doc[] = [];
  private activeKey: string | null = null;
  private folderState: OpenFolder | null = null;
  /** 開いているフォルダのモデルのファイルを、最後に読んだテキスト（パス → テキスト。ADR-0021）。 */
  private disk = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  /** 読み込み中のファイル（プロバイダと id → 読み終わる Promise）。同じファイルを二重に開かない。 */
  private readonly loading = new Map<string, Promise<void>>();
  private seq = 0;
  /** 前回の続きを書き換えずにおくか。起動して前回の続きを戻し終えるまでは書き換えない（F-FILE-13）。 */
  private sessionHeld = true;
  /** 最後に下書きを置こうとして置けなかったか（ブラウザの保存領域がいっぱい。F-FILE-11）。 */
  private draftsLost = false;

  /**
   * 空のワークスペースを作る（下書きは restoreDrafts で、前回の続きは resumeSession で戻す）。
   * 前回の続きは、holdSession(false) で書き始める。
   *
   * @param providers 使うファイルのプロバイダ
   * @param drafts 無題の文書の下書きの保存先
   * @param sessions 前回の続きの保存先（無ければ覚えない）
   */
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly drafts: DraftStore,
    private readonly sessions: SessionStore | null = null,
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

  /** 前回の続きを書き、購読しているすべての関数を呼び、変更を知らせる。 */
  private changed(): void {
    this.saveSession();
    for (const fn of this.listeners) fn();
  }

  /* ---- 前回の続き（F-FILE-13） ---- */

  /**
   * 今の状態を、前回の続きとして覚える形にする。
   *
   * @returns 開いているフォルダ・文書・表示中の文書
   * @example
   * ws.session() // → { folder: true, docs: [{ draft: 0 }, { path: "a.sysml" }], active: 1 }
   * new Workspace(providers, drafts).session() // → { folder: false, docs: [], active: null }
   */
  session(): Session {
    return sessionFrom(this.docs, this.activeKey, this.folderState?.entries ?? null);
  }

  /**
   * 前回の続きを書き換えずにおくか決める。起動して戻し終えるまでと、「前回の続きを開く」を待つ間は書き換えない。
   * 書き換えるようにしたら、すぐに今の状態を書く。
   *
   * @param hold 書き換えずにおくなら true
   */
  holdSession(hold: boolean): void {
    this.sessionHeld = hold;
    this.saveSession();
  }

  /** 書き換えずにおく間でなければ、今の状態を前回の続きとして書く。 */
  private saveSession(): void {
    if (!this.sessionHeld) this.sessions?.save(this.session());
  }

  /**
   * 前回の続きの文書を戻す（restoreDrafts の後、フォルダを開き直せたなら開き直した後に呼ぶ）。
   * 開いている無題の文書を下書きの順番として、前回の順番に並べ直し、フォルダの中のファイルを開き、表示していた文書を表示中にする。
   * 表示していた文書を戻せなければ、最初の文書を表示中にする。戻したら変更を知らせる。
   *
   * @param saved 前回の続き
   * @returns 開けなかったファイルのパス（消された・読めない）。無ければ空
   * @example
   * await ws.resumeSession({ folder: true, docs: [{ path: "a.sysml" }, { draft: 0 }], active: 0 }) // → []（a.sysml を表示中にする）
   * await ws.resumeSession({ folder: true, docs: [{ path: "gone.sysml" }], active: 0 })            // → ["gone.sysml"]
   */
  async resumeSession(saved: Session): Promise<string[]> {
    const untitled = this.docs.filter((d) => !d.ref);
    const f = this.folderState;
    const plan = restoreOrder(saved, untitled.length, !!f);
    const order: Doc[] = [];
    const missing: string[] = [];
    let active: string | null = null;
    for (const [i, item] of plan.items.entries()) {
      const doc = "draft" in item ? untitled[item.draft] : await this.loadInFolder(item.path);
      if (!doc) {
        if ("path" in item) missing.push(item.path);
        continue;
      }
      order.push(doc);
      if (i === plan.active) active = doc.key;
    }
    // 前回の続きの外で開いた文書は、後ろに残す
    for (const d of this.docs) if (!order.includes(d)) order.push(d);
    this.docs.splice(0, this.docs.length, ...order);
    this.activeKey = active ?? order[0]?.key ?? null;
    this.changed();
    return missing;
  }

  /**
   * 開いているフォルダの中のファイルを、パスで探して文書として加える（表示中にはしない・変更は知らせない）。
   *
   * @param path フォルダからの相対パス
   * @returns 加えた文書。フォルダを開いていない・ファイルが無い・読めないときは null
   * @example
   * await this.loadInFolder("a.sysml")    // → { ref: { path: "a.sysml", … }, text: "package A;", … }
   * await this.loadInFolder("gone.sysml") // → null
   */
  private async loadInFolder(path: string): Promise<Doc | null> {
    const ref = this.folderState && findFile(this.folderState.entries, path);
    if (!ref) return null;
    try {
      return await this.load(ref);
    } catch {
      return null; // 一覧の後に消された・読めない
    }
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
   * ページを離れると失われる変更があるか（無題の文書は下書きに残るので数えないが、下書きを置けていなければ数える。保存先の無い配置は数える）。
   *
   * @returns 保存先のある文書のどれかに未保存のテキストか配置があるか、下書きを置けずに中身のある無題の文書があれば true
   * @example
   * ws.hasUnsavedFiles() // → true（フォルダから開いた文書を編集したとき）
   * ws.hasUnsavedFiles() // → false（無題の文書だけを編集したとき）
   * ws.hasUnsavedFiles() // → true（無題の文書を編集したが、下書きを置けなかったとき）
   */
  hasUnsavedFiles(): boolean {
    return this.docs.some((d) => d.ref && (this.isDirty(d) || this.layoutUnsaved(d))) || (this.draftsLost && this.docs.some((d) => !d.ref && hasContent(d)));
  }

  /**
   * 下書きを置けていないか（最後に置こうとしたときに保存先に書けなかった。F-FILE-11）。置けるようになれば false に戻る。
   *
   * @returns 下書きを置けていなければ true
   * @example
   * ws.hasLostDrafts() // → false（まだ置いていない・置けた）
   * ws.hasLostDrafts() // → true（保存領域がいっぱいで置けなかった）
   */
  hasLostDrafts(): boolean {
    return this.draftsLost;
  }

  /**
   * 前回の下書きから無題の文書を戻し、起動したときに何を表示するかを決める（F-FILE-11・F-FILE-14）。
   * 中身の無い下書き（以前の版が残したもの）は戻さない。戻したら変更を知らせる。
   *
   * @returns 下書きを戻したら "drafts"。戻すものが無く、前回すべての文書を閉じて終えたなら "nothing"、それ以外は "sample"
   * @example
   * ws.restoreDrafts() // → "drafts"（前回、無題の文書を 1 つ残したとき）
   * ws.restoreDrafts() // → "nothing"（前回、すべて閉じて終えたとき）
   * ws.restoreDrafts() // → "sample"（初めて開いた・下書きが壊れている・中身の無い下書きしか無い）
   */
  restoreDrafts(): StartWith {
    const { drafts, closedAll } = this.drafts.load();
    const kept = drafts.filter(hasContent);
    for (const d of kept) this.add({ ref: null, name: d.name, text: d.text, savedText: d.text, version: null, ...this.noLayoutHome(d.layout ?? "") });
    if (!kept.length) return closedAll ? "nothing" : "sample";
    this.changed();
    return "drafts";
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
   * 仮に開くなら（F-FILE-17）、仮に開いていた変更の無いファイルを閉じ、その場所に置く。仮にでなく開くなら、仮に開いていたそのファイルも開いたままにする。
   *
   * @param ref 開くファイルの参照
   * @param opts preview：仮に開く（フォルダの一覧の 1 回クリック）
   * @returns 開いた（切り替えた）文書。読めるプロバイダが無い・読めないときは例外を投げる
   * @example
   * await ws.openRef(ref)  // → { ref, name: "a.sysml", text: "package A;", … }
   * await ws.openRef(ref)  // → 同じ文書（2 回目。未保存の変更も残る）
   * await ws.openRef(b, { preview: true }) // → b を仮に開く（仮に開いていた a は閉じ、b がその場所に入る）
   */
  async openRef(ref: FileRef, opts: { preview?: boolean } = {}): Promise<Doc> {
    // 読み込み中の同じファイル（続けて押した・ダブルクリック）は、読み込み終わるのを待って同じ文書にする
    const waiting = this.loading.get(refKey(ref));
    if (waiting) await waiting;
    const open = this.docs.find((d) => sameRef(d.ref, ref));
    if (open) {
      if (!opts.preview) delete open.preview;
      this.activate(open.key);
      return open;
    }
    const pending = this.load(ref);
    this.loading.set(refKey(ref), pending.then(() => undefined, () => undefined));
    let doc: Doc;
    try {
      doc = await pending;
    } finally {
      this.loading.delete(refKey(ref));
    }
    if (opts.preview) this.replacePreview(doc);
    this.activeKey = doc.key;
    // すべて閉じた後に開いたら、「すべて閉じて終えた」の記録を消す
    if (this.docs.length === 1) this.persistDrafts();
    this.changed();
    return doc;
  }

  /**
   * 仮に開いた文書を、開いたままにする（F-FILE-17。ダブルクリック）。key の文書が無い・仮に開いていなければ何もしない。
   *
   * @param key 文書のキー
   * @example
   * ws.pin(doc.key) // → doc.preview が消え、次に仮に開くファイルと置き換わらない
   */
  pin(key: string): void {
    const doc = this.get(key);
    if (!doc?.preview) return;
    delete doc.preview;
    this.changed();
  }

  /**
   * 開いた文書を仮に開いた文書にし、仮に開いていた変更の無い文書があれば閉じて、その場所に置く（F-FILE-17）。
   *
   * @param doc 開いたばかりの文書（一覧の最後にある）
   */
  private replacePreview(doc: Doc): void {
    doc.preview = true;
    const i = this.docs.findIndex((d) => d.preview && d !== doc && !this.isDirty(d));
    if (i < 0) return;
    this.docs.splice(this.docs.indexOf(doc), 1);
    this.docs.splice(i, 1, doc);
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
   * 配置ファイルも読んだときの版と比べ、他で変更されていれば書かない（F-FILE-7）。
   *
   * @param key 文書のキー
   * @param saveAs 上書きできないときに保存先を選ばせる先（ダイアログ・ダウンロード）
   * @param opts `force: true` なら、他で変更されていても版を比べずに上書きする（配置ファイルも）
   * @returns "saved"（保存した）・"conflict"（読んだ後に他で変更されていた。文書に stale（配置ファイルなら layoutStale）の印を付ける）・
   *   "cancelled"（文書が無い・保存先を選ばなかった）。ConflictError 以外の失敗はそのまま投げる
   * @example
   * await ws.save(doc.key, browser)                    // → "saved"
   * await ws.save(doc.key, browser)                    // → "conflict"（他のアプリで書き換えられていた）
   * await ws.save(doc.key, browser)                    // → "conflict"（配置ファイルが他のアプリで書き換えられていた）
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
      // 閉じた後も、保存した中身をモデルに入れる（ADR-0021）
      const path = this.folderPath(key);
      if (path) this.disk.set(path, doc.text);
    }
    try {
      await this.writeLayout(doc, { force: opts.force });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      doc.layoutStale = true;
      this.changed();
      return "conflict";
    }
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
    Object.assign(doc, { text, savedText: text, version, stale: false, layoutStale: false, ...(await this.readLayout(doc.ref)) });
    this.changed();
  }

  /**
   * 文書を閉じる。閉じたのが表示中なら隣の文書（後ろ、無ければ前）に切り替え、最後の 1 つなら表示中を無くす（新しい文書は作らない。F-FILE-14）。
   * 無題の文書なら下書きからも消す。最後の 1 つなら、すべて閉じたことを下書きの保存先に残す。key の文書が無ければ何もしない。
   *
   * @param key 文書のキー
   */
  close(key: string): void {
    const i = this.docs.findIndex((d) => d.key === key);
    const doc = this.docs[i];
    if (!doc) return;
    this.docs.splice(i, 1);
    if (!doc.ref || !this.docs.length) this.persistDrafts();
    if (this.activeKey === key) this.activeKey = (this.docs[i] ?? this.docs[i - 1])?.key ?? null;
    this.changed();
  }

  /**
   * 他のアプリでの変更を確かめる（画面に戻ったときに呼ぶ。F-FILE-8）。未保存の変更が無ければ読み直し、
   * あれば読み直さずに stale にする。上書きできない保存先と、読めないファイルは確かめない。
   *
   * @returns 読み直した文書の key の一覧（reloaded）と、今回初めて stale にした文書の key の一覧（stale。前から stale のものは入れない）
   * @example
   * await ws.checkExternal() // → { reloaded: [a.key], stale: [b.key] }（a は未保存の変更なしで読み直し、b は未保存の変更ありで stale になった）
   * await ws.checkExternal() // → { reloaded: [], stale: [] }（他で変更されていない。b は前から stale）
   */
  async checkExternal(): Promise<{ reloaded: string[]; stale: string[] }> {
    const reloaded: string[] = [];
    const stale: string[] = [];
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
      if (this.isDirty(doc)) {
        if (!doc.stale) stale.push(doc.key);
        doc.stale = true;
      } else {
        Object.assign(doc, { text: cur.text, savedText: cur.text, version: cur.version, stale: false, layoutStale: false, ...(await this.readLayout(doc.ref)) });
        reloaded.push(doc.key);
      }
    }
    // 開いていないファイルも、他のアプリで変わっていればモデルに入れ直す（ADR-0021 §3）
    if (await this.readModelFiles()) any = true;
    if (any) this.changed();
    return { reloaded, stale };
  }

  /**
   * 文書のファイルが、開いた（最後に読んだ・保存した）後に他のアプリで変わったかを確かめる（編集し始めたときに呼ぶ。F-FILE-18）。
   * 変わっていれば stale にして変更を知らせる。中身は読み直さない（読み直すかは呼び手が尋ねて reload する）。
   * 無題の文書・上書きできない保存先・読めないファイル・すでに stale の文書は確かめず false を返す。
   *
   * @param key 文書のキー
   * @returns 他のアプリで変わっていて、今回 stale にしたら true
   * @example
   * await ws.changedElsewhere(a.key) // → true（a.sysml が他のアプリで書き換えられていた。a は stale になる）
   * await ws.changedElsewhere(a.key) // → false（変わっていない、または前から stale）
   */
  async changedElsewhere(key: string): Promise<boolean> {
    const doc = this.get(key);
    const p = doc?.ref && this.providers.get(doc.ref.provider);
    if (!doc?.ref || doc.stale || !p || !isWritable(p) || !isReadable(p)) return false;
    let cur;
    try {
      cur = await p.read(doc.ref);
    } catch {
      return false; // 消えた・読めないファイルは、保存するときに知らせる
    }
    if (cur.version === doc.version || doc.stale) return false;
    doc.stale = true;
    this.changed();
    return true;
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
   * 開いているフォルダのモデルのファイルを、1 つのモデルとしてコアに渡すテキストにする（ADR-0021）。
   * 開いている文書は、保存していない変更も含めた今のテキストを使う。
   *
   * @returns フォルダからのパス → テキスト。フォルダを開いていなければ空
   * @example
   * ws.projectTexts() // → Map { "parts.sysml" → "package Parts { … }", "app.sysml" → "package App { … }"（編集中のテキスト） }
   * ws.projectTexts() // → Map {}（フォルダを開いていない）
   */
  projectTexts(): Map<string, string> {
    const f = this.folderState;
    return f ? projectTexts(modelFiles(f.entries), this.disk, this.docs) : new Map();
  }

  /**
   * 文書が、開いているフォルダの中のファイルなら、そのパスを返す（コアに表示中のファイルを伝えるのに使う）。
   *
   * @param key 文書のキー
   * @returns フォルダからのパス。無題・フォルダの外のファイル・文書が無ければ null
   * @example
   * ws.folderPath(doc.key) // → "models/app.sysml"
   * ws.folderPath(untitled.key) // → null
   */
  folderPath(key: string): string | null {
    const ref = this.get(key)?.ref;
    const f = this.folderState;
    if (!ref || !f) return null;
    return modelFiles(f.entries).some((r) => r.provider === ref.provider && r.id === ref.id) ? ref.path : null;
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
   * 前回のフォルダを開き直し、中身を一覧する（許可を求めるときは、利用者の操作から呼ぶ）。
   *
   * @param source 前回のフォルダを覚えているプロバイダ
   * @param opts `ask: false` なら許可を求めず、既に許可されているときだけ開く（起動したとき。F-FILE-13）
   * @returns 開いたら true。覚えていない・許可されなければ false。フォルダが消された・読めないときは例外を投げる
   * @example
   * await ws.reopenFolder(local)                 // → true
   * await ws.reopenFolder(local)                 // → false（許可されなかった）
   * await ws.reopenFolder(local, { ask: false }) // → false（許可を求めないと開けない）
   */
  async reopenFolder(source: FolderSource & RecentFolders, opts: { ask?: boolean } = {}): Promise<boolean> {
    return this.setFolder(source, await source.reopenRecent(opts));
  }

  /**
   * プロジェクトの一覧のフォルダを開き、中身を一覧する（F-PROJ-3）。今開いているフォルダと切り替わる。開いている文書は開いたまま残す。
   * 許可を求めることがあるので、利用者の操作から呼ぶ。
   *
   * @param source プロジェクトの一覧を覚えているプロバイダ
   * @param id 一覧の項目の名前
   * @returns 開いたら true。一覧に無い・許可されなければ false。フォルダが消された・読めないときは例外を投げる
   * @example
   * await ws.openRecentFolder(local, "2") // → true（ws.folder() が一覧の 2 のフォルダになる）
   * await ws.openRecentFolder(local, "9") // → false（一覧に無い）
   */
  async openRecentFolder(source: FolderSource & RecentFolders, id: string): Promise<boolean> {
    return this.setFolder(source, await source.openRecent(id));
  }

  /**
   * 開いているフォルダを中身ごと消す（F-PROJ-4）。消したら、そのフォルダのファイルの文書を閉じ、フォルダを閉じて、変更を知らせる。
   * 未保存の変更は失われるので、呼ぶ前に利用者に確かめる。
   *
   * @returns 消し終えたら解決する Promise。フォルダが開かれていない・消せないときは、何も変えずに例外（Error）で拒否する
   * @example
   * await ws.deleteFolder() // → フォルダが無くなり、ws.folder() が null、中のファイルの文書も閉じる
   */
  async deleteFolder(): Promise<void> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    if (!hasFolderEdits(f.source)) throw new Error("このフォルダは削除できません");
    const docs = this.docs.filter((d) => this.folderPath(d.key) !== null);
    await f.source.removeFolder(f.ref);
    for (const d of docs) this.close(d.key);
    this.closeFolder();
  }

  /**
   * 開いているフォルダを閉じ、変更を知らせる（F-PROJ-3）。開いている文書は閉じない（未保存の変更を失わないため）。
   * フォルダが開かれていなければ何もしない。
   *
   * @example
   * ws.closeFolder() // → ws.folder() が null になり、ws.list() は変わらない
   */
  closeFolder(): void {
    if (!this.folderState) return;
    this.folderState = null;
    this.disk = new Map();
    this.changed();
  }

  /** 開いているフォルダの中身とプロジェクトの設定ファイルを読み直し、変更を知らせる。フォルダが開かれていなければ何もしない。 */
  async refreshFolder(): Promise<void> {
    const f = this.folderState;
    if (!f) return;
    f.entries = await f.source.list(f.ref);
    f.projectText = await readProjectText(f.source, f.ref);
    await this.readModelFiles();
    this.changed();
  }

  /**
   * 開いているフォルダをプロジェクトにする（ADR-0019、F-PROJ-1）。一番上に設定ファイル（modelith.json）を書き、読み直して変更を知らせる。
   * 利用者が「プロジェクトにする」を選んだときだけ呼ぶ（C-6）。既にある設定ファイルは上書きしない。
   *
   * @param text 設定ファイルに書くテキスト（コアの createProjectFile で作ったもの）
   * @returns 書き終えたら解決する Promise。フォルダが開かれていない・フォルダの中に書けない・既に設定ファイルがあるときは、
   *   書かずに例外（Error）で拒否する
   * @example
   * await ws.makeProject('{\n  "name": "給水",\n  "plugins": {}\n}\n') // → ws.folder()?.projectText がそのテキストになる
   * await ws.makeProject("{}") // → Error「このフォルダは既にプロジェクトです（modelith.json があります）」（あるとき）
   */
  async makeProject(text: string): Promise<void> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    const source = f.source;
    if (!hasFolderFiles(source)) throw new Error("このフォルダには設定ファイルを書けません");
    // 開いた後に他のアプリで作られていても、上書きしない
    if ((await source.readInFolder(f.ref, PROJECT_FILE)) !== null) throw new Error(`このフォルダは既にプロジェクトです（${PROJECT_FILE} があります）`);
    await source.writeInFolder(f.ref, PROJECT_FILE, text);
    await this.refreshFolder();
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
    await this.readModelFiles();
    return this.openRef(ref);
  }

  /**
   * 開いているフォルダの中に空のフォルダを作り、一覧し直す（ファイルの一覧の「新しいフォルダー」。F-FILE-19）。
   *
   * @param path 作るフォルダの、フォルダからの相対パス
   * @returns 作り終えたら解決する Promise。フォルダが開かれていない・作れない・同じ名前があるときは例外（Error）で拒否する
   * @example
   * await ws.createFolder("models/parts") // → ws.folder() の一覧に models/parts が出る
   * await ws.createFolder("models")       // → Error「「models」は既にあります」（あるとき）
   */
  async createFolder(path: string): Promise<void> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    if (!hasFolderEdits(f.source)) throw new Error("このフォルダにはフォルダを作れません");
    await f.source.createFolder(f.ref, path);
    await this.refreshFolder();
  }

  /**
   * 開いているフォルダの文書のうち、path のファイルか、path のフォルダの中のファイルのもの（名前の変更・削除の前に、影響を確かめる。F-FILE-19）。
   *
   * @param path フォルダからの相対パス（ファイルかフォルダ）
   * @returns 該当する文書（開いた順）。フォルダが開かれていなければ空
   * @example
   * ws.docsIn("models")         // → [models/a.sysml の文書, models/sub/b.sysml の文書]
   * ws.docsIn("models/a.sysml") // → [models/a.sysml の文書]
   */
  docsIn(path: string): Doc[] {
    return this.docs.filter((d) => {
      const at = this.folderPath(d.key);
      return at !== null && movedPath(at, path, path) !== null;
    });
  }

  /**
   * 開いているフォルダの中のファイルかフォルダの名前を変える（動かす。F-FILE-19）。
   * モデルのファイルなら隣の配置ファイル（名前.layout.json）も合わせて動かす（フォルダなら中身ごと動く）。
   * 動かしたファイルを開いていれば、文書を新しいファイルに付け替える（未保存の変更はそのまま残す）。
   *
   * @param from 名前を変えるもののパス
   * @param to 新しいパス
   * @returns 動かし終えたら解決する Promise。フォルダが開かれていない・動かせない・動かす先に何かあるときは例外（Error）で拒否する
   * @example
   * await ws.renameEntry("a.sysml", "b.sysml") // → b.sysml と b.layout.json になり、a.sysml の文書は b.sysml の文書になる
   * await ws.renameEntry("models", "parts")    // → parts/… になり、中の文書も付け替わる
   */
  async renameEntry(from: string, to: string): Promise<void> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    const source = f.source;
    if (!hasFolderEdits(source)) throw new Error("このフォルダでは名前を変えられません");
    const docs = this.docsIn(from);
    const isFile = modelFiles(f.entries).some((r) => r.path === from);
    await source.moveInFolder(f.ref, from, to);
    if (isFile && hasFolderFiles(source)) {
      const layoutFrom = childPath(parentPath(from), layoutNameFor(from.slice(from.lastIndexOf("/") + 1)));
      const layoutTo = childPath(parentPath(to), layoutNameFor(to.slice(to.lastIndexOf("/") + 1)));
      if (layoutFrom !== layoutTo && (await source.readInFolder(f.ref, layoutFrom)) !== null) await source.moveInFolder(f.ref, layoutFrom, layoutTo);
    }
    f.entries = await source.list(f.ref);
    await this.readModelFiles();
    const moved = modelFiles(f.entries);
    for (const doc of docs) {
      const path = doc.ref && movedPath(doc.ref.path, from, to);
      const ref = path === null || path === undefined ? undefined : moved.find((r) => r.path === path);
      if (ref) await this.relink(doc, ref);
    }
    this.changed();
  }

  /**
   * 開いているフォルダの中のファイルかフォルダを消す（F-FILE-19）。モデルのファイルなら隣の配置ファイルも消す。
   * 消したファイルを開いていれば、その文書を閉じる（未保存の変更は失われるので、呼ぶ前に利用者に確かめる）。
   *
   * @param path 消すもののパス
   * @returns 消し終えたら解決する Promise。フォルダが開かれていない・消せないときは例外（Error）で拒否する
   * @example
   * await ws.removeEntry("a.sysml") // → a.sysml と a.layout.json が無くなり、a.sysml の文書が閉じる
   * await ws.removeEntry("models")  // → models が中身ごと無くなる
   */
  async removeEntry(path: string): Promise<void> {
    const f = this.folderState;
    if (!f) throw new Error("フォルダが開かれていません");
    const source = f.source;
    if (!hasFolderTrees(source)) throw new Error("このフォルダでは削除できません");
    const docs = this.docsIn(path);
    const isFile = modelFiles(f.entries).some((r) => r.path === path);
    if (!(await source.removeInFolder(f.ref, path))) throw new Error(`「${path}」が見つかりません`);
    if (isFile) await source.removeInFolder(f.ref, childPath(parentPath(path), layoutNameFor(path.slice(path.lastIndexOf("/") + 1))));
    for (const doc of docs) this.close(doc.key);
    await this.refreshFolder();
  }

  /**
   * 動かしたファイルの新しい参照に、文書を付け替える。中身と版を読み直し、未保存の変更が無ければ中身も合わせる（配置も同じ）。
   *
   * @param doc 付け替える文書
   * @param ref 動かした先のファイルの参照
   */
  private async relink(doc: Doc, ref: FileRef): Promise<void> {
    const dirty = this.isDirty(doc);
    const cur = await this.readable(ref).read(ref);
    const layout = await this.readLayout(ref);
    Object.assign(doc, { ref, name: ref.name, version: cur.version, stale: false, layoutStale: false, layoutVersion: layout.layoutVersion, layoutHome: layout.layoutHome });
    if (!dirty) Object.assign(doc, { text: cur.text, savedText: cur.text, layout: layout.layout, savedLayout: layout.savedLayout });
  }

  /**
   * フォルダを開いているフォルダにし、中身を一覧し、プロジェクトの設定ファイルを読んで変更を知らせる。
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
    this.folderState = { source, ref, entries: await source.list(ref), projectText: await readProjectText(source, ref) };
    this.disk = new Map();
    await this.readModelFiles();
    this.changed();
    return true;
  }

  /**
   * 開いているフォルダのモデルのファイルをすべて読み直す（ADR-0021 §3）。読めないファイルは入れない（読めるようになれば次に入る）。
   *
   * @returns 読んだテキストが前と変わったら true
   * @example
   * await this.readModelFiles() // → true（parts.sysml が他のアプリで変わった）
   * await this.readModelFiles() // → false（変わっていない・フォルダを開いていない）
   */
  private async readModelFiles(): Promise<boolean> {
    const f = this.folderState;
    const source = f?.source;
    if (!f || !source || !isReadable(source)) return false;
    const next = new Map<string, string>();
    for (const ref of modelFiles(f.entries)) {
      try {
        next.set(ref.path, (await source.read(ref)).text);
      } catch {
        // 消えた・読めないファイルはモデルに入れない
      }
    }
    if (this.folderState !== f) return false;
    const changed = next.size !== this.disk.size || [...next].some(([path, text]) => this.disk.get(path) !== text);
    this.disk = next;
    return changed;
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
    // 編集した仮のファイルは、開いたままにする（F-FILE-17）
    if (doc.preview && this.isDirty(doc)) {
      delete doc.preview;
      this.changed();
    }
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
    Object.assign(doc, { ref, name: ref.name, savedText: doc.text, version, stale: false, layoutVersion: null, layoutStale: false });
    doc.layoutHome = this.siblingsOf(ref) ? "sibling" : "none";
    if (doc.layout) await this.writeLayout(doc, { always: true });
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
   * @returns 配置と配置の保存先と配置ファイルの版。隣を扱えなければ空の配置と "none"、隣に配置ファイルが無ければ空の配置と "sibling"（版は null）
   * @example
   * await this.readLayout(fromFolder) // → { layout: "L", savedLayout: "L", layoutHome: "sibling", layoutVersion: "1001:1" }
   * await this.readLayout(picked)     // → { layout: "", savedLayout: "", layoutHome: "none", layoutVersion: null }
   */
  private async readLayout(ref: FileRef): Promise<Pick<Doc, "layout" | "savedLayout" | "layoutHome" | "layoutVersion">> {
    const p = this.siblingsOf(ref);
    if (!p) return this.noLayoutHome("");
    const file = await p.readSibling(ref, layoutNameFor(ref.name));
    const layout = file?.text ?? "";
    return { layout, savedLayout: layout, layoutHome: "sibling", layoutVersion: file?.version ?? null };
  }

  /**
   * 保存先のある配置を、変わっていれば（always なら変わっていなくても）隣の配置ファイルに書く。
   * 読んだときの版と比べ、他で変更されていれば書かずに ConflictError を投げる（force なら比べない）。
   * 隣を扱えない文書なら何もしない。
   *
   * @param doc 文書
   * @param opts `always: true` なら、配置が変わっていなくても書く（新しい保存先に移したとき）。
   *   `force: true` なら、配置ファイルが他で変更されていても版を比べずに上書きする
   */
  private async writeLayout(doc: Doc, opts: { always?: boolean; force?: boolean } = {}): Promise<void> {
    const p = doc.ref && this.siblingsOf(doc.ref);
    if (!doc.ref || !p || (!opts.always && doc.layout === doc.savedLayout)) return;
    doc.layoutVersion = await p.writeSibling(doc.ref, layoutNameFor(doc.ref.name), doc.layout, opts.force ? null : doc.layoutVersion);
    doc.savedLayout = doc.layout;
    doc.layoutStale = false;
  }

  /**
   * 配置の保存先が無い文書の、配置の初めの値を作る。
   *
   * @param layout 配置（配置ファイルの文字列）
   * @returns 保存済みとして扱う配置と、保存先 "none"（配置ファイルの版は null）
   * @example
   * this.noLayoutHome("") // → { layout: "", savedLayout: "", layoutHome: "none", layoutVersion: null }
   */
  private noLayoutHome(layout: string): Pick<Doc, "layout" | "savedLayout" | "layoutHome" | "layoutVersion"> {
    return { layout, savedLayout: layout, layoutHome: "none", layoutVersion: null };
  }

  /**
   * ファイルとその隣の配置ファイルを読み、文書として一覧の最後に加える（表示中にはしない・変更は知らせない）。
   *
   * @param ref 開くファイルの参照
   * @returns 加えた文書。読めるプロバイダが無い・読めないときは例外を投げる
   * @example
   * await this.load(ref) // → { key: "doc:2", ref, name: "a.sysml", text: "package A;", … }
   */
  private async load(ref: FileRef): Promise<Doc> {
    const { text, version } = await this.readable(ref).read(ref);
    return this.add({ ref, name: ref.name, text, savedText: text, version, ...(await this.readLayout(ref)) });
  }

  /**
   * 文書に新しいキーを付けて一覧の最後に加える（変更は知らせない）。
   *
   * @param init key・stale・layoutStale を除いた文書の中身
   * @returns 加えた文書（key は `doc:番号`、stale と layoutStale は false）
   * @example
   * this.add({ ref: null, name: "u", text: "", savedText: "", version: null, layout: "", savedLayout: "", layoutHome: "none", layoutVersion: null })
   * // → { key: "doc:1", stale: false, layoutStale: false, … }
   */
  private add(init: Omit<Doc, "key" | "stale" | "layoutStale">): Doc {
    const doc: Doc = { key: `doc:${++this.seq}`, stale: false, layoutStale: false, ...init };
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

  /**
   * 中身のある無題の文書すべてを、下書きの保存先に書く（配置があれば一緒に。F-FILE-11）。
   * 開いている文書が 1 つも無ければ、すべて閉じたことも書く（F-FILE-14）。
   * 置けたかどうかが前回と変わったら（置けなくなった・置けるようになった）、変更を知らせる。
   */
  private persistDrafts(): void {
    const drafts = this.docs.filter((d) => !d.ref && hasContent(d)).map((d) => ({ name: d.name, text: d.text, ...(d.layout ? { layout: d.layout } : {}) }));
    const lost = !this.drafts.save({ drafts, closedAll: !this.docs.length });
    const flipped = lost !== this.draftsLost;
    this.draftsLost = lost;
    // 下書きの順番が変わったら、前回の続きの下書きの番号も合わせる（changed も書く）
    if (flipped) this.changed();
    else this.saveSession();
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
