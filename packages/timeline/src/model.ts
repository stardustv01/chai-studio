import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { NormalizedRational } from "@chai-studio/schema/rational";
import type { FrameRange, MasterFrame } from "./range.js";

declare const stableEntityIdBrand: unique symbol;
export type StableEntityId = string & { readonly [stableEntityIdBrand]: true };

export const stableEntityId = (value: string): StableEntityId => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) {
    throw modelError("timeline.id.invalid", `Invalid stable entity ID: ${value}`);
  }
  return value as StableEntityId;
};

export type TimelineTrackKind = "video" | "audio" | "caption" | "data";
export type TimelineEngine = "shared" | "remotion" | "hyperframes";
export type InterpolationKind =
  "hold" | "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | "bezier" | "spring" | "native";
export type TimelinePropertyValue = number | string | boolean | readonly number[];
export type TimelinePropertyCapability =
  "native" | "unified" | "bake_required" | "fallback_available" | "unsupported" | "experimental";

export interface TimelinePropertyState {
  readonly value: TimelinePropertyValue;
  readonly defaultValue: TimelinePropertyValue;
  readonly unit:
    | "px"
    | "percent"
    | "degrees"
    | "frames"
    | "ratio"
    | "decibels"
    | "color"
    | "text"
    | "enum"
    | "file"
    | "boolean"
    | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly step: number | null;
  readonly ownership: "shared" | "engine-native";
  readonly keyframeable: boolean;
  readonly capability: TimelinePropertyCapability;
  readonly safeToEdit: boolean;
  readonly nativeAnimation: boolean;
  readonly supportsSharedConversion: boolean;
}

export interface TimelineSnapshotV1 {
  readonly schemaVersion: "1.0.0";
  readonly id: StableEntityId;
  readonly projectId: StableEntityId;
  readonly revisionId: StableEntityId;
  readonly name: string;
  readonly fps: NormalizedRational;
  readonly duration: MasterFrame;
  readonly trackIds: readonly StableEntityId[];
  readonly tracks: Readonly<Record<StableEntityId, TrackSnapshot>>;
  readonly audioBusIds: readonly StableEntityId[];
  readonly audioBuses: Readonly<Record<StableEntityId, AudioBusSnapshot>>;
  readonly clips: Readonly<Record<StableEntityId, ClipSnapshot>>;
  readonly nestedSequences: Readonly<Record<StableEntityId, NestedSequenceSnapshot>>;
  readonly keyframes: Readonly<Record<StableEntityId, KeyframeSnapshot>>;
  readonly markers: Readonly<Record<StableEntityId, MarkerSnapshot>>;
  readonly transitions: Readonly<Record<StableEntityId, TransitionSnapshot>>;
  readonly bridges: Readonly<Record<StableEntityId, BridgeSnapshot>>;
  readonly captions: Readonly<Record<StableEntityId, CaptionSnapshot>>;
  readonly automation: Readonly<Record<StableEntityId, AutomationLaneSnapshot>>;
  /**
   * Versioned, canonical payloads owned by professional editing modules.
   * Values are strings so the revision schema remains closed and migrations can
   * reject or preserve an unknown future payload without lossy interpretation.
   */
  readonly professionalMetadata?: Readonly<Record<string, string>>;
  readonly selection: SelectionSnapshot;
  readonly inOutRange: FrameRange | null;
}

export interface TrackSnapshot {
  readonly id: StableEntityId;
  readonly kind: TimelineTrackKind;
  readonly name: string;
  readonly order: number;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly audioBusId: StableEntityId | null;
  readonly clipIds: readonly StableEntityId[];
}

export interface AudioBusSnapshot {
  readonly id: StableEntityId;
  readonly name: string;
  readonly order: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly gain: number;
}

export interface ClipSnapshot {
  readonly id: StableEntityId;
  readonly trackId: StableEntityId;
  readonly assetId: StableEntityId | null;
  readonly nestedSequenceId: StableEntityId | null;
  readonly engine: TimelineEngine;
  readonly name: string;
  readonly range: FrameRange;
  readonly sourceRange: FrameRange;
  readonly sourceRate: NormalizedRational;
  readonly speed: NormalizedRational;
  readonly availableSourceRange: FrameRange;
  readonly linkGroupId: StableEntityId | null;
  readonly selectionGroupId: StableEntityId | null;
  readonly transitionInId: StableEntityId | null;
  readonly transitionOutId: StableEntityId | null;
  readonly keyframeIds: readonly StableEntityId[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly properties?: Readonly<Record<string, TimelinePropertyState>>;
}

export interface NestedSequenceSnapshot {
  readonly id: StableEntityId;
  readonly timelineId: StableEntityId;
  readonly rate: NormalizedRational;
  readonly duration: MasterFrame;
}

export interface KeyframeSnapshot {
  readonly id: StableEntityId;
  readonly ownerEntityId: StableEntityId;
  readonly propertyPath: string;
  readonly frame: MasterFrame;
  readonly value: number | string | boolean | readonly number[];
  readonly interpolation: InterpolationKind;
  readonly inTangent: readonly [number, number] | null;
  readonly outTangent: readonly [number, number] | null;
  readonly authority: "shared" | "engine-native";
  readonly preserveNativeAnimation: boolean;
}

export interface MarkerSnapshot {
  readonly id: StableEntityId;
  readonly frame: MasterFrame;
  readonly duration: MasterFrame;
  readonly label: string;
  readonly category: "note" | "issue" | "chapter" | "approval" | "guide";
  readonly issueSeverity: "info" | "warning" | "error" | null;
  readonly annotationReferenceIds: readonly StableEntityId[];
  readonly ripplePolicy: "anchored-time" | "anchored-content";
}

export interface TransitionSnapshot {
  readonly id: StableEntityId;
  readonly kind: "crossfade" | "dip" | "wipe" | "engine-native";
  readonly fromClipId: StableEntityId;
  readonly toClipId: StableEntityId;
  readonly range: FrameRange;
  readonly authority: "shared" | "engine-native";
}

export interface BridgeSnapshot {
  readonly id: StableEntityId;
  readonly fromEntityId: StableEntityId;
  readonly toEntityId: StableEntityId;
  readonly bridgeKind: "engine-boundary" | "audio-handoff" | "baked-handoff";
  readonly range: FrameRange;
}

export interface CaptionSnapshot {
  readonly id: StableEntityId;
  readonly trackId: StableEntityId;
  readonly range: FrameRange;
  readonly text: string;
  readonly speakerId: StableEntityId | null;
  readonly wordTimingIds: readonly StableEntityId[];
}

export interface AutomationLaneSnapshot {
  readonly id: StableEntityId;
  readonly ownerEntityId: StableEntityId;
  readonly propertyPath: string;
  readonly keyframeIds: readonly StableEntityId[];
  readonly authority: "shared" | "engine-native";
}

export interface SelectionSnapshot {
  readonly primaryId: StableEntityId | null;
  readonly selectedIds: readonly StableEntityId[];
  readonly anchorId: StableEntityId | null;
}

export const createEmptyTimelineSnapshot = (input: {
  readonly id: StableEntityId;
  readonly projectId: StableEntityId;
  readonly revisionId: StableEntityId;
  readonly name: string;
  readonly fps: NormalizedRational;
}): TimelineSnapshotV1 => ({
  schemaVersion: "1.0.0",
  ...input,
  duration: 0n as MasterFrame,
  trackIds: [],
  tracks: {},
  audioBusIds: [],
  audioBuses: {},
  clips: {},
  nestedSequences: {},
  keyframes: {},
  markers: {},
  transitions: {},
  bridges: {},
  captions: {},
  automation: {},
  professionalMetadata: {},
  selection: { primaryId: null, selectedIds: [], anchorId: null },
  inOutRange: null,
});

const modelError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "timeline-model",
    message,
    repairHint: "Use a stable ID beginning with a letter and containing only contract-safe characters.",
  });
