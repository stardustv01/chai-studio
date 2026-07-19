import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", ["install", "--frozen-lockfile", "--offline"]],
  ["hyperframes-adapter-contract", ["p11:contract"]],
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
  "packages/engine-adapters/package.json",
  "packages/engine-adapters/src/index.ts",
  "packages/engine-adapters/src/hyperframes/contracts.ts",
  "packages/engine-adapters/src/hyperframes/diagnostics.ts",
  "packages/engine-adapters/src/hyperframes/parser.ts",
  "packages/engine-adapters/src/hyperframes/process-runtime.ts",
  "packages/engine-adapters/src/hyperframes/discovery.ts",
  "packages/engine-adapters/src/hyperframes/validation.ts",
  "packages/engine-adapters/src/hyperframes/player-host.ts",
  "packages/engine-adapters/src/hyperframes/renderer.ts",
  "packages/engine-adapters/src/hyperframes/dependencies.ts",
  "packages/engine-adapters/src/hyperframes/inspector.ts",
  "packages/engine-adapters/src/hyperframes/trust-policy.ts",
  "packages/engine-adapters/src/hyperframes/worker-router.ts",
  "tests/fixtures/hyperframes-adapter-fixtures.ts",
  "tests/unit/hyperframes-discovery-validation.test.ts",
  "tests/unit/hyperframes-player-host.test.ts",
  "tests/unit/hyperframes-render-dependencies.test.ts",
  "tests/unit/hyperframes-capability-upgrade.test.ts",
  "tests/integration/hyperframes-real-runtime.test.ts",
  "scripts/validate-p11-hyperframes-contract.mjs",
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
  phase: "P11",
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
  phase: "P11",
  taskRange: "P11.01-P11.10",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
    hyperframesVersion: "0.7.58",
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p11");
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
