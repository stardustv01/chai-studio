import { describe, expect, it } from "vitest";
import {
  normalizeRational,
  serializeBigInt,
  type TimelineDocument,
} from "../../packages/schema/src/index.js";
import {
  executeTimelineDocumentEdit,
  stableEntityId,
  timelineDocumentToSnapshot,
} from "../../packages/timeline/src/index.js";

const documentFixture = (): TimelineDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-adapter-0001",
  revisionId: "revision-adapter-0001",
  timelineId: "timeline-adapter-0001",
  fps: normalizeRational(30n, 1n),
  durationFrames: serializeBigInt(180n),
  tracks: [
    {
      id: "track-adapter-video-0001",
      kind: "video",
      name: "V1",
      order: 0,
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
      clips: [
        {
          id: "clip-adapter-video-0001",
          assetId: "asset-adapter-video-0001",
          engine: "remotion",
          startFrame: serializeBigInt(10n),
          durationFrames: serializeBigInt(50n),
          sourceInFrame: serializeBigInt(5n),
          sourceDurationFrames: serializeBigInt(50n),
          capability: "native",
          audioBusId: null,
          name: "Opening title",
          linkGroupId: null,
          selectionGroupId: null,
          metadata: { cache: "valid" },
          properties: {
            "transform.opacity": {
              value: 100,
              defaultValue: 100,
              unit: "percent",
              minimum: 0,
              maximum: 100,
              step: 0.1,
              ownership: "shared",
              keyframeable: true,
              capability: "unified",
              safeToEdit: true,
              nativeAnimation: false,
              supportsSharedConversion: false,
            },
          },
        },
      ],
    },
  ],
  audioBusIds: [],
  approvalReferenceIds: [],
  selection: {
    primaryId: "clip-adapter-video-0001",
    selectedIds: ["clip-adapter-video-0001"],
    anchorId: "clip-adapter-video-0001",
  },
  inOutRange: null,
  markers: [
    {
      id: "marker-adapter-review-0001",
      frame: serializeBigInt(90n),
      duration: serializeBigInt(0n),
      label: "Review",
      category: "issue",
      issueSeverity: "warning",
      annotationReferenceIds: [],
      ripplePolicy: "anchored-time",
    },
  ],
  keyframes: [
    {
      id: "keyframe-adapter-opacity-0001",
      ownerEntityId: "clip-adapter-video-0001",
      propertyPath: "transform.opacity",
      frame: serializeBigInt(20n),
      value: 100,
      interpolation: "linear",
      inTangent: null,
      outTangent: null,
      authority: "shared",
      preserveNativeAnimation: false,
    },
  ],
  automation: [
    {
      id: "lane-adapter-opacity-0001",
      ownerEntityId: "clip-adapter-video-0001",
      propertyPath: "transform.opacity",
      keyframeIds: ["keyframe-adapter-opacity-0001"],
      authority: "shared",
    },
  ],
});

describe("timeline document adapter", () => {
  it("round-trips frame-exact P05 edits through JSON-safe command payloads", () => {
    const result = executeTimelineDocumentEdit(
      documentFixture(),
      {
        kind: "clips.move",
        moves: [
          {
            clipId: "clip-adapter-video-0001",
            trackId: "track-adapter-video-0001",
            start: "24",
          },
        ],
      },
      "revision-adapter-0002",
    );

    expect(result).toMatchObject({
      label: "Move clip",
      affectedEntityIds: ["clip-adapter-video-0001"],
      timeline: { revisionId: "revision-adapter-0002" },
    });
    expect(result.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: "clip-adapter-video-0001",
      startFrame: "24",
      durationFrames: "50",
      sourceInFrame: "5",
      sourceDurationFrames: "50",
      name: "Opening title",
      capability: "native",
      metadata: { cache: "valid", capability: "native" },
    });
    const reopened = timelineDocumentToSnapshot(result.timeline);
    expect(Object.values(reopened.clips)[0]?.range).toEqual({ start: 24n, end: 74n });
    expect(reopened.selection.selectedIds).toEqual(["clip-adapter-video-0001"]);
    expect(Object.values(reopened.markers)[0]).toMatchObject({
      frame: 90n,
      label: "Review",
      issueSeverity: "warning",
    });
    expect(Object.values(reopened.keyframes)[0]).toMatchObject({
      id: "keyframe-adapter-opacity-0001",
      frame: 34n,
      propertyPath: "transform.opacity",
    });
  });

  it("round-trips create-track-and-move as one authenticated document edit", () => {
    const result = executeTimelineDocumentEdit(
      documentFixture(),
      {
        kind: "clips.move-to-new-track",
        track: {
          id: "track-adapter-video-0002",
          kind: "video",
          name: "V2",
          order: 1,
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          audioBusId: null,
          clipIds: [],
        },
        atIndex: 1,
        moves: [
          {
            clipId: "clip-adapter-video-0001",
            trackId: "track-adapter-video-0002",
            start: "24",
          },
        ],
      },
      "revision-adapter-0002",
    );

    expect(result).toMatchObject({
      label: "Create track and move clip",
      affectedEntityIds: ["track-adapter-video-0002", "clip-adapter-video-0001"],
      timeline: { revisionId: "revision-adapter-0002" },
    });
    expect(result.timeline.tracks).toEqual([
      expect.objectContaining({ id: "track-adapter-video-0001", clips: [] }),
      expect.objectContaining({
        id: "track-adapter-video-0002",
        name: "V2",
        clips: [
          expect.objectContaining({
            id: "clip-adapter-video-0001",
            startFrame: "24",
            durationFrames: "50",
          }),
        ],
      }),
    ]);
  });

  it("persists marker commands rather than dropping review authority on reopen", () => {
    const result = executeTimelineDocumentEdit(
      documentFixture(),
      {
        kind: "marker.update",
        markerId: "marker-adapter-review-0001",
        changes: { frame: "96", label: "Review handoff", issueSeverity: "info" },
      },
      "revision-adapter-0002",
    );
    expect(result.timeline.markers).toEqual([
      expect.objectContaining({
        id: "marker-adapter-review-0001",
        frame: "96",
        label: "Review handoff",
        issueSeverity: "info",
      }),
    ]);
  });

  it("persists validated properties and deterministic keyframe batches across reopen", () => {
    const propertyEdit = executeTimelineDocumentEdit(
      documentFixture(),
      {
        kind: "clips.properties.update",
        clipIds: ["clip-adapter-video-0001"],
        changes: { "transform.opacity": 64 },
      },
      "revision-adapter-0002",
    );
    const keyframeEdit = executeTimelineDocumentEdit(
      propertyEdit.timeline,
      {
        kind: "keyframes.update",
        updates: [
          {
            keyframeId: "keyframe-adapter-opacity-0001",
            changes: { frame: "30", value: 64, interpolation: "ease-in-out" },
          },
        ],
      },
      "revision-adapter-0003",
    );
    const reopened = timelineDocumentToSnapshot(keyframeEdit.timeline);
    const clipId = stableEntityId("clip-adapter-video-0001");
    const keyframeId = stableEntityId("keyframe-adapter-opacity-0001");
    const laneId = stableEntityId("lane-adapter-opacity-0001");

    expect(reopened.clips[clipId]?.properties?.["transform.opacity"]?.value).toBe(64);
    expect(reopened.keyframes[keyframeId]).toMatchObject({
      frame: 30n,
      value: 64,
      interpolation: "ease-in-out",
    });
    expect(reopened.automation[laneId]?.keyframeIds).toEqual(["keyframe-adapter-opacity-0001"]);
  });

  it("rejects commands outside the explicit document-edit registry", () => {
    expect(() =>
      executeTimelineDocumentEdit(
        documentFixture(),
        { kind: "timeline.restore", snapshot: null, reason: "bypass" },
        "revision-adapter-0002",
      ),
    ).toThrow("Unsupported or malformed timeline edit operation");
  });
});
