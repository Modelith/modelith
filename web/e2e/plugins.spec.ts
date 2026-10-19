// プラグイン（ADR-0018・ADR-0019）。プロジェクトの .modelith/plugins/ と、このブラウザに追加したチェックルールのプラグインを読み込み、結果を問題一覧に出す。
// プラグインの追加・有効／無効の切り替え・削除を「このプロジェクト」（ローカルフォルダの代わりに OPFS を使う）と「このブラウザ」に対して行う。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editorText, expect, openApp, pickDirNext, putBrowserPlugin, putFiles, readFile, test } from "./fixtures";
import type { Page } from "@playwright/test";

const ID = "jp.example.trace";
const DIR = `.modelith/plugins/${ID}`;
const MANIFEST = JSON.stringify({ id: ID, name: "トレーサビリティのチェック", version: "0.1.0", apiVersion: "0", runtime: "rules", license: "MIT", contributes: { rules: ["rules.yaml"] } }, null, 2);
const RULES = 'rules:\n  - id: req-has-satisfier\n    severity: warning\n    message: "要求「{name}」を満たす要素がありません"\n    match: { kind: requirement def }\n    require: { incoming: satisfy }\n';
/** 要求 R を満たす要素が無いモデル（R は 2 行目）。 */
const MODEL = "package P {\n    requirement def R;\n}\n";
/** 要求 R を満たす要素があるモデル。 */
const FIXED = "package P {\n    requirement def R;\n    part def A;\n    satisfy R by A;\n}\n";
const FINDING = "△ 2 行目：要求「R」を満たす要素がありません（プラグイン「トレーサビリティのチェック」のルール req-has-satisfier）";

/** modelith.json のテキスト（plugins に書く中身を渡す）。 */
const project = (plugins: Record<string, unknown>): string => JSON.stringify({ name: "給水システム", plugins }, null, 2) + "\n";
/** プラグインが入ったプロジェクトのファイル。 */
const installed = (rules = RULES, enabled = true): Record<string, string> => ({
  "modelith.json": project({ [ID]: { version: "0.1.0", enabled } }),
  [`${DIR}/modelith-plugin.json`]: MANIFEST,
  [`${DIR}/rules.yaml`]: rules,
});

/** チェックルールの結果の行。 */
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
  await putFiles(page, { "modelith-plugin.json": manifest, "rules.yaml": RULES, "README.md": "# トレーサビリティのチェック\n" }, "trace-rules");
  await pickDirNext(page, "trace-rules");
}

/** ファイルメニューから、プラグインの一覧を開く。 */
async function openPluginList(page: Page): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnPlugins").click();
  await expect(page.locator("#plugins")).toBeVisible();
}

test("F-PLUG-1: プロジェクトのプラグインのチェック結果を、プラグインとルールを添えて問題一覧に示す", async ({ page }) => {
  // Arrange・Act
  await openProject(page, installed());
  // Assert
  await expect(ruleRows(page)).toHaveText([FINDING]);
  await expect(page.locator("#syncText")).toHaveText("同期済み（問題 1 件）");
});

test("F-PLUG-1: チェック結果を押すとその行に移り、編集で直すと結果が消える", async ({ page }) => {
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
  await expect(page.locator("#problems button.plugin")).toContainText(`⚠ プラグイン「トレーサビリティのチェック」：${DIR}/rules.yaml の 3 行目：不明な項目「oops」があります`);
  await openPluginList(page);
  await expect(pluginRow(page).locator(".pst")).toHaveText("エラーあり");
  await expect(pluginRow(page).locator(".pp li")).toContainText(`${DIR}/rules.yaml の 3 行目：不明な項目「oops」があります`);
});

test("F-PLUG-9: 追加されていないプラグインは、何が足りないかを示し、そこから追加できる", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({ [ID]: { version: "0.1.0", enabled: true } }) });
  const notice = `このプロジェクトで使うプラグイン「${ID}」が追加されていません。追加しますか？`;
  await expect(page.locator("#explorer .plugnote")).toContainText(notice);
  await expect(page.locator("#problems button.plugin")).toHaveText(`⚠ ${notice}`);
  await preparePluginFolder(page);
  // Act
  await page.locator('#explorer [data-cmd="addPlugin"]').click();
  await expect(page.locator("#dialogText")).toContainText("「トレーサビリティのチェック」（ID：jp.example.trace、バージョン 0.1.0）を追加します。チェックルールのプラグインです。");
  await expect(page.locator('#dialogPick input[value="project"]')).toBeChecked();
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect.poll(() => readFile(page, `${DIR}/rules.yaml`)).toBe(RULES);
  await expect(page.locator("#explorer .plugnote")).toHaveCount(0);
  await expect(ruleRows(page)).toHaveText([FINDING]);
});

test("F-PLUG-9: バージョンが違うプラグインは、両方のバージョンを示す", async ({ page }) => {
  // Arrange・Act
  await openProject(page, { ...installed(), "modelith.json": project({ [ID]: { version: "0.2.0", enabled: true } }) });
  // Assert
  await expect(page.locator("#explorer .plugnote")).toContainText("このプロジェクトはプラグイン「トレーサビリティのチェック」のバージョン 0.2.0 を使いますが、追加されているのはバージョン 0.1.0 です。バージョン 0.2.0 を追加しますか？");
});

test("F-PLUG-8: プラグインのフォルダをこのプロジェクトに追加し、無効にして、また有効にし、削除する", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({}) });
  await openPluginList(page);
  await expect(page.locator("#pluginsBody")).toContainText("プロジェクト「給水システム」にはまだプラグインがありません。");
  await preparePluginFolder(page);
  // Act・Assert（追加：ファイルをコピーし、modelith.json に登録する）
  await page.locator("#pluginsAdd").click();
  await page.locator('#dialogButtons [data-id="ok"]').click();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: true } }));
  expect(await readFile(page, `${DIR}/modelith-plugin.json`)).toBe(MANIFEST);
  expect(await readFile(page, `${DIR}/README.md`)).toBe("# トレーサビリティのチェック\n");
  await expect(pluginRow(page).locator(".pst")).toHaveText("有効");
  await expect(pluginRow(page).locator(".pm")).toHaveText("ID：jp.example.trace・バージョン：0.1.0・ルール 1 件");
  await expect(ruleRows(page)).toHaveText([FINDING]);
  // Act・Assert（無効にする：結果が消える）
  await pluginRow(page).locator("[data-toggle]").uncheck();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: false } }));
  await expect(pluginRow(page).locator(".pst")).toHaveText("無効");
  await expect(ruleRows(page)).toHaveCount(0);
  // Act・Assert（また有効にする）
  await pluginRow(page).locator("[data-toggle]").check();
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: true } }));
  await expect(ruleRows(page)).toHaveText([FINDING]);
  // Act・Assert（削除：確かめてから、フォルダと設定の項目を消す）
  await pluginRow(page).locator("[data-remove]").click();
  await expect(page.locator("#dialogText")).toContainText("プラグイン「トレーサビリティのチェック」をこのプロジェクトから削除しますか？");
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
  await expect(page.locator("#pluginsBody")).toContainText("フォルダ「project」はまだプロジェクトではありません。");
  await preparePluginFolder(page);
  await page.locator("#pluginsAdd").click();
  await expect(page.locator('#dialogButtons [data-id="ok"]')).toHaveText("プロジェクトにして追加");
  // Act
  await page.locator("#dialogInput").fill("給水システム");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect.poll(() => readFile(page, "modelith.json")).toBe(project({ [ID]: { version: "0.1.0", enabled: true } }));
  await expect(page.locator("#explorer [data-folder]")).toHaveText("給水システム");
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

test("F-PLUG-8: WebAssembly で動くプラグインは、まだ追加できないと伝える", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({}) });
  await openPluginList(page);
  await preparePluginFolder(page, JSON.stringify({ id: "jp.example.wasm", name: "解析", version: "1.0.0", apiVersion: "0", runtime: "wasm-component", license: "MIT", main: "plugin.wasm" }));
  // Act
  await page.locator("#pluginsAdd").click();
  // Assert
  await expect(page.locator("#dialogText")).toHaveText("「解析」は、WebAssembly で動くプラグインです。この種類はまだ追加できません。現在追加できるのは、チェックルールのプラグインと、画面に機能を追加するプラグイン（TypeScript）です");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  expect(await readFile(page, "modelith.json")).toBe(project({}));
});

test("F-PLUG-8: フォルダを開いていないときは、このブラウザにだけ追加できることと、プロジェクトに追加する方法を示す", async ({ page }) => {
  // Arrange
  await openApp(page);
  // Act
  await openPluginList(page);
  // Assert
  await expect(page.locator("#pluginsBody")).toContainText("フォルダを開いていないため、プラグインはこのブラウザにだけ追加できます（自分だけが使えます）。チームや CI と共有するには、「ファイル → フォルダを開く…」でモデルのフォルダを開き、プロジェクトに追加してください。");
  await expect(page.locator("#pluginsAdd")).toBeEnabled();
  await page.locator("#pluginsClose").click();
  await expect(page.locator("#plugins")).toBeHidden();
});

test("F-PLUG-8: プロジェクトを開いているときも、追加先に「このブラウザ」を選べる（プロジェクトには書かない）", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": project({}) });
  await openPluginList(page);
  await preparePluginFolder(page);
  await page.locator("#pluginsAdd").click();
  // Act
  await page.locator('#dialogPick input[value="browser"]').check();
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert
  await expect(page.locator('#plugins .plug[data-place="browser"] .ploc')).toHaveText("このブラウザ");
  await expect(ruleRows(page)).toHaveText([FINDING]);
  expect(await readFile(page, "modelith.json")).toBe(project({}));
  expect(await readFile(page, `${DIR}/rules.yaml`)).toBeNull();
});

test("F-PLUG-8: このプロジェクトとこのブラウザに同じ ID のプラグインがあれば、プロジェクトのものを使い、そのことを示す", async ({ page }) => {
  // Arrange（このブラウザのものは、名前とルールの文が違う）
  await openApp(page);
  const personal = MANIFEST.replace("トレーサビリティのチェック", "トレーサビリティのチェック（個人用）");
  await putBrowserPlugin(page, {
    id: ID,
    enabled: true,
    info: { id: ID, name: "トレーサビリティのチェック（個人用）", version: "0.1.0", runtime: "rules" },
    files: { "modelith-plugin.json": personal, "rules.yaml": RULES.replace("満たす要素がありません", "満たす部品がありません（個人用）") },
  });
  await openApp(page);
  // Act
  await openProject(page, installed());
  // Assert（問題一覧はプロジェクトのルールの結果だけ）
  await expect(ruleRows(page)).toHaveText([FINDING]);
  await openPluginList(page);
  const browserRow = page.locator(`#plugins .plug[data-plugin="${ID}"][data-place="browser"]`);
  await expect(browserRow.locator(".pst")).toHaveText("プロジェクトを優先");
  await expect(browserRow).toContainText("このプロジェクトに同じ ID のプラグインがあるため、このプロジェクトではプロジェクトのものを使います（このブラウザのものは使いません）。");
  await expect(page.locator(`#plugins .plug[data-plugin="${ID}"][data-place="project"] .pst`)).toHaveText("有効");
});

test.describe("フォルダを開けないブラウザ", () => {
  test.use({ fsAccess: false });

  test("F-PLUG-8: フォルダを開けないブラウザでは、このブラウザにだけ追加できることを示す", async ({ page }) => {
    // Arrange
    await openApp(page);
    // Act
    await openPluginList(page);
    // Assert
    await expect(page.locator("#pluginsBody")).toContainText("このブラウザはフォルダを開けないため、プラグインはこのブラウザにだけ追加できます（自分だけが使えます）。");
    await expect(page.locator("#pluginsAdd")).toBeEnabled();
  });

  test("F-PLUG-8: フォルダを開けないブラウザで、チェックルールのプラグインをこのブラウザに追加し、無効にして、開き直しても使える", async ({ page }, testInfo) => {
    // Arrange（プラグインのフォルダを、手元のディスクに用意する）
    const dir = testInfo.outputPath("trace-rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "modelith-plugin.json"), MANIFEST);
    writeFileSync(join(dir, "rules.yaml"), RULES);
    await openApp(page);
    await page.locator("#ed").fill(MODEL);
    await openPluginList(page);
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#pluginsAdd").click();
    await (await chooser).setFiles(dir);
    // Act（このプロジェクトは選べず、このブラウザが選ばれている）
    await expect(page.locator('#dialogPick input[value="project"]')).toBeDisabled();
    await expect(page.locator('#dialogPick input[value="browser"]')).toBeChecked();
    await expect(page.locator("#dialogPick")).toContainText("このブラウザはフォルダを開けないため選べません");
    await page.locator('#dialogButtons [data-id="ok"]').click();
    // Assert
    const row = page.locator(`#plugins .plug[data-plugin="${ID}"][data-place="browser"]`);
    await expect(row.locator(".pst")).toHaveText("有効");
    await expect(row.locator(".ploc")).toHaveText("このブラウザ");
    await expect(ruleRows(page)).toHaveText([FINDING]);
    await row.locator("[data-toggle]").uncheck();
    await expect(row.locator(".pst")).toHaveText("無効");
    await expect(ruleRows(page)).toHaveCount(0);
    await row.locator("[data-toggle]").check();
    // 保存場所への書き込みが終わり、一覧が描き直されるまで待ってから開き直す
    await expect(row.locator(".pst")).toHaveText("有効");
    await expect(ruleRows(page)).toHaveText([FINDING]);
    // 開き直し、起動し終えてからテキストを入れる
    await openApp(page);
    await page.locator("#ed").fill(MODEL);
    await expect(ruleRows(page)).toHaveText([FINDING]);
  });
});
