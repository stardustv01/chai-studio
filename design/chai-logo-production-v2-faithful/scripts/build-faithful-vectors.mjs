import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import potracePackage from "potrace";

const { trace } = potracePackage;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maskRoot = path.join(root, "work", "masks");
const masterRoot = path.join(root, "masters");

const palette = {
  midnight: "#070A12",
  ivory: "#F5EFE2",
  amber: "#F2B33F",
  cyan: "#19D9EA",
};

await fs.mkdir(masterRoot, { recursive: true });

function traceSvg(file, options = {}) {
  return new Promise((resolve, reject) => {
    trace(
      file,
      {
        threshold: 128,
        turdSize: 3,
        optCurve: true,
        alphaMax: 1,
        optTolerance: 0.16,
        color: "#000000",
        background: "transparent",
        ...options,
      },
      (error, svg) => (error ? reject(error) : resolve(svg)),
    );
  });
}

async function tracedGroup(filename, id, fill) {
  const svg = await traceSvg(path.join(maskRoot, filename));
  const groupMatch = svg.match(/<g\s+([^>]*)>([\s\S]*?)<\/g>/);
  if (groupMatch) {
    const attrs = groupMatch[1]
      .replace(/fill="[^"]*"/, `fill="${fill}"`)
      .replace(/stroke="[^"]*"/, 'stroke="none"');
    return `<g id="${id}" ${attrs}>${groupMatch[2]}</g>`;
  }
  const pathMatch = svg.match(/<path\s+([\s\S]*?)\/>/);
  if (!pathMatch) throw new Error(`No traced path found in ${filename}`);
  const pathAttrs = pathMatch[1]
    .replace(/fill="[^"]*"/, `fill="${fill}"`)
    .replace(/stroke="[^"]*"/, 'stroke="none"');
  return `<g id="${id}"><path ${pathAttrs}/></g>`;
}

const [timeline, first, rest, english, amber, cyan, iconIvory, iconAmber, iconCyan] =
  await Promise.all([
    tracedGroup("primary-timeline.png", "timeline-layer", palette.ivory),
    tracedGroup("primary-first.png", "first-symbol-layer", palette.ivory),
    tracedGroup("primary-rest.png", "rest-symbol-layer", palette.ivory),
    tracedGroup("primary-english.png", "english-layer", palette.ivory),
    tracedGroup("primary-amber.png", "amber-layer", palette.amber),
    tracedGroup("primary-cyan.png", "cyan-layer", palette.cyan),
    tracedGroup("icon-ivory.png", "icon-ivory-layer", palette.ivory),
    tracedGroup("icon-amber.png", "icon-amber-layer", palette.amber),
    tracedGroup("icon-cyan.png", "icon-cyan-layer", palette.cyan),
  ]);

const xml = `<?xml version="1.0" encoding="UTF-8"?>`;
const accessible = (title, desc) =>
  `<title id="title">${title}</title><desc id="desc">${desc}</desc>`;
const svgOpen = (viewBox, title, desc) =>
  `${xml}\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title desc" shape-rendering="geometricPrecision">\n  ${accessible(title, desc)}`;

const write = (name, value) => fs.writeFile(path.join(masterRoot, name), `${value}\n`, "utf8");

await Promise.all([
  write(
    "chai-lockup-color.svg",
    `${svgOpen("0 0 600 360", "Chai Studio approved lockup", "Faithful vector reconstruction of the approved Balanced Hybrid artwork")}\n${timeline}\n${first}\n${rest}\n${amber}\n${cyan}\n${english}\n</svg>`,
  ),
  write(
    "chai-wordmark-color.svg",
    `${svgOpen("0 0 600 270", "Chai approved wordmark", "Custom Devanagari Warm Timeline wordmark")}\n${timeline}\n${first}\n${rest}\n${amber}\n${cyan}\n</svg>`,
  ),
  write(
    "chai-symbol-color.svg",
    `${svgOpen("0 0 512 512", "Chai approved compact symbol", "Custom compact Chai symbol without a tile")}\n${iconIvory}\n${iconAmber}\n${iconCyan}\n</svg>`,
  ),
  write(
    "chai-app-icon.svg",
    `${svgOpen("0 0 512 512", "Chai Studio app icon", "Approved compact symbol on the midnight application tile")}\n  <rect x="82" y="42" width="380" height="420" rx="74" fill="${palette.midnight}" stroke="#1B2231" stroke-width="4"/>\n${iconIvory}\n${iconAmber}\n${iconCyan}\n</svg>`,
  ),
  write(
    "chai-lockup-mono.svg",
    `${svgOpen("0 0 600 360", "Chai Studio monochrome lockup", "One-colour faithful lockup")}\n  <g fill="currentColor">\n${timeline.replaceAll(palette.ivory, "currentColor")}\n${first.replaceAll(palette.ivory, "currentColor")}\n${rest.replaceAll(palette.ivory, "currentColor")}\n${amber.replaceAll(palette.amber, "currentColor")}\n${cyan.replaceAll(palette.cyan, "currentColor")}\n${english.replaceAll(palette.ivory, "currentColor")}\n  </g>\n</svg>`,
  ),
  write(
    "chai-symbol-mono.svg",
    `${svgOpen("0 0 512 512", "Chai monochrome compact symbol", "One-colour faithful compact symbol")}\n  <g fill="currentColor">\n${iconIvory.replaceAll(palette.ivory, "currentColor")}\n${iconAmber.replaceAll(palette.amber, "currentColor")}\n${iconCyan.replaceAll(palette.cyan, "currentColor")}\n  </g>\n</svg>`,
  ),
]);

await fs.writeFile(
  path.join(root, "work", "layers.json"),
  JSON.stringify({ timeline, first, rest, english, amber, cyan }, null, 2),
  "utf8",
);
