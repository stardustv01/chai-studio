import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const checks = [
  [
    "P27.01",
    "fixtures/release/support-matrix.json",
    ["apple-m4-16gb", "localhost-web-server", "measured-supported", "compatible-unmeasured"],
  ],
  [
    "P27.01,P27.03,P27.13",
    "scripts/release-operations.mjs",
    [
      "collectReleaseEnvironment",
      "installLocalRelease",
      "validateReleaseBundle",
      "bundleIdentity",
      "installedRuntime",
      "uninstallLocalRelease",
      "projectsDeleted: false",
    ],
  ],
  [
    "P27.02,P27.03",
    "scripts/release-bundle.mjs",
    [
      "createReleaseBundle",
      "validateReleaseBundle",
      "selfContainedRuntime",
      "personal-local-only",
      "escaping symlink",
    ],
  ],
  [
    "P27.03",
    "scripts/runtime-web-server.mjs",
    ["__CHAI_STUDIO_SESSION__", "content-security-policy", "127.0.0.1", "no-store"],
  ],
  [
    "P27.02",
    "scripts/generate-p27-release-manifest.mjs",
    ["dependencyLockSha256", "licenseInventorySha256", "manifestIdentity", "not-required-personal-local"],
  ],
  [
    "P27.03,P27.13",
    "scripts/chai-studio.mjs",
    ["doctor", "install", "launch", "uninstall", "browserOpened: false"],
  ],
  [
    "P27.04",
    "packages/diagnostics/src/release-identity.json",
    ["1.0.0-rc.4", "4.0.489", "0.7.58", "playwright-managed:chromium-1228", "localhost-web-server"],
  ],
  [
    "P27.04",
    "apps/studio-web/src/App.tsx",
    ["Release &amp; environment identity", "FFmpeg", "no cloud account or desktop wrapper"],
  ],
  ["P27.05", "docs/USER_GUIDE.md", ["Edit", "Inspect", "Media", "Animation", "Deliver", "Codex", "approval"]],
  ["P27.06", "docs/RELEASE_DEVELOPER_GUIDE.md", ["An edit flows", "A render flows", "release pipeline"]],
  [
    "P27.07-P27.08",
    "scripts/run-p27-upgrade-check.mjs",
    ["--engine", "--candidate", "selectedFamilyOnly", "capabilityRegistryChanged", "license-review"],
  ],
  ["P27.09", "docs/MIGRATION_ROLLBACK.md", ["0.9", "1.0.0", "irreversible", "Rollback"]],
  [
    "P27.10",
    "examples/manifest.json",
    [
      "raw-media",
      "remotion",
      "hyperframes",
      "mixed-engine",
      "captions",
      "audio",
      "bridges-alpha",
      "untrusted-import",
      "professional-edit",
    ],
  ],
  [
    "P27.11",
    "docs/RELEASE_CANDIDATE_CHECKLIST.md",
    ["clean", "capture", "render/cache", "uninstall", "Any failed item blocks"],
  ],
  [
    "P27.12",
    "governance/adrs/0010-localhost-v1-no-wrapper.md",
    ["loopback-only", "no cloud account", "no Electron", "installed Google Chrome"],
  ],
  [
    "P27.13-P27.14",
    "tests/integration/release-operations.test.ts",
    [
      "uninstalls without touching external projects",
      "refuses uninstall",
      "backs up, validates, restores, clones, archives",
    ],
  ],
  [
    "P27.15",
    "scripts/run-p27-qualification.mjs",
    ["projectPreservation", "journeyEvidence", "approved-output.mov", "startStudioServer"],
  ],
  [
    "P27.16",
    "scripts/generate-p27-disaster-report.mjs",
    [
      "commit-crash",
      "render-crash",
      "stale-lock",
      "corrupt-cache",
      "missing-source-font",
      "low-disk",
      "worker-browser-failure",
      "output-permission-loss",
      "restore-from-backup",
    ],
  ],
  [
    "P27.17",
    "docs/POST_RELEASE_OPERATIONS.md",
    ["Triage", "Security", "backups", "Rollback", "Public distribution"],
  ],
  ["P27.01-P27.17", "docs/INSTALLATION.md", ["doctor", "launch", "uninstall", "projectsDeleted: false"]],
];

const results = [];
for (const [task, file, symbols] of checks) {
  let content = "";
  let exists = true;
  try {
    content = await readFile(path.join(root, file), "utf8");
  } catch {
    exists = false;
  }
  const missingSymbols = symbols.filter((symbol) => !content.includes(symbol));
  results.push({ task, file, passed: exists && missingSymbols.length === 0, exists, missingSymbols });
}

for (const file of [
  "tests/e2e/studio-visual.spec.ts-snapshots/p27-release-identity-darwin.png",
  "scripts/release-operations.d.mts",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P27.01-P27.17", file, passed: exists, exists, missingSymbols: [] });
}

const releasePackageFiles = [
  "package.json",
  "apps/studio-server/package.json",
  "apps/studio-web/package.json",
  "packages/audio/package.json",
  "packages/bridge/package.json",
  "packages/captions/package.json",
  "packages/diagnostics/package.json",
  "packages/engine-adapters/package.json",
  "packages/media/package.json",
  "packages/preview/package.json",
  "packages/qa/package.json",
  "packages/render/package.json",
  "packages/review/package.json",
  "packages/schema/package.json",
  "packages/security/package.json",
  "packages/timeline/package.json",
  "packages/ui-components/package.json",
];
for (const file of releasePackageFiles) {
  const manifest = await readFile(path.join(root, file), "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
  const valid =
    manifest?.version === "1.0.0-rc.4" &&
    (file !== "package.json" || manifest.packageManager === "pnpm@11.11.0");
  results.push({
    task: "P27.04",
    file,
    passed: valid,
    exists: manifest !== null,
    missingSymbols: valid
      ? []
      : ['version "1.0.0-rc.4"', ...(file === "package.json" ? ['packageManager "pnpm@11.11.0"'] : [])],
  });
}

let observedPackageManager = "unavailable";
try {
  const { stdout } = await execFileAsync("corepack", ["pnpm", "--version"], { cwd: root });
  observedPackageManager = stdout.trim();
} catch {
  // Report the unavailable executable as a failed release-contract result below.
}
const exactPackageManager = observedPackageManager === "11.11.0";
results.push({
  task: "P27.04",
  file: "corepack pnpm --version",
  passed: exactPackageManager,
  exists: observedPackageManager !== "unavailable",
  observed: observedPackageManager,
  missingSymbols: exactPackageManager ? [] : ["11.11.0"],
});

const evidenceChecks = [
  [
    "P27.02",
    "evidence/p27/release-manifest.json",
    (value) =>
      value.version === "1.0.0-rc.4" &&
      value.files?.length >= 700 &&
      value.runtimeBundle?.selfContainedRuntime === true &&
      value.runtimeBundle?.fileCount >= 10_000 &&
      typeof value.runtimeBundle?.bundleIdentity === "string" &&
      typeof value.sourceCommit === "string" &&
      typeof value.manifestIdentity === "string",
  ],
  [
    "P27.08",
    "evidence/p27/upgrade-remotion-receipt.json",
    (value) => value.passed === true && value.engine === "remotion" && value.results?.length === 6,
  ],
  [
    "P27.08",
    "evidence/p27/upgrade-hyperframes-receipt.json",
    (value) => value.passed === true && value.engine === "hyperframes" && value.results?.length === 6,
  ],
  [
    "P27.15",
    "evidence/p27/qualification-report.json",
    (value) =>
      value.passed === true &&
      value.bundle?.selfContainedRuntime === true &&
      typeof value.bundle?.bundleIdentity === "string" &&
      value.projectPreservation?.originalStillPresent === true &&
      value.uninstall?.projectsDeleted === false,
  ],
  [
    "P27.16",
    "evidence/p27/disaster-drill-report.json",
    (value) =>
      value.passed === true &&
      value.drills?.length === 9 &&
      value.drills.every((drill) => drill.passed === true),
  ],
];
for (const [task, file, validate] of evidenceChecks) {
  const value = await readFile(path.join(root, file), "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
  const valid = value !== null && validate(value);
  results.push({
    task,
    file,
    passed: valid,
    exists: value !== null,
    missingSymbols: valid ? [] : ["valid passing P27 evidence"],
  });
}

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P27", taskRange: "P27.01-P27.17", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
