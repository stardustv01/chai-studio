import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEnvironmentFingerprints } from "../src/environment.mjs";
import { isolatedChromiumExecutable } from "../../../scripts/browser-isolation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const evidence = path.join(root, "evidence");
await mkdir(evidence, { recursive: true });
const firstLine = (command, args) => execFileSync(command, args, { encoding: "utf8" }).split(/\r?\n/)[0];
const manifest = {
  platform: process.platform,
  architecture: process.arch,
  osRelease: os.release(),
  cpuModel: os.cpus()[0]?.model ?? "unknown",
  totalMemoryBytes: os.totalmem(),
  node: process.version,
  pnpm: firstLine("corepack", ["pnpm", "--version"]),
  ffmpeg: firstLine("ffmpeg", ["-version"]),
  ffprobe: firstLine("ffprobe", ["-version"]),
  chrome: firstLine(isolatedChromiumExecutable, ["--version"]),
  remotion: "4.0.489",
  hyperframes: "0.7.58",
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  lockfileSha256: createHash("sha256").update(await readFile(path.join(root, "pnpm-lock.yaml"))).digest("hex")
};
const result = buildEnvironmentFingerprints(manifest);
await writeFile(path.join(evidence, "environment.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
