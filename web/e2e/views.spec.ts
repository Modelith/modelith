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
    await page.locator("#ed").fill("package P {\n    part def A;\n    until s;\n}\n");
    // Assert
    const info = page.locator("#problems button.unsupported");
    await expect(info).toContainText("3 行目");
    await expect(info).toContainText("「until s」は Modelith ではまだ扱えない");
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

  test("F-VIEW-7: GeneralView に、特殊化・依存の線と部品の多重度を SysML の記法で描く", async ({ page }) => {
    // Arrange
    const text = `package G {
    part def Vehicle;
    part def Wheel;
    part def Car :> Vehicle { part wheels : Wheel[4]; }
    dependency Wheel to Vehicle;
    view gv : GeneralView { expose G::*; }
}
`;
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    // Act
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="gv"]').click();
    // Assert（特殊化は白抜きの三角、依存は破線と開いた矢印、多重度は部品の側の端）
    await expect(page.locator('[data-edge="specialize|Car|Vehicle|#1"] path.line')).toHaveAttribute("marker-end", "url(#mTri)");
    await expect(page.locator('[data-edge="dependency|Wheel|Vehicle|#1"] path.line')).toHaveAttribute("stroke-dasharray", "6 4");
    await expect(page.locator('[data-edge="comp|Car|Wheel|wheels#1"] text.end')).toHaveText("[4]");
  });

  test("F-VIEW-7: InterconnectionView に、結び付け・3 つ以上をつなぐ接続・部品の中の部品を SysML の記法で描く", async ({ page }) => {
    // Arrange
    const text = `package W {
    port def Sig;
    part def Impeller { port shaft : Sig; }
    part def Pump { port pin : Sig; port rpm : Sig; part impeller : Impeller; connect pin to impeller.shaft; }
    part def Motor { port pout : Sig; port rpm : Sig; }
    part def Sensor { port sig : Sig; }
    part def Plant {
        part pump : Pump;
        part motor : Motor;
        part sensor : Sensor;
        connect motor.pout to pump.impeller.shaft;
        bind motor.rpm = pump.rpm;
        connect (pump.pin, motor.pout, sensor.sig);
    }
    view iv : InterconnectionView { expose W::Plant; }
}
`;
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    // Act
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="iv"]').click();
    // Assert（部品の中の部品・3 つ以上をつなぐ接続の点・結び付けは矢印の無い線と「=」・部品の中へ届く接続）
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["j:#1", "u:motor", "u:pump", "u:pump.impeller", "u:sensor"]);
    await expect(page.locator('[data-key="j:#1"] circle')).toBeVisible();
    await expect(page.locator('[data-edge="connect|j:#1|u:sensor|#1"]')).toHaveCount(1);
    await expect(page.locator('[data-edge="bind|u:motor|u:pump|=#1"] path.line')).not.toHaveAttribute("marker-end", /./);
    await expect(page.locator('[data-edge="bind|u:motor|u:pump|=#1"] text')).toHaveText("=");
    await expect(page.locator('[data-edge="flow|u:motor|u:pump.impeller|#1"]')).toHaveCount(1);
    await expect(page.locator('[data-edge="flow|u:pump|u:pump.impeller|#1"]')).toHaveCount(1);
  });

  test("F-VIEW-7: GeneralView に、割り当ての線を «allocate» の破線と開いた矢印で描く", async ({ page }) => {
    // Arrange
    const text = `package A {
    part def Pumping;
    part def PumpUnit;
    allocation def FunctionToPart;
    allocation a : FunctionToPart allocate Pumping to PumpUnit;
    view gv : GeneralView { expose A::*; }
}
`;
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    // Act
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="gv"]').click();
    // Assert
    const line = page.locator('[data-edge="allocate|Pumping|PumpUnit|«allocate» a#1"]');
    await expect(line.locator("path.line")).toHaveAttribute("stroke-dasharray", "6 4");
    await expect(line.locator("path.line")).toHaveAttribute("marker-end", "url(#mOpen)");
    await expect(line.locator("text")).toHaveText("«allocate» a");
  });

  test("F-VIEW-7: GeneralView に、要素に付けたメモを角を折った四角と破線で描き、インスペクタに本文を出す", async ({ page }) => {
    // Arrange
    const text = `package G {
    part def Pump {
        attribute rate : Real := 2;
        rep inOCL language "OCL" /* self.rate > 0 */
    }
    part def Tank;
    comment safety about Pump, Tank /* 空のタンクでポンプを回さない */
    view gv : GeneralView { expose G::*; }
}
`;
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="gv"]').click();
    // Act
    await page.locator('#gNodes [data-key="note:safety"]').click();
    // Assert（メモは 2 つの要素へ矢印の無い破線を引き、インスペクタに相手と本文を出す）
    await expect(page.locator('[data-edge="annotate|note:safety|Pump"] path.line')).toHaveAttribute("stroke-dasharray", "6 4");
    await expect(page.locator('[data-edge="annotate|note:safety|Tank"] path.line')).not.toHaveAttribute("marker-end", /.+/);
    await expect(page.locator("#insp")).toContainText("メモを付ける相手Pump、Tank");
    await expect(page.locator("#insp")).toContainText("空のタンクでポンプを回さない");
    // Act（メモを付けた要素を選ぶ）
    await page.locator('#gNodes [data-key="Pump"]').click();
    // Assert（要素のインスペクタにも、メモと別の言語での表し方を出す。初期値は := のまま区画に書く）
    await expect(page.locator("#insp .notes")).toContainText("空のタンクでポンプを回さない");
    await expect(page.locator("#insp .notes")).toContainText("別の言語での表し方（OCL）・inOCL");
    await expect(page.locator('#gNodes [data-key="Pump"]')).toContainText("rate := 2");
  });

  test("F-VIEW-7: メモを図から削除すると、テキストからコメントが消え、注釈した要素は残る", async ({ page }) => {
    // Arrange
    const text = `package G {
    part def Pump;
    comment about Pump /* 点検を年に 1 回 */
    view gv : GeneralView { expose G::*; }
}
`;
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="gv"]').click();
    await page.locator('#gNodes [data-key="note:#1"]').click();
    // Act（2 回押しで削除）
    await page.locator('#insp [data-act="del"]').click();
    await page.locator('#insp [data-act="del"]').click();
    // Assert
    await expect(page.locator("#ed")).not.toHaveValue(/点検を年に 1 回/);
    await expect(page.locator("#ed")).toHaveValue(/part def Pump;/);
    await expect(page.locator('#gNodes [data-key="note:#1"]')).toHaveCount(0);
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

  test("F-VIEW-9: package そのものを出すと、名前を書いた枠の中に中の要素を描く", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill("package P {\n    part def Outside;\n    package Drive { part def Motor; part def Gear; }\n    view drive { expose P::Drive; }\n}\n");
    await page.waitForTimeout(400);
    // Act
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="drive"]').click();
    // Assert（枠の中に Motor と Gear。package の外の Outside は出さない）
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["Gear", "Motor"]);
    const frame = page.locator('#gEdges .pkg[data-pkg="Drive"], #canvas .pkg[data-pkg="Drive"]').first();
    await expect(frame).toContainText("Drive");
    const fb = (await frame.boundingBox())!;
    for (const key of ["Motor", "Gear"]) {
      const nb = (await page.locator(`#gNodes .node[data-key="${key}"]`).boundingBox())!;
      expect(nb.x >= fb.x && nb.y >= fb.y && nb.x + nb.width <= fb.x + fb.width && nb.y + nb.height <= fb.y + fb.height).toBe(true);
    }
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
    // 図の操作はコア（Worker）が返したテキストの編集を当てるので、反映を待ってから読む
    await expect.poll(() => editorText(page)).not.toContain("expose P::A;");
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
