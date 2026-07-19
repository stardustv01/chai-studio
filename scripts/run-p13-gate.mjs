import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", ["install", "--frozen-lockfile", "--offline"]],
  ["program-source-monitor-contract", ["p13:contract"]],
  ["schema-generated-drift", ["schema:check"]],
  ["lint-format-boundaries", ["lint"]],
  ["strict-typecheck", ["typecheck"]],
  ["unit-tests", ["test:unit"]],
  ["property-fuzz-tests", ["test:property"]],
  ["integration-and-real-engines", ["test:integration"]],
  ["visual-manifest-tests", ["test:visual"]],
  ["golden-checksums", ["fixture:verify"]],
  ["browser-and-ui-goldens", ["test:e2e"]],
  ["production-build", ["build"]],
  ["security-check", ["security:check"]],
];
const implementationFiles = [
  "package.json",
  "apps/studio-web/src/App.tsx",
  "apps/studio-web/src/api-client.ts",
  "apps/studio-web/src/monitor-contract.ts",
  "apps/studio-web/src/program-monitor.tsx",
  "apps/studio-web/src/shortcuts.ts",
  "apps/studio-web/src/source-inspection-monitor.tsx",
  "apps/studio-web/src/styles.css",
  "apps/studio-web/src/types.ts",
  "apps/studio-web/src/use-studio-runtime.ts",
  "apps/studio-web/src/workspace-content.tsx",
  "packages/engine-adapters/src/remotion/renderer.ts",
  "tests/fixtures/remotion-adapter-fixtures.ts",
  "tests/unit/remotion-render-dependencies.test.ts",
  "tests/unit/web-monitor-contract.test.ts",
  "tests/e2e/local-shell.spec.ts",
  "tests/e2e/program-monitor.spec.ts",
  "tests/e2e/studio-visual.spec.ts",
  "tests/e2e/studio-visual.spec.ts-snapshots/p13-program-monitor-edit-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p13-program-monitor-overlays-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p13-program-monitor-difference-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p13-source-monitor-remotion-darwin.png",
  "scripts/validate-p08-web-contract.mjs",
  "scripts/validate-p13-monitor-contract.mjs",
  "pnpm-workspace.yaml",
];

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
    implementationFiles.map(async (relativePath) => [
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
  phase: "P13",
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
  phase: "P13",
  taskRange: "P13.01-P13.12",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
    uiGoldenCount: 4,
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p13");
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
      env: { ...process.env, CI: "true", HYPERFRAMES_NO_TELEMETRY: "1" },
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
