import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import {
  executeProjectCommand,
  type CommandExecutionReceipt,
  type ExecuteProjectCommandOptions,
} from "./command-engine.js";
import type { SourceEditCommand } from "./command-envelope.js";
import { stringifyCanonicalJson } from "./canonical-json.js";
import { loadCurrentProjectRevision, type CommitActor } from "./revision-store.js";

export interface SourceEditSession {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly actor: CommitActor;
  readonly path: string;
  readonly baseRevisionId: string;
  readonly sourceHash: string;
  readonly createdAt: string;
}

export interface BeginSourceEditOptions {
  readonly path: string;
  readonly actor: CommitActor;
  readonly now?: Date;
  readonly sessionId?: string;
}

export interface CommitSourceEditOptions {
  readonly content: string;
  readonly revisionId?: string;
  readonly now?: Date;
  readonly validateSource?: ExecuteProjectCommandOptions["validateSource"];
  readonly invalidateSourceCaches?: ExecuteProjectCommandOptions["invalidateSourceCaches"];
}

export const beginSourceEdit = async (
  rootPath: string,
  options: BeginSourceEditOptions,
): Promise<SourceEditSession> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const sourcePath = resolveEditableSource(root, options.path);
  const content = await readFile(sourcePath, "utf8");
  const session: SourceEditSession = {
    schemaVersion: "1.0.0",
    id: options.sessionId ?? `source-session-${randomUUID()}`,
    projectId: current.project.projectId,
    actor: options.actor,
    path: options.path,
    baseRevisionId: current.pointer.revisionId,
    sourceHash: hashText(content),
    createdAt: (options.now ?? new Date()).toISOString(),
  };
  await writeSession(root, session);
  return session;
};

export const commitSourceEdit = async (
  rootPath: string,
  sourceSessionId: string,
  options: CommitSourceEditOptions,
): Promise<CommandExecutionReceipt> => {
  const root = path.resolve(rootPath);
  const session = await readSourceEditSession(root, sourceSessionId);
  const now = options.now ?? new Date();
  const command: SourceEditCommand = {
    schemaVersion: "1.0.0",
    commandId: `${session.id}:commit`,
    idempotencyId: `${session.id}:commit`,
    actor: session.actor,
    projectId: session.projectId,
    correlationId: `${session.id}:correlation`,
    issuedAt: now.toISOString(),
    capability: { name: "source-editor", version: "1.0.0" },
    payloadVersion: "1.0.0",
    affectedEntityIds: [session.projectId],
    declaredScope: "source-edit",
    validationOnly: false,
    baseRevisionId: session.baseRevisionId,
    authorizationId: null,
    kind: "source.edit",
    payload: { path: session.path, expectedHash: session.sourceHash, content: options.content },
  };
  const receipt = await executeProjectCommand(root, command, {
    ...(options.revisionId === undefined ? {} : { revisionId: options.revisionId }),
    now: () => now,
    ...(options.validateSource === undefined ? {} : { validateSource: options.validateSource }),
    ...(options.invalidateSourceCaches === undefined
      ? {}
      : { invalidateSourceCaches: options.invalidateSourceCaches }),
  });
  if (receipt.status === "committed" || receipt.error?.code === "source.edit.external-change") {
    await removeSession(root, sourceSessionId);
  }
  return receipt;
};

export const abortSourceEdit = async (rootPath: string, sourceSessionId: string): Promise<boolean> => {
  const root = path.resolve(rootPath);
  try {
    await readSourceEditSession(root, sourceSessionId);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  await removeSession(root, sourceSessionId);
  return true;
};

export const readSourceEditSession = async (
  rootPath: string,
  sourceSessionId: string,
): Promise<SourceEditSession> => {
  const root = path.resolve(rootPath);
  const sessionPath = sourceSessionPath(root, sourceSessionId);
  const value = JSON.parse(await readFile(sessionPath, "utf8")) as unknown;
  return assertSession(value);
};

const writeSession = async (root: string, session: SourceEditSession): Promise<void> => {
  const target = sourceSessionPath(root, session.id);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(session), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const removeSession = async (root: string, sourceSessionId: string): Promise<void> =>
  rm(sourceSessionPath(root, sourceSessionId), { force: true });

const sourceSessionPath = (root: string, sourceSessionId: string): string => {
  if (!/^source-session-[A-Za-z0-9-]{8,100}$/.test(sourceSessionId)) {
    throw sourceSessionError("source.session.id-invalid", "Source edit session ID is invalid.");
  }
  return path.join(root, "working", "source-edit-sessions", `${sourceSessionId}.json`);
};

const resolveEditableSource = (root: string, relativePath: string): string => {
  if (!/^scenes\/(?:remotion|hyperframes|shared)\/.+/.test(relativePath)) {
    throw sourceSessionError(
      "source.session.path-invalid",
      "Source edit path must stay inside a canonical scenes engine directory.",
    );
  }
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw sourceSessionError("source.session.path-escape", "Source edit path escapes the project folder.");
  }
  return resolved;
};

const assertSession = (value: unknown): SourceEditSession => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw sourceSessionError("source.session.invalid", "Source edit session must be an object.");
  }
  const session = value as Record<string, unknown>;
  if (
    session.schemaVersion !== "1.0.0" ||
    typeof session.id !== "string" ||
    typeof session.projectId !== "string" ||
    typeof session.path !== "string" ||
    typeof session.baseRevisionId !== "string" ||
    typeof session.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(session.sourceHash) ||
    typeof session.createdAt !== "string" ||
    !Number.isFinite(Date.parse(session.createdAt)) ||
    session.actor === null ||
    typeof session.actor !== "object"
  ) {
    throw sourceSessionError("source.session.invalid", "Source edit session fields are invalid.");
  }
  return session as unknown as SourceEditSession;
};

const hashText = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");

const sourceSessionError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "source-edit-session",
    message,
    repairHint: "Begin a new source edit session from the current project revision and working-file hash.",
  });
