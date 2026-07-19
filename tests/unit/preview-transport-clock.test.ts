import { describe, expect, it } from "vitest";
import {
  createPreviewFrameRange,
  framesForSecondStep,
  InvalidPreviewTransportTransitionError,
  presentationTimestampForFrame,
  PreviewMasterClock,
  transitionPreviewTransport,
} from "../../packages/preview/src/index.js";

describe("P09 preview transport and master clock", () => {
  it("exposes every transport state and rejects invalid transitions", () => {
    let state = transitionPreviewTransport("stopped", "load");
    expect(state).toBe("loading");
    state = transitionPreviewTransport(state, "ready");
    expect(state).toBe("paused");
    state = transitionPreviewTransport(state, "play");
    expect(state).toBe("playing");
    state = transitionPreviewTransport(state, "buffer");
    expect(state).toBe("buffering");
    state = transitionPreviewTransport(state, "seek");
    expect(state).toBe("seeking");
    state = transitionPreviewTransport(state, "fail");
    expect(state).toBe("error");
    state = transitionPreviewTransport(state, "recover");
    expect(state).toBe("loading");
    state = transitionPreviewTransport(state, "dispose");
    expect(state).toBe("disposed");
    expect(() => transitionPreviewTransport(state, "play")).toThrow(InvalidPreviewTransportTransitionError);
    expect(() => transitionPreviewTransport("paused", "ready")).toThrow(/cannot apply ready/);
  });

  it("keeps integer frames authoritative at rational NTSC time", () => {
    expect(presentationTimestampForFrame("300", { numerator: "30000", denominator: "1001" })).toEqual({
      numerator: "1001",
      denominator: "100",
    });
    expect(framesForSecondStep(1, { numerator: "30000", denominator: "1001" })).toBe(30n);
    expect(framesForSecondStep(-1, { numerator: "24000", denominator: "1001" })).toBe(-24n);

    const clock = new PreviewMasterClock({
      durationFrames: "120",
      timelineFps: { numerator: "30000", denominator: "1001" },
      initialFrame: "9",
    });
    clock.setLoopRange(createPreviewFrameRange("10", "13"));
    expect(clock.advance(1n).masterFrame).toBe("10");
    expect(clock.advance(3n).masterFrame).toBe("10");
    expect(clock.stepSeconds(1).masterFrame).toBe("40");
    expect(clock.setPlayRate({ numerator: "-4", denominator: "1" }).playRate).toEqual({
      numerator: "-4",
      denominator: "1",
    });
    expect(() => clock.setPlayRate({ numerator: "5", denominator: "1" })).toThrow(/within -4x to \+4x/);
  });
});
