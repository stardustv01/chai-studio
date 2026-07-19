import { spawn } from "node:child_process";
import path from "node:path";
import { pinnedHyperframesVersion, type HyperframesCliEnvelope } from "./contracts.js";

export interface HyperframesProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface HyperframesCommandRuntime {
  readonly version: string;
  runJson(
    command: string,
    arguments_: readonly string[],
    input: { readonly cwd: string; readonly signal: AbortSignal },
  ): Promise<HyperframesCliEnvelope>;
  run(
    command: string,
    arguments_: readonly string[],
    input: {
      readonly cwd: string;
      readonly signal: AbortSignal;
      readonly onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
    },
  ): Promise<HyperframesProcessResult>;
}

export class HyperframesCliRuntime implements HyperframesCommandRuntime {
  readonly version = pinnedHyperframesVersion;
  readonly #executable: string;
  readonly #browserExecutable: string | undefined;

  constructor(executable: string, browserExecutable?: string) {
    if (!path.isAbsolute(executable)) throw new Error("HyperFrames CLI executable must be absolute.");
    if (browserExecutable !== undefined && !path.isAbsolute(browserExecutable)) {
      throw new Error("HyperFrames browser executable must be absolute.");
    }
    this.#executable = executable;
    this.#browserExecutable = browserExecutable;
  }

  async runJson(
    command: string,
    arguments_: readonly string[],
    input: { readonly cwd: string; readonly signal: AbortSignal },
  ): Promise<HyperframesCliEnvelope> {
    const result = await this.run(command, [...arguments_, "--json"], input);
    let payload: HyperframesCliEnvelope;
    try {
      payload = JSON.parse(result.stdout) as HyperframesCliEnvelope;
    } catch (cause) {
      throw new Error(
        `HyperFrames ${command} returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    if (payload._meta?.version !== pinnedHyperframesVersion) {
      throw new Error(
        `HyperFrames CLI version ${payload._meta?.version ?? "unknown"} does not match ${pinnedHyperframesVersion}.`,
      );
    }
    if (result.exitCode !== 0 && payload.ok !== false) {
      throw new Error(`HyperFrames ${command} failed (${result.exitCode.toString()}): ${result.stderr}`);
    }
    return payload;
  }

  run(
    command: string,
    arguments_: readonly string[],
    input: {
      readonly cwd: string;
      readonly signal: AbortSignal;
      readonly onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
    },
  ): Promise<HyperframesProcessResult> {
    if (!/^[a-z][a-z-]{1,31}$/.test(command))
      return Promise.reject(new Error("HyperFrames command is invalid."));
    if (input.signal.aborted)
      return Promise.reject(new DOMException("HyperFrames command was cancelled.", "AbortError"));
    return new Promise((resolve, reject) => {
      const child = spawn(this.#executable, [command, ...arguments_], {
        cwd: input.cwd,
        env: {
          ...process.env,
          HYPERFRAMES_NO_TELEMETRY: "1",
          HYPERFRAMES_SKIP_SKILLS: "1",
          ...(this.#browserExecutable === undefined
            ? {}
            : { HYPERFRAMES_BROWSER_PATH: this.#browserExecutable }),
          NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const abort = () => child.kill("SIGTERM");
      input.signal.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        input.onOutput?.("stdout", chunk);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        input.onOutput?.("stderr", chunk);
      });
      child.on("error", (cause) => {
        input.signal.removeEventListener("abort", abort);
        reject(cause);
      });
      child.on("close", (exitCode) => {
        input.signal.removeEventListener("abort", abort);
        if (input.signal.aborted) {
          reject(new DOMException("HyperFrames command was cancelled.", "AbortError"));
          return;
        }
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  }
}
