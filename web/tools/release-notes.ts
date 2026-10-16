// リリースノートの定型（純粋関数）。ファイルの読み書きは release-notes-cli.ts が行う。
// 形は docs/development/releasing.md の「リリースノート」に従う。中身（要約・主な変更・前の版をお使いの方へ）は人かエージェントが書き、
// 決まった部分（ご注意・商標・ライセンス）はここから入れる。

/** すべての版に付ける、決まった部分。変えるときはここだけを直し、新しい版から反映する。 */
export const FOOTER = `## ご注意

- 開発中の版のため、操作方法や保存形式は予告なく変わることがあります。
- 本ソフトウェアは無保証です。
- フォルダを開いてファイルを直接保存できるのは、Chrome と Edge です。
- 保存先のないファイル（新規作成したファイルやサンプル）は、ブラウザ内に下書きとして一時的に残るだけです。必要なものは「名前を付けて保存」で保存してください。

## 商標

SysML® と OMG® は Object Management Group, Inc. の登録商標、KerML™ は同社の商標です。Modelith は OMG と関係がなく、その認定・推奨も受けていません。

## ライセンス

AGPL-3.0（Modelith Plugin Exception 付き）
Copyright (C) 2026 The Modelith Authors

不具合のご報告やご要望は、[GitHub Issues](https://github.com/modelith/modelith/issues/new/choose) にお寄せください。
`;

/** 書き手が埋める箇所の印。残っていれば検査で落とす。 */
export const TODO = "（ここに書く）";

/**
 * 版（SemVer。`0.1.0-alpha.3` など）の形か。
 *
 * @param v 調べる文字列
 * @returns `数.数.数` に、任意で `-段階`（英数字と `.`）が付いた形なら true
 * @example
 * isVersion("0.1.0-alpha.4") // → true
 * isVersion("v0.1.0")        // → false（先頭の v は付けない）
 */
export const isVersion = (v: string): boolean => /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v);

/**
 * 段階の付いた版（alpha・beta・rc）か。GitHub のリリースではプレリリースにする。
 *
 * @param v 版（`isVersion` が true になる形）
 * @returns `-` を含めば true
 * @example
 * isPrerelease("0.1.0-rc.1") // → true
 * isPrerelease("0.1.0")      // → false
 */
export const isPrerelease = (v: string): boolean => v.includes("-");

/**
 * 新しい版のリリースノートのひな形を作る。書き手が埋める箇所には「（ここに書く）」を入れる。
 *
 * @param version 出す版
 * @param previous 直前の版。あれば「## <前の版> をお使いの方へ」の節を入れる
 * @returns 見出し・要約・主な変更・（前の版の節）・決まった部分（FOOTER）を並べた Markdown
 * @example
 * skeleton("0.1.0-alpha.4", "0.1.0-alpha.3")
 * // → "# Modelith 0.1.0-alpha.4\n\n（ここに書く）\n\n## 主な変更\n\n- （ここに書く）：（ここに書く）\n\n## 0.1.0-alpha.3 をお使いの方へ\n…" + FOOTER
 */
export function skeleton(version: string, previous?: string): string {
  const upgrade = previous ? `## ${previous} をお使いの方へ\n\n- ${TODO}\n\n` : "";
  return `# Modelith ${version}\n\n${TODO}\n\n## 主な変更\n\n- ${TODO}：${TODO}\n\n${upgrade}${FOOTER}`;
}

/**
 * リリースノートの形を確かめ、問題を返す（空なら合格）。
 * 1 行目が `# Modelith <版>`、次に要約の段落、`## 主な変更` の箇条書き、任意で `## <前の版> をお使いの方へ`、最後に決まった部分。
 *
 * @param version ノートの版（1 行目と比べる）
 * @param text ノートの全文（改行は LF でも CRLF でもよい）
 * @returns 直すべきことの一覧（画面にそのまま出す文）。形が正しければ空
 * @example
 * validate("0.1.0-alpha.4", skeleton("0.1.0-alpha.4")) // → ["埋めていない箇所「（ここに書く）」が残っています"]
 * validate("0.1.0-alpha.4", "# Modelith 0.1.0\n…")     // → ["1 行目は「# Modelith 0.1.0-alpha.4」にしてください", …]
 */
export function validate(version: string, text: string): string[] {
  const problems: string[] = [];
  const body = text.replace(/\r\n/g, "\n");
  const lines = body.split("\n");
  if (lines[0] !== `# Modelith ${version}`) problems.push(`1 行目は「# Modelith ${version}」にしてください`);
  const firstSection = lines.findIndex((l) => l.startsWith("## "));
  const summary = lines.slice(1, firstSection < 0 ? undefined : firstSection).join("\n").trim();
  if (!summary) problems.push("1 行目の後に、この版の要約を 1 段落で書いてください");
  const sections = lines.filter((l) => l.startsWith("## "));
  const footerSections = FOOTER.split("\n").filter((l) => l.startsWith("## "));
  const own = sections.slice(0, sections.length - footerSections.length);
  if (own[0] !== "## 主な変更") problems.push("要約の次の節は「## 主な変更」にしてください");
  const extra = own.filter((s) => s !== "## 主な変更" && !/^## \d+\.\d+\.\d+\S* をお使いの方へ$/.test(s));
  if (extra.length) problems.push(`決まっていない節があります：${extra.join("、")}（使えるのは「## 主な変更」と「## <前の版> をお使いの方へ」）`);
  const changes = sectionBody(lines, "## 主な変更");
  if (!changes.some((l) => l.startsWith("- "))) problems.push("「## 主な変更」に箇条書き（- ）を 1 つ以上書いてください");
  if (!body.endsWith(FOOTER)) problems.push("最後は決まった部分（ご注意・商標・ライセンス）をそのまま付けてください（release-notes-cli.ts new で入ります）");
  if (body.includes(TODO)) problems.push(`埋めていない箇所「${TODO}」が残っています`);
  return problems;
}

/**
 * 見出しの節の本文の行を取り出す。
 *
 * @param lines ノートの行
 * @param heading 見出しの行（`## 主な変更` など。完全に一致するもの）
 * @returns 見出しの次の行から、次の `## ` 見出しの手前までの行。見出しが無ければ空
 * @example
 * sectionBody(["## 主な変更", "- a", "## 商標"], "## 主な変更") // → ["- a"]
 * sectionBody(["## 商標"], "## 主な変更")                     // → []
 */
function sectionBody(lines: string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/**
 * 版の並び（SemVer の大小）で、`version` の直前の版を探す。
 *
 * @param version 基準の版
 * @param known 知っている版（タグとノートから集めたもの。順不同・重複してよい）
 * @returns `version` より小さい版のうち最大のもの。無ければ undefined
 * @example
 * previousVersion("0.1.0-alpha.4", ["0.1.0-alpha.2", "0.1.0-alpha.3"]) // → "0.1.0-alpha.3"
 * previousVersion("0.1.0-alpha.1", [])                                // → undefined
 */
export function previousVersion(version: string, known: string[]): string | undefined {
  return known.filter((v) => compareVersions(v, version) < 0).sort(compareVersions).pop();
}

/**
 * SemVer の大小を比べる（段階の付いた版は、付かない版より小さい。段階は `.` ごとに、数は数として比べる）。
 *
 * @param a 比べる版
 * @param b 比べる版
 * @returns a が小さければ負、等しければ 0、大きければ正（`Array.prototype.sort` にそのまま渡せる）
 * @example
 * compareVersions("0.1.0-alpha.10", "0.1.0-alpha.9") // → 正（10 > 9）
 * compareVersions("0.1.0-rc.1", "0.1.0")             // → 負（段階の付いた版が小さい）
 * compareVersions("0.1.0", "0.1.0")                  // → 0
 */
export function compareVersions(a: string, b: string): number {
  const [ca = "", pa] = a.split(/-(.*)/s);
  const [cb = "", pb] = b.split(/-(.*)/s);
  const core = (s: string) => s.split(".").map(Number);
  const [x, y] = [core(ca), core(cb)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  if (pa === pb) return 0;
  if (pa === undefined) return 1;
  if (pb === undefined) return -1;
  const [ia, ib] = [pa.split("."), pb.split(".")];
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const [s, t] = [ia[i], ib[i]];
    if (s === undefined) return -1;
    if (t === undefined) return 1;
    if (s === t) continue;
    const [ns, nt] = [Number(s), Number(t)];
    if (!Number.isNaN(ns) && !Number.isNaN(nt)) return ns - nt;
    return s < t ? -1 : 1;
  }
  return 0;
}
