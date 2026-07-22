import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(root, "packages", "cli");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-cli-package-"));

try {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json", packageRoot], {
    cwd: root,
    env: { ...process.env, npm_config_cache: path.join(temporaryRoot, "npm-cache") },
  });
  const [report] = JSON.parse(stdout);
  const requiredFiles = [
    "LICENSE",
    "NOTICE",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "bin/chai-studio.mjs",
    "keys/trusted-release-keys.json",
    "lib/installer.d.mts",
    "lib/installer.mjs",
    "package.json",
    "runtime/.chai-studio-registry-runtime.json",
    "runtime/LICENSE",
    "runtime/NOTICE",
    "runtime/THIRD_PARTY_NOTICES.md",
    "runtime/apps/studio-server/dist/index.js",
    "runtime/apps/studio-web/dist/index.html",
    "runtime/apps/studio-web/dist/fonts/OFL.txt",
    "runtime/apps/studio-web/dist/third-party/react-mit.txt",
    "runtime/scripts/chai-studio.mjs",
  ];
  const observedFiles = report?.files?.map((file) => file.path).sort() ?? [];
  const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const trustStore = JSON.parse(
    await readFile(path.join(packageRoot, "keys", "trusted-release-keys.json"), "utf8"),
  );
  const runtimeMarker = JSON.parse(
    await readFile(path.join(packageRoot, "runtime", ".chai-studio-registry-runtime.json"), "utf8"),
  );
  const help = await execFileAsync(process.execPath, [
    path.join(packageRoot, "bin", "chai-studio.mjs"),
    "help",
  ]);
  const checks = [
    {
      id: "public-registry-package-metadata",
      passed: packageManifest.private === false && packageManifest.publishConfig?.access === "public",
    },
    {
      id: "apache-source-license",
      passed: packageManifest.license === "Apache-2.0",
    },
    {
      id: "required-package-files",
      passed: requiredFiles.every((file) => observedFiles.includes(file)),
    },
    {
      id: "bounded-registry-artifact",
      passed: report?.unpackedSize > 0 && report.unpackedSize < 10_000_000,
    },
    {
      id: "registry-resolved-third-party-runtime",
      passed:
        runtimeMarker.version === packageManifest.version &&
        runtimeMarker.license === "Apache-2.0" &&
        runtimeMarker.thirdPartyDelivery === "npm-direct-dependencies" &&
        runtimeMarker.ffmpegDelivery === "external-system-tool" &&
        runtimeMarker.externalPackages?.every((name) => packageManifest.dependencies?.[name] !== undefined) &&
        JSON.stringify(runtimeMarker.runtimeDependencies) === JSON.stringify(packageManifest.dependencies) &&
        runtimeMarker.bundledBrowserLibraries?.some(
          (entry) => entry.license === "MIT" && entry.licenseText.endsWith("react-mit.txt"),
        ) &&
        runtimeMarker.bundledFonts?.some(
          (entry) => entry.license === "OFL-1.1" && entry.licenseText.endsWith("OFL.txt"),
        ) &&
        !observedFiles.some((file) => file.includes("node_modules/")),
    },
    {
      id: "production-trust-store-fails-closed",
      passed: trustStore.schemaVersion === "1.0.0" && trustStore.keys?.length === 0,
    },
    { id: "cli-help-smoke", passed: help.stdout.includes("Chai Studio installer CLI") },
  ];
  const result = {
    schemaVersion: "1.0.0",
    product: "Chai Studio CLI package",
    passed: checks.every((check) => check.passed),
    package: report?.id ?? null,
    packedBytes: report?.size ?? null,
    unpackedBytes: report?.unpackedSize ?? null,
    files: observedFiles,
    checks,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
