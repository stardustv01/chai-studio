import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPort = process.env.CHAI_STUDIO_FIRST_RUN_SERVER_PORT ?? "45417";
const webPort = process.env.CHAI_STUDIO_FIRST_RUN_WEB_PORT ?? "45273";
const temporaryRoot = path.join(os.tmpdir(), `chai-studio-first-run-e2e-${serverPort}`);
const projectRoot = path.join(temporaryRoot, "Chai Studio Intro.chai");
await rm(temporaryRoot, { recursive: true, force: true });

const child = spawn(
  process.execPath,
  [
    path.join(root, "scripts", "chai-studio.mjs"),
    "launch",
    "--project",
    projectRoot,
    "--starter",
    "showcase",
    "--title",
    "Chai Studio Intro",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CHAI_STUDIO_WEB_PORT: webPort,
      CHAI_STUDIO_PORT: serverPort,
      CHAI_STUDIO_RUNTIME_DIRECTORY: path.join(temporaryRoot, "runtime"),
    },
    stdio: "inherit",
  },
);

const stop = (signal) => {
  child.kill(signal);
};
process.once("SIGINT", () => {
  stop("SIGINT");
});
process.once("SIGTERM", () => {
  stop("SIGTERM");
});
child.once("error", (cause) => {
  throw cause;
});
child.once("exit", (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
