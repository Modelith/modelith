// File System Access API の無いブラウザ（Safari・Firefox）での代替（F-FILE-10・F-FILE-13）。
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
  await expect(box).toContainText("ページを再読み込みしてください");
  await expect(page.locator("#gNodes .node")).toHaveCount(0);
});

test("F-FILE-14・F-FILE-10: 何も開いていないときの案内に、開けない「フォルダを開く」は出さない", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await page.locator("#explorer [data-close]").click();
  await page.locator('#dialogButtons [data-id="discard"]').click();
  // Assert
  await expect(page.locator('#noDoc [data-nodoc="open"]')).toBeVisible();
  await expect(page.locator('#noDoc [data-nodoc="openFolder"]')).toBeHidden();
});

test("F-FILE-13: フォルダを開けないブラウザでも、再読み込みすると下書きと表示していたファイルから始まる", async ({ page }) => {
  // Arrange（後から作った無題のファイルを表示したまま終える）
  await openApp(page);
  await page.locator('[data-cmd="new"]').click();
  await typeAtEnd(page, "package U;\n");
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ
  // Act
  await page.reload();
  // Assert
  await expect(page.locator("#docName")).toHaveText("untitled-1.sysml");
  await expect.poll(() => editorText(page)).toBe("package U;\n");
  expect(await page.locator("#explorer [data-doc] .nm").allInnerTexts()).toEqual(["electric-kettle.sysml", "untitled-1.sysml"]);
});
