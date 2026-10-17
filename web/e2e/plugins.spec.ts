// プラグイン（ADR-0018・ADR-0019）。プロジェクトの .modelith/plugins/ に入れた検査ルールのプラグインを読み込み、結果を問題一覧に出す。
// プラグインの追加・使う／止める・削除は「このプロジェクト」に対して行う（ローカルフォルダの代わりに OPFS を使う）。
import { editorText, expect, openApp, pickDirNext, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ID = "jp.example.trace";
const DIR = `.modelith/plugins/${ID}`;
const MANIFEST = JSON.stringify({ id: ID, name: "トレースの検査", version: "0.1.0", apiVersion: "0", runtime: "rules", license: "MIT", contributes: { rules: ["rules.yaml"] } }, null, 2);
const RULES = 'rules:\n  - id: req-has-satisfier\n    severity: warning\n    message: "要求「{name}」を満たす要素がありません"\n    match: { kind: requirement def }\n    require: { incoming: satisfy }\n';
/** 要求 R を満たす要素が無いモデル（R は 2 行目）。 */
const MODEL = "package P {\n    requirement def R;\n}\n";
/** 要求 R を満たす要素があるモデル。 */
const FIXED = "package P {\n    requirement def R;\n    part def A;\n    satisfy R by A;\n}\n";
const FINDING = "△ 2 行目：要求「R」を満たす要素がありません（プラグイン「トレースの検査」のルール req-has-satisfier）";

/** modelith.json のテキスト（plugins に書く中身を渡す）。 */
const project = (plugins: Record<string, unknown>): string => JSON.stringify({ name: "給水", plugins }, null, 2) + "\n";
/** プラグインが入ったプロジェクトのファイル。 */
const installed = (rules = RULES, enabled = true): Record<string, string> => ({
  "modelith.json": project({ [ID]: { version: "0.1.0", enabled } }),
  [`${DIR}/modelith-plugin.json`]: MANIFEST,
  [`${DIR}/rules.yaml`]: rules,
});

/** 検査ルールの結果の行。 */
const ruleRows = (page: Page) => page.locator("#problems button.rule");
/** プラグインの一覧の行。 */
const pluginRow = (page: Page) => page.locator(`#plugins .plug[data-plugin="${ID}"]`);

/** project フォルダにファイルを置いてフォルダを開き、a.sysml を開く。 */
async function openProject(page: Page, files: Record<string, string>): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": MODEL, ...files });
  await page.locator('[data-cmd="openFolder"]').click();
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await expect.poll(() => editorText(page)).toBe(MODEL);
}

/** プラグインのフォルダ（OPFS の trace-rules）を用意し、次のフォルダの選択でそれを選ぶようにする。 */
async function preparePluginFolder(page: Page, manifest = MANIFEST): Promise<void> {
  await putFiles(page, { "modelith-plugin.json": manifest, "rules.yaml": RULES, "README.md": "# トレースの検査\n" }, "trace-rules");
  await pickDirNext(page, "trace-rules");
}

/** ファイルメニューから、プラグインの一覧を開く。 */
async function openPluginList(page: Page): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnPlugins").click();
  await expect(page.locator("#plugins")).toBeVisible();
}

test("F-PLUG-1: プロジェクトのプラグインの検査結果を、プラグインとルールを添えて問題一覧に示す", async ({ page }) => {
  // Arrange・Act
  await openProject(page, installed());
  // Assert
  await expect(ruleRows(page)).toHaveText([FINDING]);
  await expect(page.locator("#syncText")).toHaveText("同期済み（問題 1 件）");
});

test("F-PLUG-1: 検査結果を押すとその行に移り、編集で直すと結果が消える", async ({ page }) => {
  // Arrange
  await openProject(page, installed());
  await ruleRows(page).click();
  await expect.poll(() => page.locator("#ed").evaluate((e: HTMLTextAreaElement) => e.selectionStart)).toBe(MODEL.indexOf("requirement def R"));
  // Act
  await page.locator("#ed").fill(FIXED);
  // Assert
  await expect(ruleRows(page)).toHaveCount(0);
  await expect(page.locator("#syncText")).toHaveText("同期済み");
});

test("F-PLUG-3: 読めないルールのファイルは、ファイルと行を示して知らせる", async ({ page }) => {
  // Arrange
  const broken = "rules:\n  - id: a\n    oops: 1\n";
  // Act
  await openProject(page, installed(broken));
  // Assert（問題一覧とプラグインの一覧の両方に出す）
  await expect(page.locator("#problems button.plugin")).toContainText(`⚠ プラグイン「トレースの検査」：${DIR}/rules.yaml の 3 行目：知らない項目「oops」があります`);
  await openPluginList(page);
  await expect(pluginRow(page).locator(".pst")).toHaveText("誤りあり");
  await expect(pluginRow(page).locator(".pp li")).toContainText(`${DIR}/rules.yaml の 3 行目：知らない項目「oops」があります`);
});

test("F-PLUG-9: 入っていないプラグインは、何が足りないかを示し、そこから追加できる", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({ [ID]: { version: "0.1.0", enabled: true } }) });
  const notice = `このプロジェクトはプラグイン「${ID}」を使っていますが、入っていません。追加しますか？`;
  await expect(page.locator("#explorer .plugnote")).toContainText(notice);
  await expect(page.locator("#problems button.plugin")).toHaveText(`⚠ ${notice}`);
  await preparePluginFolder(page);
  // Act
  await page.locator('#explorer [data-cmd="addPlugin"]').click();
  await expect(page.locator("#dialogText")).toContainText("「トレースの検査」（ID：jp.example.trace、版 0.1.0）を、このプロジェクトに追加します。検査ルールのプラグインです。");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect.poll(() => readFile(page, `${DIR}/rules.yaml`)).toBe(RULES);
  await expect(page.locator("#explorer .plugnote")).toHaveCount(0);
  await expect(ruleRows(page)).toHaveText([FINDING]);
});

test("F-PLUG-9: 版が違うプラグインは、両方の版を示す", async ({ page }) => {
  // Arrange・Act
  await openProject(page, { ...installed(), "modelith.json": project({ [ID]: { version: "0.2.0", enabled: true } }) });
  // Assert
  await expect(page.locator("#explorer .plugnote")).toContainText("このプロジェクトはプラグイン「トレースの検査」の版 0.2.0 を使っていますが、入っているのは版 0.1.0 です。合う版を追加しますか？");
});

test("F-PLUG-8: プラグインのフォルダをこのプロジェクトに追加し、止めて、また使い、削除する", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({}) });
  await openPluginList(page);
  await expect(page.locator("#pluginsBody")).toContainText("プロジェクト「給水」には、まだプラグインがありません。");
  await preparePluginFolder(page);
  // Act・Assert（追加：ファイルを写し、modelith.json に書き加える）
  await page.locator("#pluginsAdd").click();
  await page.locator('#dialogButtons [data-id="ok"]').click();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: true } }));
  expect(await readFile(page, `${DIR}/modelith-plugin.json`)).toBe(MANIFEST);
  expect(await readFile(page, `${DIR}/README.md`)).toBe("# トレースの検査\n");
  await expect(pluginRow(page).locator(".pst")).toHaveText("使える");
  await expect(pluginRow(page).locator(".pm")).toHaveText("ID：jp.example.trace・版：0.1.0・ルール 1 件");
  await expect(ruleRows(page)).toHaveText([FINDING]);
  // Act・Assert（止める：結果が消える）
  await pluginRow(page).locator("[data-toggle]").uncheck();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: false } }));
  await expect(pluginRow(page).locator(".pst")).toHaveText("止めている");
  await expect(ruleRows(page)).toHaveCount(0);
  // Act・Assert（また使う）
  await pluginRow(page).locator("[data-toggle]").check();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: true } }));
  await expect(ruleRows(page)).toHaveText([FINDING]);
  // Act・Assert（削除：確かめてから、フォルダと設定の項目を消す）
  await pluginRow(page).locator("[data-remove]").click();
  await expect(page.locator("#dialogText")).toContainText("プラグイン「トレースの検査」を、このプロジェクトから削除しますか？");
  await page.locator('#dialogButtons [data-id="remove"]').click();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({}));
  expect(await readFile(page, `${DIR}/rules.yaml`)).toBeNull();
  await expect(pluginRow(page)).toHaveCount(0);
  await expect(ruleRows(page)).toHaveCount(0);
});

test("F-PLUG-8: まだプロジェクトでないフォルダに追加するときは、プロジェクトにするかを尋ねる（C-6）", async ({ page }) => {
  // Arrange
  await openProject(page, {});
  await openPluginList(page);
  await expect(page.locator("#pluginsBody")).toContainText("フォルダ「project」は、まだプロジェクトではありません。");
  await preparePluginFolder(page);
  await page.locator("#pluginsAdd").click();
  await expect(page.locator('#dialogButtons [data-id="ok"]')).toHaveText("プロジェクトにして追加");
  // Act
  await page.locator("#dialogInput").fill("給水");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: true } }));
  await expect(page.locator("#explorer [data-folder]")).toHaveText("給水");
  await expect(ruleRows(page)).toHaveText([FINDING]);
});

test("F-PLUG-8: 追加をやめたら、何も書かない（C-6）", async ({ page }) => {
  // Arrange
  await openProject(page, {});
  await openPluginList(page);
  await preparePluginFolder(page);
  await page.locator("#pluginsAdd").click();
  // Act
  await page.locator('#dialogButtons [data-id="cancel"]').click();
  // Assert
  expect(await readFile(page, "modelith.json")).toBeNull();
  expect(await readFile(page, `${DIR}/modelith-plugin.json`)).toBeNull();
});

test("F-PLUG-8: 画面に機能を足すプラグイン（TypeScript）は、まだ追加できないと伝える", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({}) });
  await openPluginList(page);
  await preparePluginFolder(page, JSON.stringify({ id: "jp.example.ts", name: "書き出し", version: "1.0.0", apiVersion: "0", runtime: "browser", license: "MIT", main: "main.js" }));
  // Act
  await page.locator("#pluginsAdd").click();
  // Assert
  await expect(page.locator("#dialogText")).toHaveText("「書き出し」は、画面に機能を足すプラグイン（TypeScript）です。この種類は、まだ追加できません。今追加できるのは、検査ルールのプラグインだけです");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  expect(await readFile(page, "modelith.json")).toBe(project({}));
});

test("F-PLUG-8: フォルダを開いていないときは、プラグインはプロジェクトに入れて使うことを示す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await openPluginList(page);
  // Assert
  await expect(page.locator("#pluginsBody")).toContainText("プラグインは、プロジェクト（モデルのフォルダ）に入れて使います。「ファイル → フォルダを開く…」でモデルのフォルダを開くと、追加できます。");
  await expect(page.locator("#pluginsAdd")).toBeDisabled();
  await page.locator("#pluginsClose").click();
  await expect(page.locator("#plugins")).toBeHidden();
});

test.describe("フォルダを開けないブラウザ", () => {
  test.use({ fsAccess: false });

  test("F-PLUG-8: フォルダを開けないブラウザでは、プラグインを使えないことを示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await openPluginList(page);
    // Assert
    await expect(page.locator("#pluginsBody")).toContainText("このブラウザではフォルダを開けないため、プラグインを使えません（Chrome・Edge で使えます）。");
    await expect(page.locator("#pluginsAdd")).toBeDisabled();
  });
});
