import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoHostPaths,
  sanitizeDeployedNodeModules,
  sealReleaseBundle,
  validateReleaseBundle,
} from "../../scripts/release-bundle.mjs";

const temporaryRoots: string[] = [];

afterEach(async () =>
  Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("release bundle relocatability", () => {
  it("removes pnpm host metadata and generated shims without pruning runtime packages", async () => {
    const root = await temporaryRoot();
    const application = path.join(root, "studio-server");
    const nodeModules = path.join(application, "node_modules");
    const runtimeFile = path.join(nodeModules, ".pnpm", "runtime", "index.js");
    const buildCache = path.join(nodeModules, ".pnpm", "runtime", ".tsbuildinfo");
    await mkdir(path.join(nodeModules, ".bin"), { recursive: true });
    await mkdir(path.join(nodeModules, ".pnpm", "node_modules", ".bin"), { recursive: true });
    await mkdir(path.dirname(runtimeFile), { recursive: true });
    await writeFile(path.join(nodeModules, ".modules.yaml"), `storeDir: ${root}\n`);
    await writeFile(path.join(nodeModules, ".package-map.json"), JSON.stringify({ root }));
    await writeFile(path.join(nodeModules, ".pnpm", "lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(path.join(nodeModules, ".bin", "tool"), `#!/bin/sh\n# ${root}\n`);
    await writeFile(path.join(nodeModules, ".pnpm", "node_modules", ".bin", "tool"), root);
    await writeFile(runtimeFile, "export const runtime = true;\n");
    await writeFile(buildCache, JSON.stringify({ program: "host-specific cache" }));

    await sanitizeDeployedNodeModules(application);

    for (const removed of [
      path.join(nodeModules, ".modules.yaml"),
      path.join(nodeModules, ".package-map.json"),
      path.join(nodeModules, ".pnpm", "lock.yaml"),
      path.join(nodeModules, ".bin"),
      path.join(nodeModules, ".pnpm", "node_modules", ".bin"),
      buildCache,
    ]) {
      await expect(stat(removed)).rejects.toThrow();
    }
    await expect(readFile(runtimeFile, "utf8")).resolves.toContain("runtime = true");
  });

  it("fails closed when a bundled file contains a source, staging, or home path", async () => {
    const root = await temporaryRoot();
    const forbidden = path.join(root, "host-workspace");
    await writeFile(path.join(root, "leak.txt"), `resolved from ${forbidden}\n`);
    await expect(assertNoHostPaths(root, [forbidden])).rejects.toThrow(/host path/iu);
  });

  it("rejects an otherwise intact bundle when the embedded HyperFrames CLI is absent", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, "runtime.js"), "export const runtime = true;\n");
    await sealReleaseBundle({ root, metadata: { version: "1.0.0-rc.4" } });

    await expect(validateReleaseBundle(root)).resolves.toMatchObject({
      passed: false,
      requiredFilesPresent: false,
    });
  });
});

const temporaryRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-release-relocatable-"));
  temporaryRoots.push(root);
  return root;
};
