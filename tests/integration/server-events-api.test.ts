import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStudioServer,
  type StartedStudioServer,
  type StudioEvent,
} from "../../apps/studio-server/src/index.js";

const temporaryDirectories: string[] = [];
const startedServers: StartedStudioServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((started) => started.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Studio SSE API", () => {
  it("streams authenticated ordered events and resumes strictly after Last-Event-ID", async () => {
    const parent = await temporaryDirectory();
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime"),
    });
    startedServers.push(started);
    const request = requestFor(started);

    const firstStream = await request("/api/v1/events?after=0");
    expect(firstStream.status).toBe(200);
    expect(firstStream.headers.get("content-type")).toContain("text/event-stream");
    const firstReader = eventReader(firstStream);
    const bootstrap = await firstReader.next();
    expect(bootstrap).toMatchObject({ sequence: "1", type: "server.event-stream-ready" });

    expect(
      (
        await request("/api/v1/projects/create", {
          method: "POST",
          body: JSON.stringify({
            targetPath: path.join(parent, "Events.chai"),
            title: "Events",
          }),
        })
      ).status,
    ).toBe(201);
    const opened = await firstReader.next();
    const created = await firstReader.next();
    expect([opened.type, created.type]).toEqual(["project.opened", "project.created"]);
    expect([opened.sequence, created.sequence]).toEqual(["2", "3"]);
    const previewResponse = await request("/api/v1/preview/sessions/load", {
      method: "POST",
      body: "{}",
    });
    const previewPayload = (await previewResponse.json()) as {
      readonly data: { readonly state: { readonly stateVersion: number } };
    };
    expect((await firstReader.next()).type).toBe("preview.state");
    expect(
      (
        await request("/api/v1/captures", {
          method: "POST",
          body: JSON.stringify({
            label: "External control-loop capture",
            imageBase64:
              "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP4w8AARAwQCgAfjgPxzzTeXgAAAABJRU5ErkJggg==",
            expectedPreviewStateVersion: previewPayload.data.state.stateVersion,
          }),
        })
      ).status,
    ).toBe(201);
    expect(await firstReader.nextOfType("capture.created")).toMatchObject({
      type: "capture.created",
      payload: { label: "External control-loop capture", truthMode: "interactive-approximation" },
    });
    await firstReader.close();

    const resumedStream = await request("/api/v1/events", {
      headers: { "last-event-id": bootstrap.sequence },
    });
    const resumedReader = eventReader(resumedStream);
    const replayed = [await resumedReader.next(), await resumedReader.next()];
    expect(replayed.map((event) => event.sequence)).toEqual(["2", "3"]);
    expect(replayed.some((event) => event.sequence === "1")).toBe(false);
    await resumedReader.close();
  });
});

const eventReader = (response: Response) => {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE response has no body.");
  const decoder = new TextDecoder();
  let buffer = "";
  const queued: StudioEvent[] = [];
  return {
    async next(): Promise<StudioEvent> {
      while (queued.length === 0) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE stream ended before the expected event.");
        buffer += decoder.decode(chunk.value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
          if (data !== undefined) queued.push(JSON.parse(data) as StudioEvent);
        }
      }
      const event = queued.shift();
      if (event === undefined) throw new Error("SSE parser queue unexpectedly emptied.");
      return event;
    },
    async nextOfType(type: string): Promise<StudioEvent> {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const event = await this.next();
        if (event.type === type) return event;
      }
      throw new Error(`SSE stream did not publish ${type} within the bounded event window.`);
    },
    close(): Promise<void> {
      return reader.cancel();
    },
  };
};

const requestFor =
  (started: StartedStudioServer) =>
  (endpoint: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${started.sessionToken}`);
    headers.set("x-chai-csrf-token", started.sessionToken);
    headers.set("content-type", "application/json");
    headers.set("origin", started.report.origins[0] ?? `http://127.0.0.1:${started.report.port.toString()}`);
    return fetch(`http://127.0.0.1:${started.report.port.toString()}${endpoint}`, {
      ...init,
      headers,
    });
  };

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-events-api-"));
  temporaryDirectories.push(directory);
  return directory;
};
