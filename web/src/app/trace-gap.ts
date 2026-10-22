// トレースの抜けの案内（F-TRACE-2）の判断。DOM と状態には触れず、問題の位置と文から、
// 図の要素・抜けの種類・案内の文・何件目に移るか・移る先の画面を決める。

/**
 * 抜けの種類。`expand` は下位の要求への展開（最上位の工程の要求）、`source` は導出元の上位の要求、
 * `satisfy` は要求を満たす要素、`verify` は要求を確かめる検証が無いこと。
 */
export type GapKind = "expand" | "source" | "satisfy" | "verify";

/** 位置の範囲を持つ図の要素（ModelNode のうち、ここで使う所だけ）。 */
export interface RangedNode {
  key: string;
  entry: { start: number; end: number };
}

/** トレースの抜けの問題（Problem のうち、ここで使う所だけ）。 */
export interface GapProblem {
  pos: number;
  msg: string;
}

/**
 * 抜けの位置に宣言がある図の要素を引く。位置を範囲に含む要素のうち、最も内側（始まりが最も後ろ）の要素にする。
 *
 * @param nodes 図の要素（モデルの要素）
 * @param pos 抜けの位置（UTF-16 の位置。コアは要求の宣言の始まりを入れる）
 * @returns 図の要素。範囲に含む要素が無ければ null
 * @example
 * // R が 10〜40、その中の S が 20〜30
 * gapNodeAt([R, S], 10) // → R（宣言の始まり）
 * gapNodeAt([R, S], 25) // → S（最も内側）
 * gapNodeAt([R, S], 40) // → null（終わりは含まない）
 * gapNodeAt([], 0)      // → null
 */
export function gapNodeAt<N extends RangedNode>(nodes: readonly N[], pos: number): N | null {
  let best: N | null = null;
  for (const n of nodes) {
    const { start, end } = n.entry;
    if (start <= pos && pos < end && (!best || start > best.entry.start)) best = n;
  }
  return best;
}

/**
 * 抜けの問題の文から、抜けの種類を決める。コアの文の末尾の括弧（derivation・satisfy・verify）と、展開か導出元かの言葉で見分ける。
 *
 * @param msg 抜けの問題の文（`K3 DryBoilCutoffReq：この要求を確かめる検証がありません（verify）` など）
 * @returns 抜けの種類。知らない文なら null
 * @example
 * gapKind("N1 Need：どの下位の要求にも展開されていません（derivation）") // → "expand"
 * gapKind("R1 Req：導出元の上位の要求がありません（derivation）")       // → "source"
 * gapKind("R1 Req：この要求を満たす要素がありません（satisfy）")        // → "satisfy"
 * gapKind("R1 Req：この要求を確かめる検証がありません（verify）")       // → "verify"
 * gapKind("参照先が見つかりません")                                     // → null
 */
export function gapKind(msg: string): GapKind | null {
  if (msg.endsWith("（verify）")) return "verify";
  if (msg.endsWith("（satisfy）")) return "satisfy";
  // 要求の名前に同じ言葉が入っていても見誤らないよう、コアの文の末尾で見分ける
  if (msg.endsWith("下位の要求にも展開されていません（derivation）")) return "expand";
  return msg.endsWith("（derivation）") ? "source" : null;
}

/** 抜けの種類ごとの案内の文（何が足りないか・直し方・関係を追加するときにつなぐ相手）。 */
const GUIDE: Record<GapKind, { lack: string; fix: string; target: string }> = {
  expand: {
    lack: "この要求は、どの下位の要求にも展開されていません",
    fix: "「関係を追加」を押して、ここから導き出す下位の要求を選ぶと解消します（derivation）",
    target: "下位の要求",
  },
  source: {
    lack: "この要求の導出元になる上位の要求がありません",
    fix: "「関係を追加」を押して、導出元の上位の要求を選ぶと解消します（derivation）",
    target: "上位の要求",
  },
  satisfy: {
    lack: "この要求を満たす部品がありません",
    fix: "「関係を追加」を押して、この要求を満たす部品を選ぶと解消します（satisfy）",
    target: "部品",
  },
  verify: {
    lack: "この要求を確かめる検証がありません",
    fix: "「関係を追加」を押して、検証の要素を選ぶと解消します（verify）",
    target: "検証の要素",
  },
};

/**
 * 抜けの案内の文を返す。何が足りないか・直し方・「関係を追加」でつなぐ相手の呼び方を、図の言葉で書く（SysML v2 の用語は括弧の補足）。
 *
 * @param kind 抜けの種類。null（知らない文）なら、テキストで確かめるよう案内する
 * @param msg 抜けの問題の文（種類が分からないときに、そのまま見せる）
 * @returns 何が足りないか（lack）・直し方（fix）・つなぐ相手（target。種類が分からなければ null）
 * @example
 * gapGuide("verify", "…") // → { lack: "この要求を確かめる検証がありません", fix: "「関係を追加」を押して、検証の要素を選ぶと解消します（verify）", target: "検証の要素" }
 * gapGuide(null, "R：何か")  // → { lack: "R：何か", fix: "「テキストで見る」で、該当の行を確かめてください", target: null }
 */
export function gapGuide(kind: GapKind | null, msg: string): { lack: string; fix: string; target: string | null } {
  if (!kind) return { lack: msg, fix: "「テキストで見る」で、該当の行を確かめてください", target: null };
  return GUIDE[kind];
}

/**
 * 図の要素ごとに、抜けの印（△）のツールチップを作る。1 つの要素に複数の抜けがあれば、行を分けて並べる。
 *
 * @param gaps 抜けの問題（問題一覧の順）
 * @param keyAt 抜けの位置から図の要素のキーを引く関数（見つからなければ null）
 * @returns 要素のキー → ツールチップの文。抜けが無ければ空の Map
 * @example
 * // R に検証と満たす部品の抜け、S に導出元の抜けがある
 * gapMarks(gaps, keyAt) // → Map { "R" => "トレースの抜け：\nこの要求を満たす部品がありません\nこの要求を確かめる検証がありません", "S" => "トレースの抜け：\nこの要求の導出元になる上位の要求がありません" }
 * gapMarks([], keyAt)   // → Map {}
 */
export function gapMarks(gaps: readonly GapProblem[], keyAt: (pos: number) => string | null): Map<string, string> {
  const lines = new Map<string, string[]>();
  for (const g of gaps) {
    const key = keyAt(g.pos);
    if (!key) continue;
    const list = lines.get(key) ?? [];
    list.push(gapGuide(gapKind(g.msg), g.msg).lack);
    lines.set(key, list);
  }
  return new Map([...lines].map(([k, ls]) => [k, ["トレースの抜け：", ...ls].join("\n")]));
}

/**
 * 前後のボタンで移る先の番号を決める。両端で回る（最後の次は先頭、先頭の前は最後）。
 *
 * @param index 今の番号（0 から）。範囲の外なら、範囲に収めてから移る
 * @param total 抜けの件数
 * @param step 移る向き（1：次・-1：前）
 * @returns 移る先の番号。抜けが無ければ null
 * @example
 * stepGap(0, 3, 1)  // → 1
 * stepGap(2, 3, 1)  // → 0（最後の次は先頭）
 * stepGap(0, 3, -1) // → 2（先頭の前は最後）
 * stepGap(0, 1, 1)  // → 0（1 件なら同じ所）
 * stepGap(5, 3, 1)  // → 0（範囲の外の 5 は 2 に収めてから次へ）
 * stepGap(0, 0, 1)  // → null
 */
export function stepGap(index: number, total: number, step: 1 | -1): number | null {
  if (total <= 0) return null;
  const cur = Math.min(Math.max(0, index), total - 1);
  return (cur + step + total) % total;
}

/**
 * 何件目かの表示（「1 / 3 件目」）を作る。
 *
 * @param index 番号（0 から）
 * @param total 抜けの件数
 * @returns 表示の文
 * @example
 * gapCountLabel(0, 3) // → "1 / 3 件目"
 * gapCountLabel(2, 3) // → "3 / 3 件目"
 */
export const gapCountLabel = (index: number, total: number): string => `${index + 1} / ${total} 件目`;

/**
 * 抜けへ移るときに、どちらの画面で示すかを決める。図が見えていれば図、テキストだけを見ていればテキストにする。
 * 広い画面では図がいつも見えている。狭い画面では、見ているタブで決める。
 *
 * @param narrow 狭い画面（タブで切り替える画面）か
 * @param tab 狭い画面で見ているタブ（`tree`・`diagram`・`text`。分からなければ undefined）
 * @returns 示す画面（`diagram`・`text`）
 * @example
 * gapScreen(false, "text")   // → "diagram"（広い画面では図が見えている）
 * gapScreen(true, "diagram") // → "diagram"
 * gapScreen(true, "text")    // → "text"
 * gapScreen(true, "tree")    // → "text"（図が見えていない）
 */
export function gapScreen(narrow: boolean, tab: string | undefined): "diagram" | "text" {
  return !narrow || tab === "diagram" ? "diagram" : "text";
}

/** 案内している抜け（図の要素のキーと、問題の文）。テキストが変わって位置がずれても、同じ抜けを探せるようにキーで持つ。 */
export interface GapFocus {
  key: string;
  msg: string;
}

/**
 * 案内している抜けの、今のモデルでの番号を探す。同じ要素の同じ文の抜けがあればそれ、解消していれば同じ要素の別の抜け、
 * それも無ければ解消済み（resolved）にする。
 *
 * @param gaps 今の抜けの問題（問題一覧の順）
 * @param keyAt 抜けの位置から図の要素のキーを引く関数（見つからなければ null）
 * @param focus 案内している抜け
 * @returns 抜けの番号と件数。要素の抜けがすべて解消していれば resolved と残りの件数
 * @example
 * // 抜けが [R の verify, S の source]
 * findGap(gaps, keyAt, { key: "S", msg: "…（derivation）" }) // → { index: 1, total: 2 }
 * // R の verify を解消した後（抜けは [S の source]）
 * findGap(gaps, keyAt, { key: "R", msg: "…（verify）" })     // → { resolved: true, total: 1 }
 */
export function findGap(
  gaps: readonly GapProblem[],
  keyAt: (pos: number) => string | null,
  focus: GapFocus,
): { index: number; total: number } | { resolved: true; total: number } {
  const total = gaps.length;
  const keys = gaps.map((g) => keyAt(g.pos));
  const same = gaps.findIndex((g, i) => keys[i] === focus.key && g.msg === focus.msg);
  if (same >= 0) return { index: same, total };
  const other = keys.indexOf(focus.key);
  return other >= 0 ? { index: other, total } : { resolved: true, total };
}

/** 抜けを解消する関係の候補。reverse なら、関係の元は相手（押した要素）で、先が抜けのある要素になる。 */
export interface GapRelChoice {
  rel: "satisfy" | "verify" | "derive";
  label: string;
  reverse: boolean;
}

/** 関係の相手になる図の要素（ModelNode のうち、ここで使う所だけ）。 */
export interface RelEnd {
  key: string;
  kind: string;
  usage?: boolean;
  lifeline?: boolean;
  note?: boolean;
  junction?: boolean;
  flow?: boolean;
  state?: boolean;
}

/**
 * 案内から「関係を追加」を始めたときに、抜けのある要素と押した要素の間で、抜けを解消できる関係を返す。
 * 検証・満たす部品・下位の要求への展開は、押した要素から抜けのある要素への関係になる（reverse）。
 *
 * @param kind 抜けの種類
 * @param a 抜けのある要素（要求定義）
 * @param b 押した要素
 * @returns 関係の候補（無ければ空の配列）
 * @example
 * gapRelOptions("verify", R, V)  // → [{ rel: "verify", label: "この検証で確かめる «verify»", reverse: true }]（V は verification def）
 * gapRelOptions("source", R, S)  // → [{ rel: "derive", label: "この上位の要求から導出する «derive»", reverse: false }]
 * gapRelOptions("verify", R, P)  // → []（P は part def）
 * gapRelOptions("source", R, R)  // → []（自分自身）
 */
export function gapRelOptions(kind: GapKind, a: RelEnd, b: RelEnd): GapRelChoice[] {
  if (a.key === b.key || b.usage || b.lifeline || b.note || b.junction || b.flow || b.state) return [];
  if (kind === "verify") return b.kind === "verification def" ? [{ rel: "verify", label: "この検証で確かめる «verify»", reverse: true }] : [];
  if (kind === "satisfy") return /^part/.test(b.kind) ? [{ rel: "satisfy", label: "この部品で満たす «satisfy»", reverse: true }] : [];
  if (b.kind !== "requirement def") return [];
  return kind === "source"
    ? [{ rel: "derive", label: "この上位の要求から導出する «derive»", reverse: false }]
    : [{ rel: "derive", label: "この下位の要求へ展開する «derive»", reverse: true }];
}
