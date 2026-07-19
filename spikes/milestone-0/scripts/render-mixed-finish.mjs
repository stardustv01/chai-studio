import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { isolatedChromiumExecutable } from "../../../scripts/browser-isolation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const serveUrl = await bundle({
  entryPoint: path.join(root, "fixtures", "remotion", "index.ts"),
  publicDir: path.join(root, "fixtures", "remotion", "public"),
});
const composition = await selectComposition({ serveUrl, id: "ChaiMixedFinish" });
const output = path.join(root, "evidence", "mixed-finish.mov");
await renderMedia({
  serveUrl,
  composition,
  outputLocation: output,
  codec: "h264",
  audioCodec: "pcm-16",
  imageFormat: "jpeg",
  browserExecutable: isolatedChromiumExecutable,
  concurrency: 2,
  overwrite: true,
});
const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" });
if (probe.status !== 0) throw new Error(probe.stderr);
const metadata = JSON.parse(probe.stdout);
const video = metadata.streams.find((stream) => stream.codec_type === "video");
const audio = metadata.streams.find((stream) => stream.codec_type === "audio");
const assertions = {
  dimensions: video?.width === 640 && video?.height === 360,
  rationalRate: video?.r_frame_rate === "30000/1001",
  centralAudioPresent: audio?.sample_rate === "48000",
  expectedVideoDuration: Math.abs(Number(video?.duration) - 10.01) < 0.000001,
  sampleExactEndpoint: Math.abs(Number(video?.duration) - Number(audio?.duration)) <= 1 / 48000,
};
const report = { passed: Object.values(assertions).every(Boolean), assertions, metadata };
await writeFile(path.join(root, "evidence", "mixed-finish-result.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, assertions }, null, 2));
if (!report.passed) process.exit(1);
