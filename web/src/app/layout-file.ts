// 配置ファイル（model.sysml の隣の model.layout.json、ADR-0005）の読み書き。判断だけの純粋関数。
// 差分とマージを読みやすくするため、キー順を固定し、要素ごとに 1 行で書く。

import { emptyView, layoutFromJson, layoutToJson, type Layout } from "./layout";

/** 配置ファイルの形式の版。形式を変えたら上げる。 */
export const LAYOUT_FORMAT = 1;

const sortKeys = <T>(o: Record<string, T>): [string, T][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** キー順を固定した 1 行の JSON。 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${sortKeys(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v);
}

/** 配置を、配置ファイルの文字列にする。空のビューは書かない。 */
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

/** 配置ファイルを読む。空・壊れた内容・知らない形式なら、理由を添えて空の配置を返す。 */
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

/** 配置が空か（どのビューにも座標・接続点・線の端が無い）。 */
export const isEmptyLayout = (layout: Layout): boolean =>
  Object.values(layout).every((v) => !Object.keys(v.pos).length && !Object.keys(v.pins).length && !Object.keys(v.ends).length);

/** ビューの配置を取り出す（無ければ作る）。 */
export const viewOf = (layout: Layout, vk: string) => (layout[vk] ||= emptyView());
