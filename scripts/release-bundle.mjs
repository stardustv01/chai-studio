import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const releaseBundleMarker = ".chai-studio-release.json";
const execFileAsync = promisify(execFile);
const runtimeScripts = [
  "browser-isolation.mjs",
  "browser-path-policy.mjs",
  "chai-studio.mjs",
  "release-bundle.mjs",
  "release-operations.mjs",
  "runtime-web-server.mjs",
];
const runtimeDocuments = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "docs/INSTALLATION.md",
  "docs/KNOWN_LIMITATIONS_V1.md",
  "docs/OPERATIONAL_HANDOFF_V1.md",
  "docs/POST_RELEASE_OPERATIONS.md",
  "docs/RECOVERY.md",
  "docs/SUPPORT_MATRIX_LOCAL_LAUNCH.md",
  "docs/USER_GUIDE.md",
  "governance/licenses/dependency-inventory.json",
  "governance/licenses/release-review.json",
];

export const createReleaseBundle = async ({
  sourceRoot,
  destination,
  allowDirty = false,
  sourceCommit: requestedSourceCommit,
}) => {
  const root = path.resolve(sourceRoot);
  const output = path.resolve(destination);
  const packageManifest = await readJson(path.join(root, "package.json"));
  const version = packageManifest.version;
  if (!/^1\.0\.0-rc\.\d+$/u.test(version ?? "")) {
    throw new Error("Release bundle requires a normalized 1.0.0 release-candidate version.");
  }
  const headCommit = await git(root, ["rev-parse", "HEAD"]);
  const sourceCommit = requestedSourceCommit ?? headCommit;
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) {
    throw new Error("Release bundle source commit must be an exact full Git commit identity.");
  }
  if (sourceCommit !== headCommit) {
    await assertEvidenceOnlyCommitRange(root, sourceCommit, headCommit);
  }
  const sourceState = await git(root, ["status", "--porcelain", "--untracked-files=all"]);
  const sourceChanges = sourceState
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/gu, ""))
    .filter((file) => !isGeneratedReleasePath(file));
  if (!allowDirty && sourceChanges.length > 0) {
    throw new Error(
      `Release bundle refused source changes outside generated evidence: ${sourceChanges.join(", ")}`,
    );
  }
  if (await exists(output)) throw new Error("Release bundle destination already exists.");
  await requireFile(path.join(root, "apps/studio-server/dist/index.js"));
  await requireFile(path.join(root, "apps/studio-web/dist/index.html"));

  await mkdir(path.dirname(output), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(output), ".chai-studio-bundle-"));
  try {
    await mkdir(path.join(staging, "apps", "studio-server"), { recursive: true });
    await execFileAsync(
      "corepack",
      [
        "pnpm",
        "--filter",
        "@chai-studio/studio-server",
        "deploy",
        "--prod",
        "--legacy",
        "--prefer-offline",
        "--frozen-lockfile",
        path.join(staging, "apps", "studio-server"),
      ],
      { cwd: root, env: { ...process.env, CI: "true" }, maxBuffer: 16 * 1024 * 1024 },
    );
    await repairDeploySelfLink(path.join(staging, "apps", "studio-server"));
    await copyTree(path.join(root, "apps/studio-web/dist"), path.join(staging, "apps/studio-web/dist"));
    for (const script of runtimeScripts) {
      await copyFileAt(root, staging, `scripts/${script}`);
    }
    for (const document of runtimeDocuments) await copyFileAt(root, staging, document);
    for (const file of [".node-version", "package.json", "pnpm-lock.yaml"]) {
      await copyFileAt(root, staging, file);
    }
    await pruneCompiledDevelopmentFiles(path.join(staging, "apps/studio-server"));
    await pruneCompiledDevelopmentFiles(path.join(staging, "apps/studio-web/dist"));
    await writeBundleLauncher(staging);
    const dependencyLockSha256 = await sha256File(path.join(staging, "pnpm-lock.yaml"));
    const licenseInventorySha256 = await sha256File(
      path.join(staging, "governance/licenses/dependency-inventory.json"),
    );
    const marker = await sealReleaseBundle({
      root: staging,
      metadata: {
        version,
        sourceCommit,
        dependencyLockSha256,
        licenseInventorySha256,
        platform: "darwin",
        architecture: "arm64",
        distributionScope: "personal-local-only",
      },
    });
    await rename(staging, output);
    return { destination: output, ...marker };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
};

export const sealReleaseBundle = async ({ root, metadata }) => {
  const resolvedRoot = path.resolve(root);
  await rm(path.join(resolvedRoot, releaseBundleMarker), { force: true });
  const entries = await hashReleaseTree(resolvedRoot);
  const payload = {
    schemaVersion: "1.0.0",
    product: "Chai Studio",
    channel: "release-candidate",
    launchModel: "localhost-web-server",
    selfContainedRuntime: true,
    ...metadata,
    entries,
  };
  const marker = {
    ...payload,
    bundleIdentity: sha256(Buffer.from(canonicalJson(payload))),
  };
  await writeFile(path.join(resolvedRoot, releaseBundleMarker), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
};

export const validateReleaseBundle = async (root) => {
  const resolvedRoot = path.resolve(root);
  const marker = await readJson(path.join(resolvedRoot, releaseBundleMarker));
  if (
    marker.schemaVersion !== "1.0.0" ||
    marker.product !== "Chai Studio" ||
    marker.selfContainedRuntime !== true ||
    !Array.isArray(marker.entries)
  ) {
    throw new Error("Release bundle marker is missing or invalid.");
  }
  const entries = await hashReleaseTree(resolvedRoot);
  const payload = { ...marker, entries };
  delete payload.bundleIdentity;
  const actualIdentity = sha256(Buffer.from(canonicalJson(payload)));
  const passed =
    actualIdentity === marker.bundleIdentity && canonicalJson(entries) === canonicalJson(marker.entries);
  return {
    passed,
    expectedIdentity: marker.bundleIdentity,
    actualIdentity,
    marker,
    entries,
  };
};

export const hashReleaseTree = async (root) => {
  const resolvedRoot = path.resolve(root);
  const entries = [];
  const visit = async (directory) => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(resolvedRoot, absolute).split(path.sep).join("/");
      if (relative === releaseBundleMarker) continue;
      if (child.isDirectory()) {
        await visit(absolute);
      } else if (child.isFile()) {
        const metadata = await stat(absolute);
        entries.push({
          path: relative,
          kind: "file",
          bytes: metadata.size,
          sha256: await sha256File(absolute),
        });
      } else if (child.isSymbolicLink()) {
        const linkTarget = await readlink(absolute);
        if (
          path.isAbsolute(linkTarget) ||
          !isInside(resolvedRoot, path.resolve(path.dirname(absolute), linkTarget))
        ) {
          throw new Error(`Release bundle contains an escaping symlink: ${relative}`);
        }
        entries.push({
          path: relative,
          kind: "symlink",
          linkTarget,
          bytes: Buffer.byteLength(linkTarget),
          sha256: sha256(Buffer.from(linkTarget)),
        });
      } else {
        throw new Error(`Release bundle contains an unsupported filesystem entry: ${relative}`);
      }
    }
  };
  await visit(resolvedRoot);
  return entries;
};

const writeBundleLauncher = async (root) => {
  const launcher = path.join(root, "bin", "chai-studio");
  await mkdir(path.dirname(launcher), { recursive: true });
  await writeFile(
    launcher,
    '#!/bin/sh\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$SCRIPT_DIR/../scripts/chai-studio.mjs" "$@"\n',
  );
  await chmod(launcher, 0o755);
};

const repairDeploySelfLink = async (applicationRoot) => {
  const link = path.join(applicationRoot, "node_modules/.pnpm/node_modules/@chai-studio/studio-server");
  if (!(await exists(link))) return;
  await rm(link, { force: true });
  await symlink(path.relative(path.dirname(link), applicationRoot), link);
};

const pruneCompiledDevelopmentFiles = async (root) => {
  if (!(await exists(root))) return;
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        if (entry.name === "src") await rm(absolute, { recursive: true, force: true });
        else await visit(absolute);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".map") ||
          entry.name.endsWith(".d.ts") ||
          entry.name.endsWith(".d.ts.map") ||
          entry.name === ".tsbuildinfo")
      ) {
        await rm(absolute);
      }
    }
  };
  await visit(root);
};

const copyFileAt = async (sourceRoot, destinationRoot, relative) => {
  const destination = path.join(destinationRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(sourceRoot, relative), destination, { force: false, errorOnExist: true });
};

const copyTree = async (source, destination) => {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
};

const git = async (root, arguments_) => {
  const { stdout } = await execFileAsync("git", arguments_, { cwd: root });
  return stdout.trim();
};

const assertEvidenceOnlyCommitRange = async (root, sourceCommit, headCommit) => {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", sourceCommit, headCommit], { cwd: root });
  } catch {
    throw new Error("Release bundle source commit must be an ancestor of the checked-out candidate.");
  }
  const changedFiles = (await git(root, ["diff", "--name-only", `${sourceCommit}..${headCommit}`]))
    .split("\n")
    .filter(Boolean);
  assertPostFreezeAuthorityChanges(changedFiles);
};

export const assertPostFreezeAuthorityChanges = (changedFiles) => {
  const sourceChanges = changedFiles.filter((file) => !isPostFreezeAuthorityPath(file));
  if (sourceChanges.length > 0) {
    throw new Error(
      `Release bundle refused a historical source commit with post-freeze source changes: ${sourceChanges.join(", ")}`,
    );
  }
};

const requireFile = async (file) => {
  const metadata = await lstat(file).catch(() => null);
  if (metadata === null || !metadata.isFile()) throw new Error(`Required release file is missing: ${file}`);
};

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const exists = async (candidate) =>
  stat(candidate)
    .then(() => true)
    .catch(() => false);
const sha256File = async (file) => sha256(await readFile(file));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isInside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const isGeneratedReleasePath = (file) =>
  ["dist/", "evidence/", "playwright-report/", "reports/", "test-results/"].some((prefix) =>
    file.startsWith(prefix),
  );
const isPostFreezeAuthorityPath = (file) =>
  isGeneratedReleasePath(file) ||
  file === "governance/V1_OWNER_APPROVAL.json" ||
  file === "governance/licenses/public-distribution-review.json";
const canonicalJson = (value) => JSON.stringify(sortValue(value));
const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
};
