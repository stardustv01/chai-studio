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
    check: "apache-source-publication-boundary",
    passed:
      workflow.baseline.sourcePublishing === "allowed-apache-2.0" &&
      workflow.baseline.prebuiltRuntimePublishing === "unsupported-pending-review" &&
      inventory.scope.sourceDistribution === "apache-2.0-open-source",
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
      inventory.browserPayload.bundledLibraries.some(
        (entry) =>
          entry.license === "MIT" &&
          entry.names.join(",") === "react,react-dom,scheduler" &&
          entry.licenseText.endsWith("react-mit.txt"),
      ) &&
      inventory.fonts.bundledApplicationFonts.length === 3 &&
      inventory.fonts.bundledApplicationFonts.every(
        (entry) => entry.license === "OFL-1.1" && entry.licenseText.endsWith("OFL.txt"),
      ) &&
      inventory.assets.bundledApplicationMedia.length === 2 &&
      inventory.assets.bundledApplicationMedia.every(
        (entry) =>
          entry.license === "Apache-2.0" && entry.distributionClass === "chai-owned-application-artwork",
      ),
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
