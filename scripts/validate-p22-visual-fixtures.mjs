import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePerceptualFidelity, evaluateStrictFidelity } from "../packages/qa/dist/index.js";
import { normalizedPixelHash, normalizedRmse, sourceEvidenceHash } from "./qa-pixel-tools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "fixtures", "deterministic", "qa", "visual-fixtures.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requiredCategories = new Set([
  "engine-native-remotion",
  "engine-native-hyperframes",
  "mixed-boundary",
  "captions",
  "alpha",
  "shaders",
  "transforms",
  "comparisons",
]);
const results = [];

for (const golden of manifest.goldens) {
  requiredCategories.delete(golden.category);
  const observed = await normalizedPixelHash(path.join(root, golden.source));
  results.push({
    kind: "golden",
    fixtureId: golden.id,
    passed: observed === golden.normalizedPixelHash,
    expected: golden.normalizedPixelHash,
    observed,
  });
}

for (const pair of manifest.strictPairs) {
  const [left, right] = await Promise.all([
    normalizedPixelHash(path.join(root, pair.left)),
    normalizedPixelHash(path.join(root, pair.right)),
  ]);
  const finding = evaluateStrictFidelity({
    fixtureId: pair.fixtureId,
    frame: "0",
    captureHash: left,
    finalHash: right,
    normalizedPixelHashAlgorithm: manifest.algorithm,
    captureEnvironmentFingerprint: manifest.strictEnvironmentFingerprint,
    finalEnvironmentFingerprint: manifest.strictEnvironmentFingerprint,
  });
  results.push({ kind: "strict", fixtureId: pair.fixtureId, passed: finding.status === "passed", finding });
}

for (const policy of manifest.perceptualPolicies) {
  const dimensions = { width: policy.comparisonWidth, height: policy.comparisonHeight };
  const leftPath = path.join(root, policy.left);
  const rightPath = path.join(root, policy.right);
  const [observed, evidenceHash, captureHash, finalHash] = await Promise.all([
    normalizedRmse(leftPath, rightPath, dimensions),
    sourceEvidenceHash(leftPath, rightPath),
    normalizedPixelHash(leftPath),
    normalizedPixelHash(rightPath),
  ]);
  const finding = evaluatePerceptualFidelity({
    policy: {
      fixtureId: policy.fixtureId,
      mode: policy.mode,
      direction: policy.direction,
      measuredThreshold: policy.measuredThreshold,
      thresholdEvidenceHash: policy.thresholdEvidenceHash,
      policyVersion: policy.policyVersion,
    },
    frame: "0",
    observed,
    captureHash,
    finalHash,
    captureEnvironmentFingerprint: "compatible-preview-environment",
    finalEnvironmentFingerprint: manifest.strictEnvironmentFingerprint,
  });
  results.push({
    kind: "perceptual",
    fixtureId: policy.fixtureId,
    passed:
      finding.status === "passed" &&
      evidenceHash === policy.thresholdEvidenceHash &&
      Math.abs(observed - policy.calibrationObserved) < 1e-12,
    observed,
    finding,
  });
}

const passed =
  manifest.schemaVersion === "1.0.0" &&
  manifest.algorithm === "rgba8-linear-rec709-v1" &&
  manifest.reviewStatus === "reviewed" &&
  requiredCategories.size === 0 &&
  results.every((result) => result.passed);
process.stdout.write(
  `${JSON.stringify({ phase: "P22", taskRange: "P22.05-P22.08", passed, missingCategories: [...requiredCategories], results }, null, 2)}\n`,
);
if (!passed) process.exitCode = 1;
