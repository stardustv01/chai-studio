import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  copyTimelineClips,
  createEmptyTimelineSnapshot,
  createFrameRange,
  createNudgeCommand,
  executeTimelineCommand,
  masterFrame,
  stableEntityId,
  type ClipSnapshot,
  type StableEntityId,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("selection, movement, and inverse behavior", () => {
  it("supports replace/add/toggle multi-selection with a stable outcome", () => {
    const timeline = commandTimeline();
    const clipA = stableEntityId("clip-video-0001");
    const clipB = stableEntityId("clip-video-0002");
    const selected = executeTimelineCommand(timeline, {
      kind: "selection.set",
      entityIds: [clipB, clipA],
      mode: "replace",
      primaryId: clipB,
    });
    expect(selected.snapshot.selection).toEqual({
      primaryId: clipB,
      selectedIds: [clipA, clipB],
      anchorId: clipB,
    });
    expect(selected.label).toBe("Select items");
    expect(selected.diff.changes).toEqual([
      expect.objectContaining({
        entityId: timeline.id,
        entityKind: "timeline",
        change: "modified",
        fields: ["selection"],
      }),
    ]);
    const toggled = executeTimelineCommand(selected.snapshot, {
      kind: "selection.set",
      entityIds: [clipB],
      mode: "toggle",
      primaryId: null,
    });
    expect(toggled.snapshot.selection.selectedIds).toEqual([clipA]);
    expect(executeTimelineCommand(selected.snapshot, selected.inverse).snapshot).toEqual(timeline);
  });

  it("moves and nudges clips across writable tracks using exact frame placements", () => {
    const timeline = commandTimeline();
    const clipA = stableEntityId("clip-video-0001");
    const trackV2 = stableEntityId("track-video-0002");
    const moved = executeTimelineCommand(timeline, {
      kind: "clips.move",
      moves: [{ clipId: clipA, trackId: trackV2, start: masterFrame(20n) }],
    });
    expect(moved.snapshot.clips[clipA]?.trackId).toBe(trackV2);
    expect(moved.snapshot.clips[clipA]?.range).toEqual({ start: 20n, end: 70n });
    expect(moved.label).toBe("Move clip");
    expect(moved.diff.changes).toContainEqual(
      expect.objectContaining({
        entityId: clipA,
        entityKind: "clip",
        change: "modified",
        fields: ["range", "trackId"],
      }),
    );
    const nudged = executeTimelineCommand(
      moved.snapshot,
      createNudgeCommand(moved.snapshot, [clipA], masterFrame(1n)),
    );
    expect(nudged.snapshot.clips[clipA]?.range).toEqual({ start: 21n, end: 71n });
    expect(executeTimelineCommand(moved.snapshot, nudged.inverse).snapshot).toEqual(moved.snapshot);
  });

  it("creates a compatible track and moves a clip as one exact undoable edit", () => {
    const timeline = commandTimeline();
    const clipId = stableEntityId("clip-video-0001");
    const trackId = stableEntityId("track-video-0003");
    const moved = executeTimelineCommand(timeline, {
      kind: "clips.move-to-new-track",
      atIndex: 2,
      track: track(trackId, 2, []),
      moves: [{ clipId, trackId, start: masterFrame(25n) }],
    });

    expect(moved.label).toBe("Create track and move clip");
    expect(moved.snapshot.trackIds).toEqual([...timeline.trackIds, trackId]);
    expect(moved.snapshot.tracks[trackId]?.clipIds).toEqual([clipId]);
    expect(moved.snapshot.clips[clipId]).toMatchObject({
      trackId,
      range: { start: 25n, end: 75n },
    });
    expect(executeTimelineCommand(moved.snapshot, moved.inverse).snapshot).toEqual(timeline);
  });

  it("rejects a new-track move whose clips target a different track", () => {
    const timeline = commandTimeline();
    const trackId = stableEntityId("track-video-0003");
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clips.move-to-new-track",
        atIndex: 2,
        track: track(trackId, 2, []),
        moves: [
          {
            clipId: stableEntityId("clip-video-0001"),
            trackId: stableEntityId("track-video-0002"),
            start: masterFrame(25n),
          },
        ],
      }),
    ).toThrow(/must target the new track/);
  });
});

describe("insert, overwrite, replace, duplicate, and clipboard commands", () => {
  it("inserts and ripples later clips, with an exact snapshot inverse", () => {
    const timeline = commandTimeline();
    const insertedClip = clip({
      id: stableEntityId("clip-video-0003"),
      trackId: stableEntityId("track-video-0001"),
      start: 50n,
      end: 70n,
    });
    const inserted = executeTimelineCommand(timeline, { kind: "clip.insert", clip: insertedClip });
    expect(inserted.snapshot.clips[stableEntityId("clip-video-0002")]?.range).toEqual({
      start: 120n,
      end: 170n,
    });
    expect(inserted.snapshot.selection.selectedIds).toEqual([insertedClip.id]);
    expect(executeTimelineCommand(inserted.snapshot, inserted.inverse).snapshot).toEqual(timeline);
  });

  it("overwrites conflicts and replaces content while preserving stable identity", () => {
    const timeline = commandTimeline();
    const overwrite = clip({
      id: stableEntityId("clip-video-0003"),
      trackId: stableEntityId("track-video-0001"),
      start: 40n,
      end: 110n,
    });
    const overwritten = executeTimelineCommand(timeline, { kind: "clip.overwrite", clip: overwrite });
    expect(Object.keys(overwritten.snapshot.clips)).toEqual([overwrite.id]);
    expect(overwritten.diff.addedCount).toBe(1);
    expect(overwritten.diff.removedCount).toBe(2);
    expect(overwritten.diff.summary).toMatch(/^1 added, 2 removed,/);

    const clipA = stableEntityId("clip-video-0001");
    const original = requireClip(timeline, clipA);
    const replacement: ClipSnapshot = {
      ...original,
      assetId: stableEntityId("asset-replacement-0001"),
      name: "Replacement",
    };
    const replaced = executeTimelineCommand(timeline, {
      kind: "clip.replace",
      clipId: clipA,
      replacement,
    });
    expect(replaced.snapshot.clips[clipA]?.assetId).toBe("asset-replacement-0001");
    expect(replaced.snapshot.clips[clipA]?.id).toBe(clipA);
  });

  it("duplicates with caller-supplied IDs and pastes a stable clipboard layout", () => {
    const timeline = commandTimeline();
    const clipA = stableEntityId("clip-video-0001");
    const clipB = stableEntityId("clip-video-0002");
    const trackV1 = stableEntityId("track-video-0001");
    const trackV2 = stableEntityId("track-video-0002");
    const duplicated = executeTimelineCommand(timeline, {
      kind: "clips.duplicate",
      mappings: [
        {
          sourceClipId: clipA,
          newClipId: stableEntityId("clip-video-0003"),
          targetTrackId: trackV1,
        },
      ],
      delta: masterFrame(50n),
    });
    expect(duplicated.snapshot.clips[stableEntityId("clip-video-0003")]?.range).toEqual({
      start: 50n,
      end: 100n,
    });

    const clipboard = copyTimelineClips(timeline, [clipA, clipB]);
    const pasted = executeTimelineCommand(timeline, {
      kind: "clips.paste",
      clipboard,
      atFrame: masterFrame(200n),
      mappings: [
        {
          sourceClipId: clipA,
          newClipId: stableEntityId("clip-paste-0001"),
          targetTrackId: trackV2,
        },
        {
          sourceClipId: clipB,
          newClipId: stableEntityId("clip-paste-0002"),
          targetTrackId: trackV2,
        },
      ],
    });
    expect(pasted.snapshot.clips[stableEntityId("clip-paste-0001")]?.range).toEqual({
      start: 200n,
      end: 250n,
    });
    expect(pasted.snapshot.clips[stableEntityId("clip-paste-0002")]?.range).toEqual({
      start: 300n,
      end: 350n,
    });
    expect(pasted.snapshot.duration).toBe(350n);
  });
});

describe("grouping, linking, and locked-track enforcement", () => {
  it("renames clips and merges or replaces user metadata with exact undo", () => {
    const timeline = commandTimeline();
    const clipId = stableEntityId("clip-video-0001");
    const merged = executeTimelineCommand(timeline, {
      kind: "clip.update",
      clipId,
      name: "Hero shot",
      metadata: { rating: "favorite", note: "Use this take" },
      metadataMode: "merge",
    });
    expect(merged.label).toBe("Rename clip");
    expect(merged.snapshot.clips[clipId]).toMatchObject({
      name: "Hero shot",
      metadata: { rating: "favorite", note: "Use this take" },
    });
    const replaced = executeTimelineCommand(merged.snapshot, {
      kind: "clip.update",
      clipId,
      metadata: { approved: "true" },
      metadataMode: "replace",
    });
    expect(replaced.snapshot.clips[clipId]?.metadata).toEqual({ approved: "true" });
    expect(executeTimelineCommand(merged.snapshot, merged.inverse).snapshot).toEqual(timeline);
  });

  it("groups, ungroups, links, and unlinks without changing clip identity", () => {
    const timeline = commandTimeline();
    const clips = [stableEntityId("clip-video-0001"), stableEntityId("clip-video-0002")];
    const groupId = stableEntityId("selection-group-0001");
    const linkId = stableEntityId("link-group-0001");
    const grouped = executeTimelineCommand(timeline, {
      kind: "clips.group",
      clipIds: clips,
      groupId,
    });
    expect(clips.map((id) => grouped.snapshot.clips[id]?.selectionGroupId)).toEqual([groupId, groupId]);
    const linked = executeTimelineCommand(grouped.snapshot, {
      kind: "clips.link",
      clipIds: clips,
      linkGroupId: linkId,
    });
    expect(clips.map((id) => linked.snapshot.clips[id]?.linkGroupId)).toEqual([linkId, linkId]);
    const unlinked = executeTimelineCommand(linked.snapshot, {
      kind: "clips.link",
      clipIds: clips,
      linkGroupId: null,
    });
    expect(clips.map((id) => unlinked.snapshot.clips[id]?.linkGroupId)).toEqual([null, null]);
  });

  it("rejects edits on locked source or destination tracks", () => {
    const timeline = commandTimeline();
    const trackId = stableEntityId("track-video-0001");
    const track = timeline.tracks[trackId];
    if (track === undefined) throw new Error("Fixture track is missing.");
    const locked: TimelineSnapshotV1 = {
      ...timeline,
      tracks: {
        ...timeline.tracks,
        [trackId]: { ...track, locked: true },
      },
    };
    expect(() =>
      executeTimelineCommand(locked, {
        kind: "clips.move",
        moves: [
          {
            clipId: stableEntityId("clip-video-0001"),
            trackId: stableEntityId("track-video-0002"),
            start: masterFrame(0n),
          },
        ],
      }),
    ).toThrow(/locked/);
  });
});

const commandTimeline = (): TimelineSnapshotV1 => {
  const trackV1 = stableEntityId("track-video-0001");
  const trackV2 = stableEntityId("track-video-0002");
  const clipA = clip({
    id: stableEntityId("clip-video-0001"),
    trackId: trackV1,
    start: 0n,
    end: 50n,
  });
  const clipB = clip({
    id: stableEntityId("clip-video-0002"),
    trackId: trackV1,
    start: 100n,
    end: 150n,
  });
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-command-0001"),
    projectId: stableEntityId("project-command-0001"),
    revisionId: stableEntityId("revision-command-0001"),
    name: "Command timeline",
    fps: normalizeRational(30n, 1n),
  });
  return {
    ...base,
    duration: masterFrame(200n),
    trackIds: [trackV1, trackV2],
    tracks: {
      [trackV1]: track(trackV1, 0, [clipA.id, clipB.id]),
      [trackV2]: track(trackV2, 1, []),
    },
    clips: { [clipA.id]: clipA, [clipB.id]: clipB },
  };
};

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

const clip = (input: {
  readonly id: StableEntityId;
  readonly trackId: StableEntityId;
  readonly start: bigint;
  readonly end: bigint;
}): ClipSnapshot => ({
  id: input.id,
  trackId: input.trackId,
  assetId: stableEntityId(`asset-${input.id}`),
  nestedSequenceId: null,
  engine: "shared",
  name: input.id,
  range: createFrameRange(masterFrame(input.start), masterFrame(input.end)),
  sourceRange: createFrameRange(masterFrame(0n), masterFrame(input.end - input.start)),
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

const requireClip = (timeline: TimelineSnapshotV1, id: StableEntityId): ClipSnapshot => {
  const value = timeline.clips[id];
  if (value === undefined) throw new Error(`Missing test clip ${id}.`);
  return value;
};
