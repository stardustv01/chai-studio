import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, hashTree, sha256File } from "./release-operations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "evidence/p27/release-manifest.json");
await mkdir(path.dirname(output), { recursive: true });
const check = process.argv.includes("--check");
const exactFiles = [
  "package.json",
  "pnpm-lock.yaml",
  ".node-version",
  "governance/execution-baseline.json",
  "governance/licenses/dependency-inventory.json",
  "governance/licenses/release-review.json",
  "evidence/p26/gate-report.json",
];
const trees = [
  "apps/studio-server/dist",
  "apps/studio-web/dist",
  "packages/audio/dist",
  "packages/bridge/dist",
  "packages/captions/dist",
  "packages/diagnostics/dist",
  "packages/engine-adapters/dist",
  "packages/media/dist",
  "packages/preview/dist",
  "packages/qa/dist",
  "packages/render/dist",
  "packages/review/dist",
  "packages/schema/dist",
  "packages/security/dist",
  "packages/timeline/dist",
];
const files = [];
for (const file of exactFiles) {
  files.push({
    path: file,
    bytes: (await readFile(path.join(root, file))).byteLength,
    sha256: await sha256File(path.join(root, file)),
  });
}
for (const tree of trees) {
  const entries = await hashTree(path.join(root, tree));
  files.push(...entries.map((entry) => ({ ...entry, path: path.posix.join(tree, entry.path) })));
}
files.sort((left, right) => left.path.localeCompare(right.path, "en"));
const p26 = JSON.parse(await readFile(path.join(root, "evidence/p26/gate-report.json"), "utf8"));
const payload = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: "1.0.0-rc.1",
  channel: "release-candidate",
  sourceDate: process.env.SOURCE_DATE_EPOCH ?? "2026-07-16T00:00:00.000Z",
  launchModel: "localhost-web-server",
  supportClass: "apple-m4-16gb",
  dependencyLockSha256: await sha256File(path.join(root, "pnpm-lock.yaml")),
  acceptedGate: {
    phase: "P26",
    identity: p26.identity,
    reportSha256: await sha256File(path.join(root, "evidence/p26/gate-report.json")),
  },
  licenseInventorySha256: await sha256File(path.join(root, "governance/licenses/dependency-inventory.json")),
  files,
  signature: {
    status: "not-required-personal-local",
    policy:
      "Checksums and gate identity are authoritative until public distribution or a desktop wrapper requires platform signing.",
  },
};
const manifest = {
  ...payload,
  manifestIdentity: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
if (check) {
  const existing = await readFile(output, "utf8").catch(() => "");
  if (existing !== serialized) {
    console.error("P27 release manifest is missing or stale.");
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        { passed: true, manifestIdentity: manifest.manifestIdentity, fileCount: files.length },
        null,
        2,
      ),
    );
  }
} else {
  await writeFile(output, serialized);
  console.log(
    JSON.stringify(
      { passed: true, manifestIdentity: manifest.manifestIdentity, fileCount: files.length },
      null,
      2,
    ),
  );
}
