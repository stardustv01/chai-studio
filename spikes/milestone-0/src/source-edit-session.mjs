import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export class SourceEditSessionManager {
  constructor({ revisionStore, quarantineRoot }) {
    this.revisionStore = revisionStore;
    this.quarantineRoot = quarantineRoot;
    this.sessions = new Map();
  }

  async begin({ sourcePath, baseRevisionId }) {
    const content = await readFile(sourcePath, "utf8");
    const session = Object.freeze({ id: randomUUID(), sourcePath, baseRevisionId, sourceHash: hash(content) });
    this.sessions.set(session.id, session);
    return session;
  }

  async commit({ sessionId, candidateContent, validate }) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("source edit session is not active");
    const validation = await validate(candidateContent);
    if (validation?.valid !== true) {
      const error = new Error("source validation failed");
      error.code = "SOURCE_VALIDATION_FAILED";
      throw error;
    }
    const currentSource = await readFile(session.sourcePath, "utf8");
    if (hash(currentSource) !== session.sourceHash) {
      await mkdir(this.quarantineRoot, { recursive: true });
      const quarantinePath = path.join(this.quarantineRoot, `${session.id}.candidate.txt`);
      await writeFile(quarantinePath, candidateContent, { flag: "wx" });
      this.sessions.delete(sessionId);
      const error = new Error("external source change quarantined the candidate edit");
      error.code = "EXTERNAL_SOURCE_CHANGE";
      error.quarantinePath = quarantinePath;
      throw error;
    }

    const current = await this.revisionStore.current();
    if (current.pointer.revisionId !== session.baseRevisionId) {
      const error = new Error("project revision changed during source edit");
      error.code = "STALE_REVISION";
      throw error;
    }
    const relativeSource = path.basename(session.sourcePath);
    const project = {
      ...current.project,
      sources: {
        ...(current.project.sources ?? {}),
        [relativeSource]: { content: candidateContent, hash: hash(candidateContent) },
      },
    };
    const revision = await this.revisionStore.commit({
      baseRevisionId: session.baseRevisionId,
      project,
      command: "source.edit.commit",
    });
    const temporary = `${session.sourcePath}.${session.id}.tmp`;
    await writeFile(temporary, candidateContent, { flag: "wx" });
    await rename(temporary, session.sourcePath);
    this.sessions.delete(sessionId);
    return revision;
  }

  abort(sessionId) {
    return this.sessions.delete(sessionId);
  }
}
