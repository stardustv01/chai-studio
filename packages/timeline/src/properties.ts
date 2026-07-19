import type { TimelineEngine, TimelinePropertyState } from "./model.js";

export type TimelineClipPropertyKind = "visual" | "audio";

export const createDefaultTimelineClipProperties = (input: {
  readonly engine: TimelineEngine;
  readonly kind: TimelineClipPropertyKind;
  readonly hasAudio: boolean;
}): Readonly<Record<string, TimelinePropertyState>> => ({
  ...(input.kind === "visual"
    ? {
        "transform.position": sharedProperty([0, 0], [0, 0], "px", -32_768, 32_768, 0.1),
        "transform.scale": sharedProperty([100, 100], [100, 100], "percent", 0, 1_000, 0.1),
        "transform.rotation": {
          ...sharedProperty(0, 0, "degrees", -360_000, 360_000, 0.1),
          ownership: input.engine === "shared" ? "shared" : "engine-native",
          safeToEdit: input.engine === "shared",
          nativeAnimation: input.engine !== "shared",
          supportsSharedConversion: input.engine !== "shared",
        } satisfies TimelinePropertyState,
        "transform.anchor": sharedProperty([50, 50], [50, 50], "percent", -1_000, 1_000, 0.1),
        "transform.opacity": sharedProperty(100, 100, "percent", 0, 100, 0.1),
        "transform.crop": sharedProperty([0, 0, 0, 0], [0, 0, 0, 0], "percent", 0, 100, 0.1),
        "composite.blendMode": sharedProperty("normal", "normal", "enum", null, null, null, false),
        "time.speed": sharedProperty(1, 1, "ratio", 0.01, 100, 0.01),
      }
    : {}),
  ...(input.hasAudio || input.kind === "audio"
    ? {
        "audio.volume": sharedProperty(0, 0, "decibels", -96, 12, 0.1),
        "audio.fadeIn": sharedProperty(0, 0, "frames", 0, 100_000, 1),
        "audio.fadeOut": sharedProperty(0, 0, "frames", 0, 100_000, 1),
      }
    : {}),
});

const sharedProperty = (
  value: TimelinePropertyState["value"],
  defaultValue: TimelinePropertyState["defaultValue"],
  unit: TimelinePropertyState["unit"],
  minimum: number | null,
  maximum: number | null,
  step: number | null,
  keyframeable = true,
): TimelinePropertyState => ({
  value,
  defaultValue,
  unit,
  minimum,
  maximum,
  step,
  ownership: "shared",
  keyframeable,
  capability: "unified",
  safeToEdit: true,
  nativeAnimation: false,
  supportsSharedConversion: false,
});
