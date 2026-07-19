import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const report = JSON.parse(await readFile(path.join(root, "evidence", "isolation-report.json"), "utf8"));
const expectedPlatform = `${process.platform}-${process.arch}`;
const ageMs = Date.now() - Date.parse(report.generatedAt);
const valid = report.passed === true && report.platform === expectedPlatform && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
console.log(JSON.stringify({ valid, expectedPlatform, reportPlatform: report.platform, ageMs }, null, 2));
if (!valid) process.exit(1);
