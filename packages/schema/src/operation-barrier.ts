import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { stringifyCanonicalJson } from "./canonical-json.js";
import { loadCurrentProjectRevision } from "./revision-store.js";

export interface AsyncOperationBarrier {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly baseRevisionId: string;
  readonly kind: "render" | "export" | "analysis" | "migration";
  readonly actorId: string;
  readonly startedAt: string;
}

export interface BeginAsyncOperationOptions {
  readonly kind: AsyncOperationBarrier["kind"];
  readonly actorId: string;
  readonly operationId?: string;
  readonly now?: Date;
}

export const beginAsyncOperation = async (
  rootPath: string,
  options: BeginAsyncOperationOptions,
): Promise<AsyncOperationBarrier> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const barrier: AsyncOperationBarrier = {
    schemaVersion: "1.0.0",
    id: options.operationId ?? `operation-${randomUUID()}`,
    projectId: current.project.projectId,
    baseRevisionId: current.pointer.revisionId,
    kind: options.kind,
    actorId: options.actorId,
    startedAt: (options.now ?? new Date()).toISOString(),
  };
  const target = barrierPath(root, barrier.id);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(barrier), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return barrier;
};

export const completeAsyncOperation = async (rootPath: string, operationId: string): Promise<boolean> => {
  const target = barrierPath(path.resolve(rootPath), operationId);
  try {
    await readFile(target);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  await rm(target, { force: true });
  return true;
};

export const listAsyncOperationBarriers = async (
  rootPath: string,
): Promise<readonly AsyncOperationBarrier[]> => {
  const root = path.resolve(rootPath);
  const directory = path.join(root, "working", "operation-barriers");
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  return Promise.all(
    names.map(async (name) =>
      assertBarrier(JSON.parse(await readFile(path.join(directory, name), "utf8")) as unknown),
    ),
  );
};

export const assertNoAsyncOperationBarriers = async (rootPath: string): Promise<void> => {
  const barriers = await listAsyncOperationBarriers(rootPath);
  if (barriers.length === 0) return;
  throw barrierError(
    "history.async-operation.active",
    `Undo/redo is blocked while ${barriers.map((barrier) => `${barrier.kind}:${barrier.id}`).join(", ")} is active.`,
  );
};

const barrierPath = (root: string, operationId: string): string => {
  if (!/^operation-[A-Za-z0-9-]{8,100}$/.test(operationId)) {
    throw barrierError("operation.id.invalid", "Async operation ID is invalid.");
  }
  return path.join(root, "working", "operation-barriers", `${operationId}.json`);
};

const assertBarrier = (value: unknown): AsyncOperationBarrier => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw barrierError("operation.barrier.invalid", "Async operation barrier must be an object.");
  }
  const barrier = value as Record<string, unknown>;
  if (
    barrier.schemaVersion !== "1.0.0" ||
    typeof barrier.id !== "string" ||
    typeof barrier.projectId !== "string" ||
    typeof barrier.baseRevisionId !== "string" ||
    !["render", "export", "analysis", "migration"].includes(String(barrier.kind)) ||
    typeof barrier.actorId !== "string" ||
    typeof barrier.startedAt !== "string" ||
    !Number.isFinite(Date.parse(barrier.startedAt))
  ) {
    throw barrierError("operation.barrier.invalid", "Async operation barrier fields are invalid.");
  }
  return barrier as unknown as AsyncOperationBarrier;
};

const barrierError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "async-operation-barrier",
    message,
    repairHint: "Wait for the operation to finish or cancel it explicitly before changing history.",
  });
