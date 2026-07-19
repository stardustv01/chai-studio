import { describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  buildTimelineDerivedIndexes,
  createEmptyTimelineSnapshot,
  createFrameRange,
  createReferenceTimelineFixture,
  executeTimelineCommand,
  masterFrame,
  queryActiveVisualLayers,
  queryClipsAtFrame,
  queryClipsOverlappingRange,
  queryNearbyClips,
  queryVisibleClipsOverlappingRange,
  searchTimelineIndex,
  stableEntityId,
  type ClipSnapshot,
  type StableEntityId,
  type TimelineSnapshotV1,
} from "../../packages/timeline/src/index.js";

describe("rebuildable timeline derived indexes", () => {
  it("ships a validated linked A/V reference fixture with markers and automation", () => {
    const fixture = createReferenceTimelineFixture();
    const indexes = buildTimelineDerivedIndexes(fixture);
    expect(fixture.trackIds).toHaveLength(2);
    expect(Object.keys(fixture.audioBuses)).toHaveLength(1);
    expect(Object.keys(fixture.keyframes)).toHaveLength(1);
    expect(indexes.markersInFrameOrder).toHaveLength(2);
  });

  it("builds stable grouping, ordering, entity-kind, and interval indexes", () => {
    const timeline = indexedTimeline();
    const indexes = buildTimelineDerivedIndexes(timeline);
    const track1 = stableEntityId("track-index-0001");
    const assetShared = stableEntityId("asset-index-shared-0001");

    expect(indexes.sourceRevisionId).toBe(timeline.revisionId);
    expect(indexes.clipsInTimelineOrder).toEqual([
      stableEntityId("clip-index-0001"),
      stableEntityId("clip-index-0002"),
      stableEntityId("clip-index-0003"),
    ]);
    expect(indexes.clipsByTrack[track1]).toEqual([
      stableEntityId("clip-index-0001"),
      stableEntityId("clip-index-0002"),
    ]);
    expect(indexes.clipsByAsset[assetShared]).toEqual([
      stableEntityId("clip-index-0001"),
      stableEntityId("clip-index-0003"),
    ]);
    expect(indexes.entityKindById[stableEntityId("marker-index-0001")]).toBe("marker");
    expect(queryClipsAtFrame(indexes, masterFrame(25n))).toEqual([
      stableEntityId("clip-index-0001"),
      stableEntityId("clip-index-0003"),
    ]);
    expect(
      queryClipsOverlappingRange(indexes, createFrameRange(masterFrame(45n), masterFrame(105n)), track1),
    ).toEqual([stableEntityId("clip-index-0001"), stableEntityId("clip-index-0002")]);
  });

  it("rebuilds from authoritative snapshots after edits without persisted cache state", () => {
    const timeline = indexedTimeline();
    const clipId = stableEntityId("clip-index-0003");
    const moved = executeTimelineCommand(timeline, {
      kind: "clips.move",
      moves: [
        {
          clipId,
          trackId: stableEntityId("track-index-0002"),
          start: masterFrame(60n),
        },
      ],
    });
    const rebuilt = buildTimelineDerivedIndexes(moved.snapshot);
    expect(queryClipsAtFrame(rebuilt, masterFrame(25n))).toEqual([stableEntityId("clip-index-0001")]);
    expect(queryClipsAtFrame(rebuilt, masterFrame(75n))).toEqual([clipId]);
    expect(buildTimelineDerivedIndexes(moved.snapshot)).toEqual(rebuilt);
  });

  it("indexes visible layers, nearby context, transcript search, and render dependencies", () => {
    const timeline = indexedTimeline();
    const clip1 = stableEntityId("clip-index-0001");
    const clip2 = stableEntityId("clip-index-0002");
    const phraseId = stableEntityId("phrase-index-0001");
    const indexes = buildTimelineDerivedIndexes(timeline, {
      transcriptPhrases: [
        {
          id: phraseId,
          clipId: clip1,
          range: createFrameRange(masterFrame(10n), masterFrame(20n)),
          text: "Hello observable universe",
        },
      ],
      renderDependencies: [{ entityId: clip2, dependencyIds: [clip1] }],
    });
    expect(queryActiveVisualLayers(timeline, indexes, masterFrame(25n))).toEqual([
      stableEntityId("clip-index-0003"),
      clip1,
    ]);
    expect(
      queryVisibleClipsOverlappingRange(
        timeline,
        indexes,
        createFrameRange(masterFrame(0n), masterFrame(30n)),
      ),
    ).toEqual([clip1, stableEntityId("clip-index-0003")]);
    expect(queryNearbyClips(indexes, masterFrame(75n), 1, 1)).toEqual([
      stableEntityId("clip-index-0003"),
      clip2,
    ]);
    expect(indexes.transcriptPhraseIdsByClip[clip1]).toEqual([phraseId]);
    expect(indexes.renderDependenciesByEntity[clip2]).toEqual([clip1]);
    expect(indexes.renderDependentsByEntity[clip1]).toEqual([clip2]);
    expect(searchTimelineIndex(indexes, "observable universe")).toEqual([phraseId]);
  });
});

const indexedTimeline = (): TimelineSnapshotV1 => {
  const track1 = stableEntityId("track-index-0001");
  const track2 = stableEntityId("track-index-0002");
  const clip1 = clip(stableEntityId("clip-index-0001"), track1, 0n, 50n, "asset-index-shared-0001");
  const clip2 = clip(stableEntityId("clip-index-0002"), track1, 100n, 150n, "asset-index-other-0001");
  const clip3 = clip(stableEntityId("clip-index-0003"), track2, 20n, 60n, "asset-index-shared-0001");
  const markerId = stableEntityId("marker-index-0001");
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-index-0001"),
    projectId: stableEntityId("project-index-0001"),
    revisionId: stableEntityId("revision-index-0001"),
    name: "Indexed timeline",
    fps: normalizeRational(30n, 1n),
  });
  return {
    ...base,
    duration: masterFrame(200n),
    trackIds: [track1, track2],
    tracks: {
      [track1]: track(track1, 0, [clip1.id, clip2.id]),
      [track2]: track(track2, 1, [clip3.id]),
    },
    clips: { [clip1.id]: clip1, [clip2.id]: clip2, [clip3.id]: clip3 },
    markers: {
      [markerId]: {
        id: markerId,
        frame: masterFrame(75n),
        duration: masterFrame(0n),
        label: "Review",
        category: "note",
        issueSeverity: null,
        annotationReferenceIds: [],
        ripplePolicy: "anchored-time",
      },
    },
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

const clip = (
  id: StableEntityId,
  trackId: StableEntityId,
  start: bigint,
  end: bigint,
  assetId: string,
): ClipSnapshot => ({
  id,
  trackId,
  assetId: stableEntityId(assetId),
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
