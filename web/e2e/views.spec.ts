// ビュー・ツリー・テキストとの同期・トレーサビリティ（F-VIEW-*・F-EDIT-1・5・F-TRACE-*）
import { editorText, expect, nodeKeys, openApp, test } from "./fixtures";

test.describe("ビュー", () => {
  const cases: [string, string][] = [
    ["trace", "BoilTimeReq"],
    ["structure", "Kettle"],
    ["control", "HeaterController"],
    ["ibd", "u:controller"],
    ["behavior", "KettleStates"],
    ["seq", "l:controller"],
    ["all", "WaterVessel"],
  ];
  for (const [view, key] of cases) {
    test(`F-VIEW-1: ${view} ビューを開くとサンプルの「${key}」が描かれる`, async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await page.locator(".tabadd summary").click();
      await page.locator(`[data-open="${view}"]`).click();
      // Assert
      await expect.poll(() => nodeKeys(page)).toContain(key);
    });
  }

  test("F-VIEW-2: 開いたタブは再読み込みしても残り、表示中のまま", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="structure"]').click();
    // Act
    await page.reload();
    await page.locator("#gNodes .node").first().waitFor();
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toContainText("構造");
  });

  test("F-VIEW-4: 拡大ボタンで図が大きくなり、空いた所のドラッグで範囲選択できる", async ({ page }) => {
    // Arrange
    await openApp(page);
    const scale = async (): Promise<number> => Number(/scale\(([\d.]+)\)/.exec((await page.locator("#vp").getAttribute("transform")) ?? "")?.[1]);
    const before = await scale();
    // Act
    await page.locator("#zIn").click();
    const box = (await page.locator("#wrap").boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 60, box.y + box.height - 60, { steps: 5 });
    await page.mouse.up();
    // Assert
    expect(await scale()).toBeGreaterThan(before);
    await expect(page.locator("#insp")).toContainText("個を選択中");
    await expect(page.locator("#mini")).toBeVisible();
  });
});

test.describe("テキストと図の同期", () => {
  test("F-EDIT-1: テキストを書き換えると、入力が止まってから 1 秒以内に図に反映される", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="all"]').click();
    // Act
    await page.locator("#ed").fill("package P {\n    part def Probe;\n}\n");
    // Assert（要求は 0.3 秒。描画の待ちを含めて 1 秒で確かめる）
    await expect(page.locator('#gNodes .node[data-key="Probe"]')).toBeVisible({ timeout: 1000 });
  });

  test("F-EDIT-5: 構文エラーを行番号付きで示し、クリックでその位置にカーソルを移す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill("package P {\n    part def A;\n    part b : Missing;\n}\n");
    const problem = page.locator('#problems button:has-text("Missing")');
    // Act
    await problem.click();
    // Assert
    await expect(problem).toContainText("3 行目");
    await expect(problem).toContainText("Missing");
    const caret = await page.locator("#ed").evaluate((e) => (e as HTMLTextAreaElement).selectionStart);
    expect((await editorText(page)).slice(caret)).toMatch(/^part b : Missing/);
  });

  test("F-EDIT-8: まだ扱えない構文は、黙って捨てずに問題一覧で知らせ、エラーとしては数えない", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator("#ed").fill("package P {\n    part def A;\n    case def C;\n}\n");
    // Assert
    const info = page.locator("#problems button.unsupported");
    await expect(info).toContainText("3 行目");
    await expect(info).toContainText("「case def C」は Modelith ではまだ扱えない");
    await expect(page.locator("#syncText")).toHaveText("同期済み");
  });

  test("F-VIEW-5: モデルのツリーを名前で絞り込み、選ぶと図で選択される", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#sideModel").click();
    // Act
    await page.locator("#treeSearch").fill("Heater");
    await page.locator('#tree .ti:has-text("HeaterController")').first().click();
    // Assert
    await expect(page.locator("#tree .ti")).not.toHaveCount(0);
    await expect(page.locator('#tree .ti:has-text("Kettle")').first()).toBeVisible(); // 親は残る
    await expect(page.locator("#tree")).not.toContainText("WaterVessel");
    await expect(page.locator("#insp")).toContainText("HeaterController");
  });
});

test.describe("トレーサビリティ", () => {
  test("F-TRACE-1: フェーズで絞り込むと、そのフェーズの要求だけが残る", async ({ page }) => {
    // Arrange
    await openApp(page);
    const before = (await nodeKeys(page)).length;
    // Act
    await page.locator("#phaseFilter").selectOption("SystemRequirements");
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).length).toBeLessThan(before);
    expect(await nodeKeys(page)).toContain("BoilTimeReq");
  });

  test("F-TRACE-2: トレースの抜けを件数で示し、押すと問題一覧の該当箇所へ移る", async ({ page }) => {
    // Arrange
    await openApp(page);
    const gaps = page.locator("#btnGaps");
    // Act
    await gaps.click();
    // Assert
    await expect(gaps).toHaveText("トレースの抜け 1 件");
    await expect(page.locator("#problems .gap")).toContainText("DryBoilCutoffReq");
  });
});
