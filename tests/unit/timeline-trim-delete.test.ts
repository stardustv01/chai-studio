import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  createBladeCommand,
  createEmptyTimelineSnapshot,
  createFrameRange,
  executeTimelineCommand,
  masterFrame,
  stableEntityId,
  type ClipSnapshot,
  type MarkerSnapshot,
  type StableEntityId,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("blade and exact split commands", () => {
  it("splits timeline and source ranges with explicit stable IDs and an exact inverse", () => {
    const timeline = editTimeline();
    const clipA = stableEntityId("clip-edit-0001");
    const rightId = stableEntityId("clip-edit-right-0001");
    const split = executeTimelineCommand(
      timeline,
      createBladeCommand(timeline, masterFrame(40n), { [clipA]: rightId }),
    );

    expect(split.snapshot.clips[clipA]?.range).toEqual({ start: 0n, end: 40n });
    expect(split.snapshot.clips[clipA]?.sourceRange).toEqual({ start: 0n, end: 40n });
    expect(split.snapshot.clips[rightId]?.range).toEqual({ start: 40n, end: 100n });
    expect(split.snapshot.clips[rightId]?.sourceRange).toEqual({ start: 40n, end: 100n });
    expect(executeTimelineCommand(split.snapshot, split.inverse).snapshot).toEqual(timeline);
  });

  it("rejects boundary blades and incomplete linked-media splits", () => {
    const timeline = editTimeline();
    expect(() => createBladeCommand(timeline, masterFrame(100n), {})).toThrow(/does not intersect/);

    const linked = withLinkedCompanion(timeline);
    const clipA = stableEntityId("clip-edit-0001");
    expect(() =>
      executeTimelineCommand(linked, {
        kind: "clips.split",
        atFrame: masterFrame(40n),
        splits: [{ clipId: clipA, rightClipId: stableEntityId("clip-edit-right-0001") }],
      }),
    ).toThrow(/omits linked clip/);
  });
});

describe("trim and ripple-trim commands", () => {
  it("trims in and out with exact source mapping", () => {
    const timeline = editTimeline();
    const clipA = stableEntityId("clip-edit-0001");
    const trimmedIn = executeTimelineCommand(timeline, {
      kind: "clips.trim",
      trims: [{ clipId: clipA, edge: "in", toFrame: masterFrame(20n) }],
      ripple: false,
    });
    expect(trimmedIn.snapshot.clips[clipA]?.range).toEqual({ start: 20n, end: 100n });
    expect(trimmedIn.snapshot.clips[clipA]?.sourceRange).toEqual({ start: 20n, end: 100n });

    const trimmedOut = executeTimelineCommand(timeline, {
      kind: "clips.trim",
      trims: [{ clipId: clipA, edge: "out", toFrame: masterFrame(80n) }],
      ripple: false,
    });
    expect(trimmedOut.snapshot.clips[clipA]?.range).toEqual({ start: 0n, end: 80n });
    expect(trimmedOut.snapshot.clips[clipA]?.sourceRange).toEqual({ start: 0n, end: 80n });
    expect(executeTimelineCommand(trimmedOut.snapshot, trimmedOut.inverse).snapshot).toEqual(timeline);
  });

  it("ripple-trims both edges and shifts later clips by the exact delta", () => {
    const timeline = editTimeline();
    const clipA = stableEntityId("clip-edit-0001");
    const clipB = stableEntityId("clip-edit-0002");
    const out = executeTimelineCommand(timeline, {
      kind: "clips.trim",
      trims: [{ clipId: clipA, edge: "out", toFrame: masterFrame(80n) }],
      ripple: true,
    });
    expect(out.snapshot.clips[clipB]?.range).toEqual({ start: 100n, end: 150n });

    const inResult = executeTimelineCommand(timeline, {
      kind: "clips.trim",
      trims: [{ clipId: clipA, edge: "in", toFrame: masterFrame(20n) }],
      ripple: true,
    });
    expect(inResult.snapshot.clips[clipA]?.range).toEqual({ start: 0n, end: 80n });
    expect(inResult.snapshot.clips[clipA]?.sourceRange).toEqual({ start: 20n, end: 100n });
    expect(inResult.snapshot.clips[clipB]?.range).toEqual({ start: 100n, end: 150n });
  });

  it("rejects handle overrun and locked-track trims", () => {
    const timeline = editTimeline();
    const clipA = stableEntityId("clip-edit-0001");
    const clip = requireClip(timeline, clipA);
    const offsetTimeline: TimelineSnapshotV1 = {
      ...timeline,
      clips: {
        ...timeline.clips,
        [clipA]: {
          ...clip,
          range: createFrameRange(masterFrame(20n), masterFrame(120n)),
        },
      },
    };
    expect(() =>
      executeTimelineCommand(offsetTimeline, {
        kind: "clips.trim",
        trims: [{ clipId: clipA, edge: "in", toFrame: masterFrame(10n) }],
        ripple: false,
      }),
    ).toThrow(/available handles/);

    const locked = lockTrack(timeline, clip.trackId);
    expect(() =>
      executeTimelineCommand(locked, {
        kind: "clips.trim",
        trims: [{ clipId: clipA, edge: "out", toFrame: masterFrame(80n) }],
        ripple: false,
      }),
    ).toThrow(/locked/);
  });
});

describe("lift, delete, ripple-delete, and in/out range commands", () => {
  it("lifts and deletes without closing gaps", () => {
    const timeline = editTimeline();
    const clipA = stableEntityId("clip-edit-0001");
    const clipB = stableEntityId("clip-edit-0002");
    for (const kind of ["clips.lift", "clips.delete"] as const) {
      const removed = executeTimelineCommand(timeline, { kind, clipIds: [clipA] });
      expect(removed.snapshot.clips[clipA]).toBeUndefined();
      expect(removed.snapshot.clips[clipB]?.range).toEqual({ start: 120n, end: 170n });
      expect(executeTimelineCommand(removed.snapshot, removed.inverse).snapshot).toEqual(timeline);
    }
  });

  it("ripple-deletes and closes the exact deleted interval", () => {
    const timeline = editTimeline();
    const clipA = stableEntityId("clip-edit-0001");
    const clipB = stableEntityId("clip-edit-0002");
    const removed = executeTimelineCommand(timeline, {
      kind: "clips.ripple-delete",
      clipIds: [clipA],
    });
    expect(removed.snapshot.clips[clipA]).toBeUndefined();
    expect(removed.snapshot.clips[clipB]?.range).toEqual({ start: 20n, end: 70n });
  });

  it("persists, clears, bounds-checks, and reverses the in/out range", () => {
    const timeline = editTimeline();
    const range = createFrameRange(masterFrame(25n), masterFrame(125n));
    const set = executeTimelineCommand(timeline, { kind: "range.set", range });
    expect(set.snapshot.inOutRange).toEqual(range);
    const clear = executeTimelineCommand(set.snapshot, { kind: "range.clear" });
    expect(clear.snapshot.inOutRange).toBeNull();
    expect(executeTimelineCommand(set.snapshot, set.inverse).snapshot).toEqual(timeline);
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "range.set",
        range: createFrameRange(masterFrame(190n), masterFrame(210n)),
      }),
    ).toThrow(/inside timeline duration/);
  });
});

describe("track metadata and registry commands", () => {
  it("adds, reorders, and updates tracks with normalized deterministic order", () => {
    const timeline = editTimeline();
    const firstTrackId = timeline.trackIds[0];
    if (firstTrackId === undefined) throw new Error("Fixture track is missing.");
    const newTrackId = stableEntityId("track-edit-added-0001");
    const added = executeTimelineCommand(timeline, {
      kind: "track.add",
      track: track(newTrackId, 99, []),
      atIndex: 0,
    });
    expect(added.snapshot.trackIds).toEqual([newTrackId, firstTrackId]);
    expect(added.snapshot.tracks[newTrackId]?.order).toBe(0);
    expect(added.snapshot.tracks[firstTrackId]?.order).toBe(1);

    const reordered = executeTimelineCommand(added.snapshot, {
      kind: "tracks.reorder",
      trackIds: [firstTrackId, newTrackId],
    });
    expect(reordered.snapshot.tracks[firstTrackId]?.order).toBe(0);
    expect(reordered.snapshot.tracks[newTrackId]?.order).toBe(1);

    const updated = executeTimelineCommand(reordered.snapshot, {
      kind: "track.update",
      trackId: newTrackId,
      changes: { name: "Cutaways", hidden: true, muted: true },
    });
    expect(updated.snapshot.tracks[newTrackId]).toMatchObject({
      name: "Cutaways",
      hidden: true,
      muted: true,
    });
    expect(executeTimelineCommand(updated.snapshot, updated.inverse).snapshot).toEqual(reordered.snapshot);
  });

  it("requires explicit clip destruction and preserves an exact remove inverse", () => {
    const timeline = editTimeline();
    const trackId = timeline.trackIds[0];
    if (trackId === undefined) throw new Error("Fixture track is missing.");
    expect(() =>
      executeTimelineCommand(timeline, { kind: "track.remove", trackId, removeClips: false }),
    ).toThrow(/explicit removeClips/);

    const removed = executeTimelineCommand(timeline, {
      kind: "track.remove",
      trackId,
      removeClips: true,
    });
    expect(removed.snapshot.trackIds).toEqual([]);
    expect(Object.keys(removed.snapshot.clips)).toEqual([]);
    expect(executeTimelineCommand(removed.snapshot, removed.inverse).snapshot).toEqual(timeline);
  });

  it("rejects incomplete reorders and invalid cross-kind routing metadata", () => {
    const timeline = editTimeline();
    const trackId = timeline.trackIds[0];
    if (trackId === undefined) throw new Error("Fixture track is missing.");
    expect(() => executeTimelineCommand(timeline, { kind: "tracks.reorder", trackIds: [] })).toThrow(
      /every existing stable track ID/,
    );
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "track.update",
        trackId,
        changes: { audioBusId: stableEntityId("bus-invalid-0001") },
      }),
    ).toThrow(/Non-audio track cannot own an audio bus/);
  });
});

describe("marker commands and ripple policy", () => {
  it("adds, updates, removes, validates, and restores stable markers", () => {
    const timeline = editTimeline();
    const marker = timelineMarker(stableEntityId("marker-edit-0001"), 50n, "anchored-time");
    const added = executeTimelineCommand(timeline, { kind: "marker.add", marker });
    expect(added.snapshot.markers[marker.id]).toEqual(marker);

    const updated = executeTimelineCommand(added.snapshot, {
      kind: "marker.update",
      markerId: marker.id,
      changes: { label: "Continuity issue", category: "issue", issueSeverity: "warning" },
    });
    expect(updated.snapshot.markers[marker.id]).toMatchObject({
      label: "Continuity issue",
      category: "issue",
      issueSeverity: "warning",
    });
    const removed = executeTimelineCommand(updated.snapshot, {
      kind: "markers.remove",
      markerIds: [marker.id],
    });
    expect(removed.snapshot.markers[marker.id]).toBeUndefined();
    expect(executeTimelineCommand(removed.snapshot, removed.inverse).snapshot).toEqual(updated.snapshot);
  });

  it("moves only content-anchored markers during insert and removes or shifts them during ripple delete", () => {
    const timeline = withMarkers(editTimeline(), [
      timelineMarker(stableEntityId("marker-content-late-0001"), 130n, "anchored-content"),
      timelineMarker(stableEntityId("marker-time-late-0001"), 130n, "anchored-time"),
      timelineMarker(stableEntityId("marker-content-cut-0001"), 50n, "anchored-content"),
    ]);
    const insertedClip = clip(
      stableEntityId("clip-edit-insert-0001"),
      stableEntityId("track-edit-0001"),
      100n,
      110n,
    );
    const inserted = executeTimelineCommand(timeline, { kind: "clip.insert", clip: insertedClip });
    expect(inserted.snapshot.markers[stableEntityId("marker-content-late-0001")]?.frame).toBe(140n);
    expect(inserted.snapshot.markers[stableEntityId("marker-time-late-0001")]?.frame).toBe(130n);

    const ripple = executeTimelineCommand(timeline, {
      kind: "clips.ripple-delete",
      clipIds: [stableEntityId("clip-edit-0001")],
    });
    expect(ripple.snapshot.markers[stableEntityId("marker-content-late-0001")]?.frame).toBe(30n);
    expect(ripple.snapshot.markers[stableEntityId("marker-content-cut-0001")]).toBeUndefined();
    expect(ripple.snapshot.markers[stableEntityId("marker-time-late-0001")]?.frame).toBe(130n);
  });
});

const editTimeline = (): TimelineSnapshotV1 => {
  const trackId = stableEntityId("track-edit-0001");
  const clipA = clip(stableEntityId("clip-edit-0001"), trackId, 0n, 100n);
  const clipB = clip(stableEntityId("clip-edit-0002"), trackId, 120n, 170n);
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-edit-0001"),
    projectId: stableEntityId("project-edit-0001"),
    revisionId: stableEntityId("revision-edit-0001"),
    name: "Edit timeline",
    fps: normalizeRational(30n, 1n),
  });
  return {
    ...base,
    duration: masterFrame(200n),
    trackIds: [trackId],
    tracks: { [trackId]: track(trackId, 0, [clipA.id, clipB.id]) },
    clips: { [clipA.id]: clipA, [clipB.id]: clipB },
  };
};

const withLinkedCompanion = (timeline: TimelineSnapshotV1): TimelineSnapshotV1 => {
  const clipAId = stableEntityId("clip-edit-0001");
  const clipA = requireClip(timeline, clipAId);
  const linkGroupId = stableEntityId("link-edit-0001");
  const companionTrackId = stableEntityId("track-edit-0002");
  const companion = {
    ...clip(stableEntityId("clip-edit-audio-0001"), companionTrackId, 0n, 100n),
    linkGroupId,
  };
  return {
    ...timeline,
    trackIds: [...timeline.trackIds, companionTrackId],
    tracks: {
      ...timeline.tracks,
      [companionTrackId]: track(companionTrackId, 1, [companion.id]),
    },
    clips: {
      ...timeline.clips,
      [clipAId]: { ...clipA, linkGroupId },
      [companion.id]: companion,
    },
  };
};

const withMarkers = (
  timeline: TimelineSnapshotV1,
  markers: readonly MarkerSnapshot[],
): TimelineSnapshotV1 => ({
  ...timeline,
  markers: Object.fromEntries(markers.map((marker) => [marker.id, marker])),
});

const timelineMarker = (
  id: StableEntityId,
  frame: bigint,
  ripplePolicy: MarkerSnapshot["ripplePolicy"],
): MarkerSnapshot => ({
  id,
  frame: masterFrame(frame),
  duration: masterFrame(0n),
  label: id,
  category: "note",
  issueSeverity: null,
  annotationReferenceIds: [],
  ripplePolicy,
});

const track = (id: StableEntityId, order: number, clipIds: readonly StableEntityId[]) => ({
  id,
  kind: "video" as const,
  name: `V${String(order + 1)}`,
  order,
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  audioBusId: null,
  clipIds,
});

const clip = (id: StableEntityId, trackId: StableEntityId, start: bigint, end: bigint): ClipSnapshot => ({
  id,
  trackId,
  assetId: stableEntityId(`asset-${id}`),
  nestedSequenceId: null,
  engine: "shared",
  name: id,
  range: createFrameRange(masterFrame(start), masterFrame(end)),
  sourceRange: createFrameRange(masterFrame(0n), masterFrame(end - start)),
  sourceRate: normalizeRational(30n, 1n),
  speed: normalizeRational(1n, 1n),
  availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(500n)),
  linkGroupId: null,
  selectionGroupId: null,
  transitionInId: null,
  transitionOutId: null,
  keyframeIds: [],
  metadata: {},
});

const lockTrack = (timeline: TimelineSnapshotV1, trackId: StableEntityId): TimelineSnapshotV1 => ({
  ...timeline,
  tracks: {
    ...timeline.tracks,
    [trackId]: { ...requireTrack(timeline, trackId), locked: true },
  },
});

const requireClip = (timeline: TimelineSnapshotV1, id: StableEntityId): ClipSnapshot => {
  const value = timeline.clips[id];
  if (value === undefined) throw new Error(`Missing test clip ${id}.`);
  return value;
};

const requireTrack = (timeline: TimelineSnapshotV1, id: StableEntityId) => {
  const value = timeline.tracks[id];
  if (value === undefined) throw new Error(`Missing test track ${id}.`);
  return value;
};
