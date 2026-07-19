import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(sourceDir, '..');
const svgRoot = path.join(root, 'svg');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const failures = [];
const names = manifest.icons.map((item) => item.name);
const files = fs.readdirSync(svgRoot).filter((file) => file.endsWith('.svg')).sort();

if (manifest.total !== 123) failures.push(`manifest total is ${manifest.total}, expected 123`);
if (new Set(names).size !== names.length) failures.push('manifest contains duplicate names');
if (files.length !== 123) failures.push(`found ${files.length} SVG files, expected 123`);

const expectedFiles = names.map((name) => `${name}.svg`).sort();
if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
  failures.push('SVG filenames do not match the manifest');
}

for (const file of files) {
  const source = fs.readFileSync(path.join(svgRoot, file), 'utf8');
  if (!source.includes('viewBox="0 0 24 24"')) failures.push(`${file}: wrong or missing viewBox`);
  if (!source.includes('stroke-width="1.75"')) failures.push(`${file}: wrong or missing base stroke`);
  if (!source.includes('currentColor')) failures.push(`${file}: missing currentColor`);
  if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(source)) failures.push(`${file}: embeds a fixed color`);
  if (!source.trim().endsWith('</svg>')) failures.push(`${file}: incomplete SVG root`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('PASS: 123 unique SVGs satisfy the Chai icon structural contract.');
console.log(`PASS: phase counts P0=${manifest.phases.P0}, P1=${manifest.phases.P1}, P2=${manifest.phases.P2}.`);

