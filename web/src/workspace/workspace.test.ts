import { describe, expect, it } from "vitest";
import { BrowserFileProvider } from "../files/browser-file";
import { FakeDir, FakeFsApi, MemoryHandleStore } from "../files/fake-fs";
import { LocalFolderProvider } from "../files/local-folder";
import { ProviderRegistry, type DirEntry, type FileRef } from "../files/types";
import { AutoSaver, type Timer } from "./autosave";
import { kvDraftStore } from "./drafts";
import { Workspace, suggestName, type SaveOutcome } from "./workspace";

function setup() {
  const api = new FakeFsApi();
  const local = new LocalFolderProvider(api, new MemoryHandleStore());
  const downloads: string[] = [];
  const browser = new BrowserFileProvider({ choose: async () => null, download: (name) => downloads.push(name) });
  const kv = new Map<string, string>();
  const drafts = kvDraftStore({ get: (k) => kv.get(k) ?? null, set: (k, v) => kv.set(k, v) });
  const ws = new Workspace(new ProviderRegistry([local, browser]), drafts);
  const root = new FakeDir("project");
  api.folder = root;
  return { api, local, browser, downloads, kv, drafts, ws, root };
}

function fileIn(entries: DirEntry[], path: string): FileRef {
  for (const e of entries) {
    if (e.kind === "file" && e.ref.path === path) return e.ref;
    if (e.kind === "dir") {
      try {
        return fileIn(e.children, path);
      } catch {
        /* 次を探す */
      }
    }
  }
  throw new Error(`見つかりません: ${path}`);
}

/** フォルダを開き、a.sysml を開いた状態にする。 */
async function openA(s: ReturnType<typeof setup>, text = "package A;") {
  const file = s.root.put("a.sysml", text);
  await s.ws.openFolder(s.local);
  const doc = await s.ws.openRef(fileIn(s.ws.folder()!.entries, "a.sysml"));
  return { file, doc };
}

describe("Workspace: 開く・保存する（F-FILE-1・2・3・4）", () => {
  it("フォルダを開くと中のファイルが一覧され、開いた文書は変更なしで表示中になる", async () => {
    // Arrange
    const s = setup();
    // Act
    const { doc } = await openA(s);
    // Assert
    expect(s.ws.active()?.key).toBe(doc.key);
    expect(doc.text).toBe("package A;");
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("編集すると変更ありになり、保存すると元のファイルが上書きされて変更なしに戻る", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s);
    s.ws.setText(doc.key, "package A2;");
    // Act
    const outcome = await s.ws.save(doc.key, s.browser);
    // Assert
    expect(outcome).toBe("saved");
    expect(file.content).toBe("package A2;");
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("同じファイルを開き直しても文書は増えず、未保存の変更も残る", async () => {
    // Arrange
    const s = setup();
    const { doc } = await openA(s);
    s.ws.setText(doc.key, "edited");
    // Act
    const again = await s.ws.openRef(doc.ref!);
    // Assert
    expect(again.key).toBe(doc.key);
    expect(s.ws.list()).toHaveLength(1);
    expect(again.text).toBe("edited");
  });

  it("複数の文書を切り替えても、それぞれの未保存の変更は残る", async () => {
    // Arrange
    const s = setup();
    s.root.put("b.sysml", "package B;");
    const { doc: a } = await openA(s);
    const b = await s.ws.openRef(fileIn(s.ws.folder()!.entries, "b.sysml"));
    s.ws.setText(a.key, "A edited");
    // Act
    s.ws.activate(b.key);
    s.ws.activate(a.key);
    // Assert
    expect(s.ws.get(a.key)?.text).toBe("A edited");
    expect(s.ws.get(b.key)?.text).toBe("package B;");
  });

  it("フォルダに新しいファイルを作って開ける", async () => {
    // Arrange
    const s = setup();
    await s.ws.openFolder(s.local);
    // Act
    const doc = await s.ws.createFile("new.sysml", "package N;");
    // Assert
    expect(doc.ref?.path).toBe("new.sysml");
    expect(s.ws.folder()?.entries.map((e) => (e.kind === "file" ? e.ref.path : e.path))).toEqual(["new.sysml"]);
  });

  it("フォルダの選択をやめたら何も変わらない（異常系）", async () => {
    // Arrange
    const s = setup();
    s.api.folder = null;
    // Act
    const opened = await s.ws.openFolder(s.local);
    // Assert
    expect(opened).toBe(false);
    expect(s.ws.folder()).toBeNull();
  });
});

describe("Workspace: 無題の文書と名前を付けて保存（F-FILE-3・10・11）", () => {
  it("無題の文書は下書きとして保存され、次回に戻せる", () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("無題", "package U;");
    s.ws.setText(doc.key, "package U2;");
    const next = new Workspace(new ProviderRegistry([s.local, s.browser]), s.drafts);
    // Act
    const n = next.restoreDrafts();
    // Assert
    expect(n).toBe(1);
    expect(next.list()[0]?.text).toBe("package U2;");
  });

  it("無題の文書を保存すると保存先を選ばせ、以後はそのファイルの文書になり下書きから消える", async () => {
    // Arrange
    const s = setup();
    const target = new FakeDir("x").put("saved.sysml", "");
    s.api.saveTo = target;
    const doc = s.ws.newUntitled("無題", "package U;");
    // Act
    const outcome = await s.ws.save(doc.key, s.local);
    // Assert
    expect(outcome).toBe("saved");
    expect(target.content).toBe("package U;");
    expect(doc.ref?.name).toBe("saved.sysml");
    expect(s.drafts.load()).toEqual([]);
  });

  it("保存先の選択をやめたら無題のまま（異常系）", async () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("無題", "x");
    // Act
    const outcome = await s.ws.save(doc.key, s.local);
    // Assert
    expect(outcome).toBe("cancelled");
    expect(doc.ref).toBeNull();
  });

  it("上書きできないストレージでは、保存がダウンロードになる", async () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("model", "x");
    // Act
    await s.ws.save(doc.key, s.browser);
    s.ws.setText(doc.key, "y");
    await s.ws.save(doc.key, s.browser);
    // Assert
    expect(s.downloads).toEqual(["model.sysml", "model.sysml"]);
    expect(s.ws.canWriteInPlace(doc)).toBe(false);
  });

  it("保存名に拡張子が無ければ .sysml を付け、使えない文字は置き換える（境界値）", () => {
    // Arrange
    const names = ["model", "a.sysml", "b.KERML", "x/y:z"];
    // Act
    const out = names.map(suggestName);
    // Assert
    expect(out).toEqual(["model.sysml", "a.sysml", "b.KERML", "x_y_z.sysml"]);
  });
});

describe("Workspace: 未保存の変更と競合（F-FILE-5・7・8）", () => {
  it("ページを離れると失われる変更は、保存先のある文書の未保存の変更だけ", async () => {
    // Arrange
    const s = setup();
    const untitled = s.ws.newUntitled("無題", "u");
    s.ws.setText(untitled.key, "u2");
    const { doc } = await openA(s);
    const before = s.ws.hasUnsavedFiles();
    // Act
    s.ws.setText(doc.key, "changed");
    // Assert
    expect(before).toBe(false);
    expect(s.ws.hasUnsavedFiles()).toBe(true);
  });

  it("開いた後に他で変更されたファイルは上書きせず conflict を返し、ファイルはそのまま", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s);
    file.externalWrite("theirs");
    s.ws.setText(doc.key, "mine");
    // Act
    const outcome = await s.ws.save(doc.key, s.browser);
    // Assert
    expect(outcome).toBe("conflict");
    expect(file.content).toBe("theirs");
    expect(doc.stale).toBe(true);
  });

  it("競合しても強制すれば上書きできる", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s);
    file.externalWrite("theirs");
    s.ws.setText(doc.key, "mine");
    // Act
    const outcome = await s.ws.save(doc.key, s.browser, { force: true });
    // Assert
    expect(outcome).toBe("saved");
    expect(file.content).toBe("mine");
  });

  it("読み直すと未保存の変更を捨てて、ファイルの内容になる", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s);
    file.externalWrite("theirs");
    s.ws.setText(doc.key, "mine");
    // Act
    await s.ws.reload(doc.key);
    // Assert
    expect(doc.text).toBe("theirs");
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("他での変更は、未保存の変更が無ければ読み直し、あれば読み直さずに印を付ける", async () => {
    // Arrange
    const s = setup();
    const { file: fa, doc: a } = await openA(s);
    const fb = s.root.put("b.sysml", "B");
    await s.ws.refreshFolder();
    const b = await s.ws.openRef(fileIn(s.ws.folder()!.entries, "b.sysml"));
    s.ws.setText(b.key, "B edited");
    fa.externalWrite("A theirs");
    fb.externalWrite("B theirs");
    // Act
    const reloaded = await s.ws.checkExternal();
    // Assert
    expect(reloaded).toEqual([a.key]);
    expect(a.text).toBe("A theirs");
    expect(b.text).toBe("B edited");
    expect(b.stale).toBe(true);
  });

  it("他で変更されていなければ何もしない（境界値: 変更なし）", async () => {
    // Arrange
    const s = setup();
    await openA(s);
    let notified = 0;
    s.ws.subscribe(() => notified++);
    // Act
    const reloaded = await s.ws.checkExternal();
    // Assert
    expect(reloaded).toEqual([]);
    expect(notified).toBe(0);
  });

  it("表示中の文書を閉じると隣の文書に切り替わり、最後の 1 つを閉じると表示中は無くなる", () => {
    // Arrange
    const s = setup();
    const a = s.ws.newUntitled("a", "");
    const b = s.ws.newUntitled("b", "");
    // Act
    s.ws.close(b.key);
    const afterFirst = s.ws.active()?.key;
    s.ws.close(a.key);
    // Assert
    expect(afterFirst).toBe(a.key);
    expect(s.ws.active()).toBeNull();
  });
});

/** 手で進めるタイマー。 */
class ManualTimer implements Timer {
  private tasks = new Map<number, { fn: () => void; at: number }>();
  private now = 0;
  private seq = 0;
  set(fn: () => void, ms: number): number {
    this.tasks.set(++this.seq, { fn, at: this.now + ms });
    return this.seq;
  }
  clear(h: unknown): void {
    this.tasks.delete(h as number);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.tasks]) {
      if (t.at <= this.now) {
        this.tasks.delete(id);
        t.fn();
      }
    }
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("AutoSaver（F-FILE-6）", () => {
  async function setupAuto(enabled = true) {
    const s = setup();
    const { file, doc } = await openA(s);
    const timer = new ManualTimer();
    const outcomes: SaveOutcome[] = [];
    const auto = new AutoSaver(s.ws, timer, () => enabled, (_k, o) => outcomes.push(o), 1000);
    return { ...s, file, doc, timer, auto, outcomes };
  }

  it("編集が止まってから 1 秒後に保存する（境界値: 999ms では保存しない）", async () => {
    // Arrange
    const a = await setupAuto();
    a.ws.setText(a.doc.key, "v1");
    a.auto.notify(a.doc.key);
    // Act
    a.timer.advance(999);
    const before = a.file.content;
    a.timer.advance(1);
    await flush();
    // Assert
    expect(before).toBe("package A;");
    expect(a.file.content).toBe("v1");
    expect(a.outcomes).toEqual(["saved"]);
  });

  it("続けて編集すると待ち時間をやり直し、最後の内容を 1 回だけ保存する", async () => {
    // Arrange
    const a = await setupAuto();
    a.ws.setText(a.doc.key, "v1");
    a.auto.notify(a.doc.key);
    a.timer.advance(800);
    a.ws.setText(a.doc.key, "v2");
    a.auto.notify(a.doc.key);
    // Act
    a.timer.advance(800);
    const mid = a.file.content;
    a.timer.advance(200);
    await flush();
    // Assert
    expect(mid).toBe("package A;");
    expect(a.file.content).toBe("v2");
    expect(a.outcomes).toEqual(["saved"]);
  });

  it("無効なら保存しない（異常系）", async () => {
    // Arrange
    const a = await setupAuto(false);
    a.ws.setText(a.doc.key, "v1");
    // Act
    a.auto.notify(a.doc.key);
    a.timer.advance(5000);
    await flush();
    // Assert
    expect(a.file.content).toBe("package A;");
  });

  it("保存先を選ばせる必要がある無題の文書は自動保存しない", async () => {
    // Arrange
    const a = await setupAuto();
    const u = a.ws.newUntitled("無題", "x");
    a.ws.setText(u.key, "y");
    // Act
    a.auto.notify(u.key);
    a.timer.advance(5000);
    await flush();
    // Assert
    expect(a.outcomes).toEqual([]);
    expect(u.ref).toBeNull();
  });

  it("他で変更されていたら上書きせず、conflict を知らせる", async () => {
    // Arrange
    const a = await setupAuto();
    a.file.externalWrite("theirs");
    a.ws.setText(a.doc.key, "mine");
    a.auto.notify(a.doc.key);
    // Act
    a.timer.advance(1000);
    await flush();
    // Assert
    expect(a.outcomes).toEqual(["conflict"]);
    expect(a.file.content).toBe("theirs");
  });
});

describe("kvDraftStore", () => {
  it("壊れた下書きは読まない（異常系）", () => {
    // Arrange
    const store = kvDraftStore({ get: () => "{not json", set: () => {} });
    // Act
    const drafts = store.load();
    // Assert
    expect(drafts).toEqual([]);
  });

  it("形の合わない項目は捨てる", () => {
    // Arrange
    const store = kvDraftStore({ get: () => JSON.stringify([{ name: "a", text: "x" }, { name: 1 }, null]), set: () => {} });
    // Act
    const drafts = store.load();
    // Assert
    expect(drafts).toEqual([{ name: "a", text: "x" }]);
  });
});
