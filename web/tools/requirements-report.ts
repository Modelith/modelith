// 要求ごとのテスト結果の表を作る（純粋関数）。e2e・UI テストのレポーターが使う。
// 要求の一覧と、どの検証（verification def）が結ばれているかは要求仕様（ADR-0011）から読む。

import { build, parse } from "../src/core";

/** 1 つのテストの結果。title に要求 ID（F-FILE-2 など）を書く約束。 */
export interface TestResult {
  title: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
}

export interface RequirementRow {
  id: string;
  name: string;
  doc: string;
  /** 要求仕様で verify している検証の名前。 */
  verifiedBy: string[];
  /** この要求 ID を名前に含むテストの結果。 */
  tests: TestResult[];
  state: "ok" | "failed" | "unverified" | "other-tests";
}

const ID_RE = /\b[FQC]-(?:[A-Z]+-)?\d+\b/g;

/**
 * テスト名に書かれた要求 ID（F-FILE-2・Q-5・C-3 など）を取り出す。
 *
 * @param title テストの名前
 * @returns 出てきた順の要求 ID（重複は除く）。無ければ空
 * @example
 * idsIn("F-VIEW-7・F-VIEW-3: 配置を保存する") // → ["F-VIEW-7", "F-VIEW-3"]
 * idsIn("起動する")                           // → []
 */
export const idsIn = (title: string): string[] => [...new Set(title.match(ID_RE) ?? [])];

/**
 * 要求仕様とテスト結果から、システム要求ごとの行を作る（利用者要求 N-* は除く）。
 * 実行したテストに失敗があれば failed、すべて合格なら ok、e2e が無く verify で結ばれていれば other-tests、どちらも無ければ unverified。
 *
 * @param spec 要求仕様（docs/reference/requirements.sysml）の全文
 * @param results e2e・UI テストの結果
 * @returns 要求仕様に書いた順の行
 * @example
 * summarize(spec, [{ title: "F-FILE-2: 保存できる", status: "passed" }])
 * // → [{ id: "F-FILE-2", …, tests: [その結果], state: "ok" }, …]
 */
export function summarize(spec: string, results: TestResult[]): RequirementRow[] {
  const P = parse(spec);
  const M = build(P);
  const nameOf = new Map(M.nodes.map((n) => [n.key, n.name]));
  return P.entries
    .filter((e) => e.kind === "requirement def" && e.short && !e.short.startsWith("N-"))
    .map((e) => {
      const verifiedBy = M.edges.filter((x) => x.kind === "verify" && x.to === e.name).map((x) => nameOf.get(x.from) ?? x.from);
      const tests = results.filter((r) => idsIn(r.title).includes(e.short));
      const ran = tests.filter((t) => t.status !== "skipped");
      const state: RequirementRow["state"] = ran.some((t) => t.status !== "passed")
        ? "failed"
        : ran.length
          ? "ok"
          : verifiedBy.length
            ? "other-tests"
            : "unverified";
      return { id: e.short, name: e.name, doc: e.doc ?? "", verifiedBy, tests, state };
    });
}

const MARK: Record<RequirementRow["state"], string> = { ok: "✅", failed: "❌", "other-tests": "☑️", unverified: "⚠️" };
const LABEL: Record<RequirementRow["state"], string> = {
  ok: "e2e・UI テストで合格",
  failed: "失敗あり",
  "other-tests": "単体・結合テストで検証",
  unverified: "未検証（未実装）",
};

/**
 * 状態ごとの件数を数える。
 *
 * @param rows 要求ごとの行
 * @returns 4 つの状態それぞれの件数（無い状態は 0）
 * @example
 * counts([{ …, state: "ok" }, { …, state: "ok" }]) // → { ok: 2, failed: 0, "other-tests": 0, unverified: 0 }
 */
export function counts(rows: RequirementRow[]): Record<RequirementRow["state"], number> {
  const c = { ok: 0, failed: 0, "other-tests": 0, unverified: 0 };
  for (const r of rows) c[r.state]++;
  return c;
}

/**
 * 要求の e2e・UI テストの合格数を「合格/実行」の形にする（飛ばしたテストは数えない）。
 *
 * @param r 要求の行
 * @returns `2/3` の形。実行したテストが無ければ「—」
 * @example
 * passRate({ …, tests: [passed, failed, skipped] }) // → "1/2"
 */
const passRate = (r: RequirementRow): string => {
  const ran = r.tests.filter((t) => t.status !== "skipped");
  return ran.length ? `${ran.filter((t) => t.status === "passed").length}/${ran.length}` : "—";
};

/**
 * GitHub の Markdown（Actions のサマリ）で、要求ごとの表を作る。
 *
 * @param rows 要求ごとの行
 * @returns 見出し・状態ごとの件数・表（要求・内容・結果・e2e・UI・検証）。表の中の `|` と改行は書き換える
 * @example
 * toMarkdown([{ id: "F-FILE-2", doc: "保存", state: "ok", tests: [合格 1], verifiedBy: [], … }])
 * // → "## 要求ごとのテスト結果\n\n✅ e2e・UI テストで合格: **1**…\n| F-FILE-2 | 保存 | ✅ | 1/1 | — |\n"
 */
export function toMarkdown(rows: RequirementRow[]): string {
  const c = counts(rows);
  const head =
    `## 要求ごとのテスト結果\n\n` +
    (Object.keys(c) as RequirementRow["state"][]).map((k) => `${MARK[k]} ${LABEL[k]}: **${c[k]}**`).join("　") +
    `\n\n| 要求 | 内容 | 結果 | e2e・UI | 検証（requirements.sysml） |\n| --- | --- | --- | --- | --- |\n`;
  const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return head + rows.map((r) => `| ${r.id} | ${esc(r.doc)} | ${MARK[r.state]} | ${passRate(r)} | ${r.verifiedBy.join(", ") || "—"} |`).join("\n") + "\n";
}

/**
 * HTML の特別な文字（`&`・`<`・`>`・`"`）を文字参照にする。
 *
 * @param s 書き出す文字列
 * @returns そのまま HTML に埋め込める文字列
 * @example
 * html('<a href="x">') // → "&lt;a href=&quot;x&quot;&gt;"
 */
const html = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);

/**
 * 要求ごとのテスト結果を、単独で開ける HTML にする（テストの詳細は e2e/index.html の Playwright レポートへリンクする）。
 *
 * @param rows 要求ごとの行
 * @param meta 版・コミット（先頭 7 文字を出す）・日付
 * @returns 明るい配色・暗い配色の両方に対応した HTML 文書の全文
 * @example
 * toHtml(rows, { version: "0.1.0-alpha.4", commit: "efc39c54f48c…", date: "2026-10-16" })
 * // → "<!doctype html>…<div class=\"meta\">0.1.0-alpha.4（efc39c5）・2026-10-16…"
 */
export function toHtml(rows: RequirementRow[], meta: { version: string; commit: string; date: string }): string {
  const c = counts(rows);
  const body = rows
    .map(
      (r) =>
        `<tr class="${r.state}"><td class="id">${html(r.id)}</td><td>${html(r.doc)}</td><td class="st">${MARK[r.state]} ${LABEL[r.state]}</td><td class="n">${passRate(r)}</td>` +
        `<td>${r.tests.map((t) => `<div class="t ${t.status}">${t.status === "passed" ? "✓" : t.status === "skipped" ? "–" : "✗"} ${html(t.title)}</div>`).join("") || "—"}</td>` +
        `<td>${html(r.verifiedBy.join(", ")) || "—"}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Modelith テスト結果（要求別）</title>
<style>
:root{--ink:#1D2733;--ink2:#5A6572;--rule:#CBD3D1;--ok:#387428;--ng:#C0392B;--warn:#95600F;--bg:#FFFFFF;--bg2:#F6F8F7}
@media (prefers-color-scheme: dark){:root{--ink:#E3E8ED;--ink2:#9AA6B2;--rule:#2F3943;--ok:#9BD48A;--ng:#FF7B6B;--warn:#E6B35C;--bg:#151A20;--bg2:#1C232B}}
body{margin:0;padding:24px 16px;font-family:system-ui,sans-serif;color:var(--ink);background:var(--bg);font-size:14px}
main{max-width:1200px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.meta{color:var(--ink2);font-size:12px;margin-bottom:16px}
.sum{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}.sum span{background:var(--bg2);border:1px solid var(--rule);border-radius:8px;padding:6px 10px}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:760px}th,td{border-bottom:1px solid var(--rule);padding:8px;text-align:left;vertical-align:top}
th{font-size:12px;color:var(--ink2);background:var(--bg2);position:sticky;top:0}.id{font-family:ui-monospace,monospace;white-space:nowrap}.n{white-space:nowrap}
.st{white-space:nowrap}.failed .st{color:var(--ng);font-weight:700}.unverified .st{color:var(--warn)}.ok .st{color:var(--ok)}
.t{font-size:12px;color:var(--ink2)}.t.failed,.t.timedOut,.t.interrupted{color:var(--ng);font-weight:700}a{color:inherit}
</style></head><body><main>
<h1>Modelith テスト結果（要求別）</h1>
<div class="meta">${html(meta.version)}（${html(meta.commit.slice(0, 7))}）・${html(meta.date)}・要求の定義は docs/reference/requirements.sysml</div>
<div class="sum">${(Object.keys(c) as RequirementRow["state"][]).map((k) => `<span>${MARK[k]} ${LABEL[k]}：<b>${c[k]}</b></span>`).join("")}</div>
<p>各テストの手順・画面・差分は <a href="e2e/index.html">Playwright のレポート</a> で確認できます。</p>
<div class="wrap"><table><thead><tr><th>要求</th><th>内容</th><th>状態</th><th>e2e・UI</th><th>テスト</th><th>検証（要求仕様）</th></tr></thead><tbody>
${body}
</tbody></table></div></main></body></html>
`;
}
