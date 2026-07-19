import type { AudioGraphDocument } from "@chai-studio/schema";

export interface AudioInspectorDescriptor {
  readonly context: "audio-clip" | "audio-bus" | "audio-master";
  readonly entityId: string;
  readonly fields: readonly Readonly<{
    property: "gainDb" | "pan" | "muted" | "solo" | "fadeInFrames" | "fadeOutFrames";
    unit: "decibels" | "ratio" | "boolean" | "frames";
    keyframeable: boolean;
    minimum: number | null;
    maximum: number | null;
  }>[];
  readonly waveformVisible: boolean;
  readonly meterVisible: boolean;
  readonly automationLaneIds: readonly string[];
  readonly syncAnchorIds: readonly string[];
}

export const createAudioInspectorDescriptor = (
  graph: AudioGraphDocument,
  entityId: string,
): AudioInspectorDescriptor => {
  const clip = graph.clips.find((item) => item.id === entityId);
  if (clip !== undefined) {
    return {
      context: "audio-clip",
      entityId,
      fields: [
        field("gainDb", "decibels", true, -120, 24),
        field("pan", "ratio", true, -1, 1),
        field("muted", "boolean", false, null, null),
        field("fadeInFrames", "frames", false, 0, null),
        field("fadeOutFrames", "frames", false, 0, null),
      ],
      waveformVisible: true,
      meterVisible: false,
      automationLaneIds: clip.automationLaneIds,
      syncAnchorIds: clip.syncAnchorIds,
    };
  }
  const bus = graph.buses.find((item) => item.id === entityId);
  if (bus === undefined) throw new Error(`Unknown audio inspector entity: ${entityId}.`);
  return {
    context: bus.kind === "master" ? "audio-master" : "audio-bus",
    entityId,
    fields: [
      field("gainDb", "decibels", true, -120, 24),
      field("pan", "ratio", true, -1, 1),
      field("muted", "boolean", false, null, null),
      field("solo", "boolean", false, null, null),
    ],
    waveformVisible: false,
    meterVisible: true,
    automationLaneIds: bus.automationLaneIds,
    syncAnchorIds: [],
  };
};

const field = (
  property: AudioInspectorDescriptor["fields"][number]["property"],
  unit: AudioInspectorDescriptor["fields"][number]["unit"],
  keyframeable: boolean,
  minimum: number | null,
  maximum: number | null,
): AudioInspectorDescriptor["fields"][number] => ({
  property,
  unit,
  keyframeable,
  minimum,
  maximum,
});
