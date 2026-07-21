import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  doctorInstaller,
  installFromRelease,
  signedReleaseBytes,
  uninstallInstalledRelease,
  type ReleaseIndex,
  type ReleaseRecord,
} from "../../packages/cli/lib/installer.mjs";
import { sealReleaseBundle } from "../../scripts/release-bundle.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(async () =>
  Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("Chai Studio installer CLI flow", () => {
  it("installs and atomically updates a signed archive without touching projects", async () => {
    const root = await temporaryRoot();
    const prefix = path.join(root, "Applications", "Chai Studio");
    const project = path.join(root, "Projects", "Preserved.chai", "project.json");
    await mkdir(path.dirname(project), { recursive: true });
    await writeFile(project, '{"id":"preserved"}\n');

    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const publicKeyPath = path.join(root, "release-key.pem");
    await writeFile(publicKeyPath, publicKey);
    const rc4 = await releaseFixture(root, "1.0.0-rc.4", "4".repeat(40), privateKey, publicKey);
    const rc5 = await releaseFixture(root, "1.0.0-rc.5", "5".repeat(40), privateKey, publicKey);

    const installed = await installFromRelease({
      prefix,
      releaseIndexUrl: rc4.indexUrl,
      publicKeyPath,
      platform: "darwin",
      architecture: "arm64",
      fetchImplementation: rc4.fetchImplementation,
    });
    expect(installed).toMatchObject({ status: "installed", version: "1.0.0-rc.4" });
    expect(
      JSON.parse(await readFile(path.join(prefix, ".chai-studio-installation.json"), "utf8")),
    ).toMatchObject({
      version: "1.0.0-rc.4",
      installedRuntime: path.join(prefix, "lib", "chai-studio"),
      projectsInsideInstall: false,
    });
    await expect(
      doctorInstaller({ prefix, platform: "darwin", architecture: "arm64" }),
    ).resolves.toMatchObject({ passed: true });

    await writeFile(
      path.join(prefix, "lib", "chai-studio", "scripts", "runtime-web-server.mjs"),
      "damaged\n",
    );
    const repaired = await installFromRelease({
      prefix,
      releaseIndexUrl: rc4.indexUrl,
      publicKeyPath,
      update: true,
      platform: "darwin",
      architecture: "arm64",
      fetchImplementation: rc4.fetchImplementation,
    });
    expect(repaired).toMatchObject({ status: "updated", version: "1.0.0-rc.4" });

    const updated = await installFromRelease({
      prefix,
      releaseIndexUrl: rc5.indexUrl,
      publicKeyPath,
      update: true,
      platform: "darwin",
      architecture: "arm64",
      fetchImplementation: rc5.fetchImplementation,
    });
    expect(updated).toMatchObject({ status: "updated", version: "1.0.0-rc.5" });
    expect(
      JSON.parse(await readFile(path.join(prefix, ".chai-studio-installation.json"), "utf8")),
    ).toMatchObject({
      version: "1.0.0-rc.5",
      installedRuntime: path.join(prefix, "lib", "chai-studio"),
    });
    await expect(readFile(project, "utf8")).resolves.toContain("preserved");

    await expect(uninstallInstalledRelease({ prefix })).resolves.toMatchObject({
      status: "uninstalled",
      projectsDeleted: false,
    });
    await expect(stat(prefix)).rejects.toThrow();
    await expect(readFile(project, "utf8")).resolves.toContain("preserved");
  });
});

const temporaryRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chai-installer-flow-"));
  temporaryRoots.push(root);
  return root;
};

const releaseFixture = async (
  root: string,
  version: string,
  sourceCommit: string,
  privateKey: string,
  publicKey: string,
) => {
  const bundle = path.join(root, `chai-studio-${version}`);
  await mkdir(path.join(bundle, "scripts"), { recursive: true });
  for (const script of [
    "browser-isolation.mjs",
    "chai-studio.mjs",
    "release-bundle.mjs",
    "release-operations.mjs",
    "runtime-web-server.mjs",
  ]) {
    await cp(path.resolve("scripts", script), path.join(bundle, "scripts", script));
  }
  const marker = await sealReleaseBundle({
    root: bundle,
    metadata: {
      version,
      sourceCommit,
      dependencyLockSha256: "a".repeat(64),
      licenseInventorySha256: "b".repeat(64),
      platform: "darwin",
      architecture: "arm64",
      distributionScope: "personal-local-only",
    },
  });
  const archive = path.join(root, `${version}.tar.gz`);
  await execFileAsync("tar", ["-czf", archive, "-C", path.dirname(bundle), path.basename(bundle)], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const archiveBytes = await readFile(archive);
  const archiveUrl = `https://downloads.example.test/${version}.tar.gz`;
  const unsigned: Omit<ReleaseRecord, "signature"> = {
    schemaVersion: "1.0.0",
    product: "Chai Studio",
    version,
    platform: "darwin",
    architecture: "arm64",
    sourceCommit,
    bundleIdentity: marker.bundleIdentity,
    archiveUrl,
    archiveBytes: archiveBytes.length,
    archiveSha256: createHash("sha256").update(archiveBytes).digest("hex"),
    releaseAuthorized: true,
    publishable: true,
  };
  const release: ReleaseRecord = {
    ...unsigned,
    signature: {
      algorithm: "Ed25519",
      keyId: "test-release-key",
      publicKeySha256: createHash("sha256").update(publicKey).digest("hex"),
      value: sign(null, signedReleaseBytes(unsigned), privateKey).toString("base64"),
    },
  };
  const index: ReleaseIndex = {
    schemaVersion: "1.0.0",
    product: "Chai Studio",
    latest: version,
    releases: [release],
  };
  const indexUrl = `https://downloads.example.test/${version}.json`;
  const fetchImplementation: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === indexUrl) {
      return Promise.resolve(
        new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }),
      );
    }
    if (url === archiveUrl) return Promise.resolve(new Response(archiveBytes));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return { fetchImplementation, indexUrl };
};
