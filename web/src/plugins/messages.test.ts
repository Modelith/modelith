// v1 のプラグインから届いたメッセージの扱い（F-PLUG-5・F-PLUG-7、ADR-0018 §3・§4）の単体テスト。
// 形と権限と範囲はコア（Rust）が確かめる（crates/modelith-core/src/plugin_host）。ここでは、その結果をホストがどう扱うかを確かめる。
import { describe, expect, it } from "vitest";
import type { CheckedPluginMessage, Refused } from "../core";
import { addNotice, decideMessage, flashRange, messageJson, STALE_PLUGIN_EDIT, type CheckResult } from "./messages";

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

  it("頼んでいない取り込みの結果は、捨てて知らせる", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "imported", requestId: 1, fileName: "a.sysml", text: "" } }), new Map());
    // Assert
    expect(got).toEqual({ kind: "drop", notice: "依頼していない結果（imported）が届いたため、使いませんでした" });
  });

  it("保存場所の依頼には、値なしで答え、まだ使えないことを知らせる", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "storageGet", requestId: 7, key: "k" } }), new Map());
    // Assert
    expect(got).toEqual({ kind: "reply", message: { type: "storageResult", requestId: 7 }, notice: "このバージョンでは、プラグイン用の保存場所はまだ使えません（storage）" });
  });
});

describe("decideMessage（コマンド・診断・知らせ）", () => {
  it("頼んだコマンドの完了と失敗を、表示名を添えて扱う", () => {
    // Arrange
    const pending = new Map([[5, "要求に ID を付ける"]]);
    // Act
    const done = decideMessage(at({ message: { type: "commandDone", requestId: 5 } }), pending);
    const failed = decideMessage(at({ message: { type: "failed", requestId: 5, message: "要求がありません" } }), pending);
    // Assert
    expect(done).toEqual({ kind: "commandDone", requestId: 5 });
    expect(failed).toEqual({ kind: "commandFailed", requestId: 5, title: "要求に ID を付ける", message: "要求がありません" });
  });

  it("頼んでいない番号の完了は、捨てて知らせる（異常系）", () => {
    // Arrange・Act
    const got = decideMessage(at({ message: { type: "commandDone", requestId: 6 } }), new Map([[5, "x"]]));
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
    expect(current).toEqual({ kind: "diagnostics", version: 3, items });
    expect(old).toEqual({ kind: "ignore" });
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
