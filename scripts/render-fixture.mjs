import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderStudioShellFixture } from "./fixture-template.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "fixtures/deterministic/studio-shell.json");
const goldenPath = path.join(root, "fixtures/goldens/studio-shell.svg");
const manifestPath = path.join(root, "fixtures/goldens/checksum-manifest.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const rendered = renderStudioShellFixture(fixture);

if (process.argv.includes("--update")) {
  await mkdir(path.dirname(goldenPath), { recursive: true });
  await writeFile(goldenPath, rendered);
  const currentManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = {
    version: 1,
    algorithm: "sha256",
    files: {
      ...currentManifest.files,
      "fixtures/deterministic/studio-shell.json": sha(await readFile(fixturePath)),
      "fixtures/goldens/studio-shell.svg": sha(rendered),
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("Updated deterministic studio-shell golden and checksum manifest.");
} else if (process.argv.includes("--check")) {
  const current = await readFile(goldenPath, "utf8");
  if (current !== rendered)
    throw new Error("Golden render drifted. Use pnpm fixture:update only with explicit review.");
  console.log("Deterministic fixture render matches the reviewed golden.");
} else {
  throw new Error("Use --update or --check.");
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
