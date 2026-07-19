import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvalIdentity, assertOwnerApproval } from "./release-approval.mjs";
import { canonicalJson, hashTree, sha256File } from "./release-operations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "evidence/p28/version-1-manifest.json");
const check = process.argv.includes("--check");
const approval = assertOwnerApproval(
  JSON.parse(await readFile(path.join(root, "governance/V1_OWNER_APPROVAL.json"), "utf8")),
);
const packageManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseSource = await readFile(path.join(root, "packages/diagnostics/src/release.ts"), "utf8");
if (packageManifest.version !== "1.0.0" || !releaseSource.includes('version: "1.0.0"')) {
  throw new Error("Version 1 source identity must be finalized before manifest generation.");
}
const exactFiles = [
  "package.json",
  "pnpm-lock.yaml",
  ".node-version",
  "packages/diagnostics/src/release.ts",
  "governance/V1_OWNER_APPROVAL.json",
  "governance/execution-baseline.json",
  "governance/licenses/dependency-inventory.json",
  "governance/licenses/release-review.json",
  "evidence/p27/release-manifest.json",
  "evidence/p28-tech/gate-report.json",
  "evidence/p28/traceability-matrix.json",
  "docs/KNOWN_LIMITATIONS_V1.md",
  "docs/OPERATIONAL_HANDOFF_V1.md",
];
const trees = [
  "apps/studio-server/dist",
  "apps/studio-web/dist",
  ...[
    "audio",
    "bridge",
    "captions",
    "diagnostics",
    "engine-adapters",
    "media",
    "preview",
    "qa",
    "render",
    "review",
    "schema",
    "security",
    "timeline",
  ].map((name) => `packages/${name}/dist`),
];
const files = [];
for (const file of exactFiles) {
  const bytes = await readFile(path.join(root, file));
  files.push({ path: file, bytes: bytes.byteLength, sha256: await sha256File(path.join(root, file)) });
}
for (const tree of trees) {
  const entries = await hashTree(path.join(root, tree));
  files.push(...entries.map((entry) => ({ ...entry, path: path.posix.join(tree, entry.path) })));
}
files.sort((left, right) => left.path.localeCompare(right.path, "en"));
const payload = {
  schemaVersion: "1.0.0",
  product: "Chai Studio",
  version: "1.0.0",
  releaseTag: "v1.0.0",
  supportClass: "apple-m4-16gb",
  launchModel: "localhost-web-server",
  approvalIdentity: approvalIdentity(approval),
  dependencyLockSha256: await sha256File(path.join(root, "pnpm-lock.yaml")),
  files,
  releaseAuthorized: false,
  authorizationSource: "owner-signed Version 1 receipt",
};
const manifest = {
  ...payload,
  manifestIdentity: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
await mkdir(path.dirname(output), { recursive: true });
if (check) {
  const existing = await readFile(output, "utf8").catch(() => "");
  if (existing !== serialized) {
    console.error("Version 1 manifest is missing or stale.");
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({ passed: true, identity: manifest.manifestIdentity, files: files.length }, null, 2),
    );
  }
} else {
  await writeFile(output, serialized);
  console.log(
    JSON.stringify({ passed: true, identity: manifest.manifestIdentity, files: files.length }, null, 2),
  );
}
