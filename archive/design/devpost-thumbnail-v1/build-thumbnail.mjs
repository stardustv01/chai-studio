import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../..");
const requireFromServer = createRequire(path.join(repositoryRoot, "apps/studio-server/package.json"));
const sharp = requireFromServer("sharp");

const width = 1536;
const height = 1024;
const screenshotLeft = 590;
const screenshotTop = 228;
const screenshotWidth = 866;
const screenshotHeight = 548;
const cornerRadius = 22;

const backgroundPath = path.join(directory, "generated-background.png");
const screenshotPath = path.join(
  repositoryRoot,
  "tests/e2e/studio-visual.spec.ts-snapshots/p18-codex-context-bridge-darwin.png",
);
const logoPath = path.join(
  repositoryRoot,
  "design/chai-logo-production-v2-faithful/locked/approved-logo-animation-v1/masters/chai-lockup-color.svg",
);
const outputPath = path.join(directory, "chai-studio-devpost-thumbnail-3x2.png");

const roundedMask = Buffer.from(`
  <svg width="${screenshotWidth}" height="${screenshotHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${screenshotWidth}" height="${screenshotHeight}" rx="${cornerRadius}" fill="#fff"/>
  </svg>
`);

const screenshot = await sharp(screenshotPath)
  .resize({ width: screenshotWidth, height: screenshotHeight, fit: "cover", position: "top" })
  .composite([{ input: roundedMask, blend: "dest-in" }])
  .png()
  .toBuffer();

const logo = await sharp(logoPath).resize({ width: 450 }).png().toBuffer();

const atmosphere = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="leftShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#070A12" stop-opacity="0.94"/>
        <stop offset="0.42" stop-color="#070A12" stop-opacity="0.72"/>
        <stop offset="0.68" stop-color="#070A12" stop-opacity="0.08"/>
        <stop offset="1" stop-color="#070A12" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="cyanAura" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#19D9EA" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#19D9EA" stop-opacity="0"/>
      </radialGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="24"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#leftShade)"/>
    <ellipse cx="1030" cy="530" rx="500" ry="390" fill="url(#cyanAura)"/>
    <rect x="${screenshotLeft + 10}" y="${screenshotTop + 22}" width="${screenshotWidth}" height="${screenshotHeight}" rx="${cornerRadius}" fill="#000" opacity="0.74" filter="url(#shadow)"/>
  </svg>
`);

const copy = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .sans { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
    </style>
    <text class="sans" x="92" y="500" fill="#19D9EA" font-size="25" font-weight="700" letter-spacing="2.8">CODEX-OPERATED VIDEO STUDIO</text>
    <text class="sans" x="92" y="564" fill="#F5EFE2" font-size="45" font-weight="650">One timeline.</text>
    <text class="sans" x="92" y="620" fill="#F5EFE2" font-size="45" font-weight="650">Two native engines.</text>
    <text class="sans" x="92" y="676" fill="#F2B33F" font-size="45" font-weight="650">Verified delivery.</text>
    <g transform="translate(92 752)">
      <rect width="404" height="48" rx="24" fill="#111827" fill-opacity="0.92" stroke="#2A354A"/>
      <circle cx="25" cy="24" r="5" fill="#19D9EA"/>
      <text class="sans" x="43" y="31" fill="#C9D3E6" font-size="20" font-weight="600" letter-spacing="1.1">REMOTION · HYPERFRAMES · MEDIA</text>
    </g>
    <rect x="${screenshotLeft}" y="${screenshotTop}" width="${screenshotWidth}" height="${screenshotHeight}" rx="${cornerRadius}" fill="none" stroke="#3E4D69" stroke-width="2"/>
    <rect x="${screenshotLeft + 1}" y="${screenshotTop + 1}" width="${screenshotWidth - 2}" height="${screenshotHeight - 2}" rx="${cornerRadius - 1}" fill="none" stroke="#19D9EA" stroke-opacity="0.28"/>
    <g transform="translate(${screenshotLeft + 28} ${screenshotTop - 54})">
      <rect width="258" height="38" rx="19" fill="#0A1220" fill-opacity="0.94" stroke="#2A354A"/>
      <circle cx="20" cy="19" r="4" fill="#39D98A"/>
      <text class="sans" x="35" y="25" fill="#D9E4F3" font-size="17" font-weight="600">LOCAL · FRAME-ACCURATE</text>
    </g>
  </svg>
`);

await sharp(backgroundPath)
  .resize({ width, height, fit: "cover" })
  .composite([
    { input: atmosphere },
    { input: logo, left: 72, top: 98 },
    { input: screenshot, left: screenshotLeft, top: screenshotTop },
    { input: copy },
  ])
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(outputPath);

console.log(outputPath);
