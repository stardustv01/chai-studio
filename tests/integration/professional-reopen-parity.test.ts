import { describe, expect, it } from "vitest";
import {
  normalizeRational,
  serializeBigInt,
  type TimelineDocument,
} from "../../packages/schema/src/index.js";
import {
  executeTimelineDocumentEdit,
  readProfessionalTimelineState,
  stableEntityId,
  timelineDocumentToSnapshot,
} from "../../packages/timeline/src/index.js";

describe("P25 professional persistence and reopen parity", () => {
  it("round-trips range effects and playback policy through the closed revision schema", () => {
    const adjusted = executeTimelineDocumentEdit(
      documentFixture(),
      {
        kind: "adjustment.upsert",
        layer: {
          id: "adjustment-reopen-0001",
          clipId: "clip-reopen-0001",
          range: { start: "20", end: "40" },
          effects: [
            {
              id: "effect-reopen-0001",
              name: "Shared exposure",
              ownership: "common",
              engine: null,
              capability: "unified",
              parameters: { exposure: 0.5 },
              fallback: "shared",
            },
          ],
        },
      },
      "revision-reopen-0002",
    );
    expect(adjusted.timeline.professionalMetadata).toBeDefined();
    const reopened = timelineDocumentToSnapshot(adjusted.timeline);
    const layer =
      readProfessionalTimelineState(reopened).adjustmentLayers[stableEntityId("adjustment-reopen-0001")];
    expect(layer).toMatchObject({
      range: { start: 20n, end: 40n },
      effects: [expect.objectContaining({ name: "Shared exposure" })],
    });

    const playback = executeTimelineDocumentEdit(
      adjusted.timeline,
      {
        kind: "clip.playback",
        clipId: "clip-reopen-0001",
        mode: "freeze",
        freezeSourceFrame: "15",
        audioBehavior: "mute",
      },
      "revision-reopen-0003",
    );
    expect(
      timelineDocumentToSnapshot(playback.timeline).clips[stableEntityId("clip-reopen-0001")]?.metadata,
    ).toMatchObject({
      playbackMode: "freeze",
      freezeSourceFrame: "15",
    });
  });
});

const documentFixture = (): TimelineDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-reopen-0001",
  revisionId: "revision-reopen-0001",
  timelineId: "timeline-reopen-0001",
  fps: normalizeRational(30n, 1n),
  durationFrames: serializeBigInt(100n),
  tracks: [
    {
      id: "track-reopen-0001",
      kind: "video",
      name: "V1",
      order: 0,
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
      clips: [
        {
          id: "clip-reopen-0001",
          assetId: "asset-reopen-0001",
          engine: "remotion",
          startFrame: serializeBigInt(10n),
          durationFrames: serializeBigInt(50n),
          sourceInFrame: serializeBigInt(5n),
          sourceDurationFrames: serializeBigInt(50n),
          capability: "unified",
          audioBusId: null,
          metadata: {},
        },
      ],
    },
  ],
  audioBusIds: [],
  approvalReferenceIds: [],
});
