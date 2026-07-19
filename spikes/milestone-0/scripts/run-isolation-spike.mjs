import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const fixtureRoot = path.join(root, "fixtures", "untrusted");
const sandboxProfile = "(version 1)(allow default)(deny network*)";
const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", TZ: "UTC", CHAI_ALLOWED: "yes" };

const server = createServer((_request, response) => response.end("network-reachable"));
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const networkUrl = `http://127.0.0.1:${address.port}`;

const base = [
  "-p",
  sandboxProfile,
  process.execPath,
  "--permission",
  `--allow-fs-read=${fixtureRoot}`,
];
const probe = spawnSync(
  "/usr/bin/sandbox-exec",
  [...base, path.join(fixtureRoot, "abuse-probe.mjs"), path.join(fixtureRoot, "allowed-data.txt"), networkUrl],
  { encoding: "utf8", env: environment, timeout: 5000, maxBuffer: 1024 * 1024 },
);
server.close();

if (probe.status !== 0) throw new Error(`isolation probe failed to execute: ${probe.stderr}`);
const probeResult = JSON.parse(probe.stdout.trim().split("\n").at(-1));

const wallTime = spawnSync(
  "/usr/bin/sandbox-exec",
  [...base, path.join(fixtureRoot, "infinite-loop.mjs")],
  { encoding: "utf8", env: environment, timeout: 500, maxBuffer: 1024 * 1024 },
);
const memory = spawnSync(
  "/usr/bin/sandbox-exec",
  ["-p", sandboxProfile, process.execPath, "--max-old-space-size=32", "--permission", `--allow-fs-read=${fixtureRoot}`, path.join(fixtureRoot, "memory-abuse.mjs")],
  { encoding: "utf8", env: environment, timeout: 5000, maxBuffer: 1024 * 1024 },
);
const output = spawnSync(
  "/usr/bin/sandbox-exec",
  [...base, path.join(fixtureRoot, "output-abuse.mjs")],
  { encoding: "utf8", env: environment, timeout: 5000, maxBuffer: 128 * 1024 },
);

const allowedEnvironmentKeys = [...Object.keys(environment), "__CF_USER_TEXT_ENCODING"].sort();
const assertions = {
  approvedReadWorks: probeResult.approvedRead.allowed && probeResult.approvedRead.value === "approved fixture data",
  unrelatedFilesystemDenied: probeResult.deniedRead.allowed === false,
  outsideWriteDenied: probeResult.deniedWrite.allowed === false,
  childProcessDenied: probeResult.deniedProcess.allowed === false,
  workerDenied: probeResult.deniedWorker.allowed === false,
  networkDenied: probeResult.deniedNetwork.allowed === false,
  environmentSanitized: JSON.stringify(probeResult.environmentKeys) === JSON.stringify(allowedEnvironmentKeys),
  wallTimeTerminated: wallTime.error?.code === "ETIMEDOUT",
  memoryLimited: memory.status !== 0,
  outputLimited: output.error?.code === "ENOBUFS",
};
const report = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  mechanisms: ["macOS sandbox-exec deny network", "Node permission model", "sanitized env plus macOS __CF_USER_TEXT_ENCODING", "spawn wall-time/maxBuffer", "V8 heap cap"],
  passed: Object.values(assertions).every(Boolean),
  assertions,
  probe: probeResult,
  enforcement: {
    wallTime: { status: wallTime.status, signal: wallTime.signal, errorCode: wallTime.error?.code },
    memory: { status: memory.status, signal: memory.signal },
    output: { status: output.status, signal: output.signal, errorCode: output.error?.code },
  },
};
await writeFile(path.join(root, "evidence", "isolation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, assertions }, null, 2));
if (!report.passed) process.exit(1);
