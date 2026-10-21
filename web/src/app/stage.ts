// 版の名前（0.1.0-beta.1 など）から、見出しの札と「ヘルプ」に出す開発段階を決める。

/** 開発段階の表示。札の文字と、札のツールチップ・「ヘルプ」に添える説明。 */
export interface StageLabel {
  badge: string;
  note: string;
}

/**
 * 版の名前から、開発段階の表示を決める。プレリリース（alpha・beta・rc）でなければ表示しない。
 *
 * @param version 版の名前（SemVer）
 * @returns 開発段階の表示。正式版や読めない版なら null
 * @example
 * stageLabel("0.1.0-alpha.10") // → { badge: "alpha", note: "開発中の alpha 版" }
 * stageLabel("0.1.0-beta.1")   // → { badge: "beta", note: "機能を固定した beta 版" }
 * stageLabel("0.1.0-rc.1")     // → { badge: "rc", note: "正式版の候補（rc）" }
 * stageLabel("0.1.0")          // → null
 */
export function stageLabel(version: string): StageLabel | null {
  const pre = /^\d+\.\d+\.\d+-([a-z]+)/.exec(version)?.[1];
  if (pre === "alpha") return { badge: "alpha", note: "開発中の alpha 版" };
  if (pre === "beta") return { badge: "beta", note: "機能を固定した beta 版" };
  if (pre === "rc") return { badge: "rc", note: "正式版の候補（rc）" };
  return null;
}
