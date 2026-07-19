import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  archiveProject,
  backupProject,
  cloneProjectBackup,
  installLocalRelease,
  restoreProjectBackup,
  uninstallLocalRelease,
  validateBackupEnvironment,
  validateProjectBackup,
} from "../../scripts/release-operations.mjs";
import { sealReleaseBundle } from "../../scripts/release-bundle.mjs";

const temporaryRoots: string[] = [];
afterEach(async () =>
  Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("P27 local release operations", () => {
  it("installs an exact marked launcher and uninstalls without touching external projects", async () => {
    const root = await temporaryRoot();
    const source = await releaseFixture(path.join(root, "Extracted release"));
    const prefix = path.join(root, "Application");
    const externalProject = await projectFixture(path.join(root, "Projects", "Preserved.chai"));
    const installed = await installLocalRelease({ sourceRoot: source, prefix });
    expect((await stat(installed.launcher)).mode & 0o111).not.toBe(0);
    expect(await readFile(installed.launcher, "utf8")).toContain(
      path.join(prefix, "lib", "chai-studio", "scripts", "chai-studio.mjs"),
    );
    expect(installed.bundleIdentity).toMatch(/^[a-f0-9]{64}$/u);
    await rm(source, { recursive: true, force: true });
    await expect(
      readFile(path.join(installed.runtime, "scripts", "chai-studio.mjs"), "utf8"),
    ).resolves.toContain("standalone release fixture");
    expect(await uninstallLocalRelease(prefix)).toMatchObject({ projectsDeleted: false });
    await expect(readFile(path.join(externalProject, "project.json"), "utf8")).resolves.toContain(
      "release-test",
    );
  });

  it("refuses uninstall when project data is placed inside the application prefix", async () => {
    const root = await temporaryRoot();
    const prefix = path.join(root, "Application");
    await installLocalRelease({
      sourceRoot: await releaseFixture(path.join(root, "Extracted release")),
      prefix,
    });
    await projectFixture(path.join(prefix, "Unsafe.chai"));
    await expect(uninstallLocalRelease(prefix)).rejects.toThrow(/project is inside/u);
  });

  it("backs up, validates, restores, clones, archives, excludes cache, and detects tampering", async () => {
    const root = await temporaryRoot();
    const source = await projectFixture(path.join(root, "Original.chai"));
    const backup = path.join(root, "Original.backup");
    const restored = path.join(root, "Restored.chai");
    const cloned = path.join(root, "Cloned.chai");
    const archived = path.join(root, "Archived.chaiarchive");
    const manifest = await backupProject({
      source,
      destination: backup,
      environmentFingerprint: "environment-a",
    });
    expect(manifest).toMatchObject({ cacheExcluded: true, deliveredArtifactsPreserved: true });
    await expect(stat(path.join(backup, ".chai-cache"))).rejects.toThrow();
    expect((await validateProjectBackup(backup)).passed).toBe(true);
    expect(
      await validateBackupEnvironment({ backup, currentEnvironmentFingerprint: "environment-b" }),
    ).toMatchObject({
      passed: true,
      compatible: false,
      status: "explicit-environment-incompatibility",
      projectRestoreAllowed: true,
      outputReproductionAllowed: false,
    });
    expect(await restoreProjectBackup({ backup, destination: restored })).toMatchObject({ validated: true });
    expect(await cloneProjectBackup({ source, destination: cloned })).toMatchObject({ validated: true });
    expect(await archiveProject({ source, destination: archived })).toMatchObject({ kind: "archive" });
    await expect(readFile(path.join(restored, "deliveries", "approved.mov"), "utf8")).resolves.toBe(
      "delivery",
    );
    await writeFile(path.join(backup, "project.json"), "tampered");
    expect((await validateProjectBackup(backup)).passed).toBe(false);
  });
});

const temporaryRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-release-operations-"));
  temporaryRoots.push(root);
  return root;
};

const projectFixture = async (root: string) => {
  await mkdir(path.join(root, "revisions"), { recursive: true });
  await mkdir(path.join(root, "deliveries"), { recursive: true });
  await mkdir(path.join(root, ".chai-cache"), { recursive: true });
  await writeFile(path.join(root, "project.json"), '{"id":"release-test"}');
  await writeFile(path.join(root, "revisions", "current.json"), '{"id":"r1"}');
  await writeFile(path.join(root, "deliveries", "approved.mov"), "delivery");
  await writeFile(path.join(root, ".chai-cache", "regenerable.bin"), "cache");
  return root;
};

const releaseFixture = async (root: string) => {
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await writeFile(
    path.join(root, "scripts", "chai-studio.mjs"),
    '#!/usr/bin/env node\nprocess.stdout.write("standalone release fixture\\n");\n',
  );
  await sealReleaseBundle({
    root,
    metadata: {
      version: "1.0.0-rc.2",
      sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      dependencyLockSha256: "a".repeat(64),
      licenseInventorySha256: "b".repeat(64),
      platform: "darwin",
      architecture: "arm64",
      distributionScope: "personal-local-only",
    },
  });
  return root;
};
