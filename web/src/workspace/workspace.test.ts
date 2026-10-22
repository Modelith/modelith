import { describe, expect, it } from "vitest";
import { BrowserFileProvider, type PickedFile } from "../files/browser-file";
import { FakeDir, FakeFile, FakeFsApi, MemoryHandleStore } from "../files/fake-fs";
import { LocalFolderProvider } from "../files/local-folder";
import { ProviderRegistry, type DirEntry, type FileRef } from "../files/types";
import { AutoSaver, failureReason, type AutoSaveOutcome, type Timer } from "./autosave";
import { kvDraftStore } from "./drafts";
import { kvSessionStore } from "./session";
import { PROJECT_FILE, Workspace, suggestName } from "./workspace";

function setup() {
  const api = new FakeFsApi();
  const local = new LocalFolderProvider(api, new MemoryHandleStore());
  const downloads: string[] = [];
  let picked: PickedFile[] = [];
  const browser = new BrowserFileProvider({ choose: async () => picked, download: (name) => downloads.push(name) });
  const kv = new Map<string, string>();
  /** 下書き・前回の続きの保存先。full にすると、保存領域がいっぱいのブラウザのように書けなくなる。 */
  const storage = { full: false };
  const kvStore = { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => !storage.full && !!kv.set(k, v) };
  const drafts = kvDraftStore(kvStore);
  const sessions = kvSessionStore(kvStore);
  const ws = new Workspace(new ProviderRegistry([local, browser]), drafts, sessions);
  const root = new FakeDir("project");
  api.folder = root;
  /** 次に「ファイルを開く」で選ぶファイル（フォルダを開けないブラウザ）。 */
  const pick = (files: PickedFile[]): void => {
    picked = files;
  };
  return { api, local, browser, downloads, kv, drafts, sessions, ws, root, pick, storage };
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
    const start = next.restoreDrafts();
    // Assert
    expect(start).toBe("drafts");
    expect(next.list()[0]?.text).toBe("package U2;");
  });

  it("無題の文書を開いているフォルダに名前を付けて保存すると、以後はそのファイルの文書になり下書きから消える", async () => {
    // Arrange
    const s = setup();
    await s.ws.openFolder(s.local);
    const doc = s.ws.newUntitled("無題", "package U;");
    // Act
    await s.ws.saveToFolder(doc.key, "models/u.sysml");
    // Assert
    expect((s.root.entries.get("models") as FakeDir).entries.get("u.sysml")).toMatchObject({ content: "package U;" });
    expect(doc.ref?.path).toBe("models/u.sysml");
    expect(s.ws.isDirty(doc)).toBe(false);
    expect(s.drafts.load().drafts).toEqual([]);
    expect(fileIn(s.ws.folder()!.entries, "models/u.sysml")).toBeTruthy();
  });

  it("同じ名前のファイルがあれば保存せず、無題のまま（異常系）", async () => {
    // Arrange
    const s = setup();
    s.root.put("u.sysml", "keep");
    await s.ws.openFolder(s.local);
    const doc = s.ws.newUntitled("無題", "package U;");
    // Act
    const act = s.ws.saveToFolder(doc.key, "u.sysml");
    // Assert
    await expect(act).rejects.toThrow("既にあります");
    expect(doc.ref).toBeNull();
  });

  it("保存先の選択をやめたら無題のまま（異常系）", async () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("無題", "x");
    // Act
    const outcome = await s.ws.save(doc.key, { id: "t", label: "t", saveAs: async () => null });
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
    const outcomes: AutoSaveOutcome[] = [];
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

  it("保存が例外で失敗したら（フォルダの許可が切れた）、理由を知らせて未保存のままにする（異常系）", async () => {
    // Arrange
    const a = await setupAuto();
    const revoked = new DOMException("permission revoked", "NotAllowedError");
    a.file.createWritable = async () => {
      throw revoked;
    };
    a.ws.setText(a.doc.key, "mine");
    a.auto.notify(a.doc.key);
    // Act
    a.timer.advance(1000);
    await flush();
    // Assert
    expect(a.outcomes).toEqual([{ failed: revoked }]);
    expect(a.ws.isDirty(a.doc)).toBe(true);
    expect(a.file.content).toBe("package A;");
  });

  it("失敗の後に編集すると、もう一度保存を試みる", async () => {
    // Arrange
    const a = await setupAuto();
    const original = a.file.createWritable.bind(a.file);
    const full = new DOMException("disk full", "QuotaExceededError");
    a.file.createWritable = async () => {
      throw full;
    };
    a.ws.setText(a.doc.key, "v1");
    a.auto.notify(a.doc.key);
    a.timer.advance(1000);
    await flush();
    a.file.createWritable = original;
    a.ws.setText(a.doc.key, "v2");
    a.auto.notify(a.doc.key);
    // Act
    a.timer.advance(1000);
    await flush();
    // Assert
    expect(a.outcomes).toEqual([{ failed: full }, "saved"]);
    expect(a.file.content).toBe("v2");
  });
});

describe("failureReason（F-FILE-6）", () => {
  it.each<[string, unknown, string]>([
    ["Error はメッセージ", new DOMException("permission revoked", "NotAllowedError"), "permission revoked"],
    ["文字列はそのまま", "disk full", "disk full"],
    ["メッセージの無い Error は空（境界）", new Error(), ""],
    ["undefined は文字列にする（境界）", undefined, "undefined"],
  ])("%s", (_, e, expected) => {
    // Arrange・Act
    const reason = failureReason(e);
    // Assert
    expect(reason).toBe(expected);
  });
});

describe("kvDraftStore", () => {
  it("壊れた下書きは読まない（異常系）", () => {
    // Arrange
    const store = kvDraftStore({ get: () => "{not json", set: () => true });
    // Act
    const state = store.load();
    // Assert
    expect(state).toEqual({ drafts: [], closedAll: false });
  });

  it("形の合わない項目は捨てる", () => {
    // Arrange
    const store = kvDraftStore({ get: (k) => (k === "modelith-drafts-v1" ? JSON.stringify([{ name: "a", text: "x" }, { name: 1 }, null]) : null), set: () => true });
    // Act
    const state = store.load();
    // Assert
    expect(state.drafts).toEqual([{ name: "a", text: "x" }]);
  });

  it("まだ何も置いていなければ、下書きは無く、すべて閉じて終えたことにもならない（境界）", () => {
    // Arrange
    const store = kvDraftStore({ get: () => null, set: () => true });
    // Act
    const state = store.load();
    // Assert
    expect(state).toEqual({ drafts: [], closedAll: false });
  });

  it("置いた下書きと、すべて閉じて終えたことを読み戻せる（F-FILE-14）", () => {
    // Arrange
    const kv = new Map<string, string>();
    const store = kvDraftStore({ get: (k) => kv.get(k) ?? null, set: (k, v) => !!kv.set(k, v) });
    // Act
    store.save({ drafts: [], closedAll: true });
    // Assert
    expect(store.load()).toEqual({ drafts: [], closedAll: true });
  });

  it("下書きは以前の版と同じ形（配列）で置く", () => {
    // Arrange
    const kv = new Map<string, string>();
    const store = kvDraftStore({ get: (k) => kv.get(k) ?? null, set: (k, v) => !!kv.set(k, v) });
    // Act
    store.save({ drafts: [{ name: "a", text: "x" }], closedAll: false });
    // Assert
    expect(JSON.parse(kv.get("modelith-drafts-v1") ?? "")).toEqual([{ name: "a", text: "x" }]);
  });

  it("置けたら true を返す", () => {
    // Arrange
    const store = kvDraftStore({ get: () => null, set: () => true });
    // Act
    const saved = store.save({ drafts: [{ name: "a", text: "x" }], closedAll: false });
    // Assert
    expect(saved).toBe(true);
  });

  it("保存先に書けなければ false を返す（異常系：保存領域がいっぱい）", () => {
    // Arrange
    const store = kvDraftStore({ get: () => null, set: () => false });
    // Act
    const saved = store.save({ drafts: [{ name: "a", text: "x" }], closedAll: false });
    // Assert
    expect(saved).toBe(false);
  });
});

describe("Workspace: 下書きを置けないとき（F-FILE-11・F-FILE-5）", () => {
  it("置けなくなったら印を付けて変更を知らせ、中身のある無題の文書を閉じる前の警告の対象にする（異常系）", () => {
    // Arrange
    const s = setup();
    const u = s.ws.newUntitled("無題", "package U;");
    let notified = 0;
    s.ws.subscribe(() => notified++);
    s.storage.full = true;
    // Act
    s.ws.setText(u.key, "package U; // more");
    // Assert
    expect(s.ws.hasLostDrafts()).toBe(true);
    expect(s.ws.hasUnsavedFiles()).toBe(true);
    expect(notified).toBeGreaterThanOrEqual(1);
  });

  it("置けている間は、無題の文書を編集しても警告の対象にしない（正常系）", () => {
    // Arrange
    const s = setup();
    const u = s.ws.newUntitled("無題", "package U;");
    // Act
    s.ws.setText(u.key, "package U; // more");
    // Assert
    expect(s.ws.hasLostDrafts()).toBe(false);
    expect(s.ws.hasUnsavedFiles()).toBe(false);
  });

  it("置けないまま続けて編集しても、変更の知らせは置けなくなったときの 1 回だけ（知らせは毎回出さない）", () => {
    // Arrange
    const s = setup();
    const u = s.ws.newUntitled("無題", "package U;");
    s.ws.setText(u.key, "package U; // 1"); // 未保存の印が付く知らせを先に済ませる
    s.storage.full = true;
    let notified = 0;
    s.ws.subscribe(() => notified++);
    // Act
    s.ws.setText(u.key, "package U; // 2");
    s.ws.setText(u.key, "package U; // 3");
    s.ws.setText(u.key, "package U; // 4");
    // Assert
    expect(notified).toBe(1);
  });

  it("置けるようになったら印を消し、警告の対象から外す（境界：回復）", () => {
    // Arrange
    const s = setup();
    const u = s.ws.newUntitled("無題", "package U;");
    s.storage.full = true;
    s.ws.setText(u.key, "package U; // 1");
    s.storage.full = false;
    // Act
    s.ws.setText(u.key, "package U; // 2");
    // Assert
    expect(s.ws.hasLostDrafts()).toBe(false);
    expect(s.ws.hasUnsavedFiles()).toBe(false);
  });

  it("置けなくても、中身の無い無題の文書だけなら警告しない（境界）", () => {
    // Arrange
    const s = setup();
    const u = s.ws.newUntitled("無題", "x");
    s.storage.full = true;
    // Act
    s.ws.setText(u.key, "   ");
    // Assert
    expect(s.ws.hasUnsavedFiles()).toBe(false);
  });
});

describe("Workspace: すべて閉じた状態と中身の無い下書き（F-FILE-11・F-FILE-14）", () => {
  /**
   * 同じ下書きの保存先で、次に開いたときのワークスペースを作る。
   *
   * @param s setup() の結果
   * @returns 新しいワークスペース
   */
  const nextStart = (s: ReturnType<typeof setup>): Workspace => new Workspace(new ProviderRegistry([s.local, s.browser]), s.drafts);

  it("初めて開いたときはサンプルを出す", () => {
    // Arrange
    const s = setup();
    // Act
    const start = s.ws.restoreDrafts();
    // Assert
    expect(start).toBe("sample");
  });

  it("最後の文書を閉じても、新しい文書は作らない", () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("u.sysml", "package U;");
    // Act
    s.ws.close(doc.key);
    // Assert
    expect(s.ws.list()).toEqual([]);
    expect(s.ws.active()).toBeNull();
  });

  it("すべて閉じて終えたら、次は何も開かずに始める", () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("u.sysml", "package U;");
    s.ws.close(doc.key);
    // Act
    const start = nextStart(s).restoreDrafts();
    // Assert
    expect(start).toBe("nothing");
  });

  it("フォルダのファイルを最後に閉じても、すべて閉じたことを残す", async () => {
    // Arrange
    const s = setup();
    s.root.put("a.sysml", "package A;");
    await s.ws.openFolder(s.local);
    const doc = await s.ws.openRef(fileIn(s.ws.folder()!.entries, "a.sysml"));
    // Act
    s.ws.close(doc.key);
    // Assert
    expect(nextStart(s).restoreDrafts()).toBe("nothing");
  });

  it("すべて閉じた後にファイルを開いたら、次はサンプルを出す（すべて閉じたことを消す）", async () => {
    // Arrange
    const s = setup();
    s.root.put("a.sysml", "package A;");
    await s.ws.openFolder(s.local);
    const untitled = s.ws.newUntitled("u.sysml", "package U;");
    s.ws.close(untitled.key);
    // Act
    await s.ws.openRef(fileIn(s.ws.folder()!.entries, "a.sysml"));
    // Assert
    expect(nextStart(s).restoreDrafts()).toBe("sample");
  });

  it("中身の無い無題の文書は下書きに残さず、次はサンプルを出す", () => {
    // Arrange
    const s = setup();
    s.ws.newUntitled("untitled-1.sysml", "");
    // Act
    const start = nextStart(s).restoreDrafts();
    // Assert
    expect(start).toBe("sample");
    expect(s.drafts.load().drafts).toEqual([]);
  });

  it("空白だけの無題の文書も、中身が無いとみなす（境界）", () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("untitled-1.sysml", "package U;");
    // Act
    s.ws.setText(doc.key, " \n\t");
    // Assert
    expect(s.drafts.load().drafts).toEqual([]);
  });

  it("1 文字でも中身があれば下書きに残す（境界）", () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("untitled-1.sysml", "");
    // Act
    s.ws.setText(doc.key, "p");
    // Assert
    expect(s.drafts.load().drafts).toEqual([{ name: "untitled-1.sysml", text: "p" }]);
  });

  it("以前の版が残した中身の無い下書きは戻さず、サンプルを出す（異常系）", () => {
    // Arrange
    const s = setup();
    s.kv.set("modelith-drafts-v1", JSON.stringify([{ name: "untitled-1.sysml", text: "" }]));
    // Act
    const start = s.ws.restoreDrafts();
    // Assert
    expect(start).toBe("sample");
    expect(s.ws.list()).toEqual([]);
  });

  it("中身のある下書きだけを戻す", () => {
    // Arrange
    const s = setup();
    s.kv.set("modelith-drafts-v1", JSON.stringify([{ name: "untitled-1.sysml", text: "" }, { name: "u.sysml", text: "package U;" }]));
    // Act
    const start = s.ws.restoreDrafts();
    // Assert
    expect(start).toBe("drafts");
    expect(s.ws.list().map((d) => d.name)).toEqual(["u.sysml"]);
  });
});

describe("Workspace: 配置ファイル（ADR-0005、F-VIEW-3・6、C-6）", () => {
  it("フォルダから開いた文書は、隣の配置ファイルを読む", async () => {
    // Arrange
    const s = setup();
    s.root.put("a.layout.json", "L1");
    // Act
    const { doc } = await openA(s);
    // Assert
    expect(doc).toMatchObject({ layout: "L1", savedLayout: "L1", layoutHome: "sibling" });
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("配置だけを変えて保存すると、配置ファイルだけを書き、テキストのファイルには触らない（C-6）", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s);
    const before = file.lastModified;
    s.ws.setLayout(doc.key, "L2");
    // Act
    const dirty = s.ws.isDirty(doc);
    const outcome = await s.ws.save(doc.key, s.browser);
    // Assert
    expect(dirty).toBe(true);
    expect(outcome).toBe("saved");
    expect((s.root.entries.get("a.layout.json") as { content: string }).content).toBe("L2");
    expect(file.lastModified).toBe(before);
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("テキストと配置の両方を変えて保存すると、両方を書く", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s);
    s.ws.setText(doc.key, "package B;");
    s.ws.setLayout(doc.key, "L3");
    // Act
    await s.ws.save(doc.key, s.browser);
    // Assert
    expect(file.content).toBe("package B;");
    expect((s.root.entries.get("a.layout.json") as { content: string }).content).toBe("L3");
  });

  it("配置ファイルが開いた後に他のアプリで変更されていたら、上書きせず conflict を返す（F-FILE-7）", async () => {
    // Arrange
    const s = setup();
    const layoutFile = s.root.put("a.layout.json", "L1");
    const { file, doc } = await openA(s);
    layoutFile.externalWrite("theirs");
    s.ws.setLayout(doc.key, "mine");
    // Act
    const outcome = await s.ws.save(doc.key, s.browser);
    // Assert（テキストのファイルには触らず、配置は未保存のまま）
    expect(outcome).toBe("conflict");
    expect(layoutFile.content).toBe("theirs");
    expect(doc.layoutStale).toBe(true);
    expect(doc.stale).toBe(false);
    expect(file.content).toBe("package A;");
    expect(s.ws.isDirty(doc)).toBe(true);
  });

  it("配置ファイルの競合も、強制すれば上書きする", async () => {
    // Arrange
    const s = setup();
    const layoutFile = s.root.put("a.layout.json", "L1");
    const { doc } = await openA(s);
    layoutFile.externalWrite("theirs");
    s.ws.setLayout(doc.key, "mine");
    // Act
    const outcome = await s.ws.save(doc.key, s.browser, { force: true });
    // Assert
    expect(outcome).toBe("saved");
    expect(layoutFile.content).toBe("mine");
    expect(doc.layoutStale).toBe(false);
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("配置ファイルの競合で読み直すと、自分の配置を捨てて配置ファイルの内容になる", async () => {
    // Arrange
    const s = setup();
    const layoutFile = s.root.put("a.layout.json", "L1");
    const { doc } = await openA(s);
    layoutFile.externalWrite("theirs");
    s.ws.setLayout(doc.key, "mine");
    await s.ws.save(doc.key, s.browser);
    // Act
    await s.ws.reload(doc.key);
    // Assert（読み直した版で、次の保存は競合しない）
    expect(doc).toMatchObject({ layout: "theirs", savedLayout: "theirs", layoutStale: false });
    s.ws.setLayout(doc.key, "L3");
    expect(await s.ws.save(doc.key, s.browser)).toBe("saved");
    expect(layoutFile.content).toBe("L3");
  });

  it("配置を変えていなければ、配置ファイルを作らない（境界値）", async () => {
    // Arrange
    const s = setup();
    const { doc } = await openA(s);
    s.ws.setText(doc.key, "package B;");
    // Act
    await s.ws.save(doc.key, s.browser);
    // Assert
    expect(s.root.entries.has("a.layout.json")).toBe(false);
  });

  it("1 つだけ選んで開いた文書は、配置の保存先が無いので「配置は未保存」になる（F-VIEW-6）", async () => {
    // Arrange
    const s = setup();
    s.api.openFile = s.root.put("one.sysml", "package One;");
    const doc = (await s.ws.openWith(s.local))!;
    // Act
    s.ws.setLayout(doc.key, "L4");
    // Assert
    expect(doc.layoutHome).toBe("none");
    expect(s.ws.layoutUnsaved(doc)).toBe(true);
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("開いたときの配置（古いコメントから読んだものなど）は、変更として数えない", async () => {
    // Arrange
    const s = setup();
    const { doc } = await openA(s);
    // Act
    s.ws.initLayout(doc.key, "L-legacy");
    // Assert
    expect(s.ws.isDirty(doc)).toBe(false);
    expect(doc.layout).toBe("L-legacy");
  });

  it("無題の文書の配置は、テキストと一緒に下書きに残る（F-FILE-11）", async () => {
    // Arrange
    const s = setup();
    const doc = s.ws.newUntitled("u.sysml", "package U;");
    s.ws.setLayout(doc.key, "L5");
    // Act
    const restored = new Workspace(new ProviderRegistry([s.local]), s.drafts);
    restored.restoreDrafts();
    // Assert
    expect(restored.list()[0]).toMatchObject({ text: "package U;", layout: "L5", layoutHome: "none" });
  });

  it("無題の文書をフォルダの中に名前を付けて保存すると、配置ファイルも一緒に作る", async () => {
    // Arrange
    const s = setup();
    await s.ws.openFolder(s.local);
    const doc = s.ws.newUntitled("u.sysml", "package U;", "L7");
    // Act
    await s.ws.saveToFolder(doc.key, "u.sysml");
    // Assert
    expect(doc.layoutHome).toBe("sibling");
    expect((s.root.entries.get("u.layout.json") as { content: string }).content).toBe("L7");
  });
});

describe("Workspace: 1 つだけ開いたファイルのフォルダを開く（ADR-0005、F-VIEW-6）", () => {
  async function openOne(s: ReturnType<typeof setup>, dir = s.root) {
    s.api.openFile = dir.put("one.sysml", "package One;");
    const doc = (await s.ws.openWith(s.local))!;
    s.ws.setLayout(doc.key, "L8");
    return doc;
  }

  it("そのファイルのあるフォルダを開くと、配置の保存先ができ、保存で隣の配置ファイルに書く", async () => {
    // Arrange
    const s = setup();
    const doc = await openOne(s);
    // Act
    const outcome = await s.ws.attachToFolder(doc.key, s.local);
    await s.ws.save(doc.key, s.browser);
    // Assert
    expect(outcome).toBe("attached");
    expect(s.ws.folder()?.ref.name).toBe("project");
    expect(s.ws.layoutUnsaved(doc)).toBe(false);
    expect((s.root.entries.get("one.layout.json") as { content: string }).content).toBe("L8");
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("選んだフォルダにそのファイルが無ければ、配置は未保存のまま（異常系）", async () => {
    // Arrange
    const s = setup();
    const doc = await openOne(s, new FakeDir("elsewhere"));
    // Act
    const outcome = await s.ws.attachToFolder(doc.key, s.local);
    // Assert
    expect(outcome).toBe("notInFolder");
    expect(s.ws.layoutUnsaved(doc)).toBe(true);
  });

  it("フォルダの選択をやめたら何も変わらない（異常系）", async () => {
    // Arrange
    const s = setup();
    const doc = await openOne(s);
    s.api.folder = null;
    // Act
    const outcome = await s.ws.attachToFolder(doc.key, s.local);
    // Assert
    expect(outcome).toBe("cancelled");
    expect(s.ws.folder()).toBeNull();
    expect(doc.layoutHome).toBe("none");
  });
});

describe("Workspace: 古い形式の配置の移行（ADR-0005、C-6）", () => {
  it("移すと、テキストからコメントを消し、次の保存でテキストと配置ファイルを一緒に書く", async () => {
    // Arrange
    const s = setup();
    const { file, doc } = await openA(s, "package A;\n/* @layout {} */\n");
    s.ws.initLayout(doc.key, "L-legacy");
    // Act
    s.ws.moveLegacyLayout(doc.key, "package A;\n");
    await s.ws.save(doc.key, s.browser);
    // Assert
    expect(file.content).toBe("package A;\n");
    expect((s.root.entries.get("a.layout.json") as { content: string }).content).toBe("L-legacy");
  });
});

describe("Workspace: フォルダを開けないブラウザの配置ファイル（ADR-0005、F-FILE-10・F-VIEW-6）", () => {
  it("モデルと配置ファイルを一緒に選ぶと、配置も読む", async () => {
    // Arrange
    const s = setup();
    s.pick([
      { name: "m.sysml", text: async () => "package M;" },
      { name: "m.layout.json", text: async () => "L9" },
    ]);
    // Act
    const doc = (await s.ws.openWith(s.browser))!;
    // Assert
    expect(doc.layout).toBe("L9");
    expect(s.ws.isDirty(doc)).toBe(false);
  });

  it("配置を変えると変更ありになり、保存でモデルと配置ファイルを両方ダウンロードする", async () => {
    // Arrange
    const s = setup();
    s.pick([{ name: "m.sysml", text: async () => "package M;" }]);
    const doc = (await s.ws.openWith(s.browser))!;
    s.ws.setLayout(doc.key, "L10");
    // Act
    const dirty = s.ws.isDirty(doc);
    await s.ws.save(doc.key, s.browser);
    // Assert
    expect(dirty).toBe(true);
    expect(s.downloads).toEqual(["m.sysml", "m.layout.json"]);
    expect(s.ws.isDirty(doc)).toBe(false);
  });
});

describe("Workspace: プロジェクトの設定ファイル（ADR-0019、F-PROJ-1、C-6）", () => {
  it("フォルダを開くと、一番上の modelith.json のテキストを読む", async () => {
    // Arrange
    const s = setup();
    s.root.put(PROJECT_FILE, '{ "name": "給水システム" }');
    // Act
    await s.ws.openFolder(s.local);
    // Assert
    expect(s.ws.folder()?.projectText).toBe('{ "name": "給水システム" }');
  });

  it("modelith.json の無いフォルダは null で、何も書かない（境界値: 下のフォルダにだけある）", async () => {
    // Arrange
    const s = setup();
    s.root.put("sub/modelith.json", "{}");
    // Act
    await s.ws.openFolder(s.local);
    // Assert
    expect(s.ws.folder()?.projectText).toBeNull();
    expect(s.root.entries.has(PROJECT_FILE)).toBe(false);
  });

  it("一覧を更新すると、他で作られた modelith.json も読み直す", async () => {
    // Arrange
    const s = setup();
    await s.ws.openFolder(s.local);
    s.root.put(PROJECT_FILE, "{}");
    // Act
    await s.ws.refreshFolder();
    // Assert
    expect(s.ws.folder()?.projectText).toBe("{}");
  });

  it("プロジェクトにすると、modelith.json を書いて読み直し、変更を知らせる", async () => {
    // Arrange
    const s = setup();
    await s.ws.openFolder(s.local);
    let notified = 0;
    s.ws.subscribe(() => notified++);
    // Act
    await s.ws.makeProject('{ "name": "A" }\n');
    // Assert
    expect((s.root.entries.get(PROJECT_FILE) as FakeFile).content).toBe('{ "name": "A" }\n');
    expect(s.ws.folder()?.projectText).toBe('{ "name": "A" }\n');
    expect(notified).toBeGreaterThan(0);
  });

  it("既に modelith.json があれば、上書きせずに断る（異常系: 開いた後に他で作られた）", async () => {
    // Arrange
    const s = setup();
    await s.ws.openFolder(s.local);
    const theirs = s.root.put(PROJECT_FILE, '{ "name": "theirs" }');
    // Act & Assert
    await expect(s.ws.makeProject("{}")).rejects.toThrow("このフォルダは既にプロジェクトです（modelith.json があります）");
    expect(theirs.content).toBe('{ "name": "theirs" }');
  });

  it("フォルダを開いていなければ断る（異常系）", async () => {
    // Arrange
    const s = setup();
    // Act & Assert
    await expect(s.ws.makeProject("{}")).rejects.toThrow("フォルダが開かれていません");
  });
});

describe("Workspace: 前回の続き（F-FILE-13）", () => {
  /**
   * 同じ保存先で、次に開いたときのワークスペースを作る。
   *
   * @param s setup() の結果
   * @returns 新しいワークスペース
   */
  const nextStart = (s: ReturnType<typeof setup>): Workspace => new Workspace(new ProviderRegistry([s.local, s.browser]), s.drafts, s.sessions);

  /** 無題の u.sysml・フォルダの a.sysml・models/b.sysml をこの順に開き、a.sysml を表示中にして終える。 */
  async function work(s: ReturnType<typeof setup>): Promise<void> {
    s.root.put("a.sysml", "package A;");
    s.root.put("models/b.sysml", "package B;");
    s.ws.holdSession(false);
    await s.ws.openFolder(s.local);
    s.ws.newUntitled("u.sysml", "package U;");
    const a = await s.ws.openRef(fileIn(s.ws.folder()!.entries, "a.sysml"));
    await s.ws.openRef(fileIn(s.ws.folder()!.entries, "models/b.sysml"));
    s.ws.activate(a.key);
  }

  /**
   * 次に開いたときの起動（下書きを戻し、許可を求めずにフォルダを開き直し、前回の続きを戻す）。
   *
   * @param s setup() の結果
   * @returns 新しいワークスペースと、開けなかったファイルのパス
   */
  async function restart(s: ReturnType<typeof setup>): Promise<{ next: Workspace; missing: string[] }> {
    const next = nextStart(s);
    next.restoreDrafts();
    await next.reopenFolder(s.local, { ask: false });
    const missing = await next.resumeSession(s.sessions.load()!);
    return { next, missing };
  }

  it("起動して戻し終えるまでは前回の続きを書き換えず、holdSession(false) で書く", async () => {
    // Arrange
    const s = setup();
    await work(s);
    const before = s.sessions.load();
    const next = nextStart(s);
    // Act
    next.newUntitled("x.sysml", "package X;");
    const held = s.sessions.load();
    next.holdSession(false);
    // Assert
    expect(held).toEqual(before);
    expect(s.sessions.load()).toEqual({ folder: false, docs: [{ draft: 0 }], active: 0 });
  });

  it("フォルダを開き直し、フォルダのファイルと下書きを前回の順番で戻し、表示していた文書を表示中にする", async () => {
    // Arrange
    const s = setup();
    await work(s);
    // Act
    const { next, missing } = await restart(s);
    // Assert
    expect(missing).toEqual([]);
    expect(next.list().map((d) => d.name)).toEqual(["u.sysml", "a.sysml", "b.sysml"]);
    expect(next.active()?.name).toBe("a.sysml");
    expect(next.list()[1]?.text).toBe("package A;");
    expect(next.folder()?.ref.name).toBe("project");
  });

  it("消されたファイルは戻さずにパスを返し、表示していたファイルが消えていたら最初の文書を表示中にする", async () => {
    // Arrange
    const s = setup();
    await work(s);
    s.root.entries.delete("a.sysml");
    // Act
    const { next, missing } = await restart(s);
    // Assert
    expect(missing).toEqual(["a.sysml"]);
    expect(next.list().map((d) => d.name)).toEqual(["u.sysml", "b.sysml"]);
    expect(next.active()?.name).toBe("u.sysml");
  });

  it("フォルダが消されていたら、開き直すときに例外を投げ、下書きだけを戻せる（異常系）", async () => {
    // Arrange
    const s = setup();
    await work(s);
    s.root.removed = true;
    const next = nextStart(s);
    next.restoreDrafts();
    // Act
    const reopen = next.reopenFolder(s.local, { ask: false });
    // Assert
    await expect(reopen).rejects.toThrow();
    const missing = await next.resumeSession(s.sessions.load()!);
    expect(missing).toEqual([]);
    expect(next.list().map((d) => d.name)).toEqual(["u.sysml"]);
    expect(next.folder()).toBeNull();
  });

  it("許可が要るときは、許可を求めずにフォルダを開かない", async () => {
    // Arrange
    const s = setup();
    await work(s);
    s.root.permission = "prompt";
    const next = nextStart(s);
    // Act
    const opened = await next.reopenFolder(s.local, { ask: false });
    // Assert
    expect(opened).toBe(false);
    expect(s.root.permission).toBe("prompt");
  });

  it("フォルダを開かないブラウザでも、下書きと表示していた文書を戻す", async () => {
    // Arrange
    const s = setup();
    s.ws.holdSession(false);
    const first = s.ws.newUntitled("u1.sysml", "package U1;");
    s.ws.newUntitled("u2.sysml", "package U2;");
    s.ws.activate(first.key);
    const next = new Workspace(new ProviderRegistry([s.browser]), s.drafts, s.sessions);
    next.restoreDrafts();
    // Act
    await next.resumeSession(s.sessions.load()!);
    // Assert
    expect(next.list().map((d) => d.name)).toEqual(["u1.sysml", "u2.sysml"]);
    expect(next.active()?.name).toBe("u1.sysml");
  });

  it("無題の中身が無くなったら、前回の続きの下書きの番号を合わせて書き直す（境界値: 空になった）", () => {
    // Arrange
    const s = setup();
    s.ws.holdSession(false);
    const first = s.ws.newUntitled("u1.sysml", "package U1;");
    s.ws.newUntitled("u2.sysml", "package U2;");
    // Act
    s.ws.setText(first.key, "");
    // Assert
    expect(s.sessions.load()).toEqual({ folder: false, docs: [{ draft: 0 }], active: 0 });
    expect(s.drafts.load().drafts.map((d) => d.name)).toEqual(["u2.sysml"]);
  });
});
