// ファイルごとの図のタブ（F-VIEW-17）。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, test } from "./fixtures";
import type { Page } from "@playwright/test";

const REQS = "package Reqs {\n    requirement def Safe;\n    requirement def Quiet;\n}\n";
const PARTS = "package Parts {\n    part def Pump;\n    part def Tank;\n}\n";

/** reqs.sysml と parts.sysml のフォルダを開く。 */
async function openFolder(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "reqs.sysml": REQS, "parts.sysml": PARTS });
  await page.locator('[data-cmd="openFolder"]').click();
}

/** フォルダの一覧のファイルを開き、表示されるまで待つ。 */
async function show(page: Page, name: string): Promise<void> {
  await page.locator(`#explorer [data-file][title="${name}"]`).click();
  await expect(page.locator("#docName")).toHaveText(name);
}

/** 「＋」から図を開く。 */
async function openView(page: Page, view: string): Promise<void> {
  await page.locator(".tabadd summary").click();
  await page.locator(`[data-open="${view}"]`).click();
}

const tabNames = (page: Page) => page.locator("#tabbar .tab span");

test("F-VIEW-17: 初めて開くファイルは「すべて」の図から始め、ファイルを切り替えると、そのファイルで最後に開いていたタブに戻る", async ({ page }) => {
  // Arrange（reqs.sysml でトレーサビリティを開いておく）
  await openFolder(page);
  await show(page, "reqs.sysml");
  await expect(tabNames(page)).toHaveText(["すべて"]);
  await openView(page, "trace");
  await expect(page.locator('#tabbar .tab[aria-selected="true"] span')).toHaveText("トレーサビリティ");
  // Act
  await show(page, "parts.sysml");
  const partsTabs = await tabNames(page).allTextContents();
  await show(page, "reqs.sysml");
  // Assert
  expect(partsTabs).toEqual(["すべて"]);
  await expect(tabNames(page)).toHaveText(["すべて", "トレーサビリティ"]);
  await expect(page.locator('#tabbar .tab[aria-selected="true"] span')).toHaveText("トレーサビリティ");
  await expect(page.locator('#gNodes .node[data-key="Safe"]')).toBeVisible();
});

test("F-VIEW-17: 表示中の図にこのファイルの要素が無くても切り替えず、ほかの図を開けることを示し、「すべて」の図も開ける", async ({ page }) => {
  // Arrange（部品だけのファイルで、トレーサビリティを開く）
  await openFolder(page);
  await show(page, "parts.sysml");
  // Act
  await openView(page, "trace");
  // Assert（図はトレーサビリティのまま、案内を出す）
  await expect(page.locator('#tabbar .tab[aria-selected="true"] span')).toHaveText("トレーサビリティ");
  await expect(page.locator("#empty")).toContainText("この図には、このファイルの要素がありません。ほかの図は、タブの「＋」から開けます。");
  await page.locator("#empty [data-open-all]").click();
  await expect(page.locator('#tabbar .tab[aria-selected="true"] span')).toHaveText("すべて");
  await expect(page.locator('#gNodes .node[data-key="Pump"]')).toBeVisible();
  await expect(page.locator("#empty")).toBeHidden();
});

test("F-VIEW-17: ファイルごとのタブは、読み込み直しても戻る", async ({ page }) => {
  // Arrange
  await openFolder(page);
  await show(page, "reqs.sysml");
  await openView(page, "trace");
  await show(page, "parts.sysml");
  // Act（読み込み直すと前回の続き（parts.sysml）から始まる。reqs.sysml に切り替える）
  await page.reload();
  await expect(page.locator("#docName")).toHaveText("parts.sysml");
  await show(page, "reqs.sysml");
  // Assert
  await expect(tabNames(page)).toHaveText(["すべて", "トレーサビリティ"]);
});
