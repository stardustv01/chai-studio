#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  archiveProject,
  backupProject,
  cloneProjectBackup,
  collectReleaseEnvironment,
  installLocalRelease,
  restoreProjectBackup,
  uninstallLocalRelease,
  validateProjectBackup,
} from "./release-operations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command = "help", ...arguments_] = process.argv.slice(2);
const releaseCommands = new Set([
  "doctor",
  "about",
  "install",
  "uninstall",
  "backup",
  "validate-backup",
  "restore",
  "clone",
  "archive",
  "launch",
]);

if (!releaseCommands.has(command) && command !== "help") {
  const { runBridgeCli } = await import("../packages/bridge/dist/cli-runtime.js");
  print(await runBridgeCli([command, ...arguments_]));
  process.exit(0);
}

switch (command) {
  case "doctor": {
    const report = await collectReleaseEnvironment(root);
    print(report);
    if (!report.passed) process.exitCode = 1;
    break;
  }
  case "about": {
    const report = await collectReleaseEnvironment(root);
    print({ product: "Chai Studio", version: "1.0.0-rc.1", ...report });
    break;
  }
  case "install": {
    const prefix = requiredOption(arguments_, "--prefix");
    print(await installLocalRelease({ sourceRoot: root, prefix }));
    break;
  }
  case "uninstall": {
    const prefix = requiredOption(arguments_, "--prefix");
    print(await uninstallLocalRelease(prefix));
    break;
  }
  case "backup": {
    const [source, destination] = requiredPaths(arguments_, 2);
    const environment = await collectReleaseEnvironment(root);
    print(await backupProject({ source, destination, environmentFingerprint: environment.fingerprint }));
    break;
  }
  case "validate-backup": {
    const [backup] = requiredPaths(arguments_, 1);
    const report = await validateProjectBackup(backup);
    print(report);
    if (!report.passed) process.exitCode = 1;
    break;
  }
  case "restore": {
    const [backup, destination] = requiredPaths(arguments_, 2);
    print(await restoreProjectBackup({ backup, destination }));
    break;
  }
  case "clone": {
    const [source, destination] = requiredPaths(arguments_, 2);
    const environment = await collectReleaseEnvironment(root);
    print(await cloneProjectBackup({ source, destination, environmentFingerprint: environment.fingerprint }));
    break;
  }
  case "archive": {
    const [source, destination] = requiredPaths(arguments_, 2);
    const environment = await collectReleaseEnvironment(root);
    print(await archiveProject({ source, destination, environmentFingerprint: environment.fingerprint }));
    break;
  }
  case "launch": {
    await launch();
    break;
  }
  default:
    process.stdout.write(
      "Chai Studio 1.0.0-rc.1\nRelease commands: doctor, about, install --prefix PATH, launch [--project PATH] [--starter showcase|empty|launch-film] [--title NAME], backup, validate-backup, restore, clone, archive, uninstall --prefix PATH\nCodex control: run `chai-studio commands` for the executable project, media, preview, render, capture, QA, receipt, annotation, review, job, and source-edit catalog.\n",
    );
}

async function launch() {
  const environment = await collectReleaseEnvironment(root);
  if (!environment.passed) throw new Error("Doctor checks failed; launch is blocked.");
  const webPort = Number(process.env.CHAI_STUDIO_WEB_PORT ?? "4173");
  const studioOrigin = `http://127.0.0.1:${String(webPort)}`;
  const projectRoot = path.resolve(
    optionalOption(arguments_, "--project") ??
      process.env.CHAI_STUDIO_PROJECT_ROOT ??
      path.join(os.homedir(), "Movies", "Chai Studio", "Chai Studio Intro.chai"),
  );
  const starter = optionalOption(arguments_, "--starter") ?? "showcase";
  if (!new Set(["empty", "showcase", "launch-film"]).has(starter)) {
    throw new Error("--starter must be empty, showcase, or launch-film.");
  }
  const projectTitle = optionalOption(arguments_, "--title") ?? "Chai Studio Intro";
  if (projectTitle.trim().length === 0 || projectTitle.length > 160) {
    throw new Error("--title must contain 1 to 160 characters.");
  }
  const { startStudioServer } = await import("../apps/studio-server/dist/index.js");
  const started = await startStudioServer({
    preferredPort: Number(process.env.CHAI_STUDIO_PORT ?? "4317"),
    allowedUiOrigins: [studioOrigin],
    projectRoot,
    ...(process.env.CHAI_STUDIO_RUNTIME_DIRECTORY === undefined
      ? {}
      : { runtimeDirectory: process.env.CHAI_STUDIO_RUNTIME_DIRECTORY }),
  });
  await openOrCreateProject(started, projectRoot, studioOrigin, { starter, title: projectTitle.trim() });
  const vite = path.join(root, "node_modules/vite/bin/vite.js");
  const web = spawn(
    process.execPath,
    [vite, "preview", "apps/studio-web", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    {
      cwd: root,
      env: {
        ...process.env,
        CHAI_STUDIO_SERVER_ORIGIN: started.report.origins[0],
        CHAI_STUDIO_SESSION_TOKEN: started.sessionToken,
      },
      stdio: "inherit",
    },
  );
  const shutdown = async () => {
    web.kill("SIGTERM");
    await started.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  try {
    await waitForStudio(studioOrigin, web);
  } catch (error) {
    await shutdown();
    throw error;
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ready", studio: studioOrigin, api: started.report.origins[0], projectOpened: true, browserOpened: false })}\n`,
  );
  await new Promise((resolve, reject) => {
    web.once("exit", resolve);
    web.once("error", reject);
  });
  await started.close();
}

async function openOrCreateProject(started, projectRoot, studioOrigin, createInput) {
  const apiOrigin = started.report.origins[0];
  if (apiOrigin === undefined) throw new Error("Studio API origin is unavailable.");
  const headers = {
    authorization: `Bearer ${started.sessionToken}`,
    "x-chai-csrf-token": started.sessionToken,
    "content-type": "application/json",
    origin: studioOrigin,
  };
  let exists = true;
  try {
    await access(projectRoot);
  } catch {
    exists = false;
  }
  if (!exists) await mkdir(path.dirname(projectRoot), { recursive: true });
  const projectResponse = await globalThis.fetch(
    `${apiOrigin}${exists ? "/api/v1/projects/open" : "/api/v1/projects/create"}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        exists
          ? { rootPath: projectRoot }
          : { targetPath: projectRoot, title: createInput.title, starter: createInput.starter },
      ),
    },
  );
  if (!projectResponse.ok)
    throw new Error(`Studio project startup failed with HTTP ${String(projectResponse.status)}.`);
  const previewResponse = await globalThis.fetch(`${apiOrigin}/api/v1/preview/sessions/load`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!previewResponse.ok)
    throw new Error(`Studio preview startup failed with HTTP ${String(previewResponse.status)}.`);
}

async function waitForStudio(studioOrigin, web) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (web.exitCode !== null)
      throw new Error(`Studio web process exited with code ${String(web.exitCode)}.`);
    try {
      const response = await globalThis.fetch(studioOrigin, { redirect: "error" });
      if (response.ok) return;
    } catch {
      // The fixed loopback port is still starting.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
  }
  throw new Error("Studio web interface did not become ready on its fixed loopback origin.");
}

function requiredOption(values, name) {
  const index = values.indexOf(name);
  const value = index < 0 ? undefined : values[index + 1];
  if (value === undefined) throw new Error(`${name} is required.`);
  return path.resolve(value);
}

function optionalOption(values, name) {
  const index = values.indexOf(name);
  return index < 0 ? undefined : values[index + 1];
}

function requiredPaths(values, count) {
  const paths = values
    .filter((value) => !value.startsWith("--"))
    .slice(0, count)
    .map((value) => path.resolve(value));
  if (paths.length !== count) throw new Error(`Expected ${String(count)} path arguments.`);
  return paths;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
