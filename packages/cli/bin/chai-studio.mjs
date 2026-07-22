#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultInstallPrefix,
  doctorInstaller,
  installFromRelease,
  runInstalledCommand,
  uninstallInstalledRelease,
} from "../lib/installer.mjs";

const [command = "help", ...arguments_] = process.argv.slice(2);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryRuntime = path.join(packageRoot, "runtime");
const registryRuntimeAvailable = await exists(
  path.join(registryRuntime, ".chai-studio-registry-runtime.json"),
);

try {
  switch (command) {
    case "install":
      if (registryRuntimeAvailable) {
        assertNoLegacyOptions(arguments_);
        await prepareRegistryRuntime();
      } else await install(false);
      break;
    case "update":
      if (registryRuntimeAvailable) {
        throw new Error(
          "Update the npm package itself: use `npx @chai-studio/cli@latest install` or `npm install --global @chai-studio/cli@latest`.",
        );
      } else await install(true);
      break;
    case "doctor": {
      if (registryRuntimeAvailable) {
        assertNoLegacyOptions(arguments_);
        await runRegistryRuntime("doctor", passthroughArguments(arguments_));
        break;
      }
      const report = await doctorInstaller({ prefix: prefixOption(arguments_) });
      print(report);
      if (!report.passed) process.exitCode = 1;
      else {
        await runInstalledCommand({
          prefix: prefixOption(arguments_),
          command: "doctor",
        });
      }
      break;
    }
    case "launch":
      if (registryRuntimeAvailable) {
        assertNoLegacyOptions(arguments_);
        await runRegistryRuntime("launch", passthroughArguments(arguments_));
      } else {
        await runInstalledCommand({
          prefix: prefixOption(arguments_),
          command: "launch",
          arguments: passthroughArguments(arguments_),
        });
      }
      break;
    case "uninstall":
      if (registryRuntimeAvailable) {
        throw new Error(
          "This installation is managed by npm. Use `npm uninstall --global @chai-studio/cli` for a global installation.",
        );
      }
      print(await uninstallInstalledRelease({ prefix: prefixOption(arguments_) }));
      break;
    case "help":
      help();
      break;
    default:
      if (registryRuntimeAvailable) await runRegistryRuntime(command, arguments_);
      else throw new Error(`Unknown Chai Studio installer command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Chai Studio CLI: ${message}\n`);
  if (process.env.CHAI_STUDIO_CLI_DEBUG === "1" && error instanceof Error) {
    process.stderr.write(`${error.stack ?? ""}\n`);
  }
  process.exitCode = 1;
}

async function install(update) {
  const result = await installFromRelease({
    prefix: prefixOption(arguments_),
    releaseIndexUrl: option(arguments_, "--release-index"),
    publicKeyPath: option(arguments_, "--public-key"),
    version: option(arguments_, "--version"),
    update,
  });
  print(result);
  if (arguments_.includes("--launch")) {
    await runInstalledCommand({
      prefix: result.prefix,
      command: "launch",
      arguments: passthroughArguments(arguments_),
    });
  }
}

async function prepareRegistryRuntime() {
  const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
  await run(process.execPath, [playwrightCli, "install", "chromium"]);
  print({
    status: "ready",
    version: JSON.parse(
      await readFile(path.join(registryRuntime, ".chai-studio-registry-runtime.json"), "utf8"),
    ).version,
    runtimeDelivery: "npm-direct-dependencies",
    ffmpegDelivery: "external-system-tool",
  });
  await runRegistryRuntime("doctor", []);
  if (arguments_.includes("--launch")) {
    await runRegistryRuntime("launch", passthroughArguments(arguments_));
  }
}

async function runRegistryRuntime(command, values) {
  await run(process.execPath, [path.join(registryRuntime, "scripts/chai-studio.mjs"), command, ...values]);
}

function run(executable, values) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, values, { stdio: "inherit", env: { ...process.env } });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} failed (${signal ?? String(code)}).`));
    });
  });
}

function prefixOption(values) {
  return path.resolve(option(values, "--prefix") ?? defaultInstallPrefix());
}

function option(values, name) {
  const index = values.indexOf(name);
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function passthroughArguments(values) {
  const consumed = new Set(["--prefix", "--release-index", "--public-key", "--version"]);
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--launch") continue;
    if (consumed.has(value)) {
      index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

function assertNoLegacyOptions(values) {
  const optionName = ["--prefix", "--release-index", "--public-key", "--version"].find((name) =>
    values.includes(name),
  );
  if (optionName !== undefined) {
    throw new Error(`${optionName} is available only to the legacy personal archive installer.`);
  }
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write(`Chai Studio installer CLI

Commands:
  install [--launch] [Chai Studio launch options]
  doctor
  launch [Chai Studio launch options]
  uninstall

Package updates:
  npx @chai-studio/cli@latest install
  npm install --global @chai-studio/cli@latest

Legacy personal-archive inputs (unavailable in the registry package):
  --prefix PATH
  --version VERSION
  --release-index HTTPS_URL
  --public-key PEM_PATH

Registry packages obtain exact third-party dependencies directly from npm and require system
FFmpeg/FFprobe. Legacy archive installs refuse unsigned, unauthorized, incompatible, or
checksum-mismatched releases.
`);
}

function exists(candidate) {
  return access(candidate)
    .then(() => true)
    .catch(() => false);
}
