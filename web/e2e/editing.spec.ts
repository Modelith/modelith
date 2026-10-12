// 図からの編集（F-EDIT-2・3・4・F-VIEW-3）。図の操作はすべてテキストの編集として反映される。
import { editorText, expect, nodeKeys, openApp, test } from "./fixtures";

test("F-EDIT-2: パレットで要求を置くとテキストに追加され、削除するとテキストから消える", async ({ page }) => {
  // Arrange
  await openApp(page);
  await page.locator('#palette [data-tool="requirement def"]').click();
  const box = (await page.locator("#wrap").boundingBox())!;
  // Act
  await page.mouse.click(box.x + 120, box.y + box.height - 120);
  await page.locator('[data-act="renameCancel"]').click();
  const added = await editorText(page);
  await page.locator('[data-act="del"]').click();
  await page.locator('[data-act="del"]').click(); // 確認のためもう一度
  // Assert
  expect(added).toContain("requirement def NewRequirement {");
  expect(await editorText(page)).not.toContain("NewRequirement");
});

test("F-EDIT-3: 名前を変えると、参照もまとめて変わる", async ({ page }) => {
  // Arrange
  await openApp(page);
  // 配置情報（@layout）にも新しい名前で書かれるので、モデル本体だけで数える
  const count = (t: string, w: string): number => t.replace(/\/\* @layout[\s\S]*?\*\//, "").split(w).length - 1;
  const before = count(await editorText(page), "BoilTimeReq");
  await page.locator('#gNodes .node[data-key="BoilTimeReq"]').click();
  // Act
  await page.locator('[data-act="rename"]').click();
  await page.locator("#renameIn").fill("BoilingTimeReq");
  await page.keyboard.press("Enter");
  // Assert
  const after = await editorText(page);
  expect(before).toBeGreaterThan(1);
  expect(count(after, "BoilTimeReq")).toBe(0);
  expect(count(after, "BoilingTimeReq")).toBe(before);
  expect(await nodeKeys(page)).toContain("BoilingTimeReq");
  expect(after).toMatch(/\/\* @layout[\s\S]*"BoilingTimeReq":\[/);
});

test("F-VIEW-3: 要素をドラッグすると、配置がテキストに保存される", async ({ page }) => {
  // Arrange
  await openApp(page);
  const node = page.locator('#gNodes .node[data-key="BoilTimeReq"]');
  const b = (await node.boundingBox())!;
  // Act
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 240, b.y + 220, { steps: 6 });
  await page.mouse.up();
  // Assert
  const text = await editorText(page);
  expect(text).toMatch(/\/\* @layout \{[\s\S]*"trace": \{[^\n]*"BoilTimeReq":\[/);
});

test("F-EDIT-4: 元に戻す・やり直すができ、履歴はファイルごとに分かれる", async ({ page }) => {
  // Arrange
  await openApp(page);
  const original = await editorText(page);
  await page.locator("#ed").fill("package Edited;\n");
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ
  await page.locator('[data-cmd="new"]').click(); // 別の文書（無題）を開く
  // Act
  await page.locator('#explorer [data-doc]:has-text("electric-kettle.sysml")').click();
  await page.locator("#btnUndo").click();
  const undone = await editorText(page);
  await page.locator("#btnRedo").click();
  // Assert
  expect(undone).toBe(original);
  expect(await editorText(page)).toBe("package Edited;\n");
});
