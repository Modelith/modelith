// 配置ファイル（model.sysml の隣の model.layout.json、ADR-0005）の読み書き。判断だけの純粋関数。
// 差分とマージを読みやすくするため、キー順を固定し、要素ごとに 1 行で書く。

import { emptyView, layoutFromJson, layoutToJson, type Layout } from "./layout";

/** 配置ファイルの形式の版。形式を変えたら上げる。 */
export const LAYOUT_FORMAT = 1;

/**
 * オブジェクトの項目を、キーの文字コード順に並べた組の配列にする。
 *
 * @param o 並べるオブジェクト
 * @returns `[キー, 値]` の配列（キーの昇順）
 * @example
 * sortKeys({ b: 2, a: 1 }) // → [["a", 1], ["b", 2]]
 * sortKeys({})             // → []
 */
const sortKeys = <T>(o: Record<string, T>): [string, T][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * 値を、キー順を固定した 1 行の JSON にする（空白を入れない）。
 *
 * @param v JSON にできる値
 * @returns 1 行の JSON の文字列
 * @example
 * stable({ a2: ["r", 0.5], a1: ["l", 0.3] }) // → '{"a1":["l",0.3],"a2":["r",0.5]}'
 * stable(["a1", null])                       // → '["a1",null]'
 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${sortKeys(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v);
}

/**
 * 配置を、配置ファイル（`model.layout.json`、ADR-0005）の文字列にする。キー順を固定し、接続点・線の端は要素ごとに 1 行で書く。空のビューは書かない。
 *
 * @param layout ビューごとの配置
 * @returns 配置ファイルの中身（末尾に改行を付ける）。同じ配置なら作った順によらず同じ文字列
 * @example
 * serializeLayout({ trace: { pos: { B: [10, 20], A: [0, 0] }, pins: {}, ends: {} } })
 * // → '{\n  "modelith": "layout",\n  "format": 1,\n  "views": {\n    "trace": {\n      "A": [0,0],\n      "B": [10,20]\n    }\n  }\n}\n'
 * serializeLayout({}) // → '{\n  "modelith": "layout",\n  "format": 1,\n  "views": {}\n}\n'（境界値）
 */
export function serializeLayout(layout: Layout): string {
  const views = sortKeys(layoutToJson(layout)).filter(([, v]) => Object.keys(v).length);
  const view = ([vk, v]: [string, Record<string, unknown>]): string => {
    const lines = sortKeys(v).map(([k, x]) => {
      // 接続点・線の端は、要素ごとに 1 行にする
      if ((k === "@pins" || k === "@ends") && x && typeof x === "object") {
        const inner = sortKeys(x as Record<string, unknown>).map(([ik, ix]) => `        ${JSON.stringify(ik)}: ${stable(ix)}`);
        return `      ${JSON.stringify(k)}: {\n${inner.join(",\n")}\n      }`;
      }
      return `      ${JSON.stringify(k)}: ${stable(x)}`;
    });
    return `    ${JSON.stringify(vk)}: {\n${lines.join(",\n")}\n    }`;
  };
  const body = views.length ? `{\n${views.map(view).join(",\n")}\n  }` : "{}";
  return `{\n  "modelith": "layout",\n  "format": ${LAYOUT_FORMAT},\n  "views": ${body}\n}\n`;
}

/**
 * 配置ファイルを読む。空・壊れた内容・知らない形式なら、理由を添えて空の配置を返す。
 *
 * @param text 配置ファイルの中身
 * @returns 読んだ配置と、読めなかった理由（読めたとき・空のファイルは null）。例外は投げない
 * @example
 * parseLayoutFile(serializeLayout(L)) // → { layout: L, error: null }（空のビューを除く）
 * parseLayoutFile("  \n")             // → { layout: {}, error: null }（空のファイル）
 * parseLayoutFile("{ broken")         // → { layout: {}, error: "配置ファイルを読めません（JSON の形が壊れています）" }
 * parseLayoutFile('{"modelith":"layout","format":2,"views":{}}') // → { layout: {}, error: "配置ファイルの形式（2）に対応していません" }
 */
export function parseLayoutFile(text: string): { layout: Layout; error: string | null } {
  if (!text.trim()) return { layout: {}, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { layout: {}, error: "配置ファイルを読めません（JSON の形が壊れています）" };
  }
  const o = raw as { modelith?: unknown; format?: unknown; views?: unknown };
  if (o?.modelith !== "layout" || typeof o.views !== "object" || o.views === null) {
    return { layout: {}, error: "配置ファイルの形が違います" };
  }
  if (o.format !== LAYOUT_FORMAT) return { layout: {}, error: `配置ファイルの形式（${String(o.format)}）に対応していません` };
  return { layout: layoutFromJson(o.views as Record<string, unknown>), error: null };
}

/**
 * 配置が空か（どのビューにも座標・接続点・線の端が無い）を判定する。
 *
 * @param layout ビューごとの配置
 * @returns 空なら true。ビューが無いときも true
 * @example
 * isEmptyLayout({})                                     // → true（境界値）
 * isEmptyLayout({ v: { pos: {}, pins: {}, ends: {} } }) // → true
 * isEmptyLayout({ v: { pos: { A: [0, 0] }, pins: {}, ends: {} } }) // → false
 */
export const isEmptyLayout = (layout: Layout): boolean =>
  Object.values(layout).every((v) => !Object.keys(v.pos).length && !Object.keys(v.pins).length && !Object.keys(v.ends).length);

/**
 * ビューの配置を取り出す。無ければ空の配置を作って layout に足す（layout を書き換える）。
 *
 * @param layout ビューごとの配置
 * @param vk ビューのキー（`trace`・`ibd:<文脈>` など）
 * @returns そのビューの配置（layout の中のオブジェクトそのもの）
 * @example
 * viewOf({}, "trace") // → { pos: {}, pins: {}, ends: {} }（足した上で返す）
 */
export const viewOf = (layout: Layout, vk: string) => (layout[vk] ||= emptyView());
