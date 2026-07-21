import { createHash, createPublicKey, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

export const defaultReleaseIndexUrl =
  "https://github.com/stardustv01/chai-studio/releases/latest/download/chai-studio-release-index.json";
export const installationMarker = ".chai-studio-installation.json";
const trustedKeysPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../keys/trusted-release-keys.json",
);

export const defaultInstallPrefix = () => path.join(os.homedir(), "Applications", "Chai Studio");

export const installFromRelease = async ({
  prefix = defaultInstallPrefix(),
  releaseIndexUrl,
  publicKeyPath,
  version,
  update = false,
  platform = os.platform(),
  architecture = os.arch(),
  fetchImplementation = globalThis.fetch,
}) => {
  assertSupportedHost(platform, architecture);
  const resolvedPrefix = path.resolve(prefix);
  const indexUrl = releaseIndexUrl ?? process.env.CHAI_STUDIO_RELEASE_INDEX_URL ?? defaultReleaseIndexUrl;
  const index = await fetchReleaseIndex(indexUrl, fetchImplementation);
  const release = selectRelease(index, { version, platform, architecture });
  const publicKeyPem = await resolveTrustedKey({ release, publicKeyPath });
  verifyReleaseRecord(release, publicKeyPem);
  const existing = await readInstalledMarker(resolvedPrefix).catch(() => null);
  if (existing !== null && !update) {
    throw new Error("Chai Studio is already installed. Use `chai-studio update`.");
  }
  if (existing === null && update) {
    throw new Error("Chai Studio is not installed. Use `chai-studio install`.");
  }
  if (existing?.version === release.version) {
    const integrityPassed = await validateInstalledRuntime(resolvedPrefix, existing).catch(() => false);
    if (integrityPassed) {
      return {
        status: "already-current",
        prefix: resolvedPrefix,
        version: release.version,
        sourceCommit: release.sourceCommit,
        bundleIdentity: release.bundleIdentity,
      };
    }
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-studio-cli-"));
  try {
    const archive = path.join(temporaryRoot, "chai-studio-release.tar.gz");
    await downloadReleaseArchive({ release, destination: archive, fetchImplementation });
    const extractedBundle = await extractReleaseArchive({ archive, destination: temporaryRoot, release });
    const installed =
      existing === null
        ? await invokeBundleInstall({ bundle: extractedBundle, prefix: resolvedPrefix })
        : await replaceInstalledRelease({ bundle: extractedBundle, prefix: resolvedPrefix });
    return {
      status: existing === null ? "installed" : "updated",
      prefix: resolvedPrefix,
      version: release.version,
      sourceCommit: release.sourceCommit,
      bundleIdentity: release.bundleIdentity,
      launcher: installed.launcher,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

export const doctorInstaller = async ({
  prefix = defaultInstallPrefix(),
  platform = os.platform(),
  architecture = os.arch(),
} = {}) => {
  const marker = await readInstalledMarker(prefix).catch(() => null);
  const launcher = path.join(prefix, "bin", "chai-studio");
  const runtimeIntegrity =
    marker === null ? false : await validateInstalledRuntime(path.resolve(prefix), marker).catch(() => false);
  const checks = [
    { id: "platform", passed: platform === "darwin", observed: platform },
    { id: "architecture", passed: architecture === "arm64", observed: architecture },
    { id: "node", passed: nodeAtLeast(22, 17), observed: process.version },
    { id: "installed", passed: marker !== null, observed: marker?.version ?? "not-installed" },
    { id: "launcher", passed: await exists(launcher), observed: launcher },
    {
      id: "runtime-integrity",
      passed: runtimeIntegrity,
      observed: runtimeIntegrity ? marker?.bundleIdentity : "invalid-or-missing",
    },
  ];
  return {
    schemaVersion: "1.0.0",
    product: "Chai Studio CLI",
    passed: checks.every((check) => check.passed),
    supportedPlatform: "darwin-arm64",
    prefix: path.resolve(prefix),
    installedVersion: marker?.version ?? null,
    checks,
  };
};

export const uninstallInstalledRelease = async ({ prefix = defaultInstallPrefix() } = {}) => {
  const resolvedPrefix = path.resolve(prefix);
  await readInstalledMarker(resolvedPrefix);
  await runInstalledCommand({
    prefix: resolvedPrefix,
    command: "uninstall",
    arguments: ["--prefix", resolvedPrefix],
  });
  return { status: "uninstalled", prefix: resolvedPrefix, projectsDeleted: false };
};

export const runInstalledCommand = async ({
  prefix = defaultInstallPrefix(),
  command,
  arguments: values = [],
}) => {
  const resolvedPrefix = path.resolve(prefix);
  const marker = await readInstalledMarker(resolvedPrefix);
  const runtimeCli = path.join(resolvedPrefix, "lib", "chai-studio", "scripts", "chai-studio.mjs");
  if (!(await exists(runtimeCli))) throw new Error("The installed Chai Studio runtime is incomplete.");
  await runCommand(process.execPath, [runtimeCli, command, ...values], { stdio: "inherit" });
  return { command, version: marker.version, prefix: resolvedPrefix };
};

export const fetchReleaseIndex = async (url, fetchImplementation = globalThis.fetch) => {
  assertHttpsUrl(url, "Release index");
  const response = await fetchImplementation(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Release index request failed with HTTP ${String(response.status)}.`);
  const index = await response.json();
  if (
    index?.schemaVersion !== "1.0.0" ||
    index?.product !== "Chai Studio" ||
    !Array.isArray(index?.releases)
  ) {
    throw new Error("Release index is malformed.");
  }
  return index;
};

export const selectRelease = (index, { version, platform, architecture }) => {
  const candidates = index.releases.filter(
    (release) =>
      release?.platform === platform &&
      release?.architecture === architecture &&
      (version === undefined || release?.version === version),
  );
  if (candidates.length === 0) {
    throw new Error(`No authorized Chai Studio release supports ${platform}-${architecture}.`);
  }
  const release = candidates.find((candidate) => candidate.version === index.latest) ?? candidates[0];
  assertReleaseRecord(release);
  if (release.releaseAuthorized !== true || release.publishable !== true) {
    throw new Error("The selected Chai Studio release is not authorized for distribution.");
  }
  return release;
};

export const verifyReleaseRecord = (release, publicKeyPem) => {
  assertReleaseRecord(release);
  const publicKey = createPublicKey(publicKeyPem);
  const exported = publicKey.export({ type: "spki", format: "pem" });
  const observedKeyHash = sha256(Buffer.from(exported));
  if (observedKeyHash !== release.signature.publicKeySha256) {
    throw new Error("Release signing key identity does not match the signed record.");
  }
  const signature = Buffer.from(release.signature.value, "base64");
  if (!verify(null, signedReleaseBytes(release), publicKey, signature)) {
    throw new Error("Release record signature verification failed.");
  }
  return true;
};

export const signedReleaseBytes = (release) =>
  Buffer.from(
    canonicalJson(Object.fromEntries(Object.entries(release).filter(([key]) => key !== "signature"))),
  );

export const downloadReleaseArchive = async ({
  release,
  destination,
  fetchImplementation = globalThis.fetch,
}) => {
  assertHttpsUrl(release.archiveUrl, "Release archive");
  const response = await fetchImplementation(release.archiveUrl, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(`Release archive request failed with HTTP ${String(response.status)}.`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: "wx" }));
  const metadata = await stat(destination);
  if (metadata.size !== release.archiveBytes) {
    throw new Error("Downloaded release archive byte count does not match its signed record.");
  }
  const observed = await sha256File(destination);
  if (observed !== release.archiveSha256) {
    throw new Error("Downloaded release archive checksum does not match its signed record.");
  }
  return { bytes: metadata.size, sha256: observed };
};

export const extractReleaseArchive = async ({ archive, destination, release }) => {
  const extractionRoot = path.join(destination, "extracted");
  await mkdir(extractionRoot);
  const listing = await runCommand("tar", ["-tzf", archive], { stdio: "pipe" });
  assertSafeArchiveEntries(listing.stdout);
  await runCommand("tar", ["-xzf", archive, "-C", extractionRoot], { stdio: "pipe" });
  const children = await readdir(extractionRoot, { withFileTypes: true });
  const directories = children.filter((entry) => entry.isDirectory());
  if (children.length !== 1 || directories.length !== 1) {
    throw new Error("Release archive must contain exactly one application bundle directory.");
  }
  const bundle = path.join(extractionRoot, directories[0].name);
  const marker = JSON.parse(await readFile(path.join(bundle, ".chai-studio-release.json"), "utf8"));
  if (
    marker.version !== release.version ||
    marker.sourceCommit !== release.sourceCommit ||
    marker.bundleIdentity !== release.bundleIdentity ||
    marker.platform !== release.platform ||
    marker.architecture !== release.architecture
  ) {
    throw new Error("Extracted release identity does not match its signed download record.");
  }
  const validation = await validateExtractedBundle(bundle, marker);
  if (!validation.passed || validation.actualIdentity !== release.bundleIdentity) {
    throw new Error("Extracted release contents do not match their signed bundle identity.");
  }
  return bundle;
};

export const assertSafeArchiveEntries = (listing) => {
  const entries = listing.split("\n").filter(Boolean);
  if (entries.length === 0) throw new Error("Release archive is empty.");
  let topLevel = null;
  for (const entry of entries) {
    if (entry.includes("\0") || path.posix.isAbsolute(entry)) {
      throw new Error("Release archive contains an unsafe path.");
    }
    const parts = entry.split("/").filter((part) => part.length > 0 && part !== ".");
    if (parts.length === 0 || parts.includes("..")) {
      throw new Error("Release archive contains an unsafe path.");
    }
    topLevel ??= parts[0];
    if (parts[0] !== topLevel) {
      throw new Error("Release archive must contain one top-level application bundle.");
    }
  }
  return topLevel;
};

const validateExtractedBundle = async (bundle, marker) => {
  if (!Array.isArray(marker.entries)) throw new Error("Release bundle marker is malformed.");
  const entries = await hashExtractedTree(bundle);
  const payload = { ...marker, entries };
  delete payload.bundleIdentity;
  const actualIdentity = sha256(Buffer.from(canonicalJson(payload)));
  return {
    passed:
      actualIdentity === marker.bundleIdentity && canonicalJson(entries) === canonicalJson(marker.entries),
    actualIdentity,
  };
};

const hashExtractedTree = async (root) => {
  const entries = [];
  const visit = async (directory) => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (relative === ".chai-studio-release.json") continue;
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
        const resolvedTarget = path.resolve(path.dirname(absolute), linkTarget);
        if (path.isAbsolute(linkTarget) || !isInside(root, resolvedTarget)) {
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
        throw new Error(`Release bundle contains an unsupported entry: ${relative}`);
      }
    }
  };
  await visit(root);
  return entries;
};

const replaceInstalledRelease = async ({ bundle, prefix }) => {
  const staging = `${prefix}.update-${String(process.pid)}`;
  const rollback = `${prefix}.rollback-${String(process.pid)}`;
  await rejectExisting(staging);
  await rejectExisting(rollback);
  const staged = await invokeBundleInstall({ bundle, prefix: staging });
  let oldMoved = false;
  try {
    await rename(prefix, rollback);
    oldMoved = true;
    await rename(staging, prefix);
    await repairInstalledMarker(prefix);
    await rm(rollback, { recursive: true, force: false });
    return { ...staged, launcher: path.join(prefix, "bin", "chai-studio") };
  } catch (error) {
    if (await exists(prefix)) await rm(prefix, { recursive: true, force: true });
    if (oldMoved && (await exists(rollback))) await rename(rollback, prefix);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
};

const invokeBundleInstall = async ({ bundle, prefix }) => {
  const cli = path.join(bundle, "scripts", "chai-studio.mjs");
  const result = await runJsonCommand(process.execPath, [cli, "install", "--prefix", prefix]);
  if (result?.bundleIdentity === undefined || result?.launcher === undefined) {
    throw new Error("Release bundle installer returned an invalid installation receipt.");
  }
  return result;
};

const repairInstalledMarker = async (prefix) => {
  const markerPath = path.join(prefix, installationMarker);
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  marker.installedRuntime = path.join(prefix, "lib", "chai-studio");
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
};

const readInstalledMarker = async (prefix) => {
  const marker = JSON.parse(await readFile(path.join(prefix, installationMarker), "utf8"));
  if (
    marker?.schemaVersion !== "1.0.0" ||
    marker?.product !== "Chai Studio" ||
    marker?.projectsInsideInstall !== false ||
    typeof marker?.version !== "string" ||
    !/^[a-f0-9]{40}$/u.test(marker?.sourceCommit ?? "") ||
    typeof marker?.bundleIdentity !== "string"
  ) {
    throw new Error("Chai Studio installation marker is invalid.");
  }
  return marker;
};

const validateInstalledRuntime = async (prefix, installation) => {
  const runtime = path.join(prefix, "lib", "chai-studio");
  const marker = JSON.parse(await readFile(path.join(runtime, ".chai-studio-release.json"), "utf8"));
  const validation = await validateExtractedBundle(runtime, marker);
  return (
    validation.passed &&
    marker.version === installation.version &&
    marker.sourceCommit === installation.sourceCommit &&
    marker.bundleIdentity === installation.bundleIdentity &&
    validation.actualIdentity === installation.bundleIdentity
  );
};

const resolveTrustedKey = async ({ release, publicKeyPath }) => {
  if (publicKeyPath !== undefined) return readFile(path.resolve(publicKeyPath), "utf8");
  const trustStore = JSON.parse(await readFile(trustedKeysPath, "utf8"));
  const trusted = trustStore.keys?.find((key) => key.id === release.signature.keyId);
  if (typeof trusted?.publicKeyPem !== "string") {
    throw new Error(
      "No trusted production release key is configured. This CLI build cannot install public releases.",
    );
  }
  return trusted.publicKeyPem;
};

const assertReleaseRecord = (release) => {
  if (
    release?.schemaVersion !== "1.0.0" ||
    release?.product !== "Chai Studio" ||
    !/^1\.0\.0(?:-rc\.\d+)?$/u.test(release?.version ?? "") ||
    release?.platform !== "darwin" ||
    release?.architecture !== "arm64" ||
    !/^[a-f0-9]{40}$/u.test(release?.sourceCommit ?? "") ||
    !/^[a-f0-9]{64}$/u.test(release?.bundleIdentity ?? "") ||
    !/^[a-f0-9]{64}$/u.test(release?.archiveSha256 ?? "") ||
    !Number.isSafeInteger(release?.archiveBytes) ||
    release.archiveBytes <= 0 ||
    release?.signature?.algorithm !== "Ed25519" ||
    typeof release?.signature?.keyId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(release?.signature?.publicKeySha256 ?? "") ||
    typeof release?.signature?.value !== "string"
  ) {
    throw new Error("Release record is malformed.");
  }
  assertHttpsUrl(release.archiveUrl, "Release archive");
};

const assertSupportedHost = (platform, architecture) => {
  if (platform !== "darwin" || architecture !== "arm64") {
    throw new Error(
      `Chai Studio currently supports only Apple Silicon macOS, not ${platform}-${architecture}.`,
    );
  }
  if (!nodeAtLeast(22, 17)) throw new Error("Chai Studio CLI requires Node 22.17.0 or newer.");
};

const assertHttpsUrl = (value, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} URL is invalid.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} URL must use HTTPS.`);
};

const runJsonCommand = async (command, values) => {
  const result = await runCommand(command, values, { stdio: "pipe" });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Release bundle installer returned malformed output.");
  }
};

const runCommand = (command, values, { stdio }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, values, {
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    if (stdio !== "inherit") {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => (stdout += chunk));
      child.stderr?.on("data", (chunk) => (stderr += chunk));
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed (${signal ?? String(code)}): ${stderr.trim()}`));
    });
  });

const rejectExisting = async (candidate) => {
  if (await exists(candidate)) throw new Error(`Temporary update path already exists: ${candidate}`);
};
const exists = async (candidate) =>
  access(candidate)
    .then(() => true)
    .catch(() => false);
const sha256File = async (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isInside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
const nodeAtLeast = (major, minor) => {
  const [observedMajor = 0, observedMinor = 0] = process.versions.node.split(".").map(Number);
  return observedMajor > major || (observedMajor === major && observedMinor >= minor);
};
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
