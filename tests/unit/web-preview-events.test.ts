import { describe, expect, it } from "vitest";
import { previewTruthFromPayload } from "../../apps/studio-web/src/use-studio-runtime.js";
import { defaultStudioSnapshot } from "../../apps/studio-web/src/types.js";

describe("web preview event projection", () => {
  it("projects authoritative frame, transport, truth, dropped frames, and remedy warnings", () => {
    const projected = previewTruthFromPayload(defaultStudioSnapshot.preview, {
      currentFrame: "900",
      truthMode: "rendered-fidelity",
      transport: "buffering",
      droppedFrames: 4,
      warnings: [
        {
          code: "missing-font",
          severity: "error",
          message: "Preview font is missing.",
          layerId: "font-missing-0001",
          remedy: { label: "Resolve font", action: "media.resolve-font" },
        },
      ],
    });
    expect(projected).toMatchObject({
      masterFrame: "900",
      mode: "rendered-fidelity",
      source: "original",
      playback: "buffering",
      droppedFrames: 4,
    });
    expect(projected.warnings).toEqual([
      expect.objectContaining({
        code: "missing-font",
        remedy: { label: "Resolve font", action: "media.resolve-font" },
      }),
    ]);
  });

  it("rejects malformed warning payloads instead of trusting server-shaped unknown data", () => {
    expect(
      previewTruthFromPayload(defaultStudioSnapshot.preview, {
        warnings: [{ code: "bad", severity: "panic", message: 4, remedy: null }],
      }).warnings,
    ).toEqual([]);
  });
});
