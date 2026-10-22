// 知らせの重さ（F-EDIT-11）。プロジェクトの設定（modelith.json の levels）で、知らせの種類ごとに重さを選ぶ。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** 2 つ目のフェーズの要求 FlowReq に、満たす要素と検証が無いモデル。 */
const REQ = `package P {
    enum def Stage { enum concept; enum detail; }
    metadata def Phase { attribute stage : Stage; }
    requirement def Need { @Phase { stage = concept; } }
    requirement def FlowReq { @Phase { stage = detail; } }
    #derivation dependency from Need to FlowReq;
}
`;

/** modelith.json と req.sysml のフォルダを開き、req.sysml を表示する。 */
async function openProject(page: Page, project: string): Promise<void> {
  await openApp(page);
  await putFiles(page, { "req.sysml": REQ, "modelith.json": project });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="req.sysml"]').click();
  await expect(page.locator("#docName")).toHaveText("req.sysml");
}

test("F-EDIT-11: プロジェクトで選んだ重さで、トレースの抜けをエラーにし、出さないにした種類は問題一覧に出さない", async ({ page }) => {
  // Act
  await openProject(page, '{ "plugins": {}, "levels": { "trace.verify": "error", "trace.satisfy": "off" } }\n');
  // Assert
  const verify = page.locator("#problems button.gap", { hasText: "検証" });
  await expect(verify).toHaveClass(/lv-error/);
  await expect(verify).toContainText("⚠");
  await expect(page.locator("#problems button.gap", { hasText: "満たす要素" })).toHaveCount(0);
  await expect(page.locator("#problems button.gap", { hasText: "導出" })).toHaveClass(/lv-warning/);
});

test("F-EDIT-11: 「知らせの重さ…」で選んだ重さを modelith.json に書き、問題一覧に当てる", async ({ page }) => {
  // Arrange
  await openProject(page, '{ "plugins": {} }\n');
  await expect(page.locator("#problems button.gap", { hasText: "検証" })).toHaveClass(/lv-warning/);
  // Act
  await page.locator("#viewMenu summary").click();
  await page.locator("#menuLevels").click();
  await page.locator('#levelsList select[data-kind="trace.verify"]').selectOption({ label: "エラー" });
  // Assert
  await expect(page.locator("#toast")).toHaveText("知らせの重さを変更しました");
  await expect.poll(() => readFile(page, "modelith.json")).toContain('"trace.verify": "error"');
  await page.locator("#levelsClose").click();
  await expect(page.locator("#problems button.gap", { hasText: "検証" })).toHaveClass(/lv-error/);
});

test("F-EDIT-11: プロジェクトでなければ、重さを選べないことと、選べるようにする方法を示す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#viewMenu summary").click();
  await page.locator("#menuLevels").click();
  // Assert
  await expect(page.locator("#levelsText")).toContainText("「プロジェクトにする」を選ぶと、変えられるようになります");
  await expect(page.locator('#levelsList select[data-kind="trace.verify"]')).toBeDisabled();
});
