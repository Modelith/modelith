// ファイルの一覧の右クリックのメニューと名前の変更（F-FILE-19）。ローカルフォルダの代わりに OPFS を使う。
import { editorText, expect, openApp, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** 中身を置いたフォルダを開く。 */
async function openFolder(page: Page, files: Record<string, string>): Promise<void> {
  await openApp(page);
  await putFiles(page, files);
  await page.locator('[data-cmd="openFolder"]').click();
}

/** フォルダの一覧のファイルとフォルダの行。 */
const row = (page: Page, path: string) => page.locator(`#explorer [data-path="${path}"]`);
/** 右クリックのメニューの項目を選ぶ。 */
async function menu(page: Page, path: string, label: string): Promise<void> {
  await row(page, path).click({ button: "right" });
  await page.locator("#ctx").getByRole("button", { name: label, exact: true }).click();
}
/** 一覧の中の名前の入力欄。 */
const nameInput = (page: Page) => page.locator("#explorer input.rn");
/** クリップボードの中身。 */
const clipboard = (page: Page): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

test("F-FILE-19: 右クリックの「名前の変更」で、開いているファイルと配置ファイルも新しい名前になる", async ({ page }) => {
  // Arrange
  await openFolder(page, { "a.sysml": "package A;\n", "a.layout.json": '{ "version": 1, "nodes": {} }\n' });
  await row(page, "a.sysml").dblclick();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  // Act（拡張子の前までが選ばれているので、名前だけ打ち替える）
  await menu(page, "a.sysml", "名前の変更");
  await nameInput(page).press("b");
  await nameInput(page).press("Enter");
  // Assert
  await expect(page.locator("#docName")).toHaveText("b.sysml");
  await expect(row(page, "b.sysml")).toBeVisible();
  await expect.poll(() => readFile(page, "b.sysml")).toBe("package A;\n");
  expect(await readFile(page, "b.layout.json")).not.toBeNull();
  expect(await readFile(page, "a.sysml")).toBeNull();
  expect(await readFile(page, "a.layout.json")).toBeNull();
});

test("F-FILE-19: F2 で書き換え、使えない名前は理由を示して決めさせず、Esc でやめる", async ({ page }) => {
  // Arrange
  await openFolder(page, { "a.sysml": "package A;\n", "b.sysml": "package B;\n" });
  await row(page, "a.sysml").click();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  // Act
  await row(page, "a.sysml").press("F2");
  await nameInput(page).fill("B.sysml");
  await nameInput(page).press("Enter");
  // Assert（同じ名前があるので決めない）
  await expect(page.locator("#explorer .rnmsg")).toHaveText("同じ場所に「b.sysml」があります");
  await expect(nameInput(page)).toBeVisible();
  // Act（やめる）
  await nameInput(page).press("Escape");
  // Assert
  await expect(nameInput(page)).toHaveCount(0);
  await expect(row(page, "a.sysml")).toBeVisible();
  expect(await readFile(page, "a.sysml")).toBe("package A;\n");
});

test("F-FILE-19: 表示中のファイルの名前をもう一度クリックすると、名前を書き換え始める", async ({ page }) => {
  // Arrange
  await openFolder(page, { "a.sysml": "package A;\n" });
  await row(page, "a.sysml").click();
  await expect(row(page, "a.sysml")).toHaveClass(/sel/);
  // Act
  await row(page, "a.sysml").locator(".nm").click();
  // Assert
  await expect(nameInput(page)).toBeVisible();
  await expect.poll(() => nameInput(page).evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))).toBe("a");
});

test("F-FILE-19: フォルダの名前を変えると、中の開いているファイルは未保存の変更を残したまま新しい場所に移る", async ({ page }) => {
  // Arrange
  await openFolder(page, { "models/x.sysml": "package X;\n" });
  await row(page, "models/x.sysml").dblclick();
  await expect(page.locator("#docName")).toHaveText("x.sysml");
  await page.locator("#ed").fill("package X2;\n");
  // Act
  await menu(page, "models", "名前の変更");
  await nameInput(page).fill("parts");
  await nameInput(page).press("Enter");
  // Assert
  await expect(row(page, "parts/x.sysml")).toBeVisible();
  await expect(row(page, "models")).toHaveCount(0);
  await expect.poll(() => readFile(page, "parts/x.sysml")).toBe("package X;\n");
  expect(await readFile(page, "models/x.sysml")).toBeNull();
  await expect(page.locator("#docName")).toContainText("●");
  expect(await editorText(page)).toBe("package X2;\n");
});

test("F-FILE-19: 削除は、名前と元に戻せないことを示して確かめてから、配置ファイルも消して、開いていたファイルを閉じる", async ({ page }) => {
  // Arrange
  await openFolder(page, { "a.sysml": "package A;\n", "a.layout.json": '{ "version": 1, "nodes": {} }\n', "b.sysml": "package B;\n" });
  await row(page, "a.sysml").dblclick();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  // Act
  await menu(page, "a.sysml", "削除…");
  // Assert
  await expect(page.locator("#dialogText")).toHaveText("「a.sysml」を削除しますか？ 図の配置のファイル（a.layout.json）も削除します。削除したものは元に戻せません。");
  // Act
  await page.locator('#dialogButtons [data-id="delete"]').click();
  // Assert
  await expect(row(page, "a.sysml")).toHaveCount(0);
  await expect(page.locator("#explorer [data-doc] .nm", { hasText: "a.sysml" })).toHaveCount(0);
  await expect.poll(() => readFile(page, "a.sysml")).toBeNull();
  expect(await readFile(page, "a.layout.json")).toBeNull();
  expect(await readFile(page, "b.sysml")).toBe("package B;\n");
});

test("F-FILE-19: 削除の確かめで「やめる」を選ぶと、何も消さない", async ({ page }) => {
  // Arrange
  await openFolder(page, { "models/x.sysml": "package X;\n" });
  // Act
  await menu(page, "models", "削除…");
  await expect(page.locator("#dialogText")).toHaveText("フォルダ「models」を中身ごと削除しますか？ 削除したものは元に戻せません。");
  await page.locator('#dialogButtons [data-id="cancel"]').click();
  // Assert
  await expect(row(page, "models/x.sysml")).toBeVisible();
  expect(await readFile(page, "models/x.sysml")).toBe("package X;\n");
});

test("F-FILE-19: フォルダのメニューから、新しいフォルダーと、その中の新しいファイルを作れる", async ({ page }) => {
  // Arrange
  await openFolder(page, { "models/x.sysml": "package X;\n" });
  // Act
  await menu(page, "models", "新しいフォルダー…");
  await page.locator("#dialogInput").fill("sub");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert（空のフォルダも一覧に出る）
  await expect(row(page, "models/sub")).toBeVisible();
  // Act
  await menu(page, "models/sub", "新しいファイル…");
  await page.locator("#dialogInput").fill("y.sysml");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("y.sysml");
  await expect(row(page, "models/sub/y.sysml")).toBeVisible();
  await expect.poll(() => readFile(page, "models/sub/y.sysml")).toBe("");
});

test("F-FILE-19: パスのコピーは開いたフォルダの名前から、相対パスのコピーはフォルダの中からのパスを入れる", async ({ page }) => {
  // Arrange
  await openFolder(page, { "models/x.sysml": "package X;\n" });
  // Act
  await menu(page, "models/x.sysml", "パスのコピー");
  // Assert
  await expect.poll(() => clipboard(page)).toBe("project/models/x.sysml");
  // Act
  await menu(page, "models/x.sysml", "相対パスのコピー");
  // Assert
  await expect.poll(() => clipboard(page)).toBe("models/x.sysml");
});
