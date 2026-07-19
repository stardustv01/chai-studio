import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSupportBundlePreviewManifest,
  redactTextWithContext,
  redactValueWithContext,
  type DiagnosticCategory,
  type DiagnosticSeverity,
  type SupportBundlePreviewManifest,
} from "@chai-studio/diagnostics";

export interface LocalStructuredLogRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly timestamp: string;
  readonly severity: DiagnosticSeverity;
  readonly category: DiagnosticCategory;
  readonly event: string;
  readonly correlationId: string;
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly entityId: string | null;
  readonly stage: string | null;
  readonly frame: string | null;
  readonly durationMs: number | null;
  readonly memoryMiB: number | null;
  readonly concurrency: number | null;
  readonly cacheReason: string | null;
  readonly data: unknown;
}

export interface LocalCrashRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly correlationId: string;
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly localOnly: true;
  readonly telemetryUploaded: false;
  readonly details: unknown;
}

export class LocalDiagnosticsStore {
  readonly #projectRoot: string;
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #maximumBytes: number;
  readonly #maximumFiles: number;
  #transaction: Promise<void> = Promise.resolve();

  constructor(input: {
    readonly projectRoot: string;
    readonly now?: () => Date;
    readonly maximumBytes?: number;
    readonly maximumFiles?: number;
  }) {
    if (!path.isAbsolute(input.projectRoot)) throw new Error("Diagnostics project root must be absolute.");
    this.#projectRoot = path.resolve(input.projectRoot);
    this.#directory = path.join(this.#projectRoot, ".chai-cache", "diagnostics");
    this.#now = input.now ?? (() => new Date());
    this.#maximumBytes = bounded(input.maximumBytes ?? 2_097_152, 4_096, 134_217_728, "log bytes");
    this.#maximumFiles = bounded(input.maximumFiles ?? 5, 1, 20, "log files");
  }

  append(
    input: Omit<LocalStructuredLogRecord, "schemaVersion" | "id" | "timestamp"> &
      Partial<Pick<LocalStructuredLogRecord, "id" | "timestamp">>,
  ): Promise<LocalStructuredLogRecord> {
    const record: LocalStructuredLogRecord = {
      schemaVersion: "1.0.0",
      id: input.id ?? `diagnostic-${randomUUID()}`,
      timestamp: input.timestamp ?? this.#now().toISOString(),
      severity: input.severity,
      category: input.category,
      event: input.event,
      correlationId: input.correlationId,
      projectId: input.projectId,
      revisionId: input.revisionId,
      entityId: input.entityId,
      stage: input.stage,
      frame: input.frame,
      durationMs: input.durationMs,
      memoryMiB: input.memoryMiB,
      concurrency: input.concurrency,
      cacheReason: input.cacheReason,
      data: redactValueWithContext(input.data, { projectRoot: this.#projectRoot }),
    };
    validateLog(record);
    const line = `${JSON.stringify(record)}\n`;
    const write = this.#transaction.then(async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await this.#rotateIfNeeded(Buffer.byteLength(line));
      await appendFile(this.#logPath(0), line, { encoding: "utf8", mode: 0o600 });
    });
    this.#transaction = write.catch(() => undefined);
    return write.then(() => record);
  }

  async search(
    input: {
      readonly correlationId?: string | null;
      readonly event?: string | null;
      readonly limit?: number;
    } = {},
  ): Promise<readonly LocalStructuredLogRecord[]> {
    await this.#transaction;
    const limit = bounded(input.limit ?? 200, 1, 2_000, "search limit");
    const records: LocalStructuredLogRecord[] = [];
    for (let index = this.#maximumFiles - 1; index >= 0; index -= 1) {
      let content: string;
      try {
        content = await readFile(this.#logPath(index), "utf8");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw cause;
      }
      for (const line of content.split("\n")) {
        if (line.trim().length === 0) continue;
        try {
          const record = JSON.parse(line) as LocalStructuredLogRecord;
          validateLog(record);
          if (input.correlationId !== undefined && input.correlationId !== null) {
            if (record.correlationId !== input.correlationId) continue;
          }
          if (input.event !== undefined && input.event !== null && record.event !== input.event) continue;
          records.push(record);
        } catch {
          // A partial final line is ignored; the next rotation remains readable.
        }
      }
    }
    return records.slice(-limit);
  }

  async supportBundlePreview(input: {
    readonly createdByExplicitAction: boolean;
    readonly recordIds: readonly string[];
  }): Promise<SupportBundlePreviewManifest> {
    const selected = new Set(input.recordIds);
    const records = (await this.search({ limit: 2_000 })).filter((record) => selected.has(record.id));
    if (records.length !== selected.size)
      throw new Error("Diagnostics bundle selection contains unknown records.");
    return createSupportBundlePreviewManifest({
      createdByExplicitAction: input.createdByExplicitAction,
      includedRecordIds: records.map((record) => record.id),
      metadata: {
        projectId: records[0]?.projectId ?? null,
        records,
        privacy: {
          projectMedia: "excluded",
          executableSource: "excluded",
          secrets: "redacted",
          transmission: "none",
        },
      },
      context: { projectRoot: this.#projectRoot },
    });
  }

  async exportSupportBundle(input: {
    readonly createdByExplicitAction: boolean;
    readonly recordIds: readonly string[];
  }): Promise<Readonly<{ id: string; relativePath: string; manifest: SupportBundlePreviewManifest }>> {
    const manifest = await this.supportBundlePreview(input);
    const id = `support-bundle-${randomUUID()}`;
    const directory = path.join(this.#projectRoot, "support-bundles", id);
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    await mkdir(directory, { recursive: false, mode: 0o700 });
    await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return {
      id,
      relativePath: path.relative(this.#projectRoot, directory).split(path.sep).join("/"),
      manifest,
    };
  }

  async recordCrash(input: {
    readonly summary: string;
    readonly correlationId: string;
    readonly projectId: string | null;
    readonly revisionId: string | null;
    readonly details: unknown;
  }): Promise<LocalCrashRecord> {
    const record: LocalCrashRecord = {
      schemaVersion: "1.0.0",
      id: `crash-${randomUUID()}`,
      occurredAt: this.#now().toISOString(),
      summary: redactTextWithContext(input.summary.slice(0, 1_024), { projectRoot: this.#projectRoot }),
      correlationId: input.correlationId,
      projectId: input.projectId,
      revisionId: input.revisionId,
      localOnly: true,
      telemetryUploaded: false,
      details: redactValueWithContext(input.details, { projectRoot: this.#projectRoot }),
    };
    const directory = path.join(this.#directory, "crashes");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    return record;
  }

  async #rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try {
      currentBytes = (await stat(this.#logPath(0))).size;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    if (currentBytes + incomingBytes <= this.#maximumBytes) return;
    await rm(this.#logPath(this.#maximumFiles - 1), { force: true });
    for (let index = this.#maximumFiles - 2; index >= 0; index -= 1) {
      try {
        await rename(this.#logPath(index), this.#logPath(index + 1));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
  }

  #logPath(index: number): string {
    return path.join(this.#directory, index === 0 ? "studio.jsonl" : `studio.${String(index)}.jsonl`);
  }
}

export const listLocalCrashRecords = async (projectRoot: string): Promise<readonly string[]> => {
  const directory = path.join(path.resolve(projectRoot), ".chai-cache", "diagnostics", "crashes");
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
};

const validateLog = (record: LocalStructuredLogRecord): void => {
  if (
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(record.id) ||
    !Number.isFinite(Date.parse(record.timestamp)) ||
    record.event.trim().length === 0 ||
    record.correlationId.trim().length === 0 ||
    [record.durationMs, record.memoryMiB, record.concurrency].some(
      (value) => value !== null && (!Number.isFinite(value) || value < 0),
    )
  ) {
    throw new Error("Local structured diagnostic record is invalid.");
  }
};

const bounded = (value: number, minimum: number, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Diagnostics ${label} is outside bounded limits.`);
  }
  return value;
};
