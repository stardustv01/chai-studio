import { defineConfig } from "@playwright/test";

const serverPort = Number(process.env.CHAI_STUDIO_FIRST_RUN_SERVER_PORT ?? "45417");
const webPort = Number(process.env.CHAI_STUDIO_FIRST_RUN_WEB_PORT ?? "45273");

export default defineConfig({
  testDir: "./tests/e2e-first-run",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: "reports/playwright/first-run/results",
  reporter: [["list"], ["html", { outputFolder: "reports/playwright/first-run/html", open: "never" }]],
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${String(webPort)}`,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    command:
      `CHAI_STUDIO_FIRST_RUN_SERVER_PORT=${String(serverPort)} ` +
      `CHAI_STUDIO_FIRST_RUN_WEB_PORT=${String(webPort)} node scripts/start-first-run-e2e.mjs`,
    url: `http://127.0.0.1:${String(webPort)}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
