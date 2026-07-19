import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { isolatedChromiumExecutable } from "../../../scripts/browser-isolation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const evidence = path.join(root, "evidence");
await mkdir(evidence, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(root, "fixtures/remotion/index.ts") });
const composition = await selectComposition({ serveUrl, id: "ChaiMilestone0" });
const outputs = [path.join(evidence, "remotion-frame-30-a.png"), path.join(evidence, "remotion-frame-30-b.png")];
for (const output of outputs) {
  await renderStill({
    serveUrl,
    composition,
    output,
    frame: 30,
    browserExecutable: isolatedChromiumExecutable,
    imageFormat: "png",
  });
}
const hashes = [];
for (const output of outputs) hashes.push(createHash("sha256").update(await readFile(output)).digest("hex"));
if (hashes[0] !== hashes[1]) throw new Error(`Remotion strict same-frame mismatch: ${hashes.join(" != ")}`);
await writeFile(path.join(evidence, "remotion-still-result.json"), `${JSON.stringify({ composition, frame: 30, hashes, deterministic: true }, null, 2)}\n`);
console.log(JSON.stringify({ deterministic: true, frame: 30, hash: hashes[0] }, null, 2));
