import { describe, expect, it } from "vitest";
import {
  previewTruthFromPayload,
  renderTruthFromPayload,
} from "../../apps/studio-web/src/use-studio-runtime.js";
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

describe("web render event projection", () => {
  it("ignores non-render delivery jobs instead of presenting them as an active render", () => {
    expect(
      renderTruthFromPayload(defaultStudioSnapshot.render, {
        job: {
          kind: "delivery.publish-receipt",
          status: "running",
          progress: 0.5,
          stage: "Publish receipt",
        },
      }),
    ).toEqual(defaultStudioSnapshot.render);
  });

  it("prefers the active render in queue projections and clears an empty queue", () => {
    expect(
      renderTruthFromPayload(defaultStudioSnapshot.render, [
        {
          job: {
            kind: "render.execute",
            status: "completed",
            progress: 1,
            stage: "Rendered",
          },
        },
        {
          job: {
            kind: "render.execute",
            status: "running",
            progress: 0.4,
            stage: "Compositing",
          },
        },
      ]),
    ).toMatchObject({ status: "rendering", progress: 0.4, stage: "Compositing" });

    expect(
      renderTruthFromPayload(
        { ...defaultStudioSnapshot.render, status: "rendering", progress: 0.5, stage: "Compositing" },
        [],
      ),
    ).toMatchObject({ status: "idle", progress: 0, stage: "Ready" });
  });
});
