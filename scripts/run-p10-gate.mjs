import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", ["install", "--frozen-lockfile", "--offline"]],
  ["remotion-adapter-contract", ["p10:contract"]],
  ["schema-generated-drift", ["schema:check"]],
  ["lint-format-boundaries", ["lint"]],
  ["strict-typecheck", ["typecheck"]],
  ["unit-tests", ["test:unit"]],
  ["property-fuzz-tests", ["test:property"]],
  ["integration-and-real-remotion", ["test:integration"]],
  ["visual-manifest-tests", ["test:visual"]],
  ["golden-checksums", ["fixture:verify"]],
  ["browser-and-ui-goldens", ["test:e2e"]],
  ["production-build", ["build"]],
  ["security-check", ["security:check"]],
];
const implementationFiles = [
  "packages/engine-adapters/package.json",
  "packages/engine-adapters/src/index.ts",
  "packages/engine-adapters/src/remotion/contracts.ts",
  "packages/engine-adapters/src/remotion/runtime-contract.ts",
  "packages/engine-adapters/src/remotion/diagnostics.ts",
  "packages/engine-adapters/src/remotion/validation.ts",
  "packages/engine-adapters/src/remotion/discovery.ts",
  "packages/engine-adapters/src/remotion/player-host.ts",
  "packages/engine-adapters/src/remotion/node-runtime.ts",
  "packages/engine-adapters/src/remotion/png-normalization.ts",
  "packages/engine-adapters/src/remotion/renderer.ts",
  "packages/engine-adapters/src/remotion/dependencies.ts",
  "packages/engine-adapters/src/remotion/inspector.ts",
  "packages/engine-adapters/src/remotion/finishing.ts",
  "packages/engine-adapters/src/remotion/remotion-globals.d.ts",
  "types/remotion-timer.d.ts",
  "tests/fixtures/remotion-adapter-fixtures.ts",
  "tests/unit/remotion-discovery-validation.test.ts",
  "tests/unit/remotion-player-host.test.ts",
  "tests/unit/remotion-render-dependencies.test.ts",
  "tests/integration/remotion-real-runtime.test.ts",
  "scripts/validate-p10-remotion-contract.mjs",
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
  phase: "P10",
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
  phase: "P10",
  taskRange: "P10.01-P10.10",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
    remotionVersion: "4.0.489",
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p10");
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
