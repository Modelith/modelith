// 問題一覧のコピー（F-EDIT-13）。行ごと（右クリック・Ctrl＋C）と「すべてコピー」。フォルダは OPFS を使う。
import { expect, openApp, putFiles, test } from "./fixtures";
import type { Page } from "@playwright/test";

const APP = "package App {\n    part def Car {\n        part w : Missing;\n    }\n}\n";
const PARTS = "package Parts {\n    part def Bus {\n        part w : Nope;\n    }\n}\n";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** フォルダ（app.sysml と lib/parts.sysml）を開き、app.sysml を表示する。 */
async function openFolder(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "app.sysml": APP, "lib/parts.sysml": PARTS });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  await expect(page.locator('#problems button[data-path="lib/parts.sysml"]')).toBeVisible();
}

/** クリップボードの文。 */
const clipboard = (page: Page): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

test("F-EDIT-13: 問題の行を右クリックすると、その行を「ファイル名:行: メッセージ」の形でコピーする", async ({ page }) => {
  // Arrange
  await openFolder(page);
  // Act
  await page.locator('#problems button:has-text("Missing")').click({ button: "right" });
  // Assert
  await expect(page.locator("#toast")).toHaveText("問題を 1 件コピーしました");
  expect(await clipboard(page)).toBe("app.sysml:3: 型「Missing」が見つかりません（w）");
});

test("F-EDIT-13: 問題の行を選んで Ctrl＋C を押すと、その行をコピーする（ほかのファイルの行はそのファイル名で）", async ({ page }) => {
  // Arrange
  await openFolder(page);
  await page.locator('#problems button[data-path="lib/parts.sysml"]').focus();
  // Act
  await page.keyboard.press("Control+c");
  // Assert
  expect(await clipboard(page)).toBe("lib/parts.sysml:3: 型「Nope」が見つかりません（w）");
});

test("F-EDIT-13: 「すべてコピー」で、表示中のファイルとほかのファイルの問題を 1 行に 1 件ずつコピーする", async ({ page }) => {
  // Arrange
  await openFolder(page);
  // Act
  await page.getByRole("button", { name: "すべてコピー" }).click();
  // Assert
  await expect(page.locator("#toast")).toHaveText("問題を 2 件コピーしました");
  expect(await clipboard(page)).toBe("app.sysml:3: 型「Missing」が見つかりません（w）\nlib/parts.sysml:3: 型「Nope」が見つかりません（w）");
});
