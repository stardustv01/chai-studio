import type {
  AudioAutomationLane,
  AudioCrossfade,
  AudioGraphBus,
  AudioGraphClip,
  AudioGraphDocument,
} from "@chai-studio/schema";

export interface EvaluatedAudioClip {
  readonly clipId: string;
  readonly busId: string;
  readonly frame: bigint;
  readonly gainDb: number;
  readonly linearGain: number;
  readonly pan: number;
  readonly leftGain: number;
  readonly rightGain: number;
  readonly audible: boolean;
}

export interface EvaluatedAudioBus {
  readonly busId: string;
  readonly gainDb: number;
  readonly linearGain: number;
  readonly pan: number;
  readonly audible: boolean;
}

export const evaluateAudioGraphAtFrame = (
  graph: AudioGraphDocument,
  frame: bigint,
): Readonly<{ clips: readonly EvaluatedAudioClip[]; buses: readonly EvaluatedAudioBus[] }> => {
  const laneById = new Map(graph.automationLanes.map((lane) => [lane.id, lane]));
  const busById = new Map(graph.buses.map((bus) => [bus.id, bus]));
  const anySolo = graph.buses.some((bus) => bus.solo);
  const evaluatedBuses = graph.buses.map((bus) => evaluateBus(bus, frame, laneById, busById, anySolo));
  const evaluatedBusById = new Map(evaluatedBuses.map((bus) => [bus.busId, bus]));
  const clips = graph.clips
    .filter((clip) => frame >= BigInt(clip.startFrame) && frame < BigInt(clip.endFrameExclusive))
    .map((clip) => evaluateClip(graph, clip, frame, laneById, evaluatedBusById));
  return { clips, buses: evaluatedBuses };
};

export const evaluateAutomationLane = (
  lane: AudioAutomationLane,
  frame: bigint,
  fallback: number,
): number => {
  const keys = [...lane.keyframes].sort((left, right) => {
    const a = BigInt(left.frame);
    const b = BigInt(right.frame);
    return a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id, "en");
  });
  if (keys.length === 0) return fallback;
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) return fallback;
  if (frame <= BigInt(first.frame)) return first.value;
  if (frame >= BigInt(last.frame)) return last.value;
  const rightIndex = keys.findIndex((key) => BigInt(key.frame) > frame);
  const right = keys[rightIndex];
  const left = keys[rightIndex - 1];
  if (left === undefined || right === undefined) return fallback;
  if (left.interpolation === "hold") return left.value;
  const start = BigInt(left.frame);
  const duration = Number(BigInt(right.frame) - start);
  const rawProgress = Number(frame - start) / duration;
  const progress = interpolationProgress(rawProgress, left.interpolation);
  return left.value + (right.value - left.value) * progress;
};

export const decibelsToLinear = (decibels: number): number =>
  decibels <= -120 ? 0 : Math.pow(10, decibels / 20);

export const equalPowerPan = (pan: number): Readonly<{ left: number; right: number }> => {
  const normalized = (clamp(pan, -1, 1) + 1) * (Math.PI / 4);
  return { left: Math.cos(normalized), right: Math.sin(normalized) };
};

export const crossfadeGainAtFrame = (
  crossfade: AudioCrossfade,
  clipRole: "from" | "to",
  frame: bigint,
): number => {
  const start = BigInt(crossfade.startFrame);
  const end = BigInt(crossfade.endFrameExclusive);
  if (frame < start || frame >= end) return 1;
  const progress = Number(frame - start) / Number(end - start);
  if (crossfade.curve === "linear") return clipRole === "from" ? 1 - progress : progress;
  return clipRole === "from" ? Math.cos(progress * (Math.PI / 2)) : Math.sin(progress * (Math.PI / 2));
};

const evaluateBus = (
  bus: AudioGraphBus,
  frame: bigint,
  laneById: ReadonlyMap<string, AudioAutomationLane>,
  busById: ReadonlyMap<string, AudioGraphBus>,
  anySolo: boolean,
): EvaluatedAudioBus => {
  const gainDb = valueForProperty(bus.automationLaneIds, "gainDb", bus.gainDb, frame, laneById);
  const pan = valueForProperty(bus.automationLaneIds, "pan", bus.pan, frame, laneById);
  const soloPath = !anySolo || bus.solo || hasSoloDescendant(bus.id, busById);
  const audible = !bus.muted && soloPath && parentPathAudible(bus, busById);
  const routeGain = parentRouteLinearGain(bus.parentBusId, frame, laneById, busById);
  return {
    busId: bus.id,
    gainDb,
    linearGain: audible ? decibelsToLinear(gainDb) * routeGain : 0,
    pan,
    audible,
  };
};

const evaluateClip = (
  graph: AudioGraphDocument,
  clip: AudioGraphClip,
  frame: bigint,
  laneById: ReadonlyMap<string, AudioAutomationLane>,
  busById: ReadonlyMap<string, EvaluatedAudioBus>,
): EvaluatedAudioClip => {
  const automatedGain = valueForProperty(clip.automationLaneIds, "gainDb", clip.gainDb, frame, laneById);
  const pan = valueForProperty(clip.automationLaneIds, "pan", clip.pan, frame, laneById);
  const envelopeGain = clipEnvelopeGainAtFrame(graph, clip, frame);
  const bus = busById.get(clip.busId);
  const audible = !clip.muted && bus?.audible === true;
  const linearGain = audible ? decibelsToLinear(automatedGain) * envelopeGain * bus.linearGain : 0;
  const stereo = equalPowerPan(pan);
  return {
    clipId: clip.id,
    busId: clip.busId,
    frame,
    gainDb: automatedGain,
    linearGain,
    pan,
    leftGain: linearGain * stereo.left,
    rightGain: linearGain * stereo.right,
    audible,
  };
};

export const clipFadeGain = (clip: AudioGraphClip, frame: bigint): number => {
  const start = BigInt(clip.startFrame);
  const end = BigInt(clip.endFrameExclusive);
  const fadeIn = BigInt(clip.fadeInFrames);
  const fadeOut = BigInt(clip.fadeOutFrames);
  const inProgress = fadeIn === 0n ? 1 : clamp(Number(frame - start) / Number(fadeIn), 0, 1);
  const outProgress = fadeOut === 0n ? 1 : clamp(Number(end - frame) / Number(fadeOut), 0, 1);
  const curve = (value: number) =>
    clip.fadeCurve === "equal-power" ? Math.sin(value * (Math.PI / 2)) : value;
  return Math.min(curve(inProgress), curve(outProgress));
};

export const clipEnvelopeGainAtFrame = (
  graph: AudioGraphDocument,
  clip: AudioGraphClip,
  frame: bigint,
): number =>
  graph.crossfades.reduce(
    (gain, crossfade) => {
      if (crossfade.fromClipId === clip.id) {
        return gain * crossfadeGainAtFrame(crossfade, "from", frame);
      }
      if (crossfade.toClipId === clip.id) {
        return gain * crossfadeGainAtFrame(crossfade, "to", frame);
      }
      return gain;
    },
    clipFadeGain(clip, frame),
  );

const valueForProperty = (
  laneIds: readonly string[],
  property: AudioAutomationLane["property"],
  fallback: number,
  frame: bigint,
  laneById: ReadonlyMap<string, AudioAutomationLane>,
): number => {
  const lane = laneIds.map((id) => laneById.get(id)).find((item) => item?.property === property);
  return lane === undefined ? fallback : evaluateAutomationLane(lane, frame, fallback);
};

const interpolationProgress = (
  value: number,
  interpolation: AudioAutomationLane["keyframes"][number]["interpolation"],
): number => {
  if (interpolation === "linear" || interpolation === "hold") return value;
  if (interpolation === "ease-in") return value * value;
  if (interpolation === "ease-out") return 1 - (1 - value) * (1 - value);
  return value * value * (3 - 2 * value);
};

const parentPathAudible = (bus: AudioGraphBus, buses: ReadonlyMap<string, AudioGraphBus>): boolean => {
  let parentId = bus.parentBusId;
  while (parentId !== null) {
    const parent = buses.get(parentId);
    if (parent === undefined || parent.muted) return false;
    parentId = parent.parentBusId;
  }
  return true;
};

const parentRouteLinearGain = (
  parentId: string | null,
  frame: bigint,
  laneById: ReadonlyMap<string, AudioAutomationLane>,
  buses: ReadonlyMap<string, AudioGraphBus>,
): number => {
  let gain = 1;
  let currentId = parentId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (visited.has(currentId)) return 0;
    visited.add(currentId);
    const bus = buses.get(currentId);
    if (bus === undefined || bus.muted) return 0;
    const gainDb = valueForProperty(bus.automationLaneIds, "gainDb", bus.gainDb, frame, laneById);
    gain *= decibelsToLinear(gainDb);
    currentId = bus.parentBusId;
  }
  return gain;
};

const hasSoloDescendant = (busId: string, buses: ReadonlyMap<string, AudioGraphBus>): boolean =>
  [...buses.values()].some((candidate) => candidate.solo && routeContains(candidate, busId, buses));

const routeContains = (
  bus: AudioGraphBus,
  soughtId: string,
  buses: ReadonlyMap<string, AudioGraphBus>,
): boolean => {
  let current: AudioGraphBus | undefined = bus;
  while (current !== undefined) {
    if (current.id === soughtId) return true;
    current = current.parentBusId === null ? undefined : buses.get(current.parentBusId);
  }
  return false;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));
