// 統合テスト（e2e）。ビルドしたアプリをプレビューで配信し、Chromium で実際に操作する。
// File System Access API を使う要求があるため、ほとんどのテストは Chromium だけで動かす。
// v1 のプラグインの隔離（ADR-0018 §3.1）は、ブラウザごとに違いがあるので、Firefox と WebKit でも動かす（テスト名の「隔離」のまとまり）。
// スマホ（F-EDIT-10）は、本物の端末の設定（画面の大きさ・タッチ・モバイルの表示）で、iPhone（WebKit）と Android（Chromium）でも動かす（e2e/mobile.spec.ts）。
import { defineConfig, devices } from "@playwright/test";

const PORT = 4180;
// 基準のブラウザ（Playwright の公式イメージの中。scripts/e2e.sh が起動する）。あればそこへつなぐ
const REFERENCE_WS = process.env.PW_REFERENCE_WS;

export default defineConfig({
  testDir: "e2e",
  // 画面は基準のブラウザ（Linux）で描くので、テストを動かす OS によらず同じ基準画像を使う
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{-projectName}-linux{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // 不安定なテストは直す。再実行で隠さない
  // 人が読むレポート：reports/e2e/（Playwright の HTML。手順・画面・UI の差分）と reports/requirements.html（要求別の表）
  reporter: [
    ["list"],
    ...(process.env.CI ? [["github"] as const] : []),
    ["html", { outputFolder: "reports/e2e", open: "never" }],
    ["./e2e/requirements-reporter.ts"],
  ],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // レポートで人が確かめられるよう、すべてのテストの最後の画面を残す。失敗したときは操作の記録（trace）も残す
    screenshot: "on",
    trace: "retain-on-failure",
    // 基準のブラウザから、手元で配信しているアプリ（localhost）を開けるようにする
    ...(REFERENCE_WS ? { connectOptions: { wsEndpoint: REFERENCE_WS, exposeNetwork: "<loopback>" } } : {}),
  },
  expect: {
    // UI テストの比較。アニメーションとカーソルを止める。画素ごとの色の差は 0.05 まで（アンチエイリアスの揺れ）許し、それを超える画素は 1 つも許さない
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", threshold: 0.05 },
  },
  projects: [
    { name: "chromium", testIgnore: "mobile.spec.ts", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } },
    ...(["firefox", "webkit"] as const).map((name) => ({
      name,
      testMatch: "script-plugins.spec.ts",
      grep: /隔離/,
      use: { ...devices[name === "firefox" ? "Desktop Firefox" : "Desktop Safari"], viewport: { width: 1400, height: 900 } },
    })),
    ...([["mobile-safari", "iPhone 13"], ["mobile-chrome", "Pixel 5"]] as const).map(([name, device]) => ({
      name,
      testMatch: "mobile.spec.ts",
      use: { ...devices[device] },
    })),
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
