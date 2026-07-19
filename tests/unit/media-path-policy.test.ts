import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeAssetPath, isContainedPath } from "../../packages/media/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("secure asset path policy", () => {
  it("authorizes canonical project files and approved external aliases", async () => {
    const fixture = await pathFixture();
    const internal = await authorizeAssetPath({
      projectRoot: fixture.project,
      candidatePath: "assets/internal.mov",
    });
    expect(internal).toEqual({
      canonicalPath: await realpath(fixture.internalFile),
      registryPath: "assets/internal.mov",
      scope: "project",
      externalRootId: null,
    });

    const external = await authorizeAssetPath({
      projectRoot: fixture.project,
      candidatePath: fixture.externalFile,
      approvedExternalRoots: [{ id: "stock-library", path: fixture.external }],
    });
    expect(external).toEqual({
      canonicalPath: await realpath(fixture.externalFile),
      registryPath: "external/stock-library/stock.mov",
      scope: "approved-external",
      externalRootId: "stock-library",
    });
  });

  it("rejects traversal, unapproved roots, missing files, and path-prefix tricks", async () => {
    const fixture = await pathFixture();
    await expect(
      authorizeAssetPath({ projectRoot: fixture.project, candidatePath: "assets/../outside.mov" }),
    ).rejects.toThrow(/traversal syntax/);
    await expect(
      authorizeAssetPath({ projectRoot: fixture.project, candidatePath: fixture.externalFile }),
    ).rejects.toThrow(/outside the project/);
    await expect(
      authorizeAssetPath({ projectRoot: fixture.project, candidatePath: "assets/missing.mov" }),
    ).rejects.toThrow(/does not exist/);
    expect(isContainedPath(fixture.project, `${fixture.project}-sibling/file.mov`)).toBe(false);
  });

  it("rejects a project-local symlink that canonically escapes all approved roots", async () => {
    const fixture = await pathFixture();
    const link = path.join(fixture.project, "assets", "escape.mov");
    await symlink(fixture.externalFile, link);
    await expect(
      authorizeAssetPath({ projectRoot: fixture.project, candidatePath: "assets/escape.mov" }),
    ).rejects.toThrow(/resolves outside approved roots/);
  });
});

const pathFixture = async (): Promise<{
  readonly project: string;
  readonly external: string;
  readonly internalFile: string;
  readonly externalFile: string;
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-media-path-"));
  temporaryDirectories.push(root);
  const project = path.join(root, "project");
  const external = path.join(root, "external");
  await mkdir(path.join(project, "assets"), { recursive: true });
  await mkdir(external, { recursive: true });
  const internalFile = path.join(project, "assets", "internal.mov");
  const externalFile = path.join(external, "stock.mov");
  await writeFile(internalFile, "internal");
  await writeFile(externalFile, "external");
  return { project, external, internalFile, externalFile };
};
