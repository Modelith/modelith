// 黙って失われない・黙って止まらない（F-FILE-6・F-FILE-11・F-VIEW-2・Q-6）。
// 保存の失敗やブラウザの保存領域の不足、壊れた記憶、予期しない例外を起こして、利用者に知らせることを確かめる。
import type { Page } from "@playwright/test";
import { expect, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";

const A = "package A {\n    part def Pump;\n}\n";

/** フォルダ（OPFS の project）を開き、a.sysml を表示して、自動保存を有効にする。 */
async function openWithAutoSave(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": A });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await page.locator("#fileMenu summary").click();
  await page.locator("#autoSave").check();
  await page.locator("#fileMenu summary").click();
}

test("F-FILE-6: 自動保存に失敗したら（フォルダの許可が切れた）、理由を知らせて未保存の印を残す（異常系）", async ({ page }) => {
  // Arrange（書き込みが許可の失効で失敗するブラウザのふり）
  await openWithAutoSave(page);
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new DOMException("permission revoked", "NotAllowedError"));
  });
  // Act
  await typeAtEnd(page, "// auto\n");
  // Assert
  await expect(page.locator("#toast")).toHaveText("「a.sysml」を自動保存できませんでした：permission revoked", { timeout: 3000 });
  await expect(page.locator("#docName")).toHaveText("a.sysml ●");
  expect(await readFile(page, "a.sysml")).toBe(A);
});
