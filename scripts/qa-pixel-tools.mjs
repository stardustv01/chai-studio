import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let sharpPromise;

const loadSharp = async () => {
  if (sharpPromise !== undefined) return sharpPromise;
  sharpPromise = (async () => {
    const pnpmRoot = path.join(root, "node_modules", ".pnpm");
    const directory = (await readdir(pnpmRoot)).find((name) => name.startsWith("sharp@"));
    if (directory === undefined) throw new Error("The frozen workspace has no Sharp runtime for pixel QA.");
    const modulePath = path.join(pnpmRoot, directory, "node_modules", "sharp", "lib", "index.js");
    return (await import(pathToFileURL(modulePath).href)).default;
  })();
  return sharpPromise;
};

const srgbToLinear8 = (value) => {
  const normalized = value / 255;
  const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  return Math.round(Math.min(1, Math.max(0, linear)) * 255);
};

export const normalizedPixels = async (filePath, dimensions = null) => {
  const sharp = await loadSharp();
  let pipeline = sharp(filePath, { failOn: "error" }).rotate();
  if (dimensions !== null) {
    pipeline = pipeline.resize(dimensions.width, dimensions.height, { fit: "fill", kernel: "lanczos3" });
  }
  const { data, info } = await pipeline
    .toColourspace("srgb")
    .ensureAlpha()
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  const normalized = Buffer.from(data);
  for (let index = 0; index < normalized.length; index += 4) {
    normalized[index] = srgbToLinear8(normalized[index] ?? 0);
    normalized[index + 1] = srgbToLinear8(normalized[index + 1] ?? 0);
    normalized[index + 2] = srgbToLinear8(normalized[index + 2] ?? 0);
  }
  return { data: normalized, width: info.width, height: info.height };
};

export const normalizedPixelHash = async (filePath) => {
  const pixels = await normalizedPixels(filePath);
  return createHash("sha256")
    .update("rgba8-linear-rec709-v1\0", "utf8")
    .update(`${String(pixels.width)}x${String(pixels.height)}\0`, "utf8")
    .update(pixels.data)
    .digest("hex");
};

export const normalizedRmse = async (leftPath, rightPath, dimensions) => {
  const [left, right] = await Promise.all([
    normalizedPixels(leftPath, dimensions),
    normalizedPixels(rightPath, dimensions),
  ]);
  if (left.data.length !== right.data.length)
    throw new Error("Normalized comparison buffers differ in size.");
  let sum = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    const delta = (left.data[index] ?? 0) - (right.data[index] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum / left.data.length) / 255;
};

export const sourceEvidenceHash = async (...filePaths) => {
  const hash = createHash("sha256").update("chai-qa-source-evidence-v1\0", "utf8");
  for (const filePath of filePaths) hash.update(await readFile(filePath));
  return hash.digest("hex");
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, ...values] = process.argv.slice(2);
  if (operation === "hash") {
    const results = await Promise.all(
      values.map(async (value) => ({
        path: value,
        hash: await normalizedPixelHash(path.resolve(root, value)),
      })),
    );
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else if (operation === "compare" && values.length === 2) {
    const [left, right] = values;
    const dimensions = { width: 960, height: 540 };
    process.stdout.write(
      `${JSON.stringify(
        {
          left,
          right,
          dimensions,
          normalizedRmse: await normalizedRmse(
            path.resolve(root, left),
            path.resolve(root, right),
            dimensions,
          ),
          evidenceHash: await sourceEvidenceHash(path.resolve(root, left), path.resolve(root, right)),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    throw new Error("Usage: qa-pixel-tools.mjs hash <paths...> | compare <left> <right>");
  }
}
