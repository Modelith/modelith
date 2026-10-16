// package の無いファイルに、新しい package を作る（F-EDIT-7）。判断だけの純粋関数。

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
