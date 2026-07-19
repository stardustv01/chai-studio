import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectMutationLock,
  initializeProjectFolder,
  readProjectMutationLock,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project mutation lock", () => {
  it("allows one writer, heartbeats durably, and releases only its own token", async () => {
    let now = new Date("2026-07-15T00:00:00Z");
    const root = await initializedProject();
    const first = await acquireProjectMutationLock(root, {
      ownerId: "actor-first",
      sessionId: "session-first",
      processId: 101,
      ttlMs: 5_000,
      now: () => now,
    });
    expect((await readProjectMutationLock(root))?.token).toBe(first.document.token);
    await expect(
      acquireProjectMutationLock(root, {
        ownerId: "actor-second",
        sessionId: "session-second",
        processId: 202,
        ttlMs: 5_000,
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: "project.lock.held" });

    now = new Date("2026-07-15T00:00:03Z");
    const heartbeat = await first.heartbeat();
    expect(heartbeat.heartbeatAt).toBe("2026-07-15T00:00:03.000Z");
    expect(heartbeat.expiresAt).toBe("2026-07-15T00:00:08.000Z");
    await first.release();
    expect(await readProjectMutationLock(root)).toBeNull();
    await first.release();
    await expect(first.heartbeat()).rejects.toMatchObject({ code: "project.lock.released" });
  });

  it("recovers an expired lock under an exclusive recovery gate", async () => {
    let now = new Date("2026-07-15T00:00:00Z");
    const root = await initializedProject();
    const stale = await acquireProjectMutationLock(root, {
      ownerId: "actor-stale",
      sessionId: "session-stale",
      ttlMs: 1_000,
      now: () => now,
    });
    now = new Date("2026-07-15T00:00:02Z");
    const recovered = await acquireProjectMutationLock(root, {
      ownerId: "actor-recovered",
      sessionId: "session-recovered",
      ttlMs: 2_000,
      now: () => now,
    });
    expect(recovered.document.token).not.toBe(stale.document.token);
    expect((await readProjectMutationLock(root))?.ownerId).toBe("actor-recovered");
    await expect(stale.release()).rejects.toMatchObject({ code: "project.lock.ownership-lost" });
    await recovered.release();
  });

  it("refuses recovery when policy requires manual intervention", async () => {
    let now = new Date("2026-07-15T00:00:00Z");
    const root = await initializedProject();
    await acquireProjectMutationLock(root, {
      ownerId: "actor-stale",
      sessionId: "session-stale",
      ttlMs: 1_000,
      now: () => now,
    });
    now = new Date("2026-07-15T00:00:02Z");
    await expect(
      acquireProjectMutationLock(root, {
        ownerId: "actor-cautious",
        sessionId: "session-cautious",
        ttlMs: 2_000,
        recoverStale: false,
        now: () => now,
      }),
    ).rejects.toMatchObject({ code: "project.lock.held" });
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-project-lock-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "lock.chai");
  await initializeProjectFolder(root, {
    title: "Locked project",
    projectId: "project-lock-0001",
    revisionId: "revision-lock-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  return root;
};
