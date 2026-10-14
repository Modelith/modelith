// e2e の共通部品。
// ローカルフォルダの代わりに OPFS（ブラウザ内の本物のファイルシステム）を渡し、
// File System Access API のピッカーを、ダイアログを出さずに決まったフォルダ・ファイルを返すものに置き換える。
import { test as base, expect, type Page } from "@playwright/test";

/** ピッカーの置き換え（ブラウザ側で動く）。 */
function installPickers(): void {
  const w = window as unknown as Record<string, unknown> & { __e2e: { openFile?: string } };
  w.__e2e = {};
  const project = async (): Promise<FileSystemDirectoryHandle> =>
    (await navigator.storage.getDirectory()).getDirectoryHandle("project", { create: true });
  w["showDirectoryPicker"] = async () => project();
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

/** project フォルダ（OPFS）にファイルを置く。パスは a/b.sysml の形。 */
export async function putFiles(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("project", { create: true });
    for (const [path, text] of Object.entries(files)) {
      const segs = path.split("/");
      const name = segs.pop() as string;
      let d = root;
      for (const s of segs) d = await d.getDirectoryHandle(s, { create: true });
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    }
  }, files);
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

/** 図に描かれている要素のキー。 */
export const nodeKeys = (page: Page): Promise<string[]> =>
  page.locator("#gNodes .node, #gNodes .lifeline").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["key"] ?? ""));
