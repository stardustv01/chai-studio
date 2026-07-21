import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { stringifyCanonicalJson } from "@chai-studio/schema";

export type ReliabilityFaultPoint =
  | "revision-write"
  | "cache-publish"
  | "render-stage"
  | "encode-finalize"
  | "receipt-write"
  | "approval-transition"
  | "lifecycle-intent-written"
  | "lifecycle-revision-committed";

export type RenderRecoveryStage =
  | "request-persisted"
  | "operation-started"
  | "render-stage-complete"
  | "artifacts-validated"
  | "receipt-published"
  | "approval-transitioned"
  | "output-published";

export interface RenderRecoveryArtifact {
  readonly relativePath: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly primary: boolean;
}

export interface RenderRecoveryRecord {
  readonly schemaVersion: "1.0.0";
  readonly requestId: string;
  readonly retryOfRequestId: string | null;
  readonly projectId: string;
  readonly revisionId: string;
  readonly outputId: string | null;
  readonly status: "pending" | "running" | "failed" | "cancelled" | "completed";
  readonly stage: RenderRecoveryStage;
  readonly completedStages: readonly RenderRecoveryStage[];
  readonly validatedArtifacts: readonly RenderRecoveryArtifact[];
  readonly partialOutputRetained: boolean;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface RenderResumeContext {
  readonly priorRequestId: string;
  readonly priorOutputId: string | null;
  readonly completedStages: readonly RenderRecoveryStage[];
  readonly validatedArtifacts: readonly RenderRecoveryArtifact[];
}

export class InjectedReliabilityFault extends Error {
  readonly point: ReliabilityFaultPoint;

  constructor(point: ReliabilityFaultPoint) {
    super(`Injected reliability fault at ${point}.`);
    this.name = "InjectedReliabilityFault";
    this.point = point;
  }
}

export class ReliabilityFaultInjector {
  readonly #remaining = new Map<ReliabilityFaultPoint, number>();

  arm(point: ReliabilityFaultPoint, count = 1): void {
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new Error("Fault injection count is outside bounded limits.");
    }
    this.#remaining.set(point, count);
  }

  checkpoint(point: ReliabilityFaultPoint): void {
    const remaining = this.#remaining.get(point) ?? 0;
    if (remaining === 0) return;
    if (remaining === 1) this.#remaining.delete(point);
    else this.#remaining.set(point, remaining - 1);
    throw new InjectedReliabilityFault(point);
  }

  armed(): readonly Readonly<{ point: ReliabilityFaultPoint; remaining: number }>[] {
    return [...this.#remaining.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([point, remaining]) => ({ point, remaining }));
  }
}

export class RenderRecoveryJournalStore {
  readonly #projectRoot: string;
  readonly #directory: string;
  readonly #now: () => Date;

  constructor(projectRoot: string, now: () => Date = () => new Date()) {
    if (!path.isAbsolute(projectRoot)) throw new Error("Render recovery project root must be absolute.");
    this.#projectRoot = path.resolve(projectRoot);
    this.#directory = path.join(this.#projectRoot, "renders", "queue", "recovery");
    this.#now = now;
  }

  async begin(input: {
    readonly requestId: string;
    readonly retryOfRequestId: string | null;
    readonly projectId: string;
    readonly revisionId: string;
    readonly outputId?: string | null;
  }): Promise<RenderRecoveryRecord> {
    const record: RenderRecoveryRecord = {
      schemaVersion: "1.0.0",
      requestId: validId(input.requestId),
      retryOfRequestId: input.retryOfRequestId === null ? null : validId(input.retryOfRequestId),
      projectId: validId(input.projectId),
      revisionId: validId(input.revisionId),
      outputId: input.outputId === undefined || input.outputId === null ? null : validId(input.outputId),
      status: "pending",
      stage: "request-persisted",
      completedStages: ["request-persisted"],
      validatedArtifacts: [],
      partialOutputRetained: false,
      lastError: null,
      updatedAt: this.#now().toISOString(),
    };
    await this.write(record);
    return record;
  }

  async advance(
    current: RenderRecoveryRecord,
    input: {
      readonly stage: RenderRecoveryStage;
      readonly status?: RenderRecoveryRecord["status"];
      readonly outputId?: string | null;
      readonly validatedArtifacts?: readonly RenderRecoveryArtifact[];
    },
  ): Promise<RenderRecoveryRecord> {
    const currentIndex = recoveryStages.indexOf(current.stage);
    const nextIndex = recoveryStages.indexOf(input.stage);
    if (currentIndex < 0 || nextIndex < currentIndex) {
      throw new Error("Render recovery stages cannot move backwards.");
    }
    const record: RenderRecoveryRecord = {
      ...current,
      stage: input.stage,
      status: input.status ?? (input.stage === "output-published" ? "completed" : "running"),
      outputId:
        input.outputId === undefined
          ? current.outputId
          : input.outputId === null
            ? null
            : validId(input.outputId),
      completedStages: recoveryStages.slice(0, nextIndex + 1),
      validatedArtifacts:
        input.validatedArtifacts === undefined
          ? current.validatedArtifacts
          : input.validatedArtifacts.map(validateArtifact),
      partialOutputRetained: false,
      lastError: null,
      updatedAt: this.#now().toISOString(),
    };
    await this.write(record);
    return record;
  }

  async fail(
    current: RenderRecoveryRecord,
    input: Readonly<{ cancelled: boolean; error: string; partialOutputRetained: boolean }>,
  ): Promise<RenderRecoveryRecord> {
    const record: RenderRecoveryRecord = {
      ...current,
      status: input.cancelled ? "cancelled" : "failed",
      partialOutputRetained: input.partialOutputRetained,
      lastError: input.error.slice(0, 4_096),
      updatedAt: this.#now().toISOString(),
    };
    await this.write(record);
    return record;
  }

  async read(requestId: string): Promise<RenderRecoveryRecord | null> {
    const target = path.join(this.#directory, `${validId(requestId)}.json`);
    try {
      return validateRecord(JSON.parse(await readFile(target, "utf8")) as unknown);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async resumeContext(requestId: string): Promise<RenderResumeContext | null> {
    const prior = await this.read(requestId);
    if (prior === null) return null;
    const validated: RenderRecoveryArtifact[] = [];
    for (const artifact of prior.validatedArtifacts) {
      const absolute = resolveProjectRelative(this.#projectRoot, artifact.relativePath);
      try {
        const metadata = await stat(absolute);
        if (!metadata.isFile() || metadata.size !== artifact.byteLength) continue;
        if ((await hashFile(absolute)) !== artifact.contentHash) continue;
        validated.push(artifact);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    return {
      priorRequestId: prior.requestId,
      priorOutputId: prior.outputId,
      completedStages: prior.completedStages,
      validatedArtifacts: validated,
    };
  }

  async write(record: RenderRecoveryRecord): Promise<void> {
    validateRecord(record);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const target = path.join(this.#directory, `${record.requestId}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(stringifyCanonicalJson(record), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

const recoveryStages: readonly RenderRecoveryStage[] = [
  "request-persisted",
  "operation-started",
  "render-stage-complete",
  "artifacts-validated",
  "receipt-published",
  "approval-transitioned",
  "output-published",
];

const validateRecord = (value: unknown): RenderRecoveryRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Render recovery record must be an object.");
  }
  const record = value as RenderRecoveryRecord;
  if (
    !recoveryStages.includes(record.stage) ||
    !["pending", "running", "failed", "cancelled", "completed"].includes(record.status) ||
    !Array.isArray(record.completedStages) ||
    !Array.isArray(record.validatedArtifacts) ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    throw new Error("Render recovery record is invalid.");
  }
  validId(record.requestId);
  validId(record.projectId);
  validId(record.revisionId);
  if (record.retryOfRequestId !== null) validId(record.retryOfRequestId);
  if (record.outputId !== null) validId(record.outputId);
  record.validatedArtifacts.forEach(validateArtifact);
  return record;
};

const validateArtifact = (artifact: RenderRecoveryArtifact): RenderRecoveryArtifact => {
  if (
    path.isAbsolute(artifact.relativePath) ||
    artifact.relativePath.includes("\0") ||
    artifact.relativePath.split(/[\\/]/u).includes("..") ||
    !/^[a-f0-9]{64}$/.test(artifact.contentHash) ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength < 0
  ) {
    throw new Error("Render recovery artifact is invalid.");
  }
  return { ...artifact, relativePath: artifact.relativePath.replaceAll("\\", "/") };
};

const resolveProjectRelative = (root: string, relativePath: string): string => {
  const normalized = validateArtifact({
    relativePath,
    contentHash: "0".repeat(64),
    byteLength: 0,
    primary: false,
  }).relativePath;
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Recovery path escapes project.");
  return resolved;
};

const validId = (value: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) {
    throw new Error("Render recovery identity is invalid.");
  }
  return value;
};

const hashFile = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
