import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { StableEntityId, TimelineSnapshotV1 } from "./model.js";
import { masterFrame, type FrameRange, type MasterFrame } from "./range.js";

export type SnapCandidateKind =
  | "user-guide"
  | "playhead"
  | "marker"
  | "clip-boundary"
  | "caption-boundary"
  | "phrase-boundary"
  | "keyframe";

export interface SnapCandidate {
  readonly id: string;
  readonly kind: SnapCandidateKind;
  readonly frame: MasterFrame;
  readonly sourceEntityId: StableEntityId | null;
  readonly label: string;
}

export interface TranscriptPhraseSnapSource {
  readonly id: StableEntityId;
  readonly range: FrameRange;
  readonly text: string;
}

export interface CollectSnapOptions {
  readonly playhead: MasterFrame | null;
  readonly userGuides: readonly Readonly<{ id: StableEntityId; frame: MasterFrame; label: string }>[];
  readonly transcriptPhrases: readonly TranscriptPhraseSnapSource[];
  readonly enabledKinds?: ReadonlySet<SnapCandidateKind>;
}

export interface ResolveSnapOptions {
  readonly threshold: MasterFrame;
  readonly enabledKinds?: ReadonlySet<SnapCandidateKind>;
}

export interface SnapResolution {
  readonly snapped: boolean;
  readonly inputFrame: MasterFrame;
  readonly outputFrame: MasterFrame;
  readonly delta: MasterFrame;
  readonly candidate: SnapCandidate | null;
}

export const snapKindPriority: Readonly<Record<SnapCandidateKind, number>> = {
  "user-guide": 0,
  playhead: 1,
  marker: 2,
  "clip-boundary": 3,
  "caption-boundary": 4,
  "phrase-boundary": 5,
  keyframe: 6,
};

export const collectSnapCandidates = (
  timeline: TimelineSnapshotV1,
  options: CollectSnapOptions,
): readonly SnapCandidate[] => {
  const candidates: SnapCandidate[] = [];
  const add = (candidate: SnapCandidate): void => {
    if (options.enabledKinds !== undefined && !options.enabledKinds.has(candidate.kind)) return;
    candidates.push(candidate);
  };
  if (options.playhead !== null) {
    add({
      id: "playhead",
      kind: "playhead",
      frame: options.playhead,
      sourceEntityId: null,
      label: "Playhead",
    });
  }
  options.userGuides.forEach((guide) => {
    add({
      id: `guide:${guide.id}`,
      kind: "user-guide",
      frame: guide.frame,
      sourceEntityId: guide.id,
      label: guide.label,
    });
  });
  Object.values(timeline.markers).forEach((marker) => {
    add({
      id: `marker:${marker.id}:start`,
      kind: "marker",
      frame: marker.frame,
      sourceEntityId: marker.id,
      label: marker.label,
    });
    if (marker.duration > 0n)
      add({
        id: `marker:${marker.id}:end`,
        kind: "marker",
        frame: masterFrame(marker.frame + marker.duration),
        sourceEntityId: marker.id,
        label: `${marker.label} end`,
      });
  });
  Object.values(timeline.clips).forEach((clip) => {
    add({
      id: `clip:${clip.id}:start`,
      kind: "clip-boundary",
      frame: clip.range.start,
      sourceEntityId: clip.id,
      label: `${clip.name} in`,
    });
    add({
      id: `clip:${clip.id}:end`,
      kind: "clip-boundary",
      frame: clip.range.end,
      sourceEntityId: clip.id,
      label: `${clip.name} out`,
    });
  });
  Object.values(timeline.captions).forEach((caption) => {
    add({
      id: `caption:${caption.id}:start`,
      kind: "caption-boundary",
      frame: caption.range.start,
      sourceEntityId: caption.id,
      label: "Caption in",
    });
    add({
      id: `caption:${caption.id}:end`,
      kind: "caption-boundary",
      frame: caption.range.end,
      sourceEntityId: caption.id,
      label: "Caption out",
    });
  });
  options.transcriptPhrases.forEach((phrase) => {
    add({
      id: `phrase:${phrase.id}:start`,
      kind: "phrase-boundary",
      frame: phrase.range.start,
      sourceEntityId: phrase.id,
      label: phrase.text,
    });
    add({
      id: `phrase:${phrase.id}:end`,
      kind: "phrase-boundary",
      frame: phrase.range.end,
      sourceEntityId: phrase.id,
      label: `${phrase.text} end`,
    });
  });
  Object.values(timeline.keyframes).forEach((keyframe) => {
    add({
      id: `keyframe:${keyframe.id}`,
      kind: "keyframe",
      frame: keyframe.frame,
      sourceEntityId: keyframe.id,
      label: keyframe.propertyPath,
    });
  });
  return deduplicateCandidates(candidates).sort(compareCandidates);
};

export const resolveSnap = (
  inputFrame: MasterFrame,
  candidates: readonly SnapCandidate[],
  options: ResolveSnapOptions,
): SnapResolution => {
  if (options.threshold < 0n) {
    throw snapError("timeline.snap.threshold-invalid", "Snap threshold cannot be negative.");
  }
  const eligible = candidates
    .filter(
      (candidate) =>
        (options.enabledKinds === undefined || options.enabledKinds.has(candidate.kind)) &&
        absolute(candidate.frame - inputFrame) <= options.threshold,
    )
    .sort((left, right) => {
      const leftDistance = absolute(left.frame - inputFrame);
      const rightDistance = absolute(right.frame - inputFrame);
      if (leftDistance !== rightDistance) return leftDistance < rightDistance ? -1 : 1;
      return compareCandidates(left, right);
    });
  const candidate = eligible[0] ?? null;
  if (candidate === null) {
    return { snapped: false, inputFrame, outputFrame: inputFrame, delta: masterFrame(0n), candidate: null };
  }
  return {
    snapped: true,
    inputFrame,
    outputFrame: candidate.frame,
    delta: masterFrame(candidate.frame - inputFrame, true),
    candidate,
  };
};

const deduplicateCandidates = (candidates: readonly SnapCandidate[]): SnapCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const identity = `${candidate.kind}:${String(candidate.frame)}:${candidate.sourceEntityId ?? "none"}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const compareCandidates = (left: SnapCandidate, right: SnapCandidate): number =>
  snapKindPriority[left.kind] - snapKindPriority[right.kind] ||
  (left.frame < right.frame ? -1 : left.frame > right.frame ? 1 : left.id.localeCompare(right.id, "en"));

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);

const snapError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "timeline-snapping",
    message,
    repairHint: "Use a non-negative integer-frame threshold and explicitly enabled snap sources.",
  });
