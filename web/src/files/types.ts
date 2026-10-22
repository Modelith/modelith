// ファイル操作の抽象（ADR-0010）。ストレージ（ローカル・ダウンロード・将来のクラウド）ごとにプロバイダを作り、
// できることごとに分けた小さなインタフェースを実装する。ワークスペースと UI はこの型だけに依存する。

/** ファイルの参照。id はプロバイダが決める不透明な値で、パスを前提にしない。 */
export interface FileRef {
  readonly provider: string;
  readonly id: string;
  /** 表示名（拡張子を含むファイル名）。 */
  readonly name: string;
  /** 表示用のパス（フォルダからの相対パス。無ければ name と同じ）。 */
  readonly path: string;
}

/** フォルダの参照。 */
export interface FolderRef {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
}

/** 読み込んだ内容と、その版（不透明な文字列。変われば内容が変わった可能性がある）。 */
export interface FileContent {
  text: string;
  version: string;
}

/** フォルダの中身（ツリー）。 */
export type DirEntry =
  | { kind: "file"; ref: FileRef }
  | { kind: "dir"; name: string; path: string; children: DirEntry[] };

/** 上書きしようとしたファイルが、読み込んだ後に他で変更されていた。 */
export class ConflictError extends Error {
  /**
   * 競合の例外を作る（メッセージは「パス は読み込んだ後に変更されています」）。
   *
   * @param ref 上書きしようとしたファイル
   */
  constructor(readonly ref: FileRef) {
    super(`${ref.path} は読み込んだ後に変更されています`);
    this.name = "ConflictError";
  }
}

/** すべてのプロバイダが持つ情報。 */
export interface ProviderInfo {
  readonly id: string;
  readonly label: string;
}

/** ファイルを読める。 */
export interface Readable extends ProviderInfo {
  read(ref: FileRef): Promise<FileContent>;
}

/** ファイルを上書きできる。expectedVersion と今の版が違えば ConflictError（null なら比べない）。新しい版を返す。 */
export interface Writable extends ProviderInfo {
  write(ref: FileRef, text: string, expectedVersion: string | null): Promise<string>;
}

/** フォルダを選び、中身を一覧し、ファイルを作れる。 */
export interface FolderSource extends ProviderInfo {
  /** near を渡すと、そのファイルのある場所から選び始める。 */
  pickFolder(near?: FileRef): Promise<FolderRef | null>;
  list(folder: FolderRef): Promise<DirEntry[]>;
  /** path はフォルダからの相対パス。既にあれば失敗する。 */
  createFile(folder: FolderRef, path: string, text: string): Promise<FileRef>;
}

/** ファイルを 1 つ選べる（選ばなければ null）。 */
export interface FilePicker extends ProviderInfo {
  pickFile(): Promise<FileRef | null>;
}

/** 保存先を選んで保存できる（選ばなければ null）。 */
export interface SaveAsTarget extends ProviderInfo {
  /**
   * 保存先を選んでテキストを保存する。
   *
   * @param suggestedName 保存先の名前の候補（拡張子を含むファイル名）
   * @param text 保存するテキスト
   * @returns 保存したファイルの参照と版。保存先を選ばなければ null
   * @example
   * await target.saveAs("out.sysml", "package P;") // → { ref: { …, name: "out.sysml" }, version: "…" }
   * await target.saveAs("out.sysml", "package P;") // → null（キャンセル）
   */
  saveAs(suggestedName: string, text: string): Promise<{ ref: FileRef; version: string } | null>;
}

/** 1 つだけ開いたファイルを、開いたフォルダの中から探せる（隣の配置ファイルを扱えるようにするため、ADR-0005）。 */
export interface FileLocator extends ProviderInfo {
  /** ref が folder の中にあれば、フォルダから開いたファイルとしての参照を返す（無ければ null）。 */
  locate(folder: FolderRef, ref: FileRef): Promise<FileRef | null>;
}

/** 前回のフォルダを覚えて開き直せる。 */
export interface RecentFolders extends ProviderInfo {
  /** 覚えているフォルダの名前（無ければ null）。 */
  recentFolder(): Promise<string | null>;
  /** 覚えているフォルダを、今の許可のまま開けるか（許可は求めない。F-FILE-13）。覚えていなければ "none"。 */
  recentAccess(): Promise<RecentAccess>;
  /**
   * 覚えているフォルダを開き直す。許可の確認が要るので、利用者の操作から呼ぶ。
   * `ask: false` なら許可を求めず、既に許可されているときだけ開く（起動したとき。F-FILE-13）。
   */
  reopenRecent(opts?: { ask?: boolean }): Promise<FolderRef | null>;
}

/** 前回のフォルダを開く許可の状態。granted は許可済み、prompt は利用者の操作で求められる、denied は拒否、none は覚えていない。 */
export type RecentAccess = "granted" | "prompt" | "denied" | "none";

/** モデルのファイルの隣のファイル（配置ファイル）を読み書きできる（ADR-0005）。 */
export interface SiblingFiles extends ProviderInfo {
  /** このファイルの隣を扱えるか（フォルダから開いたファイルだけ。1 つだけ選んだファイルは隣を扱えない）。 */
  hasSiblings(ref: FileRef): boolean;
  /** 隣のファイル name を読む（内容と版。無ければ null）。 */
  readSibling(ref: FileRef, name: string): Promise<FileContent | null>;
  /**
   * 隣のファイル name に書く。無ければ作る。あれば expectedVersion と今の版を比べ、違えば ConflictError（null なら比べない）。
   *
   * @param ref モデルのファイルの参照
   * @param name 隣のファイルの名前（`m.layout.json` など）
   * @param text 書く内容
   * @param expectedVersion 読んだときの版。null なら比べずに上書きする（強制上書き・まだ読んでいない）
   * @returns 書いた後の新しい版
   * @example
   * await p.writeSibling(ref, "m.layout.json", "L", version) // → 新しい版
   * await p.writeSibling(ref, "m.layout.json", "L", version) // → ConflictError を投げる（読んだ後に他で変更されていたとき）
   * await p.writeSibling(ref, "m.layout.json", "L", null)    // → 新しい版（比べずに書く）
   */
  writeSibling(ref: FileRef, name: string, text: string, expectedVersion: string | null): Promise<string>;
}

/** 開いたフォルダの中の、決まった場所のファイルを読み書きできる（プロジェクトの設定ファイル modelith.json など、ADR-0019）。 */
export interface FolderFiles extends ProviderInfo {
  /**
   * フォルダの中のファイルを読む。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @returns 内容。ファイルが無ければ null
   * @example
   * await p.readInFolder(folder, "modelith.json") // → '{ "name": "給水" }'
   * await p.readInFolder(folder, "none.json")     // → null
   */
  readInFolder(folder: FolderRef, path: string): Promise<string | null>;
  /**
   * フォルダの中のファイルに書く。無ければ作る（途中のフォルダも作る）。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り）
   * @param text 書く内容
   */
  writeInFolder(folder: FolderRef, path: string, text: string): Promise<void>;
}

/**
 * フォルダをまるごと読む・消す。開いているフォルダとは別のフォルダを選んで読める（プラグインのフォルダを、
 * プロジェクトの `.modelith/plugins/<ID>/` に写す。ADR-0018 §1）。
 */
export interface FolderTrees extends ProviderInfo {
  /**
   * 読むためのフォルダを選ばせる。開いているフォルダは変えず、前回のフォルダとしても覚えない。
   *
   * @returns 選んだフォルダ。選ばなければ null
   * @example
   * await p.pickOtherFolder() // → { provider: "local", id: "dir:2", name: "trace-rules" }
   * await p.pickOtherFolder() // → null（キャンセル）
   */
  pickOtherFolder(): Promise<FolderRef | null>;
  /**
   * フォルダの中のフォルダにあるファイルを、下のフォルダまですべてテキストで読む（隠しファイル・隠しフォルダ・node_modules は除く）。
   *
   * @param folder このプロバイダで開いた（選んだ）フォルダ
   * @param path フォルダからの相対パス（`/` 区切り。"" ならフォルダそのもの）
   * @returns path からの相対パス → テキスト。フォルダが無ければ null。ファイルが多すぎるときは例外（Error）を投げる
   * @example
   * await p.readTree(folder, ".modelith/plugins/jp.x") // → { "modelith-plugin.json": "{…}", "rules/a.yaml": "rules: …" }
   * await p.readTree(folder, ".modelith/plugins/none") // → null
   */
  readTree(folder: FolderRef, path: string): Promise<Record<string, string> | null>;
  /**
   * フォルダの中のファイルかフォルダを、中身ごと消す。
   *
   * @param folder このプロバイダで開いたフォルダ
   * @param path フォルダからの相対パス（`/` 区切り。空にはできない）
   * @returns 消したら true。無ければ false
   * @example
   * await p.removeInFolder(folder, ".modelith/plugins/jp.x") // → true
   * await p.removeInFolder(folder, ".modelith/plugins/none") // → false
   */
  removeInFolder(folder: FolderRef, path: string): Promise<boolean>;
}

export type FileProvider = ProviderInfo &
  Partial<
    Omit<Readable & Writable & FolderSource & FilePicker & SaveAsTarget & RecentFolders & SiblingFiles & FileLocator & FolderFiles & FolderTrees, keyof ProviderInfo>
  >;

/**
 * ファイルを読めるプロバイダか（`read` があるか）。
 *
 * @param p プロバイダ
 * @returns 読めれば true（型を Readable に絞る）
 * @example
 * isReadable(new BrowserFileProvider(io)) // → true
 * isReadable({ id: "x", label: "x" })     // → false
 */
export const isReadable = (p: FileProvider): p is Readable => typeof p.read === "function";
/**
 * ファイルを上書きできるプロバイダか（`write` があるか）。
 *
 * @param p プロバイダ
 * @returns 上書きできれば true（型を Writable に絞る）
 * @example
 * isWritable(new LocalFolderProvider(…)) // → true
 * isWritable(new BrowserFileProvider(io)) // → false（ダウンロードしかできない）
 */
export const isWritable = (p: FileProvider): p is Writable => typeof p.write === "function";
/**
 * フォルダを選び、一覧し、ファイルを作れるプロバイダか（`pickFolder`・`list`・`createFile` がそろっているか）。
 *
 * @param p プロバイダ
 * @returns 3 つともあれば true（型を FolderSource に絞る）
 * @example
 * isFolderSource(new LocalFolderProvider(…)) // → true
 * isFolderSource(new BrowserFileProvider(io)) // → false
 */
export const isFolderSource = (p: FileProvider): p is FolderSource =>
  typeof p.pickFolder === "function" && typeof p.list === "function" && typeof p.createFile === "function";
/**
 * ファイルを 1 つ選べるプロバイダか（`pickFile` があるか）。
 *
 * @param p プロバイダ
 * @returns 選べれば true（型を FilePicker に絞る）
 * @example
 * isFilePicker(new BrowserFileProvider(io)) // → true
 * isFilePicker({ id: "x", label: "x" })     // → false
 */
export const isFilePicker = (p: FileProvider): p is FilePicker => typeof p.pickFile === "function";
/**
 * 保存先を選んで保存できるプロバイダか（`saveAs` があるか）。
 *
 * @param p プロバイダ
 * @returns 保存できれば true（型を SaveAsTarget に絞る）
 * @example
 * isSaveAsTarget(new BrowserFileProvider(io)) // → true
 * isSaveAsTarget({ id: "x", label: "x" })     // → false
 */
export const isSaveAsTarget = (p: FileProvider): p is SaveAsTarget => typeof p.saveAs === "function";
/**
 * 隣のファイル（配置ファイル、ADR-0005）を読み書きできるプロバイダか（`hasSiblings`・`readSibling`・`writeSibling` がそろっているか）。
 *
 * @param p プロバイダ
 * @returns 3 つともあれば true（型を SiblingFiles に絞る）
 * @example
 * hasSiblingFiles(new BrowserFileProvider(io)) // → true
 * hasSiblingFiles({ id: "x", label: "x" })     // → false
 */
export const hasSiblingFiles = (p: FileProvider): p is SiblingFiles =>
  typeof p.hasSiblings === "function" && typeof p.readSibling === "function" && typeof p.writeSibling === "function";
/**
 * 1 つだけ開いたファイルを、開いたフォルダの中から探せるプロバイダか（`locate` があるか）。
 *
 * @param p プロバイダ
 * @returns 探せれば true（型を FileLocator に絞る）
 * @example
 * canLocate(new LocalFolderProvider(…)) // → true
 * canLocate(new BrowserFileProvider(io)) // → false
 */
export const canLocate = (p: FileProvider): p is FileLocator => typeof p.locate === "function";
/**
 * 前回のフォルダを覚えて開き直せるプロバイダか（`recentFolder`・`reopenRecent` がそろっているか）。
 *
 * @param p プロバイダ
 * @returns 両方あれば true（型を RecentFolders に絞る）
 * @example
 * hasRecentFolders(new LocalFolderProvider(…)) // → true
 * hasRecentFolders(new BrowserFileProvider(io)) // → false
 */
export const hasRecentFolders = (p: FileProvider): p is RecentFolders =>
  typeof p.recentFolder === "function" && typeof p.reopenRecent === "function";

/**
 * 開いたフォルダの中のファイルを読み書きできるプロバイダか（`readInFolder`・`writeInFolder` がそろっているか）。
 *
 * @param p プロバイダ
 * @returns 両方あれば true（型を FolderFiles に絞る）
 * @example
 * hasFolderFiles(new LocalFolderProvider(…)) // → true
 * hasFolderFiles(new BrowserFileProvider(io)) // → false
 */
export const hasFolderFiles = (p: FileProvider): p is FolderFiles =>
  typeof p.readInFolder === "function" && typeof p.writeInFolder === "function";
/**
 * フォルダをまるごと読み・消し、別のフォルダを選べるプロバイダか（`pickOtherFolder`・`readTree`・`removeInFolder` がそろっているか）。
 *
 * @param p プロバイダ
 * @returns 3 つともあれば true（型を FolderTrees に絞る）
 * @example
 * hasFolderTrees(new LocalFolderProvider(…)) // → true
 * hasFolderTrees(new BrowserFileProvider(io)) // → false
 */
export const hasFolderTrees = (p: FileProvider): p is FolderTrees =>
  typeof p.pickOtherFolder === "function" && typeof p.readTree === "function" && typeof p.removeInFolder === "function";
/**
 * モデルとして扱うファイルか（拡張子が .sysml か .kerml。大文字・小文字は区別しない）。
 *
 * @param name ファイル名
 * @returns モデルのファイルなら true
 * @example
 * isModelFile("m.sysml")       // → true
 * isModelFile("M.KERML")       // → true（大文字）
 * isModelFile("m.layout.json") // → false
 */
export const isModelFile = (name: string): boolean => /\.(sysml|kerml)$/i.test(name);

/** プロバイダを id で引く。 */
export class ProviderRegistry {
  private readonly map = new Map<string, FileProvider>();

  /**
   * プロバイダを id で引けるようにする（同じ id があれば後のものにする）。
   *
   * @param providers 使うプロバイダの一覧
   */
  constructor(providers: FileProvider[]) {
    for (const p of providers) this.map.set(p.id, p);
  }

  /**
   * プロバイダを id で引く。
   *
   * @param id プロバイダの id（"local"・"browser" など）
   * @returns プロバイダ。無ければ undefined
   * @example
   * registry.get("browser") // → BrowserFileProvider
   * registry.get("nope")    // → undefined
   */
  get(id: string): FileProvider | undefined {
    return this.map.get(id);
  }

  /**
   * 登録したプロバイダすべて（登録した順）。
   *
   * @returns プロバイダの一覧。1 つも無ければ空
   * @example
   * new ProviderRegistry([local, browser]).all() // → [local, browser]
   * new ProviderRegistry([]).all()               // → []
   */
  all(): FileProvider[] {
    return [...this.map.values()];
  }
}
