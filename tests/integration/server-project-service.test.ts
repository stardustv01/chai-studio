import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectSessionService } from "../../apps/studio-server/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("project session service", () => {
  it("creates, opens, inspects, reports, closes, and reopens only through project-core authority", async () => {
    const parent = await temporaryDirectory();
    const rootPath = path.join(parent, "Personal Film.chai");
    const service = new ProjectSessionService({
      now: () => new Date("2026-07-15T13:00:00.000Z"),
    });
    const created = await service.create({ targetPath: rootPath, title: "Personal Film" });
    const snapshot = await service.snapshot();
    expect(snapshot).toMatchObject({
      revisionHash: created.revisionHash,
      project: { title: "Personal Film" },
    });
    expect(service.listRecent()).toEqual([
      {
        projectId: created.projectId,
        title: "Personal Film",
        rootPath,
        revisionId: created.revisionId,
        lastOpenedAt: "2026-07-15T13:00:00.000Z",
      },
    ]);
    expect(await service.revisionHistory()).toMatchObject([
      {
        revisionId: created.revisionId,
        commandSummary: "Create project",
        parentRevisionId: null,
      },
    ]);
    expect((await service.namedVersions()).versions[0]).toMatchObject({
      name: "Draft",
      revisionId: created.revisionId,
    });
    expect(await service.migrationReport()).toMatchObject({
      currentVersion: "1.0.0",
      projectVersion: "1.0.0",
      migrationRequired: false,
      dryRunReport: { dryRun: true, migrated: false },
    });
    expect(await service.repairReport()).toMatchObject({ passed: true, recommendedActions: [] });
    expect(await service.close()).toEqual({ closed: true, rootPath });
    await expect(service.snapshot()).rejects.toThrow(/No project is open/);
    expect(await service.open(rootPath)).toMatchObject({ projectId: created.projectId });
  });

  it("rejects project reads while a session transition is in progress", async () => {
    const parent = await temporaryDirectory();
    const service = new ProjectSessionService();
    const creating = service.create({
      targetPath: path.join(parent, "Transition Film.chai"),
      title: "Transition Film",
    });
    await expect(service.snapshot()).rejects.toThrow(/transition is in progress/);
    await creating;
    await expect(service.snapshot()).resolves.toMatchObject({ project: { title: "Transition Film" } });
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-project-service-"));
  temporaryDirectories.push(directory);
  return directory;
};
