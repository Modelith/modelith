// 画面の上の左のメニューバー（Q-9）。並び・キーボード・マウスでの切り替え・各メニューの操作と、狭い画面の ☰ を、Chromium で操作する。
import type { Page } from "@playwright/test";
import { editorText, expect, nodeKeys, openApp, test } from "./fixtures";

/** メニューバーのメニュー（左から順）。 */
const MENUS = ["#fileMenu", "#editMenu", "#viewMenu", "#diagramMenu", "#pluginMenu", "#helpMenu"];

/** セレクタの要素の、画面の上での左端と上端（px）。 */
async function boxOf(page: Page, sel: string): Promise<{ x: number; y: number; right: number }> {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`見えていません: ${sel}`);
  return { x: b.x, y: b.y, right: b.x + b.width };
}

/** 開いているメニュー（details.menu[open]）の id。 */
const openMenus = (page: Page): Promise<string[]> => page.locator("details.menu[open]").evaluateAll((ds) => ds.map((d) => `#${d.id}`));

test("Q-9: 左にロゴ・メニュー（ファイル・編集・表示・図・プラグイン・ヘルプ）・元に戻す・やり直すが並び、同期の状態と開発段階の札は右にある", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  const logo = await boxOf(page, "header h1");
  const menus = await Promise.all(MENUS.map((m) => boxOf(page, `${m} > summary`)));
  const undo = await boxOf(page, "#btnUndo");
  const redo = await boxOf(page, "#btnRedo");
  const sync = await boxOf(page, "#sync");
  const width = page.viewportSize()?.width ?? 0;
  // Assert
  await expect(page.locator("#menubar > details > summary")).toHaveText(["ファイル", "編集", "表示", "図", "プラグイン", "ヘルプ"]);
  const xs = [logo.right, ...menus.map((m) => m.x), undo.x, redo.x];
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  expect(redo.right).toBeLessThan(sync.x);
  expect(sync.x).toBeGreaterThan(width * 0.75);
  await expect(page.locator("#menuToggle")).toBeHidden();
});

test("Q-9: メニューを 1 つ開くと、ほかのメニューは閉じる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#fileMenu > summary").click();
  // Act
  await page.locator("#editMenu > summary").click();
  // Assert
  expect(await openMenus(page)).toEqual(["#editMenu"]);
});

test("Q-9: メニューを開いている間にマウスを隣の見出しに乗せると、そのメニューに切り替わる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#fileMenu > summary").click();
  // Act
  await page.locator("#viewMenu > summary").hover();
  // Assert
  expect(await openMenus(page)).toEqual(["#viewMenu"]);
  await expect(page.locator("#menuZoomIn")).toBeVisible();
});

test("Q-9: メニューを開いていなければ、マウスを見出しに乗せても開かない", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#viewMenu > summary").hover();
  // Assert
  expect(await openMenus(page)).toEqual([]);
});

test.describe("キーボード", () => {
  test("Q-9: 開いている間は左右の矢印キーで隣のメニューへ移って開き、両端では反対の端へ回る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#fileMenu > summary").focus();
    await page.keyboard.press("Enter");
    // Act
    const seen: string[][] = [];
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowRight"]) {
      await page.keyboard.press(key);
      seen.push(await openMenus(page));
    }
    // Assert
    expect(seen).toEqual([["#helpMenu"], ["#fileMenu"], ["#editMenu"]]);
    await expect(page.locator("#editMenu > summary")).toBeFocused();
  });

  test("Q-9: 開いている間は上下の矢印キーで項目を移り、押せない項目を飛ばし、端では反対の端へ回る", async ({ page }) => {
    // Arrange（起動直後は戻れる版が無く、元に戻す・やり直すは押せない）
    await openApp(page);
    await expect(page.locator("#menuUndo")).toBeDisabled();
    await page.locator("#editMenu > summary").focus();
    await page.keyboard.press("Enter");
    // Act
    await page.keyboard.press("ArrowDown");
    const first = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press("ArrowDown");
    const wrapped = await page.evaluate(() => document.activeElement?.id);
    // Assert
    expect(first).toBe("menuSelectAll");
    expect(wrapped).toBe("menuSelectAll");
  });

  test("Q-9: ファイルのメニューで下の矢印キーを押すと、項目を上から順に移る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#fileMenu > summary").focus();
    await page.keyboard.press("Enter");
    // Act
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowDown");
      seen.push(await page.evaluate(() => document.activeElement?.id));
    }
    await page.keyboard.press("ArrowUp");
    seen.push(await page.evaluate(() => document.activeElement?.id));
    // Assert
    expect(seen).toEqual(["btnNew", "btnOpen", "btnOpenFolder", "btnOpen"]);
  });

  test("Q-9: 表示のメニューで上の矢印キーを押すと、「知らせの重さ…」、線の形の「曲線」「直角」へ下から順に移り、区切りと小見出しは飛ばす", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#viewMenu > summary").focus();
    await page.keyboard.press("Enter");
    // Act
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("ArrowUp");
      seen.push(await page.evaluate(() => document.activeElement?.id));
    }
    // Assert
    expect(seen).toEqual(["menuLevels", "menuEdgeCurve", "menuEdgeOrtho", "menuMini"]);
  });

  test("Q-8・Q-9: 矢印キーで移ったメニューも、Esc で閉じて見出しへ入力が戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#fileMenu > summary").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    // Act
    await page.keyboard.press("Escape");
    // Assert
    expect(await openMenus(page)).toEqual([]);
    await expect(page.locator("#editMenu > summary")).toBeFocused();
  });
});

test("Q-9・F-EDIT-4: 編集のメニューから、元に戻す・やり直すができる", async ({ page }) => {
  // Arrange
  await openApp(page);
  const original = await editorText(page);
  await page.locator("#ed").fill("package Edited;\n");
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ
  // Act
  await page.locator("#editMenu > summary").click();
  await page.locator("#menuUndo").click();
  const undone = await editorText(page);
  await page.locator("#editMenu > summary").click();
  await page.locator("#menuRedo").click();
  // Assert
  expect(undone).toBe(original);
  expect(await editorText(page)).toBe("package Edited;\n");
  expect(await openMenus(page)).toEqual([]);
});

test("Q-9・F-VIEW-4: 編集のメニューの「すべて選択」で、図の要素をすべて選ぶ", async ({ page }) => {
  // Arrange
  await openApp(page);
  const all = (await nodeKeys(page)).length;
  // Act
  await page.locator("#editMenu > summary").click();
  await page.locator("#menuSelectAll").click();
  // Assert
  await expect(page.locator("#insp")).toContainText(`${all} 個を選択中`);
});

test("Q-9: 表示のメニューで、ツリーのパネルを隠し、もう一度押すと出す", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#viewMenu > summary").click();
  // Act
  await page.locator("#togTree").click();
  // Assert
  await expect(page.locator(".treepane")).toBeHidden();
  await page.locator("#viewMenu > summary").click();
  await expect(page.locator("#togTree")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#togTree").click();
  await expect(page.locator(".treepane")).toBeVisible();
});

test("Q-9・F-VIEW-4: 表示のメニューで、全体図を隠し、拡大・全体を表示ができる", async ({ page }) => {
  // Arrange
  await openApp(page);
  const transform = () => page.locator("#vp").getAttribute("transform");
  const before = await transform();
  // Act
  await page.locator("#viewMenu > summary").click();
  await page.locator("#menuZoomIn").click();
  const zoomed = await transform();
  await page.locator("#viewMenu > summary").click();
  await page.locator("#menuMini").click();
  // Assert
  expect(zoomed).not.toBe(before);
  await expect(page.locator("#mini")).toBeHidden();
  await expect(page.locator("#zMini")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#menuMini")).toHaveAttribute("aria-pressed", "false");
});

test("Q-9: 表示のメニューの「線の形」で「曲線」を選ぶと、図のツールバーのボタンが「線：曲線」になり、✓ が「曲線」に移る", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#viewMenu > summary").click();
  await expect(page.locator("#viewMenu .phead")).toHaveText("線の形");
  // Act
  await page.locator("#menuEdgeCurve").click();
  // Assert
  await expect(page.locator("#btnEdge")).toHaveText("線：曲線");
  await expect(page.locator("#menuEdgeCurve")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#menuEdgeOrtho")).toHaveAttribute("aria-pressed", "false");
});

test("Q-9: 表示のメニューで、選んでいる「直角」をもう一度選んでも、直角のまま", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#viewMenu > summary").click();
  // Act
  await page.locator("#menuEdgeOrtho").click();
  // Assert
  await expect(page.locator("#btnEdge")).toHaveText("線：直角");
  await expect(page.locator("#menuEdgeOrtho")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#menuEdgeCurve")).toHaveAttribute("aria-pressed", "false");
});

test("Q-9: 図のツールバーで線の描き方を切り替えると、表示のメニューの「線の形」の ✓ も移る", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#btnEdge").click();
  // Assert
  await expect(page.locator("#menuEdgeCurve")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#menuEdgeOrtho")).toHaveAttribute("aria-pressed", "false");
});

test("Q-9: 選んだ線の形は、読み込み直しても残る", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#viewMenu > summary").click();
  await page.locator("#menuEdgeCurve").click();
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#btnEdge")).toHaveText("線：曲線");
  await expect(page.locator("#menuEdgeCurve")).toHaveAttribute("aria-pressed", "true");
});

test("Q-9: 図のメニューに「線を曲線で描く」は無い", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#diagramMenu > summary").click();
  // Assert
  await expect(page.locator("#diagramMenu .pop button")).toHaveText(["新しい図を作成…", "整列"]);
});

test("Q-9・F-FILE-14: 開いているファイルが無いときは、図と表示のメニューの項目を押せない", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#explorer [data-close]").click();
  await page.locator('#dialogButtons [data-id="discard"]').click();
  await expect(page.locator("#noDoc")).toBeVisible();
  // Act
  await page.locator("#diagramMenu > summary").click();
  // Assert
  for (const id of ["#menuSaveView", "#menuEdgeOrtho", "#menuEdgeCurve", "#menuLayout", "#menuZoomIn", "#menuFit", "#menuSelectAll"]) await expect(page.locator(id)).toBeDisabled();
});

test("F-FILE-14・F-EXP-1・F-EXP-2: 開いているファイルが無いときは、ファイルのメニューの「エクスポート…」を押せない", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator("#explorer [data-close]").click();
  await page.locator('#dialogButtons [data-id="discard"]').click();
  await expect(page.locator("#noDoc")).toBeVisible();
  // Act
  await page.locator("#fileMenu > summary").click();
  // Assert
  await expect(page.locator("#btnExport")).toBeDisabled();
  await expect(page.locator("#btnSave")).toBeDisabled();
});

for (const width of [761, 800, 1000, 1001]) {
  test(`Q-9: 幅 ${width}px でも、見出しが横にはみ出さず、開いたヘルプが画面の中に収まる`, async ({ page }) => {
    // Arrange（境界：狭い画面の 760px の 1 つ上、ヘルプを右にそろえる 1000px とその 1 つ上）
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    // Act
    await page.locator("#helpMenu > summary").click();
    const pop = await page.locator("#helpMenu .pop").boundingBox();
    const overflow = await page.evaluate(() => document.querySelector("header")!.scrollWidth - document.querySelector("header")!.clientWidth);
    // Assert
    expect(overflow).toBeLessThanOrEqual(0);
    expect(pop?.x).toBeGreaterThanOrEqual(0);
    expect((pop?.x ?? 0) + (pop?.width ?? Infinity)).toBeLessThanOrEqual(width);
  });
}

test.describe("狭い画面", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("Q-9・Q-2: メニューは ☰ の 1 つにまとまり、押すと縦に並んだメニューが開き、横にはみ出さない", async ({ page }) => {
    // Arrange
    await openApp(page);
    await expect(page.locator("#menubar")).toBeHidden();
    // Act
    await page.locator("#menuToggle").click();
    await page.locator("#fileMenu > summary").click();
    // Assert
    await expect(page.locator("#menuToggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#btnNew")).toBeVisible();
    const file = await boxOf(page, "#fileMenu > summary");
    const help = await boxOf(page, "#helpMenu > summary");
    expect(help.x).toBe(file.x);
    expect(help.y).toBeGreaterThan(file.y);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(help.right).toBeLessThanOrEqual(390);
  });

  test("Q-9・Q-8: ☰ のメニューから開いたダイアログを閉じると、☰ へ入力が戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#menuToggle").click();
    await page.locator("#pluginMenu > summary").click();
    await page.locator("#btnPlugins").click();
    await expect(page.locator("#plugins")).toBeVisible();
    await expect(page.locator("#menubar")).toBeHidden();
    // Act
    await page.keyboard.press("Escape");
    // Assert
    await expect(page.locator("#plugins")).toBeHidden();
    await expect(page.locator("#menuToggle")).toBeFocused();
  });

  test("Q-9・Q-8: Esc で開いているメニューを閉じ、もう一度 Esc で ☰ のパネルを閉じて ☰ へ入力が戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#menuToggle").click();
    await page.locator("#fileMenu > summary").click();
    // Act
    await page.keyboard.press("Escape");
    const afterFirst = await page.locator("#menubar").isVisible();
    await page.keyboard.press("Escape");
    // Assert
    expect(afterFirst).toBe(true);
    await expect(page.locator("#menubar")).toBeHidden();
    await expect(page.locator("#menuToggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#menuToggle")).toBeFocused();
  });

  test("Q-9・Q-2: 狭い画面でも、表示のメニューで線の形を選べる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#menuToggle").click();
    await page.locator("#viewMenu > summary").click();
    // Act
    await page.locator("#menuEdgeCurve").click();
    // Assert
    await expect(page.locator("#btnEdge")).toHaveText("線：曲線");
    await page.locator("#menuToggle").click();
    await page.locator("#viewMenu > summary").click();
    await expect(page.locator("#menuEdgeCurve")).toHaveAttribute("aria-pressed", "true");
  });

  test("Q-9: 表示のメニューに、狭い画面では使わないパネルの切り替えを出さない", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#menuToggle").click();
    // Act
    await page.locator("#viewMenu > summary").click();
    // Assert
    await expect(page.locator("#menuZoomIn")).toBeVisible();
    await expect(page.locator("#togTree")).toBeHidden();
  });
});
