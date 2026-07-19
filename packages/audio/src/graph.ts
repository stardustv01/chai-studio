import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { AudioChannelLayout, AudioGraphBus, AudioGraphDocument } from "@chai-studio/schema";

export interface AudioGraphValidationIssue {
  readonly code: string;
  readonly entityId: string;
  readonly message: string;
  readonly repairHint: string;
}

export const createDefaultAudioGraph = (input: {
  readonly graphId: string;
  readonly sampleRate: 44_100 | 48_000 | 96_000;
  readonly channelLayout: AudioChannelLayout;
}): AudioGraphDocument => {
  const masterBusId = `${input.graphId}:master`;
  const programBuses = (
    [
      ["voiceover", "Voiceover"],
      ["music", "Music"],
      ["sfx", "SFX"],
      ["ambience", "Ambience"],
    ] as const
  ).map(([kind, name]): AudioGraphBus => ({
    id: `${input.graphId}:${kind}`,
    name,
    kind,
    parentBusId: masterBusId,
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
    automationLaneIds: [],
  }));
  return {
    schemaVersion: "1.0.0",
    graphId: input.graphId,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    masterBusId,
    sources: [],
    buses: [
      ...programBuses,
      {
        id: masterBusId,
        name: "Master",
        kind: "master",
        parentBusId: null,
        gainDb: 0,
        pan: 0,
        muted: false,
        solo: false,
        automationLaneIds: [],
      },
    ],
    clips: [],
    automationLanes: [],
    crossfades: [],
    duckingRules: [],
    channelMaps: [],
    syncAnchors: [],
    processingReferences: [],
  };
};

export const validateAudioGraph = (graph: AudioGraphDocument): readonly AudioGraphValidationIssue[] => {
  const issues: AudioGraphValidationIssue[] = [];
  const sources = uniqueRegistry(graph.sources, "audio.source", issues);
  const buses = uniqueRegistry(graph.buses, "audio.bus", issues);
  const clips = uniqueRegistry(graph.clips, "audio.clip", issues);
  const lanes = uniqueRegistry(graph.automationLanes, "audio.automation", issues);
  const channelMaps = uniqueRegistry(graph.channelMaps, "audio.channel-map", issues);
  const anchors = uniqueRegistry(graph.syncAnchors, "audio.sync-anchor", issues);
  const processing = uniqueRegistry(graph.processingReferences, "audio.processing", issues);
  uniqueRegistry(graph.crossfades, "audio.crossfade", issues);
  uniqueRegistry(graph.duckingRules, "audio.ducking", issues);

  const expectedOutputChannels =
    graph.channelLayout === "mono"
      ? 1
      : graph.channelLayout === "stereo"
        ? 2
        : graph.channelLayout === "5.1"
          ? 6
          : 8;
  for (const channelMap of graph.channelMaps) {
    const dimensionsValid =
      Number.isSafeInteger(channelMap.inputChannels) &&
      channelMap.inputChannels > 0 &&
      Number.isSafeInteger(channelMap.outputChannels) &&
      channelMap.outputChannels === expectedOutputChannels &&
      channelMap.matrix.length === channelMap.outputChannels &&
      channelMap.matrix.every(
        (row) =>
          row.length === channelMap.inputChannels && row.every((coefficient) => Number.isFinite(coefficient)),
      );
    if (!dimensionsValid) {
      issues.push(
        graphIssue(
          "audio.channel-map.invalid",
          channelMap.id,
          "Audio channel-map dimensions must match its declared inputs and the project output layout.",
          "Provide one finite coefficient per input/output channel pair.",
        ),
      );
    }
  }

  const master = buses.get(graph.masterBusId);
  if (master?.kind !== "master" || master.parentBusId !== null) {
    issues.push(
      graphIssue(
        "audio.master.invalid",
        graph.masterBusId,
        "The master bus must exist, have kind master, and have no parent.",
        "Repair masterBusId and the master bus route.",
      ),
    );
  }
  for (const bus of graph.buses) {
    if (bus.id !== graph.masterBusId && (bus.parentBusId === null || !buses.has(bus.parentBusId))) {
      issues.push(
        graphIssue(
          "audio.bus.parent-missing",
          bus.id,
          "A non-master bus has no valid parent route.",
          "Route the bus to an existing bus, normally the master bus.",
        ),
      );
    }
    if (hasBusCycle(bus.id, buses)) {
      issues.push(
        graphIssue(
          "audio.bus.route-cycle",
          bus.id,
          "Audio bus routing contains a cycle.",
          "Route buses as an acyclic tree ending at master.",
        ),
      );
    }
    for (const laneId of bus.automationLaneIds) {
      const lane = lanes.get(laneId);
      if (lane?.targetKind !== "bus" || lane.targetId !== bus.id) {
        issues.push(
          graphIssue(
            "audio.bus.automation-invalid",
            bus.id,
            `Bus automation lane ${laneId} is missing or targets another entity.`,
            "Attach only bus-owned automation lanes.",
          ),
        );
      }
    }
  }
  for (const clip of graph.clips) {
    if (!sources.has(clip.sourceId)) {
      issues.push(
        graphIssue(
          "audio.clip.source-missing",
          clip.id,
          `Audio source ${clip.sourceId} does not exist.`,
          "Register the source before routing the clip.",
        ),
      );
    }
    if (!buses.has(clip.busId)) {
      issues.push(
        graphIssue(
          "audio.clip.bus-missing",
          clip.id,
          `Audio bus ${clip.busId} does not exist.`,
          "Route the clip to an existing program bus.",
        ),
      );
    }
    if (!channelMaps.has(clip.channelMapId)) {
      issues.push(
        graphIssue(
          "audio.clip.channel-map-missing",
          clip.id,
          `Channel map ${clip.channelMapId} does not exist.`,
          "Assign an explicit channel map compatible with the project output.",
        ),
      );
    }
    if (BigInt(clip.endFrameExclusive) <= BigInt(clip.startFrame)) {
      issues.push(
        graphIssue(
          "audio.clip.range-invalid",
          clip.id,
          "Audio clip timeline range must be non-empty and half-open.",
          "Set endFrameExclusive after startFrame.",
        ),
      );
    }
    if (BigInt(clip.sourceEndSampleExclusive) <= BigInt(clip.sourceStartSample)) {
      issues.push(
        graphIssue(
          "audio.clip.source-range-invalid",
          clip.id,
          "Audio clip source sample range must be non-empty and half-open.",
          "Set sourceEndSampleExclusive after sourceStartSample.",
        ),
      );
    }
    for (const id of clip.syncAnchorIds) if (!anchors.has(id)) missingReference(issues, clip.id, id);
    for (const id of clip.processingReferenceIds)
      if (!processing.has(id)) missingReference(issues, clip.id, id);
    for (const laneId of clip.automationLaneIds) {
      const lane = lanes.get(laneId);
      if (lane?.targetKind !== "clip" || lane.targetId !== clip.id) {
        issues.push(
          graphIssue(
            "audio.clip.automation-invalid",
            clip.id,
            `Clip automation lane ${laneId} is missing or targets another entity.`,
            "Attach only clip-owned automation lanes.",
          ),
        );
      }
    }
  }
  for (const lane of graph.automationLanes) {
    const targetExists = lane.targetKind === "clip" ? clips.has(lane.targetId) : buses.has(lane.targetId);
    if (!targetExists) missingReference(issues, lane.id, lane.targetId);
    const ordered = [...lane.keyframes].sort((left, right) =>
      BigInt(left.frame) < BigInt(right.frame) ? -1 : 1,
    );
    if (ordered.some((keyframe, index) => index > 0 && keyframe.frame === ordered[index - 1]?.frame)) {
      issues.push(
        graphIssue(
          "audio.automation.frame-duplicate",
          lane.id,
          "An automation lane has multiple keyframes at the same frame.",
          "Keep one deterministic value per lane and frame.",
        ),
      );
    }
  }
  for (const crossfade of graph.crossfades) {
    if (!clips.has(crossfade.fromClipId) || !clips.has(crossfade.toClipId)) {
      missingReference(issues, crossfade.id, `${crossfade.fromClipId}/${crossfade.toClipId}`);
    }
    if (BigInt(crossfade.endFrameExclusive) <= BigInt(crossfade.startFrame)) {
      issues.push(
        graphIssue(
          "audio.crossfade.range-invalid",
          crossfade.id,
          "A crossfade must have a non-empty half-open range.",
          "Set its exclusive end after its start.",
        ),
      );
    }
  }
  for (const rule of graph.duckingRules) {
    if (!buses.has(rule.triggerBusId) || !buses.has(rule.targetBusId)) {
      missingReference(issues, rule.id, `${rule.triggerBusId}/${rule.targetBusId}`);
    }
    if (rule.generatedAutomationLaneId !== null && !lanes.has(rule.generatedAutomationLaneId)) {
      missingReference(issues, rule.id, rule.generatedAutomationLaneId);
    }
  }
  for (const reference of graph.processingReferences) {
    if (!sources.has(reference.sourceId)) missingReference(issues, reference.id, reference.sourceId);
  }
  return issues;
};

export const assertValidAudioGraph = (graph: AudioGraphDocument): AudioGraphDocument => {
  const issues = validateAudioGraph(graph);
  const first = issues[0];
  if (first === undefined) return graph;
  throw new ChaiError({
    category: "audio",
    code: first.code,
    correlationId: createCorrelationId(),
    stage: "audio-graph-validation",
    message: first.message,
    entityId: first.entityId,
    repairHint: first.repairHint,
    details: { issues },
  });
};

const uniqueRegistry = <T extends { readonly id: string }>(
  values: readonly T[],
  kind: string,
  issues: AudioGraphValidationIssue[],
): ReadonlyMap<string, T> => {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.id)) {
      issues.push(
        graphIssue(
          `${kind}.id-duplicate`,
          value.id,
          `Audio graph ID ${value.id} is duplicated.`,
          "Use one stable ID per audio entity.",
        ),
      );
    }
    result.set(value.id, value);
  }
  return result;
};

const hasBusCycle = (startId: string, buses: ReadonlyMap<string, AudioGraphBus>): boolean => {
  const visited = new Set<string>();
  let current: string | null = startId;
  while (current !== null) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = buses.get(current)?.parentBusId ?? null;
  }
  return false;
};

const missingReference = (issues: AudioGraphValidationIssue[], entityId: string, reference: string): void => {
  issues.push(
    graphIssue(
      "audio.reference.missing",
      entityId,
      `Audio graph reference ${reference} does not exist.`,
      "Repair or remove the stale reference.",
    ),
  );
};

const graphIssue = (
  code: string,
  entityId: string,
  message: string,
  repairHint: string,
): AudioGraphValidationIssue => ({ code, entityId, message, repairHint });
