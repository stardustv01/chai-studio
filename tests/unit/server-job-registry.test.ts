import { describe, expect, it } from "vitest";
import { StudioJobRegistry } from "../../apps/studio-server/src/index.js";

describe("Studio background job registry", () => {
  it("publishes ordered queued/running/progress/completed snapshots and retains results", async () => {
    const registry = new StudioJobRegistry(() => new Date("2026-07-15T13:30:00.000Z"));
    const states: string[] = [];
    registry.subscribe((snapshot) => {
      states.push(`${snapshot.status}:${snapshot.progress.toFixed(2)}`);
    });
    const queued = registry.enqueue({
      id: "job-inspect-0001",
      kind: "asset.inspect",
      correlationId: "correlation-job-0001",
      projectId: "project-job-0001",
      revisionId: "revision-job-0001",
      task: ({ report }) => {
        report(0.5);
        return Promise.resolve({ codec: "fixture" });
      },
    });
    expect(queued.status).toBe("queued");
    expect(await registry.wait(queued.id)).toMatchObject({
      status: "completed",
      progress: 1,
      result: { codec: "fixture" },
    });
    expect(states).toEqual(["queued:0.00", "running:0.00", "running:0.50", "completed:1.00"]);
    expect(registry.list()).toHaveLength(1);
  });

  it("cancels running work without allowing late completion to overwrite cancellation", async () => {
    const registry = new StudioJobRegistry();
    let finish = (): void => {
      throw new Error("Job task did not start.");
    };
    const queued = registry.enqueue({
      id: "job-proxy-0001",
      kind: "asset.proxy",
      correlationId: "correlation-job-0002",
      projectId: "project-job-0001",
      revisionId: "revision-job-0001",
      task: () =>
        new Promise((resolve) => {
          finish = () => {
            resolve({ late: true });
          };
        }),
    });
    await Promise.resolve();
    expect(registry.cancel(queued.id).status).toBe("cancelled");
    finish();
    expect(await registry.wait(queued.id)).toMatchObject({ status: "cancelled", result: null });
  });
});
