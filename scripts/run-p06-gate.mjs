import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", ["install", "--frozen-lockfile", "--offline"]],
  ["media-fixture-contract", ["p06:fixtures"]],
  ["schema-generated-drift", ["schema:check"]],
  ["lint-format-boundaries", ["lint"]],
  ["strict-typecheck", ["typecheck"]],
  ["unit-tests", ["test:unit"]],
  ["property-fuzz-tests", ["test:property"]],
  ["integration-regression-tests", ["test:integration"]],
  ["visual-regression-tests", ["test:visual"]],
  ["golden-checksums", ["fixture:verify"]],
  ["production-build", ["build"]],
];
const requiredImplementationFiles = [
  "packages/media/src/asset-registry.ts",
  "packages/media/src/path-policy.ts",
  "packages/media/src/media-inspection.ts",
  "packages/media/src/asset-change-detection.ts",
  "packages/media/src/proxy-time-map.ts",
  "packages/media/src/proxy-manager.ts",
  "packages/media/src/proxy-jobs.ts",
  "packages/media/src/generated-views.ts",
  "packages/media/src/font-registry.ts",
  "packages/media/src/asset-index.ts",
  "packages/media/src/asset-workflows.ts",
  "packages/media/src/asset-curation.ts",
  "packages/media/src/asset-rights.ts",
  "packages/media/src/index.ts",
  "packages/media/README.md",
  "fixtures/deterministic/media/p06-media-cases.json",
  "scripts/validate-p06-media-fixtures.mjs",
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
    stdout: result.stdout.slice(-12_000),
    stderr: result.stderr.slice(-12_000),
  });
  if (result.exitCode !== 0) break;
}

const fileHashes = Object.fromEntries(
  await Promise.all(
    requiredImplementationFiles.map(async (relativePath) => [
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
  phase: "P06",
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
  phase: "P06",
  taskRange: "P06.01-P06.12",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p06");
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
