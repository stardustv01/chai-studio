import { describe, expect, it } from "vitest";
import {
  createPreviewFrameRange,
  defaultPreviewTransform,
  emptyPreviewCrop,
  PreviewScheduler,
  SharedPreviewAdapter,
  type SharedSolidClip,
} from "../../packages/preview/src/index.js";
import {
  DeterministicAudioFollower,
  DeterministicFinalCompositor,
  DeterministicPreviewAdapter,
} from "../fixtures/preview-fixtures.js";

describe("P12 real shared adapter mixed-engine fixture", () => {
  it("keeps shared, Remotion, and HyperFrames layers aligned under repeated exact seeks", async () => {
    const remotion = new DeterministicPreviewAdapter(
      "adapter-remotion-p12",
      "layer-remotion-p12",
      "remotion",
    );
    const hyperframes = new DeterministicPreviewAdapter(
      "adapter-hyperframes-p12",
      "layer-hyperframes-p12",
      "hyperframes",
    );
    const shared = new SharedPreviewAdapter({
      adapterId: "adapter-shared-p12",
      clip: sharedClip(),
    });
    const scheduler = new PreviewScheduler({
      projectId: "project-preview-p12",
      revisionId: "revision-preview-p12",
      timelineId: "timeline-preview-p12",
      durationFrames: "300",
      timelineFps: { numerator: "30000", denominator: "1001" },
      adapters: [remotion, hyperframes, shared],
      layerGraph: [
        layer(shared.adapterId, shared.layerId, "shared", 0),
        layer(remotion.adapterId, remotion.layerId, "remotion", 10),
        layer(hyperframes.adapterId, hyperframes.layerId, "hyperframes", 20),
      ],
      audio: new DeterministicAudioFollower(),
      finalCompositor: new DeterministicFinalCompositor(),
    });
    const identities = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const result = await scheduler.seek("100");
      identities.push(result.composite.identity);
      expect(result.composite.layers).toHaveLength(3);
      await scheduler.play();
      scheduler.advanceAuthoritativeFrames(2n);
      await scheduler.pause();
    }
    expect(new Set(identities)).toHaveLength(1);
    expect(scheduler.snapshot().clock.masterFrame).toBe("102");
  });
});

const sharedClip = (): SharedSolidClip => ({
  kind: "solid",
  clipId: "clip-shared-p12",
  layerId: "layer-shared-p12",
  timelineRange: createPreviewFrameRange("0", "300"),
  alphaMode: "straight",
  effects: {
    transform: defaultPreviewTransform,
    opacity: 0.75,
    crop: emptyPreviewCrop,
    blendMode: "normal",
    adjustmentRefs: [],
    capabilities: [],
  },
  color: { red: 0.05, green: 0.08, blue: 0.12, alpha: 0.75 },
});

const layer = (
  adapterId: string,
  id: string,
  kind: "shared" | "remotion" | "hyperframes",
  zIndex: number,
) => ({
  id,
  adapterId,
  kind,
  timelineRange: createPreviewFrameRange("0", "300"),
  zIndex,
  sourceOrder: zIndex,
  opacity: 1,
  blendMode: "normal" as const,
  transform: defaultPreviewTransform,
  crop: emptyPreviewCrop,
  visible: true,
});
