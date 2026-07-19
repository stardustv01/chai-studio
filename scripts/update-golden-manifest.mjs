import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "fixtures", "goldens", "checksum-manifest.json");
if (!process.argv.includes("--write")) throw new Error("Use --write after explicit visual review.");
const current = JSON.parse(await readFile(manifestPath, "utf8"));
const coreFiles = Object.keys(current.files).filter((file) => !file.includes("-snapshots/"));
const snapshotFiles = await discoverSnapshotFiles(path.join(root, "tests", "e2e"));
const files = {};
for (const relativePath of [...coreFiles, ...snapshotFiles].sort()) {
  files[relativePath] = createHash("sha256")
    .update(await readFile(path.join(root, relativePath)))
    .digest("hex");
}
await writeFile(manifestPath, `${JSON.stringify({ version: 1, algorithm: "sha256", files }, null, 2)}\n`);
console.log(`Reviewed golden manifest now governs ${String(snapshotFiles.length)} Playwright PNGs.`);

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
