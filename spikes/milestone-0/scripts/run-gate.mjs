import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const evidence = path.join(root, "evidence");
await mkdir(evidence, { recursive: true });

const checks = [
  ["prepare-fixtures", ["node", "scripts/prepare-fixtures.mjs"], false],
  ["core-tests", ["node", "--test", "tests/rational.test.mjs", "tests/scheduler.test.mjs", "tests/revision-store.test.mjs", "tests/policy-environment.test.mjs", "tests/audio-transport.test.mjs", "tests/cross-cutting-contracts.test.mjs"], false],
  ["canonical-fixture-generate", ["node", "scripts/generate-canonical-fixture.mjs"], false],
  ["canonical-fixture-validate", ["node", "scripts/validate-canonical-fixture.mjs"], false],
  ["environment", ["node", "scripts/capture-environment.mjs"], false],
  ["hyperframes-doctor", ["node", "scripts/validate-doctor.mjs"], false],
  ["hyperframes-lint", ["node_modules/.bin/hyperframes", "lint", "fixtures/hyperframes", "--json"], false],
  ["hyperframes-check", ["node_modules/.bin/hyperframes", "check", "fixtures/hyperframes", "--strict", "--snapshots", "--json"], false],
  ["hyperframes-determinism", ["node", "scripts/verify-hyperframes-snapshot.mjs"], false],
  ["hyperframes-render", ["node_modules/.bin/hyperframes", "render", "fixtures/hyperframes", "--output", "evidence/hyperframes-fixture.mp4", "--quality", "draft", "--strict", "--workers", "1"], false],
  ["remotion-still", ["node", "scripts/render-remotion.mjs"], false],
  ["native-preview-sequences", ["node", "scripts/generate-preview-sequences.mjs"], false],
  ["untrusted-isolation-evidence", ["node", "scripts/validate-isolation-report.mjs"], false],
  ["browser-and-benchmark-evidence", ["node", "scripts/validate-browser-and-benchmark-evidence.mjs"], false],
  ["mixed-fixture-prepare", ["node", "scripts/prepare-mixed-fixture.mjs"], false],
  ["mixed-finish-render", ["node", "scripts/render-mixed-finish.mjs"], false],
];

const results = [];
for (const [name, command, shell] of checks) {
  const [executable, ...args] = command;
  const startedAt = Date.now();
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", shell, maxBuffer: 20 * 1024 * 1024 });
  results.push({ name, passed: result.status === 0, exitCode: result.status, durationMs: Date.now() - startedAt, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) break;
}
const report = { generatedAt: new Date().toISOString(), passed: results.length === checks.length && results.every((result) => result.passed), results };
await writeFile(path.join(evidence, "gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, checks: results.map(({ name, passed, exitCode, durationMs }) => ({ name, passed, exitCode, durationMs })) }, null, 2));
if (!report.passed) process.exit(1);
