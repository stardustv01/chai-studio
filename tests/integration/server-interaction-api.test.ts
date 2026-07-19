import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStudioServer,
  type AnnotationRecord,
  type ApiSuccessEnvelope,
  type CaptureRecord,
  type ComparisonRecord,
  type EditorSelectionState,
  type StartedStudioServer,
} from "../../apps/studio-server/src/index.js";
import type { LoadedProjectRevision, SourceEditSession } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];
const startedServers: StartedStudioServer[] = [];

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((started) => started.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("editor interaction HTTP API", () => {
  it("handles selection, context, captures, annotations, comparisons, and source-edit transactions", async () => {
    const parent = await temporaryDirectory();
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime"),
    });
    startedServers.push(started);
    const request = requestFor(started);
    const projectPath = path.join(parent, "Interactions.chai");
    expect(
      (
        await request("/api/v1/projects/create", {
          method: "POST",
          body: JSON.stringify({ targetPath: projectPath, title: "Interactions" }),
        })
      ).status,
    ).toBe(201);
    let snapshot = await projectSnapshot(request);

    const initialSelection = await request("/api/v1/editor/selection");
    const initial = ((await initialSelection.json()) as ApiSuccessEnvelope<EditorSelectionState>).data;
    const selected = await request("/api/v1/editor/selection", {
      method: "PUT",
      body: JSON.stringify({
        ids: [snapshot.project.projectId, snapshot.timeline.timelineId],
        primaryId: snapshot.project.projectId,
        anchorId: snapshot.timeline.timelineId,
        mode: "replace",
        expectedStateVersion: initial.stateVersion,
      }),
    });
    expect(selected.status).toBe(200);
    expect((await request("/api/v1/editor/context")).status).toBe(200);
    expect(
      JSON.parse(await readFile(path.join(projectPath, ".chai-context", "latest-context.json"), "utf8")),
    ).toMatchObject({
      revisionId: snapshot.pointer.revisionId,
      selectedIds: [snapshot.project.projectId, snapshot.timeline.timelineId],
    });
    expect(
      (
        (await (await request("/api/v1/bridge/discovery")).json()) as ApiSuccessEnvelope<{
          networkPush: boolean;
        }>
      ).data.networkPush,
    ).toBe(false);

    const loadedPreview = await request("/api/v1/preview/sessions/load", { method: "POST" });
    const previewVersion = (
      (await loadedPreview.json()) as ApiSuccessEnvelope<{ state: { stateVersion: number } }>
    ).data.state.stateVersion;
    const captureA = await createCapture(request, previewVersion, "Before");
    const captureB = await createCapture(request, previewVersion, "After");
    expect((await request("/api/v1/captures")).status).toBe(200);
    expect(await readFile(path.join(projectPath, captureA.relativePath))).toHaveLength(68);

    const annotationResponse = await request("/api/v1/annotations", {
      method: "POST",
      body: JSON.stringify({
        entityIds: [snapshot.project.projectId],
        frame: null,
        captureId: captureA.id,
        body: "Tighten the opening beat.",
        severity: "warning",
        author: actor(),
      }),
    });
    expect(annotationResponse.status).toBe(201);
    const annotation = ((await annotationResponse.json()) as ApiSuccessEnvelope<AnnotationRecord>).data;
    const updatedAnnotation = await request(`/api/v1/annotations/${annotation.id}`, {
      method: "PATCH",
      body: JSON.stringify({ resolved: true, severity: "note" }),
    });
    expect((await updatedAnnotation.json()) as ApiSuccessEnvelope<AnnotationRecord>).toMatchObject({
      data: { visible: false, category: "note" },
    });
    snapshot = await projectSnapshot(request);
    expect(snapshot.timeline.annotations).toMatchObject([
      { id: annotation.id, visible: false, category: "note", coordinateSpace: "source-normalized" },
    ]);
    expect(
      JSON.parse(await readFile(path.join(projectPath, ".chai-context", "latest-context.json"), "utf8")),
    ).toMatchObject({ annotationIds: [annotation.id] });

    const undoAnnotation = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(historyCommand(snapshot, "undo")),
    });
    expect(undoAnnotation.status).toBe(200);
    snapshot = await projectSnapshot(request);
    expect(snapshot.timeline.annotations).toMatchObject([
      { id: annotation.id, visible: true, category: "issue" },
    ]);
    const redoAnnotation = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(historyCommand(snapshot, "redo")),
    });
    expect(redoAnnotation.status).toBe(200);
    snapshot = await projectSnapshot(request);
    expect(snapshot.timeline.annotations).toMatchObject([
      { id: annotation.id, visible: false, category: "note" },
    ]);

    const comparisonResponse = await request("/api/v1/comparisons", {
      method: "POST",
      body: JSON.stringify({
        leftCaptureId: captureA.id,
        rightCaptureId: captureB.id,
        mode: "wipe",
        split: 0.5,
      }),
    });
    expect(comparisonResponse.status).toBe(201);
    const comparison = ((await comparisonResponse.json()) as ApiSuccessEnvelope<ComparisonRecord>).data;
    expect((await request("/api/v1/comparisons")).status).toBe(200);

    const sourcePath = path.join(projectPath, "scenes", "shared", "interaction.json");
    await writeFile(sourcePath, '{"title":"before"}\n');
    const begun = await request("/api/v1/source-edits/begin", {
      method: "POST",
      body: JSON.stringify({ path: "scenes/shared/interaction.json", actor: actor() }),
    });
    expect(begun.status).toBe(201);
    const sourceSession = ((await begun.json()) as ApiSuccessEnvelope<SourceEditSession>).data;
    expect((await request(`/api/v1/source-edits/${sourceSession.id}`)).status).toBe(200);
    const committed = await request(`/api/v1/source-edits/${sourceSession.id}/commit`, {
      method: "POST",
      body: JSON.stringify({ content: '{"title":"after"}\n' }),
    });
    expect(committed.status).toBe(200);
    expect(await readFile(sourcePath, "utf8")).toBe('{"title":"after"}\n');
    snapshot = await projectSnapshot(request);
    expect(snapshot.project.sources["scenes/shared/interaction.json"]?.content).toBe('{"title":"after"}\n');

    expect((await request(`/api/v1/annotations/${annotation.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await request(`/api/v1/comparisons/${comparison.id}`, { method: "DELETE" })).status).toBe(200);
    expect(
      (
        (await request("/api/v1/annotations").then((response) => response.json())) as ApiSuccessEnvelope<
          unknown[]
        >
      ).data,
    ).toEqual([]);
  });
});

const createCapture = async (
  request: ReturnType<typeof requestFor>,
  expectedPreviewStateVersion: number,
  label: string,
): Promise<CaptureRecord> => {
  const response = await request("/api/v1/captures", {
    method: "POST",
    body: JSON.stringify({
      label,
      imageBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlKz9sAAAAASUVORK5CYII=",
      expectedPreviewStateVersion,
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as ApiSuccessEnvelope<CaptureRecord>).data;
};

const projectSnapshot = async (request: ReturnType<typeof requestFor>): Promise<LoadedProjectRevision> =>
  (
    (await (
      await request("/api/v1/projects/current/snapshot")
    ).json()) as ApiSuccessEnvelope<LoadedProjectRevision>
  ).data;

const actor = () => ({
  id: "actor-interaction-0001",
  kind: "user",
  sessionId: "session-interaction-0001",
});

const historyCommand = (snapshot: LoadedProjectRevision, direction: "undo" | "redo") => {
  const nonce = crypto.randomUUID();
  return {
    schemaVersion: "1.0.0",
    commandId: `command-history-${nonce}`,
    idempotencyId: `idempotency-history-${nonce}`,
    actor: actor(),
    projectId: snapshot.project.projectId,
    correlationId: `correlation-history-${nonce}`,
    issuedAt: new Date().toISOString(),
    capability: { name: "bridge-history", version: "1.0.0" },
    payloadVersion: "1.0.0",
    affectedEntityIds: [],
    declaredScope: "mutation",
    validationOnly: false,
    baseRevisionId: snapshot.pointer.revisionId,
    authorizationId: null,
    kind: `history.${direction}`,
    payload: { steps: 1 },
  };
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-interaction-api-"));
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
