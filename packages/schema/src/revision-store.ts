import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { sha256CanonicalJson, stringifyCanonicalJson } from "./canonical-json.js";
import {
  assertProjectDocument,
  type ApprovalStateDocument,
  type AssetsDocument,
  type ChaiProjectDocument,
  type CurrentRevisionPointer,
  type SettingsDocument,
  type TimelineDocument,
  type TransactionDocument,
} from "./project-documents.js";
import { hashRevisionDocuments, revisionDocumentNames } from "./project-folder.js";
import { validateProjectSnapshot, type ProjectRevisionSnapshot } from "./project-validation.js";

export interface RevisionContentDocuments {
  readonly project: ChaiProjectDocument;
  readonly timeline: TimelineDocument;
  readonly assets: AssetsDocument;
  readonly settings: SettingsDocument;
  readonly approvalState: ApprovalStateDocument;
}

export interface CommitActor {
  readonly id: string;
  readonly kind: "user" | "codex" | "system";
  readonly sessionId: string;
}

export type RevisionCommitCheckpoint =
  | `after-document:${(typeof revisionDocumentNames)[number]}`
  | "after-revision-directory-sync"
  | "after-revision-publish"
  | "before-pointer-swap"
  | "after-pointer-swap";

export interface CommitProjectRevisionOptions {
  readonly baseRevisionId: string;
  readonly revisionId?: string;
  readonly commandId: string;
  readonly idempotencyId?: string;
  readonly correlationId?: string;
  readonly commandEnvelopeHash?: string;
  readonly capability?: { readonly name: string; readonly version: string };
  readonly declaredScope?: "mutation" | "source-edit" | "destructive";
  readonly authorizationId?: string | null;
  readonly validationOnly?: boolean;
  readonly sourceEdit?: TransactionDocument["sourceEdit"];
  readonly history?: TransactionDocument["history"];
  readonly namedVersion?: TransactionDocument["namedVersion"];
  readonly actor: CommitActor;
  readonly commandSummary: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly string[];
  readonly warnings?: readonly string[];
  readonly documents: RevisionContentDocuments;
  readonly now?: Date;
  readonly checkpoint?: (checkpoint: RevisionCommitCheckpoint) => void | Promise<void>;
}

export interface LoadedProjectRevision extends ProjectRevisionSnapshot {
  readonly pointer: CurrentRevisionPointer;
  readonly revisionHash: string;
}

export interface LoadedImmutableRevision extends ProjectRevisionSnapshot {
  readonly revisionHash: string;
}

export interface RevisionCommitResult extends LoadedProjectRevision {
  readonly previousRevisionId: string;
}

export interface RevisionStorageAudit {
  readonly passed: boolean;
  readonly currentRevisionId: string;
  readonly reachableRevisionIds: readonly string[];
  readonly orphanRevisionIds: readonly string[];
  readonly stagingEntries: readonly string[];
  readonly invalidRevisionIds: readonly string[];
}

export interface OptimisticConflictReport {
  readonly baseRevisionId: string;
  readonly currentRevisionId: string;
  readonly baseRevisionMissing: boolean;
  readonly changedDocuments: readonly string[];
  readonly changedEntityIds: readonly string[];
}

const documentKinds = {
  "chai.project.json": "chai.project",
  "timeline.json": "timeline",
  "assets.json": "assets",
  "settings.json": "settings",
  "approval-state.json": "approval-state",
  "transaction.json": "transaction",
} as const;

export const loadCurrentProjectRevision = async (rootPath: string): Promise<LoadedProjectRevision> => {
  const root = path.resolve(rootPath);
  const pointer = assertProjectDocument(
    "current-revision",
    await readJson(path.join(root, "current-revision.json")),
  );
  const snapshot = await loadRevision(root, pointer.revisionId);
  const revisionHash = hashRevisionDocuments(toNamedDocuments(snapshot));
  if (revisionHash !== pointer.revisionHash) {
    throw revisionError(
      "revision.pointer.hash-mismatch",
      `Current pointer hash does not match immutable revision ${pointer.revisionId}.`,
      { expected: pointer.revisionHash, actual: revisionHash, revisionId: pointer.revisionId },
    );
  }
  if (pointer.projectId !== snapshot.project.projectId) {
    throw revisionError("revision.pointer.project-mismatch", "Current pointer belongs to another project.", {
      pointerProjectId: pointer.projectId,
      revisionProjectId: snapshot.project.projectId,
    });
  }
  return { ...snapshot, pointer, revisionHash };
};

export const loadProjectRevision = async (
  rootPath: string,
  revisionId: string,
): Promise<LoadedImmutableRevision> => {
  const snapshot = await loadRevision(path.resolve(rootPath), revisionId);
  return { ...snapshot, revisionHash: hashRevisionDocuments(toNamedDocuments(snapshot)) };
};

export const commitProjectRevision = async (
  rootPath: string,
  options: CommitProjectRevisionOptions,
): Promise<RevisionCommitResult> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  if (current.pointer.revisionId !== options.baseRevisionId) {
    const conflict = await buildOptimisticConflictReport(
      root,
      options.baseRevisionId,
      current.pointer.revisionId,
    );
    throw revisionError(
      "revision.optimistic-conflict",
      `Base revision ${options.baseRevisionId} is stale; current revision is ${current.pointer.revisionId}.`,
      { ...conflict },
    );
  }

  const revisionId = options.revisionId ?? `revision-${randomUUID()}`;
  const committedAt = (options.now ?? new Date()).toISOString();
  const content = coordinateRevision(options.documents, revisionId, committedAt);
  const contentNamed = toNamedContentDocuments(content);
  const transaction: TransactionDocument = {
    schemaVersion: "1.0.0",
    transactionId: `${revisionId}:transaction`,
    commandId: options.commandId,
    idempotencyId: options.idempotencyId ?? `${options.commandId}:idempotency`,
    correlationId: options.correlationId ?? `${options.commandId}:correlation`,
    commandEnvelopeHash: options.commandEnvelopeHash ?? sha256CanonicalJson({ commandId: options.commandId }),
    actor: options.actor,
    capability: options.capability ?? { name: "project-core", version: "1.0.0" },
    declaredScope: options.declaredScope ?? "mutation",
    authorizationId: options.authorizationId ?? null,
    validationOnly: options.validationOnly ?? false,
    result: "committed",
    history: options.history ?? {
      action: "commit",
      contentRevisionId: revisionId,
      undoStack: [...current.transaction.history.undoStack, current.transaction.history.contentRevisionId],
      redoStack: [],
    },
    namedVersion: options.namedVersion ?? null,
    timestamp: committedAt,
    parentRevisionId: current.pointer.revisionId,
    resultingRevisionId: revisionId,
    beforeHashes: hashesByName(toNamedDocuments(current)),
    afterHashes: hashesByName(contentNamed),
    affectedEntityIds: [...options.affectedEntityIds],
    commandSummary: options.commandSummary,
    diffSummary: options.diffSummary,
    warnings: [...(options.warnings ?? [])],
    sourceEdit: options.sourceEdit ?? null,
  };
  const snapshot: ProjectRevisionSnapshot = { ...content, transaction };
  assertValidSnapshot(snapshot);
  const namedDocuments = toNamedDocuments(snapshot);
  const revisionHash = hashRevisionDocuments(namedDocuments);
  const pointer: CurrentRevisionPointer = {
    schemaVersion: "1.0.0",
    projectId: snapshot.project.projectId,
    revisionId,
    revisionHash,
    committedAt,
  };
  assertProjectDocument("current-revision", pointer);

  const revisionsPath = path.join(root, "revisions");
  const stagingPath = path.join(revisionsPath, `.staging-${revisionId}-${randomUUID()}`);
  const publishedPath = path.join(revisionsPath, revisionId);
  const checkpoint = async (point: RevisionCommitCheckpoint): Promise<void> => {
    if (options.checkpoint === undefined) return;
    await options.checkpoint(point);
  };

  try {
    await assertPathMissing(publishedPath, "revision.id.exists");
    await mkdir(stagingPath, { recursive: false, mode: 0o700 });
    for (const name of revisionDocumentNames) {
      await writeDurableJson(path.join(stagingPath, name), namedDocuments[name], "wx");
      await checkpoint(`after-document:${name}`);
    }
    await syncDirectory(stagingPath);
    await checkpoint("after-revision-directory-sync");
    await rename(stagingPath, publishedPath);
    await syncDirectory(revisionsPath);
    await checkpoint("after-revision-publish");

    const verification = await loadRevision(root, revisionId);
    const verificationHash = hashRevisionDocuments(toNamedDocuments(verification));
    if (verificationHash !== revisionHash) {
      throw revisionError("revision.publish.hash-mismatch", "Published revision failed hash verification.", {
        expected: revisionHash,
        actual: verificationHash,
        revisionId,
      });
    }
    await checkpoint("before-pointer-swap");
    await replacePointerAtomically(root, pointer);
    await checkpoint("after-pointer-swap");
    return { ...snapshot, pointer, revisionHash, previousRevisionId: current.pointer.revisionId };
  } catch (cause) {
    if (options.checkpoint === undefined) await rm(stagingPath, { recursive: true, force: true });
    if (cause instanceof ChaiError) throw cause;
    throw revisionError(
      "revision.commit.failed",
      cause instanceof Error ? cause.message : "Unknown revision commit failure.",
      { revisionId, baseRevisionId: options.baseRevisionId },
      cause,
    );
  }
};

export const buildOptimisticConflictReport = async (
  rootPath: string,
  baseRevisionId: string,
  currentRevisionId?: string,
): Promise<OptimisticConflictReport> => {
  const root = path.resolve(rootPath);
  const resolvedCurrentId =
    currentRevisionId ??
    assertProjectDocument("current-revision", await readJson(path.join(root, "current-revision.json")))
      .revisionId;
  const current = await loadRevision(root, resolvedCurrentId);
  let base: ProjectRevisionSnapshot;
  try {
    base = await loadRevision(root, baseRevisionId);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    return {
      baseRevisionId,
      currentRevisionId: resolvedCurrentId,
      baseRevisionMissing: true,
      changedDocuments: [...revisionDocumentNames],
      changedEntityIds: [...entityDigests(current).keys()].sort(),
    };
  }
  const baseDocuments = hashesByName(toNamedDocuments(base));
  const currentDocuments = hashesByName(toNamedDocuments(current));
  const changedDocuments = revisionDocumentNames.filter(
    (name) => baseDocuments[name] !== currentDocuments[name],
  );
  const baseEntities = entityDigests(base);
  const currentEntities = entityDigests(current);
  const entityIds = new Set([...baseEntities.keys(), ...currentEntities.keys()]);
  const changedEntityIds = [...entityIds]
    .filter((entityId) => baseEntities.get(entityId) !== currentEntities.get(entityId))
    .sort();
  return {
    baseRevisionId,
    currentRevisionId: resolvedCurrentId,
    baseRevisionMissing: false,
    changedDocuments,
    changedEntityIds,
  };
};

export const auditRevisionStorage = async (rootPath: string): Promise<RevisionStorageAudit> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const entries = await readdir(path.join(root, "revisions"), { withFileTypes: true });
  const revisionIds = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".staging-"))
    .map((entry) => entry.name)
    .sort();
  const stagingEntries = entries
    .filter((entry) => entry.name.startsWith(".staging-"))
    .map((entry) => entry.name)
    .sort();
  const invalidRevisionIds: string[] = [];
  const parents = new Map<string, string | null>();
  for (const revisionId of revisionIds) {
    try {
      const revision = await loadRevision(root, revisionId);
      parents.set(revisionId, revision.transaction.parentRevisionId);
    } catch {
      invalidRevisionIds.push(revisionId);
    }
  }
  const reachable = new Set<string>();
  let cursor: string | null = current.pointer.revisionId;
  while (cursor !== null && !reachable.has(cursor)) {
    reachable.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  const orphanRevisionIds = revisionIds.filter((revisionId) => !reachable.has(revisionId));
  return {
    passed: orphanRevisionIds.length === 0 && stagingEntries.length === 0 && invalidRevisionIds.length === 0,
    currentRevisionId: current.pointer.revisionId,
    reachableRevisionIds: [...reachable],
    orphanRevisionIds,
    stagingEntries,
    invalidRevisionIds,
  };
};

const loadRevision = async (root: string, revisionId: string): Promise<ProjectRevisionSnapshot> => {
  const directory = path.join(root, "revisions", revisionId);
  const documents: Record<string, unknown> = {};
  for (const name of revisionDocumentNames) {
    const value = await readJson(path.join(directory, name));
    documents[name] = assertProjectDocument(documentKinds[name], value);
  }
  const snapshot: ProjectRevisionSnapshot = {
    project: documents["chai.project.json"] as ChaiProjectDocument,
    timeline: documents["timeline.json"] as TimelineDocument,
    assets: documents["assets.json"] as AssetsDocument,
    settings: documents["settings.json"] as SettingsDocument,
    approvalState: documents["approval-state.json"] as ApprovalStateDocument,
    transaction: documents["transaction.json"] as TransactionDocument,
  };
  assertValidSnapshot(snapshot);
  return snapshot;
};

const coordinateRevision = (
  documents: RevisionContentDocuments,
  revisionId: string,
  committedAt: string,
): RevisionContentDocuments => ({
  project: { ...documents.project, revisionId, updatedAt: committedAt },
  timeline: { ...documents.timeline, revisionId },
  assets: { ...documents.assets, revisionId },
  settings: { ...documents.settings, revisionId },
  approvalState: { ...documents.approvalState, revisionId, updatedAt: committedAt },
});

const toNamedContentDocuments = (documents: RevisionContentDocuments) => ({
  "chai.project.json": documents.project,
  "timeline.json": documents.timeline,
  "assets.json": documents.assets,
  "settings.json": documents.settings,
  "approval-state.json": documents.approvalState,
});

const toNamedDocuments = (snapshot: ProjectRevisionSnapshot) => ({
  ...toNamedContentDocuments(snapshot),
  "transaction.json": snapshot.transaction,
});

const hashesByName = (documents: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(documents)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([name, document]) => [name, sha256CanonicalJson(document)]),
  );

const entityDigests = (snapshot: ProjectRevisionSnapshot): ReadonlyMap<string, string> => {
  const entries: readonly (readonly [string, unknown])[] = [
    [snapshot.project.projectId, omitKeys(snapshot.project, ["revisionId", "updatedAt"])],
    [snapshot.timeline.timelineId, omitKeys(snapshot.timeline, ["revisionId", "tracks"])],
    [`${snapshot.project.projectId}:settings`, omitKeys(snapshot.settings, ["revisionId"])],
    [
      `${snapshot.project.projectId}:approval-state`,
      omitKeys(snapshot.approvalState, ["revisionId", "updatedAt"]),
    ],
    ...snapshot.assets.assets.map((asset) => [asset.id, asset] as const),
    ...snapshot.timeline.tracks.flatMap((track) => [
      [track.id, omitKeys(track, ["clips"])] as const,
      ...track.clips.map((clip) => [clip.id, clip] as const),
    ]),
  ];
  return new Map(entries.map(([entityId, value]) => [entityId, sha256CanonicalJson(value)]));
};

const omitKeys = (value: object, keys: readonly string[]): Readonly<Record<string, unknown>> => {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
};

const assertValidSnapshot = (snapshot: ProjectRevisionSnapshot): void => {
  const report = validateProjectSnapshot(snapshot);
  if (!report.passed) {
    const first = report.issues[0];
    throw revisionError("revision.candidate.invalid", first?.message ?? "Candidate revision is invalid.", {
      issues: report.issues,
    });
  }
};

const readJson = async (filePath: string): Promise<unknown> =>
  JSON.parse(await readFile(filePath, "utf8")) as unknown;

const writeDurableJson = async (filePath: string, value: unknown, flag: "wx" | "w"): Promise<void> => {
  const handle = await open(filePath, flag, 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const replacePointerAtomically = async (root: string, pointer: CurrentRevisionPointer): Promise<void> => {
  const temporary = path.join(root, `.current-revision-${pointer.revisionId}-${randomUUID()}.tmp`);
  try {
    await writeDurableJson(temporary, pointer, "wx");
    await rename(temporary, path.join(root, "current-revision.json"));
    await syncDirectory(root);
  } finally {
    await rm(temporary, { force: true });
  }
};

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const assertPathMissing = async (target: string, code: string): Promise<void> => {
  try {
    await stat(target);
    throw revisionError(code, `Path already exists: ${target}`);
  } catch (cause) {
    if (cause instanceof ChaiError) throw cause;
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
};

const revisionError = (
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  cause?: unknown,
): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "revision-store",
    message,
    repairHint: "Audit the immutable revision folders and retry from the current authoritative pointer.",
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
