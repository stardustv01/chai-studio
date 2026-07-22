import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "governance", "licenses", "dependency-inventory.json");
const mode = process.argv.includes("--write") ? "write" : "check";
const remotionCompositorClassification = JSON.parse(
  await readFile(
    path.join(root, "governance", "licenses", "remotion-compositor-classification.json"),
    "utf8",
  ),
);
const webPublicRoot = path.join(root, "apps", "studio-web", "public");
const bundledFonts = await Promise.all(
  ["Regular", "Medium", "SemiBold"].map(async (weight) => {
    const relativePath = `apps/studio-web/public/fonts/NotoSansDevanagari-${weight}.ttf`;
    return {
      family: "Noto Sans Devanagari",
      weight,
      path: relativePath,
      sha256: await sha256File(path.join(root, relativePath)),
      copyright: "Copyright 2022 The Noto Project Authors",
      license: "OFL-1.1",
      licenseText: "apps/studio-web/public/fonts/OFL.txt",
      source: "https://github.com/notofonts/devanagari",
    };
  }),
);
const chaiIconManifest = JSON.parse(
  await readFile(path.join(webPublicRoot, "icons", "chai", "manifest.json"), "utf8"),
);
const bundledApplicationMedia = [
  {
    id: "chai-app-icon",
    path: "apps/studio-web/public/brand/chai/v1/chai-app-icon.svg",
    sha256: await sha256File(path.join(webPublicRoot, "brand", "chai", "v1", "chai-app-icon.svg")),
    license: "Apache-2.0",
    rightsHolder: "Navin",
    distributionClass: "chai-owned-application-artwork",
  },
  {
    id: "chai-ui-icon-system-v2",
    manifestPath: "apps/studio-web/public/icons/chai/manifest.json",
    manifestSha256: await sha256File(path.join(webPublicRoot, "icons", "chai", "manifest.json")),
    sourceManifestSha256: chaiIconManifest.sourceManifestSha256,
    baseIconCount: chaiIconManifest.total,
    distributedVariantCount: Object.values(chaiIconManifest.variants).flat().length,
    license: "Apache-2.0",
    rightsHolder: "Navin",
    distributionClass: "chai-owned-application-artwork",
  },
];

const installed = await installedPackages();
const workspaces = await workspacePackages();
const ffmpeg = externalCommandInventory("ffmpeg", ["-version"]);
const pnpmStoreEntries = await readdir(path.join(root, "node_modules", ".pnpm"));
const playwrightCoreEntry = pnpmStoreEntries.find((entry) => entry.startsWith("playwright-core@"));
if (playwrightCoreEntry === undefined) throw new Error("Playwright core installation is unavailable.");
const playwrightBrowsers = JSON.parse(
  await readFile(
    path.join(
      root,
      "node_modules",
      ".pnpm",
      playwrightCoreEntry,
      "node_modules",
      "playwright-core",
      "browsers.json",
    ),
    "utf8",
  ),
).browsers;
const browser = playwrightBrowsers
  .filter((entry) => entry.name === "chromium" || entry.name === "chromium-headless-shell")
  .map((entry) => ({
    name: entry.name,
    revision: entry.revision,
    browserVersion: entry.browserVersion,
    source: "Playwright-managed browser cache",
    bundledByCurrentApplication: false,
    licenseReview: "Chromium notices and bundled-codec configuration must be captured by P25 packaging.",
  }));
const inventoryWithoutIdentity = {
  schemaVersion: "1.0.0",
  generatedFrom: "local frozen workspace and installed dependency metadata",
  generatedAtPolicy: "deterministic-no-timestamp",
  scope: {
    baseline: "personal-use macOS local application",
    sourceDistribution: "apache-2.0-open-source",
    publicDistribution: "blocked-pending-release-review",
    commercialization: "blocked-pending-release-review",
  },
  engines: installed.filter((entry) =>
    ["remotion", "@remotion/bundler", "@remotion/player", "@remotion/renderer", "hyperframes"].includes(
      entry.name,
    ),
  ),
  ffmpeg: {
    source: "external PATH tool; not bundled by current application",
    available: ffmpeg.available,
    executable: ffmpeg.executable,
    versionLine: ffmpeg.lines[0] ?? null,
    configurationLine: ffmpeg.lines.find((line) => line.startsWith("configuration:")) ?? null,
    distributionObligation:
      "P25 must review the exact binary configuration, linked libraries, enabled codecs, and notices before bundling or distribution.",
  },
  browser,
  browserPayload: {
    bundledLibraries: [
      {
        names: ["react", "react-dom", "scheduler"],
        versions: ["19.1.0", "19.1.0", "0.26.0"],
        license: "MIT",
        copyright: "Copyright (c) Meta Platforms, Inc. and affiliates.",
        licenseText: "apps/studio-web/public/third-party/react-mit.txt",
      },
    ],
  },
  fonts: {
    bundledApplicationFonts: bundledFonts,
    rule: "Project fonts remain user assets with hash/rights evidence; any P25 bundled font requires a new inventory row.",
  },
  assets: {
    bundledApplicationMedia,
    rule: "Golden fixtures and test media are not application distribution assets; shipped assets require source, hash, license, notice, and restrictions.",
  },
  reviewedLicenseClassifications: [remotionCompositorClassification],
  workspacePackages: workspaces,
  installedDependencyTree: installed,
  releaseObligations: [
    "Preserve every required license and notice for packaged code.",
    "Re-review current Remotion terms before public distribution, commercialization, team growth, automation-scale change, or engine upgrade.",
    "Review the exact FFmpeg binary and codec configuration before bundling.",
    "Generate a packaging-time SBOM because this installed development tree is not proof of final bundle contents.",
    "Preserve the React MIT and Noto OFL license texts inside every compiled browser payload.",
  ],
};
const inventory = {
  ...inventoryWithoutIdentity,
  identityHash: sha256(canonical(inventoryWithoutIdentity)),
};
const serialized = await format(JSON.stringify(inventory), { parser: "json" });
if (mode === "write") {
  await writeFile(target, serialized);
} else {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== serialized) {
    console.error("P23 dependency/license inventory is missing or stale. Run with --write after review.");
    process.exitCode = 1;
  }
}
console.log(
  JSON.stringify(
    {
      passed: process.exitCode !== 1,
      identityHash: inventory.identityHash,
      installedPackageCount: installed.length,
      unknownLicenseCount: installed.filter((entry) => entry.license === "UNKNOWN").length,
      ffmpegAvailable: ffmpeg.available,
      browserCount: browser.length,
    },
    null,
    2,
  ),
);

async function installedPackages() {
  const store = path.join(root, "node_modules", ".pnpm");
  const records = new Map();
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modulesRoot = path.join(store, entry.name, "node_modules");
    for (const manifestPath of await packageManifests(modulesRoot)) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;
      const key = `${manifest.name}@${manifest.version}`;
      const license = packageLicense(manifest);
      records.set(key, {
        name: manifest.name,
        version: manifest.version,
        ...license,
        source:
          typeof manifest.repository === "string" ? manifest.repository : (manifest.repository?.url ?? null),
        notice: typeof manifest.notice === "string" ? manifest.notice : null,
        distributionClass: "installed-development-tree",
      });
    }
  }
  return [...records.values()].sort((left, right) =>
    left.name === right.name
      ? left.version.localeCompare(right.version)
      : left.name.localeCompare(right.name),
  );
}

function packageLicense(manifest) {
  const declared = normalizeLicense(manifest.license ?? manifest.licenses);
  if (declared !== "UNKNOWN") return { license: declared };
  if (
    manifest.name === remotionCompositorClassification.package &&
    manifest.version === remotionCompositorClassification.version &&
    manifest.repository?.url?.includes("github.com/remotion-dev/remotion")
  ) {
    return {
      license: remotionCompositorClassification.classification,
      licenseEvidence: remotionCompositorClassification.repositoryLicense,
      licenseClassificationBasis: remotionCompositorClassification.classificationBasis,
      binaryNotice: remotionCompositorClassification.binaryNotice,
      publicDistribution: remotionCompositorClassification.publicDistribution,
    };
  }
  return { license: declared };
}

async function packageManifests(modulesRoot) {
  const manifests = [];
  let entries;
  try {
    entries = await readdir(modulesRoot, { withFileTypes: true });
  } catch {
    return manifests;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(path.join(modulesRoot, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory())
          manifests.push(path.join(modulesRoot, entry.name, scoped.name, "package.json"));
      }
    } else {
      manifests.push(path.join(modulesRoot, entry.name, "package.json"));
    }
  }
  return manifests;
}

async function workspacePackages() {
  const packages = [];
  for (const owner of ["packages", "apps"]) {
    for (const entry of await readdir(path.join(root, owner), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(await readFile(path.join(root, owner, entry.name, "package.json"), "utf8"));
      packages.push({
        name: manifest.name,
        version: manifest.version,
        license: normalizeLicense(manifest.license),
        source: `${owner}/${entry.name}`,
        private: manifest.private === true,
      });
    }
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function externalCommandInventory(command, args) {
  const executable = spawnSync("/usr/bin/which", [command], { encoding: "utf8" }).stdout.trim();
  if (executable === "") return { available: false, executable: null, lines: [] };
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 5_000 });
  return {
    available: result.status === 0,
    executable,
    lines: `${result.stdout}${result.stderr}`.split(/\r?\n/).filter(Boolean),
  };
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (Array.isArray(value)) {
    const licenses = value.map((entry) => (typeof entry === "string" ? entry : entry?.type)).filter(Boolean);
    if (licenses.length > 0) return licenses.join(" OR ");
  }
  return "UNKNOWN";
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
}
