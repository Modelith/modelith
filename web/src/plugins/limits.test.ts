// v1 のプラグインから届くメッセージの上限（F-PLUG-7）と、答えを待つ期限（F-PLUG-8）の判断の単体テスト。
import { describe, expect, it } from "vitest";
import {
  droppedDiagnosticsNote, droppedNotifyNotice, intake, MAX_MESSAGE_UNITS, MESSAGE_LIMITS, messageUnits, notifyAllowance, overdueRequests, stuckNotice, type MessageLimits,
} from "./limits";

/** テスト用の小さな上限。 */
const SMALL: MessageLimits = { maxUnits: 100, maxQueued: 3, maxDropped: 2 };
const FRESH = { queued: 0, dropped: 0 };

describe("messageUnits（大きさの数え上げ）", () => {
  it.each([
    ["文字列は長さ", "abcde", 5],
    ["数値・真偽値・null は 1", [1, true, null], 1 + 3],
    ["オブジェクトはキーの長さも数える", { type: "ready" }, 1 + 4 + 5],
    ["入れ子", { items: [{ n: 1 }, { n: 2 }] }, 1 + 5 + 1 + (1 + 1 + 1) * 2],
    ["空（境界値）", {}, 1],
  ])("%s", (_, data, expected) => {
    // Arrange・Act
    const got = messageUnits(data, 1000);
    // Assert
    expect(got).toBe(expected);
  });

  it("上限を超えたら、歩き切らずに止まる", () => {
    // Arrange（1 件 3 単位 × 1,000 件）
    const data = Array.from({ length: 1000 }, () => ({ n: 1 }));
    // Act
    const got = messageUnits(data, 10);
    // Assert（上限より大きく、全体の大きさ（3,001）より小さい）
    expect(got).toBeGreaterThan(10);
    expect(got).toBeLessThan(3001);
  });

  it("循環するデータは一度だけ歩く（異常系）", () => {
    // Arrange
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    // Act
    const got = messageUnits(loop, 1000);
    // Assert
    expect(got).toBe(1 + 4);
  });
});

describe("intake（入口の判断）", () => {
  it("待ちに空きがあり、大きさが上限の中なら、待ちに入れる（正常系）", () => {
    // Arrange・Act
    const got = intake(FRESH, { type: "ready" }, SMALL);
    // Assert
    expect(got).toEqual({ kind: "accept", state: { queued: 1, dropped: 0 } });
  });

  it.each([
    ["上限ちょうど", 100, "accept"],
    ["上限 + 1", 101, "drop"],
  ])("大きさが%sのメッセージ（境界値）", (_, length, kind) => {
    // Arrange・Act
    const got = intake(FRESH, "x".repeat(length), SMALL);
    // Assert
    expect(got.kind).toBe(kind);
  });

  it("既定の上限は、20 MB のファイルの base64（約 28M 文字）を通す", () => {
    // Arrange・Act
    const got = intake(FRESH, { type: "exported", requestId: 1, fileName: "a", mediaType: "text/csv", base64: "A".repeat(Math.ceil((20 * 1024 * 1024) / 3) * 4) }, MESSAGE_LIMITS);
    // Assert
    expect(got.kind).toBe("accept");
    expect(MAX_MESSAGE_UNITS).toBe(32 * 1024 * 1024);
  });

  it("大きすぎるメッセージは捨てて、上限を添えて知らせる（異常系）", () => {
    // Arrange・Act
    const got = intake(FRESH, "x".repeat(MAX_MESSAGE_UNITS + 1), MESSAGE_LIMITS);
    // Assert
    expect(got).toEqual({ kind: "drop", state: { queued: 0, dropped: 1 }, notice: "大きすぎるメッセージが届いたため、使いませんでした（上限 32 MB）" });
  });

  it.each([
    ["上限 - 1", 2, "accept"],
    ["上限ちょうど", 3, "drop"],
  ])("待ちが%sのときに届いたメッセージ（境界値）", (_, queued, kind) => {
    // Arrange・Act
    const got = intake({ queued, dropped: 0 }, { type: "ready" }, SMALL);
    // Assert
    expect(got.kind).toBe(kind);
  });

  it("待ちが上限に達していれば、大きさは数えずに捨てて知らせる", () => {
    // Arrange・Act
    const got = intake({ queued: 3, dropped: 0 }, { type: "ready" }, SMALL);
    // Assert
    expect(got).toEqual({ kind: "drop", state: { queued: 3, dropped: 1 }, notice: "届いたメッセージが多すぎるため、使いませんでした（待ちの上限 3 件）" });
  });

  it("捨てた数が上限に達したら、止める（境界値: 上限 - 1 から 1 つ捨てる）", () => {
    // Arrange・Act
    const got = intake({ queued: 3, dropped: 1 }, { type: "ready" }, SMALL);
    // Assert
    expect(got).toEqual({ kind: "halt", state: { queued: 3, dropped: 2 }, notice: "届いたメッセージが多すぎるため、停止を指示しました（使わなかったメッセージ 2 件）" });
  });
});

describe("notifyAllowance（知らせの頻度）", () => {
  it("1 秒の中の 5 件目は出す（境界値）", () => {
    // Arrange・Act
    const got = notifyAllowance([0, 100, 200, 300], 999, 5);
    // Assert
    expect(got).toEqual({ allowed: true, recent: [0, 100, 200, 300, 999] });
  });

  it("1 秒の中の 6 件目は出さない（境界値）", () => {
    // Arrange・Act
    const got = notifyAllowance([0, 100, 200, 300, 400], 999, 5);
    // Assert
    expect(got).toEqual({ allowed: false, recent: [0, 100, 200, 300, 400] });
  });

  it("1 秒たった知らせは数えない（境界値: ちょうど 1,000 ミリ秒）", () => {
    // Arrange・Act
    const got = notifyAllowance([0, 0, 0, 0, 0], 1000, 5);
    // Assert
    expect(got).toEqual({ allowed: true, recent: [1000] });
  });

  it("捨てた知らせの数を添えた文", () => {
    // Arrange・Act
    const got = droppedNotifyNotice(3, 5);
    // Assert
    expect(got).toBe("知らせが多すぎるため、3 件を表示しませんでした（1 秒に 5 件まで）");
  });
});

describe("overdueRequests（答えの期限）", () => {
  const pending = (since: number, reported?: boolean) => new Map([[7, reported === undefined ? { since } : { since, reported }]]);

  it.each([
    ["期限 - 1 ミリ秒", 29_999, []],
    ["期限ちょうど", 30_000, [7]],
    ["期限 + 1 ミリ秒", 30_001, [7]],
  ])("%sでは %o（境界値）", (_, now, expected) => {
    // Arrange・Act
    const got = overdueRequests(pending(0), now, 30_000);
    // Assert
    expect(got).toEqual(expected);
  });

  it("すでに知らせた依頼は、もう挙げない", () => {
    // Arrange・Act
    const got = overdueRequests(pending(0, true), 60_000, 30_000);
    // Assert
    expect(got).toEqual([]);
  });

  it("複数の依頼は、期限を過ぎたものだけを番号の順で挙げる", () => {
    // Arrange
    const many = new Map([[9, { since: 0 }], [3, { since: 10 }], [5, { since: 20_000 }]]);
    // Act
    const got = overdueRequests(many, 30_010, 30_000);
    // Assert
    expect(got).toEqual([3, 9]);
  });

  it("空なら空（境界値）", () => {
    // Arrange・Act
    const got = overdueRequests(new Map(), 100_000, 30_000);
    // Assert
    expect(got).toEqual([]);
  });
});

describe("stuckNotice・droppedDiagnosticsNote（文）", () => {
  it.each([
    ["コマンド", { kind: "command" as const, title: "ID を付ける" }, "コマンド「ID を付ける」が 30 秒たっても終わりません。「停止」で止められます"],
    ["インポート", { kind: "import" as const, title: "ReqIF" }, "インポート「ReqIF」が 30 秒たっても終わりません。「停止」で止められます"],
    ["エクスポート", { kind: "export" as const, title: "表", extension: ".csv" }, "エクスポート「表」が 30 秒たっても終わりません。「停止」で止められます"],
  ])("%sが終わらないときの文", (_, request, expected) => {
    // Arrange・Act
    const got = stuckNotice(request, 30_000);
    // Assert
    expect(got).toBe(expected);
  });

  it("起動が終わらないときの文", () => {
    // Arrange・Act
    const got = stuckNotice(null, 10_000);
    // Assert
    expect(got).toBe("起動が 10 秒たっても終わりません。「停止」で止められます");
  });

  it("診断を捨てたことの文", () => {
    // Arrange・Act
    const got = droppedDiagnosticsNote("レビューの記録", 20, 1000);
    // Assert
    expect(got).toBe("プラグイン「レビューの記録」の問題が多すぎるため、20 件を示していません（上限 1000 件）");
  });
});
