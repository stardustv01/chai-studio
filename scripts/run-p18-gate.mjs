import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { isolatedChromiumExecutable, isolatedChromiumIdentity } from "./browser-isolation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["frozen-offline-install", [["corepack", ["pnpm", "install", "--frozen-lockfile", "--offline"]]]],
  ["bridge-contract", [["node", ["scripts/validate-p18-bridge-contract.mjs"]]]],
  ["browser-isolation", [["node", ["scripts/validate-browser-isolation.mjs"]]]],
  ["schema-generated-drift", [["node", ["scripts/generate-schema-validator.mjs", "--check"]]]],
  [
    "lint-format-boundaries",
    [
      ["./node_modules/.bin/eslint", [".", "--max-warnings", "0"]],
      ["./node_modules/.bin/prettier", ["--check", "."]],
      ["node", ["scripts/check-package-boundaries.mjs"]],
    ],
  ],
  [
    "strict-typecheck",
    [
      ["./node_modules/.bin/tsc", ["-b", "--pretty", "false"]],
      ["./node_modules/.bin/tsc", ["-p", "tsconfig.tools.json", "--noEmit", "--pretty", "false"]],
    ],
  ],
  ["unit-tests", [["./node_modules/.bin/vitest", ["run", "tests/unit"]]]],
  ["property-fuzz-tests", [["./node_modules/.bin/vitest", ["run", "tests/property"]]]],
  [
    "ordinary-integration-tests",
    [
      [
        "./node_modules/.bin/vitest",
        [
          "run",
          "tests/integration",
          "--exclude",
          "tests/integration/remotion-real-runtime.test.ts",
          "--exclude",
          "tests/integration/hyperframes-real-runtime.test.ts",
        ],
      ],
    ],
  ],
  [
    "real-remotion-runtime",
    [["./node_modules/.bin/vitest", ["run", "tests/integration/remotion-real-runtime.test.ts"]]],
  ],
  [
    "real-hyperframes-runtime",
    [["./node_modules/.bin/vitest", ["run", "tests/integration/hyperframes-real-runtime.test.ts"]]],
  ],
  ["visual-manifest-tests", [["./node_modules/.bin/vitest", ["run", "tests/visual"]]]],
  ["golden-checksums", [["node", ["scripts/verify-goldens.mjs"]]]],
  ["browser-and-ui-goldens", [["./node_modules/.bin/playwright", ["test"]]]],
  [
    "production-build",
    [
      ["node", ["scripts/generate-schema-validator.mjs", "--check"]],
      ["./node_modules/.bin/tsc", ["-b"]],
      [
        "./node_modules/.bin/vite",
        ["build", "apps/studio-web", "--config", "apps/studio-web/vite.config.ts"],
      ],
    ],
  ],
  ["security-check", [["node", ["scripts/security-check.mjs"]]]],
];

const implementationFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "playwright.config.ts",
  "apps/studio-server/package.json",
  "apps/studio-server/tsconfig.json",
  "apps/studio-server/src/index.ts",
  "apps/studio-server/src/instance-policy.ts",
  "apps/studio-server/src/interaction-service.ts",
  "apps/studio-server/src/request-security.ts",
  "apps/studio-server/src/project-service.ts",
  "apps/studio-web/src/styles.css",
  "apps/studio-web/src/use-studio-runtime.ts",
  "apps/studio-web/src/workspace-content.tsx",
  "packages/bridge/package.json",
  "packages/bridge/src/annotations.ts",
  "packages/bridge/src/attachment.ts",
  "packages/bridge/src/authorization.ts",
  "packages/bridge/src/capture-jobs.ts",
  "packages/bridge/src/cli.ts",
  "packages/bridge/src/cli-runtime.ts",
  "packages/bridge/src/client.ts",
  "packages/bridge/src/discovery.ts",
  "packages/bridge/src/index.ts",
  "packages/bridge/src/manifests.ts",
  "packages/bridge/src/redaction.ts",
  "packages/schema/src/command-engine.ts",
  "packages/schema/src/command-envelope.ts",
  "packages/schema/src/generated/command-envelope-schema.ts",
  "packages/schema/src/generated/project-document-schemas.ts",
  "packages/schema/src/index.ts",
  "packages/schema/src/project-documents.ts",
  "packages/schema/src/project-validation.ts",
  "packages/schema/src/source/command-envelope.schema.json",
  "packages/schema/src/source/project-documents.schema.json",
  "scripts/browser-isolation.mjs",
  "scripts/security-check.mjs",
  "scripts/validate-browser-isolation.mjs",
  "scripts/validate-p18-bridge-contract.mjs",
  "scripts/run-p18-gate.mjs",
  "tests/e2e/studio-visual.spec.ts",
  "tests/integration/server-interaction-api.test.ts",
  "tests/integration/bridge-cli-control-loop.test.ts",
  "tests/integration/server-events-api.test.ts",
  "tests/unit/bridge-context-capture.test.ts",
];
const uiGoldenDirectory = path.join(root, "tests/e2e/studio-visual.spec.ts-snapshots");
const uiGoldenFiles = (await readdir(uiGoldenDirectory))
  .filter((entry) => entry.endsWith("-darwin.png"))
  .sort();
for (const file of uiGoldenFiles)
  implementationFiles.push(path.relative(root, path.join(uiGoldenDirectory, file)));

const results = [];
for (const [name, commandSequence] of checks) {
  const started = performance.now();
  const outputs = [];
  let exitCode = 0;
  for (const [command, arguments_] of commandSequence) {
    const output = await run(command, arguments_);
    outputs.push(output);
    exitCode = output.exitCode;
    if (exitCode !== 0) break;
  }
  results.push({
    name,
    passed: exitCode === 0,
    exitCode,
    durationMs: Math.round(performance.now() - started),
    stdout: outputs
      .map((output) => output.stdout)
      .join("\n")
      .slice(-16_000),
    stderr: outputs
      .map((output) => output.stderr)
      .join("\n")
      .slice(-16_000),
  });
  if (exitCode !== 0) break;
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
const identityInput = {
  phase: "P18",
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  lockfileSha256,
  browserExecutable: isolatedChromiumExecutable,
  browserIdentity: isolatedChromiumIdentity,
  contextSchemaVersion: "1.0.0",
  captureSchemaVersion: "1.0.0",
  implementationFiles: fileHashes,
  checks: results.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })),
};
const report = {
  generatedAt: new Date().toISOString(),
  identity: createHash("sha256").update(JSON.stringify(identityInput)).digest("hex"),
  passed: results.length === checks.length && results.every((result) => result.passed),
  phase: "P18",
  taskRange: "P18.01-P18.14",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
    p18UiGoldenCount: uiGoldenFiles.filter((file) => file.startsWith("p18-")).length,
    totalUiGoldenCount: uiGoldenFiles.length,
    browserPolicy: "playwright-managed-chromium-only",
    browserExecutable: isolatedChromiumExecutable,
    browserIdentity: isolatedChromiumIdentity,
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p18");
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
      env: { ...process.env, CI: "true", HYPERFRAMES_NO_TELEMETRY: "1", FORCE_COLOR: "0" },
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
