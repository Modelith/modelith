// プロジェクトの一覧（F-PROJ-3）。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, pickDirNext, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** project フォルダを開き、続けて other フォルダを開く（一覧は other・project の順）。 */
async function openTwoFolders(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": "package A;\n", "modelith.json": '{ "name": "給水" }' });
  await putFiles(page, { "o.sysml": "package O;\n" }, "other");
  await page.locator('[data-cmd="openFolder"]').click();
  await expect(fileRow(page, "a.sysml")).toBeVisible();
  await pickDirNext(page, "other");
  await projectMenu(page, "ほかのフォルダを開く…");
  await expect(fileRow(page, "o.sysml")).toBeVisible();
}

/** フォルダの一覧のファイル。 */
const fileRow = (page: Page, path: string) => page.locator(`#explorer [data-path="${path}"]`);
/** フォルダを開いていないときの、プロジェクトの一覧の名前。 */
const recentNames = (page: Page) => page.locator("#explorer [data-recent] .nm").allTextContents();
/** 開いているフォルダの見出しを押して、プロジェクトの一覧のメニューの項目を選ぶ。 */
async function projectMenu(page: Page, label: string): Promise<void> {
  await page.locator("#explorer [data-folder]").click();
  await page.locator("#ctx").getByRole("button", { name: label, exact: true }).click();
}

test("F-PROJ-3: 見出しのメニューから、一覧のほかのフォルダに切り替えられ、開いているファイルは残る", async ({ page }) => {
  // Arrange
  await openTwoFolders(page);
  await fileRow(page, "o.sysml").dblclick();
  await expect(page.locator("#docName")).toHaveText("o.sysml");
  // Act（プロジェクト名を覚えているので、名前で出る）
  await projectMenu(page, "給水（フォルダ project）");
  // Assert
  await expect(fileRow(page, "a.sysml")).toBeVisible();
  await expect(page.locator("#explorer [data-folder]")).toHaveText("給水");
  await expect(page.locator("#explorer [data-doc] .nm", { hasText: "o.sysml" })).toBeVisible();
});

test("F-PROJ-3: フォルダを閉じると、最後に開いた順のプロジェクトの一覧を出し、選んで開き直せる", async ({ page }) => {
  // Arrange
  await openTwoFolders(page);
  // Act
  await projectMenu(page, "フォルダを閉じる");
  // Assert
  await expect(page.locator("#explorer [data-folder]")).toHaveCount(0);
  await expect.poll(() => recentNames(page)).toEqual(["other", "給水（フォルダ project）"]);
  // Act
  await page.locator("#explorer [data-recent] .nm", { hasText: "給水" }).click();
  // Assert
  await expect(fileRow(page, "a.sysml")).toBeVisible();
});

test("F-PROJ-3: 一覧から外しても、フォルダの中身は消さない", async ({ page }) => {
  // Arrange
  await openTwoFolders(page);
  await projectMenu(page, "フォルダを閉じる");
  await expect.poll(() => recentNames(page)).toHaveLength(2);
  // Act
  await page.locator('#explorer [data-recent]').filter({ hasText: "other" }).locator("[data-forget]").click();
  // Assert
  await expect.poll(() => recentNames(page)).toEqual(["給水（フォルダ project）"]);
  expect(await page.evaluate(async () => (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("other")).getFileHandle("o.sysml")).getFile()).text())).toBe("package O;\n");
});

test("F-PROJ-3: 開けなかった（削除された）フォルダは、そのことを示して一覧から外すかを尋ねる", async ({ page }) => {
  // Arrange
  await openTwoFolders(page);
  await projectMenu(page, "フォルダを閉じる");
  await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry("other", { recursive: true }));
  // Act
  await page.locator('#explorer [data-recent]').filter({ hasText: "other" }).click();
  // Assert
  await expect(page.locator("#dialogText")).toHaveText("フォルダ「other」を開けませんでした。移動したか、削除された可能性があります。プロジェクトの一覧から外しますか？ フォルダの中身には触れません。");
  // Act
  await page.locator('#dialogButtons [data-id="forget"]').click();
  // Assert
  await expect.poll(() => recentNames(page)).toEqual(["給水（フォルダ project）"]);
  expect(await readFile(page, "a.sysml")).toBe("package A;\n");
});

test("F-PROJ-3: ファイルメニューの「最近開いたフォルダ」から切り替え、「フォルダを閉じる」で閉じられる", async ({ page }) => {
  // Arrange
  await openTwoFolders(page);
  // Act
  await page.locator("#fileMenu summary").click();
  // Assert（開いているフォルダは出さない）
  await expect(page.locator("#recentMenu button")).toHaveText(["給水（フォルダ project）"]);
  // Act
  await page.locator("#recentMenu button").click();
  // Assert
  await expect(fileRow(page, "a.sysml")).toBeVisible();
  // Act
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnCloseFolder").click();
  // Assert
  await expect(page.locator("#explorer [data-folder]")).toHaveCount(0);
  await page.locator("#fileMenu summary").click();
  await expect(page.locator("#btnCloseFolder")).toBeHidden();
});

test("F-PROJ-3: 見出しの名前 ▾ は、キーボード（Enter）でもプロジェクトの一覧を出す", async ({ page }) => {
  // Arrange
  await openTwoFolders(page);
  // Act
  await page.locator("#explorer [data-folder]").focus();
  await page.keyboard.press("Enter");
  // Assert
  await expect(page.locator("#ctx")).toContainText("プロジェクトの一覧");
  await expect(page.locator("#ctx").getByRole("button", { name: "フォルダを閉じる", exact: true })).toBeVisible();
});
