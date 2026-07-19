import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "fixtures/goldens/checksum-manifest.json"), "utf8"),
);
const mismatches = [];
const snapshotFiles = await discoverSnapshotFiles(path.join(root, "tests", "e2e"));
const manifestSnapshotFiles = Object.keys(manifest.files)
  .filter((file) => file.includes("-snapshots/") && file.endsWith(".png"))
  .sort();
const missing = snapshotFiles.filter((file) => manifest.files[file] === undefined);
const stale = manifestSnapshotFiles.filter((file) => !snapshotFiles.includes(file));
for (const [relativePath, expected] of Object.entries(manifest.files)) {
  const actual = createHash("sha256")
    .update(await readFile(path.join(root, relativePath)))
    .digest("hex");
  if (actual !== expected) mismatches.push({ relativePath, expected, actual });
}
console.log(
  JSON.stringify(
    {
      passed: mismatches.length === 0 && missing.length === 0 && stale.length === 0,
      checked: Object.keys(manifest.files).length,
      reviewedUiGoldens: snapshotFiles.length,
      missing,
      stale,
      mismatches,
    },
    null,
    2,
  ),
);
if (mismatches.length > 0 || missing.length > 0 || stale.length > 0) process.exitCode = 1;

async function discoverSnapshotFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await discoverSnapshotFiles(absolute)));
    else if (entry.isFile() && entry.name.endsWith(".png") && directory.endsWith("-snapshots")) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}
