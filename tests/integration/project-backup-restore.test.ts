import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProjectFolder, loadCurrentProjectRevision } from "../../packages/schema/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("P24 documented project recovery procedures", () => {
  it("backs up, restores, moves, and rebuilds caches without changing creative authority", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-backup-restore-"));
    roots.push(parent);
    const original = path.join(parent, "Original.chai");
    await initializeProjectFolder(original, {
      title: "Backup restore fixture",
      projectId: "project-backup-restore",
      revisionId: "revision-backup-restore",
      actorId: "actor-backup-restore",
      sessionId: "session-backup-restore",
      now: new Date("2026-07-16T23:30:00.000Z"),
    });
    const authoritative = await loadCurrentProjectRevision(original);
    await mkdir(path.join(original, ".chai-cache", "render"), { recursive: true });
    await writeFile(path.join(original, ".chai-cache", "render", "regenerable.bin"), "cache-only");

    const backup = path.join(parent, "Backups", "Original.chai");
    await cp(original, backup, { recursive: true, force: false, errorOnExist: true });
    const restored = path.join(parent, "Restored.chai");
    await cp(backup, restored, { recursive: true, force: false, errorOnExist: true });
    expect((await loadCurrentProjectRevision(restored)).revisionHash).toBe(authoritative.revisionHash);

    const moved = path.join(parent, "Moved Project.chai");
    await rename(restored, moved);
    expect((await loadCurrentProjectRevision(moved)).pointer).toEqual(authoritative.pointer);

    await rm(path.join(moved, ".chai-cache"), { recursive: true, force: true });
    expect((await loadCurrentProjectRevision(moved)).revisionHash).toBe(authoritative.revisionHash);
    await mkdir(path.join(moved, ".chai-cache", "render"), { recursive: true });
    await writeFile(path.join(moved, ".chai-cache", "render", "rebuilt.bin"), "rebuilt-cache");
    await expect(stat(path.join(moved, ".chai-cache", "render", "rebuilt.bin"))).resolves.toBeDefined();
    expect((await loadCurrentProjectRevision(moved)).revisionHash).toBe(authoritative.revisionHash);
  });
});
