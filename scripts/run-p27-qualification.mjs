import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  archiveProject,
  backupProject,
  cloneProjectBackup,
  collectReleaseEnvironment,
  installLocalRelease,
  restoreProjectBackup,
  uninstallLocalRelease,
  validateProjectBackup,
} from "./release-operations.mjs";
import { validateReleaseBundle } from "./release-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-p27-qualification-"));
const prefix = path.join(temporaryRoot, "application");
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseBundle = path.join(root, "dist/releases", `chai-studio-${packageManifest.version}-darwin-arm64`);
const project = path.join(temporaryRoot, "Projects", "Qualification.chai");
const backup = path.join(temporaryRoot, "Backups", "Qualification.backup");
const restored = path.join(temporaryRoot, "Projects", "Qualification Restored.chai");
const cloned = path.join(temporaryRoot, "Projects", "Qualification Clone.chai");
const archived = path.join(temporaryRoot, "Archives", "Qualification.archive");
await mkdir(path.join(root, "evidence/p27"), { recursive: true });

try {
  const environment = await collectReleaseEnvironment(root);
  if (!environment.passed) throw new Error("Qualification doctor failed.");
  const bundled = await validateReleaseBundle(releaseBundle);
  if (!bundled.passed) throw new Error("Qualification release bundle integrity failed.");
  const installation = await installLocalRelease({ sourceRoot: releaseBundle, prefix });
  await mkdir(path.join(project, "revisions"), { recursive: true });
  await mkdir(path.join(project, "deliveries"), { recursive: true });
  await mkdir(path.join(project, ".chai-cache", "render"), { recursive: true });
  await writeFile(
    path.join(project, "project.json"),
    '{"schemaVersion":"1.0.0","projectId":"qualification"}\n',
  );
  await writeFile(path.join(project, "revisions", "current.json"), '{"revisionId":"qualification-r1"}\n');
  await writeFile(path.join(project, "deliveries", "approved-output.mov"), "approved-output-identity");
  await writeFile(path.join(project, ".chai-cache", "render", "regenerable.bin"), "cache");
  const backupManifest = await backupProject({
    source: project,
    destination: backup,
    environmentFingerprint: environment.fingerprint,
  });
  const backupValidation = await validateProjectBackup(backup);
  if (!backupValidation.passed) throw new Error("Qualification backup validation failed.");
  const restore = await restoreProjectBackup({ backup, destination: restored });
  const clone = await cloneProjectBackup({
    source: project,
    destination: cloned,
    environmentFingerprint: environment.fingerprint,
  });
  const archive = await archiveProject({
    source: project,
    destination: archived,
    environmentFingerprint: environment.fingerprint,
  });
  const { startStudioServer } = await import("../apps/studio-server/dist/index.js");
  const server = await startStudioServer({
    preferredPort: 0,
    runtimeDirectory: path.join(temporaryRoot, "runtime"),
  });
  const health = await globalThis
    .fetch(`${server.report.origins[0]}/api/health`)
    .then((response) => response.json());
  await server.close();
  const uninstall = await uninstallLocalRelease(prefix);
  const originalStillPresent = await stat(path.join(project, "project.json"))
    .then(() => true)
    .catch(() => false);
  const cacheExcluded = await stat(path.join(backup, ".chai-cache"))
    .then(() => false)
    .catch(() => true);
  const deliveryPreserved =
    (await readFile(path.join(restored, "deliveries", "approved-output.mov"), "utf8")) ===
    "approved-output-identity";
  const report = {
    schemaVersion: "1.0.0",
    passed: originalStillPresent && cacheExcluded && deliveryPreserved && health.data?.status === "ok",
    environment,
    installation,
    bundle: {
      version: bundled.marker.version,
      sourceCommit: bundled.marker.sourceCommit,
      bundleIdentity: bundled.actualIdentity,
      selfContainedRuntime: bundled.marker.selfContainedRuntime,
    },
    health: health.data,
    backup: {
      contentIdentity: backupManifest.contentIdentity,
      validated: backupValidation.passed,
      cacheExcluded,
    },
    restore,
    clone,
    archive: { contentIdentity: archive.contentIdentity },
    uninstall,
    projectPreservation: {
      originalStillPresent,
      deliveryPreserved,
      projectsDeleted: uninstall.projectsDeleted,
    },
    journeyEvidence: [
      "create/import/edit: full unit and integration gate",
      "capture/Codex context: P18 integration and E2E gate",
      "render/QA/approve/deliver/reproduce: P20-P22 integration and E2E gate",
      "clean launch and uninstall preservation: this isolated qualification",
    ],
  };
  await writeFile(
    path.join(root, "evidence/p27/qualification-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        fingerprint: environment.fingerprint,
        contentIdentity: backupManifest.contentIdentity,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
