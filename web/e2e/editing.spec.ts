// 図からの編集（F-EDIT-2・3・4・F-VIEW-3・6）。図の操作はテキストの編集として反映し、配置は配置ファイルに保存する（ADR-0005）。
import { editorText, expect, nodeKeys, openApp, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

test("F-EDIT-2・C-1: パレットで要求を置くとテキストに追加され、削除するとテキストから消える", async ({ page }) => {
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
  const count = (t: string, w: string): number => t.split(w).length - 1;
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
});

/** 要素をドラッグして動かす。 */
async function dragNode(page: Page, key: string, dx: number, dy: number): Promise<void> {
  const b = (await page.locator(`#gNodes .node[data-key="${key}"]`).boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 40 + dx, b.y + 20 + dy, { steps: 6 });
  await page.mouse.up();
}

const MODEL = "package A {\n    part def Alpha;\n    part def Beta;\n}\n";

/** project フォルダに a.sysml（と配置ファイル）を置き、フォルダを開いて a.sysml を開く（ビューはまだ開かない）。 */
async function openA(page: Page, files: Record<string, string>): Promise<void> {
  await openApp(page);
  await putFiles(page, files);
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await expect(page.locator("#docName")).toHaveText("a.sysml");
}

/** a.sysml を開き、すべての要素のビューを表示する。 */
async function openInFolder(page: Page, files: Record<string, string>): Promise<void> {
  await openA(page, files);
  await openAllView(page);
}

/** project フォルダの one.sysml だけを、ファイルを 1 つ選んで開く（フォルダは開かない）。 */
async function openOneFile(page: Page): Promise<void> {
  await openApp(page);
  await putFiles(page, { "one.sysml": MODEL });
  await page.evaluate(() => ((window as unknown as { __e2e: { openFile: string } }).__e2e.openFile = "one.sysml"));
  await page.keyboard.press("Control+o");
  await expect(page.locator("#docName")).toHaveText("one.sysml");
  await openAllView(page);
}

/** ダイアログの題名を確かめて、ボタンを押す。 */
async function answer(page: Page, title: string, id: string): Promise<void> {
  await expect(page.locator("#dialogTitle")).toHaveText(title);
  await page.locator(`#dialogButtons [data-id="${id}"]`).click();
}

const LEGACY = MODEL + '\n/* @layout {\n  "trace": {"Alpha":[600,400]}\n} */\n';

/** 部品の定義は既定のタブに出ないので、すべての要素のビューを開く。 */
async function openAllView(page: Page): Promise<void> {
  await page.locator(".tabadd summary").click();
  await page.locator('[data-open="all"]').click();
}

test.describe("配置ファイル（ADR-0005）", () => {
  test("F-VIEW-3・C-6: 要素をドラッグして保存すると、配置は隣の a.layout.json に書き、a.sysml には書かない", async ({ page }) => {
    // Arrange
    await openInFolder(page, { "a.sysml": MODEL });
    // Act
    await dragNode(page, "Alpha", 200, 160);
    await page.keyboard.press("Control+s");
    // Assert
    await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"modelith": "layout"[\s\S]*"Alpha": \[/);
    expect(await readFile(page, "a.sysml")).toBe(MODEL);
    expect(await editorText(page)).not.toContain("@layout");
  });

  test("F-VIEW-3: 名前を変えると、配置も新しい名前で引き継ぐ", async ({ page }) => {
    // Arrange
    await openInFolder(page, { "a.sysml": MODEL });
    await dragNode(page, "Alpha", 200, 160);
    await page.locator('#gNodes .node[data-key="Alpha"]').click();
    // Act
    await page.locator('[data-act="rename"]').click();
    await page.locator("#renameIn").fill("Gamma");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+s");
    // Assert
    await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"Gamma": \[/);
    expect(await readFile(page, "a.layout.json")).not.toMatch(/"Alpha": \[/);
  });

  test("F-VIEW-3: 開くと配置ファイルの位置に描く", async ({ page }) => {
    // Arrange
    const layout = '{"modelith":"layout","format":1,"views":{"trace":{"Alpha":[600,400]}}}';
    // Act
    await openInFolder(page, { "a.sysml": MODEL, "a.layout.json": layout });
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="trace"]').click();
    // Assert
    await expect(page.locator('#gNodes .node[data-key="Alpha"]')).toHaveAttribute("transform", /translate\(600,\s*400\)/);
    await expect(page.locator("#docName")).toHaveText("a.sysml");
  });

  test("F-VIEW-3・C-6: 古い形式（テキスト内の @layout）の配置も読み、移すかを尋ね、そのままにすれば何も変えない", async ({ page }) => {
    // Arrange
    await openA(page, { "a.sysml": LEGACY });
    // Act
    await answer(page, "図の配置を整理します", "keep");
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="trace"]').click();
    // Assert
    await expect(page.locator('#gNodes .node[data-key="Alpha"]')).toHaveAttribute("transform", /translate\(600,\s*400\)/);
    await expect(page.locator("#docName")).toHaveText("a.sysml"); // 変更の印が無い
    expect(await editorText(page)).toBe(LEGACY);
  });

  test("C-6: 古い形式の配置を移すと、保存でテキストからコメントを消し、配置ファイルに書く", async ({ page }) => {
    // Arrange
    await openA(page, { "a.sysml": LEGACY });
    // Act
    await answer(page, "図の配置を整理します", "move");
    await page.keyboard.press("Control+s");
    // Assert
    await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"trace": \{\s*"Alpha": \[600,400\]/);
    expect(await readFile(page, "a.sysml")).toBe(MODEL);
    expect(await editorText(page)).toBe(MODEL);
  });

  test("F-VIEW-6: 1 つだけ開いたファイルで配置を変えると「配置は未保存」と示し、保存でフォルダを開けば隣に保存する", async ({ page }) => {
    // Arrange
    await openOneFile(page);
    await dragNode(page, "Alpha", 200, 160);
    const unsaved = await page.locator("#docName .lu").textContent();
    // Act
    await page.keyboard.press("Control+s");
    await answer(page, "図の配置を保存する場所", "open");
    // Assert
    expect(unsaved).toBe("配置は未保存");
    await expect.poll(() => readFile(page, "one.layout.json")).toMatch(/"Alpha": \[/);
    await expect(page.locator("#docName .lu")).toHaveCount(0);
    await expect(page.locator('#explorer [data-file][title="one.sysml"]')).toBeVisible();
  });

  test("F-VIEW-6: 保存先を尋ねられて「あとで」を選ぶと、配置は未保存のまま（異常系）", async ({ page }) => {
    // Arrange
    await openOneFile(page);
    await dragNode(page, "Alpha", 200, 160);
    // Act
    await page.keyboard.press("Control+s");
    await answer(page, "図の配置を保存する場所", "later");
    // Assert
    await expect(page.locator("#docName .lu")).toHaveText("配置は未保存");
    expect(await readFile(page, "one.layout.json")).toBeNull();
  });

  test("F-VIEW-6・F-FILE-3: 新しいファイルは保存先のフォルダと名前を選び、配置ファイルも一緒に作る", async ({ page }) => {
    // Arrange（サンプルは配置を持つ無題の文書）
    await openApp(page);
    // Act
    await page.keyboard.press("Control+s");
    await expect(page.locator("#dialogInput")).toHaveValue("electric-kettle.sysml");
    await answer(page, "名前を付けて保存", "ok");
    // Assert
    await expect.poll(() => readFile(page, "electric-kettle.layout.json")).toMatch(/"modelith": "layout"/);
    expect(await readFile(page, "electric-kettle.sysml")).toBe(await editorText(page));
    await expect(page.locator('#explorer [data-file][title="electric-kettle.sysml"]')).toBeVisible();
  });

  test("F-VIEW-7・F-VIEW-3: テキストの view の配置は、view ごとに配置ファイルへ保存する", async ({ page }) => {
    // Arrange
    await openA(page, { "a.sysml": MODEL.replace("}\n", "    view v { expose A::Alpha; }\n}\n") });
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="v"]').click();
    // Act
    await dragNode(page, "Alpha", 200, 160);
    await page.keyboard.press("Control+s");
    // Assert
    await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"view:v": \{\s*"Alpha": \[/);
  });

  test("F-EDIT-4: 配置の変更も、元に戻す・やり直すができる", async ({ page }) => {
    // Arrange
    await openInFolder(page, { "a.sysml": MODEL });
    const pos = () => page.locator('#gNodes .node[data-key="Alpha"]').getAttribute("transform");
    const start = await pos();
    await dragNode(page, "Alpha", 200, 160);
    const moved = await pos();
    // Act
    await page.locator("#btnUndo").click();
    const undone = await pos();
    await page.locator("#btnRedo").click();
    // Assert
    expect(moved).not.toBe(start);
    expect(undone).toBe(start);
    expect(await pos()).toBe(moved);
  });
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

test.describe("package の無いファイル", () => {
  /** 新しいファイルを作り、パレットの「関心事」で図をクリックする。 */
  async function placeConcernInNewFile(page: import("@playwright/test").Page): Promise<void> {
    await openApp(page);
    await page.locator('[data-cmd="new"]').click();
    await expect(page.locator("#docName")).toHaveText("untitled-1.sysml");
    await page.locator('#palette [data-tool="concern def"]').click();
    const box = (await page.locator("#wrap").boundingBox())!;
    await page.mouse.click(box.x + 200, box.y + 200);
  }

  test("F-EDIT-7: 要素を置こうとすると、新しい package を作るよう案内し、作ってから置く", async ({ page }) => {
    // Arrange
    await placeConcernInNewFile(page);
    await expect(page.locator("#dialog")).toBeVisible();
    await expect(page.locator("#dialogInput")).toHaveValue("Untitled1");
    // Act
    await page.locator("#dialogInput").fill("Kettle");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    await page.locator('[data-act="renameCancel"]').click();
    // Assert
    const text = await editorText(page);
    expect(text).toMatch(/^package Kettle \{\n {4}concern def NewConcern \{\n {4}\}\n\}\n/);
    expect(await nodeKeys(page)).toContain("NewConcern");
  });

  test("F-EDIT-7: 案内で「やめる」を選ぶと、テキストは変わらない（異常系）", async ({ page }) => {
    // Arrange
    await placeConcernInNewFile(page);
    await expect(page.locator("#dialog")).toBeVisible();
    // Act
    await page.locator('#dialogButtons [data-id="cancel"]').click();
    // Assert
    await expect(page.locator("#dialog")).toBeHidden();
    expect(await editorText(page)).toBe("");
  });

  test("F-EDIT-7: 名前に使えない文字なら作らず、理由を伝える（異常系）", async ({ page }) => {
    // Arrange
    await placeConcernInNewFile(page);
    // Act
    await page.locator("#dialogInput").fill("my model");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect(page.locator("#toast")).toContainText("英字か _ で始め、英字・数字・_ だけで付けてください");
    expect(await editorText(page)).toBe("");
  });
});
