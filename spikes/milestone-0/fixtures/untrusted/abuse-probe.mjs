import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";

const [allowedPath, networkUrl] = process.argv.slice(2);
const attempt = async (operation) => {
  try {
    return { allowed: true, value: await operation() };
  } catch (error) {
    return { allowed: false, code: error.code ?? error.cause?.code ?? error.name, message: error.message };
  }
};

const results = {
  approvedRead: await attempt(() => readFileSync(allowedPath, "utf8").trim()),
  deniedRead: await attempt(() => readFileSync("/etc/passwd", "utf8").slice(0, 10)),
  deniedWrite: await attempt(() => writeFileSync("/tmp/chai-untrusted-escape.txt", "escape")),
  deniedProcess: await attempt(() => execFileSync("/usr/bin/true")),
  deniedWorker: await attempt(() => new Promise((resolve, reject) => {
    const worker = new Worker("export default 1", { eval: true });
    worker.once("online", () => resolve("online"));
    worker.once("error", reject);
  })),
  deniedNetwork: await attempt(async () => (await fetch(networkUrl)).text()),
  environmentKeys: Object.keys(process.env).sort(),
  allowedEnvironmentValue: process.env.CHAI_ALLOWED,
};

console.log(JSON.stringify(results));
