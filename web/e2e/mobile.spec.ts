// スマホ（F-EDIT-10・Q-2）。本物の端末の設定（画面の大きさ・タッチ・モバイルの表示）で、iPhone（WebKit）と Android（Chromium）を動かす。
// playwright.config.ts の mobile-safari・mobile-chrome のプロジェクトだけが、このファイルを動かす。
import { editorText, expect, openApp, openReadOnlyText, test, wordCenter } from "./fixtures";

// スマホのブラウザには、フォルダを開く API（File System Access API）が無い
test.use({ fsAccess: false });

const TEXT = "package Kettle {\n    part def Heater;\n    attribute power : Real;\n}\n";

test("F-EDIT-10・Q-2: スマホでは、テキストは初めは読み取り専用で、ダブルタップの案内を出す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#tabText").tap();
  // Assert
  await expect(page.locator("#ed")).not.toBeEditable();
  await expect(page.locator("#btnEditText")).toBeVisible();
  await expect(page.locator("#wordLine")).toContainText("語をダブルタップすると");
});

test("F-EDIT-10: スマホで「編集」をタップすると編集でき、もう一度タップすると読み取り専用に戻る", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#tabText").tap();
  // Act
  await page.locator("#btnEditText").tap();
  const editable = await page.locator("#ed").isEditable();
  await page.locator("#ed").press("End");
  await page.keyboard.type("x");
  await page.locator("#btnEditText").tap();
  // Assert
  expect(editable).toBe(true);
  expect(await editorText(page)).toContain("x");
  await expect(page.locator("#ed")).not.toBeEditable();
  await expect(page.locator("#btnEditText")).toHaveAttribute("aria-pressed", "false");
});

test("F-EDIT-9・F-EDIT-10: スマホで語をダブルタップすると、その語を選び、意味を示す", async ({ page }) => {
  // Arrange
  await openReadOnlyText(page, TEXT);
  const p = await wordCenter(page, "attribute", 3, 1);
  // Act
  await page.touchscreen.tap(p.x, p.y);
  await page.touchscreen.tap(p.x, p.y);
  // Assert
  await expect(page.locator("#wordLine b")).toHaveText("属性（attribute）");
  const sel = await page.locator("#ed").evaluate((e: HTMLTextAreaElement) => e.value.slice(e.selectionStart, e.selectionEnd));
  expect(sel).toBe("attribute");
  await expect(page.locator("#ed")).not.toBeEditable();
});

test("F-EDIT-9・F-EDIT-10: スマホで標準ライブラリの型をダブルタップすると、その意味を示す", async ({ page }) => {
  // Arrange
  await openReadOnlyText(page, TEXT);
  const p = await wordCenter(page, "Real", 1, 1);
  // Act
  await page.touchscreen.tap(p.x, p.y);
  await page.touchscreen.tap(p.x, p.y);
  // Assert
  await expect(page.locator("#wordLine b")).toHaveText("実数（Real）");
});
