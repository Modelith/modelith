// UI テスト（見た目の回帰）。画面を撮って基準画像（visual.spec.ts-snapshots/）と比べる。
// 差があれば HTML レポートに「基準・今回・差分」の 3 枚が並ぶ。意図した変更なら基準を更新する（docs/development/testing.md）。
import { expect, nodeKeys, openApp, putFiles, test, typeAtEnd } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

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
  });
});

/** 部品の見た目の場面。操作して、撮る範囲を返す。 */
interface Scene {
  title: string;
  shot: string;
  act: (page: Page) => Promise<Locator[]>;
  /** 版やコミットなど、ビルドごとに変わる所。塗りつぶして比べる。 */
  mask?: string[];
}

async function openSampleFolder(page: Page, text: string): Promise<void> {
  await putFiles(page, { "a.sysml": text, "models/b.sysml": "package B;\n" });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
}

const scenes: Scene[] = [
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
    title: "F-FILE-2: 開いた「ファイル」メニュー（項目にマウスを乗せた状態）",
    shot: "file-menu",
    act: async (page) => {
      await page.locator("#fileMenu summary").click();
      await page.locator("#btnSave").hover();
      return [page.locator("#fileMenu .pop")];
    },
  },
  {
    title: "C-3: 開いた「?」メニュー",
    shot: "help-menu",
    act: async (page) => {
      await page.locator("#helpMenu summary").click();
      return [page.locator("#helpMenu .pop")];
    },
    mask: ["#appVersion"],
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
        const mask = (scene.mask ?? []).map((m) => page.locator(m));
        for (const [i, target] of targets.entries()) {
          const name = `${scene.shot}${i ? `-${i + 1}` : ""}${scheme === "dark" ? "-dark" : ""}.png`;
          await expect(target).toHaveScreenshot(name, { mask });
        }
      });
    }
  });
}
