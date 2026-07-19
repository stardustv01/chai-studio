import type { NormalizedRational } from "@chai-studio/schema/rational";
import type { InsertClipCommand, OverwriteClipCommand, ReplaceClipCommand } from "./commands.js";
import type { ClipSnapshot, StableEntityId, TimelineSnapshotV1 } from "./model.js";
import { createFrameRange, masterFrame, type FrameRange, type MasterFrame } from "./range.js";
import { createTimelineSourceTransform, invertFrameTransform, mapFrameExact } from "./transform.js";

export interface ProfessionalSourceMarks {
  readonly sourceIn: MasterFrame | null;
  readonly sourceOut: MasterFrame | null;
  readonly timelineIn: MasterFrame | null;
  readonly timelineOut: MasterFrame | null;
}

export interface ProfessionalSourcePatch {
  readonly sourceClip: ClipSnapshot;
  readonly targetTrackId: StableEntityId;
  readonly editKind: "insert" | "overwrite" | "replace";
  readonly replaceClipId: StableEntityId | null;
  readonly timelineRate: NormalizedRational;
  readonly marks: ProfessionalSourceMarks;
}

export interface ResolvedThreePointEdit {
  readonly timelineRange: FrameRange;
  readonly sourceRange: FrameRange;
  readonly derivedPoint: "source-in" | "source-out" | "timeline-in" | "timeline-out" | "none";
}

export interface BuiltProfessionalSourceEdit {
  readonly command: InsertClipCommand | OverwriteClipCommand | ReplaceClipCommand;
  readonly resolved: ResolvedThreePointEdit;
  readonly sourceTransportFrame: MasterFrame;
  readonly timelineTransportUnchanged: true;
}

export const resolveThreePointEdit = (
  sourceClip: ClipSnapshot,
  timelineRate: NormalizedRational,
  marks: ProfessionalSourceMarks,
): ResolvedThreePointEdit => {
  const present = [marks.sourceIn, marks.sourceOut, marks.timelineIn, marks.timelineOut].filter(
    (value) => value !== null,
  ).length;
  if (present < 3) throw new Error("Three-point editing requires at least three source/timeline marks.");
  let sourceIn = marks.sourceIn;
  let sourceOut = marks.sourceOut;
  let timelineIn = marks.timelineIn;
  let timelineOut = marks.timelineOut;
  let derivedPoint: ResolvedThreePointEdit["derivedPoint"] = "none";

  if (sourceIn !== null && sourceOut !== null) {
    if (sourceOut <= sourceIn) throw new Error("Source out must be after source in.");
    const inverse = invertFrameTransform(
      createTimelineSourceTransform({
        timelineOrigin: masterFrame(0n),
        sourceOrigin: sourceIn,
        timelineRate,
        sourceRate: sourceClip.sourceRate,
        speed: sourceClip.speed,
      }),
    );
    const duration = mapFrameExact(inverse, sourceOut, "ceil");
    if (timelineIn === null && timelineOut !== null) {
      timelineIn = masterFrame(timelineOut - duration);
      derivedPoint = "timeline-in";
    } else if (timelineOut === null && timelineIn !== null) {
      timelineOut = masterFrame(timelineIn + duration);
      derivedPoint = "timeline-out";
    }
  }

  if (timelineIn !== null && timelineOut !== null) {
    if (timelineOut <= timelineIn) throw new Error("Timeline out must be after timeline in.");
    const transform = createTimelineSourceTransform({
      timelineOrigin: timelineIn,
      sourceOrigin: sourceIn ?? sourceOut ?? sourceClip.sourceRange.start,
      timelineRate,
      sourceRate: sourceClip.sourceRate,
      speed: sourceClip.speed,
    });
    if (sourceIn !== null && sourceOut === null) {
      sourceOut = mapFrameExact(transform, timelineOut, "ceil");
      derivedPoint = "source-out";
    } else if (sourceIn === null && sourceOut !== null) {
      const mappedDuration = mapFrameExact(
        { ...transform, inputOrigin: masterFrame(0n), outputOrigin: masterFrame(0n) },
        masterFrame(timelineOut - timelineIn),
        "ceil",
      );
      sourceIn = masterFrame(sourceOut - mappedDuration);
      derivedPoint = "source-in";
    }
  }

  if (sourceIn === null || sourceOut === null || timelineIn === null || timelineOut === null) {
    throw new Error("Three-point edit could not derive the missing endpoint.");
  }
  if (
    sourceIn < sourceClip.availableSourceRange.start ||
    sourceOut > sourceClip.availableSourceRange.end ||
    sourceIn >= sourceOut
  ) {
    throw new Error("Three-point edit exceeds available source handles.");
  }
  return {
    sourceRange: createFrameRange(sourceIn, sourceOut),
    timelineRange: createFrameRange(timelineIn, timelineOut),
    derivedPoint,
  };
};

export const buildProfessionalSourceEdit = (
  timeline: TimelineSnapshotV1,
  patch: ProfessionalSourcePatch,
  sourceTransportFrame: MasterFrame,
): BuiltProfessionalSourceEdit => {
  const track = timeline.tracks[patch.targetTrackId];
  if (track === undefined) throw new Error(`Target track ${patch.targetTrackId} does not exist.`);
  if (track.locked) throw new Error(`Target track ${patch.targetTrackId} is locked.`);
  const resolved = resolveThreePointEdit(patch.sourceClip, patch.timelineRate, patch.marks);
  const clip: ClipSnapshot = {
    ...patch.sourceClip,
    trackId: patch.targetTrackId,
    range: resolved.timelineRange,
    sourceRange: resolved.sourceRange,
  };
  let command: BuiltProfessionalSourceEdit["command"];
  if (patch.editKind === "insert") command = { kind: "clip.insert", clip };
  else if (patch.editKind === "overwrite") command = { kind: "clip.overwrite", clip };
  else {
    if (patch.replaceClipId === null) throw new Error("Replace edit requires a target clip ID.");
    const existing = timeline.clips[patch.replaceClipId];
    if (existing === undefined) throw new Error(`Replace target ${patch.replaceClipId} does not exist.`);
    command = {
      kind: "clip.replace",
      clipId: existing.id,
      replacement: {
        ...clip,
        id: existing.id,
        trackId: existing.trackId,
        range: existing.range,
      },
    };
  }
  return { command, resolved, sourceTransportFrame, timelineTransportUnchanged: true };
};
