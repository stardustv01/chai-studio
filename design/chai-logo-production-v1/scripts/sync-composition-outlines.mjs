import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function parsePaths(filename) {
  const source = fs.readFileSync(path.join(root, "masters", filename), "utf8");
  return [...source.matchAll(/<g id="glyph-0-(\d+)">\s*<path d="([^"]+)"\/>/g)]
    .map((match) => ({ index: Number(match[1]), d: match[2] }));
}

function synchronize(filename) {
  const targetPath = path.join(root, filename);
  let html = fs.readFileSync(targetPath, "utf8");

  const sources = [
    { prefix: "devanagari", paths: parsePaths("chai-outline-regular-source.svg") },
    { prefix: "english", paths: parsePaths("english-regular-outline-source.svg") },
  ];

  for (const { prefix, paths } of sources) {
    for (const { index, d } of paths) {
      const pattern = new RegExp(`(<path id="${prefix}-glyph-${index}" d=")[^"]+("/>)`);
      if (!pattern.test(html)) {
        throw new Error(`Missing ${prefix}-glyph-${index} in ${filename}`);
      }
      html = html.replace(pattern, `$1${d}$2`);
    }
  }

  fs.writeFileSync(targetPath, html);
}

synchronize("index.html");
synchronize("compositions/index.html");
console.log("Synchronized Regular primary and companion outlines into both compositions.");
