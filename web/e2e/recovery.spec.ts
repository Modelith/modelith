// コアの Worker が落ちた・返事をしないときの出口（Q-7）。待ち続けず、テキストの保存は続けられ、Worker を作り直して図の操作を再開する。
import type { Page } from "@playwright/test";
import { expect, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";

const A = "package A {\n    part def Alpha;\n}\n";
const STOPPED = "図の操作をやめました。テキストはそのまま残っています";

/** project フォルダに a.sysml を置き、フォルダを開いて a.sysml を開く。 */
async function openProjectFile(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": A });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
}

/** これまでに作ったコアの Worker の数。 */
const workerCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __e2e: { workers: Worker[] } }).__e2e.workers.length);

/** 今のコアの Worker にエラーを起こす（ブラウザが Worker を落としたときと同じ知らせ）。 */
async function crashWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const workers = (window as unknown as { __e2e: { workers: Worker[] } }).__e2e.workers;
    workers[workers.length - 1]!.dispatchEvent(new ErrorEvent("error", { message: "テストで止めた", cancelable: true }));
  });
}

/** 今のコアの Worker が返事をしなくなる（画面からの依頼を捨てる）。 */
async function stallWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const workers = (window as unknown as { __e2e: { workers: Worker[] } }).__e2e.workers;
    workers[workers.length - 1]!.postMessage = () => {};
  });
}

/** Worker が作り直され、送り直したテキストの解析結果が画面に反映されるまで待つ。 */
async function restarted(page: Page, count: number): Promise<void> {
  await expect.poll(() => workerCount(page)).toBe(count);
  await expect(page.locator("#syncText")).toHaveText("同期済み");
}

/** すべての要素のビューを開き、Alpha の名前を Gamma に変える（図の操作がコアに届くか）。 */
async function renameAlpha(page: Page): Promise<void> {
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="all"]').click();
  await page.locator('#gNodes .node[data-key="Alpha"]').click();
  await page.locator('[data-act="rename"]').click();
  await page.locator("#renameIn").fill("Gamma");
  await page.keyboard.press("Enter");
}

test("Q-7・F-FILE-2: Worker がエラーを起こしても、図の操作をやめたと知らせ、Ctrl+S で保存でき、作り直した後は図の操作が効く", async ({ page }) => {
  // Arrange
  await openProjectFile(page);
  await typeAtEnd(page, "// edited\n");
  // Act
  await crashWorker(page);
  // Assert（知らせる → 保存できる → 作り直した後は図の操作が効く）
  await expect(page.locator("#toast")).toHaveText(STOPPED);
  await page.keyboard.press("Control+s");
  await expect.poll(() => readFile(page, "a.sysml")).toBe(A + "// edited\n");
  await restarted(page, 2);
  await renameAlpha(page);
  await expect(page.locator('#gNodes .node[data-key="Gamma"]')).toBeVisible();
});

test("Q-7・F-FILE-2: Worker が返事をしなくなっても、期限で図の操作をやめたと知らせ、Ctrl+S で保存できる", async ({ page }) => {
  // Arrange
  await openProjectFile(page);
  await stallWorker(page);
  // Act（解析の返事が来ないまま期限（10 秒）が過ぎる）
  await typeAtEnd(page, "// edited\n");
  // Assert
  await expect(page.locator("#toast")).toHaveText(STOPPED, { timeout: 15_000 });
  await page.keyboard.press("Control+s");
  await expect.poll(() => readFile(page, "a.sysml")).toBe(A + "// edited\n");
  await restarted(page, 2);
});

test("Q-7・F-FILE-2: 短い間に止まり続けたらあきらめ、再読み込みを案内する。テキストの保存はできる（境界値: 4 回目）", async ({ page }) => {
  // Arrange（3 回までは作り直す）
  await openProjectFile(page);
  for (let i = 0; i < 3; i++) {
    await crashWorker(page);
    await restarted(page, i + 2);
  }
  // Act
  await crashWorker(page);
  // Assert
  await expect(page.locator("#syncText")).toHaveText("図を更新できません。ページを再読み込みしてください");
  await expect.poll(() => workerCount(page)).toBe(4);
  await typeAtEnd(page, "// edited\n");
  await page.keyboard.press("Control+s");
  await expect.poll(() => readFile(page, "a.sysml")).toBe(A + "// edited\n");
});
