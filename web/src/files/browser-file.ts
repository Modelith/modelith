// File System Access API の無いブラウザ向けの代替（ADR-0010、F-FILE-10）。
// ファイルは読み込みダイアログで選び、保存はダウンロードになる。上書きはできない（Writable を実装しない）。
// 配置ファイル（ADR-0005）は、開くときにモデルと一緒に選んでもらい、保存のときはモデルと一緒にダウンロードする。

import { isModelFile, type FileContent, type FilePicker, type FileRef, type Readable, type SaveAsTarget, type SiblingFiles } from "./types";

/** 選ばれたファイル（ブラウザの File のうち使う部分）。 */
export interface PickedFile {
  readonly name: string;
  text(): Promise<string>;
}

export interface BrowserFileIo {
  /** ファイル選択ダイアログを開く（複数選べる。選ばなければ空）。 */
  choose(): Promise<PickedFile[]>;
  /** テキストをファイルとしてダウンロードさせる。 */
  download(name: string, text: string): void;
}

export class BrowserFileProvider implements Readable, FilePicker, SaveAsTarget, SiblingFiles {
  readonly id = "browser";
  readonly label = "ダウンロード";
  /** 読み込んだ・保存した内容。上書きできないので、この写しが「ファイル」の内容になる。 */
  private readonly contents = new Map<string, string>();
  /** モデルと一緒に選んだ・ダウンロードしたファイル（モデルの id → 名前 → 内容）。 */
  private readonly siblings = new Map<string, Map<string, string>>();
  private seq = 0;

  constructor(private readonly io: BrowserFileIo) {}

  /** 選んだファイルのうち、最初のモデルのファイルを開く。一緒に選んだほかのファイルは、その隣のファイルとして扱う。 */
  async pickFile(): Promise<FileRef | null> {
    const files = await this.io.choose();
    const model = files.find((f) => isModelFile(f.name)) ?? files[0];
    if (!model) return null;
    const ref = this.remember(model.name, await model.text());
    const rest = new Map<string, string>();
    for (const f of files) if (f !== model) rest.set(f.name, await f.text());
    this.siblings.set(ref.id, rest);
    return ref;
  }

  async read(ref: FileRef): Promise<FileContent> {
    const text = this.contents.get(ref.id);
    if (text === undefined) throw new Error(`ファイル「${ref.name}」は開かれていません`);
    return { text, version: "0" };
  }

  async saveAs(suggestedName: string, text: string): Promise<{ ref: FileRef; version: string }> {
    this.io.download(suggestedName, text);
    return { ref: this.remember(suggestedName, text), version: "0" };
  }

  hasSiblings(ref: FileRef): boolean {
    return ref.provider === this.id;
  }

  async readSibling(ref: FileRef, name: string): Promise<string | null> {
    return this.siblings.get(ref.id)?.get(name) ?? null;
  }

  /** 隣のファイルも、上書きできないのでダウンロードになる。 */
  async writeSibling(ref: FileRef, name: string, text: string): Promise<void> {
    this.io.download(name, text);
    const m = this.siblings.get(ref.id) ?? new Map<string, string>();
    m.set(name, text);
    this.siblings.set(ref.id, m);
  }

  private remember(name: string, text: string): FileRef {
    const id = `upload:${++this.seq}`;
    this.contents.set(id, text);
    return { provider: this.id, id, name, path: name };
  }
}
