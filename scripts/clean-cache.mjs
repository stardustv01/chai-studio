import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const removableNames = new Set([
  "dist",
  "dist-types",
  "test-results",
  "playwright-report",
  "reports",
  ".vite",
]);
let removed = 0;
await clean(root, 0);
console.log(`Removed ${removed} regenerable cache/build directories.`);

async function clean(directory, depth) {
  if (
    depth > 4 ||
    directory.includes(`${path.sep}node_modules${path.sep}`) ||
    directory.includes(`${path.sep}spikes${path.sep}`)
  )
    return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    if (removableNames.has(entry.name)) {
      await rm(target, { recursive: true, force: true });
      removed += 1;
    } else if (entry.name !== "node_modules" && entry.name !== "spikes") {
      await clean(target, depth + 1);
    }
  }
}
