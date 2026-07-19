import { describe, expect, it } from "vitest";
import {
  createStudioTimelineFixture,
  evaluateKeyframeSegment,
  executeTimelineCommand,
  masterFrame,
  sampleKeyframeCurve,
  stableEntityId,
} from "../../packages/timeline/src/index.js";

describe("P15 property authority and deterministic curves", () => {
  it("partitions persisted keyframes and automation across an explicit split lane", () => {
    const timeline = createStudioTimelineFixture();
    const clipId = stableEntityId("clip-studio-future-title");
    const rightClipId = stableEntityId("clip-studio-future-title-right");
    const laneId = stableEntityId("lane-studio-title-opacity-0001");
    const rightLaneId = stableEntityId("lane-studio-title-opacity-right");
    const split = executeTimelineCommand(timeline, {
      kind: "clips.split",
      atFrame: masterFrame(444n),
      splits: [
        {
          clipId,
          rightClipId,
          rightAutomationLaneIds: { [laneId]: rightLaneId },
        },
      ],
    });
    expect(split.snapshot.clips[clipId]?.keyframeIds).toEqual([
      stableEntityId("keyframe-studio-title-opacity-0001"),
    ]);
    expect(split.snapshot.clips[rightClipId]?.keyframeIds).toEqual([
      stableEntityId("keyframe-studio-title-opacity-0002"),
      stableEntityId("keyframe-studio-title-opacity-0003"),
    ]);
    expect(split.snapshot.automation[laneId]?.keyframeIds).toHaveLength(1);
    expect(split.snapshot.automation[rightLaneId]).toMatchObject({
      ownerEntityId: rightClipId,
      keyframeIds: [
        stableEntityId("keyframe-studio-title-opacity-0002"),
        stableEntityId("keyframe-studio-title-opacity-0003"),
      ],
    });
    expect(
      split.snapshot.keyframes[stableEntityId("keyframe-studio-title-opacity-0002")]?.ownerEntityId,
    ).toBe(rightClipId);
    expect(executeTimelineCommand(split.snapshot, split.inverse).snapshot).toEqual(timeline);
  });

  it("updates safe shared properties atomically and rejects one unsafe target without partial state", () => {
    const timeline = createStudioTimelineFixture();
    const safeIds = [
      stableEntityId("clip-studio-interview-a"),
      stableEntityId("clip-studio-product-macro"),
    ] as const;
    const updated = executeTimelineCommand(timeline, {
      kind: "clips.properties.update",
      clipIds: safeIds,
      changes: { "transform.opacity": 72 },
    });
    expect(safeIds.map((id) => updated.snapshot.clips[id]?.properties?.["transform.opacity"]?.value)).toEqual(
      [72, 72],
    );
    expect(updated.affectedEntityIds).toEqual(safeIds);

    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clips.properties.update",
        clipIds: [stableEntityId("clip-studio-interview-a"), stableEntityId("clip-studio-future-title")],
        changes: { "transform.rotation": 12 },
      }),
    ).toThrow("not validated for editing");
    expect(timeline.clips[safeIds[0]]?.properties?.["transform.rotation"]?.value).toBe(0);
  });

  it("requires explicit native-animation conversion before shared edits", () => {
    const timeline = createStudioTimelineFixture();
    const clipId = stableEntityId("clip-studio-future-title");
    expect(() =>
      executeTimelineCommand(timeline, {
        kind: "clips.properties.update",
        clipIds: [clipId],
        changes: { "transform.rotation": 18 },
      }),
    ).toThrow("not validated for editing");

    const converted = executeTimelineCommand(timeline, {
      kind: "clips.properties.convert-to-shared",
      clipIds: [clipId],
      propertyPaths: ["transform.rotation"],
    });
    const edited = executeTimelineCommand(converted.snapshot, {
      kind: "clips.properties.update",
      clipIds: [clipId],
      changes: { "transform.rotation": 18 },
    });
    expect(edited.snapshot.clips[clipId]?.properties?.["transform.rotation"]).toMatchObject({
      value: 18,
      ownership: "shared",
      nativeAnimation: false,
      safeToEdit: true,
    });
  });

  it("updates keyframes as one command and evaluates repeatable value and speed graphs", () => {
    const timeline = createStudioTimelineFixture();
    const ids = [
      stableEntityId("keyframe-studio-title-opacity-0001"),
      stableEntityId("keyframe-studio-title-opacity-0002"),
      stableEntityId("keyframe-studio-title-opacity-0003"),
    ] as const;
    const aligned = executeTimelineCommand(timeline, {
      kind: "keyframes.update",
      updates: ids.map((keyframeId) => ({ keyframeId, changes: { interpolation: "ease-in-out" } })),
    });
    expect(ids.map((id) => aligned.snapshot.keyframes[id]?.interpolation)).toEqual([
      "ease-in-out",
      "ease-in-out",
      "ease-in-out",
    ]);

    const left = aligned.snapshot.keyframes[ids[0]];
    const right = aligned.snapshot.keyframes[ids[1]];
    if (left === undefined || right === undefined) throw new Error("Missing curve fixture keyframes.");
    expect(evaluateKeyframeSegment(left, right, masterFrame(430n))).toBe(0);
    expect(evaluateKeyframeSegment(left, right, masterFrame(520n))).toBe(100);
    const first = sampleKeyframeCurve(left, right, 9);
    const second = sampleKeyframeCurve(left, right, 9);
    expect(first).toEqual(second);
    expect(first).toHaveLength(9);
    expect(first[4]?.value).toBeCloseTo(50, 5);
    expect(typeof first[4]?.speed).toBe("number");
  });
});
