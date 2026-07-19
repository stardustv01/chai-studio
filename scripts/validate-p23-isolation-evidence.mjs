import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "spikes", "milestone-0", "evidence", "isolation-report.json");
const bytes = await readFile(file);
const report = JSON.parse(bytes.toString("utf8"));
const requiredAssertions = [
  "approvedReadWorks",
  "unrelatedFilesystemDenied",
  "outsideWriteDenied",
  "childProcessDenied",
  "workerDenied",
  "networkDenied",
  "environmentSanitized",
  "wallTimeTerminated",
  "memoryLimited",
  "outputLimited",
];
const ageMs = Date.now() - Date.parse(report.generatedAt);
const results = [
  { check: "platform", passed: report.platform === `${process.platform}-${process.arch}` },
  { check: "fresh", passed: Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 15 * 60_000 },
  { check: "overall", passed: report.passed === true },
  {
    check: "adversarial-matrix",
    passed: requiredAssertions.every((name) => report.assertions?.[name] === true),
  },
  {
    check: "macos-enforcement",
    passed:
      report.mechanisms.some((value) => value.includes("sandbox-exec")) &&
      report.mechanisms.some((value) => value.includes("Node permission")),
  },
];
const output = {
  phase: "P23",
  passed: results.every((result) => result.passed),
  evidenceHash: createHash("sha256").update(bytes).digest("hex"),
  results,
};
console.log(JSON.stringify(output, null, 2));
if (!output.passed) process.exitCode = 1;
