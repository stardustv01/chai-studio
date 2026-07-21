import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCliReleaseIndex } from "./cli-release-index.mjs";

const values = process.argv.slice(2);
const archiveReceiptPath = requiredOption(values, "--archive-receipt");
const archiveUrl = requiredOption(values, "--archive-url");
const privateKeyPath = requiredOption(values, "--private-key");
const output = path.resolve(requiredOption(values, "--output"));
const p27ManifestPath = path.resolve(
  option(values, "--p27-manifest") ?? "evidence/p27/release-manifest.json",
);
const finalManifestPath = path.resolve(
  option(values, "--final-manifest") ?? "evidence/p28/version-1-manifest.json",
);
const releaseReceiptPath = path.resolve(
  option(values, "--release-receipt") ?? "evidence/p28/version-1-release-receipt.json",
);
const publicKeyPath = path.resolve(
  option(values, "--public-key") ?? "evidence/p28/version-1-release-public-key.pem",
);
if (await exists(output)) throw new Error(`Release index destination already exists: ${output}`);

const index = buildCliReleaseIndex({
  archiveReceipt: await readJson(archiveReceiptPath),
  p27Manifest: await readJson(p27ManifestPath),
  finalManifest: await readJson(finalManifestPath),
  releaseReceipt: await readJson(releaseReceiptPath),
  publicKeyPem: await readFile(publicKeyPath, "utf8"),
  privateKeyPem: await readFile(path.resolve(privateKeyPath), "utf8"),
  archiveUrl,
  keyId: option(values, "--key-id") ?? "chai-studio-v1",
});
const temporary = `${output}.tmp-${String(process.pid)}`;
await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { flag: "wx" });
await rename(temporary, output);
process.stdout.write(
  `${JSON.stringify({ generated: true, output, version: index.latest, releases: index.releases.length }, null, 2)}\n`,
);

function option(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index < 0) return undefined;
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function requiredOption(arguments_, name) {
  const value = option(arguments_, name);
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

function readJson(file) {
  return readFile(path.resolve(file), "utf8").then((content) => JSON.parse(content));
}

function exists(candidate) {
  return stat(candidate)
    .then(() => true)
    .catch(() => false);
}
