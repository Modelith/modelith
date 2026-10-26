// 開いているフォルダをフォルダごと削除する（F-PROJ-4）。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** OPFS の一番上に project フォルダがあるか。 */
const folderExists = (page: Page): Promise<boolean> =>
  page.evaluate(async () => {
    try {
      await (await navigator.storage.getDirectory()).getDirectoryHandle("project");
      return true;
    } catch {
      return false;
    }
  });

/** project フォルダを開き、a.sysml を開いて、見出しのメニューから「このフォルダを削除…」を選ぶ。 */
async function askDelete(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": "package A;\n", "notes.txt": "メモ\n" });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-path="a.sysml"]').dblclick();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  await page.locator("#explorer [data-folder]").click();
  await page.locator("#ctx").getByRole("button", { name: "このフォルダを削除…", exact: true }).click();
}

test("F-PROJ-4: 2 回確かめて、フォルダの名前が合えば中身ごと削除し、中のファイルを閉じる", async ({ page }) => {
  // Arrange
  await askDelete(page);
  // Assert（1 回目：消えるものと元に戻せないこと）
  await expect(page.locator("#dialogText")).toContainText("フォルダ「project」を、中のすべてのファイルごとパソコンから削除しますか？");
  await expect(page.locator("#dialogText")).toContainText("削除したものは元に戻せません。");
  // Act
  await page.locator('#dialogButtons [data-id="next"]').click();
  await page.locator("#dialogInput").fill("project");
  await page.locator('#dialogButtons [data-id="delete"]').click();
  // Assert
  await expect.poll(() => folderExists(page)).toBe(false);
  await expect(page.locator("#explorer [data-folder]")).toHaveCount(0);
  await expect(page.locator("#explorer [data-doc] .nm", { hasText: "a.sysml" })).toHaveCount(0);
  await expect(page.locator("#explorer [data-recent]")).toHaveCount(0);
});

test("F-PROJ-4: 2 回目にフォルダの名前が合わなければ、何も削除しない（異常系）", async ({ page }) => {
  // Arrange
  await askDelete(page);
  await page.locator('#dialogButtons [data-id="next"]').click();
  // Act
  await page.locator("#dialogInput").fill("projec");
  await page.locator('#dialogButtons [data-id="delete"]').click();
  // Assert
  await expect(page.locator("#toast")).toContainText("フォルダの名前が合わないので、削除しませんでした");
  expect(await folderExists(page)).toBe(true);
  await expect(page.locator('#explorer [data-path="a.sysml"]')).toBeVisible();
});

test("F-PROJ-4: 1 回目で「やめる」を選ぶと、何も削除しない", async ({ page }) => {
  // Arrange
  await askDelete(page);
  // Act
  await page.locator('#dialogButtons [data-id="cancel"]').click();
  // Assert
  expect(await folderExists(page)).toBe(true);
  await expect(page.locator("#docName")).toHaveText("a.sysml");
});
