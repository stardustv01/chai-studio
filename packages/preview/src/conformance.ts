import { createPreviewFrameRange, presentationTimestampForFrame } from "./master-clock.js";
import type { PreviewAdapterConformanceResult, PreviewLayerAdapter } from "./preview-contract.js";

export const runPreviewAdapterConformance = async (
  createAdapter: () => PreviewLayerAdapter,
): Promise<PreviewAdapterConformanceResult> => {
  const adapter = createAdapter();
  const checks: Record<string, boolean> = {};
  const failures: string[] = [];
  const controller = new AbortController();
  const schedulerSessionId = "conformance-session-0001";
  const record = async (name: string, operation: () => Promise<boolean>): Promise<void> => {
    try {
      checks[name] = await operation();
      if (!checks[name]) failures.push(`${name} returned false.`);
    } catch (error) {
      checks[name] = false;
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await record("preload-half-open-range", async () => {
    const result = await adapter.preload(createPreviewFrameRange("2", "5"), controller.signal);
    return result.range.startFrame === "2" && result.range.endFrameExclusive === "5";
  });
  let firstIdentity = "";
  await record("exact-frame-presentation", async () => {
    const result = await adapter.presentFrame({
      schedulerSessionId,
      frame: "3",
      presentationTimestamp: presentationTimestampForFrame("3", { numerator: "30000", denominator: "1001" }),
      truthMode: "interactive-approximation",
      signal: controller.signal,
    });
    firstIdentity = result.artifactIdentity;
    return result.frame === "3" && result.layerId === adapter.layerId;
  });
  await record("repeat-seek-determinism", async () => {
    const result = await adapter.presentFrame({
      schedulerSessionId,
      frame: "3",
      presentationTimestamp: presentationTimestampForFrame("3", { numerator: "30000", denominator: "1001" }),
      truthMode: "interactive-approximation",
      signal: controller.signal,
    });
    return firstIdentity.length > 0 && result.artifactIdentity === firstIdentity;
  });
  await record("scheduler-owned-playback", async () => {
    await adapter.beginSynchronizedPlayback({
      schedulerSessionId,
      startFrame: "3",
      startPresentationTimestamp: presentationTimestampForFrame("3", {
        numerator: "30000",
        denominator: "1001",
      }),
      timelineFps: { numerator: "30000", denominator: "1001" },
      playRate: { numerator: "1", denominator: "1" },
      nativeAudioSuppressed: true,
      signal: controller.signal,
    });
    const report = await adapter.reportPlaybackState(schedulerSessionId);
    return report.schedulerSessionId === schedulerSessionId && report.adapterId === adapter.adapterId;
  });
  await record("halt-and-suspend", async () => {
    await adapter.halt(schedulerSessionId);
    await adapter.suspend();
    return true;
  });
  await record("disposal", async () => {
    await adapter.dispose();
    return true;
  });
  return {
    adapterId: adapter.adapterId,
    adapterVersion: adapter.version,
    passed: failures.length === 0,
    checks,
    failures,
  };
};
