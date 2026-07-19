import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", ["install", "--frozen-lockfile", "--offline"]],
  ["web-shell-contract", ["p08:contract"]],
  ["schema-generated-drift", ["schema:check"]],
  ["lint-format-boundaries", ["lint"]],
  ["strict-typecheck", ["typecheck"]],
  ["unit-tests", ["test:unit"]],
  ["property-fuzz-tests", ["test:property"]],
  ["integration-regression-tests", ["test:integration"]],
  ["visual-manifest-tests", ["test:visual"]],
  ["golden-checksums", ["fixture:verify"]],
  ["browser-and-ui-goldens", ["test:e2e"]],
  ["production-build", ["build"]],
  ["security-check", ["security:check"]],
];
const requiredImplementationFiles = [
  "apps/studio-web/STATE_ARCHITECTURE.md",
  "apps/studio-web/src/App.tsx",
  "apps/studio-web/src/ErrorBoundary.tsx",
  "apps/studio-web/src/api-client.ts",
  "apps/studio-web/src/event-stream.ts",
  "apps/studio-web/src/layout-store.ts",
  "apps/studio-web/src/performance.ts",
  "apps/studio-web/src/shortcuts.ts",
  "apps/studio-web/src/styles.css",
  "apps/studio-web/src/types.ts",
  "apps/studio-web/src/use-studio-runtime.ts",
  "apps/studio-web/src/workspace-content.tsx",
  "packages/ui-components/src/index.tsx",
  "tests/unit/web-api-client.test.ts",
  "tests/unit/web-event-stream.test.ts",
  "tests/unit/web-layout-shortcuts.test.ts",
  "tests/unit/ui-components.test.ts",
  "tests/e2e/local-shell.spec.ts",
  "tests/e2e/studio-visual.spec.ts",
  "scripts/validate-p08-web-contract.mjs",
];
const visualDirectory = path.join(root, "tests/e2e/studio-visual.spec.ts-snapshots");
const visualFiles = (await readdir(visualDirectory))
  .filter((file) => file.endsWith("-darwin.png"))
  .sort()
  .map((file) => path.join("tests/e2e/studio-visual.spec.ts-snapshots", file));
const identityFiles = [...requiredImplementationFiles, ...visualFiles];

const results = [];
for (const [name, arguments_] of checks) {
  const started = performance.now();
  const result = await run("corepack", ["pnpm", ...arguments_]);
  results.push({
    name,
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: result.stdout.slice(-16_000),
    stderr: result.stderr.slice(-16_000),
  });
  if (result.exitCode !== 0) break;
}

const fileHashes = Object.fromEntries(
  await Promise.all(
    identityFiles.map(async (relativePath) => [
      relativePath,
      createHash("sha256")
        .update(await readFile(path.join(root, relativePath)))
        .digest("hex"),
    ]),
  ),
);
const lockfileSha256 = createHash("sha256")
  .update(await readFile(path.join(root, "pnpm-lock.yaml")))
  .digest("hex");
const stableIdentityInput = {
  phase: "P08",
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  lockfileSha256,
  implementationFiles: fileHashes,
  checks: results.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })),
};
const report = {
  generatedAt: new Date().toISOString(),
  identity: createHash("sha256").update(JSON.stringify(stableIdentityInput)).digest("hex"),
  passed: results.length === checks.length && results.every((result) => result.passed),
  phase: "P08",
  taskRange: "P08.01-P08.10",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
    visualGoldenCount: visualFiles.length,
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p08");
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(path.join(evidenceDirectory, "gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      identity: report.identity,
      checks: results.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;

function run(command, arguments_) {
  return new Promise((resolve) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}
