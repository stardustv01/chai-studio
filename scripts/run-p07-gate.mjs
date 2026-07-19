import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", ["install", "--frozen-lockfile", "--offline"]],
  ["server-contract", ["p07:contract"]],
  ["schema-generated-drift", ["schema:check"]],
  ["lint-format-boundaries", ["lint"]],
  ["strict-typecheck", ["typecheck"]],
  ["unit-tests", ["test:unit"]],
  ["property-fuzz-tests", ["test:property"]],
  ["integration-regression-tests", ["test:integration"]],
  ["visual-regression-tests", ["test:visual"]],
  ["golden-checksums", ["fixture:verify"]],
  ["production-build", ["build"]],
  ["security-check", ["security:check"]],
];
const requiredImplementationFiles = [
  "apps/studio-server/src/api-contract.ts",
  "apps/studio-server/src/request-security.ts",
  "apps/studio-server/src/instance-policy.ts",
  "apps/studio-server/src/project-service.ts",
  "apps/studio-server/src/job-registry.ts",
  "apps/studio-server/src/asset-service.ts",
  "apps/studio-server/src/preview-service.ts",
  "apps/studio-server/src/interaction-service.ts",
  "apps/studio-server/src/render-service.ts",
  "apps/studio-server/src/event-hub.ts",
  "apps/studio-server/src/worker-supervisor.ts",
  "apps/studio-server/src/regenerable-index.ts",
  "apps/studio-server/src/runtime-hygiene.ts",
  "apps/studio-server/src/index.ts",
  "packages/preview/src/session-state.ts",
  "packages/schema/src/command-engine.ts",
  "scripts/validate-p07-server-contract.mjs",
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
    stdout: result.stdout.slice(-14_000),
    stderr: result.stderr.slice(-14_000),
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
  phase: "P07",
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
  phase: "P07",
  taskRange: "P07.01-P07.12",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p07");
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
