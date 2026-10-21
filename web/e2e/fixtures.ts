// e2e の共通部品。
// ローカルフォルダの代わりに OPFS（ブラウザ内の本物のファイルシステム）を渡し、
// File System Access API のピッカーを、ダイアログを出さずに決まったフォルダ・ファイルを返すものに置き換える。
import { test as base, expect, type Page } from "@playwright/test";

/**
 * ピッカーの置き換え（ブラウザ側で動く）。フォルダのピッカーは、ふだんは project フォルダを返す。
 * `__e2e.pickDir` にフォルダ名を入れておくと、次の 1 回だけ、OPFS の一番上のそのフォルダを返す（プラグインのフォルダを選ぶときなど）。
 * OPFS のハンドルはいつも許可済みなので、localStorage の e2e-permission（needPermission で置く）があれば、
 * 許可が残っていないブラウザのふりをする（prompt なら求めると許可され、refuse なら拒まれる）。
 */
function installPickers(): void {
  const w = window as unknown as Record<string, unknown> & { __e2e: { openFile?: string; pickDir?: string } };
  w.__e2e = {};
  let permission: string | null = null;
  try {
    permission = localStorage.getItem("e2e-permission");
  } catch {
    // プラグインのサンドボックス（allow-same-origin の無い iframe）では localStorage を読めない。そこでは置き換えない
  }
  if (permission) {
    const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
    proto["queryPermission"] = async () => "prompt";
    proto["requestPermission"] = async () => (permission === "refuse" ? "denied" : "granted");
  }
  const project = async (): Promise<FileSystemDirectoryHandle> =>
    (await navigator.storage.getDirectory()).getDirectoryHandle("project", { create: true });
  w["showDirectoryPicker"] = async () => {
    const name = w.__e2e.pickDir;
    if (!name) return project();
    w.__e2e.pickDir = undefined;
    return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
  };
  w["showOpenFilePicker"] = async () => {
    const name = w.__e2e.openFile;
    if (!name) throw new DOMException("cancelled", "AbortError");
    return [await (await project()).getFileHandle(name)];
  };
}

/** File System Access API が無いブラウザ（Safari・Firefox）のふりをする。 */
function removeFsAccess(): void {
  const w = window as unknown as Record<string, unknown>;
  delete w["showDirectoryPicker"];
  delete w["showOpenFilePicker"];
}

export const test = base.extend<{ fsAccess: boolean }>({
  fsAccess: [true, { option: true }],
  page: async ({ page, fsAccess }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(fsAccess ? installPickers : removeFsAccess);
    await use(page);
    // どのテストでも、画面の例外が出ていないことを確かめる
    expect(errors, "画面で例外が発生した").toEqual([]);
  },
});
export { expect };

/** 起動して、最初の図が描かれるまで待つ。 */
export async function openApp(page: Page): Promise<void> {
  await page.goto("./");
  await page.locator("#gNodes .node").first().waitFor();
}

/** project フォルダ（OPFS。folder を渡せば OPFS の一番上のそのフォルダ）にファイルを置く。パスは a/b.sysml の形。 */
export async function putFiles(page: Page, files: Record<string, string>, folder = "project"): Promise<void> {
  await page.evaluate(async ([files, folder]) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true });
    for (const [path, text] of Object.entries(files)) {
      const segs = path.split("/");
      const name = segs.pop() as string;
      let d = root;
      for (const s of segs) d = await d.getDirectoryHandle(s, { create: true });
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  }, [files, folder] as const);
}

/**
 * 次に開いたとき（再読み込みの後）から、前回のフォルダを開き直すのにブラウザの許可が要るようにする（Chrome で許可が残っていないとき）。
 *
 * @param grant 許可を求められたら許可するか（false なら拒む）
 */
export async function needPermission(page: Page, grant = true): Promise<void> {
  await page.evaluate((v) => localStorage.setItem("e2e-permission", v), grant ? "prompt" : "refuse");
}

/** 次にフォルダのピッカーを開いたとき、1 回だけ OPFS の一番上のフォルダ name を返すようにする（プラグインのフォルダを選ぶ）。 */
export async function pickDirNext(page: Page, name: string): Promise<void> {
  await page.evaluate((name) => {
    (window as unknown as { __e2e: { pickDir?: string } }).__e2e.pickDir = name;
  }, name);
}

/**
 * project フォルダ（OPFS）のファイルを読む。無ければ null。
 * 保存は一時ファイルに書いてから差し替えるので、保存の途中ではファイルが一瞬見つからない・読めないことがある。
 * expect.poll で待つときは null を「まだ」として扱えるよう、例外にしない。
 */
export async function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (path) => {
    try {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle("project");
      const segs = path.split("/");
      const name = segs.pop() as string;
      for (const s of segs) d = await d.getDirectoryHandle(s);
      return await (await (await d.getFileHandle(name)).getFile()).text();
    } catch (e) {
      // NotReadableError は、読もうとしたファイルが書き込みで差し替えられた（保存の途中）
      if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "NotReadableError")) return null;
      throw e;
    }
  }, path);
}

/** テキスト欄の内容。 */
export const editorText = (page: Page): Promise<string> => page.locator("#ed").inputValue();

/** テキスト欄の末尾に入力する。 */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator("#ed").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

/**
 * テキストの中の語が画面に描かれている矩形の中心を返す（色付けの層 #hl の文字で調べる）。
 *
 * @param page ページ
 * @param needle 探すテキスト（最初に現れる所）
 * @param from 語の始まりを needle の中で何文字目にするか
 * @param length 語の長さ
 * @returns 語の中心の画面の座標
 */
export async function wordCenter(page: Page, needle: string, from: number, length: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([needle, from, length]) => {
      const start = (document.querySelector<HTMLTextAreaElement>("#ed")!.value.indexOf(needle)) + from;
      const walker = document.createTreeWalker(document.querySelector("#hl")!, NodeFilter.SHOW_TEXT);
      let pos = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const len = n.textContent!.length;
        if (start < pos + len) {
          const r = document.createRange();
          r.setStart(n, start - pos);
          r.setEnd(n, start - pos + length);
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
        pos += len;
      }
      throw new Error(`見つかりません: ${needle}`);
    },
    [needle, from, length] as const,
  );
}

/** テキスト欄を text に置き換えて、図への反映を待つ。 */
export async function replaceText(page: Page, text: string): Promise<void> {
  await page.locator("#ed").fill(text);
  await page.waitForTimeout(400);
}

/** 狭い画面で起動してテキストのタブを開き、「編集」で text に書き換えてから、読み取り専用に戻す（F-EDIT-10）。 */
export async function openReadOnlyText(page: Page, text: string): Promise<void> {
  await openApp(page);
  await page.locator("#tabText").click();
  await page.locator("#btnEditText").click();
  await replaceText(page, text);
  await page.locator("#btnEditText").click();
  // 最後に押した「編集」ボタンにマウスが残ると、ホバーの見た目が画面に写る。ボタンの外（テキストの下の空き）へ動かしておく
  await page.mouse.move(1, (page.viewportSize()?.height ?? 800) - 1);
}

/** 図に描かれている要素のキー（中に部品を描く部品は、線の下の層 #gEdges にある）。 */
export const nodeKeys = (page: Page): Promise<string[]> =>
  page.locator("#gNodes .node, #gNodes .lifeline, #gEdges .node").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["key"] ?? ""));

/** このブラウザに追加したプラグイン（web/src/plugins/browser-store.ts の BrowserPlugin と同じ形）。 */
export interface BrowserPluginRecord {
  id: string;
  enabled: boolean;
  info: Record<string, unknown>;
  files: Record<string, string>;
}

/**
 * このブラウザの保存場所（IndexedDB の modelith-plugins）に、プラグインを直接置く（画面で追加したのと同じ状態にする）。
 * アプリは起動したときに読むので、置いた後に開き直す（reload）。
 */
export async function putBrowserPlugin(page: Page, record: BrowserPluginRecord): Promise<void> {
  await page.evaluate(
    (record) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("modelith-plugins", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("installed", { keyPath: "id" });
          req.result.createObjectStore("data", { keyPath: "id" });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction("installed", "readwrite");
          tx.objectStore("installed").put(record);
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    record,
  );
}

/** このブラウザの保存場所から、プラグイン用のデータ（JSON のテキスト）を読む。無ければ null。 */
export async function readPluginData(page: Page, id: string): Promise<string | null> {
  return page.evaluate(
    (id) =>
      new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open("modelith-plugins", 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction("data", "readonly").objectStore("data").get(id);
          get.onsuccess = () => {
            req.result.close();
            resolve((get.result as { json: string } | undefined)?.json ?? null);
          };
          get.onerror = () => reject(get.error);
        };
      }),
    id,
  );
}
