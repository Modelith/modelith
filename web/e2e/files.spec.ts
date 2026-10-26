// VS Code のようなファイル操作（F-FILE-1〜9・11・13・14）。ローカルフォルダの代わりに OPFS を使う。
import { editorText, expect, needPermission, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";
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
  await page.locator('#dialogButtons [data-id="ok"]').click(); // 開いているフォルダに、名前を確かめて保存する
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

test("F-FILE-7: 図の配置のファイルが他のアプリで変わっていたら、黙って上書きせず、選ばせる", async ({ page }) => {
  // Arrange（配置ファイルを置いてから開き、要素を動かして配置を変える）
  await openApp(page);
  await putFiles(page, { "a.sysml": A, "a.layout.json": "{}\n" });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  // 最初のタブ（トレーサビリティ）には部品定義が出ないので、「すべて」の図を開いてから動かす
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="all"]').click();
  await page.locator('#gNodes [data-key="Alpha"]').waitFor();
  const b = (await page.locator('#gNodes [data-key="Alpha"]').boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 220, b.y + 90, { steps: 6 });
  await page.mouse.up();
  await putFiles(page, { "a.layout.json": '{ "theirs": true }\n' });
  // Act
  await page.keyboard.press("Control+s");
  await expect(page.locator("#dialogTitle")).toHaveText("ファイルが他で変更されています");
  await expect(page.locator("#dialogText")).toContainText("図の配置（要素の位置）");
  const untouched = await readFile(page, "a.layout.json");
  await page.locator('#dialogButtons [data-id="overwrite"]').click();
  // Assert（選ぶまでは上書きせず、上書きを選べば自分の配置になる。テキストのファイルは触らない）
  expect(untouched).toBe('{ "theirs": true }\n');
  await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"Alpha"/);
  expect(await readFile(page, "a.sysml")).toBe(A);
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
  // Arrange（許可が残っていなければ、フォルダは自動では開き直さない）
  await openProject(page);
  await needPermission(page);
  await page.reload();
  // Act
  await page.locator("#explorer [data-recent]").first().click();
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

/** 開いている唯一のファイル（サンプル）を保存せずに閉じ、開いているファイルが無いことの案内が出るまで待つ。 */
async function closeSample(page: Page): Promise<void> {
  await page.locator("#explorer [data-close]").click();
  await page.locator('#dialogButtons [data-id="discard"]').click();
  await expect(page.locator("#noDoc")).toBeVisible();
}

test("F-FILE-14: 最後のファイルを閉じても新しいファイルを作らず、開いているファイルが無いことを示す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#explorer [data-close]").click();
  await page.locator('#dialogButtons [data-id="discard"]').click();
  // Assert
  await expect(page.locator("#noDoc")).toBeVisible();
  await expect(page.locator("#noDoc")).toContainText("開いているファイルはありません");
  await expect(page.locator("#explorer [data-doc]")).toHaveCount(0);
  await expect(page.locator("#explorer")).toContainText("開いているファイルはありません");
  await expect(page.locator("#docName")).toHaveText("");
  await expect(page.locator("#gNodes .node")).toHaveCount(0);
});

test("F-FILE-14: 何も開いていないとき、「新しいファイル」で無題のファイルを作れる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await closeSample(page);
  // Act
  await page.locator('#noDoc [data-nodoc="new"]').click();
  // Assert
  await expect(page.locator("#noDoc")).toBeHidden();
  await expect(page.locator("#docName")).toHaveText("untitled-1.sysml");
  expect(await editorText(page)).toBe("");
});

test("F-FILE-14: 何も開いていないとき、「ファイルを開く」でファイルを開ける", async ({ page }) => {
  // Arrange
  await openApp(page);
  await putFiles(page, { "a.sysml": A });
  await closeSample(page);
  await page.evaluate(() => {
    (window as unknown as { __e2e: { openFile?: string } }).__e2e.openFile = "a.sysml";
  });
  // Act
  await page.locator('#noDoc [data-nodoc="open"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  await expect(page.locator("#noDoc")).toBeHidden();
  expect(await editorText(page)).toBe(A);
});

test("F-FILE-14: 何も開いていないとき、「フォルダを開く」でフォルダを開ける", async ({ page }) => {
  // Arrange
  await openApp(page);
  await putFiles(page, { "a.sysml": A });
  await closeSample(page);
  // Act
  await page.locator('#noDoc [data-nodoc="openFolder"]').click();
  // Assert
  await expect(page.locator('#explorer [data-file][title="a.sysml"]')).toBeVisible();
});

test("F-FILE-14: 何も開いていないとき、「サンプルを開く」でサンプルを開ける", async ({ page }) => {
  // Arrange
  await openApp(page);
  await closeSample(page);
  // Act
  await page.locator('#noDoc [data-nodoc="sample"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("electric-kettle.sysml");
  await expect(page.locator("#gNodes .node").first()).toBeVisible();
  await expect(page.locator("#noDoc")).toBeHidden();
});

test("F-FILE-14: 何も開いていないとき、保存のメニューは押せず、Ctrl+S ではそのことを知らせる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await closeSample(page);
  // Act
  await page.keyboard.press("Control+s");
  // Assert
  await expect(page.locator("#toast")).toHaveText("開いているファイルがありません");
  await expect(page.locator("#btnSave")).toBeDisabled();
  await expect(page.locator("#btnSaveAs")).toBeDisabled();
});

test("F-FILE-14: すべて閉じてから再読み込みすると、何も開いていない画面から始まる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await closeSample(page);
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#noDoc")).toBeVisible();
  await expect(page.locator("#explorer [data-doc]")).toHaveCount(0);
});

test("F-FILE-14・F-FILE-11: 中身の無い無題のファイルは下書きに残さず、再読み込みするとサンプルを出す", async ({ page }) => {
  // Arrange
  await openApp(page);
  await closeSample(page);
  await page.locator('#noDoc [data-nodoc="new"]').click();
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#docName")).toHaveText("electric-kettle.sysml");
  await expect(page.locator("#explorer [data-doc]")).toHaveCount(1);
});

test("F-FILE-14・F-FILE-11: 以前の版が残した中身の無い下書きがあっても、起動したときにサンプルを出す", async ({ page }) => {
  // Arrange（以前の版は、最後のファイルを閉じると空の untitled-1.sysml を作り、下書きに残していた）
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("modelith-drafts-v1", JSON.stringify([{ name: "untitled-1.sysml", text: "" }])));
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#docName")).toHaveText("electric-kettle.sysml");
  await expect(page.locator("#explorer [data-doc]")).toHaveCount(1);
});

/** 開いている文書の名前（エクスプローラーの「開いているファイル」の順）。 */
const openDocs = (page: Page): Promise<string[]> => page.locator("#explorer [data-doc] .nm").allInnerTexts();

/** フォルダの a.sysml と models/b.sysml を開き、a.sysml を表示し、図のタブ「ブロック定義図」を開く。 */
async function work(page: Page): Promise<void> {
  await openProject(page);
  // ダブルクリックで開いたままにする（1 回クリックは仮に開き、次のファイルと置き換わる。F-FILE-17）
  await page.locator('#explorer [data-file][title="a.sysml"]').dblclick();
  await page.locator('#explorer [data-file][title="models/b.sysml"]').dblclick();
  await page.locator('#explorer [data-doc]:has-text("a.sysml")').click();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="structure"]').click();
}

test("F-FILE-13: 再読み込みすると、開いていたフォルダとファイル・表示していたファイル・図のタブから始まる", async ({ page }) => {
  // Arrange
  await work(page);
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  await expect.poll(() => editorText(page)).toBe(A);
  expect(await openDocs(page)).toEqual(["electric-kettle.sysml", "a.sysml", "b.sysml"]);
  await expect(page.locator('#explorer [data-file][title="models/b.sysml"]')).toBeVisible();
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText("ブロック定義図");
  await expect(page.locator("#noDoc")).toBeHidden();
});

test("F-FILE-13: フォルダの許可が要るときは、サンプルの代わりに「前回の続きを開く」を示し、1 回の操作で戻れる", async ({ page }) => {
  // Arrange
  await work(page);
  await needPermission(page);
  await page.reload();
  await expect(page.locator("#noDocTitle")).toHaveText("前回の続きから始められます");
  await expect(page.locator("#noDoc")).toContainText("フォルダ「project」");
  await expect(page.locator("#docName")).toHaveText("");
  // Act
  await page.locator('#noDoc [data-nodoc="resume"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("a.sysml");
  await expect(page.locator("#noDoc")).toBeHidden();
  expect(await openDocs(page)).toEqual(["electric-kettle.sysml", "a.sysml", "b.sysml"]);
  await expect(page.locator('#explorer [data-file][title="models/b.sysml"]')).toBeVisible();
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText("ブロック定義図");
});

test("F-FILE-13: フォルダの許可が得られなければ、そのことを知らせ、「前回の続きを開く」を示したままにする", async ({ page }) => {
  // Arrange
  await work(page);
  await needPermission(page, false);
  await page.reload();
  // Act
  await page.locator('#noDoc [data-nodoc="resume"]').click();
  // Assert
  await expect(page.locator("#toast")).toHaveText("フォルダを開く許可が得られませんでした");
  await expect(page.locator('#noDoc [data-nodoc="resume"]')).toBeVisible();
  await expect(page.locator("#docName")).toHaveText("");
});

test("F-FILE-13: 「前回の続きを開く」を待つ間に別の操作を選んでも、下書きは失われない", async ({ page }) => {
  // Arrange
  await work(page);
  await needPermission(page);
  await page.reload();
  // Act
  await page.locator('#noDoc [data-nodoc="new"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("untitled-1.sysml");
  expect(await openDocs(page)).toEqual(["electric-kettle.sysml", "untitled-1.sysml"]);
});

test("F-FILE-13: 前回開いていたファイルが消されていたら、残りから始め、そのことを知らせる", async ({ page }) => {
  // Arrange
  await work(page);
  await page.evaluate(async () => {
    const project = await (await navigator.storage.getDirectory()).getDirectoryHandle("project");
    await project.removeEntry("a.sysml");
  });
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#toast")).toHaveText("前回開いていた「a.sysml」が見つかりませんでした");
  expect(await openDocs(page)).toEqual(["electric-kettle.sysml", "b.sysml"]);
  await expect(page.locator("#docName")).toHaveText("electric-kettle.sysml");
});

test("F-FILE-13: 設定「起動時にサンプルを開く」を有効にすると、前回の続きではなくサンプルから始まる", async ({ page }) => {
  // Arrange
  await work(page);
  await page.locator("#fileMenu summary").click();
  await page.locator("#startSample").check();
  await page.locator("#fileMenu summary").click();
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#docName")).toHaveText("electric-kettle.sysml");
  expect(await openDocs(page)).toEqual(["electric-kettle.sysml"]);
  await expect(page.locator("#explorer [data-recent]").first()).toBeVisible();
  await page.locator("#fileMenu summary").click();
  await expect(page.locator("#startSample")).toBeChecked();
});

test.describe("狭い画面", () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test("F-FILE-13・Q-2: 幅 390px の画面でも、「前回の続きを開く」が画面に収まる", async ({ page }) => {
    // Arrange（狭い画面では、エクスプローラーはツリーのタブにある）
    await openApp(page);
    await putFiles(page, { "a.sysml": A });
    await page.locator("#tabTree").click();
    await page.locator('[data-cmd="openFolder"]').click();
    await page.locator('#explorer [data-file][title="a.sysml"]').click();
    await needPermission(page);
    // Act
    await page.reload();
    // Assert
    const button = page.locator('#noDoc [data-nodoc="resume"]');
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#noDocResume")).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // Act（1 回の操作で戻る）
    await button.click();
    // Assert
    await expect(page.locator("#docName")).toHaveText("a.sysml");
  });
});
