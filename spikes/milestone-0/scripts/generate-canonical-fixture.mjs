import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const assets = path.join(root, "fixtures", "canonical", "assets");
const sequence = path.join(assets, "alpha-sequence");
await mkdir(sequence, { recursive: true });

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed (${result.status}): ${result.stderr}`);
}

const duration = "10.01";
ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30000/1001:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(assets, "raw-video.mp4")]);
ffmpeg(["-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${duration}`, "-af", "volume=0.12", "-c:a", "pcm_s24le", path.join(assets, "voiceover.wav")]);
ffmpeg(["-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000:duration=${duration}`, "-af", "volume=0.04", "-c:a", "pcm_s24le", path.join(assets, "music.wav")]);
ffmpeg(["-i", path.join(assets, "voiceover.wav"), "-i", path.join(assets, "music.wav"), "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0", "-ar", "48000", "-c:a", "pcm_s24le", path.join(assets, "offline-mix.wav")]);
const alphaInput = "color=c=black@0.0:s=320x180:r=30000/1001:d=2,format=rgba,drawbox=x=120:y=60:w=80:h=60:color=0x8b5cf6@0.75:t=fill";
ffmpeg(["-f", "lavfi", "-i", alphaInput, "-c:v", "qtrle", "-pix_fmt", "argb", path.join(assets, "alpha-overlay.mov")]);
ffmpeg(["-f", "lavfi", "-i", alphaInput, "-frames:v", "60", path.join(sequence, "frame-%04d.png")]);
console.log(JSON.stringify({ generated: true, assets }, null, 2));
