import { describe, expect, it } from "vitest";
import { parseSseMessage, parseStudioEvent } from "../../apps/studio-web/src/event-stream.js";

describe("Studio web event stream", () => {
  it("parses ordered resumable SSE messages without losing multiline data", () => {
    expect(
      parseSseMessage(
        'id: 42\nevent: revision\ndata: {"type":"revision.changed",\ndata: "revisionId":"revision-000428"}',
      ),
    ).toEqual({
      id: 42,
      event: "revision",
      data: '{"type":"revision.changed",\n"revisionId":"revision-000428"}',
    });
  });

  it("ignores heartbeat comments that contain no resumable event", () => {
    expect(parseSseMessage(": heartbeat")).toBeNull();
  });

  it("accepts uncorrelated authoritative preview ticks", () => {
    expect(
      parseStudioEvent({
        id: 43,
        event: "preview.state",
        data: JSON.stringify({
          type: "preview.state",
          correlationId: null,
          occurredAt: "2026-07-16T18:00:00.000Z",
          payload: { currentFrame: "12", transport: "playing" },
        }),
      }),
    ).toMatchObject({
      id: 43,
      type: "preview.state",
      correlationId: null,
      payload: { currentFrame: "12", transport: "playing" },
    });
  });
});
