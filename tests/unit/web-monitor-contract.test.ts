import { describe, expect, it } from "vitest";
import {
  applyContractMockPreviewCommand,
  applySourceInspectionCommand,
  assertFoundationSourceInspectionBoundary,
  calculateMonitorViewport,
  forbiddenFoundationSourceActions,
  formatMonitorTimecode,
  foundationSourceInspectionActions,
  mapMonitorPointToComposition,
  monitorCommandForShortcut,
  monitorTruthPresentation,
  previewControlRequests,
  type SourceInspectionState,
} from "../../apps/studio-web/src/monitor-contract.js";
import { defaultStudioSnapshot } from "../../apps/studio-web/src/types.js";

describe("P13 program monitor geometry", () => {
  it("maps fit-mode canvas points exactly through letterbox and high-DPI scaling", () => {
    const geometry = calculateMonitorViewport({
      sourceWidth: 1920,
      sourceHeight: 1080,
      containerWidth: 1000,
      containerHeight: 1000,
      fitMode: "fit",
      zoom: 1,
      panX: 0,
      panY: 0,
      devicePixelRatio: 2,
    });
    expect(geometry).toMatchObject({
      displayWidth: 1000,
      displayHeight: 562.5,
      offsetX: 0,
      offsetY: 218.75,
      bars: "letterbox",
      backingWidth: 2000,
      backingHeight: 2000,
    });
    expect(mapMonitorPointToComposition(geometry, 500, 500)).toEqual({
      inside: true,
      normalizedX: 0.5,
      normalizedY: 0.5,
      sourceX: 960,
      sourceY: 540,
    });
    expect(mapMonitorPointToComposition(geometry, 500, 100).inside).toBe(false);
  });

  it("includes pan and zoom in normalized capture coordinates", () => {
    const geometry = calculateMonitorViewport({
      sourceWidth: 640,
      sourceHeight: 360,
      containerWidth: 640,
      containerHeight: 360,
      fitMode: "fill",
      zoom: 2,
      panX: 40,
      panY: -20,
      devicePixelRatio: 1,
    });
    const center = mapMonitorPointToComposition(geometry, 360, 160);
    expect(center.normalizedX).toBeCloseTo(0.5);
    expect(center.normalizedY).toBeCloseTo(0.5);
    expect(center.sourceX).toBeCloseTo(320);
    expect(center.sourceY).toBeCloseTo(180);
  });
});

describe("P13 authoritative transport projection", () => {
  it("routes buttons and keyboard shortcuts through the same command requests", () => {
    const keyboard = monitorCommandForShortcut("transport.next-frame");
    expect(keyboard).toEqual({ kind: "step-frame", delta: 1 });
    if (keyboard === null) throw new Error("Monitor shortcut fixture is missing.");
    expect(previewControlRequests(keyboard, defaultStudioSnapshot.preview)).toEqual([
      {
        endpoint: "step",
        body: { delta: 1, expectedStateVersion: 1 },
      },
    ]);
    expect(monitorCommandForShortcut("transport.shuttle-backward")).toEqual({
      kind: "shuttle",
      direction: "backward",
    });
  });

  it("projects frame, second, in/out, loop, and shuttle state without changing authority shape", () => {
    let preview = applyContractMockPreviewCommand(defaultStudioSnapshot.preview, {
      kind: "step-frame",
      delta: 1,
    });
    expect(preview).toMatchObject({ masterFrame: "445", stateVersion: 2, timecode: "00:00:14;25" });
    preview = applyContractMockPreviewCommand(preview, { kind: "mark-in" });
    expect(preview.inOutRange).toMatchObject({ startFrame: "445" });
    preview = applyContractMockPreviewCommand(preview, { kind: "step-second", seconds: 1 });
    expect(preview.masterFrame).toBe("475");
    preview = applyContractMockPreviewCommand(preview, { kind: "mark-out" });
    expect(preview.inOutRange).toEqual({ startFrame: "445", endFrameExclusive: "476" });
    preview = applyContractMockPreviewCommand(preview, { kind: "toggle-loop" });
    expect(preview.loopRange).toEqual(preview.inOutRange);
    preview = applyContractMockPreviewCommand(preview, { kind: "shuttle", direction: "backward" });
    expect(preview).toMatchObject({
      playRate: { numerator: "-1", denominator: "1" },
      playback: "playing",
    });
  });

  it("seeks to exact keyframe positions and clamps invalid timeline bounds", () => {
    expect(
      applyContractMockPreviewCommand(defaultStudioSnapshot.preview, { kind: "seek-frame", frame: "520" }),
    ).toMatchObject({
      masterFrame: "520",
      playback: "paused",
      stateVersion: 2,
    });
    expect(
      applyContractMockPreviewCommand(defaultStudioSnapshot.preview, { kind: "seek-frame", frame: "999999" })
        .masterFrame,
    ).toBe("17981");
    expect(
      applyContractMockPreviewCommand(defaultStudioSnapshot.preview, { kind: "seek-frame", frame: "-1" })
        .masterFrame,
    ).toBe("0");
  });

  it("formats exact non-drop and drop-frame displays", () => {
    expect(formatMonitorTimecode("444", { numerator: "30000", denominator: "1001" })).toBe("00:00:14;24");
    expect(formatMonitorTimecode("1800", { numerator: "30", denominator: "1" })).toBe("00:01:00:00");
  });
});

describe("P13 visible preview truth", () => {
  it("projects every fidelity, source, engine, buffering, dropped-frame, and warning state", () => {
    const finalTruth = monitorTruthPresentation({
      ...defaultStudioSnapshot.preview,
      mode: "rendered-fidelity",
      source: "original",
      engineState: "native",
      playback: "buffering",
      bufferingStatus: "waiting",
      droppedFrames: 7,
      warnings: [
        {
          code: "stale-cache",
          severity: "error",
          message: "Cached frame is stale.",
          layerId: "layer-title",
          remedy: { label: "Refresh", action: "preview.refresh" },
        },
        {
          code: "render-required",
          severity: "warning",
          message: "A final render is required.",
          layerId: null,
          remedy: { label: "Render", action: "render.start" },
        },
      ],
    });
    expect(finalTruth).toMatchObject({
      fidelityLabel: "Rendered fidelity",
      sourceLabel: "Original media",
      engineLabel: "Native",
      buffering: true,
      droppedFrameLabel: "7 dropped",
    });
    expect(finalTruth.warnings.map(({ code }) => code)).toEqual(["stale-cache", "render-required"]);

    const bakedTruth = monitorTruthPresentation({
      ...defaultStudioSnapshot.preview,
      engineState: "baked-fallback",
      warnings: [],
    });
    expect(bakedTruth).toMatchObject({
      fidelityLabel: "Interactive approximation",
      sourceLabel: "Proxy media",
      engineLabel: "Baked fallback",
      buffering: false,
      droppedFrameLabel: "2 dropped",
    });
    expect(bakedTruth.warnings).toEqual([
      {
        code: "interactive",
        severity: "warning",
        message: "Interactive approximation is not final truth.",
      },
    ]);
  });
});

describe("P13 Foundation source-inspection boundary", () => {
  it("contains review actions and rejects every reserved source-edit operation", () => {
    expect(() => {
      assertFoundationSourceInspectionBoundary(foundationSourceInspectionActions);
    }).not.toThrow();
    for (const action of forbiddenFoundationSourceActions) {
      expect(() => {
        assertFoundationSourceInspectionBoundary([...foundationSourceInspectionActions, action]);
      }).toThrow(/reserved edit actions/);
    }
  });

  it("scrubs, steps, auditions, and resets only the independent source state", () => {
    const state: SourceInspectionState = {
      sourceId: "asset-source-monitor-0001",
      sourceKind: "remotion",
      currentFrame: "10",
      durationFrames: "20",
      fps: { numerator: "24", denominator: "1" },
      auditionValues: {},
      auditionDirty: false,
    };
    const stepped = applySourceInspectionCommand(state, { kind: "step-frame", delta: 1 });
    expect(stepped.currentFrame).toBe("11");
    const auditioned = applySourceInspectionCommand(stepped, {
      kind: "audition-property",
      propertyId: "headline",
      value: "Preview only",
    });
    expect(auditioned).toMatchObject({
      auditionDirty: true,
      auditionValues: { headline: "Preview only" },
    });
    expect(applySourceInspectionCommand(auditioned, { kind: "reset-audition" })).toMatchObject({
      currentFrame: "11",
      auditionDirty: false,
      auditionValues: {},
    });
  });
});
