import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioApiError } from "../../apps/studio-web/src/api-client.js";
import { initialStudioSnapshot } from "../../apps/studio-web/src/runtime-snapshot.js";
import {
  fetchStudioResyncState,
  previewTruthFromPayload,
  previewResyncActionFromSettled,
  retryProjectSessionTransition,
  type StudioResyncClient,
} from "../../apps/studio-web/src/use-studio-runtime.js";

const studioError = (code: string): StudioApiError =>
  new StudioApiError({
    category: "project",
    code,
    stage: "project-session",
    entityId: null,
    retryable: true,
    message: code,
    repairHint: null,
    correlationId: "runtime-recovery-test",
    detail: null,
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("web runtime project resynchronization", () => {
  it("keeps project state authoritative when an empty project has no preview session", async () => {
    const previewUnavailable = studioError("server.preview-not-loaded");
    const project = { project: { projectId: "project-reset", title: "Evidence Reset" } };
    const client = {
      previewSnapshot: vi.fn().mockRejectedValue(previewUnavailable),
      renderQueue: vi.fn().mockResolvedValue([]),
      projectSnapshot: vi.fn().mockResolvedValue(project),
      projectRevisions: vi.fn().mockResolvedValue([{}, {}]),
    } satisfies StudioResyncClient;

    const synchronized = await fetchStudioResyncState(client);

    expect(synchronized.project).toEqual({ ...project, revisionNumber: 2 });
    expect(synchronized.preview).toEqual({ status: "rejected", reason: previewUnavailable });
    expect(synchronized.queue).toEqual({ status: "fulfilled", value: [] });
    expect(previewResyncActionFromSettled(synchronized.preview)).toEqual({
      type: "preview-local",
      preview: initialStudioSnapshot.preview,
    });
  });

  it("rejects the resync when the mandatory project snapshot is unavailable", async () => {
    const mandatoryFailure = new Error("project snapshot unavailable");
    const client = {
      previewSnapshot: vi.fn().mockResolvedValue({ stateVersion: 1 }),
      renderQueue: vi.fn().mockResolvedValue([]),
      projectSnapshot: vi.fn().mockRejectedValue(mandatoryFailure),
      projectRevisions: vi.fn().mockResolvedValue([]),
    } satisfies StudioResyncClient;

    await expect(fetchStudioResyncState(client)).rejects.toBe(mandatoryFailure);
  });

  it("projects fulfilled preview state and preserves unexpected failures for diagnostics", () => {
    const preview = { stateVersion: 4, currentFrame: "12" };
    expect(previewResyncActionFromSettled({ status: "fulfilled", value: preview })).toEqual({
      type: "preview-state",
      payload: preview,
    });
    expect(
      previewResyncActionFromSettled({ status: "rejected", reason: studioError("server.offline") }),
    ).toBeNull();
  });

  it("projects synchronized interactive preview timing without retaining prior-project truth", () => {
    const projected = previewTruthFromPayload(initialStudioSnapshot.preview, {
      currentFrame: "12",
      durationFrames: "48",
      timelineFps: { numerator: "24", denominator: "1" },
      playRate: { numerator: "1", denominator: "2" },
      stateVersion: 4,
      truthMode: "interactive-approximation",
      transport: "paused",
      buffering: { status: "ready" },
      loopRange: { startFrame: "4", endFrameExclusive: "20" },
      inOutRange: { startFrame: "8", endFrameExclusive: "16" },
      warnings: [
        {
          code: "baked-fallback",
          severity: "warning",
          message: "A baked layer is active.",
          layerId: null,
          remedy: { label: "Inspect layer", action: "preview.inspect-layer" },
        },
      ],
    });

    expect(projected).toMatchObject({
      masterFrame: "12",
      durationFrames: "48",
      timelineFps: { numerator: "24", denominator: "1" },
      playRate: { numerator: "1", denominator: "2" },
      mode: "interactive",
      source: "proxy",
      engineState: "baked-fallback",
      playback: "paused",
      loopRange: { startFrame: "4", endFrameExclusive: "20" },
      inOutRange: { startFrame: "8", endFrameExclusive: "16" },
    });

    const malformedTiming = previewTruthFromPayload(projected, {
      timelineFps: { numerator: "invalid", denominator: "0" },
      playRate: { numerator: "1", denominator: "0" },
      loopRange: { startFrame: 4, endFrameExclusive: "20" },
    });
    expect(malformedTiming.timelineFps).toEqual(projected.timelineFps);
    expect(malformedTiming.playRate).toEqual(projected.playRate);
    expect(malformedTiming.loopRange).toBeNull();
  });
});

describe("web runtime project transition recovery", () => {
  it("retries transient project-session conflicts with bounded backoff", async () => {
    vi.useFakeTimers();
    const conflict = studioError("server.project-state-conflict");
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValue("ready");

    const result = retryProjectSessionTransition(operation);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry failures unrelated to project-session conflicts", async () => {
    const failure = new Error("permission denied");
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(failure);

    await expect(retryProjectSessionTransition(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("stops retrying a project-session conflict when the recovery window expires", async () => {
    const conflict = studioError("server.project-state-conflict");
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(10_000);
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(conflict);

    await expect(retryProjectSessionTransition(operation)).rejects.toBe(conflict);
    expect(operation).toHaveBeenCalledOnce();
  });
});
