import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedApps = ["studio-server", "studio-web"];
const expectedPackages = [
  "audio",
  "bridge",
  "captions",
  "diagnostics",
  "engine-adapters",
  "media",
  "preview",
  "qa",
  "render",
  "review",
  "schema",
  "security",
  "timeline",
  "ui-components",
];
const requiredScripts = [
  "dev",
  "build",
  "typecheck",
  "lint",
  "test",
  "test:unit",
  "test:property",
  "test:integration",
  "test:visual",
  "test:e2e",
  "fixture:render",
  "qa",
  "clean-cache",
  "release:validate",
];
const requiredFiles = [
  "tests/unit/diagnostics.test.ts",
  "tests/property/redaction.property.test.ts",
  "tests/integration/server-health.test.ts",
  "tests/visual/golden-manifest.test.ts",
  "tests/e2e/local-shell.spec.ts",
  "fixtures/deterministic/studio-shell.json",
  "fixtures/goldens/studio-shell.svg",
  "fixtures/goldens/checksum-manifest.json",
  "CONTRIBUTING.md",
  "docs/architecture.md",
  "docs/debugging.md",
  "docs/fixtures.md",
  "docs/test-evidence.md",
  "docs/templates/task-evidence.md",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/implementation-task.yml",
];

const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const baseTypeScript = JSON.parse(await readFile(path.join(root, "tsconfig.base.json"), "utf8"));
const actualApps = await directoryNames(path.join(root, "apps"));
const actualPackages = await directoryNames(path.join(root, "packages"));
const appManifests = await Promise.all(
  expectedApps.map(async (name) =>
    JSON.parse(await readFile(path.join(root, `apps/${name}/package.json`), "utf8")),
  ),
);
const packageManifests = await Promise.all(
  expectedPackages.map(async (name) =>
    JSON.parse(await readFile(path.join(root, `packages/${name}/package.json`), "utf8")),
  ),
);
const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
const requiredChecks = JSON.parse(await readFile(path.join(root, ".github/required-checks.json"), "utf8"));
const hookMode = (await stat(path.join(root, ".githooks/pre-commit"))).mode;

const assertions = {
  exactApps: JSON.stringify(actualApps) === JSON.stringify(expectedApps),
  exactOwnershipPackages: JSON.stringify(actualPackages) === JSON.stringify(expectedPackages),
  strictTypeScript:
    baseTypeScript.compilerOptions.strict === true &&
    baseTypeScript.compilerOptions.noUncheckedIndexedAccess === true &&
    baseTypeScript.compilerOptions.exactOptionalPropertyTypes === true &&
    baseTypeScript.compilerOptions.composite === true,
  privateApps: appManifests.every((manifest) => manifest.private === true),
  publicPackageExports: packageManifests.every(
    (manifest) => manifest.private === true && manifest.exports?.["."]?.import !== undefined,
  ),
  rootCommandsComplete: requiredScripts.every((name) => rootManifest.scripts?.[name] !== undefined),
  testFixtureAndDocsComplete: await allExist(requiredFiles),
  executableCommitGate: (hookMode & 0o111) !== 0,
  ciLockfileCacheAndGoldenRules:
    workflow.includes("cache: pnpm") &&
    workflow.includes("pnpm install --frozen-lockfile") &&
    workflow.includes("pnpm security:audit") &&
    workflow.includes("git diff --exit-code -- packages/schema/src/generated fixtures/goldens") &&
    workflow.includes("actions/upload-artifact@v4") &&
    workflow.includes("protected-release-gate"),
  requiredChecksDeclared:
    requiredChecks.protectedBranch === "main" &&
    Array.isArray(requiredChecks.requiredChecks) &&
    requiredChecks.requiredChecks.length === 3 &&
    requiredChecks.allowForcePushes === false,
};

const reportPath = path.join(root, "evidence/p03/platform-validation.json");
const reportBody = {
  passed: Object.values(assertions).every(Boolean),
  assertions,
  apps: actualApps,
  packages: actualPackages,
  requiredScripts,
  requiredFiles,
};
const report = { generatedAt: await stableGeneratedAt(reportPath, reportBody), ...reportBody };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, assertions }, null, 2));
if (!report.passed) process.exitCode = 1;

async function directoryNames(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function allExist(relativePaths) {
  try {
    await Promise.all(relativePaths.map(async (relativePath) => access(path.join(root, relativePath))));
    return true;
  } catch {
    return false;
  }
}

async function stableGeneratedAt(reportPath, reportBody) {
  try {
    const previous = JSON.parse(await readFile(reportPath, "utf8"));
    const { generatedAt, ...previousBody } = previous;
    if (JSON.stringify(previousBody) === JSON.stringify(reportBody) && typeof generatedAt === "string") {
      return generatedAt;
    }
  } catch {
    // A missing or invalid prior report receives a fresh evidence timestamp.
  }
  return new Date().toISOString();
}
