import { describe, expect, it } from "vitest";
import {
  parseSseMessage,
  parseStudioEvent,
  readSseMessages,
} from "../../apps/studio-web/src/event-stream.js";

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

  it("handles CRLF delimiters split across chunks and flushes a final event at EOF", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "id: 44\r",
      "\nevent: first\r\n",
      "data: one\r",
      "\n\r",
      "\nid: 45\r\nevent: final\r\ndata: two",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const messages = [];
    for await (const message of readSseMessages(stream, new AbortController().signal)) {
      messages.push(message);
    }
    expect(messages).toEqual([
      { id: 44, event: "first", data: "one" },
      { id: 45, event: "final", data: "two" },
    ]);
  });
});
