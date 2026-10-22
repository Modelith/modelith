// 線の形の調整（F-VIEW-16）。
import { expect, openApp, test } from "./fixtures";
import type { Page } from "@playwright/test";

const TEXT = `package G {
    part def Vehicle;
    part def Car :> Vehicle;
    view gv : GeneralView { expose G::*; }
}
`;
const EDGE = '[data-edge="specialize|Car|Vehicle|#1"]';

/** 特殊化の線が 1 本ある図を開き、その線を選ぶ。 */
async function selectEdge(page: Page): Promise<void> {
  await openApp(page);
  await page.locator("#ed").fill(TEXT);
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open-mv="gv"]').click();
  await page.locator(`${EDGE} path.hit`).click({ force: true });
}

/**
 * つまみを、図の上で dx・dy だけドラッグする。
 *
 * @param page ページ
 * @param sel つまみのセレクタ
 * @param dx 横に動かす量（画面の px）
 * @param dy 縦に動かす量（画面の px）
 */
async function dragBy(page: Page, sel: string, dx: number, dy: number): Promise<void> {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} がありません`);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("F-VIEW-16: 線を選ぶとつまみを出し、区間の中ほどを動かすと曲がり角を足し、元に戻せる", async ({ page }) => {
  // Arrange
  await selectEdge(page);
  const before = await page.locator(`${EDGE} path.line`).getAttribute("d");
  await expect(page.locator('.eh.end[data-end="f"]')).toHaveCount(1);
  // Act
  await dragBy(page, '.eh.mid[data-mid="0"]', 160, 0);
  // Assert（曲がり角のつまみができ、線の形が変わる。テキストは変えない）
  await expect(page.locator(".eh.bend")).toHaveCount(1);
  await expect(page.locator(`${EDGE} path.line`)).not.toHaveAttribute("d", before ?? "");
  await expect(page.locator("#ed")).toHaveValue(TEXT);
  // 元に戻す
  await page.locator('#insp [data-act="resetShape"]').click();
  await expect(page.locator(".eh.bend")).toHaveCount(0);
  await expect(page.locator(`${EDGE} path.line`)).toHaveAttribute("d", before ?? "");
});

test("F-VIEW-16: 曲がり角をダブルクリックすると消え、要素を動かしても曲がり角は動かない", async ({ page }) => {
  // Arrange
  await selectEdge(page);
  await dragBy(page, '.eh.mid[data-mid="0"]', 160, 0);
  const bend = await page.locator(".eh.bend").boundingBox();
  // Act（要素を動かす。動かしても線は選んだまま）
  await dragBy(page, '#gNodes .node[data-key="Vehicle"]', 0, 80);
  // Assert（曲がり角は同じ位置）
  const after = await page.locator(".eh.bend").boundingBox();
  expect([after?.x, after?.y]).toEqual([bend?.x, bend?.y]);
  // ダブルクリックで消す
  await page.locator(".eh.bend").dblclick();
  await expect(page.locator(".eh.bend")).toHaveCount(0);
});

test("F-VIEW-16: 線の端を別の縁へ付け替え、調整した形を draw.io にも書く", async ({ page }) => {
  // Arrange
  await selectEdge(page);
  const end = await page.locator('.eh.end[data-end="f"]').boundingBox();
  const car = await page.locator('#gNodes .node[data-key="Car"] .body').boundingBox();
  if (!end || !car) throw new Error("つまみか要素がありません");
  // Act（始点の端を、Car の右の縁へ動かす。曲がり角も 1 つ足す）
  await dragBy(page, '.eh.end[data-end="f"]', car.x + car.width - (end.x + end.width / 2), car.y + car.height / 2 - (end.y + end.height / 2));
  await dragBy(page, '.eh.mid[data-mid="0"]', 120, 0);
  // Assert（端は右の縁に移る）
  const moved = await page.locator('.eh.end[data-end="f"]').boundingBox();
  expect(Math.abs((moved?.x ?? 0) + (moved?.width ?? 0) / 2 - (car.x + car.width))).toBeLessThan(4);
  // draw.io の線に、曲がり角の点と付け替えた端を書く
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnExport").click();
  await page.locator("#exportFormat").selectOption({ label: "draw.io（.drawio）" });
  const download = page.waitForEvent("download");
  await page.locator("#exportName").press("Enter");
  const xml = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString();
  expect(xml).toMatch(/<Array as="points"><mxPoint x="-?\d+" y="-?\d+"\/><\/Array>/);
  expect(xml).toContain("exitX=1;");
});
