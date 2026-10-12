// UI テスト（見た目の回帰）。画面を撮って基準画像（visual.spec.ts-snapshots/）と比べる。
// 差があれば HTML レポートに「基準・今回・差分」の 3 枚が並ぶ。意図した変更なら基準を更新する（docs/development/testing.md）。
import { expect, openApp, putFiles, test, typeAtEnd } from "./fixtures";
import type { Page } from "@playwright/test";

/** 画面が落ち着くまで待つ（トーストが消え、フォントが読み込まれる）。 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#toast")).not.toHaveClass(/on/);
}

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(".tabadd summary").click();
  await page.locator(`[data-open="${view}"]`).click();
  await settle(page);
}

test.describe("UI: 図", () => {
  const views: [string, string][] = [
    ["trace", "トレーサビリティ"],
    ["structure", "構造"],
    ["control", "制御ループ"],
    ["ibd", "内部ブロック図"],
    ["behavior", "振る舞い"],
    ["seq", "シーケンス"],
    ["all", "すべて"],
  ];
  for (const [view, label] of views) {
    test(`F-VIEW-1: ${label}ビューの見た目`, async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await openView(page, view);
      // Assert
      await expect(page.locator("#wrap")).toHaveScreenshot(`view-${view}.png`);
    });
  }
});

test.describe("UI: 画面全体", () => {
  test("Q-2: 起動直後の画面（明るい配色）", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await settle(page);
    // Assert
    await expect(page).toHaveScreenshot("app-light.png");
  });

  test.describe("暗い配色", () => {
    test.use({ colorScheme: "dark" });
    test("Q-2: 起動直後の画面（暗い配色）", async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await settle(page);
      // Assert
      await expect(page).toHaveScreenshot("app-dark.png");
    });
  });

  test.describe("狭い画面", () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test("Q-2: 幅 390px の画面", async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await settle(page);
      // Assert
      await expect(page).toHaveScreenshot("app-narrow.png");
    });
  });
});

test.describe("UI: 部品", () => {
  test("F-VIEW-4: 要素を選んだときのインスペクタ", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator('#gNodes .node[data-key="BoilTimeReq"]').click();
    await settle(page);
    // Assert
    await expect(page.locator("#insp")).toHaveScreenshot("inspector-node.png");
  });

  test("F-VIEW-4: 図の右クリックメニュー", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator('#gNodes .node[data-key="BoilTimeReq"]').click({ button: "right" });
    await settle(page);
    // Assert
    await expect(page.locator("#ctx")).toHaveScreenshot("context-menu.png");
  });

  test("F-FILE-1: フォルダを開いたエクスプローラー（未保存の印つき）", async ({ page }) => {
    // Arrange
    await openApp(page);
    await putFiles(page, { "a.sysml": "package A;\n", "models/b.sysml": "package B;\n" });
    await page.locator('[data-cmd="openFolder"]').click();
    await page.locator('#explorer [data-file][title="a.sysml"]').click();
    // Act
    await typeAtEnd(page, "// edited\n");
    await settle(page);
    // Assert
    await expect(page.locator(".treepane")).toHaveScreenshot("explorer.png");
  });

  test("F-FILE-7: 競合したときのダイアログ", async ({ page }) => {
    // Arrange
    await openApp(page);
    await putFiles(page, { "a.sysml": "package A;\n" });
    await page.locator('[data-cmd="openFolder"]').click();
    await page.locator('#explorer [data-file][title="a.sysml"]').click();
    await typeAtEnd(page, "// mine\n");
    await putFiles(page, { "a.sysml": "package Theirs;\n" });
    // Act
    await page.keyboard.press("Control+s");
    await settle(page);
    // Assert
    await expect(page.locator("#dialog .box")).toHaveScreenshot("dialog-conflict.png");
  });
});
