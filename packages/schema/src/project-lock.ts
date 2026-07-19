import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { stringifyCanonicalJson } from "./canonical-json.js";

export const projectMutationLockName = ".chai-lock.json" as const;

export interface ProjectMutationLockDocument {
  readonly schemaVersion: "1.0.0";
  readonly token: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly processId: number;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export interface AcquireProjectMutationLockOptions {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly processId?: number;
  readonly ttlMs?: number;
  readonly recoverStale?: boolean;
  readonly now?: () => Date;
}

export interface ProjectMutationLock {
  readonly rootPath: string;
  readonly document: ProjectMutationLockDocument;
  heartbeat(): Promise<ProjectMutationLockDocument>;
  release(): Promise<void>;
}

export const acquireProjectMutationLock = async (
  rootPath: string,
  options: AcquireProjectMutationLockOptions,
): Promise<ProjectMutationLock> => {
  const root = path.resolve(rootPath);
  const lockPath = path.join(root, projectMutationLockName);
  const ttlMs = options.ttlMs ?? 15_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) {
    throw lockError("project.lock.ttl-invalid", "Lock TTL must be an integer from 1,000 to 300,000 ms.");
  }
  const now = options.now ?? (() => new Date());
  const createDocument = (): ProjectMutationLockDocument => {
    const acquiredAt = now();
    return {
      schemaVersion: "1.0.0",
      token: randomUUID(),
      ownerId: options.ownerId,
      sessionId: options.sessionId,
      processId: options.processId ?? process.pid,
      acquiredAt: acquiredAt.toISOString(),
      heartbeatAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + ttlMs).toISOString(),
    };
  };

  let document = createDocument();
  try {
    await writeExclusiveLock(lockPath, document);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    const existing = await readLockDocument(lockPath);
    if (Date.parse(existing.expiresAt) > now().getTime() || options.recoverStale === false) {
      throw lockError("project.lock.held", `Project is locked by ${existing.ownerId}.`, {
        ownerId: existing.ownerId,
        sessionId: existing.sessionId,
        acquiredAt: existing.acquiredAt,
        heartbeatAt: existing.heartbeatAt,
        expiresAt: existing.expiresAt,
      });
    }
    document = await recoverStaleLock(root, existing, createDocument, now);
  }

  let activeDocument = document;
  let released = false;
  return {
    rootPath: root,
    get document() {
      return activeDocument;
    },
    async heartbeat(): Promise<ProjectMutationLockDocument> {
      if (released) throw lockError("project.lock.released", "Cannot heartbeat a released lock.");
      const current = await assertLockOwnership(lockPath, activeDocument.token);
      const heartbeatAt = now();
      const updated: ProjectMutationLockDocument = {
        ...current,
        heartbeatAt: heartbeatAt.toISOString(),
        expiresAt: new Date(heartbeatAt.getTime() + ttlMs).toISOString(),
      };
      await replaceLockAtomically(root, updated);
      activeDocument = updated;
      return updated;
    },
    async release(): Promise<void> {
      if (released) return;
      await assertLockOwnership(lockPath, activeDocument.token);
      await unlink(lockPath);
      await syncDirectory(root);
      released = true;
    },
  };
};

export const readProjectMutationLock = async (
  rootPath: string,
): Promise<ProjectMutationLockDocument | null> => {
  try {
    return await readLockDocument(path.join(path.resolve(rootPath), projectMutationLockName));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
};

const recoverStaleLock = async (
  root: string,
  originallyObserved: ProjectMutationLockDocument,
  createDocument: () => ProjectMutationLockDocument,
  now: () => Date,
): Promise<ProjectMutationLockDocument> => {
  const gate = path.join(root, ".chai-lock-recovery");
  try {
    await mkdir(gate, { recursive: false, mode: 0o700 });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      throw lockError("project.lock.recovery-busy", "Another session is recovering the stale lock.");
    }
    throw cause;
  }
  const lockPath = path.join(root, projectMutationLockName);
  const quarantine = path.join(gate, `stale-${originallyObserved.token}.json`);
  try {
    const current = await readLockDocument(lockPath);
    if (current.token !== originallyObserved.token || Date.parse(current.expiresAt) > now().getTime()) {
      throw lockError("project.lock.changed", "The lock changed while stale recovery was starting.");
    }
    await rename(lockPath, quarantine);
    await syncDirectory(root);
    const replacement = createDocument();
    await writeExclusiveLock(lockPath, replacement);
    await syncDirectory(root);
    return replacement;
  } finally {
    await rm(gate, { recursive: true, force: true });
  }
};

const writeExclusiveLock = async (filePath: string, document: ProjectMutationLockDocument): Promise<void> => {
  assertLockDocument(document);
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(document), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const replaceLockAtomically = async (root: string, document: ProjectMutationLockDocument): Promise<void> => {
  const temporary = path.join(root, `.chai-lock-${document.token}-${randomUUID()}.tmp`);
  try {
    await writeExclusiveLock(temporary, document);
    await rename(temporary, path.join(root, projectMutationLockName));
    await syncDirectory(root);
  } finally {
    await rm(temporary, { force: true });
  }
};

const assertLockOwnership = async (lockPath: string, token: string): Promise<ProjectMutationLockDocument> => {
  const current = await readLockDocument(lockPath);
  if (current.token !== token) {
    throw lockError("project.lock.ownership-lost", "This session no longer owns the project lock.", {
      ownerId: current.ownerId,
      sessionId: current.sessionId,
    });
  }
  return current;
};

const readLockDocument = async (lockPath: string): Promise<ProjectMutationLockDocument> => {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") throw cause;
    throw lockError("project.lock.unreadable", "Project lock is not valid JSON.", undefined, cause);
  }
  return assertLockDocument(value);
};

const assertLockDocument = (value: unknown): ProjectMutationLockDocument => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw lockError("project.lock.invalid", "Project lock must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const keys = [
    "schemaVersion",
    "token",
    "ownerId",
    "sessionId",
    "processId",
    "acquiredAt",
    "heartbeatAt",
    "expiresAt",
  ];
  if (
    Object.keys(candidate).length !== keys.length ||
    keys.some((key) => !(key in candidate)) ||
    candidate.schemaVersion !== "1.0.0" ||
    typeof candidate.token !== "string" ||
    candidate.token.length < 8 ||
    typeof candidate.ownerId !== "string" ||
    candidate.ownerId.length === 0 ||
    typeof candidate.sessionId !== "string" ||
    candidate.sessionId.length === 0 ||
    !Number.isSafeInteger(candidate.processId) ||
    (candidate.processId as number) < 0 ||
    !isTimestamp(candidate.acquiredAt) ||
    !isTimestamp(candidate.heartbeatAt) ||
    !isTimestamp(candidate.expiresAt)
  ) {
    throw lockError("project.lock.invalid", "Project lock fields are invalid.");
  }
  return candidate as unknown as ProjectMutationLockDocument;
};

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const lockError = (
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  cause?: unknown,
): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "project-mutation-lock",
    message,
    repairHint: "Close the other writer or recover only after its heartbeat has expired.",
    ...(details === undefined ? {} : { details }),
    ...(cause === undefined ? {} : { cause }),
  });
