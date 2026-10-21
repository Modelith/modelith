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

  /**
   * ダウンロードで保存するプロバイダを作る。
   *
   * @param io ファイル選択ダイアログとダウンロード（テストでは差し替える）
   */
  constructor(private readonly io: BrowserFileIo) {}

  /**
   * ファイル選択ダイアログを開き、選んだファイルのうち最初のモデルのファイルを開く（内容を写しとして覚える）。
   * 一緒に選んだほかのファイルは、その隣のファイルとして扱う。モデルのファイルが無ければ最初のファイルを開く。
   *
   * @returns 開いたファイルの参照（id は `upload:番号`）。何も選ばなければ null
   * @example
   * await p.pickFile() // → { provider: "browser", id: "upload:1", name: "m.sysml", path: "m.sysml" }（m.sysml を選んだとき）
   * await p.pickFile() // → null（キャンセル）
   */
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

  /**
   * 開いた・保存したファイルの内容（覚えている写し）を読む。
   *
   * @param ref このプロバイダが返したファイルの参照
   * @returns 内容と版（上書きできないので版はいつも "0"）。覚えていない参照なら例外（Error）を投げる
   * @example
   * await p.read(ref)   // → { text: "package M;", version: "0" }
   * await p.read(other) // → Error「ファイル「x.sysml」は開かれていません」を投げる
   */
  async read(ref: FileRef): Promise<FileContent> {
    const text = this.contents.get(ref.id);
    if (text === undefined) throw new Error(`ファイル「${ref.name}」は開かれていません`);
    return { text, version: "0" };
  }

  /**
   * テキストをファイルとしてダウンロードさせ、その内容を写しとして覚える。
   *
   * @param suggestedName ダウンロードするファイルの名前
   * @param text 保存するテキスト
   * @returns 覚えた写しの参照と版（いつも "0"）。null は返さない
   * @example
   * await p.saveAs("out.sysml", "text") // → { ref: { provider: "browser", id: "upload:1", name: "out.sysml", path: "out.sysml" }, version: "0" }
   */
  async saveAs(suggestedName: string, text: string): Promise<{ ref: FileRef; version: string }> {
    this.io.download(suggestedName, text);
    return { ref: this.remember(suggestedName, text), version: "0" };
  }

  /**
   * このファイルの隣を扱えるか（このプロバイダで開いた・保存したファイルなら扱える）。
   *
   * @param ref ファイルの参照
   * @returns ref がこのプロバイダのものなら true
   * @example
   * p.hasSiblings({ provider: "browser", id: "upload:1", name: "m.sysml", path: "m.sysml" }) // → true
   * p.hasSiblings({ provider: "local", id: "x", name: "m.sysml", path: "m.sysml" })         // → false
   */
  hasSiblings(ref: FileRef): boolean {
    return ref.provider === this.id;
  }

  /**
   * モデルと一緒に選んだ・ダウンロードした隣のファイルを読む。
   *
   * @param ref モデルのファイルの参照
   * @param name 隣のファイルの名前（`m.layout.json` など）
   * @returns 内容と版（上書きできないので版はいつも "0"）。一緒に選んでいなければ null
   * @example
   * await p.readSibling(ref, "m.layout.json") // → { text: "L", version: "0" }（一緒に選んだとき）
   * await p.readSibling(ref, "m.layout.json") // → null（モデルだけを選んだとき）
   */
  async readSibling(ref: FileRef, name: string): Promise<FileContent | null> {
    const text = this.siblings.get(ref.id)?.get(name);
    return text === undefined ? null : { text, version: "0" };
  }

  /**
   * 隣のファイルに書く。上書きできないのでダウンロードになり、その内容を写しとして覚える。
   * ダウンロードは他で変更されたファイルを上書きしないので、版は比べない。
   *
   * @param ref モデルのファイルの参照
   * @param name 隣のファイルの名前（`m.layout.json` など）
   * @param text 書く内容
   * @returns 版（いつも "0"）
   * @example
   * await p.writeSibling(ref, "m.layout.json", "L") // → "0"（m.layout.json をダウンロード）
   */
  async writeSibling(ref: FileRef, name: string, text: string): Promise<string> {
    this.io.download(name, text);
    const m = this.siblings.get(ref.id) ?? new Map<string, string>();
    m.set(name, text);
    this.siblings.set(ref.id, m);
    return "0";
  }

  /**
   * 内容を写しとして覚え、新しい参照を作る。
   *
   * @param name ファイルの名前（表示名とパスにも使う）
   * @param text 内容
   * @returns 新しい参照（id は `upload:1`・`upload:2` … と呼ぶたびに増える）
   * @example
   * this.remember("m.sysml", "package M;") // → { provider: "browser", id: "upload:1", name: "m.sysml", path: "m.sysml" }
   */
  private remember(name: string, text: string): FileRef {
    const id = `upload:${++this.seq}`;
    this.contents.set(id, text);
    return { provider: this.id, id, name, path: name };
  }
}
