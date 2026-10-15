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

  test("F-EDIT-5: 「}」の前で「;」を書き忘れた宣言も、構文エラーとして行番号付きで示す（Rust のパーサ、ADR-0015）", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator("#ed").fill("package P {\n    part def A {\n        part b : A\n    }\n}\n");
    // Assert
    const problem = page.locator('#problems button:has-text("「;」がありません")');
    await expect(problem).toContainText("3 行目");
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

test.describe("保存された図（テキストの view、F-VIEW-7、ADR-0005）", () => {
  const MODEL = `package P {
    part def Engine;
    part def Wheel;
    part def Car { part e : Engine; part w : Wheel; connect e to w; }
    requirement def Speed;
    view structure : GeneralView { expose P::*; filter @SysML::PartDefinition; }
    view reqs { expose P::Speed; }
    view inside : InterconnectionView { expose P::Car; }
}
`;
  /** モデルを書き、＋メニューの「テキストの view」から view を開く。 */
  async function openView(page: import("@playwright/test").Page, name: string): Promise<void> {
    await openApp(page);
    await page.locator("#ed").fill(MODEL);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    await page.locator(".tabadd summary").click();
    await page.locator(`[data-open-mv="${name}"]`).click();
  }

  test("F-VIEW-7: ＋メニューから view を開くと、expose と filter に当たる要素だけを描く", async ({ page }) => {
    // Arrange・Act
    await openView(page, "structure");
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["Car", "Engine", "Wheel"]);
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/structure/);
    await expect(page.locator("#subbar")).toContainText("保存された図「structure」：一般の図");
  });

  test("F-VIEW-7: InterconnectionView は、expose した part def の内部ブロック図として描く", async ({ page }) => {
    // Arrange・Act
    await openView(page, "inside");
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["u:e", "u:w"]);
    await expect(page.locator("#subbar")).toContainText("（Car）");
  });

  test("F-VIEW-7: テキストで expose を書き換えると、開いている図も変わる", async ({ page }) => {
    // Arrange
    await openView(page, "reqs");
    await expect.poll(() => nodeKeys(page)).toEqual(["Speed"]);
    // Act
    await page.locator("#ed").fill(MODEL.replace("expose P::Speed;", "expose P::Speed; expose P::Engine;"));
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["Engine", "Speed"]);
  });

  test("F-VIEW-7: view をテキストから消すと、図は空になり理由を示す（異常系）", async ({ page }) => {
    // Arrange
    await openView(page, "reqs");
    // Act
    await page.locator("#ed").fill(MODEL.replace("view reqs { expose P::Speed; }", ""));
    // Assert
    await expect(page.locator("#empty")).toContainText("保存された図「reqs」は、モデルから消えています");
  });

  test("F-VIEW-7: 保存された図が無いときは、＋メニューでそう示す（境界値）", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator(".tabadd summary").click();
    // Assert
    await expect(page.locator(".tabadd .pnote")).toHaveText("保存された図はまだありません");
  });
});

test.describe("画面から図を作る（F-VIEW-8、ADR-0005）", () => {
  const MODEL = "package P {\n    part def A;\n    part def B;\n}\n";

  /** モデルを書き、「すべて」の図を開く。 */
  async function openAll(page: import("@playwright/test").Page, text = MODEL): Promise<void> {
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="all"]').click();
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["A", "B"]);
  }

  /** 「図を保存」で、名前を付けて保存する。 */
  async function saveView(page: import("@playwright/test").Page, name: string): Promise<void> {
    await page.locator("#btnSaveView").click();
    await page.locator("#dialogInput").fill(name);
    await page.locator('#dialogButtons [data-id="ok"]').click();
  }

  /** 要素を右クリックして、メニューの項目を選ぶ。 */
  async function ctxItem(page: import("@playwright/test").Page, key: string, label: string): Promise<void> {
    await page.locator(`#gNodes .node[data-key="${key}"]`).click({ button: "right" });
    await page.locator(`#ctx button:has-text("${label}")`).click();
  }

  test("F-VIEW-8: 図を保存すると、見えている要素のまま保存された図になり、そのタブが開く", async ({ page }) => {
    // Arrange
    await openAll(page);
    // Act
    await saveView(page, "overview");
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/overview/);
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["A", "B"]);
    const text = await editorText(page);
    expect(text).toContain("    view overview : GeneralView {\n        expose P::A;\n        expose P::B;\n    }\n");
    await expect(page.locator("#btnSaveView")).toBeHidden();
  });

  test("F-VIEW-8: 日本語の名前でも保存できる（引用名で書く）", async ({ page }) => {
    // Arrange
    await openAll(page);
    // Act
    await saveView(page, "全体の図");
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/全体の図/);
    expect(await editorText(page)).toContain("view '全体の図' : GeneralView {");
  });

  test("F-VIEW-8: 保存された図にパレットから置いた要素は、モデルに作られ、その図にも入る", async ({ page }) => {
    // Arrange
    await openAll(page);
    await saveView(page, "v");
    await page.locator('#palette [data-tool="part def"]').click();
    const box = (await page.locator("#wrap").boundingBox())!;
    // Act
    await page.mouse.click(box.x + 150, box.y + box.height - 150);
    await page.locator('[data-act="renameCancel"]').click();
    // Assert
    const text = await editorText(page);
    expect(text).toContain("part def NewPart {");
    expect(text).toContain("expose P::NewPart;");
    await expect.poll(() => nodeKeys(page)).toContain("NewPart");
  });

  test("F-VIEW-8: 図から外すと図には出なくなるが、モデルには残る。ツリーの「追加」で戻せる", async ({ page }) => {
    // Arrange
    await openAll(page);
    await saveView(page, "v");
    // Act
    await ctxItem(page, "A", "この図から外す");
    const removed = await editorText(page);
    await page.locator("#sideModel").click();
    const row = page.locator("#tree .ti", { has: page.locator(".nm", { hasText: /^A$/ }) });
    await row.hover(); // 行の操作ボタンは、マウスを乗せると出る
    await row.locator("[data-add]").click();
    // Assert
    expect(removed).not.toContain("expose P::A;");
    expect(removed).toContain("part def A;");
    await expect.poll(() => nodeKeys(page)).toContain("A");
    expect(await editorText(page)).toContain("expose P::A;");
  });

  test("F-VIEW-8: まとめて入れた要素は 1 つだけ外せないと伝え、テキストを変えない（異常系）", async ({ page }) => {
    // Arrange
    const text = MODEL.replace("}\n", "    view v { expose P::*; }\n}\n");
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="v"]').click();
    // Act
    await ctxItem(page, "A", "この図から外す");
    // Assert
    await expect(page.locator("#toast")).toContainText("1 つだけ外すことはできません");
    expect(await editorText(page)).toBe(text);
  });

  test("F-VIEW-8: 保存された図の右クリックでは「この図から外す」と「モデルから削除」を分けて示す", async ({ page }) => {
    // Arrange
    await openAll(page);
    await saveView(page, "v");
    // Act
    await page.locator('#gNodes .node[data-key="B"]').click({ button: "right" });
    // Assert
    await expect(page.locator("#ctx button")).toContainText(["この図から外す", "モデルから削除"]);
  });
});
