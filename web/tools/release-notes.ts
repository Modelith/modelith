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

/** 版（SemVer。`0.1.0-alpha.3` など）の形か。 */
export const isVersion = (v: string): boolean => /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v);

/** 段階の付いた版（alpha・beta・rc）か。GitHub のリリースではプレリリースにする。 */
export const isPrerelease = (v: string): boolean => v.includes("-");

/** 新しい版のリリースノートのひな形。`previous` があれば「前の版をお使いの方へ」の節を入れる。 */
export function skeleton(version: string, previous?: string): string {
  const upgrade = previous ? `## ${previous} をお使いの方へ\n\n- ${TODO}\n\n` : "";
  return `# Modelith ${version}\n\n${TODO}\n\n## 主な変更\n\n- ${TODO}：${TODO}\n\n${upgrade}${FOOTER}`;
}

/**
 * リリースノートの形を確かめ、問題を返す（空なら合格）。
 * 1 行目が `# Modelith <版>`、次に要約の段落、`## 主な変更` の箇条書き、任意で `## <前の版> をお使いの方へ`、最後に決まった部分。
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

/** 見出し `heading` の節の行（次の見出しの手前まで）。 */
function sectionBody(lines: string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** 版の並び（SemVer の大小）で、`version` の直前の版。無ければ undefined。 */
export function previousVersion(version: string, known: string[]): string | undefined {
  return known.filter((v) => compareVersions(v, version) < 0).sort(compareVersions).pop();
}

/** SemVer の大小（段階の付いた版は、付かない版より小さい）。 */
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
