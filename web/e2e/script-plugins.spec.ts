// v1 のプラグイン（TypeScript、ADR-0018 §3〜§5）。プロジェクトの .modelith/plugins/ に置いたプラグイン（ローカルフォルダの代わりに OPFS を使う）と、
// このブラウザに追加したプラグインを、許可を確かめてから、サンドボックス化した iframe の中の Worker で動かす。
// プラグインは e2e/script-plugin/main.js（1 つのファイルにまとめた従来型のスクリプト）。
// 通信が届いたかは、テストが立てるサーバ（PROBE）が受けた要求で確かめる（ブラウザ側の結果だけに頼らない）。
// 「隔離」のまとまりは、Chromium・Firefox・WebKit の 3 つで動かす（playwright.config.ts の projects）。
// WebKit（Linux）には OPFS が無いので、このまとまりは、フォルダを開けないブラウザとして、このブラウザに追加したプラグインで確かめる。
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { editorText, expect, openApp, pickDirNext, putBrowserPlugin, putFiles, readFile, readPluginData, test } from "./fixtures";

const ID = "jp.example.review";
const DIR = `.modelith/plugins/${ID}`;
const CODE = readFileSync(new URL("./script-plugin/main.js", import.meta.url), "utf8");
const NAME = "レビューの記録";
/** 要求 R がレビューされていないモデル（R は 2 行目）。 */
const MODEL = "package P {\n    requirement def R;\n}\n";
const MARK = "// レビュー済み\n";
/** 通信を受けるサーバのポートの始まり（並んで動くワーカーごとに 1 つずつずらす）。プラグインのコードにも書いてある。 */
const PROBE_PORT = 4198;
/** 取り込みの表示名。 */
const IMPORTER = "要求の一覧（テキスト）";
/** 書き出しの表示名。 */
const EXPORTER = "テキストのまま";

/** マニフェストに書く作者（許可を尋ねる画面に出る）。 */
const AUTHOR = "山田 花子";

/** マニフェスト（権限とバージョンを変えられる）。 */
const manifest = (permissions: string[], version = "1.0.0"): string =>
  JSON.stringify(
    {
      id: ID, name: NAME, version, apiVersion: "0", runtime: "browser", author: AUTHOR, license: "MIT", main: "main.js", permissions,
      contributes: {
        commands: [
          { id: "review", title: "レビュー済みの印を付ける" },
          { id: "stale", title: "古い版に変更を提案する" },
          { id: "probe", title: "通信を試す" },
          { id: "loop", title: "止まらない処理" },
          { id: "count", title: "回数を数える" },
          { id: "big", title: "大きな値を保存する" },
        ],
        importers: [{ id: "lines", label: IMPORTER, extensions: [".txt"] }],
        exporters: [{ id: "text", label: EXPORTER, extension: ".txt" }],
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

/** ファイルメニューの「プラグインのコマンド」（kind が import・export なら「プラグインで読み込む」「プラグインで書き出す」）から実行する。 */
async function runCommand(page: Page, title: string, kind = "command"): Promise<void> {
  await page.locator("#fileMenu summary").click();
  await page.locator(`#pluginCommands button[data-kind="${kind}"]`, { hasText: title }).click();
}

/** プラグインが動き始める（コマンドがメニューに出る）まで待つ。 */
async function waitRunning(page: Page): Promise<void> {
  await expect(page.locator('#pluginCommands [data-kind="command"]')).toHaveCount(6);
}

/** マニフェストから、このブラウザに追加したときに覚える情報（一覧に出すため）を作る。 */
const infoOf = (manifestText: string): Record<string, unknown> => {
  const m = JSON.parse(manifestText) as Record<string, unknown> & { contributes: Record<string, unknown> };
  return { id: m["id"], name: m["name"], version: m["version"], runtime: m["runtime"], author: m["author"], permissions: m["permissions"], main: m["main"], ...m.contributes };
};

/**
 * このブラウザにプラグインを置いて開き直し、許可して、動き始めるまで待つ（フォルダは開かない）。
 *
 * @param code プラグインのプログラム（通信を受けるポートを書き換えたもの）
 */
async function startInBrowser(page: Page, permissions: string[], code = CODE): Promise<void> {
  await openApp(page);
  const m = manifest(permissions);
  await putBrowserPlugin(page, { id: ID, enabled: true, info: infoOf(m), files: { "modelith-plugin.json": m, "main.js": code } });
  await page.reload();
  await allow(page);
  await waitRunning(page);
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

  test("F-PLUG-5・F-FILE-14: 開いているファイルが無いときは、コマンドを実行せずに知らせる", async ({ page }) => {
    // Arrange（表示中の a.sysml を閉じ、次に表示されるサンプルも保存せずに閉じる）
    await startWith(page, installed(["edits:propose"]));
    await page.locator('#explorer [data-doc]:has-text("a.sysml") [data-close]').click();
    await page.locator('#explorer [data-doc]:has-text("electric-kettle.sysml") [data-close]').click();
    await page.locator('#dialogButtons [data-id="discard"]').click();
    await expect(page.locator("#noDoc")).toBeVisible();
    // Act
    await runCommand(page, "レビュー済みの印を付ける");
    // Assert
    await expect(page.locator("#toast")).toHaveText("開いているファイルがありません。ファイルを開いてから実行してください");
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
  // 3 つのブラウザに共通の方法で確かめるため、このブラウザに追加したプラグインを、フォルダを開けないブラウザとして動かす
  test.use({ fsAccess: false });
  // 通信を受けるサーバは、ワーカーごとに 1 つのポートで立てるので、このまとまりのテストは同じワーカーで順に動かす
  test.describe.configure({ mode: "default" });
  let server: Server;
  let hits: string[] = [];
  /** このワーカーのサーバのポートに書き換えたプラグインのコード。 */
  let code = CODE;
  test.beforeAll(async ({}, workerInfo) => {
    const port = PROBE_PORT + workerInfo.parallelIndex;
    code = CODE.replace(`localhost:${PROBE_PORT}`, `localhost:${port}`);
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "access-control-allow-origin": "*", "content-type": req.url?.includes("/es") ? "text/event-stream" : "text/plain" });
      res.end("ok");
    });
    server.on("upgrade", (req, socket) => {
      hits.push(`UPGRADE ${req.url}`);
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));
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
    await startInBrowser(page, [], code);
    // Act
    await runCommand(page, "通信を試す");
    // Assert
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」：確認の結果：fetch=blocked xhr=blocked ws=blocked es=blocked import=blocked storage=none idb=blocked parent=none`, { timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(hits).toEqual([]);
  });

  test("F-PLUG-7: 外部との通信を宣言して許可されたプラグインだけが、通信できる", async ({ page }) => {
    // Arrange（確かめる仕組みが働いていること：同じサーバに届く）
    await startInBrowser(page, ["network"], code);
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
    await startInBrowser(page, [], code);
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

test.describe("保存場所", () => {
  test("F-PLUG-7: storage を宣言したプラグインは、プラグイン用の保存場所に読み書きでき、開き直しても残る", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["storage"]));
    await runCommand(page, "回数を数える");
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」：保存した回数：1`);
    // Act
    await openApp(page);
    await page.locator('[data-cmd="openFolder"]').click();
    await waitRunning(page);
    await runCommand(page, "回数を数える");
    // Assert
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」：保存した回数：2`);
    expect(await readPluginData(page, ID)).toBe('{"count":2}');
  });

  test("F-PLUG-7: プラグイン用の保存場所の上限（1 MB）を超える値は保存せず、知らせる", async ({ page }) => {
    // Arrange
    await startWith(page, installed(["storage"]));
    // Act
    await runCommand(page, "大きな値を保存する");
    // Assert
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」：大きな値：保存されていません`);
    await openPluginList(page);
    await expect(pluginRow(page).locator(".pp li")).toHaveText(["プラグイン用の保存場所の上限（1 MB）を超えるため、「big」を保存しませんでした"]);
  });

  test("F-PLUG-7: storage を宣言していないプラグインの保存場所の依頼は使わず、一覧で知らせる", async ({ page }) => {
    // Arrange
    await startWith(page, installed([]));
    // Act
    await runCommand(page, "回数を数える");
    // Assert
    await openPluginList(page);
    await expect(pluginRow(page).locator(".pp li")).toHaveText(["宣言していない権限（storage）が要るメッセージ（storageGet）のため、使いませんでした"]);
  });
});

test.describe("読み込みと書き出し", () => {
  test("F-PLUG-4: プラグインで読み込んだ結果を、新しいファイルとして開き、開いていたファイルは書き換えない", async ({ page }) => {
    // Arrange
    await startWith(page, installed([]));
    const chooser = page.waitForEvent("filechooser");
    // Act
    await runCommand(page, `${IMPORTER}…`, "import");
    await (await chooser).setFiles({ name: "要求一覧.txt", mimeType: "text/plain", buffer: Buffer.from("給水\n排水\n") });
    // Assert
    const imported = "package 要求一覧 {\n    requirement def 給水;\n    requirement def 排水;\n}\n";
    await expect.poll(() => editorText(page)).toBe(imported);
    await expect(page.locator("#toast")).toHaveText(`「${IMPORTER}」で読み込んだ結果を、新しいファイル「要求一覧.sysml」として開きました（プラグイン「${NAME}」）。保存するまでファイルには書き込みません`);
    await expect(page.locator("#explorer [data-doc]", { hasText: "要求一覧.sysml" })).toHaveCount(1);
    expect(await readFile(page, "a.sysml")).toBe(MODEL);
    expect(await readFile(page, "要求一覧.sysml")).toBeNull();
  });

  test("F-PLUG-4: 選んだファイルを読み込めなかったときは、プラグインの理由を示す", async ({ page }) => {
    // Arrange
    await startWith(page, installed([]));
    const chooser = page.waitForEvent("filechooser");
    // Act
    await runCommand(page, `${IMPORTER}…`, "import");
    const files = await chooser;
    await files.setFiles({ name: "メモ.txt", mimeType: "text/plain", buffer: Buffer.from("失敗\n") });
    // Assert
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」の読み込み「${IMPORTER}」を実行できませんでした：要求の一覧ではありません`);
    expect(await editorText(page)).toBe(MODEL);
  });

  test("F-PLUG-4: プラグインで書き出したファイルを、ダウンロードさせる", async ({ page }) => {
    // Arrange
    await startWith(page, installed([]));
    const download = page.waitForEvent("download");
    // Act
    await runCommand(page, EXPORTER, "export");
    // Assert（ファイル名には拡張子を補う。プロジェクトのフォルダには書かない）
    const file = await download;
    expect(file.suggestedFilename()).toBe("モデル.txt");
    const chunks: Buffer[] = [];
    for await (const c of await file.createReadStream()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(`図：（なし）\n${MODEL}`);
    await expect(page.locator("#toast")).toHaveText(`「${EXPORTER}」で書き出した「モデル.txt」をダウンロードしました（プラグイン「${NAME}」）`);
    expect(await readFile(page, "モデル.txt")).toBeNull();
  });

  test("F-PLUG-4: 保存された図を表示しているときは、その図の名前を書き出しに渡す", async ({ page }) => {
    // Arrange
    await startWith(page, installed([]));
    const text = "package P {\n    requirement def R;\n    view reqs { expose P::R; }\n}\n";
    await page.locator("#ed").fill(text);
    await page.waitForTimeout(400); // 入力の反映を待つ。反映でタブのメニューが描き直されるため
    await page.locator(".tabadd summary").click();
    await page.locator('[data-open-mv="reqs"]').click();
    const download = page.waitForEvent("download");
    // Act
    await runCommand(page, EXPORTER, "export");
    // Assert
    const chunks: Buffer[] = [];
    for await (const c of await (await download).createReadStream()) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(`図：reqs\n${text}`);
  });
});

test.describe("許可", () => {
  test("F-PLUG-6: 初めて動かす前に、名前・作者・ID・バージョン・使う権限を示して尋ねる", async ({ page }) => {
    // Arrange・Act
    await openProject(page, installed(["model:read", "edits:propose"]));
    // Assert
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("#dialogText")).toHaveText(
      `プラグイン「${NAME}」（作者：${AUTHOR}、ID：${ID}、バージョン 1.0.0）を初めて実行します。このプラグインはプログラムを含みます。アプリとは切り離された場所で動き、開いているモデルのテキストを受け取って、次の権限だけを使えます。実行を許可しますか？`,
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
    await expect(page.locator("#dialogText")).toContainText(`外部と通信できるプラグイン「${NAME}」（作者：${AUTHOR}、ID：${ID}、バージョン 1.0.0）のバージョンかファイルが、前回許可したときから変わりました。`);
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

test.describe("このブラウザ", () => {
  test.use({ fsAccess: false });

  test("F-PLUG-8: フォルダを開けないブラウザで、画面に機能を追加するプラグインをこのブラウザに追加し、許可して動かす", async ({ page }, testInfo) => {
    // Arrange（プラグインのフォルダを、手元のディスクに用意する）
    const dir = testInfo.outputPath("review-plugin");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "modelith-plugin.json"), manifest(["edits:propose"]));
    writeFileSync(join(dir, "main.js"), CODE);
    await openApp(page);
    await openPluginList(page);
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#pluginsAdd").click();
    await (await chooser).setFiles(dir);
    await expect(page.locator("#dialogPick input:checked")).toHaveValue("browser");
    // Act
    await page.locator('#dialogButtons [data-id="ok"]').click();
    await allow(page);
    // Assert
    const row = page.locator(`#plugins .plug[data-plugin="${ID}"][data-place="browser"]`);
    await expect(row.locator(".pst")).toHaveText("実行中");
    await expect(row.locator(".ploc")).toHaveText("このブラウザ");
    await page.locator("#pluginsClose").click();
    await page.locator("#ed").fill(MODEL);
    await expect(page.locator("#textInfo")).toHaveText("SysML v2 テキスト：要素 1、関係 0"); // 解析が済み、プラグインに今のテキストが届いてから
    await runCommand(page, "レビュー済みの印を付ける");
    await expect.poll(() => editorText(page)).toBe(MARK + MODEL);
  });

  test("F-PLUG-8: このブラウザから削除するときは、プラグインが保存したデータも削除するかを選べる", async ({ page }) => {
    // Arrange
    await startInBrowser(page, ["storage"]);
    await runCommand(page, "回数を数える");
    await expect(page.locator("#toast")).toHaveText(`プラグイン「${NAME}」：保存した回数：1`);
    await openPluginList(page);
    // Act
    await pluginRow(page).locator("[data-remove]").click();
    await expect(page.locator("#dialogText")).toHaveText(`プラグイン「${NAME}」をこのブラウザから削除しますか？`);
    await expect(page.locator('#dialogPick input[value="keep"]')).toBeChecked();
    await page.locator('#dialogPick input[value="delete"]').check();
    await page.locator('#dialogButtons [data-id="remove"]').click();
    // Assert
    await expect(pluginRow(page)).toHaveCount(0);
    await expect.poll(() => readPluginData(page, ID)).toBeNull();
    await expect(page.locator("iframe.plugin-sandbox")).toHaveCount(0);
  });
});
