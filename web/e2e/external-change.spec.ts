// 他のアプリでのファイルの変更の知らせ（F-FILE-8・F-FILE-18）。ローカルフォルダの代わりに OPFS を使う。
import { editorText, expect, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";
import type { Page } from "@playwright/test";

const A = "package A;\n";
const B = "package B;\n";

/** a.sysml と b.sysml のフォルダを開き、両方を開いたままにする（表示中は b.sysml）。 */
async function openBoth(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": A, "b.sysml": B });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').dblclick();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  await page.locator('#explorer [data-file][title="b.sysml"]').dblclick();
  await expect(page.locator("#docName")).toHaveText("b.sysml");
}

test("F-FILE-18: 他のアプリで変わったファイルを編集し始めると、ファイル名を示して尋ね、読み込むを選べばファイルの内容になる", async ({ page }) => {
  // Arrange
  await openBoth(page);
  await putFiles(page, { "b.sysml": "package Theirs;\n" });
  // Act
  await typeAtEnd(page, "// mine\n");
  await expect(page.locator("#dialogTitle")).toHaveText("ファイルが他で変更されています");
  await expect(page.locator("#dialogText")).toContainText("「b.sysml」は開いた後に他のアプリで変更されています");
  await page.locator('#dialogButtons [data-id="reload"]').click();
  // Assert（いま入力した変更は捨て、ファイルは書き換えない）
  await expect.poll(() => editorText(page)).toBe("package Theirs;\n");
  expect(await readFile(page, "b.sysml")).toBe("package Theirs;\n");
});

test("F-FILE-18: 「このまま編集する」を選ぶと入力を残し、保存するときに上書きするかを選べる", async ({ page }) => {
  // Arrange
  await openBoth(page);
  await putFiles(page, { "b.sysml": "package Theirs;\n" });
  await typeAtEnd(page, "// mine\n");
  await page.locator('#dialogButtons [data-id="keep"]').click();
  // Act
  await page.keyboard.press("Control+s");
  // Assert（黙って上書きせず、F-FILE-7 の選択を出す）
  await expect(page.locator("#dialogText")).toContainText("「b.sysml」は開いた後に他のアプリで変更されました");
  expect(await editorText(page)).toBe(B + "// mine\n");
  expect(await readFile(page, "b.sysml")).toBe("package Theirs;\n");
});

test("F-FILE-18: 他のアプリで変わっていなければ、編集し始めても尋ねない", async ({ page }) => {
  // Arrange
  await openBoth(page);
  // Act
  await typeAtEnd(page, "// mine\n");
  await page.keyboard.press("Control+s");
  // Assert
  await expect.poll(() => readFile(page, "b.sysml")).toBe(B + "// mine\n");
  await expect(page.locator("#dialog")).toBeHidden();
});

test("F-FILE-8: 画面に戻ったとき、表示中でないファイルが他のアプリで変わっていても、名前を示して知らせる", async ({ page }) => {
  // Arrange（表示中は b.sysml。a.sysml は未編集、b.sysml は編集中）
  await openBoth(page);
  await typeAtEnd(page, "// mine\n");
  // 入力が文書に入る（未保存の印が付く）のを待ってから、他のアプリで書き換える
  await expect(page.locator("#docName")).toContainText("●");
  await putFiles(page, { "a.sysml": "package A2;\n", "b.sysml": "package B2;\n" });
  // Act
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Assert
  await expect(page.locator("#toast")).toHaveText(
    "他のアプリで変更された「a.sysml」を読み直しました。「b.sysml」は他のアプリで変更されています。未保存の変更があるため読み直していません。保存するときに選べます",
  );
  expect(await editorText(page)).toBe(B + "// mine\n");
});
