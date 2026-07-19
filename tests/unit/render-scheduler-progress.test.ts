import { describe, expect, it } from "vitest";
import {
  RenderDagScheduler,
  RenderPauseController,
  RenderProgressAggregator,
  type RenderDag,
  type RenderDagNode,
  type RenderNodeExecutor,
} from "../../packages/render/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

describe("P20 render scheduling and truthful progress", () => {
  it("retries only within node bounds and preserves dependency order", async () => {
    let renderAttempts = 0;
    const executor = (kind: RenderDagNode["kind"]): RenderNodeExecutor => ({
      kind,
      execute: (node) => {
        if (node.id === "node-render" && ++renderAttempts === 1) throw new Error("retryable worker loss");
        return Promise.resolve({ nodeId: node.id, artifacts: [], logs: [], warnings: [] });
      },
    });
    const scheduler = new RenderDagScheduler(
      [executor("validate"), executor("shared-media"), executor("receipt")],
      { maximumConcurrency: 3, trustedConcurrency: 3, untrustedConcurrency: 1, gpuSlots: 1 },
    );
    const result = await scheduler.execute(dag, (_node, results) => context(results));
    expect(renderAttempts).toBe(2);
    expect(result.executionOrder).toEqual(["node-validate", "node-render", "node-receipt"]);
  });

  it("resumes only explicitly resumable completed nodes", async () => {
    const executed: string[] = [];
    const executor = (kind: RenderDagNode["kind"]): RenderNodeExecutor => ({
      kind,
      execute: (node) => {
        executed.push(node.id);
        return Promise.resolve({ nodeId: node.id, artifacts: [], logs: [], warnings: [] });
      },
    });
    const scheduler = new RenderDagScheduler(
      [executor("validate"), executor("shared-media"), executor("receipt")],
      2,
    );
    await scheduler.execute(dag, (_node, results) => context(results), {
      resumeResults: new Map([
        ["node-validate", { nodeId: "node-validate", artifacts: [], logs: [], warnings: [] }],
      ]),
    });
    expect(executed).toEqual(["node-render", "node-receipt"]);
  });

  it("holds paused work, propagates cancellation, and never reports complete before validation", async () => {
    const pause = new RenderPauseController();
    pause.pause();
    const controller = new AbortController();
    let executed = false;
    const scheduler = new RenderDagScheduler(
      dag.nodes.map((node) => ({
        kind: node.kind,
        execute: (current) => {
          executed = true;
          return Promise.resolve({ nodeId: current.id, artifacts: [], logs: [], warnings: [] });
        },
      })),
      1,
    );
    const pending = scheduler.execute(
      dag,
      (_node, results) => ({ ...context(results), signal: controller.signal }),
      { pause },
    );
    await Promise.resolve();
    expect(executed).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    const progress = new RenderProgressAggregator(dag);
    for (const node of dag.nodes) {
      progress.update({
        nodeId: node.id,
        stage: "finished",
        progress: 1,
        completedFrames: "30",
        totalFrames: "30",
        cache: node.id === "node-render" ? "hit" : "bypass",
        engine: null,
        clipId: null,
        estimatedRemainingMs: 0,
      });
    }
    expect(progress.snapshot()).toMatchObject({ complete: false, progress: 0.999_999, cacheHits: 1 });
    for (const node of dag.nodes) progress.markArtifactsValidated(node.id);
    expect(progress.snapshot()).toMatchObject({ complete: true, progress: 1, completedNodes: 3 });
  });
});

const renderNode = (
  id: string,
  kind: RenderDagNode["kind"],
  dependsOn: readonly string[],
): RenderDagNode => ({
  schemaVersion: "1.0.0",
  id,
  kind,
  label: id,
  dependsOn,
  input: {},
  expectedOutputs: [],
  cachePolicy: "strict",
  trustClass: "trusted-authored",
  resources: { cpu: 1, memoryMiB: 64, gpu: "none", browser: false },
  retryPolicy: { maxAttempts: id === "node-render" ? 2 : 1, resumable: true, retryableStages: [] },
});

const dag: RenderDag = {
  schemaVersion: "1.0.0",
  id: "render-dag-scheduler",
  projectId: "project-scheduler",
  revisionId: "revision-scheduler",
  timelineId: "timeline-scheduler",
  range: { startFrame: "0", endFrameExclusive: "30" },
  fps: normalizeRational(30n, 1n),
  nodes: [
    renderNode("node-validate", "validate", []),
    renderNode("node-render", "shared-media", ["node-validate"]),
    renderNode("node-receipt", "receipt", ["node-render"]),
  ],
  roots: ["node-receipt"],
};

const context = (results: ReadonlyMap<string, unknown>) => ({
  projectRoot: "/tmp/project",
  workingDirectory: "/tmp/render",
  environment: {
    strictEnvironmentFingerprint: "0".repeat(64),
    compatiblePreviewFingerprint: "1".repeat(64),
    strictManifest: {} as never,
    previewManifest: {} as never,
  },
  signal: new AbortController().signal,
  report: () => undefined,
  dependencyArtifacts: new Map([...results.keys()].map((key) => [key, []] as const)) as ReadonlyMap<
    string,
    never[]
  >,
});
