import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const junitIdentity =
  process.env.CHAI_VITEST_SUITE ??
  process.argv
    .find((argument) => argument.startsWith("tests/"))
    ?.replace(/^tests\//u, "")
    .replace(/\.(?:test|spec)\.tsx?$/u, "")
    .replaceAll(/[^A-Za-z0-9_-]+/gu, "-") ??
  "vitest";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^react$/u,
        replacement: path.join(root, "apps/studio-web/node_modules/react/index.js"),
      },
      {
        find: /^react-dom\/server$/u,
        replacement: path.join(root, "apps/studio-web/node_modules/react-dom/server.js"),
      },
    ],
  },
  test: {
    environment: "node",
    passWithNoTests: false,
    reporters: ["default", "junit"],
    outputFile: { junit: `reports/junit/vitest-${junitIdentity}.xml` },
    coverage: {
      provider: "v8",
      reportsDirectory: "reports/coverage",
      reporter: ["text", "json-summary", "lcov"],
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/dist/**", "**/generated/**"],
      thresholds: {
        statements: 65,
        branches: 51,
        functions: 63,
        lines: 68,
      },
    },
  },
});
