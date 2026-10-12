// アプリ全体の約束（C-2・C-3・Q-2・F-EXP-*）
import { expect, openApp, test } from "./fixtures";

test("C-2・C-4: 起動から操作まで、配信元の静的ファイルを読むだけで、外部やサーバの API に通信しない", async ({ page, baseURL }) => {
  // Arrange
  const hosts = new Set<string>();
  const methods = new Set<string>();
  page.on("request", (r) => {
    hosts.add(new URL(r.url()).host);
    methods.add(r.method());
  });
  // Act
  await openApp(page);
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="all"]').click();
  await page.evaluate(() => document.fonts.ready);
  // Assert
  expect([...hosts]).toEqual([new URL(baseURL ?? "").host]);
  expect([...methods]).toEqual(["GET"]);
});

test("C-3: 「?」メニューのソースへのリンクは、動いている版のコミットを指す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#helpMenu summary").click();
  // Assert
  await expect(page.locator("#sourceLink")).toHaveAttribute("href", /^https:\/\/github\.com\/modelith\/modelith\/tree\/[0-9a-f]{40}$/);
  await expect(page.locator("#appVersion")).toHaveText(/^\d+\.\d+\.\d+\S* \([0-9a-f]{7}\)$/);
});

test("C-5: 「?」メニューに著作権・無保証・ライセンスを示し、本体と同梱物のライセンス文を配信する", async ({ page, request }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#helpMenu summary").click();
  const license = await (await request.get("LICENSE.txt")).text();
  const notices = await (await request.get("licenses.txt")).text();
  // Assert
  await expect(page.locator("#appCopyright")).toHaveText("Copyright (C) 2026 The Modelith Authors");
  await expect(page.locator("#legal")).toContainText("無保証");
  await expect(page.locator("#licenseLink")).toHaveAttribute("href", "LICENSE.txt");
  await expect(page.locator("#noticesLink")).toHaveAttribute("href", "licenses.txt");
  expect(license).toMatch(/^Copyright \(C\) 2026 The Modelith Authors\n/);
  expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
  expect(license).toContain("Modelith Plugin Exception");
  for (const part of ["@fontsource/ibm-plex-sans-jp（OFL-1.1）", "@fontsource/ibm-plex-mono（OFL-1.1）", "vite（MIT）"]) expect(notices).toContain(`==== ${part} ====`);
  expect(notices).toContain("SIL OPEN FONT LICENSE");
  expect(notices).not.toContain("Licenses of bundled dependencies");
});

test.describe("狭い画面", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("Q-2: 幅 390px でも横にはみ出さず、ツリー・図・テキストを切り替えられる", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    const overflow = await page.evaluate(() => document.querySelector("header")!.scrollWidth - document.querySelector("header")!.clientWidth);
    await page.locator("#tabText").click();
    const textShown = await page.locator(".textpane").isVisible();
    await page.locator("#tabTree").click();
    // Assert
    expect(overflow).toBeLessThanOrEqual(0);
    expect(textShown).toBe(true);
    await expect(page.locator(".treepane")).toBeVisible();
    await expect(page.locator(".diagrampane")).toBeHidden();
  });
});

test("F-EXP-1: 表示中のビューを SVG ファイルとして保存できる", async ({ page }) => {
  // Arrange
  await openApp(page);
  const download = page.waitForEvent("download");
  // Act
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnSaveSvg").click();
  // Assert
  const d = await download;
  const svg = Buffer.concat(await (await d.createReadStream()).toArray()).toString();
  expect(d.suggestedFilename()).toBe("modelith-trace.svg");
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain("BoilTimeReq");
  expect(svg).not.toContain("var(--"); // 単独で表示できるよう CSS 変数を使わない
});

test("F-EXP-2: 表示中のビューを draw.io の形式で書き出せる", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnDrawio").click();
  // Assert
  const xml = await page.locator("#modalText").inputValue();
  expect(xml).toMatch(/^<mxfile host="app\.diagrams\.net">/);
  expect(xml).toContain("BoilTimeReq");
});
