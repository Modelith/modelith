import { describe, expect, it } from "vitest";
import { recoveryHtml, RESET_LABEL, startupErrorHtml } from "./recovery";

describe("recoveryHtml（Q-6）", () => {
  it("初期化して読み直す操作と、消えないもの（下書き・前回の続き・プラグインの許可）を示す", () => {
    // Arrange
    const e = new TypeError("x is not a function");
    // Act
    const html = recoveryHtml(e);
    // Assert
    expect(html).toContain("Modelith を起動できませんでした");
    expect(html).toContain(`<button id="btnResetSettings" type="button">${RESET_LABEL}</button>`);
    expect(html).toContain("下書き・前回の続き・プラグインの許可は消えません");
    expect(html).toContain("<small>x is not a function</small>");
  });

  it("詳しい内容はエスケープする（異常系：例外のメッセージに HTML が混じる）", () => {
    // Arrange・Act
    const html = recoveryHtml("<b>");
    // Assert
    expect(html).toContain("<small>&lt;b&gt;</small>");
  });

  it("Error でない値も文字列にして出す（境界）", () => {
    // Arrange・Act
    const html = recoveryHtml(undefined);
    // Assert
    expect(html).toContain("<small>undefined</small>");
  });
});

describe("startupErrorHtml（Q-5）", () => {
  it("読み込み直す対処と、失敗の内容を示す", () => {
    // Arrange・Act
    const html = startupErrorHtml(new Error("fetch failed"));
    // Assert
    expect(html).toContain("ページを再読み込みしてください");
    expect(html).toContain("<small>fetch failed</small>");
    expect(html).not.toContain("btnResetSettings");
  });
});
