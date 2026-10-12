// 統合テスト（e2e）。ビルドしたアプリをプレビューで配信し、Chromium で実際に操作する。
// File System Access API を使う要求があるため Chromium だけで動かす。
import { defineConfig, devices } from "@playwright/test";

const PORT = 4180;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // 不安定なテストは直す。再実行で隠さない
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://localhost:${PORT}/`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
