import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportRoot = path.join(root, "reports", "junit");
const expectedSuites = [
  "unit",
  "property",
  "integration",
  "integration-remotion-real-runtime",
  "integration-hyperframes-real-runtime",
  "integration-native-composition-runtime",
  "visual",
  "coverage",
];

const expectedFiles = expectedSuites.map((suite) => `vitest-${suite}.xml`);
if (new Set(expectedFiles).size !== expectedFiles.length) {
  throw new Error("JUnit suite identities are not unique.");
}
const relativeToPlaywrightOutput = path.relative(path.join(root, "test-results"), reportRoot);
const playwrightCleanupIsolated =
  relativeToPlaywrightOutput === ".." || relativeToPlaywrightOutput.startsWith(`..${path.sep}`);
if (!playwrightCleanupIsolated) {
  throw new Error("JUnit reports must remain outside Playwright's cleaned test-results directory.");
}

const results = await Promise.all(
  expectedFiles.map(async (file) => {
    const absolutePath = path.join(reportRoot, file);
    await access(absolutePath);
    const contents = await readFile(absolutePath, "utf8");
    if (!contents.includes("<testsuites") && !contents.includes("<testsuite")) {
      throw new Error(`${file} is not a JUnit XML report.`);
    }
    return path.relative(root, absolutePath);
  }),
);

console.log(
  JSON.stringify(
    {
      passed: true,
      playwrightCleanupIsolated,
      reports: results,
    },
    null,
    2,
  ),
);
