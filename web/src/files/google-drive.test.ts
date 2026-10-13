import { describe, expect, it } from "vitest";
import { GoogleDriveProvider, type DriveClient, type DriveItem } from "./google-drive";
import { ConflictError, isFilePicker, isFolderSource, isReadable, isSaveAsTarget, isWritable } from "./types";

/** メモリ上のドライブ。版は更新のたびに 1 増える。 */
class FakeDrive implements DriveClient {
  readonly files = new Map<string, { name: string; text: string; version: number; folder: string }>();
  pickedFile: DriveItem | null = null;
  pickedFolder: DriveItem | null = null;
  private seq = 0;

  put(id: string, name: string, text: string): void {
    this.files.set(id, { name, text, version: 1, folder: "root" });
  }
  /** 他の人（他のアプリ）が更新した。 */
  editElsewhere(id: string, text: string): void {
    const f = this.get(id);
    f.text = text;
    f.version++;
  }
  async pickFile() {
    return this.pickedFile;
  }
  async pickFolder() {
    return this.pickedFolder;
  }
  async meta(id: string) {
    const f = this.get(id);
    return { name: f.name, version: String(f.version) };
  }
  async download(id: string) {
    return this.get(id).text;
  }
  async update(id: string, text: string) {
    const f = this.get(id);
    f.text = text;
    return String(++f.version);
  }
  async create(folderId: string, name: string, text: string) {
    const id = `new-${++this.seq}`;
    this.files.set(id, { name, text, version: 1, folder: folderId });
    return { id, name, version: "1" };
  }
  private get(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error(`no file ${id}`);
    return f;
  }
}

function setup() {
  const drive = new FakeDrive();
  drive.put("f1", "model.sysml", "package A;");
  return { drive, p: new GoogleDriveProvider(drive) };
}

describe("GoogleDriveProvider（F-FILE-12）", () => {
  it("読める・上書きできる・ファイルを選べる・保存先を選んで保存できる（フォルダの一覧は持たない）", () => {
    // Arrange
    const { p } = setup();
    // Act
    const caps = [isReadable(p), isWritable(p), isFilePicker(p), isSaveAsTarget(p), isFolderSource(p)];
    // Assert
    expect(caps).toEqual([true, true, true, true, false]);
  });

  it("Picker で選んだファイルを、版と一緒に読める", async () => {
    // Arrange
    const { drive, p } = setup();
    drive.pickedFile = { id: "f1", name: "model.sysml" };
    // Act
    const ref = await p.pickFile();
    const content = await p.read(ref!);
    // Assert
    expect(ref).toEqual({ provider: "gdrive", id: "f1", name: "model.sysml", path: "model.sysml" });
    expect(content).toEqual({ text: "package A;", version: "1" });
  });

  it("Picker を閉じたら null（異常系: キャンセル）", async () => {
    // Arrange
    const { p } = setup();
    // Act
    const ref = await p.pickFile();
    // Assert
    expect(ref).toBeNull();
  });

  it("読んだ版のままなら上書きでき、新しい版が返る", async () => {
    // Arrange
    const { drive, p } = setup();
    drive.pickedFile = { id: "f1", name: "model.sysml" };
    const ref = (await p.pickFile())!;
    const { version } = await p.read(ref);
    // Act
    const next = await p.write(ref, "package B;", version);
    // Assert
    expect(next).toBe("2");
    expect(drive.files.get("f1")?.text).toBe("package B;");
  });

  it("他で更新されていたら上書きせず ConflictError（F-FILE-7）", async () => {
    // Arrange
    const { drive, p } = setup();
    drive.pickedFile = { id: "f1", name: "model.sysml" };
    const ref = (await p.pickFile())!;
    const { version } = await p.read(ref);
    drive.editElsewhere("f1", "package Theirs;");
    // Act
    const result = p.write(ref, "package Mine;", version);
    // Assert
    await expect(result).rejects.toBeInstanceOf(ConflictError);
    expect(drive.files.get("f1")?.text).toBe("package Theirs;");
  });

  it("版を指定しなければ（null）比べずに上書きする（競合で「上書き」を選んだとき）", async () => {
    // Arrange
    const { drive, p } = setup();
    drive.editElsewhere("f1", "package Theirs;");
    const ref = { provider: "gdrive", id: "f1", name: "model.sysml", path: "model.sysml" };
    // Act
    await p.write(ref, "package Mine;", null);
    // Assert
    expect(drive.files.get("f1")?.text).toBe("package Mine;");
  });

  it("名前を付けて保存は、選んだフォルダに新しいファイルを作る", async () => {
    // Arrange
    const { drive, p } = setup();
    drive.pickedFolder = { id: "folder-9", name: "設計" };
    // Act
    const r = await p.saveAs("untitled-1.sysml", "package U;");
    // Assert
    expect(r?.ref.name).toBe("untitled-1.sysml");
    expect(r?.version).toBe("1");
    expect(drive.files.get(r!.ref.id)).toMatchObject({ text: "package U;", folder: "folder-9" });
  });

  it("保存先を選ばなければ何も作らず null（異常系: キャンセル）", async () => {
    // Arrange
    const { drive, p } = setup();
    // Act
    const r = await p.saveAs("untitled-1.sysml", "package U;");
    // Assert
    expect(r).toBeNull();
    expect(drive.files.size).toBe(1);
  });
});
