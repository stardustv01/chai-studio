import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "../..");
const requireFromServer = createRequire(path.join(repositoryRoot, "apps/studio-server/package.json"));
const sharp = requireFromServer("sharp");

const width = 1536;
const height = 1024;
const screenshotLeft = 528;
const screenshotTop = 211;
const screenshotWidth = 940;
const screenshotHeight = 588;
const cornerRadius = 22;

const backgroundPath = path.join(directory, "timeline-background.png");
const screenshotPath = path.join(
  repositoryRoot,
  "tests/e2e/studio-visual.spec.ts-snapshots/p08-edit-workspace-darwin.png",
);
const logoPath = path.join(
  repositoryRoot,
  "design/chai-logo-production-v2-faithful/locked/approved-logo-animation-v1/masters/chai-lockup-color.svg",
);
const outputPath = path.join(directory, "chai-studio-devpost-thumbnail-final-3x2.png");

const roundedMask = Buffer.from(`
  <svg width="${screenshotWidth}" height="${screenshotHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${screenshotWidth}" height="${screenshotHeight}" rx="${cornerRadius}" fill="#fff"/>
  </svg>
`);

const screenshot = await sharp(screenshotPath)
  .resize({ width: screenshotWidth })
  .resize({ width: screenshotWidth, height: screenshotHeight, fit: "fill" })
  .composite([{ input: roundedMask, blend: "dest-in" }])
  .modulate({ brightness: 1.08, saturation: 1.08 })
  .sharpen({ sigma: 0.6 })
  .png()
  .toBuffer();

const logo = await sharp(logoPath).resize({ width: 250 }).png().toBuffer();

const lighting = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="leftShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#030711" stop-opacity="0.96"/>
        <stop offset="0.67" stop-color="#030711" stop-opacity="0.76"/>
        <stop offset="1" stop-color="#030711" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="edgeShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#02050C" stop-opacity="0.30"/>
        <stop offset="0.52" stop-color="#02050C" stop-opacity="0"/>
        <stop offset="1" stop-color="#02050C" stop-opacity="0.38"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feGaussianBlur stdDeviation="30"/>
      </filter>
    </defs>
    <rect width="730" height="${height}" fill="url(#leftShade)"/>
    <rect width="${width}" height="${height}" fill="url(#edgeShade)"/>
    <rect x="${screenshotLeft + 10}" y="${screenshotTop + 26}" width="${screenshotWidth}" height="${screenshotHeight}" rx="${cornerRadius}" fill="#000" opacity="0.88" filter="url(#shadow)"/>
  </svg>
`);

const typography = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="cursorGlow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="7" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <style>
      .sans { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
    </style>
    <line x1="70" y1="327" x2="451" y2="327" stroke="#19D9EA" stroke-width="2" stroke-opacity="0.72"/>
    <text class="sans" x="70" y="381" fill="#19D9EA" font-size="25" font-weight="700" letter-spacing="3.6">CODEX-OPERATED STUDIO</text>
    <text class="sans" x="70" y="463" fill="#F5EFE2" font-size="52" font-weight="700" letter-spacing="-1.2">One timeline.</text>
    <text class="sans" x="70" y="529" fill="#F5EFE2" font-size="48" font-weight="700" letter-spacing="-1.1">Two native engines.</text>
    <text class="sans" x="70" y="595" fill="#FFB83E" font-size="52" font-weight="700" letter-spacing="-1.2">Verified delivery.</text>

    <g transform="translate(70 743)">
      <rect width="391" height="49" rx="24.5" fill="#091222" fill-opacity="0.90" stroke="#31415E"/>
      <circle cx="24" cy="24.5" r="5" fill="#19D9EA"/>
      <text class="sans" x="43" y="32" fill="#D5DBE8" font-size="20" font-weight="600" letter-spacing="1.25">REMOTION • HYPERFRAMES • MEDIA</text>
    </g>

    <rect x="${screenshotLeft}" y="${screenshotTop}" width="${screenshotWidth}" height="${screenshotHeight}" rx="${cornerRadius}" fill="none" stroke="#34445F" stroke-width="2"/>
    <path d="M ${screenshotLeft + cornerRadius} ${screenshotTop} H ${screenshotLeft + screenshotWidth - cornerRadius}" stroke="#19D9EA" stroke-opacity="0.7" stroke-width="2"/>

    <g filter="url(#cursorGlow)">
      <circle cx="935" cy="719" r="22" fill="none" stroke="#19D9EA" stroke-width="2" stroke-opacity="0.72"/>
      <circle cx="935" cy="719" r="5" fill="#19D9EA"/>
      <path d="M 935 719 L 935 776 L 950 760 L 962 789 L 976 783 L 963 755 L 986 755 Z" fill="#F5EFE2" stroke="#19D9EA" stroke-width="3" stroke-linejoin="round"/>
    </g>
    <g transform="translate(976 775)">
      <rect width="115" height="42" rx="21" fill="#07111F" stroke="#19D9EA" stroke-width="2"/>
      <circle cx="22" cy="21" r="5" fill="#19D9EA"/>
      <text class="sans" x="37" y="28" fill="#F5EFE2" font-size="19" font-weight="700" letter-spacing="1.4">CODEX</text>
    </g>
  </svg>
`);

await sharp(backgroundPath)
  .resize({ width, height, fit: "cover" })
  .composite([
    { input: lighting },
    { input: logo, left: 62, top: 30 },
    { input: screenshot, left: screenshotLeft, top: screenshotTop },
    { input: typography },
  ])
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(outputPath);

console.log(outputPath);
