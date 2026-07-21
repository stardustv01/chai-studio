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
  const expectedFiles = [
    "README.md",
    "bin/chai-studio.mjs",
    "keys/trusted-release-keys.json",
    "lib/installer.d.mts",
    "lib/installer.mjs",
    "package.json",
  ];
  const observedFiles = report?.files?.map((file) => file.path).sort() ?? [];
  const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const trustStore = JSON.parse(
    await readFile(path.join(packageRoot, "keys", "trusted-release-keys.json"), "utf8"),
  );
  const help = await execFileAsync(process.execPath, [
    path.join(packageRoot, "bin", "chai-studio.mjs"),
    "help",
  ]);
  const checks = [
    {
      id: "package-private-until-release-authorization",
      passed: packageManifest.private === true,
    },
    {
      id: "exact-package-files",
      passed: JSON.stringify(observedFiles) === JSON.stringify(expectedFiles),
    },
    { id: "small-registry-artifact", passed: report?.unpackedSize > 0 && report.unpackedSize < 100_000 },
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
