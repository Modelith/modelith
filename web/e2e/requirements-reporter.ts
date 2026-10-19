// Playwright のレポーター：テスト結果を要求ごとにまとめ、reports/requirements.{html,md} に書く。
// GitHub Actions の中では、同じ表をジョブのサマリにも出す。表を作る判断は tools/requirements-report.ts にある。
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Reporter, TestCase, TestResult as PwResult } from "@playwright/test/reporter";
import { summarize, toHtml, toMarkdown, type TestResult } from "../tools/requirements-report";
import { initSync } from "../src/core/wasm/modelith_core.js";

// 要求仕様を読むコアは Rust（wasm）。Node の中で先に読み込む（ADR-0015）
initSync({ module: readFileSync(new URL("../src/core/wasm/modelith_core_bg.wasm", import.meta.url)) });

const SPEC = new URL("../../docs/reference/requirements.sysml", import.meta.url);
const OUT = new URL("../reports/", import.meta.url);

export default class RequirementsReporter implements Reporter {
  private readonly results = new Map<string, TestResult>();

  onTestEnd(test: TestCase, result: PwResult): void {
    // 再実行があれば最後の結果を使う。基準（Chromium）以外のブラウザで動かしたテストは、ブラウザの名前を添えて分ける
    const browser = test.parent.project()?.name;
    const title = test.titlePath().slice(-2).join(" › ");
    this.results.set(test.id, { title: browser && browser !== "chromium" ? `${title}（${browser}）` : title, status: result.status });
  }

  onEnd(): void {
    const rows = summarize(readFileSync(SPEC, "utf8"), [...this.results.values()]);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const commit = process.env.GITHUB_SHA ?? safe(() => execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()) ?? "";
    const meta = { version: pkg.version, commit, date: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" };
    mkdirSync(OUT, { recursive: true });
    const md = toMarkdown(rows);
    writeFileSync(new URL("requirements.md", OUT), md);
    writeFileSync(new URL("requirements.html", OUT), toHtml(rows, meta));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
