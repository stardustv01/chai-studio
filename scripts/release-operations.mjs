import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isolatedChromiumExecutable,
  isolatedChromiumIdentity,
  isolatedEngineExecutable,
  isolatedEngineIdentity,
} from "./browser-isolation.mjs";

export const installationMarker = ".chai-studio-installation.json";
export const backupManifestName = ".chai-backup-manifest.json";

export const collectReleaseEnvironment = async (root) => {
  const ffmpeg = commandVersion("ffmpeg", ["-version"]);
  const ffprobe = commandVersion("ffprobe", ["-version"]);
  const cpuModel = os.cpus()[0]?.model ?? "unknown";
  const memoryGiB = Math.round(os.totalmem() / 2 ** 30);
  const requiredFiles = [
    "pnpm-lock.yaml",
    "apps/studio-server/dist/index.js",
    "apps/studio-web/dist/index.html",
    "governance/licenses/dependency-inventory.json",
    "governance/licenses/release-review.json",
  ];
  const fileChecks = await Promise.all(
    requiredFiles.map(async (file) => ({ file, present: await exists(path.join(root, file)) })),
  );
  const checks = [
    { id: "platform", passed: os.platform() === "darwin", observed: os.platform() },
    { id: "architecture", passed: os.arch() === "arm64", observed: os.arch() },
    { id: "node", passed: nodeAtLeast(22, 17), observed: process.version },
    { id: "ffmpeg", passed: ffmpeg !== null, observed: ffmpeg ?? "missing" },
    { id: "ffprobe", passed: ffprobe !== null, observed: ffprobe ?? "missing" },
    {
      id: "ui-browser",
      passed: await exists(isolatedChromiumExecutable),
      observed: isolatedChromiumIdentity,
    },
    {
      id: "engine-browser",
      passed: await exists(isolatedEngineExecutable),
      observed: isolatedEngineIdentity,
    },
    ...fileChecks.map((check) => ({
      id: `file:${check.file}`,
      passed: check.present,
      observed: check.present ? "present" : "missing",
    })),
  ];
  const support =
    checks.every((check) => check.passed) && cpuModel === "Apple M4" && memoryGiB === 16
      ? "supported"
      : checks.every((check) => check.passed)
        ? "compatible-unmeasured"
        : "blocked";
  const identity = {
    studioVersion: "1.0.0-rc.1",
    platform: os.platform(),
    architecture: os.arch(),
    osRelease: os.release(),
    cpuModel,
    logicalCpuCount: os.cpus().length,
    memoryGiB,
    nodeVersion: process.version,
    ffmpegVersion: ffmpeg ?? "missing",
    ffprobeVersion: ffprobe ?? "missing",
    browserIdentity: isolatedChromiumIdentity,
    engineBrowserIdentity: isolatedEngineIdentity,
    launchModel: "localhost-web-server",
  };
  return {
    schemaVersion: "1.0.0",
    passed: checks.every((check) => check.passed),
    support,
    supportClass: support === "supported" ? "apple-m4-16gb" : null,
    identity,
    fingerprint: sha256(Buffer.from(canonicalJson(identity))),
    checks,
    cloudAccountRequired: false,
    desktopWrapperRequired: false,
  };
};

export const installLocalRelease = async ({ sourceRoot, prefix }) => {
  const markerPath = path.join(prefix, installationMarker);
  if (await exists(prefix)) {
    const existing = await readInstallationMarker(markerPath).catch(() => null);
    if (existing === null) throw new Error("Install prefix exists without a Chai Studio marker.");
  }
  await mkdir(path.join(prefix, "bin"), { recursive: true });
  const sourceIdentity = await sha256File(path.join(sourceRoot, "pnpm-lock.yaml"));
  const marker = {
    schemaVersion: "1.0.0",
    product: "Chai Studio",
    version: "1.0.0-rc.1",
    sourceRoot: path.resolve(sourceRoot),
    sourceIdentity,
    projectsInsideInstall: false,
  };
  const launcher = path.join(prefix, "bin", "chai-studio");
  await writeFile(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(sourceRoot, "scripts/chai-studio.mjs"))} "$@"\n`,
  );
  await chmod(launcher, 0o755);
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return { prefix: path.resolve(prefix), launcher, sourceIdentity };
};

export const uninstallLocalRelease = async (prefix) => {
  const markerPath = path.join(prefix, installationMarker);
  const marker = await readInstallationMarker(markerPath);
  const nestedProjects = (await walk(prefix)).filter((file) =>
    file.split(path.sep).some((part) => part.endsWith(".chai")),
  );
  if (nestedProjects.length > 0 || marker.projectsInsideInstall !== false) {
    throw new Error("Uninstall refused because a .chai project is inside the application prefix.");
  }
  await rm(prefix, { recursive: true, force: false });
  return { removedPrefix: path.resolve(prefix), projectsDeleted: false };
};

export const backupProject = async ({
  source,
  destination,
  mode = "backup",
  environmentFingerprint = null,
}) => {
  if (!path.basename(source).endsWith(".chai")) throw new Error("Project source must be a .chai directory.");
  if (!(await exists(source))) throw new Error("Project source does not exist.");
  if (await exists(destination)) throw new Error("Backup destination already exists.");
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (candidate) => !candidate.split(path.sep).includes(".chai-cache"),
  });
  const entries = await hashTree(destination, new Set([backupManifestName]));
  const manifest = {
    schemaVersion: "1.0.0",
    kind: mode,
    sourceProjectName: path.basename(source),
    cacheExcluded: true,
    deliveredArtifactsPreserved: true,
    environmentFingerprint,
    entries,
    contentIdentity: sha256(Buffer.from(canonicalJson(entries))),
  };
  await writeFile(path.join(destination, backupManifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

export const validateProjectBackup = async (backup) => {
  const manifest = JSON.parse(await readFile(path.join(backup, backupManifestName), "utf8"));
  const entries = await hashTree(backup, new Set([backupManifestName]));
  const actualIdentity = sha256(Buffer.from(canonicalJson(entries)));
  const passed = manifest.contentIdentity === actualIdentity && manifest.cacheExcluded === true;
  return { passed, manifest, actualIdentity, entries };
};

export const validateBackupEnvironment = async ({ backup, currentEnvironmentFingerprint }) => {
  const validation = await validateProjectBackup(backup);
  const sourceEnvironmentFingerprint = validation.manifest.environmentFingerprint;
  const compatible =
    validation.passed &&
    sourceEnvironmentFingerprint !== null &&
    sourceEnvironmentFingerprint === currentEnvironmentFingerprint;
  return {
    passed: validation.passed,
    compatible,
    sourceEnvironmentFingerprint,
    currentEnvironmentFingerprint,
    status: !validation.passed
      ? "invalid-backup"
      : sourceEnvironmentFingerprint === null
        ? "environment-unknown"
        : compatible
          ? "compatible"
          : "explicit-environment-incompatibility",
    projectRestoreAllowed: validation.passed,
    outputReproductionAllowed: compatible,
  };
};

export const restoreProjectBackup = async ({ backup, destination }) => {
  const validation = await validateProjectBackup(backup);
  if (!validation.passed) throw new Error("Backup integrity validation failed.");
  if (await exists(destination)) throw new Error("Restore destination already exists.");
  await cp(backup, destination, { recursive: true, force: false, errorOnExist: true });
  await rm(path.join(destination, backupManifestName));
  return {
    destination: path.resolve(destination),
    contentIdentity: validation.actualIdentity,
    validated: true,
  };
};

export const cloneProjectBackup = async ({ source, destination, environmentFingerprint = null }) => {
  const temporaryBackup = `${destination}.clone-source`;
  await backupProject({ source, destination: temporaryBackup, mode: "clone", environmentFingerprint });
  try {
    return await restoreProjectBackup({ backup: temporaryBackup, destination });
  } finally {
    await rm(temporaryBackup, { recursive: true, force: true });
  }
};

export const archiveProject = async ({ source, destination, environmentFingerprint = null }) =>
  backupProject({ source, destination, mode: "archive", environmentFingerprint });

export const hashTree = async (root, excludedNames = new Set()) => {
  const files = (await walk(root))
    .filter((file) => !excludedNames.has(path.basename(file)))
    .sort((left, right) => left.localeCompare(right, "en"));
  return Promise.all(
    files.map(async (file) => ({
      path: path.relative(root, file),
      bytes: (await stat(file)).size,
      sha256: await sha256File(file),
    })),
  );
};

export const sha256File = async (file) => sha256(await readFile(file));
export const canonicalJson = (value) => JSON.stringify(sortValue(value));

const walk = async (root) => {
  if (!(await exists(root))) return [];
  const result = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  await visit(root);
  return result;
};

const readInstallationMarker = async (markerPath) => {
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  if (marker.schemaVersion !== "1.0.0" || marker.product !== "Chai Studio") {
    throw new Error("Install marker is invalid.");
  }
  return marker;
};

const exists = async (candidate) =>
  stat(candidate)
    .then(() => true)
    .catch(() => false);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nodeAtLeast = (major, minor) => {
  const [observedMajor = 0, observedMinor = 0] = process.versions.node.split(".").map(Number);
  return observedMajor > major || (observedMajor === major && observedMinor >= minor);
};
const commandVersion = (command, arguments_) => {
  const result = spawnSync(command, arguments_, { encoding: "utf8", timeout: 5_000 });
  if (result.status !== 0) return null;
  return String(result.stdout).split(/\r?\n/u)[0]?.trim() || null;
};
const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
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
