// GitHub Pages に公開する版を、公開の系列ごとに選ぶ（ADR-0020）。判断だけを置き、リリースの一覧は呼ぶ側（channels-cli.ts）が渡す。

/** GitHub のリリース 1 つ（`gh release list --json tagName,isDraft` の 1 行）。 */
export interface Release {
  tagName: string;
  isDraft: boolean;
}

/** 系列ごとに公開する版のタグ。公開できる版が無ければ null。 */
export interface Channels {
  /** 安定版（`/modelith/`）：最新の正式版。正式版が無ければ最新の rc。 */
  stable: string | null;
  /** プレリリース版（`/modelith/preview/`）：段階によらず最も新しい版。 */
  preview: string | null;
}

/** 版の並べ方に使う形（段階は alpha < beta < rc < 正式版）。 */
interface Parsed {
  tag: string;
  nums: [number, number, number];
  stage: number;
  n: number;
}

const STAGES: Record<string, number> = { alpha: 0, beta: 1, rc: 2 };
/** 正式版の段階の値（どの段階よりも後）。 */
const FINAL = 3;

/**
 * タグを、並べられる形にする。`v<MAJOR>.<MINOR>.<PATCH>` と、その後ろの `-alpha.N`・`-beta.N`・`-rc.N` だけを読む。
 *
 * @param tag リリースのタグ
 * @returns 並べられる形。版のタグでなければ null
 * @example
 * parseTag("v0.2.0-alpha.3") // → { tag: "v0.2.0-alpha.3", nums: [0, 2, 0], stage: 0, n: 3 }
 * parseTag("v0.1.0")         // → { tag: "v0.1.0", nums: [0, 1, 0], stage: 3, n: 0 }
 * parseTag("nightly")        // → null
 */
export function parseTag(tag: string): Parsed | null {
  const m = /^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(tag);
  if (!m) return null;
  const stage = m[4] === undefined ? FINAL : (STAGES[m[4]] ?? FINAL);
  return { tag, nums: [Number(m[1]), Number(m[2]), Number(m[3])], stage, n: Number(m[5] ?? 0) };
}

/**
 * 2 つの版の前後（SemVer の順）。
 *
 * @param a 版
 * @param b 版
 * @returns a が前なら負、後なら正、同じなら 0
 * @example
 * compare(parseTag("v0.1.0-rc.1"), parseTag("v0.1.0"))        // → 負（rc は正式版の前）
 * compare(parseTag("v0.2.0-alpha.1"), parseTag("v0.1.0"))     // → 正
 */
function compare(a: Parsed, b: Parsed): number {
  for (let i = 0; i < 3; i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d;
  }
  return a.stage - b.stage || a.n - b.n;
}

/**
 * 公開済みのリリースから、系列ごとに公開する版を選ぶ。下書きと、版のタグでないリリースは除く。
 *
 * @param releases リリースの一覧（順は問わない）
 * @returns 安定版とプレリリース版のタグ
 * @example
 * pickChannels([{ tagName: "v0.1.0-rc.1", isDraft: false }, { tagName: "v0.2.0-alpha.1", isDraft: false }])
 * // → { stable: "v0.1.0-rc.1", preview: "v0.2.0-alpha.1" }（正式版が無いので、安定版は最新の rc）
 * pickChannels([{ tagName: "v0.1.0", isDraft: false }, { tagName: "v0.2.0-rc.1", isDraft: false }])
 * // → { stable: "v0.1.0", preview: "v0.2.0-rc.1" }（正式版があれば rc は安定版にしない）
 * pickChannels([]) // → { stable: null, preview: null }
 */
export function pickChannels(releases: readonly Release[]): Channels {
  const all = releases
    .filter((r) => !r.isDraft)
    .flatMap((r) => parseTag(r.tagName) ?? [])
    .sort(compare);
  const newest = (xs: Parsed[]): string | null => xs.at(-1)?.tag ?? null;
  const finals = all.filter((p) => p.stage === FINAL);
  return {
    stable: newest(finals.length ? finals : all.filter((p) => p.stage === STAGES["rc"])),
    preview: newest(all),
  };
}
