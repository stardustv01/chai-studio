import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-authenticated",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  outputDir: "reports/playwright/authenticated/results",
  reporter: [["list"], ["html", { outputFolder: "reports/playwright/authenticated/html", open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:44273",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command: "CI=true corepack pnpm build && node scripts/start-authenticated-e2e.mjs",
    url: "http://127.0.0.1:44273",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
