import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateReleaseBundle } from "./release-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const bundle = path.resolve(
  process.argv[2] ?? path.join(root, "dist/releases", `chai-studio-${packageManifest.version}-darwin-arm64`),
);
const report = await validateReleaseBundle(bundle);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
