// Google ドライブのファイルを扱うプロバイダ（ADR-0010・ADR-0012、F-FILE-12）。
// サーバを持たず、ブラウザから Drive に直接つなぐ。Drive とのやり取りは DriveClient として外から渡し、
// 単体テストでは偽のクライアントに差し替える。権限は drive.file だけなので、ファイルは Picker で利用者が選んだものだけを扱う。

import { ConflictError, type FileContent, type FilePicker, type FileRef, type Readable, type SaveAsTarget, type Writable } from "./types";

/** ドライブのファイル（またはフォルダ）。 */
export interface DriveItem {
  readonly id: string;
  readonly name: string;
}

/** ファイルのメタデータ。version は更新のたびに増える番号（Drive の files.version）。 */
export interface DriveMeta {
  readonly name: string;
  readonly version: string;
}

/** Drive とのやり取り。実物は drive-client.ts の RestDriveClient。 */
export interface DriveClient {
  /** Google Picker でファイルを 1 つ選ばせる（選ばなければ null）。 */
  pickFile(): Promise<DriveItem | null>;
  /** Google Picker で保存先のフォルダを選ばせる（選ばなければ null）。 */
  pickFolder(): Promise<DriveItem | null>;
  meta(id: string): Promise<DriveMeta>;
  download(id: string): Promise<string>;
  /** 内容を置き換え、新しい版を返す。 */
  update(id: string, text: string): Promise<string>;
  /** フォルダにファイルを作る。 */
  create(folderId: string, name: string, text: string): Promise<DriveItem & DriveMeta>;
}

export class GoogleDriveProvider implements Readable, Writable, FilePicker, SaveAsTarget {
  readonly id = "gdrive";
  readonly label = "Google ドライブ";

  constructor(private readonly client: DriveClient) {}

  async pickFile(): Promise<FileRef | null> {
    const item = await this.client.pickFile();
    return item ? this.ref(item) : null;
  }

  /**
   * 版を先に読み、そのあと内容を読む。間に他で更新されると、内容のほうが新しくなる。
   * そのときは次の保存で競合として扱われる（安全側）。逆の順だと、他の更新を黙って上書きしうる。
   */
  async read(ref: FileRef): Promise<FileContent> {
    const { version } = await this.client.meta(ref.id);
    return { text: await this.client.download(ref.id), version };
  }

  /**
   * Drive API v3 には条件付きの書き込みが無いので、直前に版を読み直して比べる（ADR-0012）。
   * 読み直しから書き込みまでのわずかな間の競合は防げない。
   */
  async write(ref: FileRef, text: string, expectedVersion: string | null): Promise<string> {
    if (expectedVersion !== null && (await this.client.meta(ref.id)).version !== expectedVersion) throw new ConflictError(ref);
    return this.client.update(ref.id, text);
  }

  async saveAs(suggestedName: string, text: string): Promise<{ ref: FileRef; version: string } | null> {
    const folder = await this.client.pickFolder();
    if (!folder) return null;
    const created = await this.client.create(folder.id, suggestedName, text);
    return { ref: this.ref(created), version: created.version };
  }

  private ref(item: DriveItem): FileRef {
    return { provider: this.id, id: item.id, name: item.name, path: item.name };
  }
}
