import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const vendor = path.join(root, "fixtures/hyperframes/vendor");
await mkdir(vendor, { recursive: true });
await copyFile(path.join(root, "node_modules/gsap/dist/gsap.min.js"), path.join(vendor, "gsap.min.js"));
console.log("Prepared pinned HyperFrames fixture dependencies.");
