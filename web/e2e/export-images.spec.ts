// 画像のエクスポートと画像のコピー（F-EXP-3〜F-EXP-5）。PNG・JPEG・倍率・範囲・背景・クリップボード。
import { expect, openApp, test } from "./fixtures";
import type { Download, Page } from "@playwright/test";

/** ファイルのメニューの「エクスポート…」で、エクスポートのダイアログを開く。 */
async function openExport(page: Page): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnExport").click();
  await expect(page.getByRole("dialog", { name: "エクスポート" })).toBeVisible();
}

/** 「エクスポート」を押し、ダウンロードしたファイルの名前と中身を返す。 */
async function exportNow(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  const d: Download = await download;
  return { name: d.suggestedFilename(), bytes: Buffer.concat(await (await d.createReadStream()).toArray()) };
}

/** PNG の幅（IHDR の幅。先頭から 16 バイト目からの 4 バイト）。 */
const pngWidth = (png: Buffer): number => png.readUInt32BE(16);

test("F-EXP-3: PNG 画像を選んだ倍率でダウンロードでき、2 倍の画像は 1 倍の幅の 2 倍", async ({ page }) => {
  // Arrange
  await openApp(page);
  await openExport(page);
  await page.locator("#exportFormat").selectOption({ label: "PNG 画像（.png）" });
  await expect(page.locator("#exportName")).toHaveValue("トレーサビリティ.png");
  await page.locator("#exportScale").selectOption({ label: "1 倍" });
  const one = await exportNow(page);
  await openExport(page);
  // Act
  await page.locator("#exportScale").selectOption({ label: "2 倍" });
  const two = await exportNow(page);
  // Assert
  expect(two.name).toBe("トレーサビリティ.png");
  expect(two.bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(Math.abs(pngWidth(two.bytes) - 2 * pngWidth(one.bytes))).toBeLessThanOrEqual(1);
  await expect(page.locator("#toast")).toHaveText("「トレーサビリティ.png」をダウンロードしました");
});

test("F-EXP-3・F-EXP-4: JPEG 画像では背景を選べず（白だけ）、.jpg のファイルになる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await openExport(page);
  // Act
  await page.locator("#exportFormat").selectOption({ label: "JPEG 画像（.jpg）" });
  // Assert
  await expect(page.locator("#exportBgField")).toBeHidden();
  await expect(page.locator("#exportScaleField")).toBeVisible();
  const jpg = await exportNow(page);
  expect(jpg.name).toBe("トレーサビリティ.jpg");
  expect(jpg.bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});

test("F-EXP-4: draw.io では範囲・倍率・背景と「画像をコピー」を出さない", async ({ page }) => {
  // Arrange
  await openApp(page);
  await openExport(page);
  // Act
  await page.locator("#exportFormat").selectOption({ label: "draw.io（.drawio）" });
  // Assert
  for (const id of ["#exportRangeField", "#exportScaleField", "#exportBgField", "#exportCopy"]) await expect(page.locator(id)).toBeHidden();
});

test("F-EXP-4: 範囲を「選んだ要素」にすると、選んだ要素だけを描き、背景を「透明」にすると白い背景を描かない", async ({ page }) => {
  // Arrange（図の 1 つ目の要素を選ぶ）
  await openApp(page);
  const nodes = page.locator("#gNodes .node");
  const picked = (await nodes.nth(0).getAttribute("data-key")) ?? "";
  const other = (await nodes.nth(1).getAttribute("data-key")) ?? "";
  await nodes.nth(0).locator(".body").click();
  await openExport(page);
  // Act
  await page.locator("#exportRange").selectOption({ label: "選んだ要素" });
  await page.locator("#exportBg").selectOption({ label: "透明" });
  const svg = (await exportNow(page)).bytes.toString();
  // Assert
  expect(svg).toContain(`data-key="${picked}"`);
  expect(svg).not.toContain(`data-key="${other}"`);
  expect(svg).not.toContain('fill="#FFFFFF"/>');
});

test("F-EXP-4: 要素を選んでいなければ、範囲の「選んだ要素」は選べない", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await openExport(page);
  // Assert
  await expect(page.locator('#exportRange option[value="selection"]')).toHaveAttribute("disabled", "");
  await expect(page.locator("#exportRange")).toHaveValue("all");
});

test.describe("クリップボード", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("F-EXP-5: 「画像をコピー」で、図を PNG 画像としてクリップボードに入れる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await openExport(page);
    // Act
    await page.getByRole("button", { name: "画像をコピー" }).click();
    // Assert
    await expect(page.locator("#toast")).toHaveText("図を画像としてコピーしました。ほかのアプリに貼り付けられます");
    await expect(page.locator("#exportDialog")).toBeHidden();
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
    expect(types).toContain("image/png");
  });
});
