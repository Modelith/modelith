// 複数のファイルにまたがるモデル（ADR-0021、F-FILE-15）。ローカルフォルダの代わりに OPFS を使う。
import { expect, openApp, putFiles, test } from "./fixtures";
import type { Page } from "@playwright/test";

const PARTS = "package Parts {\n    part def Car;\n    part def Bus;\n}\n";
const APP = "package App {\n    import Parts::*;\n    part def Fleet {\n        part c : Car;\n    }\n}\n";

/** parts.sysml と app.sysml のフォルダを開き、app.sysml を表示して、図のタブ「ブロック定義図」を開く。 */
async function openApp2(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "parts.sysml": PARTS, "app.sysml": APP });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  await expect(page.locator("#docName")).toHaveText("app.sysml");
  await page.waitForTimeout(400); // 表示の反映で図のタブのメニューが描き直されるのを待つ
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="structure"]').click();
}

test("F-FILE-15: import したほかのファイルの定義を見つけ、参照したものだけをファイル名の札を付けて描く", async ({ page }) => {
  // Arrange・Act
  await openApp2(page);
  // Assert（Car は見つかり、取り込んだだけの Bus は描かない）
  await expect(page.locator('#gNodes .node[data-key="Car"] .filebadge text')).toHaveText("parts.sysml");
  await expect(page.locator('#gNodes .node[data-key="Bus"]')).toHaveCount(0);
  await expect(page.locator("#problems")).not.toContainText("見つかりません");
});

test("F-FILE-15: ほかのファイルの要素を選ぶと、そのファイルを開ける", async ({ page }) => {
  // Arrange
  await openApp2(page);
  // Act
  await page.locator('#gNodes .node[data-key="Car"]').click();
  await expect(page.locator("#insp")).toContainText("parts.sysml の要素");
  await page.locator('#insp [data-act="openFile"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("parts.sysml");
});

test("F-FILE-15: ほかのファイルの要素を図から消そうとすると、書き換えずにそのファイルを案内する", async ({ page }) => {
  // Arrange
  await openApp2(page);
  await page.locator('#gNodes .node[data-key="Car"]').click();
  // Act
  await page.keyboard.press("Delete");
  // Assert（テキストは変えず、案内からそのファイルを開ける）
  await expect(page.locator("#dialog")).toContainText("この要素は「parts.sysml」にあります");
  await page.locator('#dialogButtons [data-id="open"]').click();
  await expect(page.locator("#docName")).toHaveText("parts.sysml");
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  await expect(page.locator("#ed")).toHaveValue(APP);
});

test("F-FILE-15: ほかのファイルを編集すると、表示に戻ったときの図に入る", async ({ page }) => {
  // Arrange
  await openApp2(page);
  await page.locator('#explorer [data-file][title="parts.sysml"]').click();
  // Act（Car の名前をテキストで変える）
  await page.locator("#ed").fill(PARTS.replace("Car", "Truck"));
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ
  await page.locator('#explorer [data-file][title="app.sysml"]').click();
  // Assert（app.sysml の Car は見つからなくなる）
  await expect(page.locator("#problems")).toContainText("型「Car」が見つかりません");
});
