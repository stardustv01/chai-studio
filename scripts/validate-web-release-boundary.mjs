import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirectory = path.join(root, "apps", "studio-web", "dist", "assets");
const scripts = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js"));
if (scripts.length === 0) throw new Error("Production web build contains no JavaScript asset.");
const source = (
  await Promise.all(scripts.map((name) => readFile(path.join(assetsDirectory, name), "utf8")))
).join("\n");

const forbidden = [
  "Sample checks passed",
  "sample-output",
  "clip-studio-future-title",
  "launch-film-r427",
  "Contract mock",
];
const leaked = forbidden.filter((value) => source.includes(value));
if (leaked.length > 0) {
  throw new Error(`Production web bundle contains UI fixture data: ${leaked.join(", ")}`);
}
for (const required of ["Launch Chai Studio from the CLI", "/api/v1/preview/program-frame"]) {
  if (!source.includes(required)) throw new Error(`Production web boundary is missing: ${required}`);
}
process.stdout.write(
  "Production web runtime excludes UI fixture data and retains fail-closed launch truth.\n",
);
