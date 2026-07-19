import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P24.01",
    "apps/studio-server/src/reliability-service.ts",
    [
      "startupHealth",
      "health.browser",
      "health.ffmpeg-codecs",
      "health.gpu-backend",
      "health.fonts",
      "health.permissions",
      "health.disk",
      "health.project-integrity",
      "launched: false",
    ],
  ],
  [
    "P24.02",
    "apps/studio-server/src/reliability-service.ts",
    [
      "scanProjectPointerRecovery",
      "repair.revision.orphan",
      "repair.lock.stale",
      "repair.source.external-edit",
      "repair.cache.corrupt",
      "repair.job.interrupted",
      "readOnly: true",
    ],
  ],
  [
    "P24.03",
    "apps/studio-server/src/reliability-service.ts",
    [
      "recoverInvalidProjectPointer",
      "adopt-orphan",
      "reject-orphan",
      "clear-stale-lock",
      "relink-asset",
      "adopt-external-source",
      "restore-autosave",
      "sourceFilesDeleted: false",
    ],
  ],
  [
    "P24.04",
    "packages/render/src/recovery.ts",
    [
      "RenderRecoveryJournalStore",
      "resumeContext",
      "completedStages",
      "validatedArtifacts",
      "hashFile",
      "stages cannot move backwards",
    ],
  ],
  [
    "P24.05",
    "apps/studio-server/src/render-service.ts",
    ["partialOutputRetained", "cleanupInterrupted", "recoveryJournalRetained", "sourceFilesDeleted"],
  ],
  [
    "P24.06",
    "apps/studio-server/src/local-diagnostics-store.ts",
    [
      "LocalStructuredLogRecord",
      "durationMs",
      "memoryMiB",
      "concurrency",
      "cacheReason",
      "rotateIfNeeded",
      "correlationId",
    ],
  ],
  [
    "P24.07",
    "apps/studio-web/src/App.tsx",
    ["Startup health", "Recovery items", "Run health scan", "suggestedRepair", "Local only"],
  ],
  [
    "P24.08-P24.09",
    "apps/studio-server/src/local-diagnostics-store.ts",
    [
      "supportBundlePreview",
      "createdByExplicitAction",
      'projectMedia: "excluded"',
      "recordCrash",
      "localOnly: true",
      "telemetryUploaded: false",
    ],
  ],
  [
    "P24.10",
    "packages/render/src/recovery.ts",
    [
      "revision-write",
      "cache-publish",
      "render-stage",
      "encode-finalize",
      "receipt-write",
      "approval-transition",
      "ReliabilityFaultInjector",
    ],
  ],
  [
    "P24.10-P24.11",
    "tests/unit/render-recovery.test.ts",
    ["every required failure boundary", "cache publication valid", "encode finalization invisible"],
  ],
  [
    "P24.11",
    "tests/integration/reliability-repair.test.ts",
    ["stale lock", "corrupt cache", "autosave", "direct-child orphan", "unreadable current pointer"],
  ],
  [
    "P24.11",
    "tests/integration/server-render-api.test.ts",
    ["partialOutputRetained", "observedResume", "validatedArtifacts"],
  ],
  [
    "P24.12",
    "docs/RECOVERY.md",
    ["Backup, restore, and move", "Corrupt cache", "Invalid current pointer", "support bundle"],
  ],
  [
    "P24.12",
    "tests/integration/project-backup-restore.test.ts",
    ["backs up, restores, moves, and rebuilds caches", "revisionHash"],
  ],
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
  "apps/studio-server/src/reliability-service.ts",
  "apps/studio-server/src/local-diagnostics-store.ts",
  "packages/render/src/recovery.ts",
  "tests/unit/local-diagnostics-store.test.ts",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P24.01-P24.12", file, passed: exists, exists, missingSymbols: [] });
}
const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ phase: "P24", taskRange: "P24.01-P24.12", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
