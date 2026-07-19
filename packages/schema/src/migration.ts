import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { sha256CanonicalJson, stringifyCanonicalJson } from "./canonical-json.js";
import {
  assertProjectDocument,
  projectDocumentKinds,
  type NamedVersionsDocument,
  type ProjectDocumentKind,
  type TransactionDocument,
} from "./project-documents.js";
import { deserializeRational } from "./rational.js";

export const currentProjectSchemaVersion = "1.0.0" as const;

export interface MigrationRegistryEntry {
  readonly id: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly reversible: boolean;
  readonly description: string;
}

export const projectMigrationRegistry: readonly MigrationRegistryEntry[] = [
  {
    id: "project-bundle-0.9.0-to-1.0.0",
    fromVersion: "0.9.0",
    toVersion: "1.0.0",
    reversible: true,
    description:
      "Adds explicit command audit, persistent history, named-version linkage, and source authority fields.",
  },
];

export interface ProjectMigrationReport {
  readonly migrationId: string | null;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly dryRun: boolean;
  readonly changedPaths: readonly string[];
  readonly sourceHash: string;
  readonly targetHash: string;
  readonly backupPath: string | null;
  readonly migrated: boolean;
}

export interface ProjectBundleMigrationResult {
  readonly documents: Readonly<Record<ProjectDocumentKind, unknown>>;
  readonly report: ProjectMigrationReport;
}

export interface MigrateArtifactFileOptions {
  readonly dryRun?: boolean;
  readonly backupDirectory?: string;
}

export const migrateProjectDocumentBundle = (
  input: unknown,
  options: Readonly<{ dryRun?: boolean }> = {},
): ProjectBundleMigrationResult => {
  const bundle = assertBundleObject(input);
  const fromVersion = detectBundleVersion(bundle);
  const sourceHash = sha256CanonicalJson(bundle);
  if (fromVersion === currentProjectSchemaVersion) {
    const validated = validateCurrentBundle(bundle);
    return {
      documents: validated,
      report: {
        migrationId: null,
        fromVersion,
        toVersion: currentProjectSchemaVersion,
        dryRun: options.dryRun ?? false,
        changedPaths: [],
        sourceHash,
        targetHash: sourceHash,
        backupPath: null,
        migrated: false,
      },
    };
  }
  if (fromVersion !== "0.9.0") {
    throw migrationError(
      compareVersions(fromVersion, currentProjectSchemaVersion) > 0
        ? "migration.version.newer-unsupported"
        : "migration.version.unsupported",
      `Project schema ${fromVersion} cannot be migrated by this build (supports 0.9.0 -> 1.0.0).`,
    );
  }
  assertUnambiguousTiming(bundle);
  const migrated = structuredClone(bundle);
  const changedPaths: string[] = [];
  for (const kind of projectDocumentKinds) {
    const document = asRecord(migrated[kind], `/${kind}`);
    document.schemaVersion = currentProjectSchemaVersion;
    changedPaths.push(`/${escapePointer(kind)}/schemaVersion`);
  }
  const project = asRecord(migrated["chai.project"], "/chai.project");
  if (!("sources" in project)) {
    project.sources = {};
    changedPaths.push("/chai.project/sources");
  }
  const transaction = asRecord(migrated.transaction, "/transaction");
  const resultingRevisionId = requireString(
    transaction.resultingRevisionId,
    "/transaction/resultingRevisionId",
  );
  const commandId = requireString(transaction.commandId, "/transaction/commandId");
  const actor = asRecord(transaction.actor, "/transaction/actor");
  const additions: Readonly<Record<string, unknown>> = {
    idempotencyId: `${commandId}:legacy`,
    correlationId: `${commandId}:migration`,
    commandEnvelopeHash: sha256CanonicalJson({ legacyCommandId: commandId }),
    capability: { name: "legacy-project-migration", version: "1.0.0" },
    declaredScope: "mutation",
    authorizationId: null,
    validationOnly: false,
    result: "committed",
    history: { action: "commit", contentRevisionId: resultingRevisionId, undoStack: [], redoStack: [] },
    namedVersion: initialNamedVersion(
      migrated,
      resultingRevisionId,
      requireString(actor.id, "/transaction/actor/id"),
    ),
  };
  for (const [key, value] of Object.entries(additions)) {
    if (!(key in transaction)) {
      transaction[key] = value;
      changedPaths.push(`/transaction/${key}`);
    }
  }
  const autosave = asRecord(migrated["autosave-metadata"], "/autosave-metadata");
  if (Array.isArray(autosave.entries)) {
    autosave.entries.forEach((value, index) => {
      const entry = asRecord(value, `/autosave-metadata/entries/${String(index)}`);
      if (!("contentHash" in entry)) {
        entry.contentHash = sha256CanonicalJson({ legacyAutosave: entry });
        changedPaths.push(`/autosave-metadata/entries/${String(index)}/contentHash`);
      }
    });
  }
  const validated = validateCurrentBundle(migrated);
  const targetHash = sha256CanonicalJson(validated);
  return {
    documents: validated,
    report: {
      migrationId: projectMigrationRegistry[0]?.id ?? null,
      fromVersion,
      toVersion: currentProjectSchemaVersion,
      dryRun: options.dryRun ?? false,
      changedPaths: changedPaths.sort(),
      sourceHash,
      targetHash,
      backupPath: null,
      migrated: true,
    },
  };
};

export const migrateProjectArtifactFile = async (
  filePath: string,
  options: MigrateArtifactFileOptions = {},
): Promise<ProjectMigrationReport> => {
  const target = path.resolve(filePath);
  const input = JSON.parse(await readFile(target, "utf8")) as unknown;
  const result = migrateProjectDocumentBundle(input, { dryRun: options.dryRun ?? false });
  if (options.dryRun === true || !result.report.migrated) return result.report;
  const backupDirectory = path.resolve(options.backupDirectory ?? path.dirname(target));
  await assertDirectory(backupDirectory);
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(target)}.backup-${result.report.sourceHash.slice(0, 16)}.json`,
  );
  await writeExclusiveJson(backupPath, input);
  try {
    await replaceJsonAtomically(target, result.documents);
  } catch (cause) {
    await rm(backupPath, { force: true });
    throw cause;
  }
  return { ...result.report, backupPath };
};

export const rollbackProjectArtifactMigration = async (
  filePath: string,
  report: ProjectMigrationReport,
): Promise<void> => {
  if (report.backupPath === null || !report.migrated) {
    throw migrationError("migration.rollback.unavailable", "Migration report has no rollback backup.");
  }
  const target = path.resolve(filePath);
  const current = JSON.parse(await readFile(target, "utf8")) as unknown;
  if (sha256CanonicalJson(current) !== report.targetHash) {
    throw migrationError(
      "migration.rollback.target-changed",
      "Migrated artifact changed after migration; automatic rollback would discard newer work.",
    );
  }
  const backup = JSON.parse(await readFile(report.backupPath, "utf8")) as unknown;
  if (sha256CanonicalJson(backup) !== report.sourceHash) {
    throw migrationError(
      "migration.rollback.backup-corrupt",
      "Migration backup hash does not match the report.",
    );
  }
  await replaceJsonAtomically(target, backup);
};

const validateCurrentBundle = (
  bundle: Readonly<Record<string, unknown>>,
): Readonly<Record<ProjectDocumentKind, unknown>> =>
  Object.fromEntries(
    projectDocumentKinds.map((kind) => [kind, assertProjectDocument(kind, bundle[kind])]),
  ) as unknown as Readonly<Record<ProjectDocumentKind, unknown>>;

const detectBundleVersion = (bundle: Readonly<Record<string, unknown>>): string => {
  const versions = new Set(
    projectDocumentKinds.map((kind) =>
      requireString(asRecord(bundle[kind], `/${kind}`).schemaVersion, `/${kind}/schemaVersion`),
    ),
  );
  if (versions.size !== 1) {
    throw migrationError(
      "migration.version.mixed",
      `Project bundle contains mixed schema versions: ${[...versions].sort().join(", ")}.`,
    );
  }
  return [...versions][0] ?? "unknown";
};

const assertUnambiguousTiming = (bundle: Readonly<Record<string, unknown>>): void => {
  const project = asRecord(bundle["chai.project"], "/chai.project");
  const timeline = asRecord(bundle.timeline, "/timeline");
  const video = asRecord(project.video, "/chai.project/video");
  for (const [pointer, value] of [
    ["/chai.project/video/fps", video.fps],
    ["/timeline/fps", timeline.fps],
  ] as const) {
    try {
      deserializeRational(value);
    } catch {
      throw migrationError(
        "migration.timing.ambiguous",
        `${pointer} is not an exact normalized rational; migration will not reinterpret timing.`,
      );
    }
  }
};

const initialNamedVersion = (
  migrated: Readonly<Record<string, unknown>>,
  revisionId: string,
  actorId: string,
): TransactionDocument["namedVersion"] => {
  const named = asRecord(migrated["named-versions"], "/named-versions");
  if (!Array.isArray(named.versions)) return null;
  const versions: unknown[] = named.versions;
  const match: unknown = versions.find(
    (value) => asRecord(value, "/named-versions/versions").revisionId === revisionId,
  );
  if (match === undefined) return null;
  const record = asRecord(match, "/named-versions/versions");
  return {
    id: requireString(record.id, "/named-versions/versions/id"),
    name: record.name as NamedVersionsDocument["versions"][number]["name"],
    revisionId,
    createdAt: requireString(record.createdAt, "/named-versions/versions/createdAt"),
    actorId: typeof record.actorId === "string" ? record.actorId : actorId,
    outputId:
      record.outputId === null ? null : requireString(record.outputId, "/named-versions/versions/outputId"),
  };
};

const assertBundleObject = (value: unknown): Readonly<Record<string, unknown>> => {
  const bundle = asRecord(value, "/");
  const missing = projectDocumentKinds.filter((kind) => !(kind in bundle));
  if (missing.length > 0) {
    throw migrationError("migration.bundle.incomplete", `Project bundle is missing: ${missing.join(", ")}.`);
  }
  return bundle;
};

const asRecord = (value: unknown, pointer: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw migrationError("migration.artifact.invalid", `${pointer} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const requireString = (value: unknown, pointer: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw migrationError("migration.artifact.invalid", `${pointer} must be a non-empty string.`);
  }
  return value;
};

const compareVersions = (left: string, right: string): number =>
  left.localeCompare(right, "en", { numeric: true });

const escapePointer = (value: string): string => value.replaceAll("~", "~0").replaceAll("/", "~1");

const replaceJsonAtomically = async (target: string, value: unknown): Promise<void> => {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}.tmp`);
  try {
    await writeExclusiveJson(temporary, value);
    await rename(temporary, target);
    await syncDirectory(path.dirname(target));
  } finally {
    await rm(temporary, { force: true });
  }
};

const writeExclusiveJson = async (filePath: string, value: unknown): Promise<void> => {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const assertDirectory = async (directory: string): Promise<void> => {
  const info = await stat(directory);
  if (!info.isDirectory())
    throw migrationError("migration.backup.not-directory", "Backup path is not a directory.");
};

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const migrationError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "project-migration",
    message,
    repairHint: "Keep the original artifact and open it with a compatible Chai Studio migration path.",
  });
