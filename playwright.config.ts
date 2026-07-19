import { defineConfig } from "@playwright/test";

const serverPort = boundedPort(process.env.CHAI_STUDIO_E2E_SERVER_PORT, 44_317);
const webPort = boundedPort(process.env.CHAI_STUDIO_E2E_WEB_PORT, 44_173);

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: "reports/playwright/fixture/results",
  reporter: [["list"], ["html", { outputFolder: "reports/playwright/fixture/html", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(webPort)}`,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        `CHAI_STUDIO_RUNTIME_DIRECTORY=/private/tmp/chai-studio-e2e-${String(serverPort)} ` +
        `CHAI_STUDIO_PORT=${String(serverPort)} node apps/studio-server/dist/index.js`,
      url: `http://127.0.0.1:${String(serverPort)}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        `CHAI_STUDIO_UI_FIXTURE_MODE=1 CHAI_STUDIO_SERVER_ORIGIN=http://127.0.0.1:${String(serverPort)} ` +
        `./node_modules/.bin/vite apps/studio-web --config apps/studio-web/vite.config.ts --host 127.0.0.1 --port ${String(webPort)}`,
      url: `http://127.0.0.1:${String(webPort)}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});

function boundedPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error(`Invalid Playwright loopback port: ${value}`);
  }
  return parsed;
}
