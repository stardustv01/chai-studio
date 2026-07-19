import { describe, expect, it } from "vitest";
import {
  WorkerSupervisor,
  workerRpcProtocolVersion,
  type WorkerRpcRequest,
  type WorkerTransport,
} from "../../apps/studio-server/src/index.js";

describe("worker supervisor", () => {
  it("executes typed RPC, heartbeats, cancels requests, and redacts bounded logs", async () => {
    const transport = new FakeTransport();
    const supervisor = new WorkerSupervisor({
      name: "worker-fixture-0001",
      createTransport: () => transport,
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 50,
      requestTimeoutMs: 500,
      maxLogEntries: 10,
    });
    await supervisor.start();
    await expect(supervisor.call("fixture.echo", { value: 42 })).resolves.toEqual({ value: 42 });

    const controller = new AbortController();
    const slow = supervisor.call("fixture.slow", {}, { signal: controller.signal });
    controller.abort();
    await expect(slow).rejects.toThrow(/cancelled/);
    expect(transport.sent.some((request) => request.method === "system.cancel")).toBe(true);

    transport.log("token=super-secret /Users/praveengupta/project/source.ts");
    expect(supervisor.logs()[0]?.line).toBe("token=[REDACTED] $HOME/project/source.ts");
    await waitFor(() => supervisor.diagnostics().lastHeartbeatAt !== null);
    expect(supervisor.diagnostics()).toMatchObject({ status: "healthy", activeRequestCount: 0 });
    supervisor.stop();
    expect(supervisor.diagnostics().status).toBe("stopped");
  });

  it("restarts after an unexpected exit and stops at the bounded restart limit", async () => {
    const transports: FakeTransport[] = [];
    const supervisor = new WorkerSupervisor({
      name: "worker-restart-0001",
      createTransport: () => {
        const transport = new FakeTransport();
        transports.push(transport);
        return transport;
      },
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 100,
      maxRestarts: 1,
      restartDelayMs: 0,
    });
    await supervisor.start();
    transports[0]?.crash(23);
    await waitFor(() => transports.length === 2 && supervisor.diagnostics().status === "healthy");
    expect(supervisor.diagnostics()).toMatchObject({ generation: 2, restartCount: 1 });
    transports[1]?.crash(24);
    await waitFor(() => supervisor.diagnostics().status === "failed");
    expect(supervisor.diagnostics()).toMatchObject({ status: "failed", restartCount: 1 });
    supervisor.stop();
  });
});

class FakeTransport implements WorkerTransport {
  readonly sent: WorkerRpcRequest[] = [];
  readonly #messageListeners = new Set<(message: unknown) => void>();
  readonly #exitListeners = new Set<
    (exit: Readonly<{ code: number | null; signal: string | null }>) => void
  >();
  readonly #logListeners = new Set<(line: string) => void>();

  send(message: WorkerRpcRequest): void {
    this.sent.push(message);
    if (message.method === "fixture.slow" || message.method === "system.cancel") return;
    queueMicrotask(() => {
      for (const listener of this.#messageListeners) {
        listener({
          protocol: workerRpcProtocolVersion,
          id: message.id,
          ok: true,
          result: message.method === "fixture.echo" ? message.params : { pong: true },
        });
      }
    });
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onExit(listener: (exit: Readonly<{ code: number | null; signal: string | null }>) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  onLog(listener: (line: string) => void): () => void {
    this.#logListeners.add(listener);
    return () => this.#logListeners.delete(listener);
  }

  terminate(): void {
    this.crash(null, "SIGTERM");
  }

  crash(code: number | null, signal: string | null = null): void {
    for (const listener of [...this.#exitListeners]) listener({ code, signal });
  }

  log(line: string): void {
    for (const listener of this.#logListeners) listener(line);
  }
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for worker supervisor state.");
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
};
