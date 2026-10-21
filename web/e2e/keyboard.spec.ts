// キーボードだけでの操作（Q-8）。ダイアログ・メニュー・図のタブ・モデルツリーを、Chromium で操作する。
import type { Page } from "@playwright/test";
import { expect, openApp, test } from "./fixtures";

/** 入力を受け取っている要素が、セレクタの要素の中にあるか。 */
const focusInside = (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((sel) => document.querySelector(sel)?.contains(document.activeElement) ?? false, sel);

/** Tab を最大 max 回押し、セレクタに合う要素に入力が来たら true を返す（来なければ false）。 */
async function tabUntil(page: Page, sel: string, max = 80): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, sel)) return true;
  }
  return false;
}

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
    await page.locator("#pluginMenu summary").click();
    await page.locator("#btnPlugins").click();
    await expect(page.locator("#plugins")).toBeVisible();
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(page.locator("#plugins")).toBeHidden();
    await expect(page.locator("#pluginMenu summary")).toBeFocused();
    await expect(page.locator(".app")).toHaveJSProperty("inert", false);
    await expect(page.locator(".diagrampane")).toHaveJSProperty("inert", true);
  });
});

test.describe("エクスポート", () => {
  test("Q-8・F-EXP-1・F-EXP-2: エクスポートはダイアログとして読み上げられ、入力はファイル名の欄に置き、Esc で閉じるとファイルのメニューへ入力が戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#fileMenu summary").click();
    await page.locator("#btnExport").click();
    const dialog = page.getByRole("dialog", { name: "エクスポート" });
    await expect(dialog).toBeVisible();
    await expect(page.locator("#exportName")).toBeFocused();
    await expect(page.locator(".app")).toHaveJSProperty("inert", true);
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

test.describe("図のタブ", () => {
  test("Q-8・F-VIEW-2: Tab で選んでいる図のタブに入り、右の矢印キーで次のタブに切り替わる", async ({ page }) => {
    // Arrange
    await openApp(page);
    const tabs = page.locator("#tabbar .tab");
    expect(await tabUntil(page, "#tabbar .tab")).toBe(true);
    await expect(tabs.nth(0)).toBeFocused();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    // Act
    await page.keyboard.press("ArrowRight");
    // Assert
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(tabs.nth(0)).toHaveAttribute("tabindex", "-1");
  });

  test("Q-8・F-VIEW-2: 先頭の図のタブで左の矢印キーを押すと、最後のタブへ回る", async ({ page }) => {
    // Arrange
    await openApp(page);
    const tabs = page.locator("#tabbar .tab");
    const last = (await tabs.count()) - 1;
    await tabs.nth(0).focus();
    // Act
    await page.keyboard.press("ArrowLeft");
    // Assert
    await expect(tabs.nth(last)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(last)).toBeFocused();
  });

  test("Q-8・F-VIEW-2: 図のタブで End を押すと最後のタブへ、Home を押すと先頭のタブへ切り替わる", async ({ page }) => {
    // Arrange
    await openApp(page);
    const tabs = page.locator("#tabbar .tab");
    const last = (await tabs.count()) - 1;
    await tabs.nth(0).focus();
    await page.keyboard.press("End");
    await expect(tabs.nth(last)).toHaveAttribute("aria-selected", "true");
    // Act
    await page.keyboard.press("Home");
    // Assert
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toBeFocused();
  });
});

test.describe("モデルツリー", () => {
  test("Q-8・F-VIEW-5: 行を選んでいなければ、検索欄から Tab で先頭の行に入り、下の矢印キーで次の行へ移る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#sideModel").click();
    const rows = page.locator("#tree .ti");
    await page.locator("#treeSearch").focus();
    await page.keyboard.press("Tab");
    await expect(rows.nth(0)).toBeFocused();
    // Act
    await page.keyboard.press("ArrowDown");
    // Assert
    await expect(rows.nth(1)).toBeFocused();
    await expect(page.locator('#tree .ti[tabindex="0"]')).toHaveCount(1);
  });

  test("Q-8・F-VIEW-5: 行を選んでいれば、検索欄から Tab でその行に入る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#sideModel").click();
    await page.locator("#tree .ti").nth(1).locator(".nm").click();
    await expect(page.locator("#tree .ti.sel")).toHaveCount(1);
    await page.locator("#treeSearch").focus();
    // Act
    await page.keyboard.press("Tab");
    // Assert
    await expect(page.locator("#tree .ti.sel")).toBeFocused();
  });
});
