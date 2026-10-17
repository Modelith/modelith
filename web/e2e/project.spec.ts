// プロジェクト（ADR-0019、F-PROJ-1）。フォルダの一番上の modelith.json を読み、プロジェクト名を示す。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

const A = "package A {\n    part def Alpha;\n}\n";

/** 開いているフォルダの見出し。 */
const folderTitle = (page: Page) => page.locator("#explorer [data-folder]");

/** project フォルダにファイルを置き、フォルダを開く。 */
async function openFolderWith(page: Page, files: Record<string, string>): Promise<void> {
  await openApp(page);
  await putFiles(page, files);
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator("#explorer [data-file]").first().waitFor();
}

test("F-PROJ-1: modelith.json のあるフォルダを開くと、プロジェクト名を示す", async ({ page }) => {
  // Arrange
  await openApp(page);
  await putFiles(page, { "a.sysml": A, "modelith.json": '{ "name": "給水システム", "plugins": {} }\n' });
  // Act
  await page.locator('[data-cmd="openFolder"]').click();
  // Assert
  await expect(folderTitle(page)).toHaveText("給水システム");
  await expect(folderTitle(page)).toHaveAttribute("title", "プロジェクト「給水システム」（フォルダ「project」）");
  await expect(page.locator('[data-cmd="makeProject"]')).toHaveCount(0);
  await expect(page.locator("#explorer")).not.toContainText("modelith.json"); // ツリーはモデルのファイルだけ
});

test("F-PROJ-1: modelith.json の無いフォルダは、今までどおりフォルダ名を示し、何も書かない", async ({ page }) => {
  // Arrange・Act
  await openFolderWith(page, { "a.sysml": A });
  // Assert
  await expect(folderTitle(page)).toHaveText("PROJECT");
  await expect(page.locator('[data-cmd="makeProject"]')).toBeVisible();
  expect(await readFile(page, "modelith.json")).toBeNull();
});

test("F-PROJ-1: 「プロジェクトにする」で名前を尋ね、modelith.json を作る", async ({ page }) => {
  // Arrange
  await openFolderWith(page, { "a.sysml": A });
  await page.locator('[data-cmd="makeProject"]').click();
  await expect(page.locator("#dialogInput")).toHaveValue("project"); // 既定はフォルダ名
  // Act
  await page.locator("#dialogInput").fill("給水システム");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect.poll(() => readFile(page, "modelith.json")).toBe('{\n  "name": "給水システム",\n  "plugins": {}\n}\n');
  await expect(folderTitle(page)).toHaveText("給水システム");
  await expect(page.locator('[data-cmd="makeProject"]')).toHaveCount(0);
});

test("F-PROJ-1: 「プロジェクトにする」をやめたら、何も書かない（C-6）", async ({ page }) => {
  // Arrange
  await openFolderWith(page, { "a.sysml": A });
  await page.locator('[data-cmd="makeProject"]').click();
  // Act
  await page.locator('#dialogButtons [data-id="cancel"]').click();
  // Assert
  await expect(folderTitle(page)).toHaveText("PROJECT");
  expect(await readFile(page, "modelith.json")).toBeNull();
});

test("F-PROJ-1: 前回のフォルダを開き直しても、プロジェクト名を示す", async ({ page }) => {
  // Arrange
  await openFolderWith(page, { "a.sysml": A, "modelith.json": '{ "name": "給水" }' });
  await page.reload();
  await page.locator("#gNodes .node").first().waitFor();
  // Act
  await page.locator('[data-cmd="reopen"]').click();
  // Assert
  await expect(folderTitle(page)).toHaveText("給水");
});

test("F-PROJ-1: 一覧を更新すると、他で作られた modelith.json を読む", async ({ page }) => {
  // Arrange
  await openFolderWith(page, { "a.sysml": A });
  await putFiles(page, { "modelith.json": '{ "name": "給水" }' });
  // Act
  await page.locator('[data-cmd="refresh"]').click();
  // Assert
  await expect(folderTitle(page)).toHaveText("給水");
});

test("F-PROJ-1: 読み取れない modelith.json は、行と理由を知らせ、フォルダ名を示す", async ({ page }) => {
  // Arrange・Act
  await openFolderWith(page, { "a.sysml": A, "modelith.json": '{\n  "name": 3\n}\n' });
  // Assert
  await expect(page.locator("#toast")).toHaveText("プロジェクトの設定（modelith.json）を使えません。2 行目：プロジェクト名（name）は、文字を \" \" で囲んで書いてください");
  await expect(folderTitle(page)).toHaveText("PROJECT");
  await expect(page.locator('[data-cmd="makeProject"]')).toHaveCount(0); // 既にあるファイルは上書きしない
});

test("F-PROJ-1: modelith.json の知らない項目は、消さずに残すことを知らせる", async ({ page }) => {
  // Arrange・Act
  await openFolderWith(page, { "a.sysml": A, "modelith.json": '{ "name": "給水", "color": "red" }' });
  // Assert
  await expect(page.locator("#toast")).toHaveText("プロジェクトの設定（modelith.json）の 1 行目：知らない項目「color」があります。消さずに残します");
  await expect(folderTitle(page)).toHaveText("給水");
});
