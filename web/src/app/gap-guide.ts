// トレースの抜けの案内（F-TRACE-2）。サブバーの「トレースの抜け N 件」と問題一覧の抜けの行から、今いる画面に合わせて
// 図の要素かテキストの行へ移り、図ではインスペクタに足りない関係と直し方を示す。判断は trace-gap.ts にある。

import type { ModelNode, Problem } from "../core";
import { $, esc } from "./dom";
import { isNarrow, openTarget, openTab, renderSub, saveTabs, setTab } from "./panels";
import { centerOn, highlight, render, scrollEditorTo } from "./render";
import { renderInspector } from "./inspector";
import { clearSel, S } from "./state";
import { ensureLayout } from "./sync";
import { findGap, gapCountLabel, gapGuide, gapKind, gapMarks, gapNodeAt, gapScreen, stepGap, type GapKind } from "./trace-gap";
import { CC } from "./views";

/**
 * 今のモデルのトレースの抜けの問題を、問題一覧の順に返す。
 *
 * @returns 種類 `gap` の問題。無ければ空の配列
 * @example
 * // S.M.problems が [エラー, R の抜け, S の抜け]
 * gapProblems() // → [R の抜け, S の抜け]
 */
export const gapProblems = (): Problem[] => S.M.problems.filter((p) => p.kind === "gap");

/**
 * 抜けの位置から、そこに宣言がある図の要素のキーを引く（モデルの要素から）。
 *
 * @param pos 抜けの位置（UTF-16 の位置）
 * @returns 図の要素のキー。見つからなければ null
 * @example
 * // R の宣言が 120 から始まる
 * gapKeyAt(120) // → "R"
 * gapKeyAt(-1)  // → null
 */
const gapKeyAt = (pos: number): string | null => gapNodeAt(S.M.nodes, pos)?.key ?? null;

/**
 * 図の要素ごとの、抜けの印（△）のツールチップを作る（図を描くときに使う）。工程が無いモデルでは抜けを調べないので、空になる。
 *
 * @returns 要素のキー → ツールチップの文
 * @example
 * // R に検証の抜けがある
 * gapMarkTitles() // → Map { "R" => "トレースの抜け：\nこの要求を確かめる検証がありません" }
 */
export const gapMarkTitles = (): Map<string, string> => gapMarks(gapProblems(), gapKeyAt);

/**
 * 抜けへ移る。図が見えていれば図の要素を選んで、インスペクタと全体図に隠れない所の中央に出し、少しの間光らせ、インスペクタに案内を出す（テキストの行の印とスクロールも合わせる）。
 * テキストだけを見ているとき（狭い画面のテキストのタブ）や、図の要素が見つからないときは、テキストの行と問題一覧の行を示す。
 *
 * @param index 抜けの番号（gapProblems() の添字）。範囲の外なら何もしない
 */
export function goToGap(index: number): void {
  const g = gapProblems()[index];
  if (!g) return;
  const n = gapNodeAt(S.M.nodes, g.pos);
  if (!n || gapScreen(isNarrow(), $("#main").dataset["tab"]) === "text") {
    showGapInText(g);
    return;
  }
  revealNode(n);
  clearSel();
  S.sel = n.key;
  S.selSet = new Set([n.key]);
  S.textMark = [n.entry.start, n.entry.end];
  S.gap = { key: n.key, msg: g.msg };
  S.pulse = new Set([n.key]);
  render();
  highlight();
  scrollEditorTo(n.entry.start);
  renderInspector();
  centerOn(n.key, false, hiddenBottom());
}

/**
 * 図の下の端から、案内を出したインスペクタと全体図に隠れている高さを測る（要素を、その上の見えている所の中央に出すため）。
 *
 * @returns 隠れている高さ（px）。どちらも出ていなければ 0
 * @example
 * // 図の下の端が 800、インスペクタの上の端が 620、全体図の上の端が 470
 * hiddenBottom() // → 330
 * // インスペクタも全体図も隠している
 * hiddenBottom() // → 0
 */
function hiddenBottom(): number {
  const wrap = $("#wrap").getBoundingClientRect();
  const tops = ["#insp", "#mini"].flatMap((sel) => {
    const el = $(sel);
    return el.hidden ? [] : [el.getBoundingClientRect().top];
  });
  return tops.length ? Math.max(0, wrap.bottom - Math.min(...tops)) : 0;
}

/**
 * 抜けを、テキストの行と問題一覧の行で示す（テキストのパネルを見せ、その行へスクロールする）。
 *
 * @param g 抜けの問題
 */
function showGapInText(g: Problem): void {
  setTab("text");
  highlight();
  scrollEditorTo(g.pos);
  const row = [...$("#problems").querySelectorAll<HTMLElement>("button.gap")].find((b) => b.dataset["pos"] === String(g.pos));
  row?.scrollIntoView({ block: "nearest" });
}

/**
 * 要素が今の図に無ければ、その要素が載る図（要求ならトレーサビリティ）に切り替える。
 * 切り替えた先でも工程の絞り込みで隠れていれば、絞り込みを「すべて」に戻す。
 *
 * @param n 示す図の要素
 */
function revealNode(n: ModelNode): void {
  const shown = (): boolean => CC().nodes.some((x) => x.key === n.key);
  if (shown()) return;
  const ot = openTarget(n.entry);
  openTab(ot && !ot.mv ? ot.view : "trace", null, { keepSel: true });
  if (shown() || !S.phase) return;
  S.phase = "";
  ensureLayout();
  renderSub();
  saveTabs();
}

/**
 * インスペクタの案内の、前後のボタンの操作。前後の抜けへ移り（両端で回る）、押したボタンへ入力を戻す（Q-8）。
 * 案内している要素の抜けが解消していれば、残りの先頭の抜けへ移る。
 *
 * @param step 移る向き（1：次・-1：前）
 */
export function stepGapGuide(step: 1 | -1): void {
  const f = S.gap;
  if (!f) return;
  const found = findGap(gapProblems(), gapKeyAt, f);
  const next = "resolved" in found ? (found.total ? 0 : null) : stepGap(found.index, found.total, step);
  if (next === null) return;
  goToGap(next);
  const again = document.querySelector<HTMLElement>(`#insp [data-gap="${step > 0 ? "next" : "prev"}"]`) ?? document.querySelector<HTMLElement>("#insp .gapguide");
  again?.focus();
}

/**
 * 選んでいる要素で案内している抜けの種類を返す（「関係を追加」で、抜けを解消する関係を候補にするため）。
 *
 * @returns 抜けの種類。案内していない・解消した・種類の分からない抜けなら null
 * @example
 * // R を選び、R の検証の抜けを案内している
 * activeGapKind() // → "verify"
 * // 何も案内していない
 * activeGapKind() // → null
 */
export function activeGapKind(): GapKind | null {
  const f = S.gap;
  if (!f || f.key !== S.sel) return null;
  const found = findGap(gapProblems(), gapKeyAt, f);
  if ("resolved" in found) return null;
  const g = gapProblems()[found.index];
  return g ? gapKind(g.msg) : null;
}

/**
 * インスペクタに出す抜けの案内の HTML を作る。何件目か・前後のボタン（2 件以上のとき）・何が足りないかと直し方・「関係を追加」「テキストで見る」を並べる。
 * 案内している要素の抜けがすべて解消していれば、そのことと、残りがあれば次の抜けへのボタンを出す。
 *
 * @param n インスペクタに出している要素
 * @returns 案内の HTML。この要素の抜けを案内していなければ null
 * @example
 * // 3 件の抜けのうち、R の検証の抜け（1 件目）を案内している
 * gapGuideHtml(R) // → '<div class="gapguide" …><div class="gapnav">…1 / 3 件目…</div><p class="gaplack">この要求を確かめる検証がありません</p>…'
 * // R の抜けを解消し、残りが 2 件
 * gapGuideHtml(R) // → '<div class="gapguide" …>…この要素のトレースの抜けは解消しました（残り 2 件）…次の抜けへ…'
 * // 案内していない要素
 * gapGuideHtml(S) // → null
 */
export function gapGuideHtml(n: ModelNode): string | null {
  const f = S.gap;
  if (!f || f.key !== n.key) return null;
  const gaps = gapProblems();
  const found = findGap(gaps, gapKeyAt, f);
  const open = `<div class="gapguide" role="group" aria-label="トレースの抜けの案内" tabindex="-1">`;
  if ("resolved" in found) {
    return (
      open +
      `<div class="gapnav"><b>${found.total ? `この要素のトレースの抜けは解消しました（残り ${found.total} 件）` : "トレースの抜けはすべて解消しました"}</b></div>` +
      (found.total ? `<div class="acts"><button data-gap="next">次の抜けへ</button></div>` : "") +
      `</div>`
    );
  }
  const g = gaps[found.index];
  const t = gapGuide(gapKind(g?.msg ?? ""), g?.msg ?? "");
  const nav =
    found.total > 1
      ? `<button class="gapstep" data-gap="prev" aria-label="前の抜けへ" title="前の抜けへ">‹</button><button class="gapstep" data-gap="next" aria-label="次の抜けへ" title="次の抜けへ">›</button>`
      : "";
  return (
    open +
    `<div class="gapnav"><span class="gapmark" aria-hidden="true">△</span><b>トレースの抜け</b><span class="gapcount">${gapCountLabel(found.index, found.total)}</span>${nav}</div>` +
    `<p class="gaplack">${esc(t.lack)}</p><p class="gapfix">${esc(t.fix)}</p>` +
    `<div class="acts">${t.target ? `<button class="primary" data-act="connect">関係を追加</button>` : ""}<button data-act="goto">テキストで見る</button></div>` +
    `</div>`
  );
}
