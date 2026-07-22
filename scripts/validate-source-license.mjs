import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const results = [];

const rootLicense = await readText("LICENSE");
const cliLicense = await readText("packages/cli/LICENSE");
results.push(
  check(
    "canonical-apache-license",
    rootLicense === cliLicense &&
      rootLicense.includes("Apache License") &&
      rootLicense.includes("Version 2.0, January 2004") &&
      rootLicense.includes("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION") &&
      rootLicense.includes("END OF TERMS AND CONDITIONS"),
  ),
);

const notice = await readText("NOTICE");
const thirdPartyNotices = await readText("THIRD_PARTY_NOTICES.md");
const cliThirdPartyNotices = await readText("packages/cli/THIRD_PARTY_NOTICES.md");
results.push(
  check(
    "owner-and-third-party-notices",
    notice.includes("Copyright 2026 Navin") &&
      thirdPartyNotices.includes("Remotion 4.0.489") &&
      thirdPartyNotices.includes("Noto Sans Devanagari") &&
      thirdPartyNotices.includes("React 19.1.0") &&
      thirdPartyNotices.includes("FFmpeg/FFprobe") &&
      thirdPartyNotices.includes("does not") &&
      thirdPartyNotices.includes("relicense") &&
      cliThirdPartyNotices.includes("npm dependencies") &&
      cliThirdPartyNotices.includes("OFL.txt") &&
      cliThirdPartyNotices.includes("react-mit.txt"),
  ),
);

const fontLicense = await readText("apps/studio-web/public/fonts/OFL.txt");
const reactLicense = await readText("apps/studio-web/public/third-party/react-mit.txt");
results.push(
  check(
    "bundled-browser-license-texts",
    fontLicense.includes("SIL OPEN FONT LICENSE Version 1.1") &&
      fontLicense.includes("Copyright 2022 The Noto Project Authors") &&
      reactLicense.includes("MIT License") &&
      reactLicense.includes("Copyright (c) Meta Platforms, Inc. and affiliates."),
  ),
);

const manifestPaths = ["package.json", ...(await workspaceManifestPaths())];
const manifests = await Promise.all(
  manifestPaths.map(async (relative) => ({
    relative,
    manifest: JSON.parse(await readText(relative)),
  })),
);
results.push(
  check(
    "chai-package-metadata",
    manifests.every(({ manifest }) => manifest.license === "Apache-2.0"),
    manifests.filter(({ manifest }) => manifest.license !== "Apache-2.0").map(({ relative }) => relative),
  ),
);

const cliManifest = manifests.find(({ relative }) => relative === "packages/cli/package.json")?.manifest;
const internalManifests = manifests.filter(({ relative }) => relative !== "packages/cli/package.json");
results.push(
  check(
    "public-cli-private-internals",
    cliManifest?.private === false &&
      cliManifest?.publishConfig?.access === "public" &&
      internalManifests.every(({ manifest }) => manifest.private === true),
    internalManifests.filter(({ manifest }) => manifest.private !== true).map(({ relative }) => relative),
  ),
);
results.push(
  check(
    "cli-license-payload",
    ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"].every((file) => cliManifest?.files?.includes(file)),
  ),
);

const runtimeBuildSource = await readText("scripts/build-cli-runtime.mjs");
const nativeRuntimeSource = await readText("apps/studio-server/src/native-composition-runtime.ts");
const requiredRegistryDependencies = {
  "@playwright/test": "1.61.1",
  "@remotion/bundler": "4.0.489",
  "@remotion/player": "4.0.489",
  "@remotion/renderer": "4.0.489",
  ajv: "8.20.0",
  hyperframes: "0.7.58",
  react: "19.1.0",
  "react-dom": "19.1.0",
  remotion: "4.0.489",
  sharp: "0.35.3",
};
results.push(
  check(
    "registry-runtime-dependency-boundary",
    Object.entries(requiredRegistryDependencies).every(
      ([name, version]) => cliManifest?.dependencies?.[name] === version,
    ) &&
      runtimeBuildSource.includes('packages: "external"') &&
      runtimeBuildSource.includes('name: "bundle-chai-workspace-code"') &&
      nativeRuntimeSource.includes('import.meta.resolve("hyperframes/dist/cli.js")'),
  ),
);

const releaseBundleSource = await readText("scripts/release-bundle.mjs");
results.push(
  check(
    "release-notice-payload",
    ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"].every((file) =>
      releaseBundleSource.includes(`"${file}"`),
    ),
  ),
);

const { stdout: trackedOutput } = await execFileAsync("git", ["ls-files", "-z"], { cwd: root });
const tracked = trackedOutput.split("\0").filter(Boolean);
const forbiddenTracked = tracked.filter(
  (file) =>
    file.includes("/node_modules/") ||
    file.startsWith("node_modules/") ||
    file.startsWith(".pnpm-store/") ||
    file.startsWith("dist/releases/"),
);
results.push(
  check("source-tree-excludes-installed-runtime", forbiddenTracked.length === 0, forbiddenTracked),
);

const report = {
  schemaVersion: "1.0.0",
  product: "Chai Studio source license",
  license: "Apache-2.0",
  copyrightHolder: "Navin",
  passed: results.every((result) => result.passed),
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;

async function workspaceManifestPaths() {
  const paths = [];
  for (const owner of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(root, owner), { withFileTypes: true })) {
      if (entry.isDirectory()) paths.push(`${owner}/${entry.name}/package.json`);
    }
  }
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}

function readText(relative) {
  return readFile(path.join(root, relative), "utf8");
}

function check(id, passed, problems = []) {
  return { id, passed, problems };
}
