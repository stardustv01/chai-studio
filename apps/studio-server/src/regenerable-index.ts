import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StudioJobRegistry, StudioJobSnapshot } from "./job-registry.js";
import type { ProjectSessionService } from "./project-service.js";

export interface StudioIndexStatus {
  readonly schemaVersion: "1.0.0";
  readonly authority: false;
  readonly open: boolean;
  readonly databaseRelativePath: ".chai-cache/indexes/studio.sqlite";
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly jobCount: number;
  readonly assetCount: number;
  readonly cacheEntryCount: number;
  readonly lastRebuiltAt: string | null;
  readonly lastError: string | null;
}

export interface IndexedAssetRow {
  readonly id: string;
  readonly path: string;
  readonly kind: string;
  readonly rights: string;
  readonly validationState: string;
  readonly contentHash: string;
  readonly revisionId: string;
}

export class RegenerableStudioIndex {
  readonly #projects: ProjectSessionService;
  readonly #jobs: StudioJobRegistry;
  readonly #now: () => Date;
  readonly #unsubscribe: readonly (() => void)[];
  #database: DatabaseSync | null = null;
  #rootPath: string | null = null;
  #projectId: string | null = null;
  #revisionId: string | null = null;
  #lastRebuiltAt: string | null = null;
  #lastError: string | null = null;
  #scheduled: Promise<void> = Promise.resolve();

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly jobs: StudioJobRegistry;
    readonly now?: () => Date;
  }) {
    this.#projects = input.projects;
    this.#jobs = input.jobs;
    this.#now = input.now ?? (() => new Date());
    this.#unsubscribe = [
      this.#projects.subscribe((event) => {
        if (event.type === "project.closed") this.#closeDatabase();
        else this.#scheduleRebuild();
      }),
      this.#jobs.subscribe((job) => {
        this.#upsertJobIfOpen(job);
      }),
    ];
  }

  rebuild(): Promise<StudioIndexStatus> {
    return this.#enqueueIndexTask(() => this.#performRebuild());
  }

  deleteAndRebuild(): Promise<StudioIndexStatus> {
    return this.#enqueueIndexTask(async () => {
      const root = this.#projects.openRootPath();
      this.#closeDatabase();
      await Promise.all([
        rm(databasePath(root), { force: true }),
        rm(`${databasePath(root)}-wal`, { force: true }),
        rm(`${databasePath(root)}-shm`, { force: true }),
      ]);
      return this.#performRebuild();
    });
  }

  async #performRebuild(): Promise<StudioIndexStatus> {
    const root = this.#projects.openRootPath();
    const snapshot = await this.#projects.snapshot();
    const cacheEntries = await scanCacheEntries(root);
    const database = await this.#open(root);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("DELETE FROM jobs; DELETE FROM assets; DELETE FROM cache_entries;");
      for (const job of this.#jobs.list()) upsertJob(database, job);
      const assetStatement = database.prepare(`
        INSERT INTO assets (
          id, path, kind, rights, validation_state, content_hash, search_text, revision_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const asset of snapshot.assets.assets) {
        assetStatement.run(
          asset.id,
          asset.path,
          asset.kind,
          asset.rights,
          asset.validationState,
          asset.contentHash,
          `${asset.id} ${asset.path} ${asset.kind} ${asset.rights} ${asset.validationState}`.toLocaleLowerCase(
            "en",
          ),
          snapshot.pointer.revisionId,
        );
      }
      const cacheStatement = database.prepare(`
        INSERT INTO cache_entries (
          cache_key, kind, relative_path, content_hash, byte_length, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const entry of cacheEntries) {
        cacheStatement.run(
          entry.cacheKey,
          entry.kind,
          entry.relativePath,
          entry.contentHash,
          entry.byteLength,
          entry.updatedAt,
        );
      }
      const rebuiltAt = this.#now().toISOString();
      database
        .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_rebuilt_at', ?)")
        .run(rebuiltAt);
      database.exec("COMMIT");
      this.#projectId = snapshot.project.projectId;
      this.#revisionId = snapshot.pointer.revisionId;
      this.#lastRebuiltAt = rebuiltAt;
      this.#lastError = null;
    } catch (cause) {
      database.exec("ROLLBACK");
      this.#lastError = cause instanceof Error ? cause.message : "Unknown index rebuild failure.";
      throw cause;
    }
    return this.status();
  }

  status(): StudioIndexStatus {
    const database = this.#database;
    return {
      schemaVersion: "1.0.0",
      authority: false,
      open: database !== null,
      databaseRelativePath: ".chai-cache/indexes/studio.sqlite",
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      jobCount: database === null ? 0 : countRows(database, "jobs"),
      assetCount: database === null ? 0 : countRows(database, "assets"),
      cacheEntryCount: database === null ? 0 : countRows(database, "cache_entries"),
      lastRebuiltAt: this.#lastRebuiltAt,
      lastError: this.#lastError,
    };
  }

  searchAssets(text: string, limit = 100): readonly IndexedAssetRow[] {
    if (text.length > 4_096 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error("Studio index asset search is outside bounded limits.");
    }
    const database = this.#requireDatabase();
    const normalized = `%${escapeLike(text.normalize("NFKC").toLocaleLowerCase("en").trim())}%`;
    return database
      .prepare(
        `SELECT id, path, kind, rights, validation_state, content_hash, revision_id
         FROM assets
         WHERE search_text LIKE ? ESCAPE '\\'
         ORDER BY path COLLATE NOCASE, id
         LIMIT ?`,
      )
      .all(normalized, limit)
      .map((row) => {
        const value = row as Record<string, unknown>;
        return {
          id: String(value.id),
          path: String(value.path),
          kind: String(value.kind),
          rights: String(value.rights),
          validationState: String(value.validation_state),
          contentHash: String(value.content_hash),
          revisionId: String(value.revision_id),
        };
      });
  }

  close(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#closeDatabase();
  }

  async #open(root: string): Promise<DatabaseSync> {
    if (this.#database !== null && this.#rootPath === root) return this.#database;
    this.#closeDatabase();
    await mkdir(path.dirname(databasePath(root)), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(databasePath(root));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL,
        project_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        rights TEXT NOT NULL,
        validation_state TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        search_text TEXT NOT NULL,
        revision_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_search_text ON assets(search_text);
      CREATE TABLE IF NOT EXISTS cache_entries (
        cache_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '1.0.0');
    `);
    this.#database = database;
    this.#rootPath = root;
    return database;
  }

  #scheduleRebuild(): void {
    void this.rebuild().catch((cause: unknown) => {
      this.#lastError = cause instanceof Error ? cause.message : "Scheduled index rebuild failed.";
    });
  }

  async #enqueueIndexTask<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#scheduled.then(task);
    this.#scheduled = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #upsertJobIfOpen(job: StudioJobSnapshot): void {
    if (this.#database === null || this.#projectId !== job.projectId) return;
    upsertJob(this.#database, job);
  }

  #requireDatabase(): DatabaseSync {
    if (this.#database === null) throw new Error("Studio index is not open; rebuild it first.");
    return this.#database;
  }

  #closeDatabase(): void {
    this.#database?.close();
    this.#database = null;
    this.#rootPath = null;
    this.#projectId = null;
    this.#revisionId = null;
  }
}

const databasePath = (root: string): string => path.join(root, ".chai-cache", "indexes", "studio.sqlite");

const upsertJob = (database: DatabaseSync, job: StudioJobSnapshot): void => {
  database
    .prepare(
      `INSERT INTO jobs (id, kind, status, progress, project_id, revision_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         status = excluded.status,
         progress = excluded.progress,
         project_id = excluded.project_id,
         revision_id = excluded.revision_id,
         updated_at = excluded.updated_at`,
    )
    .run(job.id, job.kind, job.status, job.progress, job.projectId, job.revisionId, job.updatedAt);
};

const countRows = (database: DatabaseSync, table: "jobs" | "assets" | "cache_entries"): number => {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    Readonly<Record<string, unknown>> | undefined;
  return Number(row?.count ?? 0);
};

const scanCacheEntries = async (
  root: string,
): Promise<
  readonly {
    cacheKey: string;
    kind: string;
    relativePath: string;
    contentHash: string;
    byteLength: number;
    updatedAt: string;
  }[]
> => {
  const cacheRoot = path.join(root, ".chai-cache");
  const files: string[] = [];
  await walk(cacheRoot, files, new Set([path.join(cacheRoot, "indexes")]));
  return Promise.all(
    files.map(async (absolute) => {
      const metadata = await stat(absolute);
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      return {
        cacheKey: createHash("sha256").update(relativePath, "utf8").digest("hex"),
        kind: relativePath.split("/")[2] ?? "cache",
        relativePath,
        contentHash: createHash("sha256")
          .update(await readFile(absolute))
          .digest("hex"),
        byteLength: metadata.size,
        updatedAt: metadata.mtime.toISOString(),
      };
    }),
  );
};

const walk = async (directory: string, files: string[], excluded: ReadonlySet<string>): Promise<void> => {
  if (excluded.has(directory)) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, files, excluded);
    else if (entry.isFile()) files.push(absolute);
  }
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");
