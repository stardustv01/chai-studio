import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ProgramFrameService, ProjectSessionService } from "../../apps/studio-server/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("authoritative program frames", () => {
  test("binds compositor pixels to the current revision and master frame", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-program-frame-test-"));
    temporaryDirectories.push(parent);
    const projects = new ProjectSessionService();
    await projects.create({
      targetPath: path.join(parent, "Program Frame.chai"),
      title: "Program Frame",
      starter: "showcase",
    });
    const snapshot = await projects.snapshot();
    const service = new ProgramFrameService(projects);
    const first = await service.frame("0");
    const cached = await service.frame("0");
    const secondScene = await service.frame("150");

    expect(first.bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(first).toMatchObject({ frame: "0", revisionId: snapshot.pointer.revisionId });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(cached.contentHash).toBe(first.contentHash);
    expect(secondScene.contentHash).not.toBe(first.contentHash);
    for (const frame of ["1", "2", "3", "4", "5", "6", "7"]) {
      await service.frame(frame);
    }
    await expect(service.frame("0")).resolves.toMatchObject({ contentHash: first.contentHash });
    await expect(service.frame("450")).rejects.toThrow("outside the current timeline");
  });
});
