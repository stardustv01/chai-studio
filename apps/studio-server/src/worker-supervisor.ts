import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { redactText } from "@chai-studio/diagnostics";

export const workerRpcProtocolVersion = "chai-worker-rpc/1" as const;

export interface WorkerRpcRequest {
  readonly protocol: typeof workerRpcProtocolVersion;
  readonly id: string;
  readonly method: string;
  readonly params: unknown;
}

export type WorkerRpcResponse =
  | Readonly<{
      protocol: typeof workerRpcProtocolVersion;
      id: string;
      ok: true;
      result: unknown;
    }>
  | Readonly<{
      protocol: typeof workerRpcProtocolVersion;
      id: string;
      ok: false;
      error: Readonly<{ code: string; message: string; retryable: boolean }>;
    }>;

export interface WorkerTransport {
  send(message: WorkerRpcRequest): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onExit(listener: (exit: Readonly<{ code: number | null; signal: string | null }>) => void): () => void;
  onLog(listener: (line: string) => void): () => void;
  terminate(): void;
}

export type WorkerTransportFactory = () => WorkerTransport | Promise<WorkerTransport>;
export type WorkerSupervisorStatus =
  "stopped" | "starting" | "healthy" | "degraded" | "restarting" | "failed";

export interface WorkerLogRecord {
  readonly sequence: number;
  readonly timestamp: string;
  readonly line: string;
}

export interface WorkerSupervisorDiagnostics {
  readonly name: string;
  readonly status: WorkerSupervisorStatus;
  readonly generation: number;
  readonly restartCount: number;
  readonly maxRestarts: number;
  readonly activeRequestCount: number;
  readonly lastHeartbeatAt: string | null;
  readonly lastError: string | null;
  readonly logCount: number;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly detachAbort: () => void;
}

export class WorkerSupervisor {
  readonly #name: string;
  readonly #createTransport: WorkerTransportFactory;
  readonly #now: () => Date;
  readonly #heartbeatIntervalMs: number;
  readonly #heartbeatTimeoutMs: number;
  readonly #requestTimeoutMs: number;
  readonly #maxRestarts: number;
  readonly #restartDelayMs: number;
  readonly #maxLogEntries: number;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #logs: WorkerLogRecord[] = [];
  #transport: WorkerTransport | null = null;
  #status: WorkerSupervisorStatus = "stopped";
  #generation = 0;
  #restartCount = 0;
  #lastHeartbeatAt: string | null = null;
  #lastError: string | null = null;
  #logSequence = 0;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #intentionalStop = false;
  #detachTransport: readonly (() => void)[] = [];

  constructor(input: {
    readonly name: string;
    readonly createTransport: WorkerTransportFactory;
    readonly now?: () => Date;
    readonly heartbeatIntervalMs?: number;
    readonly heartbeatTimeoutMs?: number;
    readonly requestTimeoutMs?: number;
    readonly maxRestarts?: number;
    readonly restartDelayMs?: number;
    readonly maxLogEntries?: number;
  }) {
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(input.name)) {
      throw new Error("Worker supervisor name is invalid.");
    }
    this.#name = input.name;
    this.#createTransport = input.createTransport;
    this.#now = input.now ?? (() => new Date());
    this.#heartbeatIntervalMs = boundedInteger(
      input.heartbeatIntervalMs ?? 5_000,
      10,
      300_000,
      "heartbeat interval",
    );
    this.#heartbeatTimeoutMs = boundedInteger(
      input.heartbeatTimeoutMs ?? 2_000,
      10,
      60_000,
      "heartbeat timeout",
    );
    this.#requestTimeoutMs = boundedInteger(
      input.requestTimeoutMs ?? 30_000,
      10,
      3_600_000,
      "request timeout",
    );
    this.#maxRestarts = boundedInteger(input.maxRestarts ?? 3, 0, 100, "restart limit");
    this.#restartDelayMs = boundedInteger(input.restartDelayMs ?? 250, 0, 60_000, "restart delay");
    this.#maxLogEntries = boundedInteger(input.maxLogEntries ?? 1_000, 10, 100_000, "log limit");
  }

  async start(): Promise<WorkerSupervisorDiagnostics> {
    if (this.#status === "healthy") return this.diagnostics();
    if (this.#status === "starting" || this.#status === "restarting") {
      throw new Error("Worker supervisor start is already in progress.");
    }
    this.#intentionalStop = false;
    this.#restartCount = 0;
    await this.#attachTransport("starting");
    return this.diagnostics();
  }

  async call<T = unknown>(
    method: string,
    params: unknown,
    options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
  ): Promise<T> {
    if (this.#status !== "healthy" || this.#transport === null) {
      throw new Error(`Worker ${this.#name} is not healthy.`);
    }
    if (!/^[a-z][a-zA-Z0-9._:-]{2,127}$/.test(method)) throw new Error("Worker RPC method is invalid.");
    if (options.signal?.aborted === true) throw abortError(method);
    const id = `rpc-${randomUUID()}`;
    const timeoutMs = boundedInteger(
      options.timeoutMs ?? this.#requestTimeoutMs,
      10,
      3_600_000,
      "RPC timeout",
    );
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.#transport?.send({
          protocol: workerRpcProtocolVersion,
          id: `rpc-${randomUUID()}`,
          method: "system.cancel",
          params: { requestId: id },
        });
        this.#settle(id, abortError(method));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(() => {
        this.#settle(id, new Error(`Worker RPC ${method} timed out after ${String(timeoutMs)} ms.`));
      }, timeoutMs);
      timeout.unref();
      this.#pending.set(id, {
        method,
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
        timeout,
        detachAbort: () => options.signal?.removeEventListener("abort", onAbort),
      });
      try {
        this.#transport?.send({
          protocol: workerRpcProtocolVersion,
          id,
          method,
          params,
        });
      } catch (cause) {
        this.#settle(id, cause instanceof Error ? cause : new Error("Worker transport send failed."));
      }
    });
  }

  stop(): void {
    this.#intentionalStop = true;
    this.#clearTimers();
    const transport = this.#transport;
    this.#detachCurrentTransport();
    this.#transport = null;
    transport?.terminate();
    this.#rejectAll(new Error(`Worker ${this.#name} stopped.`));
    this.#status = "stopped";
  }

  diagnostics(): WorkerSupervisorDiagnostics {
    return {
      name: this.#name,
      status: this.#status,
      generation: this.#generation,
      restartCount: this.#restartCount,
      maxRestarts: this.#maxRestarts,
      activeRequestCount: this.#pending.size,
      lastHeartbeatAt: this.#lastHeartbeatAt,
      lastError: this.#lastError,
      logCount: this.#logs.length,
    };
  }

  logs(): readonly WorkerLogRecord[] {
    return this.#logs.map((record) => structuredClone(record));
  }

  async #attachTransport(status: "starting" | "restarting"): Promise<void> {
    this.#status = status;
    let transport: WorkerTransport;
    try {
      transport = await this.#createTransport();
    } catch (cause) {
      this.#lastError = errorMessage(cause);
      await this.#scheduleRestart();
      return;
    }
    if (this.#intentionalStop) {
      transport.terminate();
      return;
    }
    this.#detachCurrentTransport();
    this.#transport = transport;
    this.#generation += 1;
    this.#status = "healthy";
    this.#lastError = null;
    this.#detachTransport = [
      transport.onMessage((message) => {
        this.#onMessage(message);
      }),
      transport.onLog((line) => {
        this.#recordLog(line);
      }),
      transport.onExit((exit) => {
        void this.#onExit(exit);
      }),
    ];
    this.#startHeartbeat();
  }

  #onMessage(value: unknown): void {
    let response: WorkerRpcResponse;
    try {
      response = assertWorkerRpcResponse(value);
    } catch (cause) {
      this.#recordLog(`protocol-error: ${errorMessage(cause)}`);
      return;
    }
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    if (response.ok) this.#settle(response.id, null, response.result);
    else this.#settle(response.id, new Error(`${response.error.code}: ${response.error.message}`));
  }

  async #onExit(exit: Readonly<{ code: number | null; signal: string | null }>): Promise<void> {
    this.#clearHeartbeat();
    this.#detachCurrentTransport();
    this.#transport = null;
    this.#rejectAll(
      new Error(`Worker ${this.#name} exited (${String(exit.code)}/${exit.signal ?? "none"}).`),
    );
    if (this.#intentionalStop) {
      this.#status = "stopped";
      return;
    }
    this.#lastError = `Unexpected exit code=${String(exit.code)} signal=${exit.signal ?? "none"}`;
    await this.#scheduleRestart();
  }

  async #scheduleRestart(): Promise<void> {
    if (this.#intentionalStop) return;
    if (this.#restartCount >= this.#maxRestarts) {
      this.#status = "failed";
      return;
    }
    this.#restartCount += 1;
    this.#status = "restarting";
    await new Promise<void>((resolve) => {
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = null;
        resolve();
      }, this.#restartDelayMs);
    });
    if (this.#isStopping()) return;
    await this.#attachTransport("restarting");
  }

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      void this.call("system.ping", {}, { timeoutMs: this.#heartbeatTimeoutMs })
        .then(() => {
          this.#lastHeartbeatAt = this.#now().toISOString();
        })
        .catch((cause: unknown) => {
          if (this.#status !== "healthy") return;
          this.#status = "degraded";
          this.#lastError = errorMessage(cause);
          this.#transport?.terminate();
        });
    }, this.#heartbeatIntervalMs);
    this.#heartbeatTimer.unref();
  }

  #settle(id: string, error: Error | null, result?: unknown): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    clearTimeout(pending.timeout);
    pending.detachAbort();
    if (error === null) pending.resolve(result);
    else pending.reject(error);
  }

  #rejectAll(error: Error): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, error);
  }

  #recordLog(line: string): void {
    this.#logSequence += 1;
    this.#logs.push({
      sequence: this.#logSequence,
      timestamp: this.#now().toISOString(),
      line: redactText(line).slice(0, 16_384),
    });
    if (this.#logs.length > this.#maxLogEntries) {
      this.#logs.splice(0, this.#logs.length - this.#maxLogEntries);
    }
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  #clearTimers(): void {
    this.#clearHeartbeat();
    if (this.#restartTimer !== null) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }

  #detachCurrentTransport(): void {
    for (const detach of this.#detachTransport) detach();
    this.#detachTransport = [];
  }

  #isStopping(): boolean {
    return this.#intentionalStop;
  }
}

export const spawnNdjsonWorkerTransport = (input: {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly maxLineBytes?: number;
}): WorkerTransport => {
  if (input.command.trim().length === 0) throw new Error("Worker command is empty.");
  const child = spawn(input.command, input.args ?? [], {
    cwd: input.cwd,
    env: { ...input.env },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return childProcessTransport(child, input.maxLineBytes ?? 1_048_576);
};

export const assertWorkerRpcResponse = (value: unknown): WorkerRpcResponse => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Worker RPC response must be an object.");
  }
  const response = value as Record<string, unknown>;
  if (
    response.protocol !== workerRpcProtocolVersion ||
    typeof response.id !== "string" ||
    !/^rpc-[A-Za-z0-9-]{8,100}$/.test(response.id) ||
    typeof response.ok !== "boolean"
  ) {
    throw new Error("Worker RPC response envelope is invalid.");
  }
  if (response.ok) return response as unknown as WorkerRpcResponse;
  if (response.error === null || typeof response.error !== "object" || Array.isArray(response.error)) {
    throw new Error("Worker RPC error response is invalid.");
  }
  const error = response.error as Record<string, unknown>;
  if (
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    typeof error.retryable !== "boolean"
  ) {
    throw new Error("Worker RPC error fields are invalid.");
  }
  return response as unknown as WorkerRpcResponse;
};

const childProcessTransport = (
  child: ChildProcessWithoutNullStreams,
  maxLineBytes: number,
): WorkerTransport => {
  const messageListeners = new Set<(message: unknown) => void>();
  const exitListeners = new Set<(exit: Readonly<{ code: number | null; signal: string | null }>) => void>();
  const logListeners = new Set<(line: string) => void>();
  let stdout = "";
  let stderr = "";
  const consume = (channel: "stdout" | "stderr", chunk: Buffer): void => {
    if (channel === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
    let buffer = channel === "stdout" ? stdout : stderr;
    if (Buffer.byteLength(buffer) > maxLineBytes) {
      for (const listener of logListeners) listener(`limit-exceeded: ${channel}`);
      if (channel === "stdout") stdout = "";
      else stderr = "";
      child.kill("SIGKILL");
      return;
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    if (channel === "stdout") stdout = buffer;
    else stderr = buffer;
    for (const line of lines) {
      if (channel === "stderr") {
        for (const listener of logListeners) listener(line);
      } else if (line.trim().length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch {
          for (const listener of logListeners) listener(`invalid-json: ${line}`);
          continue;
        }
        for (const listener of messageListeners) listener(parsed);
      }
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    consume("stdout", chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    consume("stderr", chunk);
  });
  child.once("exit", (code, signal) => {
    for (const listener of exitListeners) listener({ code, signal });
  });
  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    onLog(listener) {
      logListeners.add(listener);
      return () => logListeners.delete(listener);
    },
    terminate() {
      child.kill("SIGTERM");
    },
  };
};

const boundedInteger = (value: number, minimum: number, maximum: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Worker ${field} is outside bounded safe limits.`);
  }
  return value;
};

const abortError = (method: string): Error => new Error(`Worker RPC ${method} was cancelled.`);
const errorMessage = (cause: unknown): string =>
  redactText(cause instanceof Error ? cause.message : "Unknown worker failure.");
