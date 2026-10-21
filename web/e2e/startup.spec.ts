// 起動中の表示（Q-5）。起動に必要な部品（wasm）の読み込みを止めておき、「読み込み中…」と、時間がかかったときの案内を確かめる。
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const LOADING = "読み込み中…";
const SLOW = "読み込みに時間がかかっています。通信が遅いか、ブラウザが古い可能性があります。ページを再読み込みしてください";

/**
 * wasm の読み込みを、release を呼ぶまで止める。
 *
 * @returns requested は wasm を読みに来たら（起動の処理が動き始めたら）解決する Promise、release は読み込みを続けさせる関数
 */
async function holdWasm(page: Page): Promise<{ requested: Promise<void>; release: () => void }> {
  let release!: () => void;
  let requestedNow!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (requestedNow = resolve));
  await page.route("**/*.wasm", async (route) => {
    requestedNow();
    await gate;
    await route.continue();
  });
  return { requested, release };
}

test("Q-5: 起動に必要な部品の読み込みが遅いと、最初の表示から「読み込み中…」を示し、読み込めたら取り除く（正常系）", async ({ page }) => {
  // Arrange
  const wasm = await holdWasm(page);
  await page.goto("./", { waitUntil: "commit" });
  await wasm.requested;
  await expect(page.getByRole("status")).toHaveText(LOADING);
  // Act
  wasm.release();
  // Assert（表示は隠すのではなく、DOM から取り除く）
  await page.locator("#gNodes .node").first().waitFor();
  await expect(page.locator("#loading")).toHaveCount(0);
});

test("Q-5: 15 秒たっても読み込めないと案内に切り替え、その後に読み込めたら案内を取り除いて図を描く（境界値: 15 秒）", async ({ page }) => {
  // Arrange
  await page.clock.install();
  const wasm = await holdWasm(page);
  await page.goto("./", { waitUntil: "commit" });
  await wasm.requested;
  await expect(page.locator("#loading")).toHaveText(LOADING);
  // Act
  await page.clock.fastForward(15_000);
  // Assert（案内に切り替えても待ち続け、読み込めたら使える）
  await expect(page.locator("#loading")).toHaveText(SLOW);
  wasm.release();
  await page.locator("#gNodes .node").first().waitFor();
  await expect(page.locator("#loading")).toHaveCount(0);
});

test("Q-5: 起動に必要な部品を読み込めないときは、「読み込み中…」を取り除いて理由と対処を示す（異常系）", async ({ page }) => {
  // Arrange
  await page.route("**/*.wasm", (route) => route.abort());
  // Act
  await page.goto("./");
  // Assert
  await expect(page.locator("#startupError")).toBeVisible();
  await expect(page.locator("#loading")).toHaveCount(0);
});
