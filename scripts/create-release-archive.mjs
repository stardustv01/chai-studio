import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { validateReleaseBundle } from "./release-bundle.mjs";

const execFileAsync = promisify(execFile);
const input = process.argv[2];
if (input === undefined) {
  throw new Error("Usage: create-release-archive.mjs BUNDLE_PATH [ARCHIVE_PATH]");
}
const bundle = path.resolve(input);
const validation = await validateReleaseBundle(bundle);
if (!validation.passed) throw new Error("Release archive refused an invalid bundle.");
const archive = path.resolve(process.argv[3] ?? `${bundle}.tar.gz`);
const temporaryTar = `${archive.slice(0, archive.endsWith(".gz") ? -3 : archive.length)}.tmp.tar`;
const temporaryGzip = `${temporaryTar}.gz`;
for (const candidate of [archive, temporaryTar, temporaryGzip]) {
  if (await exists(candidate)) throw new Error(`Release archive destination already exists: ${candidate}`);
}
await execFileAsync("tar", ["-cf", temporaryTar, "-C", path.dirname(bundle), path.basename(bundle)], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
await execFileAsync("gzip", ["-n", temporaryTar]);
await rename(temporaryGzip, archive);
const archiveSha256 = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
const receipt = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: validation.marker.version,
  sourceCommit: validation.marker.sourceCommit,
  bundleIdentity: validation.actualIdentity,
  archive: path.basename(archive),
  bytes: (await stat(archive)).size,
  sha256: archiveSha256,
  releaseAuthorized: false,
};
await writeFile(`${archive}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(`${archive}.sha256`, `${archiveSha256}  ${path.basename(archive)}\n`);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);

async function exists(candidate) {
  return stat(candidate)
    .then(() => true)
    .catch(() => false);
}
