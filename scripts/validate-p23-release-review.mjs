import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(
  await readFile(path.join(root, "governance", "licenses", "dependency-inventory.json"), "utf8"),
);
const workflow = JSON.parse(
  await readFile(path.join(root, "governance", "licenses", "release-review.json"), "utf8"),
);
const mandatoryTriggers = [
  "public-distribution",
  "commercialization",
  "team-or-automation-scale-change",
  "engine-upgrade",
  "ffmpeg-or-codec-bundle-change",
  "bundled-font-or-asset-change",
];
const results = [
  {
    check: "personal-local-baseline",
    passed: workflow.baseline.decision === "allowed-personal-local-only",
  },
  {
    check: "release-triggers-present-and-blocking",
    passed: mandatoryTriggers.every((id) =>
      workflow.triggers.some(
        (trigger) => trigger.id === id && trigger.defaultDecision === "blocked-pending-review",
      ),
    ),
  },
  {
    check: "exact-engine-inventory",
    passed: ["remotion", "@remotion/bundler", "@remotion/player", "@remotion/renderer", "hyperframes"].every(
      (name) => inventory.engines.some((entry) => entry.name === name && entry.version && entry.license),
    ),
  },
  {
    check: "ffmpeg-obligation-recorded",
    passed: inventory.ffmpeg.distributionObligation.includes("exact binary configuration"),
  },
  {
    check: "browser-font-asset-obligations-recorded",
    passed:
      inventory.browser.length === 2 &&
      Array.isArray(inventory.fonts.bundledApplicationFonts) &&
      Array.isArray(inventory.assets.bundledApplicationMedia),
  },
  {
    check: "unknown-license-release-block",
    passed:
      inventory.installedDependencyTree.every((entry) => entry.license !== "UNKNOWN") ||
      workflow.unknownLicenseDecision === "blocked-pending-review",
  },
  {
    check: "native-compositor-license-classification",
    passed: inventory.installedDependencyTree.some(
      (entry) =>
        entry.name === "@remotion/compositor-darwin-arm64" &&
        entry.version === "4.0.489" &&
        entry.license.startsWith("Remotion License") &&
        entry.licenseEvidence === "https://github.com/remotion-dev/remotion/blob/v4.0.489/LICENSE.md" &&
        entry.publicDistribution === "blocked-pending-release-review" &&
        entry.binaryNotice.includes("linked media libraries"),
    ),
  },
];
const report = { phase: "P23", passed: results.every((result) => result.passed), results };
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
