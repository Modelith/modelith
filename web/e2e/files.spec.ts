// VS Code のようなファイル操作（F-FILE-1〜9・11）。ローカルフォルダの代わりに OPFS を使う。
import { editorText, expect, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";
import type { Page } from "@playwright/test";

const A = "package A {\n    part def Alpha;\n}\n";
const B = "package B {\n    part def Beta;\n}\n";

/** project フォルダに a.sysml と models/b.sysml を置き、フォルダを開く。 */
async function openProject(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": A, "models/b.sysml": B, "notes.md": "not a model" });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator("#explorer [data-file]").first().waitFor();
}

const docName = (page: Page): Promise<string> => page.locator("#docName").innerText();

test("F-FILE-1: フォルダを開くと、モデルのファイルだけがツリーで表示される", async ({ page }) => {
  // Arrange
  await openApp(page);
  await putFiles(page, { "a.sysml": A, "models/b.sysml": B, "notes.md": "x" });
  // Act
  await page.locator('[data-cmd="openFolder"]').click();
  // Assert
  await expect(page.locator('#explorer [data-dir="models"]')).toBeVisible();
  await expect(page.locator('#explorer [data-file][title="models/b.sysml"]')).toBeVisible();
  await expect(page.locator('#explorer [data-file][title="a.sysml"]')).toBeVisible();
  await expect(page.locator("#explorer")).not.toContainText("notes.md");
});

test("F-FILE-2: ファイルを開いて編集し、Ctrl+S で元のファイルに上書き保存できる", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await typeAtEnd(page, "// edited\n");
  // Act
  await page.keyboard.press("Control+s");
  // Assert
  await expect.poll(() => readFile(page, "a.sysml")).toBe(A + "// edited\n");
  await expect(page.locator("#docName")).toHaveText("a.sysml");
});

test("F-FILE-3: フォルダに新しいファイルを作れ、無題の文書は名前を付けて保存できる", async ({ page }) => {
  // Arrange
  await openProject(page);
  // Act
  await page.locator('[data-cmd="newInFolder"]').click();
  await page.locator("#dialogInput").fill("models/c.sysml");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  await page.locator('[data-cmd="new"]').click();
  await typeAtEnd(page, "package U;\n");
  await page.keyboard.press("Control+s");
  // Assert
  await expect(page.locator('#explorer [data-file][title="models/c.sysml"]')).toBeVisible();
  await expect.poll(() => readFile(page, "untitled-1.sysml")).toBe("package U;\n");
  await expect(page.locator('#explorer [data-file][title="untitled-1.sysml"]')).toBeVisible();
});

test("F-FILE-4: 複数のファイルを切り替えても、未保存の変更は残る", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await typeAtEnd(page, "// unsaved\n");
  // Act
  await page.locator('#explorer [data-file][title="models/b.sysml"]').click();
  await expect(page.locator("#docName")).toHaveText("b.sysml");
  const shownB = await editorText(page);
  await page.locator('#explorer [data-doc]:has-text("a.sysml")').click();
  // Assert
  expect(shownB).toBe(B);
  await expect.poll(() => editorText(page)).toBe(A + "// unsaved\n");
});

test("F-FILE-5: 未保存の変更を ● で示し、そのままページを離れようとすると警告する", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await typeAtEnd(page, "// unsaved\n");
  await expect(page.locator("#docName")).toHaveText("a.sysml ●");
  const dialog = page.waitForEvent("dialog");
  // Act
  await page.close({ runBeforeUnload: true });
  // Assert
  const d = await dialog;
  expect(d.type()).toBe("beforeunload");
  await d.dismiss();
});

test("F-FILE-6: 自動保存を有効にすると、編集が止まってから保存される", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await page.locator("#fileMenu summary").click();
  await page.locator("#autoSave").check();
  await page.locator("#fileMenu summary").click();
  // Act
  await typeAtEnd(page, "// auto\n");
  // Assert
  await expect.poll(() => readFile(page, "a.sysml"), { timeout: 3000 }).toBe(A + "// auto\n");
  await expect(page.locator("#docName")).toHaveText("a.sysml");
});

test("F-FILE-7: 他のアプリで変わったファイルは黙って上書きせず、選ばせる", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await typeAtEnd(page, "// mine\n");
  await putFiles(page, { "a.sysml": "package Theirs;\n" });
  // Act
  await page.keyboard.press("Control+s");
  // 保存は非同期なので、ダイアログが出るのを待ってから確かめる
  await expect(page.locator("#dialogTitle")).toHaveText("ファイルが他で変更されています");
  const untouched = await readFile(page, "a.sysml");
  await page.locator('#dialogButtons [data-id="overwrite"]').click();
  // Assert
  expect(untouched).toBe("package Theirs;\n");
  await expect.poll(() => readFile(page, "a.sysml")).toBe(A + "// mine\n");
});

test("F-FILE-7: 競合したとき「読み込む」を選ぶと、自分の変更を捨ててファイルの内容になる", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await typeAtEnd(page, "// mine\n");
  await putFiles(page, { "a.sysml": "package Theirs;\n" });
  await page.keyboard.press("Control+s");
  // Act
  await page.locator('#dialogButtons [data-id="reload"]').click();
  // Assert
  await expect.poll(() => editorText(page)).toBe("package Theirs;\n");
  await expect(page.locator("#docName")).toHaveText("a.sysml");
});

test("F-FILE-8: 画面に戻ったとき、未編集のファイルは他のアプリでの変更を読み直す", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await putFiles(page, { "a.sysml": "package Reloaded;\n" });
  // Act
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Assert
  await expect.poll(() => editorText(page)).toBe("package Reloaded;\n");
});

test("F-FILE-9: 再読み込みの後、前回のフォルダを開き直せる", async ({ page }) => {
  // Arrange
  await openProject(page);
  await page.reload();
  await page.locator("#gNodes .node").first().waitFor();
  // Act
  await page.locator('[data-cmd="reopen"]').click();
  // Assert
  await expect(page.locator('#explorer [data-file][title="a.sysml"]')).toBeVisible();
});

test("F-FILE-11: 保存先の無い文書の編集は、再読み込みしても下書きとして残る", async ({ page }) => {
  // Arrange
  await openApp(page);
  await typeAtEnd(page, "// draft\n");
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ
  // Act
  await page.reload();
  await page.locator("#gNodes .node").first().waitFor();
  // Assert
  expect(await editorText(page)).toContain("// draft\n");
  expect(await docName(page)).toContain("electric-kettle.sysml");
});
