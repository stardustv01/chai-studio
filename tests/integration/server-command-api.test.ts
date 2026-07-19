import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStudioServer,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type StartedStudioServer,
} from "../../apps/studio-server/src/index.js";
import type {
  CommandExecutionReceipt,
  HistoryMoveCommand,
  LoadedProjectRevision,
  ProjectRenameCommand,
  TimelineEditCommand,
} from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];
const startedServers: StartedStudioServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((started) => started.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("authoritative command HTTP API", () => {
  it("commits one revision, returns stale conflicts, and performs persistent undo and redo", async () => {
    const parent = await temporaryDirectory();
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime"),
    });
    startedServers.push(started);
    const request = requestFor(started);
    await request("/api/v1/projects/create", {
      method: "POST",
      body: JSON.stringify({ targetPath: path.join(parent, "Command Film.chai"), title: "First Light" }),
    });
    const initial = await currentSnapshot(request);

    const renamed = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(renameCommand(initial, "Second Light", "rename-0001")),
    });
    expect(renamed.status).toBe(200);
    const renameReceipt = (await renamed.json()) as ApiSuccessEnvelope<CommandExecutionReceipt>;
    expect(renameReceipt.data).toMatchObject({ status: "committed", replayed: false });
    expect((await currentSnapshot(request)).project.title).toBe("Second Light");

    const stale = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(renameCommand(initial, "Stale title", "rename-stale-0001")),
    });
    const stalePayload = (await stale.json()) as ApiErrorEnvelope;
    expect(stale.status, JSON.stringify(stalePayload)).toBe(409);
    expect(stalePayload).toMatchObject({
      ok: false,
      error: { code: "command.base-revision.stale", retryable: true },
    });

    const afterRename = await currentSnapshot(request);
    const undo = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(historyCommand(afterRename, "history.undo", "undo-0001")),
    });
    expect(undo.status).toBe(200);
    expect((await currentSnapshot(request)).project.title).toBe("First Light");

    const afterUndo = await currentSnapshot(request);
    const redo = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(historyCommand(afterUndo, "history.redo", "redo-0001")),
    });
    expect(redo.status).toBe(200);
    expect((await currentSnapshot(request)).project.title).toBe("Second Light");
  });

  it("commits create-track-and-move through the authenticated command boundary and undoes it", async () => {
    const parent = await temporaryDirectory();
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime"),
    });
    startedServers.push(started);
    const request = requestFor(started);
    await request("/api/v1/projects/create", {
      method: "POST",
      body: JSON.stringify({
        targetPath: path.join(parent, "Track Move.chai"),
        title: "Track Move",
        starter: "showcase",
      }),
    });
    const initial = await currentSnapshot(request);
    const sourceTrack = initial.timeline.tracks[0];
    const sourceClip = sourceTrack?.clips[0];
    if (sourceTrack === undefined || sourceClip === undefined) throw new Error("Starter clip is missing.");
    const newTrackId = "track-command-video-0002";
    const command: TimelineEditCommand = {
      schemaVersion: "1.0.0",
      commandId: "command-create-track-move-0001",
      idempotencyId: "idempotency-create-track-move-0001",
      actor: { id: "actor-api-0001", kind: "user", sessionId: "session-api-0001" },
      projectId: initial.project.projectId,
      correlationId: `correlation-${randomUUID()}`,
      issuedAt: "2026-07-15T13:12:00.000Z",
      capability: { name: "timeline-edit", version: "1.0.0" },
      payloadVersion: "1.0.0",
      affectedEntityIds: [newTrackId, sourceClip.id],
      declaredScope: "mutation",
      validationOnly: false,
      baseRevisionId: initial.pointer.revisionId,
      authorizationId: null,
      kind: "timeline.edit",
      payload: {
        operation: {
          kind: "clips.move-to-new-track",
          track: {
            id: newTrackId,
            kind: "video",
            name: "V2",
            order: 1,
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
            audioBusId: null,
            clipIds: [],
          },
          atIndex: 1,
          moves: [{ clipId: sourceClip.id, trackId: newTrackId, start: sourceClip.startFrame }],
        },
      },
    };

    const committed = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(command),
    });
    const committedPayload = (await committed.json()) as ApiSuccessEnvelope<CommandExecutionReceipt>;
    expect(committed.status, JSON.stringify(committedPayload)).toBe(200);
    expect(committedPayload.data).toMatchObject({ status: "committed", replayed: false });
    const afterMove = await currentSnapshot(request);
    expect(afterMove.timeline.tracks).toHaveLength(2);
    expect(afterMove.timeline.tracks[1]).toMatchObject({
      id: newTrackId,
      clips: [expect.objectContaining({ id: sourceClip.id })],
    });

    const undone = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(historyCommand(afterMove, "history.undo", "undo-create-track-move-0001")),
    });
    expect(undone.status).toBe(200);
    const afterUndo = await currentSnapshot(request);
    expect(afterUndo.timeline.tracks).toHaveLength(1);
    expect(afterUndo.timeline.tracks[0]?.id).toBe(sourceTrack.id);
    expect(afterUndo.timeline.tracks[0]?.clips).toContainEqual(
      expect.objectContaining({ id: sourceClip.id }),
    );
  });
});

const renameCommand = (
  snapshot: LoadedProjectRevision,
  title: string,
  suffix: string,
): ProjectRenameCommand => ({
  schemaVersion: "1.0.0",
  commandId: `command-${suffix}`,
  idempotencyId: `idempotency-${suffix}`,
  actor: { id: "actor-api-0001", kind: "user", sessionId: "session-api-0001" },
  projectId: snapshot.project.projectId,
  correlationId: `correlation-${randomUUID()}`,
  issuedAt: "2026-07-15T13:10:00.000Z",
  capability: { name: "project-core", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: [snapshot.project.projectId],
  declaredScope: "mutation",
  validationOnly: false,
  baseRevisionId: snapshot.pointer.revisionId,
  authorizationId: null,
  kind: "project.rename",
  payload: { title },
});

const historyCommand = (
  snapshot: LoadedProjectRevision,
  kind: HistoryMoveCommand["kind"],
  suffix: string,
): HistoryMoveCommand => ({
  schemaVersion: "1.0.0",
  commandId: `command-${suffix}`,
  idempotencyId: `idempotency-${suffix}`,
  actor: { id: "actor-api-0001", kind: "user", sessionId: "session-api-0001" },
  projectId: snapshot.project.projectId,
  correlationId: `correlation-${randomUUID()}`,
  issuedAt: "2026-07-15T13:11:00.000Z",
  capability: { name: "project-core", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: [snapshot.project.projectId],
  declaredScope: "mutation",
  validationOnly: false,
  baseRevisionId: snapshot.pointer.revisionId,
  authorizationId: null,
  kind,
  payload: { steps: 1 },
});

const currentSnapshot = async (request: ReturnType<typeof requestFor>): Promise<LoadedProjectRevision> => {
  const response = await request("/api/v1/projects/current/snapshot");
  const payload = (await response.json()) as ApiSuccessEnvelope<LoadedProjectRevision>;
  return payload.data;
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-command-api-"));
  temporaryDirectories.push(directory);
  return directory;
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
