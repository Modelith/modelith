// package の無いファイルに、新しい package を作る（F-EDIT-7）。判断だけの純粋関数。

import { LAYOUT_RE, parse, type Entry } from "../core";

const NAME_RE = /^[A-Za-z_]\w*$/;

/** package の名前として使えるか（SysML v2 の基本名）。 */
export const isPackageName = (s: string): boolean => NAME_RE.test(s);

/** ファイル名から、package の名前の候補を作る（例: untitled-1.sysml → Untitled1、electric_kettle.sysml → ElectricKettle）。 */
export function packageNameFor(fileName: string): string {
  const base = fileName.replace(/\.(sysml|kerml)$/i, "");
  const name = base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return isPackageName(name) ? name : "Model";
}

/**
 * テキストの末尾（配置の `@layout` コメントがあればその前）に、空の package を足す。
 * 足した package の宣言（要素を入れる先）も返す。
 */
export function appendPackage(text: string, name: string): { text: string; pkg: Entry; at: number; len: number } {
  if (!isPackageName(name)) throw new Error(`「${name}」は package の名前に使えません`);
  const m = LAYOUT_RE.exec(text);
  const cut = m ? m.index : text.length;
  const before = text.slice(0, cut).replace(/\s*$/, "");
  const after = text.slice(cut);
  const head = before ? before + "\n\n" : "";
  const block = `package ${name} {\n}\n`;
  const next = head + block + (after ? "\n" + after : "");
  const pkg = parse(next).entries.find((e) => e.kind === "package" && e.name === name);
  if (!pkg) throw new Error(`package ${name} を作れませんでした`);
  return { text: next, pkg, at: head.length, len: block.length };
}
