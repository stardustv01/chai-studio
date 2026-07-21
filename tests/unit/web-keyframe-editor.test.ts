import { describe, expect, it } from "vitest";
import {
  findAvailableKeyframePasteStart,
  tangentModeForKeys,
  tangentsForMode,
  uniqueKeyframesByFrame,
} from "../../apps/studio-web/src/keyframe-editor.js";

describe("keyframe editor collision and tangent helpers", () => {
  it("moves a pasted keyframe group to the nearest collision-free frame", () => {
    expect(
      findAvailableKeyframePasteStart({
        clipStart: 450n,
        clipEnd: 750n,
        preferredStart: 520n,
        relativeFrames: [0n, 20n],
        occupiedFrames: [500n, 520n],
      }),
    ).toBe(521n);
  });

  it("returns null when the copied keyframe span cannot fit inside the clip", () => {
    expect(
      findAvailableKeyframePasteStart({
        clipStart: 10n,
        clipEnd: 12n,
        preferredStart: 10n,
        relativeFrames: [0n, 2n],
        occupiedFrames: [],
      }),
    ).toBeNull();
  });

  it("keeps the latest key at each duplicate frame and preserves frame order", () => {
    expect(
      uniqueKeyframesByFrame([
        { id: "later-frame", frame: 20n },
        { id: "old-at-ten", frame: 10n },
        { id: "new-at-ten", frame: 10n },
      ]),
    ).toEqual([
      { id: "new-at-ten", frame: 10n },
      { id: "later-frame", frame: 20n },
    ]);
  });

  it.each(["auto", "continuous", "broken", "flat"] as const)(
    "round-trips the %s tangent mode through its persisted handles",
    (mode) => {
      expect(tangentModeForKeys([tangentsForMode(mode)])).toBe(mode);
    },
  );
});
