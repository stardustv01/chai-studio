import { describe, expect, it } from "vitest";
import {
  EventReplayGapError,
  StudioEventHub,
  formatStudioServerSentEvent,
} from "../../apps/studio-server/src/index.js";

describe("Studio ordered event hub", () => {
  it("publishes strict sequence order, resumes after a cursor, and detects retention gaps", () => {
    const hub = new StudioEventHub({
      capacity: 10,
      now: () => new Date("2026-07-15T15:00:00.000Z"),
    });
    const observed: string[] = [];
    const stop = hub.subscribe((event) => {
      observed.push(event.sequence);
    });
    for (let index = 1; index <= 12; index += 1) {
      hub.publish({ type: "fixture.changed", payload: { index } });
    }
    stop();

    expect(observed).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1)));
    expect(hub.replay("8").map((event) => event.sequence)).toEqual(["9", "10", "11", "12"]);
    expect(() => hub.replay("0")).toThrow(EventReplayGapError);
    const latest = hub.replay("11")[0];
    if (latest === undefined) throw new Error("Expected latest event fixture.");
    expect(formatStudioServerSentEvent(latest)).toContain("id: 12\nevent: fixture.changed\ndata:");
  });
});
