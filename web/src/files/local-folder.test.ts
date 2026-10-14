import { describe, expect, it } from "vitest";
import { FakeDir, FakeFile, FakeFsApi, MemoryHandleStore } from "./fake-fs";
import { LocalFolderProvider } from "./local-folder";
import { ConflictError, type DirEntry, type FileRef } from "./types";

function setup() {
  const api = new FakeFsApi();
  const store = new MemoryHandleStore();
  const p = new LocalFolderProvider(api, store);
  const root = new FakeDir("project");
  api.folder = root;
  return { api, store, p, root };
}

/** 一覧の最初のファイル。 */
function firstFile(es: DirEntry[]): FileRef {
  const e = es[0];
  if (e?.kind !== "file") throw new Error("ファイルがありません");
  return e.ref;
}

const paths = (es: DirEntry[]): string[] => es.flatMap((e) => (e.kind === "dir" ? [e.path + "/", ...paths(e.children)] : [e.ref.path]));

describe("LocalFolderProvider: フォルダ（F-FILE-1）", () => {
  it("モデルのファイルだけを、フォルダ → ファイルの順・名前順に一覧する", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("b.sysml", "");
    root.put("a.kerml", "");
    root.put("README.md", "");
    root.put("sub/c.sysml", "");
    const folder = await p.pickFolder();
    // Act
    const list = await p.list(folder!);
    // Assert
    expect(paths(list)).toEqual(["sub/", "sub/c.sysml", "a.kerml", "b.sysml"]);
  });

  it("モデルのファイルを含まないフォルダ・隠しフォルダ・node_modules は出さない（境界値: 空のフォルダ）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("docs/readme.md", "");
    root.put(".git/x.sysml", "");
    root.put("node_modules/y.sysml", "");
    const folder = await p.pickFolder();
    // Act
    const list = await p.list(folder!);
    // Assert
    expect(list).toEqual([]);
  });

  it("フォルダの選択をやめたら null（異常系: キャンセル）", async () => {
    // Arrange
    const { api, p } = setup();
    api.folder = null;
    // Act
    const folder = await p.pickFolder();
    // Assert
    expect(folder).toBeNull();
  });

  it("一覧し直しても同じファイルは同じ ID になる", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    const folder = await p.pickFolder();
    const [first] = await p.list(folder!);
    // Act
    const [again] = await p.list(folder!);
    // Assert
    expect(again).toEqual(first);
  });
});

describe("LocalFolderProvider: 読み書き（F-FILE-2・3）", () => {
  it("読んだ版を渡して上書きでき、新しい版を返す", async () => {
    // Arrange
    const { p, root } = setup();
    const file = root.put("a.sysml", "old");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    const { version } = await p.read(ref);
    // Act
    const next = await p.write(ref, "new", version);
    // Assert
    expect(file.content).toBe("new");
    expect(next).not.toBe(version);
  });

  it("読んだ後に他で変更されていたら ConflictError で、内容は変えない（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    const file = root.put("a.sysml", "old");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    const { version } = await p.read(ref);
    file.externalWrite("theirs");
    // Act
    const act = p.write(ref, "mine", version);
    // Assert
    await expect(act).rejects.toBeInstanceOf(ConflictError);
    expect(file.content).toBe("theirs");
  });

  it("版に null を渡すと比べずに上書きする（強制上書き）", async () => {
    // Arrange
    const { p, root } = setup();
    const file = root.put("a.sysml", "old");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    file.externalWrite("theirs");
    // Act
    await p.write(ref, "mine", null);
    // Assert
    expect(file.content).toBe("mine");
  });

  it("フォルダの中にサブフォルダごとファイルを作れる", async () => {
    // Arrange
    const { p, root } = setup();
    const folder = await p.pickFolder();
    // Act
    const ref = await p.createFile(folder!, "models/new.sysml", "package P;");
    // Assert
    expect(ref.path).toBe("models/new.sysml");
    expect((await p.read(ref)).text).toBe("package P;");
    expect(root.entries.get("models")).toBeInstanceOf(FakeDir);
  });

  it("同じ名前のファイルがあれば作らない（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "keep");
    const folder = await p.pickFolder();
    // Act
    const act = p.createFile(folder!, "a.sysml", "overwrite?");
    // Assert
    await expect(act).rejects.toThrow("既にあります");
  });

  it("ファイルを選んで開ける・名前を付けて保存できる", async () => {
    // Arrange
    const { api, p } = setup();
    api.openFile = new FakeFile("picked.sysml", "picked");
    api.saveTo = new FakeFile("saved.sysml");
    // Act
    const opened = await p.pickFile();
    const saved = await p.saveAs("x.sysml", "text");
    // Assert
    expect((await p.read(opened!)).text).toBe("picked");
    expect(saved?.ref.name).toBe("saved.sysml");
    expect(api.saveTo.content).toBe("text");
  });

  it("開いていないファイルは読めない（異常系）", async () => {
    // Arrange
    const { p } = setup();
    // Act
    const act = p.read({ provider: "local", id: "nope", name: "x.sysml", path: "x.sysml" });
    // Assert
    await expect(act).rejects.toThrow("開かれていません");
  });
});

describe("LocalFolderProvider: 前回のフォルダ（F-FILE-9）", () => {
  it("開いたフォルダを覚え、許可を得て開き直せる", async () => {
    // Arrange
    const { p, root } = setup();
    await p.pickFolder();
    root.permission = "prompt";
    // Act
    const name = await p.recentFolder();
    const folder = await p.reopenRecent();
    // Assert
    expect(name).toBe("project");
    expect(folder?.name).toBe("project");
  });

  it("許可されなければ開かない（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    await p.pickFolder();
    root.permission = "prompt";
    root.grantOnRequest = "denied";
    // Act
    const folder = await p.reopenRecent();
    // Assert
    expect(folder).toBeNull();
  });

  it("覚えているフォルダが無ければ null（境界値: 初回）", async () => {
    // Arrange
    const { p } = setup();
    // Act
    const name = await p.recentFolder();
    // Assert
    expect(name).toBeNull();
  });
});

describe("LocalFolderProvider: 隣のファイル（配置ファイル、ADR-0005）", () => {
  it("フォルダから開いたファイルは、隣のファイルを書いて読める（サブフォルダでも）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("models/a.sysml", "package A;");
    const folder = (await p.pickFolder())!;
    const es = await p.list(folder);
    const dir = es[0];
    const ref = dir?.kind === "dir" ? firstFile(dir.children) : firstFile(es);
    // Act
    await p.writeSibling(ref, "a.layout.json", "{}");
    const text = await p.readSibling(ref, "a.layout.json");
    // Assert
    expect(p.hasSiblings(ref)).toBe(true);
    expect(text).toBe("{}");
    expect((root.entries.get("models") as FakeDir).entries.get("a.layout.json")).toBeInstanceOf(FakeFile);
  });

  it("隣のファイルが無ければ null（境界値: まだ作っていない）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    // Act
    const text = await p.readSibling(ref, "a.layout.json");
    // Assert
    expect(text).toBeNull();
  });

  it("1 つだけ選んで開いたファイルは、隣を扱えない（異常系）", async () => {
    // Arrange
    const { p, api } = setup();
    api.openFile = new FakeFile("one.sysml", "package One;");
    const ref = (await p.pickFile())!;
    // Act
    const can = p.hasSiblings(ref);
    // Assert
    expect(can).toBe(false);
    await expect(p.readSibling(ref, "one.layout.json")).rejects.toThrow(/フォルダを開いてください/);
  });
});
