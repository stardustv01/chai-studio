import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = path.join(os.tmpdir(), "chai-studio-authenticated-e2e");
const projectRoot = path.join(temporaryRoot, "Launch Film.chai");
await rm(temporaryRoot, { recursive: true, force: true });

const child = spawn(
  process.execPath,
  [
    path.join(root, "scripts", "chai-studio.mjs"),
    "launch",
    "--project",
    projectRoot,
    "--starter",
    "launch-film",
    "--title",
    "Launch Film",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CHAI_STUDIO_WEB_PORT: process.env.CHAI_STUDIO_WEB_PORT ?? "44273",
      CHAI_STUDIO_PORT: process.env.CHAI_STUDIO_PORT ?? "44417",
      CHAI_STUDIO_RUNTIME_DIRECTORY:
        process.env.CHAI_STUDIO_RUNTIME_DIRECTORY ?? path.join(temporaryRoot, "runtime"),
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
