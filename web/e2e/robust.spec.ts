// 黙って失われない・黙って止まらない（F-FILE-6・F-FILE-11・F-VIEW-2・Q-6）。
// 保存の失敗やブラウザの保存領域の不足、壊れた記憶、予期しない例外を起こして、利用者に知らせることを確かめる。
import { test as raw, type Page } from "@playwright/test";
import { editorText, expect, openApp, putFiles, readFile, test, typeAtEnd } from "./fixtures";

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
test("F-FILE-6・Q-4: 自動保存に失敗したら（フォルダの許可が切れた）、理由を日本語で知らせて未保存の印を残す（異常系）", async ({ page }) => {
  // Arrange（書き込みが許可の失効で失敗するブラウザのふり）
  await openWithAutoSave(page);
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new DOMException("permission revoked", "NotAllowedError"));
  });
  // Act
  await typeAtEnd(page, "// auto\n");
  // Assert
  await expect(page.locator("#toast")).toHaveText("「a.sysml」を自動保存できませんでした：フォルダやファイルを編集する許可がありません。もう一度開いて、ブラウザの確認で許可してください", { timeout: 3000 });
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

// ---- Q-6 unexpected
// 予期しない例外をわざと起こすので、画面の例外が無いことを確かめる共通の page は使わない
const UNEXPECTED = "予期しない問題が起きました。テキストはそのまま残っています";

raw("Q-6: 結果を待たない処理が失敗しても黙って止まらず、知らせてコンソールに残す", async ({ page }) => {
  // Arrange
  const logs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(m.text());
  });
  await openApp(page);
  const before = await editorText(page);
  // Act
  await page.evaluate(() => {
    setTimeout(() => Promise.reject(new Error("e2e: 待たない処理の失敗")), 0);
  });
  // Assert
  await expect(page.locator("#toast")).toHaveText(UNEXPECTED);
  expect(await editorText(page)).toBe(before);
  await expect.poll(() => logs.some((l) => l.includes("予期しない問題") && l.includes("待たない処理の失敗"))).toBe(true);
});

raw("Q-6: 捕まえていない例外が起きても黙って止まらず、知らせる", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("e2e: 捕まえていない例外");
    }, 0);
  });
  // Assert
  await expect(page.locator("#toast")).toHaveText(UNEXPECTED);
  await expect(page.locator("#gNodes .node").first()).toBeVisible();
});

// ---- Q-6 recovery
test("Q-6: 起動の途中で失敗したら、保存した設定を初期化して読み直す操作を示し、下書きは消さない（異常系）", async ({ page }) => {
  // Arrange（下書きとタブを記憶させてから、次の起動で画面の組み立てが失敗するブラウザのふり）
  await openApp(page);
  await typeAtEnd(page, "// draft\n");
  await page.evaluate(() => {
    localStorage.setItem("modelith-ui-v1", '{"tree":false}');
    localStorage.setItem("e2e-break-init", "1");
  });
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e-break-init")) {
      window.matchMedia = () => {
        throw new Error("e2e: matchMedia failed");
      };
    }
  });
  // Act
  await page.reload();
  // Assert
  const box = page.locator("#startupError");
  await expect(box).toContainText("保存した設定を初期化して読み直す");
  await expect(box).toContainText("下書き・前回の続き・プラグインの許可は消えません");
  await expect(box).toContainText("e2e: matchMedia failed");
  const reloaded = page.waitForEvent("load");
  await page.locator("#btnResetSettings").click();
  await reloaded;
  const keys = await page.evaluate(() => ({
    tabs: localStorage.getItem("modelith-tabs-v1"),
    ui: localStorage.getItem("modelith-ui-v1"),
    drafts: localStorage.getItem("modelith-drafts-v1") ?? "",
  }));
  expect(keys.tabs).toBeNull();
  expect(keys.ui).toBeNull();
  expect(keys.drafts).toContain("// draft");
});
