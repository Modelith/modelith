// ビュー・ツリー・テキストとの同期・トレーサビリティ（F-VIEW-*・F-EDIT-1・5・F-TRACE-*）
import { editorText, expect, nodeKeys, openApp, putFiles, readFile, test } from "./fixtures";

test.describe("ビュー", () => {
  const cases: [string, string][] = [
    ["trace", "BoilTimeReq"],
    ["structure", "Kettle"],
    ["control", "HeaterController"],
    ["ibd", "u:controller"],
    ["behavior", "KettleStates"],
    ["seq", "l:controller"],
    ["afv", "a:readSensor"],
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
    await expect(page.locator('.tab[aria-selected="true"]')).toContainText("ブロック定義図");
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

  test("F-VIEW-1・Q-4: ＋メニューの項目のツールチップに、当たる SysML v2 の標準ビューを添える", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator(".tabadd summary").click();
    // Assert
    await expect(page.locator('[data-open="afv"]')).toHaveAttribute("title", "アクティビティ図（SysML v2 では ActionFlowView）");
    await expect(page.locator('[data-open="trace"]')).toHaveAttribute("title", "トレーサビリティ（SysML v2 では GeneralView で描く図）");
  });

  test("F-VIEW-1・Q-4: 広い画面では、＋メニューの項目の下に SysML v2 の名前の行を出さない（ツールチップで示す）", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator(".tabadd summary").click();
    // Assert
    await expect(page.locator('[data-open="afv"] small')).toBeHidden();
  });

  test.describe("狭い画面", () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test("F-VIEW-1・Q-2・Q-4: 幅 390px の画面では、＋メニューの項目の下に SysML v2 の名前を小さく出す", async ({ page }) => {
      // Arrange（ツールチップが出ないので、名前の下の行で示す）
      await openApp(page);
      // Act
      await page.locator(".tabadd summary").click();
      // Assert
      await expect(page.locator('[data-open="afv"] small')).toBeVisible();
      await expect(page.locator('[data-open="afv"] small')).toHaveText("SysML v2 では ActionFlowView");
    });
  });

  test("F-VIEW-2・Q-4: タブのツールチップに、図の種類と SysML v2 の標準ビューを出す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator(".tabadd summary").click();
    // Act
    await page.locator('[data-open="structure"]').click();
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveAttribute("title", "ブロック定義図（SysML v2 では GeneralView で描く図）");
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
});

test.describe("トレースの抜けの案内（F-TRACE-2）", () => {
  // 抜けが 4 件のモデル：利用者要求 SupplyNeed は展開されておらず、システム要求 FlowReq は導出元・満たす部品・検証が無い
  const GAPS = `package Water {
    metadata def Phase { attribute stage : PhaseKind; }
    enum def PhaseKind { enum StakeholderNeeds; enum SystemRequirements; enum Architecture; enum Verification; }
    package Needs {
        @Phase { stage = PhaseKind::StakeholderNeeds; }
        requirement def SupplyNeed;
    }
    package Reqs {
        @Phase { stage = PhaseKind::SystemRequirements; }
        requirement def FlowReq;
    }
    package Design {
        @Phase { stage = PhaseKind::Architecture; }
        part def Pump;
    }
    package Tests {
        @Phase { stage = PhaseKind::Verification; }
        verification def FlowTest;
    }
}
`;
  const guide = (page: import("@playwright/test").Page) => page.locator("#insp .gapguide");

  /**
   * 要素の箱の中心と、図のうちインスペクタと全体図に隠れていない所の中央とのずれ（px）。
   * 箱がその所からはみ出していれば Infinity。
   */
  async function offCenter(page: import("@playwright/test").Page, key: string): Promise<number> {
    const box = await page.locator(`#gNodes [data-key="${key}"] .body`).boundingBox();
    const wrap = await page.locator("#wrap").boundingBox();
    const insp = await page.locator("#insp").boundingBox();
    const mini = await page.locator("#mini").boundingBox();
    if (!box || !wrap || !insp || !mini) return Infinity;
    const bottom = Math.min(insp.y, mini.y);
    if (box.y < wrap.y || box.y + box.height > bottom) return Infinity;
    return Math.hypot(box.x + box.width / 2 - (wrap.x + wrap.width / 2), box.y + box.height / 2 - (wrap.y + bottom) / 2);
  }

  test("F-TRACE-2: 図で抜けの件数を押すと、図のまま抜けのある要素を選んで中央に出し、足りない関係の案内と「関係を追加」を示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    const gaps = page.locator("#btnGaps");
    await expect(gaps).toHaveText("トレースの抜け 1 件");
    // Act
    await gaps.click();
    // Assert
    await expect(guide(page)).toContainText("1 / 1 件目");
    await expect(guide(page)).toContainText("この要求を確かめる検証がありません");
    await expect(guide(page)).toContainText("「関係を追加」を押して、検証の要素を選ぶと解消します（verify）");
    await expect(guide(page).getByRole("button", { name: "関係を追加" })).toBeVisible();
    await expect(page.locator("#insp .what b")).toHaveText("DryBoilCutoffReq");
    await expect(page.locator("#main")).toHaveAttribute("data-tab", "diagram");
    await expect.poll(() => offCenter(page, "DryBoilCutoffReq")).toBeLessThan(4);
    await expect(page.locator("#hl mark.selr")).toContainText("DryBoilCutoffReq");
  });

  test("F-TRACE-2: 今の図に抜けのある要素が無ければ、その要素が載るトレーサビリティの図に切り替えて示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="structure"]').click();
    // Act
    await page.locator("#btnGaps").click();
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toContainText("トレーサビリティ");
    await expect(guide(page)).toContainText("この要求を確かめる検証がありません");
    await expect(page.locator('#gNodes [data-key="DryBoilCutoffReq"]')).toHaveCount(1);
  });

  test("F-TRACE-2: 案内の「関係を追加」から検証の要素を選んでつなぐと、抜けが解消する", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#btnGaps").click();
    await guide(page).getByRole("button", { name: "関係を追加" }).click();
    await expect(page.locator("#insp")).toContainText("検証の要素をタップしてください");
    // Act
    await page.locator("#zFit").click();
    await page.locator('#gNodes [data-key="BoilTest"]').click();
    await page.locator('#insp [data-rel="verify"]').click();
    // Assert
    await expect(page.locator("#subbar")).toContainText("トレースの抜けなし");
    await expect(page.locator("#ed")).toHaveValue(/objective \{ verify kettleRequirements\.k1; verify DryBoilCutoffReq; \}/);
    await expect(page.locator(".gapbadge")).toHaveCount(0);
    await expect(guide(page)).toContainText("トレースの抜けはすべて解消しました");
  });

  test("F-TRACE-2: 抜けが複数あれば何件目かを示し、‹ › で前後へ移る（両端で回る）", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill(GAPS);
    await expect(page.locator("#btnGaps")).toHaveText("トレースの抜け 4 件");
    await page.locator("#btnGaps").click();
    await expect(guide(page)).toContainText("1 / 4 件目");
    await expect(guide(page)).toContainText("この要求は、どの下位の要求にも展開されていません");
    // Act
    await page.getByRole("button", { name: "次の抜けへ" }).click();
    // Assert
    await expect(guide(page)).toContainText("2 / 4 件目");
    await expect(guide(page)).toContainText("この要求の導出元になる上位の要求がありません");
    await expect(page.locator("#insp .what b")).toHaveText("FlowReq");
    await page.getByRole("button", { name: "前の抜けへ" }).click();
    await page.getByRole("button", { name: "前の抜けへ" }).click();
    await expect(guide(page)).toContainText("4 / 4 件目");
    await expect(guide(page)).toContainText("この要求を確かめる検証がありません");
  });

  test("F-TRACE-2: 抜けのある要素の箱すべてに △ の印を付け、ツールチップに何が足りないかを書く", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator("#ed").fill(GAPS);
    // Assert
    await expect(page.locator(".gapbadge")).toHaveCount(2);
    await expect(page.locator('[data-key="FlowReq"] .gapbadge title')).toHaveText(
      "トレースの抜け：\nこの要求の導出元になる上位の要求がありません\nこの要求を満たす部品がありません\nこの要求を確かめる検証がありません",
    );
    await expect(page.locator('[data-key="Pump"] .gapbadge')).toHaveCount(0);
  });

  test("F-TRACE-2: 案内の「テキストで見る」で、隠していたテキストのパネルを開いてその行を示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#viewMenu summary").click();
    await page.locator("#togText").click();
    await expect(page.locator("#main")).toHaveAttribute("data-text", "off");
    await page.keyboard.press("Escape");
    await page.locator("#btnGaps").click();
    // Act
    await guide(page).getByRole("button", { name: "テキストで見る" }).click();
    // Assert
    await expect(page.locator("#main")).toHaveAttribute("data-text", "on");
    await expect(page.locator("#hl mark.selr")).toContainText("DryBoilCutoffReq");
  });

  test("F-TRACE-2: 問題一覧の抜けの行を押すと、図が見えていれば図の要素へ移り、テキストの行の印も付ける", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator("#problems button.gap").click();
    // Assert
    await expect(guide(page)).toContainText("この要求を確かめる検証がありません");
    await expect(page.locator("#insp .what b")).toHaveText("DryBoilCutoffReq");
    await expect(page.locator("#hl mark.selr")).toContainText("DryBoilCutoffReq");
  });

  test("F-TRACE-2: 問題一覧の抜けの文は、短い名前の無い要求の名前を 1 回だけ書く", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator("#ed").fill(GAPS);
    // Assert
    await expect(page.locator("#problems button.gap")).toHaveCount(4);
    await expect(page.locator("#problems button.gap", { hasText: "検証" })).toContainText("FlowReq：この要求を確かめる検証がありません（verify）");
    await expect(page.locator("#problems button.gap", { hasText: "FlowReq FlowReq" })).toHaveCount(0);
  });

  test("F-TRACE-2・Q-8: キーボードで抜けの件数を押すと案内へ入力が移り、› と「関係を追加」を操作できる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill(GAPS);
    await expect(page.locator("#btnGaps")).toHaveText("トレースの抜け 4 件");
    await page.locator("#btnGaps").focus();
    // Act
    await page.keyboard.press("Enter");
    // Assert
    await expect(guide(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "次の抜けへ" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(guide(page)).toContainText("2 / 4 件目");
    await expect(page.getByRole("button", { name: "次の抜けへ" })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#insp")).toContainText("上位の要求をタップしてください");
  });

  test.describe("幅 390px", () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test("F-TRACE-2・Q-2: 図のタブで抜けの件数を押すと、図のタブのまま要素を選んで案内を出す", async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await page.locator("#btnGaps").click();
      // Assert
      await expect(page.locator("#main")).toHaveAttribute("data-tab", "diagram");
      await expect(guide(page)).toContainText("この要求を確かめる検証がありません");
      await expect.poll(() => offCenter(page, "DryBoilCutoffReq")).toBeLessThan(4);
      const box = await guide(page).boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
      await guide(page).getByRole("button", { name: "テキストで見る" }).click();
      await expect(page.locator("#main")).toHaveAttribute("data-tab", "text");
    });

    test("F-TRACE-2・Q-2: テキストのタブで問題一覧の抜けの行を押すと、今までどおりテキストの行へ移る", async ({ page }) => {
      // Arrange
      await openApp(page);
      await page.locator("#tabText").click();
      const pos = Number(await page.locator("#problems button.gap").getAttribute("data-pos"));
      // Act
      await page.locator("#problems button.gap").click();
      // Assert
      await expect(page.locator("#main")).toHaveAttribute("data-tab", "text");
      expect(await page.locator("#ed").evaluate((e) => (e as HTMLTextAreaElement).selectionStart)).toBe(pos);
    });
  });
});

test.describe("作成した図（テキストの view、F-VIEW-7、ADR-0005）", () => {
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
    await expect(page.locator("#subbar")).toContainText("作成した図「structure」：一般ビュー");
  });

  test("F-VIEW-7: InterconnectionView は、expose した part def の内部ブロック図として描く", async ({ page }) => {
    // Arrange・Act
    await openView(page, "inside");
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["u:e", "u:w"]);
    await expect(page.locator("#subbar")).toContainText("（Car）");
  });

  test("F-VIEW-7・Q-4: 作成した図のサブバーとタブのツールチップに、SysML v2 の標準ビューを添える", async ({ page }) => {
    // Arrange・Act
    await openView(page, "inside");
    // Assert
    await expect(page.locator("#subbar .vkind")).toHaveAttribute("title", "内部ブロック図（SysML v2 では InterconnectionView）");
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveAttribute("title", "作成した図「inside」\n内部ブロック図（SysML v2 では InterconnectionView）");
  });

  test("F-VIEW-7・Q-4: 型の無い view は、＋メニューのツールチップで一般ビュー（GeneralView）と示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill(MODEL);
    await page.waitForTimeout(400); // 入力の反映でタブのメニューが描き直されるので、反映を待ってから開く
    // Act
    await page.locator(".tabadd summary").click();
    // Assert
    await expect(page.locator('[data-open-mv="reqs"]')).toHaveAttribute("title", "一般ビュー（SysML v2 では GeneralView）");
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
    await expect(page.locator("#empty")).toContainText("作成した図「reqs」は、モデルから消えています");
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

  test("F-VIEW-7: 作成した図が無いときは、＋メニューでそう示す（境界値）", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await page.locator(".tabadd summary").click();
    // Assert
    await expect(page.locator(".tabadd .pnote")).toHaveText("作成した図はまだありません。図のメニューの「新しい図を作成…」で作れます");
  });
});

test.describe("アクティビティ図（ActionFlowView、F-VIEW-7、8.2.3.17）", () => {
  const FLOW = `package Kettle {
    item def Water;
    action def Boil {
        first start;
        then action fill;
        then fork split;
        then heat;
        then warmCup;
        action heat;
        action warmCup;
        first heat then ready;
        first warmCup then ready;
        join ready;
        then decide check;
        if temperature >= 100 then notify;
        else heat;
        action notify send Done() to user;
        then done;
        succession flow of Water from fill to heat;
    }
    view boilFlow : ActionFlowView { expose Kettle::Boil; }
}
`;
  /** モデルを書き、＋メニューの「作成した図」からアクティビティ図を開く。 */
  async function openFlow(page: import("@playwright/test").Page): Promise<void> {
    await openApp(page);
    await page.locator("#ed").fill(FLOW);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="boilFlow"]').click();
  }

  test("F-VIEW-7: ActionFlowView は、expose した action def をアクティビティ図として SysML の記号で描き、「まだ扱えない」と知らせない", async ({ page }) => {
    // Arrange・Act
    await openFlow(page);
    // Assert（開始は塗った丸、fork は棒、decide はひし形、送信は五角形。ガードは [ ] のラベル、順序付きの流れは破線）
    await expect
      .poll(async () => (await nodeKeys(page)).sort())
      .toEqual(["a:check", "a:done", "a:fill", "a:heat", "a:notify", "a:ready", "a:split", "a:start", "a:warmCup"]);
    await expect(page.locator('[data-key="a:start"] circle.body')).toBeVisible();
    await expect(page.locator('[data-key="a:split"] rect.body')).toHaveAttribute("height", "8");
    await expect(page.locator('[data-key="a:check"] path.body')).toHaveAttribute("d", "M17,0 L34,17 L17,34 L0,17 Z");
    await expect(page.locator('[data-key="a:notify"]')).toContainText("«send»");
    const guarded = page.locator('[data-edge="succession|a:check|a:notify|[temperature >= 100]#1"]');
    await expect(guarded.locator("path.line")).toHaveAttribute("marker-end", "url(#mOpen)");
    await expect(guarded.locator("path.line")).not.toHaveAttribute("stroke-dasharray", /./);
    await expect(guarded.locator("text")).toHaveText("[temperature >= 100]");
    await expect(page.locator('[data-edge="successionFlow|a:fill|a:heat|Water#1"] path.line')).toHaveAttribute("stroke-dasharray", "6 4");
    await expect(page.locator("#subbar")).toContainText("作成した図「boilFlow」：アクティビティ図（Boil）");
    await expect(page.locator("#problems button.unsupported")).toHaveCount(0);
  });

  test("F-VIEW-1: action def をツリーから開くと、アクティビティ図のタブになる", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill(FLOW);
    await page.waitForTimeout(400);
    await page.locator("#sideModel").click();
    await page.locator("#treeSearch").fill("Boil");
    // Act
    const row = page.locator('#tree .ti:has([title="アクティビティ図で開く"])');
    await row.hover();
    await row.locator('[title="アクティビティ図で開く"]').click();
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/act Boil/);
    await expect.poll(() => nodeKeys(page)).toContain("a:notify");
  });

  test("F-VIEW-7: 順序の線を図から削除すると、テキストからその文だけが消える", async ({ page }) => {
    // Arrange
    await openFlow(page);
    await page.locator('[data-edge="succession|a:check|a:notify|[temperature >= 100]#1"] path.hit').click({ force: true });
    // Act（2 回押しで削除）
    await page.locator('#insp [data-act="delEdge"]').click();
    await page.locator('#insp [data-act="delEdge"]').click();
    // Assert
    await expect(page.locator("#ed")).not.toHaveValue(/if temperature >= 100 then notify;/);
    await expect(page.locator("#ed")).toHaveValue(/else heat;\n        action notify send/);
    await expect(page.locator('[data-edge^="succession|a:check|a:notify|"]')).toHaveCount(0);
  });

  test("F-VIEW-7: 2 つのアクションの間に線を引くと、順序（first … then）をテキストに書く", async ({ page }) => {
    // Arrange（開いたときは文字が読める大きさで上から見せるので、「全体」で図全体を表示してから線を引く）
    await openFlow(page);
    await page.locator("#zFit").click();
    await page.locator('#gNodes [data-key="a:warmCup"]').click();
    await page.locator('#insp [data-act="connect"]').click();
    // Act
    await page.locator('#gNodes [data-key="a:notify"]').click();
    await page.locator('#insp [data-rel="succession"]').click();
    // Assert
    await expect(page.locator("#ed")).toHaveValue(/succession flow of Water from fill to heat;\n        first warmCup then notify;\n    }/);
    await expect(page.locator('[data-edge="succession|a:warmCup|a:notify|#1"]')).toHaveCount(1);
  });

  test("F-VIEW-3: アクティビティ図で要素を動かして保存すると、アクション定義ごとの配置として配置ファイルに書く", async ({ page }) => {
    // Arrange
    await openApp(page);
    await putFiles(page, { "a.sysml": FLOW });
    await page.locator('[data-cmd="openFolder"]').click();
    await page.locator('#explorer [data-file][title="a.sysml"]').click();
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="afv"]').click();
    const b = (await page.locator('#gNodes [data-key="a:fill"]').boundingBox())!;
    // Act
    await page.mouse.move(b.x + 40, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 240, b.y + 70, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press("Control+s");
    // Assert
    await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"afv:Boil": \{[\s\S]*"a:fill": \[/);
    expect(await readFile(page, "a.sysml")).toBe(FLOW);
  });
});

test.describe("状態遷移図（StateTransitionView、F-VIEW-7、8.2.3.18）", () => {
  const LAMP = `package Lamp {
    state def LampStates {
        entry; then off;
        state off;
        accept PowerOn then on;
        state on parallel {
            state light {
                entry; then dim;
                state dim { entry action fadeIn; }
                accept Brighter then bright;
                state bright { do glow; exit action fadeOut; }
                accept Dimmer if level > 1 then dim;
            }
            state fan;
        }
        transition switchOff first on accept PowerOff do beep then off;
        transition first off accept Unplug then done;
    }
    view lampStates : StateTransitionView { expose Lamp::LampStates; }
}
`;
  /** モデルを書き、＋メニューの「作成した図」から状態遷移図を開く。 */
  async function openStates(page: import("@playwright/test").Page): Promise<void> {
    await openApp(page);
    await page.locator("#ed").fill(LAMP);
    await page.waitForTimeout(400); // 入力の反映（0.28 秒）を待つ。反映でタブのメニューが描き直されるため
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="lampStates"]').click();
    await page.locator("#zFit").click();
  }

  test("F-VIEW-7: StateTransitionView は、expose した state def を状態と遷移の図として 8.2.3.18 の記号で描き、「まだ扱えない」と知らせない", async ({ page }) => {
    // Arrange・Act
    await openStates(page);
    // Assert（開始は塗った丸、終了は丸の中の塗った丸、状態は角の丸い四角、入れ子の状態は外の状態の中、並行の領域は破線で区切る）
    await expect
      .poll(async () => (await nodeKeys(page)).sort())
      .toEqual(["s:#done", "s:#start", "s:off", "s:on", "s:on.fan", "s:on.light", "s:on.light#start", "s:on.light.bright", "s:on.light.dim"]);
    await expect(page.locator('[data-key="s:#start"] circle.body')).toBeVisible();
    await expect(page.locator('[data-key="s:#done"] circle')).toHaveCount(2);
    await expect(page.locator('[data-key="s:off"] rect.body')).toHaveAttribute("rx", "14");
    await expect(page.locator('[data-key="s:on.light.bright"]')).toContainText("exit / fadeOut");
    await expect(page.locator("#canvas line.region")).toHaveCount(1);
    const labelled = page.locator('[data-edge="transition|s:on|s:off|PowerOff / beep#1"]');
    await expect(labelled.locator("path.line")).toHaveAttribute("marker-end", "url(#mOpen)");
    await expect(labelled.locator("text")).toHaveText("PowerOff / beep");
    await expect(page.locator('[data-edge="transition|s:on.light.bright|s:on.light.dim|Dimmer [level > 1]#1"] text')).toHaveText("Dimmer [level > 1]");
    await expect(page.locator("#subbar")).toContainText("作成した図「lampStates」：状態遷移図（LampStates）");
    await expect(page.locator("#problems button.unsupported")).toHaveCount(0);
  });

  test("F-VIEW-1: state def をツリーから開くと状態遷移図のタブになり、＋メニューの組み込みのビューは 8 つのまま", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#sideModel").click();
    await page.locator("#treeSearch").fill("KettleStates");
    // Act
    const row = page.locator('#tree .ti:has([title="状態遷移図で開く"])').first();
    await row.hover();
    await row.locator('[title="状態遷移図で開く"]').click();
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/stm KettleStates/);
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["s:#start", "s:fault", "s:heating", "s:idle", "s:keepWarm"]);
    await page.locator(".tabadd summary").click();
    await expect(page.locator(".tabadd [data-open]")).toHaveCount(8);
    await expect(page.locator('.tabadd [data-open="stm"]')).toHaveCount(0);
  });

  test("F-VIEW-7: 遷移を図から削除すると、テキストからその文だけが消える", async ({ page }) => {
    // Arrange
    await openStates(page);
    // 線の曲がり角の内側（矩形の中央）は線の上ではないので、ラベルを押して選ぶ
    await page.locator('[data-edge="transition|s:off|s:on|PowerOn#1"] text').click();
    // Act（2 回押しで削除）
    await page.locator('#insp [data-act="delEdge"]').click();
    await page.locator('#insp [data-act="delEdge"]').click();
    // Assert
    await expect(page.locator("#ed")).not.toHaveValue(/accept PowerOn then on;/);
    await expect(page.locator("#ed")).toHaveValue(/state off;\n        state on parallel \{/);
    await expect(page.locator('[data-edge^="transition|s:off|s:on|"]')).toHaveCount(0);
  });

  test("F-VIEW-7: 2 つの状態の間に線を引くと、遷移（transition first … then）をテキストに書く", async ({ page }) => {
    // Arrange
    await openStates(page);
    await page.locator('#gNodes [data-key="s:on.light.dim"]').click();
    await expect(page.locator("#insp")).toContainText("entry / fadeIn");
    await page.locator('#insp [data-act="connect"]').click();
    // Act
    await page.locator('#gNodes [data-key="s:on.light.bright"]').click();
    await page.locator('#insp [data-rel="transition"]').click();
    // Assert
    await expect(page.locator("#ed")).toHaveValue(/accept Dimmer if level > 1 then dim;\n                transition first dim then bright;\n            \}/);
    await expect(page.locator('[data-edge="transition|s:on.light.dim|s:on.light.bright|#1"]')).toHaveCount(1);
  });

  test("F-VIEW-3: 状態遷移図で状態を動かして保存すると、状態定義ごとの配置として配置ファイルに書く", async ({ page }) => {
    // Arrange
    await openApp(page);
    await putFiles(page, { "a.sysml": LAMP });
    await page.locator('[data-cmd="openFolder"]').click();
    await page.locator('#explorer [data-file][title="a.sysml"]').click();
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="lampStates"]').click();
    const b = (await page.locator('#gNodes [data-key="s:off"]').boundingBox())!;
    // Act
    await page.mouse.move(b.x + 20, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + 120, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press("Control+s");
    // Assert
    await expect.poll(() => readFile(page, "a.layout.json")).toMatch(/"stm:LampStates": \{[\s\S]*"s:off": \[/);
    expect(await readFile(page, "a.sysml")).toBe(LAMP);
  });

  test("F-VIEW-8: 「振る舞い」の図から新しい図を作成すると、並べた要素のまま一般ビュー（GeneralView）として書く", async ({ page }) => {
    // Arrange
    await openApp(page);
    await page.locator("#ed").fill(LAMP);
    await page.waitForTimeout(400);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open="behavior"]').click();
    // Act
    await page.locator("#btnSaveView").click();
    await page.locator("#dialogInput").fill("behaviour");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    await expect.poll(() => editorText(page)).toContain("    view behaviour : GeneralView {\n        expose Lamp::LampStates;\n    }\n");
    await expect.poll(() => nodeKeys(page)).toContain("LampStates");
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

  /** 「新しい図を作成」で、名前を付けて図を作成する。 */
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

  test("F-VIEW-8: 新しい図を作成すると、見えている要素のまま作成した図になり、そのタブが開く", async ({ page }) => {
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

  test("F-VIEW-8: 図のメニューの「新しい図を作成…」で作成した図は、＋メニューの「作成した図」に並び、自動で描く図と見分けられる", async ({ page }) => {
    // Arrange
    await openAll(page);
    await page.locator("#diagramMenu > summary").click();
    await expect(page.locator("#menuSaveView")).toHaveText("新しい図を作成…");
    await page.locator("#menuSaveView").click();
    await expect(page.locator("#dialogTitle")).toHaveText("新しい図を作成");
    await page.locator("#dialogInput").fill("overview");
    // Act
    await page.locator('#dialogButtons [data-id="ok"]', { hasText: "作成" }).click();
    // Assert
    await expect(page.locator("#toast")).toHaveText("図「overview」を作成しました。＋メニューの「作成した図」からいつでも開けます");
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveAttribute("title", /^作成した図「overview」/);
    await page.locator(".tabadd summary").click();
    await expect(page.locator(".tabadd .phead")).toHaveText(["自動で描く図", "作成した図"]);
    await expect(page.locator('.tabadd [data-open-mv="overview"]')).toBeVisible();
  });

  test("F-VIEW-8: 日本語の名前でも作成できる（引用名で書く）", async ({ page }) => {
    // Arrange
    await openAll(page);
    // Act
    await saveView(page, "全体の図");
    // Assert
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveText(/全体の図/);
    expect(await editorText(page)).toContain("view '全体の図' : GeneralView {");
  });

  test("F-VIEW-8: 作成した図にパレットから置いた要素は、モデルに作られ、その図にも入る", async ({ page }) => {
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

  test("F-VIEW-8: 作成した図の右クリックでは「この図から外す」と「モデルから削除」を分けて示す", async ({ page }) => {
    // Arrange
    await openAll(page);
    await saveView(page, "v");
    // Act
    await page.locator('#gNodes .node[data-key="B"]').click({ button: "right" });
    // Assert
    await expect(page.locator("#ctx button")).toContainText(["この図から外す", "モデルから削除"]);
  });
});

test.describe("シーケンス図のイベントと順序・ビューの式・3 段の連鎖（F-VIEW-10・F-VIEW-7）", () => {
  const BOIL =
    "package Kettle {\n    part def User;\n    part def Panel;\n    part def Heater;\n" +
    "    occurrence def BoilWater {\n        part user : User { event occurrence press; }\n" +
    "        part panel : Panel {\n            event occurrence pressed;\n            then event occurrence lampOn;\n            part lamp { event occurrence lit; }\n        }\n" +
    "        part heater : Heater { event occurrence on; }\n" +
    "        message pressStart from user.press to panel.pressed;\n        message heatOn from panel.lamp.lit to heater.on;\n" +
    "        succession lampFirst first panel.lampOn then heater.on;\n    }\n" +
    "    view boilSequence : SequenceView { expose Kettle::BoilWater; }\n}\n";

  /** モデルを書き、作成した図を開く。 */
  async function openView(page: import("@playwright/test").Page, text: string, view: string): Promise<void> {
    await openApp(page);
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400);
    await page.locator(".tabadd summary").click();
    await page.locator(`[data-open-mv="${view}"]`).click();
  }

  test("F-VIEW-10: SequenceView に、ライフラインの上のイベント（入れ子の部品のものも）と、イベントの間の順序を描く", async ({ page }) => {
    // Arrange・Act
    await openView(page, BOIL, "boilSequence");
    // Assert（8.2.3.9：イベントは丸と .ev の札、順序は破線と開いた矢印）
    await expect(page.locator("#canvas .event")).toHaveCount(5);
    await expect(page.locator('#canvas .event[data-key="e:panel.lamp.lit"] text')).toHaveText(".lamp.lit");
    await expect(page.locator('[data-edge="succession|e:panel.lampOn|e:heater.on|lampFirst#1"] path.line')).toHaveAttribute("stroke-dasharray", "6 4");
    await expect(page.locator('[data-edge="msg|1|heatOn"] text')).toHaveText("2. heatOn");
    await expect(page.locator("#problems button")).toHaveCount(0);
  });

  test("F-VIEW-10: イベントの間の順序を選ぶと両端のイベントを示し、削除するとテキストからその文が消える", async ({ page }) => {
    // Arrange
    await openView(page, BOIL, "boilSequence");
    await page.locator('[data-edge="succession|e:panel.lampOn|e:heater.on|lampFirst#1"] text').click();
    await expect(page.locator("#insp")).toContainText("順序（succession）");
    await expect(page.locator("#insp")).toContainText("panel.lampOn → heater.on");
    // Act（2 回押しで削除）
    await page.locator('#insp [data-act="delEdge"]').click();
    await page.locator('#insp [data-act="delEdge"]').click();
    // Assert
    await expect(page.locator("#ed")).not.toHaveValue(/succession lampFirst/);
    await expect(page.locator('[data-edge^="succession|"]')).toHaveCount(0);
  });

  test("F-VIEW-7: filter の and・or・not と、render の合成形で図を描き、「まだ扱えない」と知らせない", async ({ page }) => {
    // Arrange
    const text =
      "package P {\n    metadata def Draft;\n    part def Engine { part cyl; }\n    #Draft part def Wheel;\n    requirement def Speed;\n    attribute def Mass;\n" +
      "    view picked { expose P::*; filter (@PartDefinition or @RequirementDefinition) and not @Draft; }\n" +
      "    view inside : GeneralView { expose P::Engine; render rendering r :> asInterconnectionDiagram; }\n}\n";
    // Act
    await openView(page, text, "picked");
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["Engine", "Speed"]);
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="inside"]').click();
    // 型は GeneralView でも、render が内部ブロック図に当たるので、部品 cyl を内部ブロック図の部品として描く
    await expect.poll(() => nodeKeys(page)).toEqual(["u:cyl"]);
    await expect(page.locator("#problems button.unsupported")).toHaveCount(0);
  });

  test("F-VIEW-7・F-EDIT-8: 3 段の連鎖の端（a.b.c.p）を、型の中をたどった部品の中の部品のポートにつなぐ", async ({ page }) => {
    // Arrange
    const text =
      "package P {\n    port def Pwr;\n    part def Relay { port coil : Pwr; }\n    part def Board { part relay : Relay; }\n    part def Controller { part board : Board; }\n" +
      "    part def Heater { port power : Pwr; }\n    part def Unit {\n        part controller : Controller;\n        part heater : Heater;\n" +
      "        connect controller.board.relay.coil to heater.power;\n        connect controller.board.nope to heater.power;\n    }\n" +
      "    view wiring : InterconnectionView { expose P::Unit; }\n}\n";
    // Act
    await openView(page, text, "wiring");
    // Assert
    await expect.poll(async () => (await nodeKeys(page)).sort()).toEqual(["u:controller", "u:controller.board", "u:controller.board.relay", "u:heater"]);
    await expect(page.locator('[data-edge="flow|u:controller.board.relay|u:heater|#1"]')).toHaveCount(1);
    await expect(page.locator("#problems")).toContainText("線の接続先「controller.board.nope」の「nope」が見つかりません（connect）");
  });
});
