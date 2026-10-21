// キーボードだけでの操作（Q-8）。ダイアログ・メニュー・図のタブ・モデルツリーを、Chromium で操作する。
import type { Page } from "@playwright/test";
import { expect, openApp, test } from "./fixtures";

/** 入力を受け取っている要素が、セレクタの要素の中にあるか。 */
const focusInside = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement) ?? false, sel);

/** エクスプローラーのサンプルの「閉じる」をキーボードで押し、閉じる前の確認のダイアログを開く。 */
async function openCloseDialog(page: Page): Promise<void> {
  await page.locator("#explorer [data-close]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#dialog")).toBeVisible();
}

test.describe("ダイアログ", () => {
  test("Q-8: ダイアログを開いている間は、Tab と Shift+Tab で入力がダイアログの外へ出ず、背景を操作できない", async ({ page }) => {
    // Arrange
    await openApp(page);
    await openCloseDialog(page);
    // Act
    const inside: boolean[] = [];
    for (const key of [...Array<string>(6).fill("Tab"), ...Array<string>(6).fill("Shift+Tab")]) {
      await page.keyboard.press(key);
      inside.push(await focusInside(page, "#dialog"));
    }
    // Assert
    expect(inside).toEqual(Array<boolean>(12).fill(true));
    await expect(page.locator(".app")).toHaveJSProperty("inert", true);
  });

  test("Q-8: Esc でダイアログを閉じると、開いたボタンへ入力が戻り、背景を操作できるようになる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await openCloseDialog(page);
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(page.locator("#dialog")).toBeHidden();
    await expect(page.locator("#explorer [data-close]")).toBeFocused();
    await expect(page.locator(".app")).toHaveJSProperty("inert", false);
  });

  test("Q-8・F-FILE-14: 開いているファイルが無いときにメニューから開いたダイアログを閉じると、メニューへ入力が戻り、図とテキストは操作できないまま", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#explorer [data-close]").click();
    await page.locator('#dialogButtons [data-id="discard"]').click();
    await expect(page.locator("#noDoc")).toBeVisible();
    await page.locator("#fileMenu summary").click();
    await page.locator("#btnPlugins").click();
    await expect(page.locator("#plugins")).toBeVisible();
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(page.locator("#plugins")).toBeHidden();
    await expect(page.locator("#fileMenu summary")).toBeFocused();
    await expect(page.locator(".app")).toHaveJSProperty("inert", false);
    await expect(page.locator(".diagrampane")).toHaveJSProperty("inert", true);
  });
});

test.describe("draw.io の書き出し", () => {
  test("Q-8・F-EXP-2: draw.io の書き出しはダイアログとして読み上げられ、Esc で閉じるとファイルのメニューへ入力が戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#fileMenu summary").click();
    await page.locator("#btnDrawio").click();
    const dialog = page.getByRole("dialog", { name: "draw.io 形式で書き出す" });
    await expect(dialog).toBeVisible();
    await expect(page.locator("#modalCopy")).toBeFocused();
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(dialog).toBeHidden();
    await expect(page.locator("#fileMenu summary")).toBeFocused();
    await expect(page.locator(".app")).toHaveJSProperty("inert", false);
  });
});

test.describe("メニュー", () => {
  test("Q-8: Esc でファイルのメニューを閉じると、メニューの見出しへ入力が戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#fileMenu summary").click();
    await expect(page.locator("#btnNew")).toBeVisible();
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(page.locator("#fileMenu")).not.toHaveAttribute("open");
    await expect(page.locator("#fileMenu summary")).toBeFocused();
  });

  test("Q-8: キーボードで開いたヘルプのメニューも、項目に入力があるときに Esc で閉じられる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#helpMenu summary").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    expect(await focusInside(page, "#helpMenu .pop")).toBe(true);
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(page.locator("#helpMenu")).not.toHaveAttribute("open");
    await expect(page.locator("#helpMenu summary")).toBeFocused();
  });
});
