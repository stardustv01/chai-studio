import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { isolatedChromiumExecutable } from "../../../scripts/browser-isolation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-native-still-benchmark-"));
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

const hyperframesDurationsMs = [];
const hyperframesHashes = [];
for (let index = 0; index < 5; index += 1) {
  const output = path.join(temporaryRoot, `hyperframes-${index}`);
  const started = performance.now();
  const result = spawnSync(
    path.join(root, "node_modules", ".bin", "hyperframes"),
    ["snapshot", "fixtures/hyperframes", "--at", "1.8", "--no-end", "--output", output],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  hyperframesDurationsMs.push(performance.now() - started);
  if (result.status !== 0) throw new Error(`HyperFrames benchmark failed: ${result.stderr}`);
  hyperframesHashes.push(await sha256(path.join(output, "frame-00-at-1.8s.png")));
}

const remotionStarted = performance.now();
const serveUrl = await bundle({ entryPoint: path.join(root, "fixtures", "remotion", "index.ts") });
const composition = await selectComposition({ serveUrl, id: "ChaiMilestone0" });
const remotionSetupMs = performance.now() - remotionStarted;
const remotionDurationsMs = [];
const remotionHashes = [];
for (let index = 0; index < 5; index += 1) {
  const output = path.join(temporaryRoot, `remotion-${index}.png`);
  const started = performance.now();
  await renderStill({
    serveUrl,
    composition,
    output,
    frame: 30,
    browserExecutable: isolatedChromiumExecutable,
    imageFormat: "png",
  });
  remotionDurationsMs.push(performance.now() - started);
  remotionHashes.push(await sha256(output));
}

const allEqual = (values) => new Set(values).size === 1;
const report = {
  generatedAt: new Date().toISOString(),
  sampleCountPerEngine: 5,
  hyperframes: {
    durationsMs: hyperframesDurationsMs,
    p95Ms: percentile(hyperframesDurationsMs, 0.95),
    deterministic: allEqual(hyperframesHashes),
    hashes: hyperframesHashes,
    measurement: "independent CLI process and browser launch per sample",
  },
  remotion: {
    setupMs: remotionSetupMs,
    durationsMs: remotionDurationsMs,
    p95Ms: percentile(remotionDurationsMs, 0.95),
    deterministic: allEqual(remotionHashes),
    hashes: remotionHashes,
    measurement: "one bundle/serve setup followed by five independent still renders",
  },
};
report.passed = report.hyperframes.deterministic && report.remotion.deterministic && report.hyperframes.p95Ms <= 5000 && report.remotion.p95Ms <= 5000;
await writeFile(path.join(root, "evidence", "native-still-benchmark.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(1);
