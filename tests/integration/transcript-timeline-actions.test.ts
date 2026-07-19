import { describe, expect, it } from "vitest";
import { phraseTimelineActionPlan } from "../../packages/captions/src/index.js";
import type { TranscriptPhrase } from "../../packages/schema/src/index.js";
import {
  createFrameRange,
  createStudioTimelineFixture,
  executeTimelineCommand,
  masterFrame,
  stableEntityId,
} from "../../packages/timeline/src/index.js";

describe("P17 phrase-linked reversible timeline actions", () => {
  it("seeks, selects, marks, and splits at the exact phrase boundary with exact inverses", () => {
    const timeline = createStudioTimelineFixture();
    const phrase = {
      id: "transcript-phrase-edit-0001",
      speakerId: null,
      wordIds: ["transcript-word-edit-0001"],
      text: "Split the selected picture at this phrase.",
      startFrame: "470",
      endFrameExclusive: "520",
      confidence: 0.98,
      correctionState: "reviewed",
      locked: false,
      captionCueId: "caption-cue-edit-0001",
    } as unknown as TranscriptPhrase;
    const plan = phraseTimelineActionPlan(phrase);
    expect(plan.seekFrame).toBe("470");

    const rangeResult = executeTimelineCommand(timeline, {
      kind: "range.set",
      range: createFrameRange(
        masterFrame(BigInt(plan.range.startFrame)),
        masterFrame(BigInt(plan.range.endFrameExclusive)),
      ),
    });
    expect(rangeResult.snapshot.inOutRange).toEqual({ start: 470n, end: 520n });
    expect(executeTimelineCommand(rangeResult.snapshot, rangeResult.inverse).snapshot).toEqual(timeline);

    const markerResult = executeTimelineCommand(timeline, {
      kind: "marker.add",
      marker: {
        id: stableEntityId("marker-transcript-phrase-edit-0001"),
        frame: masterFrame(BigInt(plan.marker.frame)),
        duration: masterFrame(BigInt(plan.marker.duration)),
        label: plan.marker.label,
        category: "note",
        issueSeverity: null,
        annotationReferenceIds: [stableEntityId(phrase.id)],
        ripplePolicy: "anchored-content",
      },
    });
    expect(markerResult.snapshot.markers[stableEntityId("marker-transcript-phrase-edit-0001")]).toMatchObject(
      {
        frame: 470n,
        duration: 50n,
      },
    );
    expect(executeTimelineCommand(markerResult.snapshot, markerResult.inverse).snapshot).toEqual(timeline);

    const selectedClipId = stableEntityId("clip-studio-future-title");
    const rightClipId = stableEntityId("clip-transcript-phrase-right-0001");
    const splitResult = executeTimelineCommand(timeline, {
      kind: "clips.split",
      atFrame: masterFrame(BigInt(plan.splitFrame)),
      splits: [
        {
          clipId: selectedClipId,
          rightClipId,
          rightAutomationLaneIds: {
            [stableEntityId("lane-studio-title-opacity-0001")]: stableEntityId(
              "lane-transcript-phrase-right-opacity-0001",
            ),
          },
        },
      ],
    });
    expect(splitResult.snapshot.clips[selectedClipId]?.range).toEqual({ start: 430n, end: 470n });
    expect(splitResult.snapshot.clips[rightClipId]?.range).toEqual({ start: 470n, end: 760n });
    expect(executeTimelineCommand(splitResult.snapshot, splitResult.inverse).snapshot).toEqual(timeline);
  });
});
