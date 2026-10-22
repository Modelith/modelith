// 図を作る（種類を選ぶ・空の図・対象を選ぶ／作る）と、サイドバーの「図」（開く・名前の変更・削除）（F-VIEW-8・F-VIEW-11）
import { editorText, expect, nodeKeys, openApp, test } from "./fixtures";

const MODEL = "package P {\n    part def A {\n        part b : B;\n    }\n    part def B;\n}\n";

/** モデルを書き、反映を待つ。 */
async function openModel(page: import("@playwright/test").Page, text = MODEL): Promise<void> {
  await openApp(page);
  await page.locator("#ed").fill(text);
  await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ
}

/** 図のメニューの「新しい図を作成…」を開き、名前と種類を選んで進める。 */
async function create(page: import("@playwright/test").Page, name: string, kind: string): Promise<void> {
  await page.locator("#diagramMenu > summary").click();
  await page.locator("#menuSaveView").click();
  await page.locator("#dialogInput").fill(name);
  await page.locator(`#dialogPick input[value="${kind}"]`).check();
  await page.locator('#dialogButtons [data-id="ok"]').click();
}

/** サイドバーの「図」を開く。 */
async function showDiagrams(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("#sideViews").click();
}

test.describe("図を作る（F-VIEW-8）", () => {
  test("F-VIEW-8: 一般の図を選ぶと、要素の無い空の図ができ、そのタブが開く", async ({ page }) => {
    // Arrange
    await openModel(page);
    // Act
    await create(page, "構成", "general");
    // Assert
    await expect.poll(() => editorText(page)).toContain("    view '構成' : GeneralView {\n    }\n");
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/構成/);
    await expect(page.locator("#toast")).toHaveText("空の図「構成」を作成しました。モデルのツリーから要素を入れてください");
    expect(await nodeKeys(page)).toEqual([]);
  });

  test("F-VIEW-8: 内部ブロック図を選ぶと、描くブロックをモデルから選んで作れる", async ({ page }) => {
    // Arrange
    await openModel(page);
    await create(page, "Aの中", "interconnection");
    await expect(page.locator("#dialogTitle")).toHaveText("図「Aの中」に描くブロック");
    // Act
    await page.locator('#dialogPick input[value="n:A"]').check();
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect.poll(() => editorText(page)).toContain("    view 'Aの中' : InterconnectionView {\n        expose P::A;\n    }\n");
    await expect.poll(() => nodeKeys(page)).toContain("u:b");
  });

  test("F-VIEW-8: 描く対象がモデルに無いときは、新しく作ってその図にする", async ({ page }) => {
    // Arrange
    await openModel(page);
    await create(page, "手順", "actionFlow");
    await expect(page.locator("#dialogPick input")).toHaveCount(1);
    // Act
    await expect(page.locator('#dialogButtons [data-id="ok"]')).toHaveText("作って作成");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect.poll(() => editorText(page)).toMatch(/action def (\w+)[\s\S]*view '手順' : ActionFlowView \{\n {8}expose P::\1;\n {4}\}/);
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/手順/);
  });

  test("F-VIEW-8: 対象を選ぶ画面でやめると、何も変えない", async ({ page }) => {
    // Arrange
    await openModel(page);
    await create(page, "やめる図", "stateTransition");
    // Act
    await page.locator('#dialogButtons [data-id="cancel"]').click();
    // Assert
    expect(await editorText(page)).toBe(MODEL);
  });
});

test.describe("サイドバーの「図」（F-VIEW-11）", () => {
  const WITH_VIEWS = "package P {\n    part def A;\n    part def B;\n    view overview : GeneralView {\n        expose P::A;\n    }\n    view other : GeneralView {\n        expose P::B;\n    }\n}\n";

  test("F-VIEW-11: 作成した図が並び、選ぶとその図が開く", async ({ page }) => {
    // Arrange
    await openModel(page, WITH_VIEWS);
    await showDiagrams(page);
    await expect(page.locator("#diagramList .ti .nm")).toHaveText(["overview", "other"]);
    // Act
    await page.locator('#diagramList [data-mv="other"]').click();
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/other/);
    await expect.poll(() => nodeKeys(page)).toEqual(["B"]);
    await expect(page.locator('#diagramList [data-mv="other"]')).toHaveClass(/sel/);
  });

  test("F-VIEW-11: 図が無いときは、作り方を案内する（境界値）", async ({ page }) => {
    // Arrange / Act
    await openModel(page);
    await showDiagrams(page);
    // Assert
    await expect(page.locator("#diagramList")).toHaveText("作成した図はまだありません。上の「新しい図を作成…」で作れます");
  });

  test("F-VIEW-11: 名前を変えると、テキストの view の名前とタブが変わり、要素の配置は保たれる", async ({ page }) => {
    // Arrange
    await openModel(page, WITH_VIEWS);
    await showDiagrams(page);
    await page.locator('#diagramList [data-mv="overview"]').click();
    const before = await page.locator('#gNodes .node[data-key="A"]').boundingBox();
    // Act
    await page.locator('#diagramList [data-mv="overview"]').click({ button: "right" });
    await page.locator('#ctx button:has-text("名前を変更")').click();
    await page.locator("#dialogInput").fill("全体の図");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect.poll(() => editorText(page)).toContain("    view '全体の図' : GeneralView {\n        expose P::A;\n    }\n");
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/全体の図/);
    await expect(page.locator("#diagramList .ti .nm")).toHaveText(["全体の図", "other"]);
    await expect.poll(() => nodeKeys(page)).toEqual(["A"]);
    expect(await page.locator('#gNodes .node[data-key="A"]').boundingBox()).toEqual(before);
  });

  test("F-VIEW-11: 既にある図の名前には変えられない（異常系）", async ({ page }) => {
    // Arrange
    await openModel(page, WITH_VIEWS);
    await showDiagrams(page);
    // Act
    await page.locator('#diagramList [data-mv="overview"]').hover();
    await page.locator('#diagramList [data-rename-mv="overview"]').click();
    await page.locator("#dialogInput").fill("other");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect(page.locator("#toast")).toHaveText("「other」という図は既にあります。別の名前にしてください");
    expect(await editorText(page)).toBe(WITH_VIEWS);
  });

  test("F-VIEW-11: 削除すると確認を取り、図とタブは消え、モデルの要素は残る", async ({ page }) => {
    // Arrange
    await openModel(page, WITH_VIEWS);
    await showDiagrams(page);
    await page.locator('#diagramList [data-mv="overview"]').click();
    // Act
    await page.locator('#diagramList [data-delete-mv="overview"]').click();
    await expect(page.locator("#dialogText")).toHaveText("図「overview」を削除しますか。図に出していた要素は、モデルに残ります。");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect.poll(() => editorText(page)).not.toContain("view overview");
    const text = await editorText(page);
    expect(text).toContain("    part def A;\n");
    await expect(page.locator(".tab", { hasText: "overview" })).toHaveCount(0);
    await expect(page.locator("#diagramList .ti .nm")).toHaveText(["other"]);
  });

  test("F-VIEW-11: モデルのツリーの右クリックからも、図の名前を変えられる", async ({ page }) => {
    // Arrange
    await openModel(page, WITH_VIEWS);
    await page.locator("#sideModel").click();
    // Act
    await page.locator("#tree .ti", { hasText: "other" }).click({ button: "right" });
    await page.locator('#ctx button:has-text("図の名前を変更")').click();
    await page.locator("#dialogInput").fill("その他");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect.poll(() => editorText(page)).toContain("    view 'その他' : GeneralView {\n");
  });
});
