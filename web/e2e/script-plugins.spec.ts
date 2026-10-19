// v1 のプラグイン（TypeScript、ADR-0018 §3〜§5）。プロジェクトの .modelith/plugins/ に置いたプラグインを、
// 許可を確かめてから、サンドボックス化した iframe の中の Worker で動かす（ローカルフォルダの代わりに OPFS を使う）。
// プラグインは e2e/script-plugin/main.js（1 つのファイルにまとめた従来型のスクリプト）。
// 通信が届いたかは、テストが立てるサーバ（PROBE）が受けた要求で確かめる（ブラウザ側の結果だけに頼らない）。
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { editorText, expect, openApp, pickDirNext, putFiles, readFile, test } from "./fixtures";

const ID = "jp.example.review";
const DIR = `.modelith/plugins/${ID}`;
const CODE = readFileSync(new URL("./script-plugin/main.js", import.meta.url), "utf8");
const NAME = "レビューの記録";
/** 要求 R がレビューされていないモデル（R は 2 行目）。 */
const MODEL = "package P {\n    requirement def R;\n}\n";
const MARK = "// レビュー済み\n";
const PROBE_PORT = 4198;

/** マニフェスト（権限とバージョンを変えられる）。 */
const manifest = (permissions: string[], version = "1.0.0"): string =>
  JSON.stringify(
    {
      id: ID, name: NAME, version, apiVersion: "0", runtime: "browser", license: "MIT", main: "main.js", permissions,
      contributes: {
        commands: [
          { id: "review", title: "レビュー済みの印を付ける" },
          { id: "stale", title: "古い版に変更を提案する" },
          { id: "probe", title: "通信を試す" },
          { id: "loop", title: "止まらない処理" },
        ],
      },
    },
    null,
    2,
  );
/** modelith.json のテキスト。 */
const project = (version = "1.0.0"): string => JSON.stringify({ name: "給水システム", plugins: { [ID]: { version, enabled: true } } }, null, 2) + "\n";
/** プラグインが入ったプロジェクトのファイル。 */
const installed = (permissions: string[], code = CODE, version = "1.0.0"): Record<string, string> => ({
  "modelith.json": project(version),
  [`${DIR}/modelith-plugin.json`]: manifest(permissions, version),
  [`${DIR}/main.js`]: code,
});

const dialog = (page: Page) => page.locator("#dialog");
const pluginRow = (page: Page) => page.locator(`#plugins .plug[data-plugin="${ID}"]`);

/** project フォルダにファイルを置いてフォルダを開く（プロジェクトのプラグインを読み込み、初めてなら許可を尋ねる）。 */
async function openProject(page: Page, files: Record<string, string>): Promise<void> {
  await openApp(page);
  await putFiles(page, { "a.sysml": MODEL, ...files });
  await page.locator('[data-cmd="openFolder"]').click();
}

/** a.sysml を開く。 */
async function openModel(page: Page): Promise<void> {
  await page.locator('#explorer [data-file][title="a.sysml"]').click();
  await expect.poll(() => editorText(page)).toBe(MODEL);
}

/** フォルダを開き、許可して、a.sysml を開き、プラグインが動き始めるまで待つ。 */
async function startWith(page: Page, files: Record<string, string>): Promise<void> {
  await openProject(page, files);
  await allow(page);
  await openModel(page);
  await waitRunning(page);
}

/** 許可を尋ねるダイアログで「許可して実行」を押す。 */
async function allow(page: Page): Promise<void> {
  await expect(page.locator("#dialogTitle")).toHaveText("プラグインの実行の許可");
  await page.locator('#dialogButtons [data-id="allow"]').click();
}

/** ファイルメニューからプラグインの一覧を開く。 */
async function openPluginList(page: Page): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#btnPlugins").click();
  await expect(page.locator("#plugins")).toBeVisible();
}

/** ファイルメニューの「プラグインのコマンド」から実行する。 */
async function runCommand(page: Page, title: string): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator("#pluginCommands button", { hasText: title }).click();
}

/** プラグインが動き始める（コマンドがメニューに出る）まで待つ。 */
async function waitRunning(page: Page): Promise<void> {
  await expect(page.locator("#pluginCommands button")).toHaveCount(4);
}

/** フォルダの一覧を読み直す（プラグインも読み込み直す）。 */
async function refreshFolder(page: Page): Promise<void> {
  await page.locator('#explorer [data-cmd="refresh"]').click();
}

test.describe("コマンドと変更", () => {
  test("F-PLUG-5: プラグインのコマンドが提案した変更を適用し、1 回の「元に戻す」で取り消せる", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["edits:propose"]));
    // Act
    await runCommand(page, "レビュー済みの印を付ける");
    // Assert
    await expect.poll(() => editorText(page)).toBe(MARK + MODEL);
    await expect(page.locator("#toast")).toHaveText(`「レビュー済みの印」を適用しました（プラグイン「${NAME}」）`);
    await page.locator("#btnUndo").click();
    await expect.poll(() => editorText(page)).toBe(MODEL);
  });

  test("F-PLUG-5: 古いテキストに対する変更は、適用せずに知らせる", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["edits:propose"]));
    // Act
    await runCommand(page, "古い版に変更を提案する");
    // Assert
    await expect(page.locator("#toast")).toHaveText("テキストが変わったため、プラグインの変更を適用しませんでした");
    expect(await editorText(page)).toBe(MODEL);
    await openPluginList(page);
    await expect(pluginRow(page).locator(".pp li")).toHaveText(["テキストが変わったため、プラグインの変更を適用しませんでした"]);
  });

  test("F-PLUG-7: 宣言していない権限の変更案は使わず、プラグインの一覧で知らせる", async ({ page }) => {
    // Arrange（変更の権限を宣言していない）
    await startWith(page, installed([]));
    // Act
    await runCommand(page, "レビュー済みの印を付ける");
    // Assert
    await openPluginList(page);
    await expect(pluginRow(page).locator(".pp li")).toHaveText(["宣言していない権限（edits:propose）が要るメッセージ（proposeEdits）のため、使いませんでした"]);
    expect(await editorText(page)).toBe(MODEL);
  });

  test("F-PLUG-5: モデルを読むプラグインの診断を、プラグインを添えて問題一覧に示し、直すと消える", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["model:read", "edits:propose"]));
    // Act・Assert
    const row = page.locator("#problems button.rule");
    await expect(row).toHaveText([`△ 2 行目：要求「R」はレビューされていません（プラグイン「${NAME}」の review）`]);
    await runCommand(page, "レビュー済みの印を付ける");
    await expect(row).toHaveCount(0);
  });
});

test.describe("隔離", () => {
  // 通信を受けるサーバは 1 つのポートで立てるので、このまとまりのテストは同じワーカーで順に動かす
  test.describe.configure({ mode: "default" });
  let server: Server;
  let hits: string[] = [];
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "access-control-allow-origin": "*", "content-type": req.url?.includes("/es") ? "text/event-stream" : "text/plain" });
      res.end("ok");
    });
    server.on("upgrade", (req, socket) => {
      hits.push(`UPGRADE ${req.url}`);
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(PROBE_PORT, resolve));
  });
  test.afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  test.beforeEach(() => {
    hits = [];
  });

  test("F-PLUG-7: 外部との通信を宣言していないプラグインは、通信・ブラウザの保存場所・アプリの画面に触れられない", async ({ page }) => {
    // Arrange（アプリのオリジンに秘密を置く）
    await openApp(page);
    await page.evaluate(() => localStorage.setItem("modelith-secret", "app"));
    await startWith(page, installed([]));
    // Act
    await runCommand(page, "通信を試す");
    // Assert
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」：確認の結果：fetch=blocked xhr=blocked ws=blocked es=blocked import=blocked storage=none idb=blocked parent=none`, { timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(hits).toEqual([]);
  });

  test("F-PLUG-7: 外部との通信を宣言して許可されたプラグインだけが、通信できる", async ({ page }) => {
    // Arrange（確かめる仕組みが働いていること：同じサーバに届く）
    await startWith(page, installed(["network"]));
    // Act
    await runCommand(page, "通信を試す");
    // Assert（スクリプトの読み込みと EventSource は、通信を宣言しても使えない）
    await expect(page.locator("#toast")).toContainText("fetch=ok xhr=ok", { timeout: 15_000 });
    await expect(page.locator("#toast")).toContainText("es=blocked import=blocked storage=none idb=blocked parent=none");
    expect(hits).toContain("GET /fetch");
    expect(hits.some((h) => h.includes("/es") || h.includes("/remote.js"))).toBe(false);
  });

  test("F-PLUG-7: 止まらない処理をするプラグインがあっても、画面は動き、停止できる", async ({ page }) => {
    // Arrange
    await startWith(page, installed([]));
    await runCommand(page, "止まらない処理");
    // Act（プラグインが止まらない間も、テキストを編集できる）
    await page.locator("#ed").fill("package Q {\n    part def A;\n    part def B;\n}\n");
    await expect(page.locator("#textInfo")).toHaveText("SysML v2 テキスト：要素 2、関係 0");
    await openPluginList(page);
    await pluginRow(page).locator("[data-plugin-stop]").click();
    // Assert（止まったとは言い切らない）
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」に停止を指示しました。完全に止まるまで数秒かかることがあります`);
    await expect(pluginRow(page).locator(".pst")).toHaveText("停止");
    await expect(page.locator("iframe.plugin-sandbox")).toHaveCount(0);
    await expect(page.locator("#pluginCommands button")).toHaveCount(0);
  });
});

test.describe("許可", () => {
  test("F-PLUG-6: 初めて動かす前に、名前・ID・バージョン・使う権限を示して尋ねる", async ({ page }) => {
    // Arrange・Act
    await openProject(page, installed(["model:read", "edits:propose"]));
    // Assert
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("#dialogText")).toHaveText(
      `プラグイン「${NAME}」（ID：${ID}、バージョン 1.0.0）を初めて実行します。このプラグインはプログラムを含みます。アプリとは切り離された場所で動き、開いているモデルのテキストを受け取って、次の権限だけを使えます。実行を許可しますか？`,
    );
    await expect(page.locator("#dialogDetail li")).toHaveText(["解析したモデル（要素と関係）を受け取り、問題一覧に結果を出す（model:read）", "モデルのテキストを変更する（変更は元に戻せます）（edits:propose）"]);
    await expect(page.locator("#dialogDetail .warn")).toHaveCount(0);
    await expect(page.locator("iframe.plugin-sandbox")).toHaveCount(0);
  });

  test("F-PLUG-6: 外部と通信できるプラグインは、モデルを外部に送信できることをはっきり示す", async ({ page }) => {
    // Arrange・Act
    await openProject(page, installed(["network"]));
    // Assert
    await expect(page.locator("#dialogDetail .warn")).toHaveText("このプラグインは、あなたのモデルを外部に送信できます。提供元を信頼できる場合だけ許可してください。");
  });

  test("F-PLUG-6: 許可したプラグインは、開き直しても尋ねない", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["model:read"]));
    // Act
    await page.reload();
    await page.locator("#gNodes .node").first().waitFor();
    await page.locator('[data-cmd="openFolder"]').click();
    // Assert
    await waitRunning(page);
    await expect(dialog(page)).toBeHidden();
  });

  test("F-PLUG-6: 使う権限が増えたら、もう一度尋ねる", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["model:read"]));
    // Act
    await putFiles(page, { [`${DIR}/modelith-plugin.json`]: manifest(["model:read", "edits:propose"]) });
    await refreshFolder(page);
    // Assert
    await expect(page.locator("#dialogText")).toContainText("の使う権限が、前回許可したときより増えました（増えた権限：モデルのテキストを変更する（変更は元に戻せます））。");
  });

  test("F-PLUG-6: 外部と通信できるプラグインのファイルが変わったら、もう一度尋ねる", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["network"]));
    // Act
    await putFiles(page, { [`${DIR}/main.js`]: `${CODE}\n// 更新\n` });
    await refreshFolder(page);
    // Assert
    await expect(page.locator("#dialogText")).toContainText(`外部と通信できるプラグイン「${NAME}」（ID：${ID}、バージョン 1.0.0）のバージョンかファイルが、前回許可したときから変わりました。`);
  });

  test("F-PLUG-6: 外部と通信できないプラグインは、ファイルやバージョンが変わっても尋ねずに動かす", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["model:read"]));
    // Act
    await putFiles(page, { "modelith.json": project("1.1.0"), [`${DIR}/main.js`]: `${CODE}\n// 更新\n`, [`${DIR}/modelith-plugin.json`]: manifest(["model:read"], "1.1.0") });
    await refreshFolder(page);
    // Assert（読み込み直して動かし直す間も、尋ねない）
    await openPluginList(page);
    await expect(pluginRow(page).locator(".pm")).toContainText("バージョン：1.1.0");
    await expect(pluginRow(page).locator(".pst")).toHaveText("実行中");
    await expect(dialog(page)).toBeHidden();
  });

  test("F-PLUG-6: 許可しなかったプラグインは「許可されていません」と示し、一覧から許可できる", async ({ page }) => {
    // Arrange
    await openProject(page, installed([]));
    await page.locator('#dialogButtons [data-id="deny"]').click();
    await openPluginList(page);
    await expect(pluginRow(page).locator(".pst")).toHaveText("許可されていません");
    // Act
    await pluginRow(page).locator("[data-plugin-allow]").click();
    await allow(page);
    // Assert
    await expect(pluginRow(page).locator(".pst")).toHaveText("実行中");
  });
});

test("F-PLUG-6: 画面に機能を追加するプラグインを、使う権限を示してから、このプロジェクトに追加する", async ({ page }) => {
  // Arrange
  await openProject(page, { "modelith.json": JSON.stringify({ name: "給水システム", plugins: {} }, null, 2) + "\n" });
  await putFiles(page, { "modelith-plugin.json": manifest(["network"]), "main.js": CODE }, "review-plugin");
  await pickDirNext(page, "review-plugin");
  await openPluginList(page);
  // Act
  await page.locator("#pluginsAdd").click();
  await expect(page.locator("#dialogText")).toContainText("画面に機能を追加するプラグイン（TypeScript）です。プログラムを含み、下の権限を使います。");
  await expect(page.locator("#dialogDetail li")).toHaveText(["インターネットなど外部と通信する（network）"]);
  await expect(page.locator("#dialogDetail .warn")).toHaveText("このプラグインは、あなたのモデルを外部に送信できます。提供元を信頼できる場合だけ許可してください。");
  await page.locator('#dialogButtons [data-id="ok"]').click();
  // Assert（コピーしてから、実行の許可を尋ねる）
  await expect.poll(() => readFile(page, `${DIR}/main.js`)).toBe(CODE);
  await allow(page);
  await expect(pluginRow(page).locator(".pst")).toHaveText("実行中");
  await expect(pluginRow(page).locator(".pperm li")).toHaveText(["インターネットなど外部と通信する（network）"]);
});
