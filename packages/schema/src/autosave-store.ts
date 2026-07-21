import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { sha256CanonicalJson, stringifyCanonicalJson } from "./canonical-json.js";
import { assertProjectDocument, type AutosaveMetadataDocument } from "./project-documents.js";
import { acquireProjectMutationLock } from "./project-lock.js";
import {
  commitProjectRevision,
  loadCurrentProjectRevision,
  type CommitActor,
  type RevisionCommitResult,
  type RevisionContentDocuments,
} from "./revision-store.js";
import { validateProjectSnapshot } from "./project-validation.js";

export type AutosaveReason = "debounced" | "pre-risk" | "crash-recovery";

export interface CreateAutosaveOptions {
  readonly reason: AutosaveReason;
  readonly documents?: RevisionContentDocuments;
  readonly autosaveId?: string;
  readonly now?: Date;
}

export interface AutosaveCandidate {
  readonly id: string;
  readonly baseRevisionId: string;
  readonly createdAt: string;
  readonly reason: AutosaveReason;
  readonly contentHash: string;
  readonly valid: boolean;
  readonly documents: RevisionContentDocuments | null;
  readonly issue: string | null;
}

export interface RecoveryScan {
  readonly cleanShutdown: boolean;
  readonly recoveryRequired: boolean;
  readonly candidates: readonly AutosaveCandidate[];
}

export interface RestoreAutosaveOptions {
  readonly actor: CommitActor;
  readonly revisionId?: string;
  readonly now?: Date;
}

export interface DebouncedAutosaveController {
  schedule(documents: RevisionContentDocuments): void;
  flush(reason?: AutosaveReason): Promise<AutosaveCandidate | null>;
  waitForIdle(): Promise<void>;
  cancel(): void;
}

export interface DebouncedAutosaveOptions {
  readonly delayMs: number;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

interface StoredAutosave {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly baseRevisionId: string;
  readonly createdAt: string;
  readonly reason: AutosaveReason;
  readonly documents: RevisionContentDocuments;
}

export const markProjectOpened = async (rootPath: string): Promise<AutosaveMetadataDocument> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const metadata = await readAutosaveMetadata(root);
  const updated: AutosaveMetadataDocument = {
    ...metadata,
    cleanShutdown: false,
    lastOpenedRevisionId: current.pointer.revisionId,
  };
  await writeMetadata(root, updated);
  return updated;
};

export const markProjectCleanShutdown = async (rootPath: string): Promise<AutosaveMetadataDocument> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const metadata = await readAutosaveMetadata(root);
  const updated: AutosaveMetadataDocument = {
    ...metadata,
    cleanShutdown: true,
    lastOpenedRevisionId: current.pointer.revisionId,
  };
  await writeMetadata(root, updated);
  return updated;
};

export const createProjectAutosave = async (
  rootPath: string,
  options: CreateAutosaveOptions,
): Promise<AutosaveCandidate> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const metadata = await readAutosaveMetadata(root);
  const documents = options.documents ?? currentContent(current);
  assertAutosaveDocuments(documents, current);
  const id = options.autosaveId ?? `autosave-${randomUUID()}`;
  const stored: StoredAutosave = {
    schemaVersion: "1.0.0",
    id,
    projectId: current.project.projectId,
    baseRevisionId: current.pointer.revisionId,
    createdAt: (options.now ?? new Date()).toISOString(),
    reason: options.reason,
    documents,
  };
  const contentHash = sha256CanonicalJson(stored);
  const staging = path.join(root, "autosaves", `.staging-${id}-${randomUUID()}`);
  const target = path.join(root, "autosaves", id);
  try {
    await mkdir(staging, { recursive: false, mode: 0o700 });
    await writeExclusiveJson(path.join(staging, "snapshot.json"), stored);
    await syncDirectory(staging);
    await rename(staging, target);
    await syncDirectory(path.join(root, "autosaves"));
  } catch (cause) {
    await rm(staging, { recursive: true, force: true });
    throw cause;
  }

  const entry: AutosaveMetadataDocument["entries"][number] = {
    id,
    revisionId: current.pointer.revisionId,
    createdAt: stored.createdAt,
    reason: options.reason,
    valid: true,
    contentHash,
  };
  const entries = [...metadata.entries, entry].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt, "en"),
  );
  const keep = entries.slice(-current.settings.autosaveRetention);
  const removed = entries.filter((candidate) => !keep.some((saved) => saved.id === candidate.id));
  const updated: AutosaveMetadataDocument = {
    ...metadata,
    cleanShutdown: false,
    lastOpenedRevisionId: current.pointer.revisionId,
    entries: keep,
  };
  await writeMetadata(root, updated);
  await Promise.all(
    removed.map(async (candidate) =>
      rm(path.join(root, "autosaves", candidate.id), { recursive: true, force: true }),
    ),
  );
  return { ...entry, baseRevisionId: entry.revisionId, documents, issue: null };
};

export const scanAutosaveRecovery = async (rootPath: string): Promise<RecoveryScan> => {
  const root = path.resolve(rootPath);
  const metadata = await readAutosaveMetadata(root);
  const candidates = await Promise.all(
    [...metadata.entries]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt, "en"))
      .map(async (entry): Promise<AutosaveCandidate> => {
        try {
          const stored = await readStoredAutosave(root, entry.id);
          const actualHash = sha256CanonicalJson(stored);
          if (actualHash !== entry.contentHash) {
            return {
              ...entry,
              baseRevisionId: entry.revisionId,
              valid: false,
              documents: null,
              issue: "hash-mismatch",
            };
          }
          const current = await loadCurrentProjectRevision(root);
          assertAutosaveDocuments(stored.documents, current, stored.baseRevisionId);
          return {
            ...entry,
            baseRevisionId: stored.baseRevisionId,
            valid: true,
            documents: stored.documents,
            issue: null,
          };
        } catch (cause) {
          return {
            ...entry,
            baseRevisionId: entry.revisionId,
            valid: false,
            documents: null,
            issue: cause instanceof Error ? cause.message : "unreadable",
          };
        }
      }),
  );
  return {
    cleanShutdown: metadata.cleanShutdown,
    recoveryRequired: !metadata.cleanShutdown && candidates.some((candidate) => candidate.valid),
    candidates,
  };
};

export const restoreProjectAutosave = async (
  rootPath: string,
  autosaveId: string,
  options: RestoreAutosaveOptions,
): Promise<RevisionCommitResult> => {
  const root = path.resolve(rootPath);
  const now = options.now ?? new Date();
  const lock = await acquireProjectMutationLock(root, {
    ownerId: options.actor.id,
    sessionId: options.actor.sessionId,
  });
  try {
    const scan = await scanAutosaveRecovery(root);
    const candidate = scan.candidates.find((item) => item.id === autosaveId);
    if (candidate === undefined || !candidate.valid || candidate.documents === null) {
      throw autosaveError(
        "autosave.restore.invalid",
        "Autosave is missing, corrupt, or semantically invalid.",
      );
    }
    const current = await loadCurrentProjectRevision(root);
    if (candidate.baseRevisionId !== current.pointer.revisionId) {
      throw autosaveError(
        "autosave.restore.stale",
        `Autosave is based on ${candidate.baseRevisionId}, but current revision is ${current.pointer.revisionId}.`,
      );
    }
    await lock.heartbeat();
    return await commitProjectRevision(root, {
      baseRevisionId: current.pointer.revisionId,
      ...(options.revisionId === undefined ? {} : { revisionId: options.revisionId }),
      commandId: `${autosaveId}:restore`,
      idempotencyId: `${autosaveId}:restore`,
      correlationId: `${autosaveId}:recovery`,
      actor: options.actor,
      capability: { name: "autosave-recovery", version: "1.0.0" },
      declaredScope: "mutation",
      authorizationId: null,
      validationOnly: false,
      commandSummary: "Restore autosave",
      diffSummary: `Restored hash-verified autosave ${autosaveId}.`,
      affectedEntityIds: [current.project.projectId],
      warnings: ["Restored after an unclean shutdown or explicit recovery request."],
      documents: candidate.documents,
      now,
    });
  } finally {
    await lock.release();
  }
};

export const readAutosaveMetadata = async (rootPath: string): Promise<AutosaveMetadataDocument> =>
  assertProjectDocument(
    "autosave-metadata",
    JSON.parse(
      await readFile(path.join(path.resolve(rootPath), "autosave-metadata.json"), "utf8"),
    ) as unknown,
  );

export const createDebouncedAutosaveController = (
  rootPath: string,
  options: DebouncedAutosaveOptions,
): DebouncedAutosaveController => {
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < 10 || options.delayMs > 600_000) {
    throw autosaveError("autosave.debounce.invalid", "Autosave delay must be from 10 to 600,000 ms.");
  }
  let pending: RevisionContentDocuments | null = null;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<AutosaveCandidate | null> = Promise.resolve(null);
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = async (reason: AutosaveReason = "debounced"): Promise<AutosaveCandidate | null> => {
    clear();
    if (pending === null) return null;
    const documents = pending;
    pending = null;
    const run = createProjectAutosave(rootPath, {
      reason,
      documents,
      ...(options.idFactory === undefined ? {} : { autosaveId: options.idFactory() }),
      ...(options.now === undefined ? {} : { now: options.now() }),
    });
    inFlight = run;
    return run;
  };
  return {
    schedule(documents): void {
      pending = documents;
      clear();
      timer = setTimeout(() => {
        void flush();
      }, options.delayMs);
    },
    flush,
    async waitForIdle(): Promise<void> {
      if (timer !== null) await flush();
      await inFlight;
    },
    cancel(): void {
      clear();
      pending = null;
    },
  };
};

const readStoredAutosave = async (root: string, id: string): Promise<StoredAutosave> =>
  JSON.parse(await readFile(path.join(root, "autosaves", id, "snapshot.json"), "utf8")) as StoredAutosave;

const assertAutosaveDocuments = (
  documents: RevisionContentDocuments,
  current: Awaited<ReturnType<typeof loadCurrentProjectRevision>>,
  baseRevisionId = current.pointer.revisionId,
): void => {
  const report = validateProjectSnapshot({
    ...documents,
    transaction: {
      ...current.transaction,
      resultingRevisionId: baseRevisionId,
      history: { ...current.transaction.history, contentRevisionId: baseRevisionId },
    },
  });
  if (!report.passed) {
    throw autosaveError(
      "autosave.candidate.invalid",
      report.issues[0]?.message ?? "Autosave candidate failed semantic validation.",
    );
  }
};

const currentContent = (
  current: Awaited<ReturnType<typeof loadCurrentProjectRevision>>,
): RevisionContentDocuments => ({
  project: current.project,
  timeline: current.timeline,
  assets: current.assets,
  settings: current.settings,
  approvalState: current.approvalState,
});

const writeMetadata = async (root: string, metadata: AutosaveMetadataDocument): Promise<void> => {
  assertProjectDocument("autosave-metadata", metadata);
  const target = path.join(root, "autosave-metadata.json");
  const temporary = path.join(root, `.autosave-metadata-${randomUUID()}.tmp`);
  try {
    await writeExclusiveJson(temporary, metadata);
    await rename(temporary, target);
    await syncDirectory(root);
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

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const autosaveError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "autosave-recovery",
    message,
    repairHint: "Choose a hash-verified recovery candidate based on the current revision.",
  });
