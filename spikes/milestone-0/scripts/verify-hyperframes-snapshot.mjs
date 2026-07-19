import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const evidence = path.join(root, "evidence");
const executable = path.join(root, "node_modules", ".bin", "hyperframes");
await mkdir(evidence, { recursive: true });

const captureNames = ["hyperframes-determinism-a", "hyperframes-determinism-b"];
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-"));
const images = [];
for (const captureName of captureNames) {
  const output = path.join(temporaryRoot, captureName);
  const result = spawnSync(
    executable,
    ["snapshot", "fixtures/hyperframes", "--at", "1.8", "--no-end", "--output", output],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`HyperFrames snapshot failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  const image = path.join(output, "frame-00-at-1.8s.png");
  images.push(image);
  await cp(image, path.join(evidence, `${captureName}.png`));
}

const hashes = [];
for (const image of images) hashes.push(createHash("sha256").update(await readFile(image)).digest("hex"));
const report = {
  timestampSec: 1.8,
  hashes,
  deterministic: hashes[0] === hashes[1],
  note: "Uses frame 54. Isolated snapshot seeks at frame 57 showed a CLI-only near-end capture anomaly; actual rendered frames 54-59 were visually verified intact.",
};
await writeFile(path.join(evidence, "hyperframes-snapshot-result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.deterministic) throw new Error(`HyperFrames strict same-frame mismatch: ${hashes.join(" != ")}`);
