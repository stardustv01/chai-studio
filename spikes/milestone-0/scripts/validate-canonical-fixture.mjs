import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const fixtureRoot = path.join(root, "fixtures", "canonical");
const fixture = JSON.parse(await readFile(path.join(fixtureRoot, "fixture.json"), "utf8"));

function probe(relativePath) {
  const absolutePath = path.join(fixtureRoot, relativePath);
  const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", absolutePath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${relativePath}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const media = {
  rawVideo: probe(fixture.assets.rawVideo),
  voiceover: probe(fixture.assets.voiceover),
  music: probe(fixture.assets.music),
  offlineMix: probe(fixture.assets.offlineMix),
  alphaVideo: probe(fixture.assets.alphaVideo),
};
const alphaFrames = (await readdir(path.join(fixtureRoot, fixture.assets.alphaSequence))).filter((name) => name.endsWith(".png"));
const assertions = {
  timelineRate: media.rawVideo.streams[0].r_frame_rate === "30000/1001",
  audioSampleRates: [media.voiceover, media.music, media.offlineMix].every((item) => item.streams[0].sample_rate === "48000"),
  alphaPixelFormat: media.alphaVideo.streams[0].pix_fmt === "argb",
  alphaSequenceFrames: alphaFrames.length === 60,
};
const files = Object.values(fixture.assets).filter((value) => !value.endsWith("alpha-sequence"));
const hashes = {};
for (const relativePath of files) hashes[relativePath] = createHash("sha256").update(await readFile(path.join(fixtureRoot, relativePath))).digest("hex");
const report = { fixture: fixture.name, passed: Object.values(assertions).every(Boolean), assertions, hashes, media };
await writeFile(path.join(root, "evidence", "canonical-fixture-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ fixture: report.fixture, passed: report.passed, assertions }, null, 2));
if (!report.passed) process.exit(1);
