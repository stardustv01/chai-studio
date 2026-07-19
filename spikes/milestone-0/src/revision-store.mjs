import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const stableJson = (value) => `${JSON.stringify(canonicalize(value), null, 2)}\n`;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export class RevisionStore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  async initialize(project) {
    await mkdir(path.join(this.projectRoot, "revisions"), { recursive: true });
    return this.commit({ baseRevisionId: null, project, command: "project.initialize" });
  }

  async current() {
    const pointer = JSON.parse(await readFile(path.join(this.projectRoot, "current-revision.json"), "utf8"));
    const project = JSON.parse(await readFile(path.join(this.projectRoot, "revisions", pointer.revisionId, "project.json"), "utf8"));
    return { pointer, project };
  }

  async commit({ baseRevisionId, project, command, crashBeforePointer = false, crashAfterPointer = false }) {
    let currentRevisionId = null;
    try {
      currentRevisionId = (await this.current()).pointer.revisionId;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (currentRevisionId !== baseRevisionId) {
      const conflict = new Error(`stale base revision: expected ${currentRevisionId}, received ${baseRevisionId}`);
      conflict.code = "STALE_REVISION";
      throw conflict;
    }

    const revisionId = `revision-${randomUUID()}`;
    const revisionDirectory = path.join(this.projectRoot, "revisions", revisionId);
    await mkdir(revisionDirectory, { recursive: false });
    const projectJson = stableJson(project);
    const transaction = {
      revisionId,
      parentRevisionId: baseRevisionId,
      command,
      projectHash: hash(projectJson),
    };
    await writeFile(path.join(revisionDirectory, "project.json"), projectJson, { flag: "wx" });
    await writeFile(path.join(revisionDirectory, "transaction.json"), stableJson(transaction), { flag: "wx" });

    if (crashBeforePointer) {
      const error = new Error("simulated crash before pointer replacement");
      error.code = "SIMULATED_CRASH";
      throw error;
    }

    const pointer = stableJson({ revisionId, projectHash: transaction.projectHash });
    const temporaryPointer = path.join(this.projectRoot, `.current-revision.${randomUUID()}.tmp`);
    await writeFile(temporaryPointer, pointer, { flag: "wx" });
    await rename(temporaryPointer, path.join(this.projectRoot, "current-revision.json"));
    if (crashAfterPointer) {
      const error = new Error("simulated crash after pointer replacement");
      error.code = "SIMULATED_POST_POINTER_CRASH";
      throw error;
    }
    return { revisionId, projectHash: transaction.projectHash };
  }

  async findOrphans() {
    const revisionsRoot = path.join(this.projectRoot, "revisions");
    const revisionIds = await readdir(revisionsRoot);
    const { pointer } = await this.current();
    const reachable = new Set();
    let cursor = pointer.revisionId;
    while (cursor) {
      if (reachable.has(cursor)) throw new Error("revision ancestry cycle detected");
      reachable.add(cursor);
      const transaction = JSON.parse(await readFile(path.join(revisionsRoot, cursor, "transaction.json"), "utf8"));
      cursor = transaction.parentRevisionId;
    }
    return revisionIds.filter((revisionId) => !reachable.has(revisionId)).sort();
  }

  async acquireLock({ actorId, ttlMs, now = Date.now() }) {
    const lockPath = path.join(this.projectRoot, "revision.lock.json");
    let existing = null;
    try {
      existing = JSON.parse(await readFile(lockPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (existing && existing.expiresAt > now) {
      const error = new Error(`revision lock held by ${existing.actorId}`);
      error.code = "LOCK_HELD";
      throw error;
    }
    const lock = { actorId, acquiredAt: now, expiresAt: now + ttlMs };
    const temporary = `${lockPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, stableJson(lock), { flag: "wx" });
    await rename(temporary, lockPath);
    return lock;
  }

  async releaseLock(actorId) {
    const lockPath = path.join(this.projectRoot, "revision.lock.json");
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (existing.actorId !== actorId) {
      const error = new Error("lock actor mismatch");
      error.code = "LOCK_OWNER_MISMATCH";
      throw error;
    }
    await unlink(lockPath);
  }
}

export { stableJson };
