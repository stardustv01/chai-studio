import { describe, expect, it } from "vitest";
import { resolvePreviewDegradation } from "../../packages/preview/src/index.js";

describe("P26 honest preview degradation", () => {
  it("keeps nominal preview distinct from rendered fidelity", () => {
    expect(
      resolvePreviewDegradation({ droppedFrames: 0, loadClass: "nominal", renderRangeAvailable: false }),
    ).toMatchObject({
      level: 0,
      step: "nominal",
      visible: false,
      framePerfectRealtimeClaimed: false,
      reversible: true,
    });
  });

  it("reports dropped frames before reducing quality", () => {
    expect(
      resolvePreviewDegradation({ droppedFrames: 3, loadClass: "elevated", renderRangeAvailable: false }),
    ).toMatchObject({
      level: 1,
      step: "report-dropped-frames",
      droppedFrames: 3,
      message: "3 preview frames dropped. Playback is not frame-perfect real time.",
    });
  });

  it("moves critical ranges to explicit rendered-range fallback", () => {
    const state = resolvePreviewDegradation({
      droppedFrames: 20,
      loadClass: "critical",
      renderRangeAvailable: true,
    });
    expect(state).toMatchObject({ level: 4, step: "render-preview-range", previousLevel: 3, nextLevel: 4 });
    expect(state.qualityPolicy.fidelityEquivalent).toBe(false);
  });
});
