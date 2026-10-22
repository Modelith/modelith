// v1 のプラグインから届いたメッセージの扱い（F-PLUG-5・F-PLUG-7、ADR-0018 §3・§4）の単体テスト。
// 形と権限と範囲はコア（Rust）が確かめる（crates/modelith-core/src/plugin_host）。ここでは、その結果をホストがどう扱うかを確かめる。
import { describe, expect, it } from "vitest";
import type { CheckedPluginMessage, Refused } from "../core";
import { addNotice, decideMessage, failedNotice, flashRange, messageJson, STALE_PLUGIN_EDIT, type CheckResult, type PendingRequest } from "./messages";
import { MAX_TRANSFER_BYTES } from "./transfer";

const EDITS = [{ start: 0, end: 7, text: "library" }];
const RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } };

/** 版 3 のテキストで確かめた結果。 */
const at = (checked: CheckedPluginMessage | Refused, over: Partial<CheckResult> = {}): CheckResult => ({ version: 3, stale: false, checked, ...over });
/** 版 version に対する変更案。 */
const propose = (version: number): CheckedPluginMessage => ({ message: { type: "proposeEdits", version, edits: [{ range: RANGE, newText: "library" }], label: "ライブラリにする" }, edits: EDITS });

describe("decideMessage（変更案、F-PLUG-5）", () => {
  it("確かめた版と同じ版への変更案は、当てる（正常系）", () => {
    // Arrange・Act
    const got = decideMessage(at(propose(3)), new Map());
    // Assert
    expect(got).toEqual({ kind: "applyEdits", version: 3, edits: EDITS, label: "ライブラリにする" });
  });

  it.each([
    ["古い版（-1）", 2],
    ["まだ無い版（+1）", 4],
  ])("%s への変更案は、当てずに知らせる（境界値）", (_, version) => {
    // Arrange・Act
    const got = decideMessage(at(propose(version)), new Map());
    // Assert
    expect(got).toEqual({ kind: "refuseEdits", notice: STALE_PLUGIN_EDIT });
  });

  it("確かめている間にテキストが変わったら、当てずに知らせる", () => {
    // Arrange・Act
    const got = decideMessage(at(propose(3), { stale: true }), new Map());
    // Assert
    expect(got).toEqual({ kind: "refuseEdits", notice: "テキストが変わったため、プラグインの変更を適用しませんでした" });
  });
});

describe("decideMessage（形と権限、F-PLUG-7）", () => {
  it("コアが断ったメッセージは、理由を一覧に出して捨てる", () => {
    // Arrange・Act
    const got = decideMessage(at({ refused: "宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした" }), new Map());
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした" });
  });

  it("頼んでいないインポートの結果は、捨てて知らせる", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "imported", requestId: 1, fileName: "a.sysml", text: "" } }), new Map());
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "依頼していない結果（imported）が届いたため、使いませんでした" });
  });

  it("保存場所の依頼（コアが storage の権限を確かめた後）は、ホストに任せる", () => {
    // Arrange・Act
    const get = decideMessage(at({ message: { type: "storageGet", requestId: 7, key: "k" } }), new Map());
    const set = decideMessage(at({ message: { type: "storageSet", requestId: 8, key: "k", value: { n: 1 } } }), new Map());
    // Assert
    expect(get).toEqual({ kind: "storageGet", requestId: 7, key: "k" });
    expect(set).toEqual({ kind: "storageSet", requestId: 8, key: "k", value: { n: 1 } });
  });
});

describe("decideMessage（コマンド・診断・知らせ）", () => {
  it("頼んだコマンドの完了と失敗を、表示名を添えて扱う", () => {
    // Arrange
    const pending = new Map<number, PendingRequest>([[5, { kind: "command", title: "要求に ID を付ける" }]]);
    // Act
    const done = decideMessage(at({ message: { type: "commandDone", requestId: 5 } }), pending);
    const failed = decideMessage(at({ message: { type: "failed", requestId: 5, message: "要求がありません" } }), pending);
    // Assert
    expect(done).toEqual({ kind: "commandDone", requestId: 5 });
    expect(failed).toEqual({ kind: "requestFailed", requestId: 5, notice: "コマンド「要求に ID を付ける」を実行できませんでした：要求がありません" });
  });

  it("頼んでいない番号の完了は、捨てて知らせる（異常系）", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "commandDone", requestId: 6 } }), new Map<number, PendingRequest>([[5, { kind: "command", title: "x" }]]));
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "依頼していない結果（commandDone）が届いたため、使いませんでした" });
  });

  it("今の版の診断は使い、古い版の診断は知らせずに捨てる", () => {
    // Arrange
    const items = [{ pos: 0, end: 1, severity: "warning" as const, message: "m" }];
    const message = { type: "diagnostics" as const, version: 3, items: [] };
    // Act
    const current = decideMessage(at({ message, diagnostics: items }), new Map());
    const old = decideMessage(at({ message: { ...message, version: 2 }, diagnostics: items }), new Map());
    // Assert
    expect(current).toEqual({ kind: "diagnostics", version: 3, items, dropped: 0 });
    expect(old).toEqual({ kind: "ignore" });
  });

  it.each([
    ["上限ちょうど", 3, 3, 0],
    ["上限 + 1 件", 4, 3, 1],
  ])("診断が%sなら、上限までを使い、捨てた件数を添える（境界値、F-PLUG-7）", (_, count, max, dropped) => {
    // Arrange
    const items = Array.from({ length: count }, (_, i) => ({ pos: i, end: i + 1, severity: "warning" as const, message: `m${i}` }));
    // Act
    const got = decideMessage(at({ message: { type: "diagnostics", version: 3, items: [] }, diagnostics: items }), new Map(), max);
    // Assert
    expect(got).toEqual({ kind: "diagnostics", version: 3, items: items.slice(0, max), dropped });
  });

  it("準備ができた知らせと、利用者への知らせを扱う", () => {
    // Arrange・Act
    const ready = decideMessage(at({ message: { type: "ready" } }, { stale: true }), new Map());
    const notify = decideMessage(at({ message: { type: "notify", level: "warning", message: "m" } }), new Map());
    // Assert（ready はテキストに関わらないので、テキストが変わっていても使う）
    expect(ready).toEqual({ kind: "ready" });
    expect(notify).toEqual({ kind: "notify", level: "warning", message: "m" });
  });
});

describe("decideMessage（インポートとエクスポート、F-PLUG-4）", () => {
  const importing = new Map<number, PendingRequest>([[2, { kind: "import", title: "ReqIF" }]]);
  const exporting = new Map<number, PendingRequest>([[3, { kind: "export", title: "表（CSV）", extension: ".csv" }]]);
  /** エクスポートの答え。 */
  const exported = (base64: string, fileName = "要求一覧", mediaType = "text/csv"): CheckedPluginMessage => ({ message: { type: "exported", requestId: 3, fileName, mediaType, base64 } });

  it("頼んだインポートの結果は、新しい文書として開く（正常系）", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "imported", requestId: 2, fileName: "a.reqif", text: "package A;" } }), importing);
    // Assert
    expect(got).toEqual({ kind: "imported", requestId: 2, title: "ReqIF", fileName: "a.reqif", text: "package A;" });
  });

  it("エクスポートの依頼の番号に届いたインポートの結果は、捨てて知らせる（異常系: 種類の食い違い）", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "imported", requestId: 3, fileName: "a.reqif", text: "" } }), exporting);
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "依頼していない結果（imported）が届いたため、使いませんでした" });
  });

  it("上限より大きいインポートの結果は、開かずに知らせる（境界値: 上限 + 1 バイト）", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "imported", requestId: 2, fileName: "a.reqif", text: "a".repeat(MAX_TRANSFER_BYTES + 1) } }), importing);
    // Assert
    expect(got).toEqual({ kind: "requestFailed", requestId: 2, notice: "インポート「ReqIF」を実行できませんでした：インポートしたテキストが大きすぎます（上限 20 MB）" });
  });

  it("頼んだエクスポートの結果は、ファイル名に拡張子を補ってダウンロードさせる（正常系）", () => {
    // Arrange・Act
    const got = decideMessage(at(exported("YWJj")), exporting);
    // Assert
    expect(got).toEqual({ kind: "exported", requestId: 3, title: "表（CSV）", fileName: "要求一覧.csv", mediaType: "text/csv", base64: "YWJj" });
  });

  it("形の正しくない種類（MIME タイプ）は、ただのバイト列として扱う", () => {
    // Arrange・Act
    const got = decideMessage(at(exported("YWJj", "a.csv", "text/html\n<script>")), exporting);
    // Assert
    expect(got).toMatchObject({ kind: "exported", mediaType: "application/octet-stream" });
  });

  it("base64 でないエクスポートの結果は、エクスポートできなかったと知らせる（異常系）", () => {
    // Arrange・Act
    const got = decideMessage(at(exported("YWJ")), exporting);
    // Assert
    expect(got).toEqual({ kind: "requestFailed", requestId: 3, notice: "エクスポート「表（CSV）」を実行できませんでした：エクスポートされたファイルの中身が正しくありません（base64 ではありません）" });
  });

  it.each([
    ["上限ちょうど", MAX_TRANSFER_BYTES, "exported"],
    ["上限 + 3 バイト", MAX_TRANSFER_BYTES + 3, "requestFailed"],
  ])("%s のエクスポートの結果（境界値）", (_, bytes, kind) => {
    // Arrange（3 バイトごとに 4 文字の base64。余りは = で詰める）
    const base64 = "A".repeat(Math.floor(bytes / 3) * 4) + ["", "AA==", "AAA="][bytes % 3];
    // Act
    const got = decideMessage(at(exported(base64)), exporting);
    // Assert
    expect(got.kind).toBe(kind);
  });

  it("頼んでいないエクスポートの結果は、捨てて知らせる（異常系）", () => {
    // Arrange・Act
    const got = decideMessage(at(exported("YWJj")), importing);
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "依頼していない結果（exported）が届いたため、使いませんでした" });
  });

  it("インポートの失敗は、何の失敗かを添えて知らせる", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "failed", requestId: 2, message: "ReqIF の形式ではありません" } }), importing);
    // Assert
    expect(got).toEqual({ kind: "requestFailed", requestId: 2, notice: "インポート「ReqIF」を実行できませんでした：ReqIF の形式ではありません" });
  });

  it("インポートの依頼の番号に届いたコマンドの完了は、捨てて知らせる（異常系: 種類の食い違い）", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "commandDone", requestId: 2 } }), importing);
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "依頼していない結果（commandDone）が届いたため、使いませんでした" });
  });
});

describe("failedNotice", () => {
  it("エクスポートの失敗の文", () => {
    // Arrange・Act
    const got = failedNotice({ kind: "export", title: "表（CSV）", extension: ".csv" }, "要素がありません");
    // Assert
    expect(got).toBe("エクスポート「表（CSV）」を実行できませんでした：要素がありません");
  });
});

describe("addNotice（一覧の知らせ）", () => {
  it.each([
    [["a"], "b", ["b", "a"]],
    [["a"], "a", ["a"]],
    [[], "a", ["a"]],
    [["5", "4", "3", "2", "1"], "6", ["6", "5", "4", "3", "2"]],
  ])("%o に %s を足す → %o（同じ知らせは重ねず、5 件まで）", (notices, notice, expected) => {
    // Arrange・Act
    const got = addNotice(notices, notice);
    // Assert
    expect(got).toEqual(expected);
  });
});

describe("messageJson（届いたデータを JSON にする）", () => {
  it.each([
    ["オブジェクト", { type: "ready" }, '{"type":"ready"}'],
    ["undefined", undefined, null],
    ["BigInt を含む", { n: 1n }, null],
  ])("%s → %s", (_, data, expected) => {
    // Arrange
    const value: unknown = data;
    // Act
    const got = messageJson(value);
    // Assert
    expect(got).toBe(expected);
  });

  it("循環するデータは JSON にしない（異常系）", () => {
    // Arrange
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    // Act
    const got = messageJson(loop);
    // Assert
    expect(got).toBeNull();
  });
});

describe("flashRange（当てた後に光らせる範囲）", () => {
  it.each([
    [[{ start: 4, end: 6, text: "abc" }], [4, 7]],
    [[{ start: 0, end: 2, text: "" }, { start: 5, end: 5, text: "x" }], [0, 0]],
    [[], null],
  ])("%o → %o", (edits, expected) => {
    // Arrange・Act
    const got = flashRange(edits);
    // Assert
    expect(got).toEqual(expected);
  });
});
