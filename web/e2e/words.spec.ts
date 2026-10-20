// テキストの語の説明（F-EDIT-9）と狭い画面のテキスト（F-EDIT-10）。広い画面のツールチップと、カーソルのある語の説明の行、
// 幅 390px の読み取り専用と「編集」ボタン。
import { editorText, expect, openApp, test } from "./fixtures";
import type { Page } from "@playwright/test";

const TEXT = "package Kettle {\n    // part の説明はしない\n    part def Heater;\n    attribute power : Real;\n}\n";

/**
 * テキストの中の語が画面に描かれている矩形の中心を返す（色付けの層 #hl の文字で調べる）。
 *
 * @param page ページ
 * @param needle 探すテキスト（最初に現れる所）
 * @param from 語の始まりを needle の中で何文字目にするか
 * @param length 語の長さ
 * @returns 語の中心の画面の座標
 */
async function wordCenter(page: Page, needle: string, from: number, length: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([needle, from, length]) => {
      const start = (document.querySelector<HTMLTextAreaElement>("#ed")!.value.indexOf(needle)) + from;
      const walker = document.createTreeWalker(document.querySelector("#hl")!, NodeFilter.SHOW_TEXT);
      let pos = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = n.textContent!.length;
        if (start < pos + len) {
          const r = document.createRange();
          r.setStart(n, start - pos);
          r.setEnd(n, start - pos + length);
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
        pos += len;
      }
      throw new Error(`見つかりません: ${needle}`);
    },
    [needle, from, length] as const,
  );
}

/** テキストを置き換えて、図への反映を待つ。 */
async function setText(page: Page, text: string): Promise<void> {
  await page.locator("#ed").fill(text);
  await page.waitForTimeout(400);
}

test.describe("語の説明", () => {
  test("F-EDIT-9: キーワードにマウスを乗せると、その意味をツールチップで示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await setText(page, TEXT);
    const p = await wordCenter(page, "part def", 0, 4);
    // Act
    await page.mouse.move(p.x, p.y);
    // Assert
    await expect(page.locator("#wordTip")).toBeVisible();
    await expect(page.locator("#wordTip b")).toHaveText("部品定義（part def）");
    await expect(page.locator("#wordTip")).toContainText("部品の型を定義します");
  });

  test("F-EDIT-9: 標準ライブラリの型にマウスを乗せると、その意味を示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await setText(page, TEXT);
    const p = await wordCenter(page, "Real", 0, 4);
    // Act
    await page.mouse.move(p.x, p.y);
    // Assert
    await expect(page.locator("#wordTip b")).toHaveText("実数（Real）");
  });

  test("F-EDIT-9: コメントの中の語と利用者の付けた名前には、ツールチップを出さない", async ({ page }) => {
    // Arrange
    await openApp(page);
    await setText(page, TEXT);
    const inComment = await wordCenter(page, "// part", 3, 4);
    const userName = await wordCenter(page, "Heater", 0, 6);
    // Act
    await page.mouse.move(inComment.x, inComment.y);
    await page.waitForTimeout(600);
    const shownOnComment = await page.locator("#wordTip").isVisible();
    await page.mouse.move(userName.x, userName.y);
    await page.waitForTimeout(600);
    // Assert
    expect(shownOnComment).toBe(false);
    await expect(page.locator("#wordTip")).toBeHidden();
  });

  test("F-EDIT-9: カーソルのある語の意味を、テキストの下の行に示し、説明の無い語では行を消す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await setText(page, TEXT);
    const keyword = await wordCenter(page, "attribute", 2, 1);
    const userName = await wordCenter(page, "Heater", 2, 1);
    // Act
    await page.mouse.click(keyword.x, keyword.y);
    const line = await page.locator("#wordLine").textContent();
    await page.mouse.click(userName.x, userName.y);
    // Assert
    expect(line).toBe("属性（attribute）部品などが持つ値（重さ・電圧など）です。");
    await expect(page.locator("#wordLine")).toBeHidden();
  });

  test("F-EDIT-9: キーボードでカーソルを動かすと、説明の行も追いかける", async ({ page }) => {
    // Arrange
    await openApp(page);
    await setText(page, "satisfy R by K;\n");
    await page.locator("#ed").focus();
    await page.keyboard.press("Control+Home");
    // Act
    await page.keyboard.press("ArrowRight");
    // Assert
    await expect(page.locator("#wordLine b")).toHaveText("満たす（satisfy）");
  });
});

test.describe("狭い画面のテキスト", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("F-EDIT-10・Q-2: 幅 390px では、テキストは初めは読み取り専用で、「編集」を押すと編集できる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#tabText").click();
    const readOnlyAtFirst = await page.locator("#ed").isEditable();
    // Act
    await page.locator("#btnEditText").click();
    await page.locator("#ed").press("End");
    await page.keyboard.type("x");
    // Assert
    expect(readOnlyAtFirst).toBe(false);
    await expect(page.locator("#btnEditText")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#ed")).toBeEditable();
    await expect(page.locator("#ed")).toBeFocused();
    expect(await editorText(page)).toContain("x");
  });

  test("F-EDIT-10: 「編集」をもう一度押すと、読み取り専用に戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#tabText").click();
    await page.locator("#btnEditText").click();
    // Act
    await page.locator("#btnEditText").click();
    // Assert
    await expect(page.locator("#btnEditText")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#ed")).not.toBeEditable();
    await expect(page.locator("#ed")).not.toBeFocused();
  });

  test("F-EDIT-10: 広い画面に広げると編集でき、狭い画面に戻すと読み取り専用に戻る", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#tabText").click();
    await page.locator("#btnEditText").click();
    // Act
    await page.setViewportSize({ width: 1280, height: 800 });
    const wideEditable = await page.locator("#ed").isEditable();
    const buttonShown = await page.locator("#btnEditText").isVisible();
    await page.setViewportSize({ width: 390, height: 800 });
    // Assert
    expect(wideEditable).toBe(true);
    expect(buttonShown).toBe(false);
    await page.locator("#tabText").click();
    await expect(page.locator("#ed")).not.toBeEditable();
    await expect(page.locator("#btnEditText")).toHaveAttribute("aria-pressed", "false");
  });
});
