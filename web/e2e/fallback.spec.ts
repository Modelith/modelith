// File System Access API の無いブラウザ（Safari・Firefox）での代替（F-FILE-10）。
import { editorText, expect, openApp, test, typeAtEnd } from "./fixtures";

test.use({ fsAccess: false });

test("F-FILE-10: フォルダは開けないと案内し、ファイルの読み込みはできる", async ({ page }) => {
  // Arrange
  await openApp(page);
  const chooser = page.waitForEvent("filechooser");
  // Act
  await page.keyboard.press("Control+o");
  await (await chooser).setFiles({ name: "m.sysml", mimeType: "text/plain", buffer: Buffer.from("package M {\n    part def Mine;\n}\n") });
  // Assert
  await expect(page.locator("#explorer")).toContainText("このブラウザではフォルダを開けません");
  await expect(page.locator("#docName")).toHaveText("m.sysml");
  expect(await editorText(page)).toContain("part def Mine;");
});

test("F-FILE-10: 保存はダウンロードになる", async ({ page }) => {
  // Arrange
  await openApp(page);
  await typeAtEnd(page, "// saved\n");
  const download = page.waitForEvent("download");
  // Act
  await page.keyboard.press("Control+s");
  // Assert
  const d = await download;
  expect(d.suggestedFilename()).toBe("electric-kettle.sysml");
  const body = await (await d.createReadStream()).toArray();
  expect(Buffer.concat(body).toString()).toContain("// saved\n");
});

test("F-FILE-10・F-VIEW-6: 保存では、モデルと配置ファイルを両方ダウンロードする", async ({ page }) => {
  // Arrange（サンプルは配置を持つ）
  await openApp(page);
  const names: string[] = [];
  page.on("download", (d) => names.push(d.suggestedFilename()));
  // Act
  await page.keyboard.press("Control+s");
  // Assert
  await expect.poll(() => names).toEqual(["electric-kettle.sysml", "electric-kettle.layout.json"]);
});

test("F-FILE-10・F-VIEW-6: モデルと配置ファイルを一緒に選んで開くと、配置も戻る", async ({ page }) => {
  // Arrange
  await openApp(page);
  const chooser = page.waitForEvent("filechooser");
  const file = (name: string, text: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  // Act
  await page.keyboard.press("Control+o");
  await (await chooser).setFiles([
    file("m.sysml", "package M {\n    requirement def Mine;\n}\n"),
    file("m.layout.json", '{"modelith":"layout","format":1,"views":{"trace":{"Mine":[600,400]}}}'),
  ]);
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="trace"]').click();
  // Assert
  await expect(page.locator("#docName")).toHaveText("m.sysml");
  await expect(page.locator('#gNodes .node[data-key="Mine"]')).toHaveAttribute("transform", /translate\(600,\s*400\)/);
});

test("Q-5: テキストを読み取る部品（wasm）を読み込めないと、白い画面のままにせず、読み込み直すよう案内する（異常系）", async ({ page }) => {
  // Arrange
  await page.route("**/*.wasm", (route) => route.abort());
  // Act
  await page.goto("./");
  // Assert
  const box = page.locator("#startupError");
  await expect(box).toBeVisible();
  await expect(box).toContainText("ページを読み込み直してください");
  await expect(page.locator("#gNodes .node")).toHaveCount(0);
});
