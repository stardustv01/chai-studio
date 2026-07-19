import { describe, expect, it } from "vitest";
import { AudioMeterHistory, executeAudioGraphCommand } from "../../packages/audio/src/index.js";
import { serializeBigInt } from "../../packages/schema/src/index.js";
import { createAudioGraphFixture } from "../fixtures/audio-fixtures.js";

describe("P25 professional audio editing", () => {
  it("edits crossfades, ducking rules, and sync anchors with exact inverses", () => {
    const graph = createAudioGraphFixture();
    const originalCrossfade = required(graph.crossfades[0]);
    const crossfade = executeAudioGraphCommand(graph, {
      kind: "audio.crossfade.upsert",
      crossfade: { ...originalCrossfade, curve: "linear" },
    });
    expect(crossfade.graph.crossfades[0]?.curve).toBe("linear");
    expect(executeAudioGraphCommand(crossfade.graph, crossfade.inverse).graph).toEqual(graph);

    const originalRule = required(graph.duckingRules[0]);
    const ducking = executeAudioGraphCommand(graph, {
      kind: "audio.ducking.upsert",
      rule: { ...originalRule, reductionDb: -12 },
    });
    expect(ducking.graph.duckingRules[0]?.reductionDb).toBe(-12);
    expect(executeAudioGraphCommand(ducking.graph, ducking.inverse).graph).toEqual(graph);

    const clip = required(graph.clips[0]);
    const anchor = {
      id: "audio-sync-professional-0001",
      label: "Slate",
      frame: serializeBigInt(12n),
      sourceSample: serializeBigInt(19_219n),
      toleranceSamples: serializeBigInt(1n),
    };
    const anchored = executeAudioGraphCommand(graph, {
      kind: "audio.sync-anchor.upsert",
      anchor,
      clipId: clip.id,
    });
    expect(anchored.graph.syncAnchors).toContainEqual(anchor);
    expect(anchored.graph.clips[0]?.syncAnchorIds).toContain(anchor.id);
    expect(executeAudioGraphCommand(anchored.graph, anchored.inverse).graph).toEqual(graph);
  });

  it("retains a bounded exact-frame meter history for local UI inspection", () => {
    const history = new AudioMeterHistory(2);
    history.append({ frame: 1n, busId: "bus-master", peakDb: -2, rmsDb: -12, clippedSamples: 0 });
    history.append({ frame: 2n, busId: "bus-master", peakDb: -1, rmsDb: -10, clippedSamples: 0 });
    history.append({ frame: 3n, busId: "bus-master", peakDb: 0, rmsDb: -9, clippedSamples: 1 });
    expect(history.query({ busId: "bus-master", startFrame: 0n, endFrameExclusive: 4n })).toEqual([
      expect.objectContaining({ frame: 2n }),
      expect.objectContaining({ frame: 3n, clippedSamples: 1 }),
    ]);
  });
});

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Required audio fixture value is missing.");
  return value;
};
