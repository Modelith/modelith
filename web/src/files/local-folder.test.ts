import { describe, expect, it } from "vitest";
import { FakeDir, FakeFile, FakeFsApi, MemoryHandleStore } from "./fake-fs";
import { LocalFolderProvider, MAX_TREE_FILES, segmentsOf } from "./local-folder";
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

  it("中が空のフォルダ（作ったばかりのフォルダ）は出す（F-FILE-19）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    await root.getDirectoryHandle("new", { create: true });
    const folder = await p.pickFolder();
    // Act
    const list = await p.list(folder!);
    // Assert
    expect(paths(list)).toEqual(["new/", "a.sysml"]);
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

  it.each(["models/../x.sysml", "a\\b.sysml"])("%j はフォルダの外を指すので作らない（異常系）", async (path) => {
    // Arrange
    const { p, root } = setup();
    const folder = await p.pickFolder();
    // Act
    const act = p.createFile(folder!, path, "");
    // Assert（何も作らない）
    await expect(act).rejects.toThrow("フォルダの外を指しています");
    expect(root.entries.size).toBe(0);
  });

  it("名前が空なら作らない（境界値）", async () => {
    // Arrange
    const { p, root } = setup();
    const folder = await p.pickFolder();
    // Act
    const act = p.createFile(folder!, "", "");
    // Assert
    await expect(act).rejects.toThrow("ファイル名がありません");
    expect(root.entries.size).toBe(0);
  });

  it("ファイルを 1 つ選んで開ける", async () => {
    // Arrange
    const { api, p } = setup();
    api.openFile = new FakeFile("picked.sysml", "picked");
    // Act
    const opened = await p.pickFile();
    // Assert
    expect((await p.read(opened!)).text).toBe("picked");
    expect(p.hasSiblings(opened!)).toBe(false);
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

describe("LocalFolderProvider: 起動したときの前回のフォルダの許可（F-FILE-13）", () => {
  it.each(["granted", "prompt", "denied"] as const)("許可を求めずに、今の許可の状態（%s）を返す", async (state) => {
    // Arrange
    const { p, root } = setup();
    await p.pickFolder();
    root.permission = state;
    root.grantOnRequest = "denied";
    // Act
    const access = await p.recentAccess();
    // Assert
    expect(access).toBe(state);
    expect(root.permission).toBe(state); // 求めていない
  });

  it("覚えているフォルダが無ければ none（境界値: 初回）", async () => {
    // Arrange
    const { p } = setup();
    // Act
    const access = await p.recentAccess();
    // Assert
    expect(access).toBe("none");
  });

  it("ask: false なら、許可済みのフォルダだけを開き直す", async () => {
    // Arrange
    const { p } = setup();
    await p.pickFolder();
    // Act
    const folder = await p.reopenRecent({ ask: false });
    // Assert
    expect(folder?.name).toBe("project");
  });

  it("ask: false なら、許可が要るときは許可を求めずに null（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    await p.pickFolder();
    root.permission = "prompt";
    // Act
    const folder = await p.reopenRecent({ ask: false });
    // Assert
    expect(folder).toBeNull();
    expect(root.permission).toBe("prompt"); // 求めていない
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
    const version = await p.writeSibling(ref, "a.layout.json", "{}", null);
    const file = await p.readSibling(ref, "a.layout.json");
    // Assert
    expect(p.hasSiblings(ref)).toBe(true);
    expect(file).toEqual({ text: "{}", version });
    expect((root.entries.get("models") as FakeDir).entries.get("a.layout.json")).toBeInstanceOf(FakeFile);
  });

  it("隣のファイルは、読んだときの版と同じなら上書きし、新しい版を返す（F-FILE-7）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    const layout = root.put("a.layout.json", "L1");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    const { version } = (await p.readSibling(ref, "a.layout.json"))!;
    // Act
    const next = await p.writeSibling(ref, "a.layout.json", "L2", version);
    // Assert
    expect(layout.content).toBe("L2");
    expect(next).not.toBe(version);
  });

  it("隣のファイルが読んだ後に他で変更されていたら ConflictError で、内容は変えない（異常系、F-FILE-7）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("models/a.sysml", "");
    const layout = root.put("models/a.layout.json", "L1");
    const es = await p.list((await p.pickFolder())!);
    const dir = es[0];
    const ref = dir?.kind === "dir" ? firstFile(dir.children) : firstFile(es);
    const { version } = (await p.readSibling(ref, "a.layout.json"))!;
    layout.externalWrite("theirs");
    // Act
    const act = p.writeSibling(ref, "a.layout.json", "mine", version);
    // Assert（競合の知らせは、配置ファイルのパスを書く）
    await expect(act).rejects.toBeInstanceOf(ConflictError);
    await expect(act).rejects.toThrow("models/a.layout.json は読み込んだ後に変更されています");
    expect(layout.content).toBe("theirs");
  });

  it("隣のファイルが読んだ後に消されていても、作り直して書く（境界値）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    root.put("a.layout.json", "L1");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    const { version } = (await p.readSibling(ref, "a.layout.json"))!;
    root.entries.delete("a.layout.json");
    // Act
    await p.writeSibling(ref, "a.layout.json", "L2", version);
    // Assert
    expect((root.entries.get("a.layout.json") as FakeFile).content).toBe("L2");
  });

  it("隣のファイルの版に null を渡すと比べずに上書きする（強制上書き）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    const layout = root.put("a.layout.json", "L1");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    layout.externalWrite("theirs");
    // Act
    await p.writeSibling(ref, "a.layout.json", "mine", null);
    // Assert
    expect(layout.content).toBe("mine");
  });

  it("隣のファイルが無ければ null（境界値: まだ作っていない）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "");
    const ref = firstFile(await p.list((await p.pickFolder())!));
    // Act
    const file = await p.readSibling(ref, "a.layout.json");
    // Assert
    expect(file).toBeNull();
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

describe("LocalFolderProvider: 1 つだけ開いたファイルをフォルダの中から探す（ADR-0005、F-VIEW-6）", () => {
  it("フォルダの中にあれば、フォルダから開いたファイルとして扱え、隣のファイルを読み書きできる", async () => {
    // Arrange
    const { api, p, root } = setup();
    api.openFile = root.put("sub/one.sysml", "package One;");
    const one = await p.pickFile();
    const folder = await p.pickFolder(one!);
    // Act
    const found = await p.locate(folder!, one!);
    await p.writeSibling(found!, "one.layout.json", "L", null);
    // Assert
    expect(api.startIn).toBe(api.openFile); // そのファイルのある場所から選び始める
    expect(found?.path).toBe("sub/one.sysml");
    expect(p.hasSiblings(found!)).toBe(true);
    expect((await p.readSibling(found!, "one.layout.json"))?.text).toBe("L");
  });

  it("フォルダの中に無ければ null（異常系: 別のフォルダを選んだ）", async () => {
    // Arrange
    const { api, p } = setup();
    api.openFile = new FakeDir("elsewhere").put("one.sysml", "");
    const one = await p.pickFile();
    const folder = await p.pickFolder(one!);
    // Act
    const found = await p.locate(folder!, one!);
    // Assert
    expect(found).toBeNull();
  });
});

describe("LocalFolderProvider: フォルダの中の決まった場所のファイル（ADR-0019、F-PROJ-1）", () => {
  it("フォルダの一番上のファイルを読める（一覧に出ないファイルも）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("modelith.json", '{ "name": "給水システム" }');
    const folder = (await p.pickFolder())!;
    // Act
    const text = await p.readInFolder(folder, "modelith.json");
    // Assert
    expect(text).toBe('{ "name": "給水システム" }');
    expect(await p.list(folder)).toEqual([]); // 一覧はモデルのファイルだけのまま
  });

  it("無いファイルは null（境界値: ファイルが無い・途中のフォルダが無い・名前が空）", async () => {
    // Arrange
    const { p } = setup();
    const folder = (await p.pickFolder())!;
    // Act
    const texts = await Promise.all(["modelith.json", "none/a.json", ""].map((path) => p.readInFolder(folder, path)));
    // Assert
    expect(texts).toEqual([null, null, null]);
  });

  it("フォルダの中のファイルを、途中のフォルダごと作って書ける", async () => {
    // Arrange
    const { p, root } = setup();
    const folder = (await p.pickFolder())!;
    // Act
    await p.writeInFolder(folder, "modelith.json", "{}\n");
    await p.writeInFolder(folder, ".modelith/x.json", "X");
    // Assert
    expect((root.entries.get("modelith.json") as FakeFile).content).toBe("{}\n");
    expect(await p.readInFolder(folder, ".modelith/x.json")).toBe("X");
  });

  it("あるファイルに書くと、内容を置き換える", async () => {
    // Arrange
    const { p, root } = setup();
    const file = root.put("modelith.json", "old");
    const folder = (await p.pickFolder())!;
    // Act
    await p.writeInFolder(folder, "modelith.json", "new");
    // Assert
    expect(file.content).toBe("new");
  });

  it("名前が空・開いていないフォルダには書けない（異常系）", async () => {
    // Arrange
    const { p } = setup();
    const folder = (await p.pickFolder())!;
    const other = { provider: "local", id: "dir:99", name: "x" };
    // Act & Assert
    await expect(p.writeInFolder(folder, "", "x")).rejects.toThrow("ファイル名がありません");
    await expect(p.writeInFolder(other, "modelith.json", "x")).rejects.toThrow("フォルダ「x」は開かれていません");
  });
});

describe("LocalFolderProvider: プラグインのフォルダを写す・消す（F-PLUG-8）", () => {
  it("別のフォルダを、読むだけで選び、前回のフォルダとしては覚えない", async () => {
    // Arrange
    const { api, store, p } = setup();
    api.folder = new FakeDir("trace-rules");
    // Act
    const picked = await p.pickOtherFolder();
    // Assert
    expect(picked?.name).toBe("trace-rules");
    expect(api.mode).toBe("read");
    expect(store.map.size).toBe(0);
  });

  it("別のフォルダの選択をやめたら null（異常系: キャンセル）", async () => {
    // Arrange
    const { api, p } = setup();
    api.folder = null;
    // Act
    const picked = await p.pickOtherFolder();
    // Assert
    expect(picked).toBeNull();
  });

  it("フォルダの中を、下のフォルダまで相対パスで読む（隠しファイル・node_modules は読まない）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put(".modelith/plugins/jp.x/modelith-plugin.json", "{}");
    root.put(".modelith/plugins/jp.x/rules/a.yaml", "rules: []");
    root.put(".modelith/plugins/jp.x/.git/config", "x");
    root.put(".modelith/plugins/jp.x/.DS_Store", "x");
    root.put(".modelith/plugins/jp.x/node_modules/y.js", "x");
    const folder = (await p.pickFolder())!;
    // Act
    const tree = await p.readTree(folder, ".modelith/plugins/jp.x");
    // Assert
    expect(tree).toEqual({ "modelith-plugin.json": "{}", "rules/a.yaml": "rules: []" });
  });

  it("無いフォルダは null、空のフォルダは空（境界値）", async () => {
    // Arrange
    const { p, root } = setup();
    await root.getDirectoryHandle("empty", { create: true });
    const folder = (await p.pickFolder())!;
    // Act
    const [none, empty] = await Promise.all([p.readTree(folder, "none"), p.readTree(folder, "empty")]);
    // Assert
    expect([none, empty]).toEqual([null, {}]);
  });

  it("ファイルが上限を超えるフォルダは読まない（境界値: 上限 + 1）", async () => {
    // Arrange
    const { p, root } = setup();
    for (let i = 0; i <= MAX_TREE_FILES; i++) root.put(`big/f${i}.txt`, "");
    root.put(`ok/f.txt`, "");
    const folder = (await p.pickFolder())!;
    // Act & Assert
    await expect(p.readTree(folder, "big")).rejects.toThrow(`ファイルが多すぎます（${MAX_TREE_FILES} 件まで）`);
    await expect(p.readTree(folder, "ok")).resolves.toEqual({ "f.txt": "" });
  });

  it("フォルダを中身ごと消し、無ければ false", async () => {
    // Arrange
    const { p, root } = setup();
    root.put(".modelith/plugins/jp.x/rules/a.yaml", "x");
    root.put(".modelith/plugins/jp.y/modelith-plugin.json", "{}");
    const folder = (await p.pickFolder())!;
    // Act
    const removed = await p.removeInFolder(folder, ".modelith/plugins/jp.x");
    const again = await p.removeInFolder(folder, ".modelith/plugins/jp.x");
    // Assert
    expect([removed, again]).toEqual([true, false]);
    expect(await p.readTree(folder, ".modelith/plugins")).toEqual({ "jp.y/modelith-plugin.json": "{}" });
  });

  it("フォルダの外を指すパス・空のパスは、読み書きも消しもしない（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "keep");
    const folder = (await p.pickFolder())!;
    // Act & Assert
    await expect(p.writeInFolder(folder, ".modelith/plugins/x/../../a.sysml", "bad")).rejects.toThrow("フォルダの外を指しています");
    await expect(p.readInFolder(folder, "../a.sysml")).rejects.toThrow("フォルダの外を指しています");
    await expect(p.readTree(folder, "./x")).rejects.toThrow("フォルダの外を指しています");
    await expect(p.removeInFolder(folder, "x/..")).rejects.toThrow("フォルダの外を指しています");
    await expect(p.removeInFolder(folder, "")).rejects.toThrow("消す場所がありません");
    expect((root.entries.get("a.sysml") as FakeFile).content).toBe("keep");
  });
});

describe("LocalFolderProvider: フォルダを作る・動かす（F-FILE-19）", () => {
  it("空のフォルダを作る（途中のフォルダも作る）", async () => {
    // Arrange
    const { p, root } = setup();
    const folder = await p.pickFolder();
    // Act
    await p.createFolder(folder!, "models/parts");
    // Assert
    expect(paths(await p.list(folder!))).toEqual(["models/", "models/parts/"]);
    expect(root.entries.get("models")).toBeInstanceOf(FakeDir);
  });

  it("同じ名前のファイルかフォルダがあれば作らない（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("models/a.sysml", "");
    root.put("x.sysml", "");
    const folder = await p.pickFolder();
    // Act・Assert
    await expect(p.createFolder(folder!, "models")).rejects.toThrow("「models」は既にあります");
    await expect(p.createFolder(folder!, "x.sysml")).rejects.toThrow("「x.sysml」は既にあります");
    await expect(p.createFolder(folder!, "")).rejects.toThrow("フォルダ名がありません");
  });

  it("ファイルの名前を変える（中身はそのまま、元のファイルは無くなる）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "package A;");
    const folder = await p.pickFolder();
    // Act
    await p.moveInFolder(folder!, "a.sysml", "b.sysml");
    // Assert
    expect(paths(await p.list(folder!))).toEqual(["b.sysml"]);
    expect((root.entries.get("b.sysml") as FakeFile).content).toBe("package A;");
  });

  it("フォルダの名前を変えると、モデルのファイル以外も含めて中身ごと動かす", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("models/a.sysml", "package A;");
    root.put("models/sub/b.sysml", "package B;");
    root.put("models/notes.md", "メモ");
    const folder = await p.pickFolder();
    // Act
    await p.moveInFolder(folder!, "models", "parts");
    // Assert
    expect(paths(await p.list(folder!))).toEqual(["parts/", "parts/sub/", "parts/sub/b.sysml", "parts/a.sysml"]);
    expect(root.entries.has("models")).toBe(false);
    expect(await p.readInFolder(folder!, "parts/notes.md")).toBe("メモ");
    expect(await p.readInFolder(folder!, "parts/sub/b.sysml")).toBe("package B;");
  });

  it("動かす先に何かある・元が無い・自分の中へ動かすときは動かさない（異常系）", async () => {
    // Arrange
    const { p, root } = setup();
    root.put("a.sysml", "A");
    root.put("b.sysml", "B");
    root.put("models/c.sysml", "");
    const folder = await p.pickFolder();
    // Act・Assert
    await expect(p.moveInFolder(folder!, "a.sysml", "b.sysml")).rejects.toThrow("「b.sysml」は既にあります");
    await expect(p.moveInFolder(folder!, "none.sysml", "x.sysml")).rejects.toThrow("「none.sysml」が見つかりません");
    await expect(p.moveInFolder(folder!, "models", "models/inner")).rejects.toThrow("「models」を、その中へは動かせません");
    expect((root.entries.get("a.sysml") as FakeFile).content).toBe("A");
    expect((root.entries.get("b.sysml") as FakeFile).content).toBe("B");
  });
});

describe("segmentsOf（フォルダからの相対パス）", () => {
  it.each([
    ["a/b.json", ["a", "b.json"]],
    ["a//b/", ["a", "b"]],
    ["", []],
    [".modelith/plugins/jp.x", [".modelith", "plugins", "jp.x"]],
  ])("%j → %j（正常系・境界値）", (path, segs) => {
    // Arrange・Act
    const got = segmentsOf(path);
    // Assert
    expect(got).toEqual(segs);
  });

  it.each(["..", "a/../b", "./a", "a\\b"])("%j はフォルダの外を指すとみなす（異常系）", (path) => {
    // Arrange・Act & Assert
    expect(() => segmentsOf(path)).toThrow("フォルダの外を指しています");
  });
});
