// フォルダのすべてのファイルの問題（ADR-0021 §6、F-FILE-16）。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, test } from "./fixtures";

const APP = "package App {\n    part def Wheel;\n}\n";
const PARTS = "package Parts {\n    part def Car {\n        part w : Nope;\n    }\n}\n";

test("F-FILE-16: 表示中でないファイルの問題を、ファイルごとに問題一覧へ出し、ファイルの一覧でそのファイルを赤くして件数を添える", async ({ page }) => {
  // Arrange
  await openApp(page);
  await putFiles(page, { "app.sysml": APP, "lib/parts.sysml": PARTS });
  await page.locator('[data-cmd="openFolder"]').click();
  // Act
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  // Assert
  await expect(page.locator("#problems .pfile")).toContainText("lib/parts.sysml");
  await expect(page.locator('#problems button[data-path="lib/parts.sysml"]')).toHaveText("⚠ 3 行目：型「Nope」が見つかりません（w）");
  await expect(page.locator('#explorer .fi.err[title="lib/parts.sysml"] .cnt')).toHaveText("1");
  await expect(page.locator('#explorer .fi.err[data-dir="lib"]')).toBeVisible();
  await expect(page.locator('#explorer .fi[data-file][title="app.sysml"]')).not.toHaveClass(/err|warn/);
});

test("F-FILE-16: ほかのファイルの問題の行を押すと、そのファイルを開いてその行へ移る", async ({ page }) => {
  // Arrange
  await openApp(page);
  await putFiles(page, { "app.sysml": APP, "lib/parts.sysml": PARTS });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  // Act
  await page.locator('#problems button[data-path="lib/parts.sysml"]').click();
  // Assert（カーソルは part w の始まり）
  await expect(page.locator("#docName")).toHaveText("parts.sysml");
  await expect.poll(() => page.locator("#ed").evaluate((el) => (el as HTMLTextAreaElement).selectionStart)).toBe(PARTS.indexOf("part w"));
});

test("F-FILE-16: 表示中のファイルで直すと、ほかのファイルの問題も消える", async ({ page }) => {
  // Arrange（parts.sysml は App の Nope を import して使う）
  await openApp(page);
  await putFiles(page, { "app.sysml": APP, "parts.sysml": PARTS.replace("package Parts {", "package Parts {\n    import App::*;") });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  await expect(page.locator('#problems button[data-path="parts.sysml"]')).toHaveCount(1);
  // Act（表示中の app.sysml に Nope を足す。保存しない）
  await page.locator("#ed").fill(APP.replace("part def Wheel;", "part def Wheel;\n    part def Nope;"));
  // Assert
  await expect(page.locator('#problems button[data-path="parts.sysml"]')).toHaveCount(0);
  await expect(page.locator('#explorer .fi[data-file][title="parts.sysml"]')).not.toHaveClass(/err/);
});
