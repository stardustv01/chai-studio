import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireStudioInstance } from "../../apps/studio-server/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Studio instance policy", () => {
  it("prevents duplicate application ownership and releases only its own lease", async () => {
    const runtimeDirectory = await temporaryDirectory();
    const first = await acquireStudioInstance({ runtimeDirectory, policy: "single-app" });
    await expect(acquireStudioInstance({ runtimeDirectory, policy: "single-app" })).rejects.toThrow(
      /already owns/,
    );
    await first.release();
    const second = await acquireStudioInstance({ runtimeDirectory, policy: "single-app" });
    expect(second.instanceId).not.toBe(first.instanceId);
    await second.release();
  });

  it("allows separate project scopes and recovers an explicitly stale lease", async () => {
    const runtimeDirectory = await temporaryDirectory();
    const first = await acquireStudioInstance({
      runtimeDirectory,
      policy: "per-project",
      projectRoot: "/projects/alpha",
    });
    const second = await acquireStudioInstance({
      runtimeDirectory,
      policy: "per-project",
      projectRoot: "/projects/beta",
    });
    expect(second.scopeKey).not.toBe(first.scopeKey);
    await first.release();
    await second.release();

    const stale = await acquireStudioInstance({ runtimeDirectory, policy: "single-app" });
    await expect(
      acquireStudioInstance({
        runtimeDirectory,
        policy: "single-app",
        processIsAlive: () => false,
      }),
    ).resolves.toMatchObject({ policy: "single-app" });
    await stale.release();
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-server-instance-"));
  temporaryDirectories.push(directory);
  return directory;
};
