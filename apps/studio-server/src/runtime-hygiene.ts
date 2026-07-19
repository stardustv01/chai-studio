import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import {
  access as accessAsync,
  mkdir as mkdirAsync,
  open as openAsync,
  readdir as readdirAsync,
  rename as renameAsync,
  stat as statAsync,
  statfs as statfsAsync,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioEventHub } from "./event-hub.js";
import type { StudioJobRegistry } from "./job-registry.js";
import type { ProjectSessionService } from "./project-service.js";
import type { RegenerableStudioIndex } from "./regenerable-index.js";

export interface DiskPreflightReport {
  readonly passed: boolean;
  readonly minimumFreeBytes: number;
  readonly project: Readonly<{ path: string; freeBytes: number; passed: boolean }>;
  readonly systemTemp: Readonly<{ path: string; freeBytes: number; passed: boolean }>;
}

export interface RuntimeFileChange {
  readonly sequence: number;
  readonly projectId: string;
  readonly revisionId: string;
  readonly relativePath: string;
  readonly eventType: "rename" | "change";
  readonly observedAt: string;
}

export interface RuntimeOrphanRecord {
  readonly relativePath: string;
  readonly kind: "temp-file" | "revision-staging" | "incomplete-render";
  readonly modifiedAt: string;
  readonly ageMs: number;
  readonly quarantineEligible: boolean;
}

export interface RuntimeHygieneStatus {
  readonly active: boolean;
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly watchedDirectoryCount: number;
  readonly observedChangeCount: number;
  readonly tempRelativePath: ".chai-cache/tmp";
  readonly lastError: string | null;
}

export class RuntimeHygieneService {
  readonly #projects: ProjectSessionService;
  readonly #jobs: StudioJobRegistry;
  readonly #index: RegenerableStudioIndex;
  readonly #events: StudioEventHub;
  readonly #now: () => Date;
  readonly #minimumFreeBytes: number;
  readonly #orphanAgeMs: number;
  readonly #watchers: FSWatcher[] = [];
  readonly #changes: RuntimeFileChange[] = [];
  readonly #unsubscribe: () => void;
  #projectId: string | null = null;
  #revisionId: string | null = null;
  #changeSequence = 0;
  #lastError: string | null = null;
  #activation: Promise<void> = Promise.resolve();
  #shutdown: Promise<void> | null = null;

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly jobs: StudioJobRegistry;
    readonly index: RegenerableStudioIndex;
    readonly events: StudioEventHub;
    readonly now?: () => Date;
    readonly minimumFreeBytes?: number;
    readonly orphanAgeMs?: number;
  }) {
    this.#projects = input.projects;
    this.#jobs = input.jobs;
    this.#index = input.index;
    this.#events = input.events;
    this.#now = input.now ?? (() => new Date());
    this.#minimumFreeBytes = boundedInteger(
      input.minimumFreeBytes ?? 2_147_483_648,
      0,
      Number.MAX_SAFE_INTEGER,
      "minimum free bytes",
    );
    this.#orphanAgeMs = boundedInteger(input.orphanAgeMs ?? 86_400_000, 0, 31_536_000_000, "orphan age");
    this.#unsubscribe = this.#projects.subscribe((event) => {
      if (event.type === "project.closed") this.#deactivate();
      else this.#scheduleActivation();
    });
  }

  activate(): Promise<RuntimeHygieneStatus> {
    return this.#enqueueActivation(() => this.#performActivation());
  }

  async #performActivation(): Promise<RuntimeHygieneStatus> {
    const root = this.#projects.openRootPath();
    const snapshot = await this.#projects.snapshot();
    await this.diskPreflight();
    await mkdirAsync(path.join(root, ".chai-cache", "tmp"), { recursive: true, mode: 0o700 });
    this.#deactivateWatchers();
    for (const relative of watchDirectories) {
      const directory = path.join(root, relative);
      await mkdirAsync(directory, { recursive: true, mode: 0o700 });
      this.#watchers.push(
        watch(directory, { persistent: false }, (eventType, fileName) => {
          if (fileName === null) return;
          this.#recordChange(
            snapshot.project.projectId,
            snapshot.pointer.revisionId,
            relative,
            eventType,
            fileName,
          );
        }),
      );
    }
    this.#projectId = snapshot.project.projectId;
    this.#revisionId = snapshot.pointer.revisionId;
    this.#lastError = null;
    this.#events.publish({
      type: "runtime.activated",
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      payload: this.status(),
    });
    return this.status();
  }

  async diskPreflight(): Promise<DiskPreflightReport> {
    const root = this.#projects.openRootPath();
    const [projectStats, tempStats] = await Promise.all([statfsAsync(root), statfsAsync(os.tmpdir())]);
    const projectFree = projectStats.bavail * projectStats.bsize;
    const tempFree = tempStats.bavail * tempStats.bsize;
    return {
      passed: projectFree >= this.#minimumFreeBytes && tempFree >= this.#minimumFreeBytes,
      minimumFreeBytes: this.#minimumFreeBytes,
      project: { path: root, freeBytes: projectFree, passed: projectFree >= this.#minimumFreeBytes },
      systemTemp: {
        path: os.tmpdir(),
        freeBytes: tempFree,
        passed: tempFree >= this.#minimumFreeBytes,
      },
    };
  }

  async scanOrphans(): Promise<readonly RuntimeOrphanRecord[]> {
    const root = this.#projects.openRootPath();
    const now = this.#now().getTime();
    const records: RuntimeOrphanRecord[] = [];
    await collectTempOrphans(path.join(root, ".chai-cache", "tmp"), root, now, this.#orphanAgeMs, records);
    await collectNamedDirectoryOrphans(
      path.join(root, "revisions"),
      root,
      now,
      this.#orphanAgeMs,
      (name) => name.startsWith(".staging-"),
      "revision-staging",
      false,
      records,
    );
    await collectNamedDirectoryOrphans(
      path.join(root, "renders"),
      root,
      now,
      this.#orphanAgeMs,
      () => true,
      "incomplete-render",
      true,
      records,
      "output.json",
    );
    return records.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  }

  async quarantine(
    relativePath: string,
    reason: string,
  ): Promise<Readonly<{ id: string; relativePath: string }>> {
    const root = this.#projects.openRootPath();
    const normalized = normalizeRelativePath(relativePath);
    const candidate = (await this.scanOrphans()).find((record) => record.relativePath === normalized);
    if (candidate === undefined) throw new Error("Runtime quarantine target is not a detected stale orphan.");
    if (!candidate.quarantineEligible) {
      throw new Error("Runtime quarantine refuses authority-adjacent revision staging entries.");
    }
    if (reason.trim().length === 0 || reason.length > 1_024)
      throw new Error("Runtime quarantine reason is invalid.");
    const id = `quarantine-${randomUUID()}`;
    const directory = path.join(root, ".chai-cache", "quarantine", "runtime", id);
    await mkdirAsync(directory, { recursive: true, mode: 0o700 });
    const source = path.resolve(root, normalized);
    if (!source.startsWith(`${path.resolve(root)}${path.sep}`))
      throw new Error("Runtime quarantine path escapes project.");
    const target = path.join(directory, path.basename(source));
    await renameAsync(source, target);
    await writeJsonAtomic(path.join(directory, "manifest.json"), {
      schemaVersion: "1.0.0",
      id,
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      originalRelativePath: normalized,
      quarantinedRelativePath: path.relative(root, target).split(path.sep).join("/"),
      kind: candidate.kind,
      reason,
      quarantinedAt: this.#now().toISOString(),
    });
    this.#events.publish({
      type: "runtime.orphan-quarantined",
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      payload: { id, relativePath: normalized, kind: candidate.kind },
    });
    return { id, relativePath: path.relative(root, target).split(path.sep).join("/") };
  }

  changes(): readonly RuntimeFileChange[] {
    return this.#changes.map((change) => structuredClone(change));
  }

  status(): RuntimeHygieneStatus {
    return {
      active: this.#watchers.length > 0,
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      watchedDirectoryCount: this.#watchers.length,
      observedChangeCount: this.#changes.length,
      tempRelativePath: ".chai-cache/tmp",
      lastError: this.#lastError,
    };
  }

  shutdown(): Promise<void> {
    if (this.#shutdown !== null) return this.#shutdown;
    this.#shutdown = this.#performShutdown();
    return this.#shutdown;
  }

  async #performShutdown(): Promise<void> {
    await this.#activation;
    this.#unsubscribe();
    this.#deactivateWatchers();
    const activeJobs = this.#jobs.list().filter((job) => job.status === "queued" || job.status === "running");
    for (const job of activeJobs) this.#jobs.cancel(job.id);
    await Promise.all(activeJobs.map((job) => this.#jobs.wait(job.id)));
    this.#index.close();
    await this.#projects.close();
    this.#events.publish({
      type: "runtime.shutdown-complete",
      payload: { cancelledJobs: activeJobs.length },
    });
    this.#projectId = null;
    this.#revisionId = null;
  }

  #scheduleActivation(): void {
    void this.activate().catch((cause: unknown) => {
      this.#lastError = cause instanceof Error ? cause.message : "Runtime activation failed.";
    });
  }

  async #enqueueActivation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#activation.then(task);
    this.#activation = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #recordChange(
    projectId: string,
    revisionId: string,
    directory: string,
    eventType: "rename" | "change",
    fileName: string | Buffer,
  ): void {
    const name = fileName.toString();
    const relativePath = path.posix.join(directory, name.split(path.sep).join("/"));
    this.#changeSequence += 1;
    const change: RuntimeFileChange = {
      sequence: this.#changeSequence,
      projectId,
      revisionId,
      relativePath,
      eventType,
      observedAt: this.#now().toISOString(),
    };
    this.#changes.push(change);
    if (this.#changes.length > 10_000) this.#changes.splice(0, this.#changes.length - 10_000);
    this.#events.publish({
      type: "filesystem.changed",
      projectId,
      revisionId,
      payload: change,
    });
  }

  #deactivate(): void {
    this.#deactivateWatchers();
    this.#projectId = null;
    this.#revisionId = null;
  }

  #deactivateWatchers(): void {
    for (const watcher of this.#watchers.splice(0)) watcher.close();
  }
}

const watchDirectories = [
  "assets",
  "scenes/remotion",
  "scenes/hyperframes",
  "scenes/shared",
  "captures",
  "reviews",
  "renders",
] as const;

const collectTempOrphans = async (
  directory: string,
  root: string,
  now: number,
  age: number,
  records: RuntimeOrphanRecord[],
): Promise<void> => {
  let entries;
  try {
    entries = await readdirAsync(directory, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectTempOrphans(absolute, root, now, age, records);
    else if (entry.isFile()) {
      const metadata = await statAsync(absolute);
      const ageMs = Math.max(0, now - metadata.mtimeMs);
      if (ageMs >= age) records.push(orphan(root, absolute, "temp-file", metadata.mtime, ageMs, true));
    }
  }
};

const collectNamedDirectoryOrphans = async (
  directory: string,
  root: string,
  now: number,
  age: number,
  include: (name: string) => boolean,
  kind: RuntimeOrphanRecord["kind"],
  eligible: boolean,
  records: RuntimeOrphanRecord[],
  requiredMissingFile?: string,
): Promise<void> => {
  let entries;
  try {
    entries = await readdirAsync(directory, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !include(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (requiredMissingFile !== undefined) {
      try {
        await accessAsync(path.join(absolute, requiredMissingFile));
        continue;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    const metadata = await statAsync(absolute);
    const ageMs = Math.max(0, now - metadata.mtimeMs);
    if (ageMs >= age) records.push(orphan(root, absolute, kind, metadata.mtime, ageMs, eligible));
  }
};

const orphan = (
  root: string,
  absolute: string,
  kind: RuntimeOrphanRecord["kind"],
  modifiedAt: Date,
  ageMs: number,
  quarantineEligible: boolean,
): RuntimeOrphanRecord => ({
  relativePath: path.relative(root, absolute).split(path.sep).join("/"),
  kind,
  modifiedAt: modifiedAt.toISOString(),
  ageMs,
  quarantineEligible,
});

const normalizeRelativePath = (value: string): string => {
  if (path.isAbsolute(value) || value.includes("\0")) throw new Error("Runtime relative path is invalid.");
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../"))
    throw new Error("Runtime relative path escapes project.");
  return normalized;
};

const writeJsonAtomic = async (target: string, value: unknown): Promise<void> => {
  await mkdirAsync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await openAsync(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameAsync(temporary, target);
};

const boundedInteger = (value: number, minimum: number, maximum: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Runtime ${field} is outside bounded safe limits.`);
  }
  return value;
};
