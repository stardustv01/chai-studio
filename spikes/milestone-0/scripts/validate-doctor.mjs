import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const executable = path.join(root, "node_modules", ".bin", "hyperframes");
const result = spawnSync(executable, ["doctor", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (result.error) throw result.error;
const jsonStart = result.stdout.indexOf("{");
if (jsonStart < 0) throw new Error(`HyperFrames doctor did not return JSON:\n${result.stdout}\n${result.stderr}`);

const report = JSON.parse(result.stdout.slice(jsonStart));
const requiredNames = ["Version", "Node.js", "CPU", "Memory", "Disk", "Environment", "FFmpeg", "FFprobe", "Chrome"];
const required = requiredNames.map((name) => {
  const check = report.checks.find((candidate) => candidate.name === name);
  return { name, ok: check?.ok === true, detail: check?.detail ?? "missing" };
});
const optional = report.checks
  .filter((check) => !requiredNames.includes(check.name))
  .map(({ name, ok, detail }) => ({ name, ok, detail }));
const validated = {
  generatedAt: new Date().toISOString(),
  passed: required.every((check) => check.ok),
  required,
  optional,
  upstreamOverallStatus: report.ok,
  meta: report._meta,
};

await writeFile(path.join(root, "evidence", "doctor-validation.json"), `${JSON.stringify(validated, null, 2)}\n`);
console.log(JSON.stringify(validated, null, 2));
if (!validated.passed) process.exit(1);
