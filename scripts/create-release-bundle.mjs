import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseBundle, validateReleaseBundle } from "./release-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageManifest.version;
const requestedOutput = option(process.argv.slice(2), "--output");
const sourceManifestPath = option(process.argv.slice(2), "--source-manifest");
const sourceManifest = sourceManifestPath
  ? JSON.parse(await readFile(path.resolve(root, sourceManifestPath), "utf8"))
  : null;
if (
  sourceManifest !== null &&
  (sourceManifest.schemaVersion !== "1.0.0" ||
    sourceManifest.product !== "Chai Studio" ||
    sourceManifest.version !== version ||
    sourceManifest.channel !== "release-candidate" ||
    typeof sourceManifest.sourceCommit !== "string")
) {
  throw new Error("Release bundle source manifest does not identify this exact release candidate.");
}
const destination = path.resolve(
  requestedOutput ?? path.join(root, "dist/releases", `chai-studio-${version}-darwin-arm64`),
);
const created = await createReleaseBundle({
  sourceRoot: root,
  destination,
  allowDirty: process.argv.includes("--allow-dirty"),
  sourceCommit: sourceManifest?.sourceCommit,
});
const validation = await validateReleaseBundle(destination);
if (!validation.passed) throw new Error("Created release bundle failed its own integrity validation.");
process.stdout.write(
  `${JSON.stringify(
    {
      passed: true,
      version: created.version,
      sourceCommit: created.sourceCommit,
      bundleIdentity: created.bundleIdentity,
      fileCount: created.entries.length,
      destination,
    },
    null,
    2,
  )}\n`,
);

function option(values, name) {
  const index = values.indexOf(name);
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a path.`);
  return value;
}
