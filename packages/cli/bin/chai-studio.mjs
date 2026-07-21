#!/usr/bin/env node
import path from "node:path";
import {
  defaultInstallPrefix,
  doctorInstaller,
  installFromRelease,
  runInstalledCommand,
  uninstallInstalledRelease,
} from "../lib/installer.mjs";

const [command = "help", ...arguments_] = process.argv.slice(2);

try {
  switch (command) {
    case "install":
      await install(false);
      break;
    case "update":
      await install(true);
      break;
    case "doctor": {
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
      await runInstalledCommand({
        prefix: prefixOption(arguments_),
        command: "launch",
        arguments: passthroughArguments(arguments_),
      });
      break;
    case "uninstall":
      print(await uninstallInstalledRelease({ prefix: prefixOption(arguments_) }));
      break;
    case "help":
      help();
      break;
    default:
      throw new Error(`Unknown Chai Studio installer command: ${command}`);
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

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write(`Chai Studio installer CLI

Commands:
  install [--launch] [--prefix PATH] [--version VERSION]
  update [--launch] [--prefix PATH] [--version VERSION]
  doctor [--prefix PATH]
  launch [--prefix PATH] [Chai Studio launch options]
  uninstall [--prefix PATH]

Development-only trust inputs:
  --release-index HTTPS_URL
  --public-key PEM_PATH

The CLI refuses unsigned, unauthorized, incompatible, or checksum-mismatched releases.
`);
}
