import { describe, expect, it } from "vitest";
import type { DirEntry, FileRef, RecentAccess } from "../files/types";
import { afterRestore, findFile, kvSessionStore, parseSession, planStart, restoreOrder, sampleDraft, sessionFrom, type Session, type StartPlan } from "./session";

const ref = (path: string, id = `dir:1/${path}`): FileRef => ({ provider: "local", id, name: path.split("/").pop() ?? path, path });
const ENTRIES: DirEntry[] = [
  { kind: "dir", name: "models", path: "models", children: [{ kind: "file", ref: ref("models/b.sysml") }] },
  { kind: "file", ref: ref("a.sysml") },
];
const withFolder: Session = { folder: true, docs: [{ path: "a.sysml" }], active: 0 };
const noFolder: Session = { folder: false, docs: [{ draft: 0 }], active: 0 };

describe("planStart（F-FILE-13）", () => {
  it.each<[string, Session | null, boolean, RecentAccess, StartPlan]>([
    ["前回の続きが無い（初めて開いた・以前の版）", null, false, "none", "default"],
    ["フォルダを開いていなかった（代替のブラウザを含む）", noFolder, false, "none", "docs"],
    ["フォルダの許可が残っている", withFolder, false, "granted", "resume"],
    ["フォルダを開くには許可を求める", withFolder, false, "prompt", "ask"],
    ["フォルダの許可が拒否されている", withFolder, false, "denied", "docs"],
    ["前回のフォルダを覚えていない（IndexedDB が消えた）", withFolder, false, "none", "docs"],
    ["設定でサンプルを開く（許可があっても）", withFolder, true, "granted", "sample"],
    ["設定でサンプルを開く（前回の続きが無くても）", null, true, "none", "sample"],
  ])("%s", (_, session, sampleAtStart, access, expected) => {
    // Arrange・Act
    const plan = planStart(session, sampleAtStart, access);
    // Assert
    expect(plan).toBe(expected);
  });
});

describe("sessionFrom（F-FILE-13）", () => {
  it("中身のある無題は下書きの順番で、フォルダのファイルはパスで覚え、表示していた文書の位置を覚える", () => {
    // Arrange
    const docs = [
      { key: "doc:1", ref: null, text: "package U;" },
      { key: "doc:2", ref: null, text: "  " },
      { key: "doc:3", ref: ref("models/b.sysml"), text: "" },
      { key: "doc:4", ref: null, text: "package V;" },
    ];
    // Act
    const s = sessionFrom(docs, "doc:3", ENTRIES);
    // Assert
    expect(s).toEqual({ folder: true, docs: [{ draft: 0 }, { path: "models/b.sysml" }, { draft: 1 }], active: 1 });
  });

  it("フォルダの外のファイル（1 つだけ選んだ）は覚えず、それを表示していたら active は null", () => {
    // Arrange
    const docs = [
      { key: "doc:1", ref: ref("one.sysml", "file:1"), text: "" },
      { key: "doc:2", ref: ref("a.sysml"), text: "" },
    ];
    // Act
    const s = sessionFrom(docs, "doc:1", ENTRIES);
    // Assert
    expect(s).toEqual({ folder: true, docs: [{ path: "a.sysml" }], active: null });
  });

  it("フォルダを開いていなければ、ファイルは覚えない（境界値: 何も開いていない）", () => {
    // Arrange・Act
    const empty = sessionFrom([], null, null);
    const picked = sessionFrom([{ key: "doc:1", ref: ref("a.sysml"), text: "" }], "doc:1", null);
    // Assert
    expect(empty).toEqual({ folder: false, docs: [], active: null });
    expect(picked).toEqual({ folder: false, docs: [], active: null });
  });
});

describe("restoreOrder（F-FILE-13）", () => {
  it("前回の順番のまま戻し、表示していた文書の位置を返す", () => {
    // Arrange
    const s: Session = { folder: true, docs: [{ draft: 0 }, { path: "a.sysml" }, { draft: 1 }], active: 1 };
    // Act
    const r = restoreOrder(s, 2, true);
    // Assert
    expect(r).toEqual({ items: s.docs, active: 1 });
  });

  it("フォルダを開けなければファイルを除き、表示していたのがファイルなら active は null", () => {
    // Arrange
    const s: Session = { folder: true, docs: [{ draft: 0 }, { path: "a.sysml" }], active: 1 };
    // Act
    const r = restoreOrder(s, 1, false);
    // Assert
    expect(r).toEqual({ items: [{ draft: 0 }], active: null });
  });

  it("無い下書き・重なりは除き、前回の続きに無い下書きは最後に足す（異常系: 保存先の食い違い）", () => {
    // Arrange
    const s: Session = { folder: true, docs: [{ draft: 1 }, { draft: 5 }, { path: "a.sysml" }, { path: "a.sysml" }, { draft: 1 }], active: 3 };
    // Act
    const r = restoreOrder(s, 3, true);
    // Assert
    expect(r).toEqual({ items: [{ draft: 1 }, { path: "a.sysml" }, { draft: 0 }, { draft: 2 }], active: null });
  });

  it("下書きが無ければ、前回の続きの下書きは戻さない（境界値: 0 個）", () => {
    // Arrange
    const s: Session = { folder: false, docs: [{ draft: 0 }], active: 0 };
    // Act
    const r = restoreOrder(s, 0, false);
    // Assert
    expect(r).toEqual({ items: [], active: null });
  });
});

describe("afterRestore（F-FILE-13・F-FILE-14）", () => {
  it.each([
    [1, false, "sample", "show"],
    [0, true, "sample", "nothing"],
    [0, false, "nothing", "nothing"],
    [0, false, "sample", "sample"],
  ] as const)("戻した文書 %d 個・フォルダ %s・下書き %s → %s", (docs, folder, drafts, expected) => {
    // Arrange・Act
    const r = afterRestore(docs, folder, drafts);
    // Assert
    expect(r).toBe(expected);
  });
});

describe("findFile・sampleDraft", () => {
  it("入れ子の中のファイルもパスで探し、無ければ null", () => {
    // Arrange・Act
    const hit = findFile(ENTRIES, "models/b.sysml");
    const miss = findFile(ENTRIES, "gone.sysml");
    // Assert
    expect(hit?.id).toBe("dir:1/models/b.sysml");
    expect(miss).toBeNull();
  });

  it("手を付けていないサンプルだけを見つける", () => {
    // Arrange
    const sample = { name: "s.sysml", text: "package S;" };
    const docs = [
      { key: "doc:1", ref: null, name: "s.sysml", text: "package S; // edited" },
      { key: "doc:2", ref: ref("s.sysml"), name: "s.sysml", text: "package S;" },
      { key: "doc:3", ref: null, name: "s.sysml", text: "package S;" },
    ];
    // Act
    const found = sampleDraft(docs, sample);
    const none = sampleDraft(docs.slice(0, 2), sample);
    // Assert
    expect(found).toBe("doc:3");
    expect(none).toBeNull();
  });
});

describe("parseSession・kvSessionStore", () => {
  it("保存したものをそのまま読める", () => {
    // Arrange
    const kv = new Map<string, string>();
    const store = kvSessionStore({ get: (k) => kv.get(k) ?? null, set: (k, v) => !!kv.set(k, v) });
    const s: Session = { folder: true, docs: [{ draft: 0 }, { path: "models/b.sysml" }], active: 1 };
    // Act
    store.save(s);
    // Assert
    expect(store.load()).toEqual(s);
  });

  it("何も置いていなければ null（境界値: 初めて開いた）", () => {
    // Arrange
    const store = kvSessionStore({ get: () => null, set: () => true });
    // Act・Assert
    expect(store.load()).toBeNull();
  });

  it("置けたら true、保存先に書けなければ false を返す（異常系：保存領域がいっぱい）", () => {
    // Arrange
    const ok = kvSessionStore({ get: () => null, set: () => true });
    const full = kvSessionStore({ get: () => null, set: () => false });
    const s: Session = { folder: false, docs: [{ draft: 0 }], active: 0 };
    // Act
    const saved = [ok.save(s), full.save(s)];
    // Assert
    expect(saved).toEqual([true, false]);
  });

  it.each(["{not json", "null", "[]", '{"folder":"yes","docs":[]}', '{"folder":true}'])("壊れた・形の合わない値（%s）は null（異常系）", (json) => {
    // Arrange・Act
    const s = parseSession(json);
    // Assert
    expect(s).toBeNull();
  });

  it("形の合わない文書は除き、表示していた文書の位置を詰め直す。範囲の外の位置は null", () => {
    // Arrange・Act
    const shifted = parseSession('{"folder":true,"docs":[{"draft":-1},{"x":1},{"path":"a.sysml"}],"active":2}');
    const outside = parseSession('{"folder":false,"docs":[{"draft":0}],"active":1}');
    const onBroken = parseSession('{"folder":false,"docs":[{"draft":0},{"x":1}],"active":1}');
    // Assert
    expect(shifted).toEqual({ folder: true, docs: [{ path: "a.sysml" }], active: 0 });
    expect(outside).toEqual({ folder: false, docs: [{ draft: 0 }], active: null });
    expect(onBroken).toEqual({ folder: false, docs: [{ draft: 0 }], active: null });
  });
});
