import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  isolatedChromiumExecutable,
  isolatedChromiumIdentity,
  isolatedEngineExecutable,
  isolatedEngineIdentity,
} from "./browser-isolation.mjs";

export const runAcceptanceGate = async (config) => {
  const checks = [
    [
      "frozen-offline-install",
      [["corepack", ["pnpm", "install", "--frozen-lockfile", "--offline", "--config.trustLockfile=true"]]],
    ],
    [config.contractName, [["node", [config.contractScript]]]],
    ...(config.extraChecks ?? []),
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
  const results = [];
  for (const [name, sequence] of checks) {
    console.log(JSON.stringify({ phase: config.phase, check: name, status: "started" }));
    const started = performance.now();
    const outputs = [];
    let exitCode = 0;
    for (const [command, arguments_] of sequence) {
      const output = await run(config.root, command, arguments_);
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
    console.log(
      JSON.stringify({
        phase: config.phase,
        check: name,
        status: exitCode === 0 ? "passed" : "failed",
        durationMs: Math.round(performance.now() - started),
      }),
    );
    if (exitCode !== 0) break;
  }
  const fileHashes = Object.fromEntries(
    await Promise.all(
      config.implementationFiles.map(async (relativePath) => [
        relativePath,
        createHash("sha256")
          .update(await readFile(path.join(config.root, relativePath)))
          .digest("hex"),
      ]),
    ),
  );
  const lockfileSha256 = createHash("sha256")
    .update(await readFile(path.join(config.root, "pnpm-lock.yaml")))
    .digest("hex");
  const identityInput = {
    phase: config.phase,
    taskRange: config.taskRange,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    lockfileSha256,
    browserExecutable: isolatedChromiumExecutable,
    browserIdentity: isolatedChromiumIdentity,
    engineExecutable: isolatedEngineExecutable,
    engineIdentity: isolatedEngineIdentity,
    implementationFiles: fileHashes,
    checks: results.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    identity: createHash("sha256").update(JSON.stringify(identityInput)).digest("hex"),
    passed: results.length === checks.length && results.every((result) => result.passed),
    phase: config.phase,
    taskRange: config.taskRange,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      lockfileSha256,
      browserPolicy: "playwright-managed-chromium-only",
      browserExecutable: isolatedChromiumExecutable,
      browserIdentity: isolatedChromiumIdentity,
      engineExecutable: isolatedEngineExecutable,
      engineIdentity: isolatedEngineIdentity,
    },
    implementationFiles: fileHashes,
    results,
  };
  const evidenceDirectory = path.join(config.root, "evidence", config.phase.toLowerCase());
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
};

const run = (root, command, arguments_) =>
  new Promise((resolve) => {
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
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
