// File System Access API の無いブラウザ向けの代替（ADR-0010、F-FILE-10）。
// ファイルは読み込みダイアログで選び、保存はダウンロードになる。上書きはできない（Writable を実装しない）。

import type { FileContent, FilePicker, FileRef, Readable, SaveAsTarget } from "./types";

/** 選ばれたファイル（ブラウザの File のうち使う部分）。 */
export interface PickedFile {
  readonly name: string;
  text(): Promise<string>;
}

export interface BrowserFileIo {
  /** ファイル選択ダイアログを開く（選ばなければ null）。 */
  choose(): Promise<PickedFile | null>;
  /** テキストをファイルとしてダウンロードさせる。 */
  download(name: string, text: string): void;
}

export class BrowserFileProvider implements Readable, FilePicker, SaveAsTarget {
  readonly id = "browser";
  readonly label = "ダウンロード";
  /** 読み込んだ・保存した内容。上書きできないので、この写しが「ファイル」の内容になる。 */
  private readonly contents = new Map<string, string>();
  private seq = 0;

  constructor(private readonly io: BrowserFileIo) {}

  async pickFile(): Promise<FileRef | null> {
    const f = await this.io.choose();
    if (!f) return null;
    return this.remember(f.name, await f.text());
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

  private remember(name: string, text: string): FileRef {
    const id = `upload:${++this.seq}`;
    this.contents.set(id, text);
    return { provider: this.id, id, name, path: name };
  }
}
