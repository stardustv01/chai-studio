import { describe, expect, it } from "vitest";
import {
  advancePreviewPlayback,
  applyPreviewControl,
  applyPreviewPreload,
  createPreviewSessionState,
  updatePreviewAdapterDiagnostics,
} from "../../packages/preview/src/index.js";

const loadedAt = "2026-07-15T14:00:00.000Z";

describe("preview session state machine", () => {
  it("controls exact frames, truth mode, quality, preload, and adapter diagnostics", () => {
    let state = createPreviewSessionState({
      sessionId: "preview-session-0001",
      projectId: "project-preview-0001",
      revisionId: "revision-preview-0001",
      timelineId: "timeline-preview-0001",
      durationFrames: "100",
      requiredEngines: ["remotion"],
      now: loadedAt,
    });
    expect(state).toMatchObject({
      currentFrame: "0",
      transport: "paused",
      truthMode: "interactive-approximation",
      approximationWarningVisible: true,
      adapters: {
        remotion: { required: true, status: "disconnected" },
        hyperframes: { required: false, status: "not-required" },
      },
    });

    state = applyPreviewControl(state, { kind: "play" }, "2026-07-15T14:00:01.000Z");
    state = applyPreviewControl(state, { kind: "seek", frame: "50" }, "2026-07-15T14:00:02.000Z");
    state = applyPreviewControl(state, { kind: "step", delta: 100 }, "2026-07-15T14:00:03.000Z");
    expect(state).toMatchObject({ currentFrame: "99", transport: "paused" });

    state = applyPreviewControl(
      state,
      { kind: "quality", quality: "full", truthMode: "rendered-fidelity" },
      "2026-07-15T14:00:04.000Z",
    );
    state = applyPreviewPreload(state, { beforeFrames: 24, afterFrames: 60 }, "2026-07-15T14:00:05.000Z");
    state = updatePreviewAdapterDiagnostics(
      state,
      {
        engine: "remotion",
        required: true,
        status: "ready",
        adapterVersion: "4.0.489",
        processId: 1234,
        lastHeartbeatAt: "2026-07-15T14:00:05.000Z",
        loadedRevisionId: state.revisionId,
        loadedFrame: state.currentFrame,
        preloadedRange: { startFrame: "75", endFrame: "99" },
        warning: null,
      },
      "2026-07-15T14:00:06.000Z",
    );
    expect(state).toMatchObject({
      quality: "full",
      truthMode: "rendered-fidelity",
      approximationWarningVisible: false,
      preload: { beforeFrames: 24, afterFrames: 60 },
      adapters: { remotion: { status: "ready", loadedFrame: "99" } },
    });
  });

  it("rejects empty playback, out-of-range seeks, and unbounded frame steps", () => {
    const empty = createPreviewSessionState({
      sessionId: "preview-session-empty",
      projectId: "project-preview-empty",
      revisionId: "revision-preview-empty",
      timelineId: "timeline-preview-empty",
      durationFrames: "0",
      requiredEngines: [],
      now: loadedAt,
    });
    expect(() => applyPreviewControl(empty, { kind: "play" }, loadedAt)).toThrow(/empty timeline/);

    const populated = { ...empty, durationFrames: "10" };
    expect(() => applyPreviewControl(populated, { kind: "seek", frame: "10" }, loadedAt)).toThrow(
      /outside the timeline/,
    );
    expect(() => applyPreviewControl(populated, { kind: "step", delta: 1_001 }, loadedAt)).toThrow(
      /bounded safe limits/,
    );
  });

  it("tracks rational timing, second steps, ranges, rate policy, and visible warnings", () => {
    let state = createPreviewSessionState({
      sessionId: "preview-session-rational",
      projectId: "project-preview-rational",
      revisionId: "revision-preview-rational",
      timelineId: "timeline-preview-rational",
      durationFrames: "120",
      timelineFps: { numerator: "30000", denominator: "1001" },
      requiredEngines: [],
      now: loadedAt,
    });
    state = applyPreviewControl(state, { kind: "step-seconds", seconds: 1 }, loadedAt);
    expect(state).toMatchObject({
      currentFrame: "30",
      presentationTimestamp: { numerator: "1001", denominator: "1000" },
    });
    state = applyPreviewControl(
      state,
      { kind: "loop-range", range: { startFrame: "30", endFrameExclusive: "60" } },
      loadedAt,
    );
    state = applyPreviewControl(
      state,
      { kind: "in-out-range", range: { startFrame: "10", endFrameExclusive: "100" } },
      loadedAt,
    );
    state = applyPreviewControl(
      state,
      { kind: "play-rate", playRate: { numerator: "2", denominator: "1" } },
      loadedAt,
    );
    expect(state).toMatchObject({
      playRate: { numerator: "2", denominator: "1" },
      loopRange: { startFrame: "30", endFrameExclusive: "60" },
      inOutRange: { startFrame: "10", endFrameExclusive: "100" },
    });
    expect(state.warnings.map((item) => item.code)).toContain("audio-muted-for-rate");
  });

  it("advances forward and reverse playback, pauses at boundaries, and wraps exact loop ranges", () => {
    let state = createPreviewSessionState({
      sessionId: "preview-session-clock",
      projectId: "project-preview-clock",
      revisionId: "revision-preview-clock",
      timelineId: "timeline-preview-clock",
      durationFrames: "100",
      requiredEngines: [],
      now: loadedAt,
    });
    state = applyPreviewControl(state, { kind: "play" }, loadedAt);
    const controlVersion = state.stateVersion;
    state = advancePreviewPlayback(state, 12n, "2026-07-15T14:00:01.000Z");
    expect(state).toMatchObject({ currentFrame: "12", transport: "playing", stateVersion: controlVersion });

    state = advancePreviewPlayback(state, 200n, "2026-07-15T14:00:02.000Z");
    expect(state).toMatchObject({ currentFrame: "99", transport: "paused" });

    state = applyPreviewControl(
      state,
      { kind: "loop-range", range: { startFrame: "20", endFrameExclusive: "30" } },
      loadedAt,
    );
    state = applyPreviewControl(state, { kind: "seek", frame: "28" }, loadedAt);
    state = applyPreviewControl(state, { kind: "play" }, loadedAt);
    state = advancePreviewPlayback(state, 5n, "2026-07-15T14:00:03.000Z");
    expect(state).toMatchObject({ currentFrame: "23", transport: "playing" });

    state = advancePreviewPlayback(state, -7n, "2026-07-15T14:00:04.000Z");
    expect(state).toMatchObject({ currentFrame: "26", transport: "playing" });
  });
});
