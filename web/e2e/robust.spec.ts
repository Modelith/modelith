// 黙って失われない・黙って止まらない（F-FILE-6・F-FILE-11・F-VIEW-2・Q-6）。
// 保存の失敗やブラウザの保存領域の不足、壊れた記憶、予期しない例外を起こして、利用者に知らせることを確かめる。
import type { Page } from "@playwright/test";
import { expect, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";

const A = "package A {\n    part def Pump;\n}\n";

/** フォルダ（OPFS の project）を開き、a.sysml を表示して、自動保存を有効にする。 */
async function openWithAutoSave(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": A });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await page.locator("#fileMenu summary").click();
  await page.locator("#autoSave").check();
  await page.locator("#fileMenu summary").click();
}

// ---- F-FILE-6
test("F-FILE-6: 自動保存に失敗したら（フォルダの許可が切れた）、理由を知らせて未保存の印を残す（異常系）", async ({ page }) => {
  // Arrange（書き込みが許可の失効で失敗するブラウザのふり）
  await openWithAutoSave(page);
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new DOMException("permission revoked", "NotAllowedError"));
  });
  // Act
  await typeAtEnd(page, "// auto\n");
  // Assert
  await expect(page.locator("#toast")).toHaveText("「a.sysml」を自動保存できませんでした：permission revoked", { timeout: 3000 });
  await expect(page.locator("#docName")).toHaveText("a.sysml ●");
  expect(await readFile(page, "a.sysml")).toBe(A);
});

// ---- F-FILE-11
/** ブラウザの保存領域（localStorage）を、残りが数十バイトになるまで埋める（大きい・小さい・1 文字の順に、入らなくなるまで）。 */
async function fillStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    let n = 0;
    for (const size of [256 * 1024, 1024, 1]) {
      const chunk = "x".repeat(size);
      for (let i = 0; i < 4096; i++) {
        try {
          localStorage.setItem(`e2e-fill-${n++}`, chunk);
        } catch {
          break;
        }
      }
    }
  });
}

const DRAFT_LOST = "下書きを保存できません（ブラウザの保存領域がいっぱいです）。「名前を付けて保存」で保存してください";
const LONG_LINE = `// ${"x".repeat(120)}\n`;

test("F-FILE-11: 保存領域がいっぱいで下書きを保存できないと、1 回だけ知らせて「名前を付けて保存」を案内する（異常系）", async ({ page }) => {
  // Arrange（サンプルは無題の下書き。保存領域を埋めてから編集する）
  await openApp(page);
  await fillStorage(page);
  // Act
  await typeAtEnd(page, LONG_LINE);
  // Assert
  const toast = page.locator("#toast");
  await expect(toast).toHaveText(DRAFT_LOST);
  await expect(toast).not.toHaveClass(/on/, { timeout: 5000 });
  await typeAtEnd(page, LONG_LINE); // 続けて編集しても、もう一度は知らせない
  await page.waitForTimeout(500);
  await expect(toast).not.toHaveClass(/on/);
});

test("F-FILE-11・F-FILE-5: 下書きを保存できていないままページを離れようとすると警告する", async ({ page }) => {
  // Arrange
  await openApp(page);
  await fillStorage(page);
  await typeAtEnd(page, LONG_LINE);
  await expect(page.locator("#toast")).toHaveText(DRAFT_LOST);
  const dialog = page.waitForEvent("dialog");
  // Act
  await page.close({ runBeforeUnload: true });
  // Assert
  const d = await dialog;
  expect(d.type()).toBe("beforeunload");
  await d.dismiss();
});

test("F-FILE-11: 下書きを保存できている間は、無題の文書を編集してもページを離れる警告を出さない（正常系）", async ({ page }) => {
  // Arrange
  await openApp(page);
  await typeAtEnd(page, LONG_LINE);
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  // Act
  await page.close({ runBeforeUnload: true });
  // Assert
  expect(dialogs).toBe(0);
});

// ---- F-VIEW-2
test("F-VIEW-2: 記憶した図のタブが壊れていても起動し、形の合うタブだけを戻す（異常系）", async ({ page }) => {
  // Arrange（null・文字列・id が整数でない・知らないビューの項目を混ぜる）
  await openApp(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "modelith-tabs-v1",
      JSON.stringify({ tabs: [null, "abc", { id: 1.5, view: "trace", ctx: null, phase: "" }, { id: 9, view: "gone" }, { id: 7, view: "structure", ctx: null, phase: "" }], active: 7 }),
    ),
  );
  // Act
  await page.reload();
  await page.locator("#gNodes .node").first().waitFor();
  // Assert
  await expect(page.locator("#tabbar .tab")).toHaveCount(1);
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText("ブロック定義図");
});

test("F-VIEW-2: 記憶した図のタブが配列でなければ、既定のタブで起動する（異常系）", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.evaluate(() => localStorage.setItem("modelith-tabs-v1", '{"tabs":"abc"}'));
  // Act
  await page.reload();
  await page.locator("#gNodes .node").first().waitFor();
  // Assert
  await expect(page.locator("#tabbar .tab")).toHaveCount(4);
  await expect(page.locator('.tab[aria-selected="true"]')).toContainText("トレーサビリティ");
});
