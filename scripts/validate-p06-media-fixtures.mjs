import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures/deterministic/media/p06-media-cases.json");
const requiredCaseIds = [
  "cache-deletion",
  "corrupt-media",
  "duplicate",
  "font",
  "missing-media",
  "proxy",
  "relink",
  "rights",
  "traversal",
  "vfr-alpha",
];
const issues = [];
let fixture;
try {
  fixture = JSON.parse(await readFile(fixturePath, "utf8"));
} catch (error) {
  issues.push(`Fixture manifest cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
}

if (fixture !== undefined) {
  if (fixture.schemaVersion !== "1.0.0" || fixture.phase !== "P06" || !Array.isArray(fixture.cases)) {
    issues.push("Fixture manifest root contract is invalid.");
  } else {
    const ids = fixture.cases.map((entry) => entry?.id);
    if (new Set(ids).size !== ids.length) issues.push("Fixture case IDs are duplicated.");
    if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) {
      issues.push("Fixture cases must be sorted by stable ID.");
    }
    for (const requiredId of requiredCaseIds) {
      if (!ids.includes(requiredId)) issues.push(`Required P06 fixture is missing: ${requiredId}.`);
    }
    for (const entry of fixture.cases) {
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.id !== "string" ||
        typeof entry.fixture !== "string" ||
        entry.fixture.trim().length === 0 ||
        typeof entry.expected !== "string" ||
        entry.expected.trim().length === 0 ||
        !Array.isArray(entry.coverage) ||
        entry.coverage.length === 0
      ) {
        issues.push(`Fixture case has an invalid contract: ${String(entry?.id ?? "unknown")}.`);
        continue;
      }
      for (const relativePath of entry.coverage) {
        if (typeof relativePath !== "string" || !relativePath.startsWith("tests/")) {
          issues.push(`Fixture coverage path is not test-scoped: ${String(relativePath)}.`);
          continue;
        }
        await access(path.join(root, relativePath)).catch(() => {
          issues.push(`Fixture coverage file is missing: ${relativePath}.`);
        });
      }
    }
  }
}

const report = {
  passed: issues.length === 0,
  fixture: path.relative(root, fixturePath),
  caseCount: fixture?.cases?.length ?? 0,
  requiredCaseCount: requiredCaseIds.length,
  issues,
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
