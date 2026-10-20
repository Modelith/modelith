// UI テスト（見た目の回帰）。画面を撮って基準画像（visual.spec.ts-snapshots/）と比べる。
// 差があれば HTML レポートに「基準・今回・差分」の 3 枚が並ぶ。意図した変更なら基準を更新する（docs/development/testing.md）。
import { editorText, expect, nodeKeys, openApp, pickDirNext, putBrowserPlugin, putFiles, test, typeAtEnd } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// 画素はフォントや描画の設定で変わるので、基準のブラウザ（scripts/e2e.sh が Docker で起動する）でだけ比べる
test.skip(!process.env.PW_REFERENCE_WS, "UI テストは基準のブラウザでだけ比べる（scripts/e2e.sh）");

/** 画面が落ち着くまで待つ（トーストが消え、フォントが読み込まれる）。 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#toast")).not.toHaveClass(/on/);
}

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(".tabadd summary").click();
  await page.locator(`[data-open="${view}"]`).click();
  await settle(page);
}

test.describe("UI: 図", () => {
  const views: [string, string][] = [
    ["trace", "トレーサビリティ"],
    ["structure", "構造"],
    ["control", "制御ループ"],
    ["ibd", "内部ブロック図"],
    ["behavior", "振る舞い"],
    ["seq", "シーケンス"],
    ["all", "すべて"],
  ];
  for (const [view, label] of views) {
    test(`F-VIEW-1: ${label}ビューの見た目`, async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await openView(page, view);
      // Assert
      await expect(page.locator("#wrap")).toHaveScreenshot(`view-${view}.png`);
    });
  }
});

test.describe("UI: 画面全体", () => {
  test("Q-2: 起動直後の画面（明るい配色）", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await settle(page);
    // Assert
    await expect(page).toHaveScreenshot("app-light.png");
  });

  test.describe("暗い配色", () => {
    test.use({ colorScheme: "dark" });
    test("Q-2: 起動直後の画面（暗い配色）", async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await settle(page);
      // Assert
      await expect(page).toHaveScreenshot("app-dark.png");
    });
  });

  test.describe("狭い画面", () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test("Q-2: 幅 390px の画面", async ({ page }) => {
      // Arrange
      await openApp(page);
      // Act
      await settle(page);
      // Assert
      await expect(page).toHaveScreenshot("app-narrow.png");
    });

    test("F-FILE-14・Q-2: 幅 390px の画面で、開いているファイルが無いとき", async ({ page }) => {
      // Arrange（狭い画面では、エクスプローラーはツリーのタブにある）
      await openApp(page);
      await page.locator("#tabTree").click();
      await page.locator("#explorer [data-close]").click();
      await page.locator('#dialogButtons [data-id="discard"]').click();
      // Act
      await page.locator("#tabDiagram").click();
      await page.mouse.move(0, 0);
      await settle(page);
      // Assert
      await expect(page).toHaveScreenshot("no-open-files-narrow.png");
    });

    test("F-PLUG-8・Q-2: 幅 390px の画面のプラグインの一覧", async ({ page }) => {
      // Arrange（狭い画面ではエクスプローラーとメニューが畳まれるので、広い画面で開いてから狭める）
      await page.setViewportSize({ width: 1280, height: 800 });
      await openApp(page);
      await openPluginProject(page, { [PLUGIN_ID]: { version: "0.1.0", enabled: true }, "jp.example.ports": { version: "1.0.0", enabled: true } }, installedPlugin());
      await openPluginList(page);
      // Act
      await page.setViewportSize({ width: 390, height: 800 });
      await settle(page);
      // Assert
      await expect(page).toHaveScreenshot("plugin-list-narrow.png");
    });
  });
});

/** 部品の見た目の場面。操作して、撮る範囲を返す。 */
interface Scene {
  title: string;
  shot: string;
  act: (page: Page) => Promise<Locator[]>;
}

async function openSampleFolder(page: Page, text: string): Promise<void> {
  await putFiles(page, { "a.sysml": text, "models/b.sysml": "package B;\n" });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
}

// プラグイン（ADR-0018）の場面で使う、チェックルールのプラグインとプロジェクト
const PLUGIN_ID = "jp.example.trace";
const PLUGIN_DIR = `.modelith/plugins/${PLUGIN_ID}`;
const PLUGIN_MANIFEST = JSON.stringify(
  { id: PLUGIN_ID, name: "トレーサビリティのチェック", version: "0.1.0", apiVersion: "0", runtime: "rules", license: "MIT", contributes: { rules: ["rules.yaml"] } },
  null,
  2,
);
const PLUGIN_RULES =
  'rules:\n  - id: req-has-satisfier\n    severity: warning\n    message: "要求「{name}」を満たす要素がありません"\n    match: { kind: requirement def }\n    require: { incoming: satisfy }\n';
const PLUGIN_MODEL = "package P {\n    requirement def R;\n}\n";

/**
 * project フォルダにプロジェクトを置いてフォルダを開き、a.sysml を開く。
 *
 * @param page 画面
 * @param plugins modelith.json の plugins に書く中身
 * @param files ほかに置くファイル（パス → テキスト）
 */
async function openPluginProject(page: Page, plugins: Record<string, unknown>, files: Record<string, string> = {}): Promise<void> {
  await putFiles(page, { "a.sysml": PLUGIN_MODEL, "modelith.json": JSON.stringify({ name: "給水システム", plugins }, null, 2) + "\n", ...files });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await expect.poll(() => editorText(page)).toBe(PLUGIN_MODEL);
}

/** 入っているチェックルールのプラグインのファイル。 */
const installedPlugin = (): Record<string, string> => ({ [`${PLUGIN_DIR}/modelith-plugin.json`]: PLUGIN_MANIFEST, [`${PLUGIN_DIR}/rules.yaml`]: PLUGIN_RULES });

/**
 * ファイルメニューから、プラグインの一覧を開く。
 *
 * @param page 画面
 */
async function openPluginList(page: Page): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnPlugins").click();
  await expect(page.locator("#plugins")).toBeVisible();
}

/** 画面に機能を追加するプラグイン（TypeScript）のマニフェスト。プログラムは、準備ができたと答えるだけ。 */
const SCRIPT_ID = "jp.example.sync";
const SCRIPT_MANIFEST = JSON.stringify(
  {
    id: SCRIPT_ID, name: "要求の同期", version: "1.2.0", apiVersion: "0", runtime: "browser", author: "山田 花子", license: "MIT", main: "main.js",
    permissions: ["model:read", "edits:propose", "network"], contributes: { commands: [{ id: "pull", title: "要求を取り込む" }] },
  },
  null,
  2,
);
const SCRIPT_CODE = 'self.addEventListener("message", (e) => { if (e.data && e.data.type === "activate") self.postMessage({ type: "ready" }); });\n';
/** 入っている TypeScript のプラグインのファイル。 */
const installedScript = (): Record<string, string> => ({ [`.modelith/plugins/${SCRIPT_ID}/modelith-plugin.json`]: SCRIPT_MANIFEST, [`.modelith/plugins/${SCRIPT_ID}/main.js`]: SCRIPT_CODE });

/**
 * project フォルダにプロジェクトを置いてフォルダを開く（TypeScript のプラグインは、初めてなので実行の許可を尋ねる）。
 *
 * @param page 画面
 * @param plugins modelith.json の plugins に書く中身
 * @param files ほかに置くファイル（パス → テキスト）
 */
async function openScriptProject(page: Page, plugins: Record<string, unknown>, files: Record<string, string>): Promise<void> {
  await putFiles(page, { "a.sysml": PLUGIN_MODEL, "modelith.json": JSON.stringify({ name: "給水システム", plugins }, null, 2) + "\n", ...files });
  await page.locator('[data-cmd="openFolder"]').click();
  await expect(page.locator("#dialogTitle")).toHaveText("プラグインの実行の許可");
}

const scenes: Scene[] = [
  {
    title: "F-VIEW-9: package を枠として描いた保存された図",
    shot: "package-frame",
    act: async (page) => {
      await page.locator("#ed").fill(
        "package P {\n    package Drive {\n        part def Motor;\n        part def Gear;\n        package Sensors { part def Encoder; }\n    }\n    view drive { expose P::Drive; expose P::Drive::Sensors; }\n}\n",
      );
      await page.waitForTimeout(400);
      await page.locator(".tabadd summary").click();
      await page.locator('[data-open-mv="drive"]').click();
      await expect(page.locator('#canvas .pkg[data-pkg="Sensors"]')).toBeVisible();
      return [page.locator("#wrap")];
    },
  },
  {
    title: "F-VIEW-4: 要素を選んだときのインスペクタ",
    shot: "inspector-node",
    act: async (page) => {
      await page.locator('#gNodes .node[data-key="BoilTimeReq"]').click();
      return [page.locator("#insp")];
    },
  },
  {
    title: "F-VIEW-4: 図の右クリックメニュー",
    shot: "context-menu",
    act: async (page) => {
      await page.locator('#gNodes .node[data-key="BoilTimeReq"]').click({ button: "right" });
      return [page.locator("#ctx")];
    },
  },
  {
    title: "F-FILE-1: フォルダを開いたエクスプローラー（未保存の印つき）",
    shot: "explorer",
    act: async (page) => {
      await openSampleFolder(page, "package A;\n");
      await typeAtEnd(page, "// edited\n");
      return [page.locator(".treepane")];
    },
  },
  {
    title: "F-FILE-14: 開いているファイルが無いときの画面",
    shot: "no-open-files",
    act: async (page) => {
      await page.locator("#explorer [data-close]").click();
      await page.locator('#dialogButtons [data-id="discard"]').click();
      await expect(page.locator("#noDoc")).toBeVisible();
      await page.mouse.move(0, 0); // 案内のボタンにマウスが乗っていない状態で撮る
      return [page.locator("#main")];
    },
  },
  {
    title: "F-FILE-7: 競合したときのダイアログ",
    shot: "dialog-conflict",
    act: async (page) => {
      await openSampleFolder(page, "package A;\n");
      await typeAtEnd(page, "// mine\n");
      await putFiles(page, { "a.sysml": "package Theirs;\n" });
      await page.keyboard.press("Control+s");
      return [page.locator("#dialog .box")];
    },
  },
  {
    title: "F-EDIT-7・Q-4: パッケージ（package）を作る案内",
    shot: "dialog-new-package",
    act: async (page) => {
      await page.locator('[data-cmd="new"]').click();
      await page.locator('#palette [data-tool="concern def"]').click();
      const box = (await page.locator("#wrap").boundingBox())!;
      await page.mouse.click(box.x + 200, box.y + 200);
      return [page.locator("#dialog .box")];
    },
  },
  {
    title: "F-FILE-2: 開いた「ファイル」メニュー（項目にマウスを乗せた状態）",
    shot: "file-menu",
    act: async (page) => {
      await page.locator("#fileMenu summary").click();
      await page.locator("#btnSave").hover();
      return [page.locator("#fileMenu .pop")];
    },
  },
  {
    title: "F-VIEW-7・Q-4: 開いた「＋」メニュー（保存された図つき）",
    shot: "tab-menu-views",
    act: async (page) => {
      await page.locator("#ed").fill("package P {\n    part def A;\n    view overview : GeneralView { expose P::*; }\n    view inside : InterconnectionView { expose P::A; }\n}\n");
      await page.waitForTimeout(400); // 入力の反映でタブのメニューが描き直されるので、反映を待ってから開く
      await page.locator(".tabadd summary").click();
      return [page.locator(".tabadd .pop")];
    },
  },
  {
    title: "C-3: 開いたヘルプ",
    shot: "help-menu",
    act: async (page) => {
      await page.locator("#helpMenu summary").click();
      // 版とコミットはビルドごとに変わり、文字の幅で折り返しも変わる。塗りつぶすだけでは高さがずれるので、決まった文字列に置き換えて比べる
      await page.locator("#appVersion").evaluate((e) => (e.textContent = "0.0.0 (0000000)"));
      return [page.locator("#helpMenu .pop")];
    },
  },
  {
    title: "F-EDIT-5: 構文エラーを示す問題一覧",
    shot: "problems",
    act: async (page) => {
      await page.locator("#ed").fill("package P {\n    part def A;\n    part b : Missing;\n}\n");
      await expect(page.locator('#problems button:has-text("Missing")')).toBeVisible();
      return [page.locator(".textpane")];
    },
  },
  {
    title: "F-TRACE-1: フェーズで絞り込んだトレーサビリティの図",
    shot: "trace-phase",
    act: async (page) => {
      const before = (await nodeKeys(page)).length;
      await page.locator("#phaseFilter").selectOption("SystemRequirements");
      // 絞り込むと、フェーズの外の要素は消えるか薄くなる。描き直しを要素の数で待つ
      await expect.poll(async () => (await nodeKeys(page)).length).toBeLessThan(before);
      return [page.locator("#wrap")];
    },
  },
  {
    title: "F-TRACE-2: トレースの抜けを押したときのツールバーと問題一覧",
    shot: "trace-gaps",
    act: async (page) => {
      await page.locator("#btnGaps").click();
      await expect(page.locator("#problems .gap")).toBeVisible();
      return [page.locator(".diagrampane .toolbar"), page.locator("#problems")];
    },
  },
  {
    title: "Q-3: マウスを乗せたボタンと、キーボードで選んだボタン",
    shot: "toolbar-hover-focus",
    act: async (page) => {
      // 「整列」はキーボード（Tab）で選び、「線：直角」にはマウスを乗せる
      await page.locator("#btnEdge").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("#btnLayout")).toBeFocused();
      await page.locator("#btnEdge").hover();
      return [page.locator(".diagrampane .toolbar")];
    },
  },
  {
    title: "F-PLUG-1: チェックルールの結果を示す問題一覧",
    shot: "plugin-findings",
    act: async (page) => {
      await openPluginProject(page, { [PLUGIN_ID]: { version: "0.1.0", enabled: true } }, installedPlugin());
      await expect(page.locator("#problems button.rule")).toHaveCount(1);
      return [page.locator(".textpane")];
    },
  },
  {
    title: "F-PLUG-8・F-PLUG-9: プラグインの一覧（有効・未追加・無効）",
    shot: "plugin-list",
    act: async (page) => {
      await openPluginProject(
        page,
        { [PLUGIN_ID]: { version: "0.1.0", enabled: true }, "jp.example.ports": { version: "1.0.0", enabled: true }, "jp.example.names": { version: "0.3.0", enabled: false } },
        {
          ...installedPlugin(),
          ".modelith/plugins/jp.example.names/modelith-plugin.json": JSON.stringify(
            { id: "jp.example.names", name: "命名規則のチェック", version: "0.3.0", apiVersion: "0", runtime: "rules", license: "MIT", contributes: { rules: ["rules.yaml"] } },
            null,
            2,
          ),
          ".modelith/plugins/jp.example.names/rules.yaml": "rules: []\n",
        },
      );
      await openPluginList(page);
      await expect(page.locator("#plugins .plug")).toHaveCount(3);
      return [page.locator("#plugins .box")];
    },
  },
  {
    title: "F-PLUG-9: 追加されていないプラグインの案内（エクスプローラーと問題一覧）",
    shot: "plugin-missing",
    act: async (page) => {
      await openPluginProject(page, { [PLUGIN_ID]: { version: "0.1.0", enabled: true } });
      await expect(page.locator("#explorer .plugnote")).toBeVisible();
      return [page.locator(".treepane"), page.locator("#problems")];
    },
  },
  {
    title: "F-PLUG-8: プラグインを追加する前の確認",
    shot: "plugin-add",
    act: async (page) => {
      await openPluginProject(page, {});
      await putFiles(page, { "modelith-plugin.json": PLUGIN_MANIFEST, "rules.yaml": PLUGIN_RULES }, "trace-rules");
      await pickDirNext(page, "trace-rules");
      await openPluginList(page);
      await page.locator("#pluginsAdd").click();
      await expect(page.locator("#dialogText")).toContainText("を追加します");
      return [page.locator("#dialog .box")];
    },
  },
  {
    title: "F-PLUG-8: フォルダを開いていないときに、画面に機能を追加するプラグインを追加する前の確認（このブラウザだけを選べる）",
    shot: "plugin-add-browser",
    act: async (page) => {
      await putFiles(page, { "modelith-plugin.json": SCRIPT_MANIFEST, "main.js": SCRIPT_CODE }, "sync-plugin");
      await pickDirNext(page, "sync-plugin");
      await openPluginList(page);
      await page.locator("#pluginsAdd").click();
      await expect(page.locator('#dialogPick input[value="browser"]')).toBeChecked();
      return [page.locator("#dialog .box")];
    },
  },
  {
    title: "F-PLUG-6: プラグインの実行の許可（外部と通信できるプラグイン）",
    shot: "plugin-trust",
    act: async (page) => {
      await openScriptProject(page, { [SCRIPT_ID]: { version: "1.2.0", enabled: true } }, installedScript());
      return [page.locator("#dialog .box")];
    },
  },
  {
    title: "F-PLUG-6・F-PLUG-8: 実行中の TypeScript のプラグインと、チェックルールのプラグインの一覧",
    shot: "plugin-list-script",
    act: async (page) => {
      await openScriptProject(page, { [SCRIPT_ID]: { version: "1.2.0", enabled: true }, [PLUGIN_ID]: { version: "0.1.0", enabled: true } }, { ...installedScript(), ...installedPlugin() });
      await page.locator('#dialogButtons [data-id="allow"]').click();
      await openPluginList(page);
      await expect(page.locator(`#plugins .plug[data-plugin="${SCRIPT_ID}"] .pst`)).toHaveText("実行中");
      return [page.locator("#plugins .box")];
    },
  },
  {
    title: "F-PLUG-8: このブラウザに追加したプラグイン（実行中と、プロジェクトのものを優先しているもの）の一覧",
    shot: "plugin-list-browser",
    act: async (page) => {
      await putBrowserPlugin(page, {
        id: SCRIPT_ID,
        enabled: true,
        info: { id: SCRIPT_ID, name: "要求の同期", version: "1.2.0", runtime: "browser", main: "main.js", permissions: ["model:read", "edits:propose", "network"] },
        files: { "modelith-plugin.json": SCRIPT_MANIFEST, "main.js": SCRIPT_CODE },
      });
      await putBrowserPlugin(page, {
        id: PLUGIN_ID,
        enabled: true,
        info: { id: PLUGIN_ID, name: "トレーサビリティのチェック", version: "0.0.9", runtime: "rules" },
        files: { "modelith-plugin.json": PLUGIN_MANIFEST.replace('"0.1.0"', '"0.0.9"'), "rules.yaml": PLUGIN_RULES },
      });
      await page.reload();
      await page.locator('#dialogButtons [data-id="allow"]').click();
      await openPluginProject(page, { [PLUGIN_ID]: { version: "0.1.0", enabled: true } }, installedPlugin());
      await openPluginList(page);
      await expect(page.locator(`#plugins .plug[data-plugin="${SCRIPT_ID}"] .pst`)).toHaveText("実行中");
      await expect(page.locator("#plugins .plug")).toHaveCount(3);
      return [page.locator("#plugins .box")];
    },
  },
  {
    title: "F-PLUG-8: フォルダを開いていないときのプラグインの一覧",
    shot: "plugin-no-project",
    act: async (page) => {
      await openPluginList(page);
      return [page.locator("#plugins .box")];
    },
  },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`UI: 部品（${scheme === "light" ? "明るい" : "暗い"}配色）`, () => {
    test.use({ colorScheme: scheme });
    for (const scene of scenes) {
      test(scene.title, async ({ page }) => {
        // Arrange
        await openApp(page);
        // Act
        const targets = await scene.act(page);
        await settle(page);
        // Assert
        for (const [i, target] of targets.entries()) {
          const name = `${scene.shot}${i ? `-${i + 1}` : ""}${scheme === "dark" ? "-dark" : ""}.png`;
          await expect(target).toHaveScreenshot(name);
        }
      });
    }
  });
}
