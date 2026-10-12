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
  pickFolder(): Promise<FolderRef | null>;
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
  saveAs(suggestedName: string, text: string): Promise<{ ref: FileRef; version: string } | null>;
}

/** 前回のフォルダを覚えて開き直せる。 */
export interface RecentFolders extends ProviderInfo {
  /** 覚えているフォルダの名前（無ければ null）。 */
  recentFolder(): Promise<string | null>;
  /** 覚えているフォルダを開き直す。許可の確認が要るので、利用者の操作から呼ぶ。 */
  reopenRecent(): Promise<FolderRef | null>;
}

export type FileProvider = ProviderInfo & Partial<Omit<Readable & Writable & FolderSource & FilePicker & SaveAsTarget & RecentFolders, keyof ProviderInfo>>;

export const isReadable = (p: FileProvider): p is Readable => typeof p.read === "function";
export const isWritable = (p: FileProvider): p is Writable => typeof p.write === "function";
export const isFolderSource = (p: FileProvider): p is FolderSource =>
  typeof p.pickFolder === "function" && typeof p.list === "function" && typeof p.createFile === "function";
export const isFilePicker = (p: FileProvider): p is FilePicker => typeof p.pickFile === "function";
export const isSaveAsTarget = (p: FileProvider): p is SaveAsTarget => typeof p.saveAs === "function";
export const hasRecentFolders = (p: FileProvider): p is RecentFolders =>
  typeof p.recentFolder === "function" && typeof p.reopenRecent === "function";

/** モデルとして扱うファイルか。 */
export const isModelFile = (name: string): boolean => /\.(sysml|kerml)$/i.test(name);

/** プロバイダを id で引く。 */
export class ProviderRegistry {
  private readonly map = new Map<string, FileProvider>();

  constructor(providers: FileProvider[]) {
    for (const p of providers) this.map.set(p.id, p);
  }

  get(id: string): FileProvider | undefined {
    return this.map.get(id);
  }

  all(): FileProvider[] {
    return [...this.map.values()];
  }
}
