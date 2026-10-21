import { describe, expect, it } from "vitest";
import { installUnexpectedErrorHandlers, UNEXPECTED_MESSAGE, type ErrorSource } from "./unexpected";

/** 登録した受け口を覚え、イベントを起こせる window の代わり。 */
function fakeSource() {
  const listeners = new Map<string, ((ev: { error?: unknown; message?: string; reason?: unknown }) => void)[]>();
  const source: ErrorSource = {
    addEventListener(type: string, listener: (ev: never) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener as (ev: { error?: unknown; message?: string; reason?: unknown }) => void]);
    },
  };
  const notified: string[] = [];
  const logged: unknown[] = [];
  installUnexpectedErrorHandlers(source, (m) => notified.push(m), (d) => logged.push(d));
  const fire = (type: string, ev: { error?: unknown; message?: string; reason?: unknown }) => (listeners.get(type) ?? []).forEach((l) => l(ev));
  return { listeners, notified, logged, fire };
}

describe("installUnexpectedErrorHandlers（Q-6）", () => {
  it("捕まえていない例外を 1 回知らせ、例外そのものをコンソールに残す", () => {
    // Arrange
    const s = fakeSource();
    const err = new Error("boom");
    // Act
    s.fire("error", { error: err, message: "Uncaught Error: boom" });
    // Assert
    expect(s.notified).toEqual([UNEXPECTED_MESSAGE]);
    expect(s.logged).toEqual([err]);
  });

  it("結果を待たない処理の失敗を 1 回知らせ、失敗の理由をコンソールに残す", () => {
    // Arrange
    const s = fakeSource();
    // Act
    s.fire("unhandledrejection", { reason: "disk full" });
    // Assert
    expect(s.notified).toEqual([UNEXPECTED_MESSAGE]);
    expect(s.logged).toEqual(["disk full"]);
  });

  it("例外そのものが無いとき（別の配信元のスクリプト）は、メッセージを残す（境界）", () => {
    // Arrange
    const s = fakeSource();
    // Act
    s.fire("error", { message: "Script error." });
    // Assert
    expect(s.logged).toEqual(["Script error."]);
    expect(s.notified).toHaveLength(1);
  });

  it("受け口は種類ごとに 1 つだけ登録し、例外 1 つにつき知らせは 1 回", () => {
    // Arrange
    const s = fakeSource();
    // Act
    s.fire("error", { error: new Error("a") });
    s.fire("unhandledrejection", { reason: new Error("b") });
    // Assert
    expect(s.listeners.get("error")).toHaveLength(1);
    expect(s.listeners.get("unhandledrejection")).toHaveLength(1);
    expect(s.notified).toEqual([UNEXPECTED_MESSAGE, UNEXPECTED_MESSAGE]);
  });

  it("知らせる文は、何が失われていないかを図の言葉で伝える（Q-4）", () => {
    // Arrange・Act
    const message = UNEXPECTED_MESSAGE;
    // Assert
    expect(message).toBe("予期しない問題が起きました。テキストはそのまま残っています");
  });
});
