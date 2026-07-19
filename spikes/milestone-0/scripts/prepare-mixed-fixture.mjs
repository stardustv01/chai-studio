import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const publicDir = path.join(root, "fixtures", "remotion", "public");
const canonical = path.join(root, "fixtures", "canonical");
await mkdir(publicDir, { recursive: true });

const copies = [
  [path.join(canonical, "assets", "raw-video.mp4"), path.join(publicDir, "raw-video.mp4")],
  [path.join(canonical, "assets", "offline-mix.wav"), path.join(publicDir, "offline-mix.wav")],
  [path.join(canonical, "assets", "alpha-overlay.mov"), path.join(publicDir, "alpha-overlay.mov")],
  [path.join(canonical, "assets", "alpha-sequence"), path.join(publicDir, "alpha-sequence")],
  [path.join(canonical, "fixture-image.svg"), path.join(publicDir, "fixture-image.svg")],
  [path.join(root, "evidence", "hyperframes-fixture.mp4"), path.join(publicDir, "hyperframes-fixture.mp4")],
];
for (const [source, destination] of copies) await cp(source, destination, { recursive: true });
console.log(JSON.stringify({ prepared: true, publicDir }, null, 2));
