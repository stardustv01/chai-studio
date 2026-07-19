import type {
  AudioAutomationLane,
  AudioCrossfade,
  AudioDuckingRule,
  AudioGraphBus,
  AudioGraphClip,
  AudioGraphDocument,
  AudioProcessingReference,
  AudioSyncAnchor,
  JsonValue,
  TimelineDocument,
} from "@chai-studio/schema";
import { assertValidAudioGraph } from "./graph.js";

export type AudioGraphCommand =
  | Readonly<{
      kind: "audio.bus.update";
      busId: string;
      patch: Partial<Pick<AudioGraphBus, "gainDb" | "pan" | "muted" | "solo" | "parentBusId">>;
    }>
  | Readonly<{
      kind: "audio.clip.update";
      clipId: string;
      patch: Partial<
        Pick<
          AudioGraphClip,
          "busId" | "gainDb" | "pan" | "muted" | "fadeInFrames" | "fadeOutFrames" | "fadeCurve"
        >
      >;
    }>
  | Readonly<{ kind: "audio.automation.upsert"; lane: AudioAutomationLane }>
  | Readonly<{ kind: "audio.automation.remove"; laneId: string }>
  | Readonly<{ kind: "audio.crossfade.upsert"; crossfade: AudioCrossfade }>
  | Readonly<{ kind: "audio.crossfade.remove"; crossfadeId: string }>
  | Readonly<{ kind: "audio.ducking.upsert"; rule: AudioDuckingRule }>
  | Readonly<{ kind: "audio.ducking.remove"; ruleId: string }>
  | Readonly<{ kind: "audio.sync-anchor.upsert"; anchor: AudioSyncAnchor; clipId: string }>
  | Readonly<{ kind: "audio.sync-anchor.remove"; anchorId: string; clipId: string }>
  | Readonly<{ kind: "audio.processing.upsert"; reference: AudioProcessingReference }>
  | Readonly<{ kind: "audio.processing.remove"; referenceId: string }>;

export interface AudioGraphCommandResult {
  readonly graph: AudioGraphDocument;
  readonly inverse: AudioGraphCommand;
  readonly label: string;
  readonly affectedEntityIds: readonly string[];
  readonly affectedFrameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
}

export const executeAudioGraphCommand = (
  graph: AudioGraphDocument,
  command: AudioGraphCommand,
): AudioGraphCommandResult => {
  const result = applyAudioGraphCommand(graph, command);
  return { ...result, graph: assertValidAudioGraph(result.graph) };
};

export const executeAudioDocumentEdit = (
  timeline: TimelineDocument,
  operation: JsonValue,
  revisionId: string,
): Readonly<{
  timeline: TimelineDocument;
  label: string;
  diffSummary: string;
  affectedEntityIds: readonly string[];
  warnings: readonly string[];
}> => {
  if (timeline.audioGraph === undefined) {
    throw new Error("The timeline has no authoritative audio graph.");
  }
  const command = parseAudioGraphCommand(operation);
  const result = executeAudioGraphCommand(timeline.audioGraph, command);
  return {
    timeline: { ...timeline, revisionId, audioGraph: result.graph },
    label: result.label,
    diffSummary: `${result.label}; audio graph ${timeline.audioGraph.graphId} remains authoritative.`,
    affectedEntityIds: result.affectedEntityIds,
    warnings: [],
  };
};

const parseAudioGraphCommand = (operation: JsonValue): AudioGraphCommand => {
  if (!isJsonObject(operation)) {
    throw new Error("Audio edit operation must be an object.");
  }
  const kind = operation.kind;
  if (
    kind !== "audio.bus.update" &&
    kind !== "audio.clip.update" &&
    kind !== "audio.automation.upsert" &&
    kind !== "audio.automation.remove" &&
    kind !== "audio.crossfade.upsert" &&
    kind !== "audio.crossfade.remove" &&
    kind !== "audio.ducking.upsert" &&
    kind !== "audio.ducking.remove" &&
    kind !== "audio.sync-anchor.upsert" &&
    kind !== "audio.sync-anchor.remove" &&
    kind !== "audio.processing.upsert" &&
    kind !== "audio.processing.remove"
  ) {
    const renderedKind =
      typeof kind === "string" ? kind : kind === undefined ? "missing" : JSON.stringify(kind);
    throw new Error(`Unsupported audio edit operation: ${renderedKind}.`);
  }
  return operation as unknown as AudioGraphCommand;
};

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const applyAudioGraphCommand = (
  graph: AudioGraphDocument,
  command: AudioGraphCommand,
): AudioGraphCommandResult => {
  switch (command.kind) {
    case "audio.bus.update": {
      const bus = requireEntity(graph.buses, command.busId, "audio bus");
      const updated = { ...bus, ...command.patch };
      const inversePatch = pickPrevious(bus, command.patch);
      return {
        graph: { ...graph, buses: graph.buses.map((item) => (item.id === bus.id ? updated : item)) },
        inverse: { kind: "audio.bus.update", busId: bus.id, patch: inversePatch },
        label: `Update ${bus.name}`,
        affectedEntityIds: [bus.id],
        affectedFrameRange: null,
      };
    }
    case "audio.clip.update": {
      const clip = requireEntity(graph.clips, command.clipId, "audio clip");
      const updated = { ...clip, ...command.patch };
      const inversePatch = pickPrevious(clip, command.patch);
      return {
        graph: { ...graph, clips: graph.clips.map((item) => (item.id === clip.id ? updated : item)) },
        inverse: { kind: "audio.clip.update", clipId: clip.id, patch: inversePatch },
        label: `Update audio clip ${clip.id}`,
        affectedEntityIds: [clip.id, clip.timelineClipId, clip.busId],
        affectedFrameRange: {
          startFrame: clip.startFrame,
          endFrameExclusive: clip.endFrameExclusive,
        },
      };
    }
    case "audio.automation.upsert": {
      const previous = graph.automationLanes.find((item) => item.id === command.lane.id);
      const graphWithLane = attachLaneToTarget(
        {
          ...graph,
          automationLanes:
            previous === undefined
              ? [...graph.automationLanes, command.lane]
              : graph.automationLanes.map((item) => (item.id === command.lane.id ? command.lane : item)),
        },
        command.lane,
      );
      return {
        graph: graphWithLane,
        inverse:
          previous === undefined
            ? { kind: "audio.automation.remove", laneId: command.lane.id }
            : { kind: "audio.automation.upsert", lane: previous },
        label: `${previous === undefined ? "Add" : "Update"} ${command.lane.property} automation`,
        affectedEntityIds: [command.lane.id, command.lane.targetId],
        affectedFrameRange: keyframeRange(command.lane),
      };
    }
    case "audio.automation.remove": {
      const lane = requireEntity(graph.automationLanes, command.laneId, "audio automation lane");
      return {
        graph: detachLaneFromTarget(
          { ...graph, automationLanes: graph.automationLanes.filter((item) => item.id !== lane.id) },
          lane,
        ),
        inverse: { kind: "audio.automation.upsert", lane },
        label: `Remove ${lane.property} automation`,
        affectedEntityIds: [lane.id, lane.targetId],
        affectedFrameRange: keyframeRange(lane),
      };
    }
    case "audio.crossfade.upsert": {
      const previous = graph.crossfades.find((item) => item.id === command.crossfade.id);
      return {
        graph: {
          ...graph,
          crossfades:
            previous === undefined
              ? [...graph.crossfades, command.crossfade]
              : graph.crossfades.map((item) => (item.id === command.crossfade.id ? command.crossfade : item)),
        },
        inverse:
          previous === undefined
            ? { kind: "audio.crossfade.remove", crossfadeId: command.crossfade.id }
            : { kind: "audio.crossfade.upsert", crossfade: previous },
        label: `${previous === undefined ? "Add" : "Update"} audio crossfade`,
        affectedEntityIds: [command.crossfade.id, command.crossfade.fromClipId, command.crossfade.toClipId],
        affectedFrameRange: {
          startFrame: command.crossfade.startFrame,
          endFrameExclusive: command.crossfade.endFrameExclusive,
        },
      };
    }
    case "audio.crossfade.remove": {
      const crossfade = requireEntity(graph.crossfades, command.crossfadeId, "audio crossfade");
      return {
        graph: { ...graph, crossfades: graph.crossfades.filter((item) => item.id !== crossfade.id) },
        inverse: { kind: "audio.crossfade.upsert", crossfade },
        label: "Remove audio crossfade",
        affectedEntityIds: [crossfade.id, crossfade.fromClipId, crossfade.toClipId],
        affectedFrameRange: {
          startFrame: crossfade.startFrame,
          endFrameExclusive: crossfade.endFrameExclusive,
        },
      };
    }
    case "audio.ducking.upsert": {
      const previous = graph.duckingRules.find((item) => item.id === command.rule.id);
      return {
        graph: {
          ...graph,
          duckingRules:
            previous === undefined
              ? [...graph.duckingRules, command.rule]
              : graph.duckingRules.map((item) => (item.id === command.rule.id ? command.rule : item)),
        },
        inverse:
          previous === undefined
            ? { kind: "audio.ducking.remove", ruleId: command.rule.id }
            : { kind: "audio.ducking.upsert", rule: previous },
        label: `${previous === undefined ? "Add" : "Update"} ducking rule`,
        affectedEntityIds: [command.rule.id, command.rule.triggerBusId, command.rule.targetBusId],
        affectedFrameRange: null,
      };
    }
    case "audio.ducking.remove": {
      const rule = requireEntity(graph.duckingRules, command.ruleId, "audio ducking rule");
      return {
        graph: { ...graph, duckingRules: graph.duckingRules.filter((item) => item.id !== rule.id) },
        inverse: { kind: "audio.ducking.upsert", rule },
        label: "Remove ducking rule",
        affectedEntityIds: [rule.id, rule.triggerBusId, rule.targetBusId],
        affectedFrameRange: null,
      };
    }
    case "audio.sync-anchor.upsert": {
      const clip = requireEntity(graph.clips, command.clipId, "audio clip");
      const previous = graph.syncAnchors.find((item) => item.id === command.anchor.id);
      const clips = graph.clips.map((item) =>
        item.id === clip.id && !item.syncAnchorIds.includes(command.anchor.id)
          ? { ...item, syncAnchorIds: [...item.syncAnchorIds, command.anchor.id] }
          : item,
      );
      return {
        graph: {
          ...graph,
          clips,
          syncAnchors:
            previous === undefined
              ? [...graph.syncAnchors, command.anchor]
              : graph.syncAnchors.map((item) => (item.id === command.anchor.id ? command.anchor : item)),
        },
        inverse:
          previous === undefined
            ? { kind: "audio.sync-anchor.remove", anchorId: command.anchor.id, clipId: clip.id }
            : { kind: "audio.sync-anchor.upsert", anchor: previous, clipId: clip.id },
        label: `${previous === undefined ? "Add" : "Update"} sync anchor`,
        affectedEntityIds: [command.anchor.id, clip.id, clip.timelineClipId],
        affectedFrameRange: {
          startFrame: command.anchor.frame,
          endFrameExclusive: (BigInt(command.anchor.frame) + 1n).toString(10),
        },
      };
    }
    case "audio.sync-anchor.remove": {
      const clip = requireEntity(graph.clips, command.clipId, "audio clip");
      const anchor = requireEntity(graph.syncAnchors, command.anchorId, "audio sync anchor");
      return {
        graph: {
          ...graph,
          clips: graph.clips.map((item) =>
            item.id === clip.id
              ? { ...item, syncAnchorIds: item.syncAnchorIds.filter((id) => id !== anchor.id) }
              : item,
          ),
          syncAnchors: graph.syncAnchors.filter((item) => item.id !== anchor.id),
        },
        inverse: { kind: "audio.sync-anchor.upsert", anchor, clipId: clip.id },
        label: "Remove sync anchor",
        affectedEntityIds: [anchor.id, clip.id, clip.timelineClipId],
        affectedFrameRange: {
          startFrame: anchor.frame,
          endFrameExclusive: (BigInt(anchor.frame) + 1n).toString(10),
        },
      };
    }
    case "audio.processing.upsert": {
      const previous = graph.processingReferences.find((item) => item.id === command.reference.id);
      return {
        graph: {
          ...graph,
          processingReferences:
            previous === undefined
              ? [...graph.processingReferences, command.reference]
              : graph.processingReferences.map((item) =>
                  item.id === command.reference.id ? command.reference : item,
                ),
        },
        inverse:
          previous === undefined
            ? { kind: "audio.processing.remove", referenceId: command.reference.id }
            : { kind: "audio.processing.upsert", reference: previous },
        label: `${previous === undefined ? "Plan" : "Update"} ${command.reference.kind}`,
        affectedEntityIds: [
          command.reference.id,
          command.reference.sourceId,
          command.reference.generatedAssetId,
        ],
        affectedFrameRange: null,
      };
    }
    case "audio.processing.remove": {
      const reference = requireEntity(
        graph.processingReferences,
        command.referenceId,
        "audio processing reference",
      );
      if (graph.clips.some((clip) => clip.processingReferenceIds.includes(reference.id))) {
        throw new Error(`Audio processing reference ${reference.id} is still used by a clip.`);
      }
      return {
        graph: {
          ...graph,
          processingReferences: graph.processingReferences.filter((item) => item.id !== reference.id),
        },
        inverse: { kind: "audio.processing.upsert", reference },
        label: `Remove ${reference.kind}`,
        affectedEntityIds: [reference.id, reference.sourceId, reference.generatedAssetId],
        affectedFrameRange: null,
      };
    }
  }
};

const attachLaneToTarget = (graph: AudioGraphDocument, lane: AudioAutomationLane): AudioGraphDocument =>
  lane.targetKind === "clip"
    ? {
        ...graph,
        clips: graph.clips.map((clip) =>
          clip.id === lane.targetId && !clip.automationLaneIds.includes(lane.id)
            ? { ...clip, automationLaneIds: [...clip.automationLaneIds, lane.id] }
            : clip,
        ),
      }
    : {
        ...graph,
        buses: graph.buses.map((bus) =>
          bus.id === lane.targetId && !bus.automationLaneIds.includes(lane.id)
            ? { ...bus, automationLaneIds: [...bus.automationLaneIds, lane.id] }
            : bus,
        ),
      };

const detachLaneFromTarget = (graph: AudioGraphDocument, lane: AudioAutomationLane): AudioGraphDocument =>
  lane.targetKind === "clip"
    ? {
        ...graph,
        clips: graph.clips.map((clip) =>
          clip.id === lane.targetId
            ? { ...clip, automationLaneIds: clip.automationLaneIds.filter((id) => id !== lane.id) }
            : clip,
        ),
      }
    : {
        ...graph,
        buses: graph.buses.map((bus) =>
          bus.id === lane.targetId
            ? { ...bus, automationLaneIds: bus.automationLaneIds.filter((id) => id !== lane.id) }
            : bus,
        ),
      };

const keyframeRange = (
  lane: AudioAutomationLane,
): Readonly<{ startFrame: string; endFrameExclusive: string }> | null => {
  if (lane.keyframes.length === 0) return null;
  const frames = lane.keyframes.map((keyframe) => BigInt(keyframe.frame));
  const start = frames.reduce((minimum, value) => (value < minimum ? value : minimum));
  const end = frames.reduce((maximum, value) => (value > maximum ? value : maximum)) + 1n;
  return { startFrame: start.toString(10), endFrameExclusive: end.toString(10) };
};

const pickPrevious = <T extends object, K extends keyof T>(
  entity: T,
  patch: Partial<Pick<T, K>>,
): Partial<Pick<T, K>> =>
  Object.fromEntries(Object.keys(patch).map((key) => [key, entity[key as K]])) as Partial<Pick<T, K>>;

const requireEntity = <T extends { readonly id: string }>(
  values: readonly T[],
  id: string,
  kind: string,
): T => {
  const value = values.find((item) => item.id === id);
  if (value === undefined) throw new Error(`Unknown ${kind}: ${id}.`);
  return value;
};
