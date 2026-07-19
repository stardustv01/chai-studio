import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PreviewSessionService,
  ProjectSessionService,
  type PreviewAdapterPreloader,
} from "../../apps/studio-server/src/index.js";
import { commitProjectRevision, serializeBigInt } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("server preview session service", () => {
  it("preloads the bounded native-engine window and publishes adapter diagnostics", async () => {
    const parent = await temporaryDirectory();
    const projects = new ProjectSessionService();
    await projects.create({ targetPath: path.join(parent, "Native Preview.chai"), title: "Native Preview" });
    const snapshot = await projects.snapshot();
    const committedAt = new Date(Date.parse(snapshot.project.createdAt) + 1_000);
    const previewedAt = new Date(committedAt.getTime() + 1_000);
    await commitProjectRevision(projects.openRootPath(), {
      baseRevisionId: snapshot.pointer.revisionId,
      revisionId: "revision-preview-native-0002",
      commandId: "command-preview-timeline-0001",
      idempotencyId: "idempotency-preview-timeline-0001",
      actor: { id: "actor-preview-0001", kind: "user", sessionId: "session-preview-0001" },
      correlationId: "correlation-preview-timeline-0001",
      capability: { name: "timeline-edit", version: "1.0.0" },
      affectedEntityIds: [snapshot.timeline.timelineId],
      declaredScope: "destructive",
      authorizationId: "authorization-preview-timeline-0001",
      commandSummary: "Prepare native preview fixture",
      diffSummary: "Pinned Remotion and added a native preview clip.",
      documents: {
        project: {
          ...snapshot.project,
          enginePins: { ...snapshot.project.enginePins, remotion: "4.0.489" },
        },
        timeline: {
          ...snapshot.timeline,
          durationFrames: serializeBigInt(100n),
          tracks: [
            {
              id: "track-preview-video-0001",
              kind: "video",
              name: "Native video",
              order: 0,
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
              clips: [
                {
                  id: "clip-preview-native-0001",
                  assetId: null,
                  engine: "remotion",
                  startFrame: serializeBigInt(0n),
                  durationFrames: serializeBigInt(100n),
                  sourceInFrame: serializeBigInt(0n),
                  sourceDurationFrames: serializeBigInt(100n),
                  capability: "native",
                  audioBusId: null,
                },
              ],
            },
          ],
        },
        assets: snapshot.assets,
        settings: snapshot.settings,
        approvalState: snapshot.approvalState,
      },
      now: committedAt,
    });

    const calls: Parameters<PreviewAdapterPreloader>[0][] = [];
    const preview = new PreviewSessionService({
      projects,
      now: () => previewedAt,
      preloadAdapter: (input) => {
        calls.push(input);
        return Promise.resolve({
          engine: input.engine,
          required: true,
          status: "ready",
          adapterVersion: "fixture-1.0.0",
          processId: 8123,
          lastHeartbeatAt: "2026-07-15T14:11:00.000Z",
          loadedRevisionId: input.revisionId,
          loadedFrame: input.currentFrame,
          preloadedRange: { startFrame: input.startFrame, endFrame: input.endFrame },
          warning: null,
        });
      },
    });
    let status = await preview.load();
    status = await preview.control({ kind: "seek", frame: "50" }, status.state.stateVersion);
    status = await preview.preload({
      beforeFrames: 20,
      afterFrames: 30,
      expectedStateVersion: status.state.stateVersion,
    });

    expect(calls).toEqual([
      expect.objectContaining({
        engine: "remotion",
        currentFrame: "50",
        startFrame: "30",
        endFrame: "80",
      }),
    ]);
    expect(status.state.adapters.remotion).toMatchObject({
      status: "ready",
      loadedFrame: "50",
      preloadedRange: { startFrame: "30", endFrame: "80" },
    });
    status = await preview.control(
      { kind: "play-rate", playRate: { numerator: "2", denominator: "1" } },
      status.state.stateVersion,
    );
    status = await preview.control(
      { kind: "loop-range", range: { startFrame: "20", endFrameExclusive: "80" } },
      status.state.stateVersion,
    );
    status = await preview.control({ kind: "step-seconds", seconds: -1 }, status.state.stateVersion);
    expect(status.state).toMatchObject({
      currentFrame: "20",
      playRate: { numerator: "2", denominator: "1" },
      loopRange: { startFrame: "20", endFrameExclusive: "80" },
    });
    expect(status.state.warnings.map((item) => item.code)).toContain("audio-muted-for-rate");

    await preview.control({ kind: "play" }, status.state.stateVersion);
    await new Promise((resolve) => setTimeout(resolve, 140));
    const advanced = await preview.status();
    expect(BigInt(advanced.state.currentFrame)).toBeGreaterThan(20n);
    await preview.control({ kind: "pause" }, advanced.state.stateVersion);
    preview.unload();
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-preview-service-"));
  temporaryDirectories.push(directory);
  return directory;
};
