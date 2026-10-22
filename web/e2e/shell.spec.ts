// アプリ全体の約束（C-2・C-3・C-8・C-9・Q-2・F-EXP-*）
import { readFileSync } from "node:fs";
import { stageLabel } from "../src/app/stage";
import type { Download, Page } from "@playwright/test";
import { expect, openApp, test } from "./fixtures";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

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

test("C-9: Content-Security-Policy が、配信元以外への通信とインラインのスクリプトをブラウザの仕組みで止める", async ({ page }) => {
  // Arrange
  await openApp(page);
  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveAttribute("content", /default-src 'self'/);
  // Act：外部への fetch と、動的に足したインラインのスクリプトを試みる（CSP の違反イベントで止まったことを確かめる）
  const blocked = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener("securitypolicyviolation", (ev) => seen.push(`${ev.violatedDirective}:${ev.blockedURI}`));
    await fetch("https://example.com/").catch(() => undefined);
    const s = document.createElement("script");
    s.textContent = "window.__cspInline = true;";
    document.head.append(s);
    await new Promise((r) => setTimeout(r, 100));
    return { seen, inlineRan: "__cspInline" in window };
  });
  // Assert
  expect(blocked.inlineRan).toBe(false);
  expect(blocked.seen).toContain("connect-src:https://example.com/");
  expect(blocked.seen.some((v) => /^script-src(-elem)?:inline$/.test(v))).toBe(true);
});

test("C-3: ヘルプのソースへのリンクは、動いている版のコミットを指す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#helpMenu summary").click();
  // Assert
  await expect(page.locator("#sourceLink")).toHaveAttribute("href", /^https:\/\/github\.com\/modelith\/modelith\/tree\/[0-9a-f]{40}$/);
  await expect(page.locator("#appVersion")).toHaveText(/^\d+\.\d+\.\d+\S* \([0-9a-f]{7}\)$/);
});

test("C-8: 見出しと「ヘルプ」に、版の名前から決めた開発段階を示す", async ({ page }) => {
  // Arrange
  const stage = stageLabel(pkg.version);
  await openApp(page);
  // Act
  await page.locator("#helpMenu summary").click();
  // Assert
  if (stage) {
    await expect(page.locator("#stageBadge")).toHaveText(stage.badge);
    await expect(page.locator("#stageNote")).toHaveText(`（${stage.note}）`);
  } else {
    await expect(page.locator("#stageBadge")).toBeHidden();
    await expect(page.locator("#stageNote")).toHaveText("");
  }
});

test("C-5: ヘルプに著作権・無保証・再配布の条件を示してライセンスへつなぎ、本体と同梱物のライセンス文を配信する", async ({ page, request }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#helpMenu summary").click();
  const license = await (await request.get("LICENSE.txt")).text();
  const notices = await (await request.get("licenses.txt")).text();
  // Assert
  await expect(page.locator("#appCopyright")).toHaveText("Copyright (C) 2026 The Modelith Authors");
  await expect(page.locator("#legal")).toContainText("無保証");
  await expect(page.locator("#licenseLink")).toHaveAttribute("href", /^https:\/\/github\.com\/modelith\/modelith(\/blob\/[0-9a-f]{40}\/README\.md)?#license$/);
  await expect(page.locator("#legal")).toContainText("上のライセンスの条件で再配布・改変できます");
  await expect(page.locator("#noticesLink")).toHaveAttribute("href", "licenses.txt");
  expect(license).toMatch(/^Copyright \(C\) 2026 The Modelith Authors\n/);
  expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
  expect(license).toContain("Modelith Plugin Exception");
  for (const part of ["@fontsource/ibm-plex-sans-jp（OFL-1.1）", "@fontsource/ibm-plex-mono（OFL-1.1）", "vite（MIT）"]) expect(notices).toContain(`==== ${part} ====`);
  expect(notices).toContain("SIL OPEN FONT LICENSE");
  expect(notices).not.toContain("Licenses of bundled dependencies");
});

test("C-7: ヘルプに、SysML・KerML・OMG の商標の帰属と、OMG と関係がないことを示す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#helpMenu summary").click();
  // Assert
  const tm = page.locator("#trademarks");
  await expect(tm).toBeVisible();
  await expect(tm).toContainText("SysML®・OMG® は Object Management Group, Inc. の登録商標、KerML™ は同社の商標です");
  await expect(tm).toContainText("Modelith は OMG と関係がなく、その認定・推奨も受けていません");
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

/** ダウンロードしたファイルの中身を文字列で読む。 */
async function downloaded(d: Download): Promise<string> {
  return Buffer.concat(await (await d.createReadStream()).toArray()).toString();
}

/** ファイルのメニューの「エクスポート…」で、エクスポートのダイアログを開く。 */
async function openExport(page: Page): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnExport").click();
  await expect(page.getByRole("dialog", { name: "エクスポート" })).toBeVisible();
}

test("F-EXP-1: ファイルのメニューの「エクスポート…」で、名前を付けて表示中の図を SVG のファイルとしてダウンロードできる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await openExport(page);
  await expect(page.locator("#exportName")).toHaveValue("トレーサビリティ.svg"); // 既定は表示中の図の名前
  await page.locator("#exportName").fill("給水システムの要求");
  const download = page.waitForEvent("download");
  // Act
  await page.getByRole("button", { name: "エクスポート", exact: true }).click();
  // Assert
  const d = await download;
  const svg = await downloaded(d);
  expect(d.suggestedFilename()).toBe("給水システムの要求.svg");
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain("BoilTimeReq");
  expect(svg).not.toContain("var(--"); // 単独で表示できるよう CSS 変数を使わない
  await expect(page.locator("#exportDialog")).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("「給水システムの要求.svg」をダウンロードしました");
});

test("F-EXP-2: 形式に draw.io を選ぶと、拡張子が .drawio に替わり、draw.io で開けるファイルとしてダウンロードできる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await openExport(page);
  await page.locator("#exportFormat").selectOption({ label: "draw.io（.drawio）" });
  await expect(page.locator("#exportName")).toHaveValue("トレーサビリティ.drawio");
  const download = page.waitForEvent("download");
  // Act
  await page.locator("#exportName").press("Enter");
  // Assert
  const d = await download;
  const xml = await downloaded(d);
  expect(d.suggestedFilename()).toBe("トレーサビリティ.drawio");
  expect(xml).toMatch(/^<mxfile host="app\.diagrams\.net"><diagram id="v" name="トレーサビリティ"><mxGraphModel /);
  expect(xml).toContain("BoilTimeReq");
  await expect(page.locator("#exportDialog")).toBeHidden();
});

test("F-EXP-1・F-EXP-2: 「やめる」で閉じると、何もダウンロードしない", async ({ page }) => {
  // Arrange
  await openApp(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await openExport(page);
  // Act
  await page.getByRole("button", { name: "やめる" }).click();
  // Assert
  await expect(page.locator("#exportDialog")).toBeHidden();
  expect(downloads).toBe(0);
});
