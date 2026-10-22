// ファイルを仮に開く（F-FILE-17）。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** a・b・c のフォルダを開く。 */
async function openFolder(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": "package A;\n", "b.sysml": "package B;\n", "c.sysml": "package C;\n" });
  await page.locator('[data-cmd="openFolder"]').click();
}

/** フォルダの一覧のファイル。 */
const row = (page: Page, name: string) => page.locator(`#explorer [data-file][title="${name}"]`);
/** 開いているファイルの一覧（名前と、仮に開いているか）。 */
const openDocs = (page: Page) =>
  page.locator("#explorer [data-doc]").evaluateAll((els) => els.map((e) => `${e.querySelector(".nm")?.textContent ?? ""}${e.classList.contains("pv") ? "*" : ""}`));

test("F-FILE-17: フォルダの一覧で 1 回クリックしたファイルは仮に開き、次に 1 回クリックしたファイルと置き換わる", async ({ page }) => {
  // Arrange
  await openFolder(page);
  await row(page, "a.sysml").click();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  // Act
  await row(page, "b.sysml").click();
  await expect(page.locator("#docName")).toHaveText("b.sysml");
  // Assert（サンプルと、仮に開いた b だけ。名前は斜体）
  await expect.poll(() => openDocs(page)).toEqual(["electric-kettle.sysml", "b.sysml*"]);
  await expect(page.locator("#docName")).toHaveClass(/pv/);
});

test("F-FILE-17: ダブルクリック・編集したファイルは開いたままになり、置き換わらない", async ({ page }) => {
  // Arrange
  await openFolder(page);
  await row(page, "a.sysml").dblclick();
  await expect.poll(() => openDocs(page)).toEqual(["electric-kettle.sysml", "a.sysml"]);
  await row(page, "b.sysml").click();
  await expect(page.locator("#docName")).toHaveText("b.sysml");
  await page.locator("#ed").fill("package B2;\n");
  // Act
  await row(page, "c.sysml").click();
  await expect(page.locator("#docName")).toHaveText("c.sysml");
  // Assert
  await expect.poll(() => openDocs(page)).toEqual(["electric-kettle.sysml", "a.sysml", "b.sysml", "c.sysml*"]);
});

test("F-FILE-17: 開いているファイルの一覧でダブルクリックすると、仮に開いたファイルを開いたままにする", async ({ page }) => {
  // Arrange
  await openFolder(page);
  await row(page, "a.sysml").click();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  // Act
  await page.locator('#explorer [data-doc] .nm', { hasText: "a.sysml" }).dblclick();
  await row(page, "b.sysml").click();
  await expect(page.locator("#docName")).toHaveText("b.sysml");
  // Assert
  await expect.poll(() => openDocs(page)).toEqual(["electric-kettle.sysml", "a.sysml", "b.sysml*"]);
});
