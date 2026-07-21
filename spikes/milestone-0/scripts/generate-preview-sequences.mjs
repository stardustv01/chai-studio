import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition } from "@remotion/renderer";
import {
  isolatedChromiumExecutable,
  isolatedEngineExecutable,
} from "../../../scripts/browser-isolation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const assetsRoot = path.join(root, "fixtures", "preview", "assets");
const remotionOutput = path.join(assetsRoot, "remotion");
const hyperframesOutput = path.join(assetsRoot, "hyperframes");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-preview-sequences-"));
const remotionTemporary = path.join(temporaryRoot, "remotion");
const hyperframesTemporary = path.join(temporaryRoot, "hyperframes");
await mkdir(remotionTemporary, {recursive: true});
await mkdir(remotionOutput, {recursive: true});
await mkdir(hyperframesOutput, {recursive: true});

const serveUrl = await bundle({entryPoint: path.join(root, "fixtures", "remotion", "index.ts")});
const composition = await selectComposition({serveUrl, id: "ChaiMilestone0"});
await renderFrames({
  serveUrl,
  composition,
  outputDir: remotionTemporary,
  frameRange: [0, 59],
  imageFormat: "png",
  imageSequencePattern: "frame-[frame].[ext]",
  inputProps: {},
  onStart: () => {},
  onFrameUpdate: () => {},
  browserExecutable: isolatedChromiumExecutable,
  concurrency: 2,
  logLevel: "error",
});

const hyperframes = spawnSync(
  path.join(root, "node_modules", ".bin", "hyperframes"),
  [
    "render",
    "fixtures/hyperframes",
    "--output",
    hyperframesTemporary,
    "--format",
    "png-sequence",
    "--quality",
    "draft",
    "--strict",
    "--no-browser-gpu",
    "--workers",
    "1",
    "--quiet",
  ],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      HYPERFRAMES_BROWSER_PATH: isolatedEngineExecutable,
      HYPERFRAMES_NO_TELEMETRY: "1",
      HYPERFRAMES_SKIP_SKILLS: "1",
    },
  },
);
if (hyperframes.status !== 0) throw new Error(`HyperFrames PNG sequence failed: ${hyperframes.stdout}\n${hyperframes.stderr}`);

const findPngs = async (directoryPath) => {
  const found = [];
  for (const entry of await readdir(directoryPath, {withFileTypes: true})) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) found.push(...await findPngs(entryPath));
    else if (entry.name.endsWith(".png")) found.push(entryPath);
  }
  return found.sort();
};
const remotionFrames = await findPngs(remotionTemporary);
const hyperframesFrames = await findPngs(hyperframesTemporary);
if (remotionFrames.length !== 60 || hyperframesFrames.length !== 60) {
  throw new Error(`expected 60 frames per engine, received Remotion=${remotionFrames.length}, HyperFrames=${hyperframesFrames.length}`);
}

const normalize = async (frames, outputDirectory) => {
  const manifest = [];
  for (let index = 0; index < frames.length; index += 1) {
    const name = `frame-${String(index).padStart(2, "0")}.png`;
    const destination = path.join(outputDirectory, name);
    await cp(frames[index], destination);
    manifest.push({frame: index, path: `assets/${path.basename(outputDirectory)}/${name}`, sha256: createHash("sha256").update(await readFile(destination)).digest("hex")});
  }
  return manifest;
};
const manifest = {
  generatedAt: new Date().toISOString(),
  frameCount: 60,
  fps: {num: 30, den: 1},
  remotion: await normalize(remotionFrames, remotionOutput),
  hyperframes: await normalize(hyperframesFrames, hyperframesOutput),
};
manifest.identity = createHash("sha256").update(JSON.stringify({fps: manifest.fps, remotion: manifest.remotion, hyperframes: manifest.hyperframes})).digest("hex");
await writeFile(path.join(root, "fixtures", "preview", "proxy-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({generated: true, identity: manifest.identity, remotionFrames: manifest.remotion.length, hyperframesFrames: manifest.hyperframes.length}, null, 2));
