#!/usr/bin/env node
import { runBridgeCli } from "./cli-runtime.js";

runBridgeCli(process.argv.slice(2)).then(
  (value) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  },
  (cause: unknown) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : "Bridge CLI failed."}\n`);
    process.exitCode = 1;
  },
);
