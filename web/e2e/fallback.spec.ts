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
