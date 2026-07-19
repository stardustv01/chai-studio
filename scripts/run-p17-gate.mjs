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
  ["caption-contract", [["node", ["scripts/validate-p17-caption-contract.mjs"]]]],
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
  "eslint.config.mjs",
  "tsconfig.json",
  "tsconfig.base.json",
  "apps/studio-server/package.json",
  "apps/studio-server/tsconfig.json",
  "apps/studio-server/src/project-service.ts",
  "apps/studio-web/package.json",
  "apps/studio-web/tsconfig.json",
  "apps/studio-web/src/App.tsx",
  "apps/studio-web/src/styles.css",
  "apps/studio-web/src/transcript-caption-panel.tsx",
  "apps/studio-web/src/types.ts",
  "apps/studio-web/src/use-studio-runtime.ts",
  "apps/studio-web/src/workspace-content.tsx",
  "packages/captions/package.json",
  "packages/captions/tsconfig.json",
  "packages/captions/src/artifacts.ts",
  "packages/captions/src/commands.ts",
  "packages/captions/src/import.ts",
  "packages/captions/src/index.ts",
  "packages/captions/src/layout.ts",
  "packages/captions/src/navigation.ts",
  "packages/captions/src/qa.ts",
  "packages/captions/src/timing.ts",
  "packages/captions/src/validation.ts",
  "packages/schema/src/command-engine.ts",
  "packages/schema/src/command-envelope.ts",
  "packages/schema/src/generated/command-envelope-schema.ts",
  "packages/schema/src/generated/project-document-schemas.ts",
  "packages/schema/src/index.ts",
  "packages/schema/src/project-documents.ts",
  "packages/schema/src/project-folder.ts",
  "packages/schema/src/project-validation.ts",
  "packages/schema/src/source/command-envelope.schema.json",
  "packages/schema/src/source/project-documents.schema.json",
  "scripts/browser-isolation.mjs",
  "scripts/browser-isolation.d.mts",
  "scripts/security-check.mjs",
  "scripts/validate-browser-isolation.mjs",
  "scripts/validate-p17-caption-contract.mjs",
  "scripts/run-p17-gate.mjs",
  "tests/e2e/studio-visual.spec.ts",
  "tests/e2e/transcript-caption.spec.ts",
  "tests/e2e/studio-visual.spec.ts-snapshots/p08-media-workspace-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p13-source-monitor-remotion-darwin.png",
  "tests/e2e/studio-visual.spec.ts-snapshots/p17-transcript-caption-system-darwin.png",
  "tests/integration/language-document-command.test.ts",
  "tests/integration/transcript-timeline-actions.test.ts",
  "tests/integration/hyperframes-real-runtime.test.ts",
  "tests/integration/remotion-real-runtime.test.ts",
  "tests/property/caption-timing.property.test.ts",
  "tests/unit/captions-core.test.ts",
];
const uiGoldenDirectory = path.join(root, "tests/e2e/studio-visual.spec.ts-snapshots");
const uiGoldenFiles = (await readdir(uiGoldenDirectory))
  .filter((entry) => entry.endsWith("-darwin.png"))
  .sort();
for (const file of uiGoldenFiles) {
  const relativePath = path.relative(root, path.join(uiGoldenDirectory, file));
  if (!implementationFiles.includes(relativePath)) implementationFiles.push(relativePath);
}

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
  phase: "P17",
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  lockfileSha256,
  browserExecutable: isolatedChromiumExecutable,
  browserIdentity: isolatedChromiumIdentity,
  captionWordSampling: "latest-start-then-stable-id",
  implementationFiles: fileHashes,
  checks: results.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })),
};
const report = {
  generatedAt: new Date().toISOString(),
  identity: createHash("sha256").update(JSON.stringify(identityInput)).digest("hex"),
  passed: results.length === checks.length && results.every((result) => result.passed),
  phase: "P17",
  taskRange: "P17.01-P17.10",
  environment: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    lockfileSha256,
    p17UiGoldenCount: 1,
    totalUiGoldenCount: uiGoldenFiles.length,
    captionWordSampling: "latest-start-then-stable-id",
    browserPolicy: "playwright-managed-chromium-only",
    browserExecutable: isolatedChromiumExecutable,
    browserIdentity: isolatedChromiumIdentity,
  },
  implementationFiles: fileHashes,
  results,
};
const evidenceDirectory = path.join(root, "evidence/p17");
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
