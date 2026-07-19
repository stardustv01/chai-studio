import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = option("--engine");
const candidate = option("--candidate");
if (!["remotion", "hyperframes"].includes(engine))
  throw new Error("--engine must be remotion or hyperframes.");
const adapterPackage = JSON.parse(
  await readFile(path.join(root, "packages/engine-adapters/package.json"), "utf8"),
);
const pinned =
  engine === "remotion" ? adapterPackage.dependencies.remotion : adapterPackage.dependencies.hyperframes;
if (candidate !== pinned) {
  throw new Error(
    `Candidate ${candidate} is not the selected engine pin ${pinned}; update only that pin and lockfile in the isolated upgrade worktree first.`,
  );
}
const registryFile = path.join(root, "packages/engine-adapters/src/capabilities/initial-registry.ts");
const registryBefore = sha256(await readFile(registryFile));
const testFile =
  engine === "remotion"
    ? "tests/unit/remotion-discovery-validation.test.ts"
    : "tests/unit/hyperframes-capability-upgrade.test.ts";
const checks = [
  [
    "strict-adapter-types",
    "./node_modules/.bin/tsc",
    ["-b", "packages/engine-adapters", "--pretty", "false"],
  ],
  ["adapter-contract", "./node_modules/.bin/vitest", ["run", testFile]],
  ["golden-integrity", "node", ["scripts/verify-goldens.mjs"]],
  ["performance-budget", "node", ["scripts/run-p26-benchmarks.mjs"]],
  ["security", "node", ["scripts/security-check.mjs"]],
  ["license-review", "node", ["scripts/validate-p23-release-review.mjs"]],
];
const results = [];
for (const [name, command, arguments_] of checks) {
  const result = await run(command, arguments_);
  results.push({ name, passed: result.exitCode === 0, ...result });
  if (result.exitCode !== 0) break;
}
const registryAfter = sha256(await readFile(registryFile));
const receipt = {
  schemaVersion: "1.0.0",
  engine,
  candidate,
  selectedFamilyOnly: true,
  otherEnginePin:
    engine === "remotion" ? adapterPackage.dependencies.hyperframes : adapterPackage.dependencies.remotion,
  registryBefore,
  registryAfter,
  capabilityRegistryChanged: registryBefore !== registryAfter,
  audioSyncCoverage: "full P27 gate",
  realRuntimeCoverage: "full P27 gate",
  passed: results.length === checks.length && results.every((result) => result.passed),
  results,
};
await mkdir(path.join(root, "evidence/p27"), { recursive: true });
await writeFile(
  path.join(root, `evidence/p27/upgrade-${engine}-receipt.json`),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(
  JSON.stringify({ passed: receipt.passed, engine, candidate, checkCount: results.length }, null, 2),
);
if (!receipt.passed) process.exitCode = 1;

function option(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

function run(command, arguments_) {
  return new Promise((resolve) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: { ...process.env, CI: "true", HYPERFRAMES_NO_TELEMETRY: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? 1, stdout: stdout.slice(-8000), stderr: stderr.slice(-8000) }),
    );
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
