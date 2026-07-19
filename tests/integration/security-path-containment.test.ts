import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeSecurityPath, createExecutableSecurityPolicy } from "../../packages/security/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("canonical worker path containment", () => {
  it("separates read-only sources, output/temp writes, traversal, and symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chai-security-path-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const output = path.join(root, "output");
    const temp = path.join(root, "temp");
    const outside = path.join(root, "outside");
    await Promise.all([mkdir(source), mkdir(output), mkdir(temp), mkdir(outside)]);
    const sourceFile = path.join(source, "clip.mov");
    const outsideFile = path.join(outside, "secret.txt");
    await Promise.all([writeFile(sourceFile, "clip"), writeFile(outsideFile, "secret")]);
    await symlink(outside, path.join(output, "escape"));
    const policy = createExecutableSecurityPolicy({
      projectId: "project-security-path-0001",
      trustClass: "imported_untrusted",
      importedExecutionEnabled: true,
      rootPolicies: [
        { id: "source-root", path: source, mode: "read-only" },
        { id: "output-root", path: output, mode: "output-only" },
        { id: "temp-root", path: temp, mode: "temporary" },
      ],
    });
    await expect(
      authorizeSecurityPath({ candidatePath: sourceFile, access: "read", policy }),
    ).resolves.toMatchObject({ rootId: "source-root", projectRelativePath: "clip.mov" });
    await expect(
      authorizeSecurityPath({
        candidatePath: path.join(output, "nested", "master.mov"),
        access: "output",
        mustExist: false,
        policy,
      }),
    ).resolves.toMatchObject({ rootId: "output-root", projectRelativePath: "nested/master.mov" });
    await expect(
      authorizeSecurityPath({ candidatePath: sourceFile, access: "write", policy, mustExist: false }),
    ).rejects.toThrow(/access mode is forbidden/);
    await expect(
      authorizeSecurityPath({
        candidatePath: `${output}/../outside/secret.txt`,
        access: "output",
        policy,
      }),
    ).rejects.toThrow(/traversal syntax/);
    await expect(
      authorizeSecurityPath({
        candidatePath: path.join(output, "escape", "new.txt"),
        access: "output",
        mustExist: false,
        policy,
      }),
    ).rejects.toThrow(/outside an approved root/);
  });
});
