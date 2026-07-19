import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mastersDir = path.join(root, "masters");

const palette = {
  ink: "#070A12",
  ivory: "#F5EFE2",
  amber: "#F2B33F",
  cyan: "#19D9EA",
  mono: "#111827",
};

function readOutline(filename) {
  const source = fs.readFileSync(path.join(mastersDir, filename), "utf8");
  const paths = [...source.matchAll(/<g id="glyph-0-(\d+)">\s*<path d="([^"]+)"\/>/g)].map((match) => ({
    index: Number(match[1]),
    d: match[2],
  }));
  const uses = [...source.matchAll(/<use xlink:href="#glyph-0-(\d+)" x="([^"]+)" y="([^"]+)"\/>/g)].map(
    (match) => ({ index: Number(match[1]), x: Number(match[2]), y: Number(match[3]) }),
  );

  if (!paths.length || !uses.length) {
    throw new Error(`Could not parse glyph geometry from ${filename}`);
  }

  return { paths, uses };
}

function glyphDefs(prefix, outline) {
  return outline.paths.map(({ index, d }) => `<path id="${prefix}-glyph-${index}" d="${d}"/>`).join("\n");
}

function glyphUses(prefix, outline) {
  return outline.uses
    .map(({ index, x, y }) => `<use href="#${prefix}-glyph-${index}" transform="translate(${x} ${y})"/>`)
    .join("\n");
}

function svgDocument({ viewBox, title, description, body, defs = "" }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title desc" shape-rendering="geometricPrecision">
  <title id="title">${title}</title>
  <desc id="desc">${description}</desc>
  ${defs ? `<defs>\n${defs}\n  </defs>` : ""}
${body}
</svg>
`;
}

// Optical sizing: Regular carries breath in the full signature, while
// SemiBold keeps the compact symbol intact at 16–48 px.
const word = readOutline("chai-outline-regular-source.svg");
const symbol = readOutline("ch-symbol-outline-source.svg");
const english = readOutline("english-regular-outline-source.svg");

const timelineCuts = `
    <mask id="word-timeline-mask" maskUnits="userSpaceOnUse" x="-40" y="80" width="900" height="480">
      <rect x="-40" y="80" width="900" height="480" fill="white"/>
      <rect x="218" y="137" width="7" height="56" rx="3.5" fill="black"/>
      <rect x="414" y="137" width="7" height="56" rx="3.5" fill="black"/>
      <rect x="646" y="137" width="7" height="56" rx="3.5" fill="black"/>
    </mask>`;

const symbolCut = `
    <mask id="symbol-timeline-mask" maskUnits="userSpaceOnUse" x="-40" y="80" width="440" height="480">
      <rect x="-40" y="80" width="440" height="480" fill="white"/>
      <rect x="170" y="137" width="7" height="56" rx="3.5" fill="black"/>
    </mask>`;

const wordCore = (fill = palette.ivory) => `
  <g id="chai-word-geometry" fill="${fill}" mask="url(#word-timeline-mask)">
    ${glyphUses("word", word)}
  </g>
  <path id="chai-amber-pulse" d="M84 382 C128 410 166 393 196 365 C215 347 235 341 258 347" fill="none" stroke="${fill === palette.ivory ? palette.amber : fill}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <path id="chai-playhead" d="M470 118 V478" fill="none" stroke="${fill === palette.ivory ? palette.cyan : fill}" stroke-width="5" stroke-linecap="round"/>
  <circle id="chai-playhead-cap" cx="470" cy="118" r="5" fill="${fill === palette.ivory ? palette.cyan : fill}"/>`;

const symbolCore = (fill = palette.ivory) => `
  <g id="chai-symbol-geometry" fill="${fill}" mask="url(#symbol-timeline-mask)">
    ${glyphUses("symbol", symbol)}
  </g>
  <path id="chai-symbol-pulse" d="M74 382 C116 408 154 394 184 366 C202 350 221 343 244 348" fill="none" stroke="${fill === palette.ivory ? palette.amber : fill}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <path id="chai-symbol-playhead" d="M322 118 V478" fill="none" stroke="${fill === palette.ivory ? palette.cyan : fill}" stroke-width="5" stroke-linecap="round"/>
  <circle id="chai-symbol-playhead-cap" cx="322" cy="118" r="5" fill="${fill === palette.ivory ? palette.cyan : fill}"/>`;

const wordDefs = `${glyphDefs("word", word)}${timelineCuts}`;
const symbolDefs = `${glyphDefs("symbol", symbol)}${symbolCut}`;

fs.writeFileSync(
  path.join(mastersDir, "chai-wordmark-color.svg"),
  svgDocument({
    viewBox: "-24 88 850 438",
    title: "Chai wordmark",
    description:
      "The exact Devanagari word Chai, with an editorial timeline, cyan playhead, and amber warmth pulse.",
    defs: wordDefs,
    body: wordCore(),
  }),
);

fs.writeFileSync(
  path.join(mastersDir, "chai-wordmark-mono.svg"),
  svgDocument({
    viewBox: "-24 88 850 438",
    title: "Chai wordmark monochrome",
    description: "Monochrome exact Devanagari Chai wordmark.",
    defs: wordDefs,
    body: wordCore(palette.mono),
  }),
);

fs.writeFileSync(
  path.join(mastersDir, "chai-symbol-color.svg"),
  svgDocument({
    viewBox: "-24 88 420 438",
    title: "Chai compact symbol",
    description: "Compact Devanagari Ch symbol with timeline, playhead, and warmth pulse.",
    defs: symbolDefs,
    body: symbolCore(),
  }),
);

fs.writeFileSync(
  path.join(mastersDir, "chai-symbol-mono.svg"),
  svgDocument({
    viewBox: "-24 88 420 438",
    title: "Chai compact symbol monochrome",
    description: "Monochrome compact Devanagari Chai symbol.",
    defs: symbolDefs,
    body: symbolCore(palette.mono),
  }),
);

const appIconDefs = `${glyphDefs("icon", symbol)}
    <mask id="icon-timeline-mask" maskUnits="userSpaceOnUse" x="-40" y="80" width="440" height="480">
      <rect x="-40" y="80" width="440" height="480" fill="white"/>
      <rect x="170" y="137" width="7" height="56" rx="3.5" fill="black"/>
    </mask>`;
const appIconBody = `
  <rect x="12" y="12" width="488" height="488" rx="112" fill="${palette.ink}"/>
  <rect x="20" y="20" width="472" height="472" rx="104" fill="none" stroke="#273149" stroke-width="4"/>
  <g transform="translate(98 -14) scale(.9)">
    <g fill="${palette.ivory}" mask="url(#icon-timeline-mask)">
      ${glyphUses("icon", symbol)}
    </g>
    <path d="M74 382 C116 408 154 394 184 366 C202 350 221 343 244 348" fill="none" stroke="${palette.amber}" stroke-width="18" stroke-linecap="round"/>
    <path d="M322 118 V478" fill="none" stroke="${palette.cyan}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="322" cy="118" r="5" fill="${palette.cyan}"/>
  </g>`;

fs.writeFileSync(
  path.join(mastersDir, "chai-app-icon.svg"),
  svgDocument({
    viewBox: "0 0 512 512",
    title: "Chai Studio app icon",
    description: "Deep midnight app tile containing the compact Chai symbol.",
    defs: appIconDefs,
    body: appIconBody,
  }),
);

const lockupDefs = `${wordDefs}
${glyphDefs("english", english)}`;
const englishUses = glyphUses("english", english);
fs.writeFileSync(
  path.join(mastersDir, "chai-bilingual-lockup.svg"),
  svgDocument({
    viewBox: "-24 88 850 570",
    title: "Chai Studio bilingual lockup",
    description: "Exact Devanagari Chai signature with the English Chai Studio companion name.",
    defs: lockupDefs,
    body: `${wordCore()}
  <g id="chai-studio-english" fill="${palette.ivory}" transform="translate(171 494) scale(.47)">
    ${englishUses}
  </g>`,
  }),
);

console.log("Built six deterministic SVG masters in", mastersDir);
