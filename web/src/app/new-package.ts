// package の無いファイルに、新しい package を作る（F-EDIT-7）。判断だけの純粋関数。

const NAME_RE = /^[A-Za-z_]\w*$/;

/**
 * package の名前として使えるか（SysML v2 の基本名：英字か `_` で始まる英数字と `_`）を判定する。
 *
 * @param s 調べる名前
 * @returns 使えるなら true。空文字列・数字で始まる・記号や日本語を含むなら false
 * @example
 * isPackageName("Kettle") // → true
 * isPackageName("_k2")    // → true
 * isPackageName("2k")     // → false（数字で始まる）
 * isPackageName("")       // → false（境界値）
 */
export const isPackageName = (s: string): boolean => NAME_RE.test(s);

/**
 * ファイル名から、package の名前の候補を作る（F-EDIT-7）。拡張子 `.sysml`・`.kerml` を除き、英数字以外で区切った語の頭を大文字にしてつなぐ。
 *
 * @param fileName ファイル名（`untitled-1.sysml` など。フォルダは含めない）
 * @returns package の名前の候補。名前として使えない（英数字が無い・数字で始まる）ときは "Model"
 * @example
 * packageNameFor("untitled-1.sysml")      // → "Untitled1"
 * packageNameFor("electric_kettle.sysml") // → "ElectricKettle"
 * packageNameFor("1st.sysml")             // → "Model"（数字で始まる）
 * packageNameFor("設計.sysml")            // → "Model"（英数字が無い）
 */
export function packageNameFor(fileName: string): string {
  const base = fileName.replace(/\.(sysml|kerml)$/i, "");
  const name = base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return isPackageName(name) ? name : "Model";
}
