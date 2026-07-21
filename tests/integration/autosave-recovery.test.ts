import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProjectMutationLock,
  createProjectAutosave,
  createDebouncedAutosaveController,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  markProjectCleanShutdown,
  markProjectOpened,
  restoreProjectAutosave,
  scanAutosaveRecovery,
  stringifyCanonicalJson,
  type RevisionContentDocuments,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("autosave and crash recovery", () => {
  it("coalesces debounced edits and supports an immediate pre-risk flush", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    let id = 0;
    const controller = createDebouncedAutosaveController(root, {
      delayMs: 50,
      now: () => new Date("2026-07-15T00:01:00Z"),
      idFactory: () => `autosave-debounce-${String(++id).padStart(4, "0")}`,
    });
    controller.schedule(content(current, "Intermediate title"));
    controller.schedule(content(current, "Latest title"));
    const saved = await controller.flush("pre-risk");
    expect(saved).toMatchObject({ id: "autosave-debounce-0001", reason: "pre-risk" });
    expect(saved?.documents?.project.title).toBe("Latest title");
    await controller.waitForIdle();
    const scan = await scanAutosaveRecovery(root);
    expect(scan.candidates).toHaveLength(1);
    controller.cancel();
  });

  it("offers only hash-verified candidates after an unclean shutdown", async () => {
    const root = await initializedProject();
    await markProjectOpened(root);
    const current = await loadCurrentProjectRevision(root);
    const saved = await createProjectAutosave(root, {
      autosaveId: "autosave-recovery-0001",
      reason: "debounced",
      documents: content(current, "Unsaved title"),
      now: new Date("2026-07-15T00:01:00Z"),
    });
    expect(saved.valid).toBe(true);
    let scan = await scanAutosaveRecovery(root);
    expect(scan).toMatchObject({ cleanShutdown: false, recoveryRequired: true });
    expect(scan.candidates[0]).toMatchObject({
      id: "autosave-recovery-0001",
      valid: true,
      baseRevisionId: "revision-autosave-0001",
      issue: null,
    });

    const snapshotPath = path.join(root, "autosaves", saved.id, "snapshot.json");
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Record<string, unknown>;
    await writeFile(snapshotPath, stringifyCanonicalJson({ ...snapshot, reason: "pre-risk" }), "utf8");
    scan = await scanAutosaveRecovery(root);
    expect(scan.recoveryRequired).toBe(false);
    expect(scan.candidates[0]).toMatchObject({ valid: false, issue: "hash-mismatch" });
  });

  it("restores a valid candidate through immutable revision authority", async () => {
    const root = await initializedProject();
    await markProjectOpened(root);
    const current = await loadCurrentProjectRevision(root);
    const saved = await createProjectAutosave(root, {
      autosaveId: "autosave-restore-0001",
      reason: "crash-recovery",
      documents: content(current, "Recovered title"),
      now: new Date("2026-07-15T00:01:00Z"),
    });
    const restored = await restoreProjectAutosave(root, saved.id, {
      actor: { id: "actor-autosave-0001", kind: "user", sessionId: "session-autosave-0001" },
      revisionId: "revision-autosave-0002",
      now: new Date("2026-07-15T00:02:00Z"),
    });
    expect(restored.project.title).toBe("Recovered title");
    expect(restored.transaction.commandSummary).toBe("Restore autosave");
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-autosave-0002");
  });

  it("uses the project mutation lock for the complete restore transaction", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    const saved = await createProjectAutosave(root, {
      autosaveId: "autosave-locked-0001",
      reason: "crash-recovery",
      documents: content(current, "Locked recovery title"),
      now: new Date("2026-07-15T00:01:00Z"),
    });
    const competing = await acquireProjectMutationLock(root, {
      ownerId: "actor-competing-0001",
      sessionId: "session-competing-0001",
      ttlMs: 15_000,
    });
    await expect(
      restoreProjectAutosave(root, saved.id, {
        actor: { id: "actor-autosave-0001", kind: "user", sessionId: "session-autosave-0001" },
        revisionId: "revision-autosave-0002",
        now: new Date("2026-07-15T00:01:31Z"),
      }),
    ).rejects.toMatchObject({ code: "project.lock.held" });
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-autosave-0001");
    await competing.release();
  });

  it("suppresses the recovery prompt after a verified clean shutdown", async () => {
    const root = await initializedProject();
    await markProjectOpened(root);
    await createProjectAutosave(root, {
      autosaveId: "autosave-clean-0001",
      reason: "pre-risk",
      now: new Date("2026-07-15T00:01:00Z"),
    });
    expect((await scanAutosaveRecovery(root)).recoveryRequired).toBe(true);
    await markProjectCleanShutdown(root);
    const scan = await scanAutosaveRecovery(root);
    expect(scan.cleanShutdown).toBe(true);
    expect(scan.recoveryRequired).toBe(false);
    expect(scan.candidates[0]?.valid).toBe(true);
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-autosave-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "autosave.chai");
  await initializeProjectFolder(root, {
    title: "Autosave project",
    projectId: "project-autosave-0001",
    revisionId: "revision-autosave-0001",
    actorId: "actor-autosave-0001",
    sessionId: "session-autosave-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  return root;
};

const content = (
  current: Awaited<ReturnType<typeof loadCurrentProjectRevision>>,
  title: string,
): RevisionContentDocuments => ({
  project: { ...current.project, title },
  timeline: current.timeline,
  assets: current.assets,
  settings: current.settings,
  approvalState: current.approvalState,
});
