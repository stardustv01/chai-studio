import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptureJobManager,
  assertFreshContext,
  authorizeBridgeRequest,
  createBridgeAuthorization,
  executeAnnotationDocumentEdit,
  redactBridgeValue,
  writeLatestContext,
  type SelectionContextManifest,
} from "../../packages/bridge/src/index.js";
import {
  initializeProjectFolder,
  loadCurrentProjectRevision,
  type AnnotationDocument,
} from "../../packages/schema/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex context bridge", () => {
  it("writes exact latest context atomically and rejects stale revision use", async () => {
    const root = await projectRoot();
    const snapshot = await loadCurrentProjectRevision(root);
    const context = contextFor(
      snapshot.project.projectId,
      snapshot.pointer.revisionId,
      snapshot.timeline.timelineId,
    );
    const target = await writeLatestContext(root, context);
    expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({
      revisionId: snapshot.pointer.revisionId,
      masterFrame: "12",
      timecode: "00:00:00:12",
    });
    expect(() => {
      assertFreshContext(context, { projectId: snapshot.project.projectId, revisionId: "revision-new" });
    }).toThrow(/stale/);
  });

  it("runs normalized annotations through a deterministic reversible timeline edit", async () => {
    const root = await projectRoot();
    const snapshot = await loadCurrentProjectRevision(root);
    const annotation: AnnotationDocument = {
      schemaVersion: "1.0.0",
      id: "annotation-test",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      entityIds: [snapshot.timeline.timelineId],
      captureId: null,
      frameRange: null,
      coordinateSpace: "source-normalized",
      geometry: { kind: "arrow", start: { x: 0.1, y: 0.2 }, end: { x: 0.8, y: 0.7 } },
      category: "issue",
      color: "#FF5A6F",
      body: "Move this beat.",
      author: { id: "codex-test", kind: "codex", sessionId: "session-test" },
      order: 0,
      visible: true,
      locked: false,
      privacyBehavior: "none",
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    };
    const created = executeAnnotationDocumentEdit(
      snapshot.timeline,
      { kind: "annotation.create", annotation },
      "revision-annotation-create",
    );
    expect(created.timeline.annotations).toHaveLength(1);
    const removed = executeAnnotationDocumentEdit(
      created.timeline,
      { kind: "annotation.delete", annotationId: annotation.id },
      "revision-annotation-delete",
    );
    expect(removed.timeline.annotations).toEqual([]);
  });

  it("labels fidelity provenance, writes hashed outputs, authorizes scopes, and redacts logs", async () => {
    const root = await projectRoot();
    const snapshot = await loadCurrentProjectRevision(root);
    const context = contextFor(
      snapshot.project.projectId,
      snapshot.pointer.revisionId,
      snapshot.timeline.timelineId,
    );
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const manager = new CaptureJobManager({
      projectRoot: root,
      interactive: {
        capture: () =>
          Promise.resolve([{ relativePath: "captures/interactive.png", bytes, mimeType: "image/png" }]),
      },
      fidelity: {
        capture: () =>
          Promise.resolve([{ relativePath: "captures/fidelity.png", bytes, mimeType: "image/png" }]),
      },
    });
    const started = manager.start({
      context,
      current: { projectId: context.projectId, revisionId: context.revisionId },
      request: {
        kind: "current-frame",
        mode: "fidelity",
        frames: ["12"],
        frameRange: null,
        isolatedEntityIds: [],
        effectsApplied: true,
        alpha: false,
        comparisonSide: null,
      },
    });
    await expect.poll(() => manager.state(started.id).status).toBe("completed");
    expect(manager.state(started.id).manifest).toMatchObject({
      renderer: "final-compositor",
      parityEligible: true,
    });
    expect(await readFile(path.join(root, "captures", "fidelity.png"))).toEqual(Buffer.from(bytes));

    const authorization = createBridgeAuthorization({
      id: "authorization-test",
      sessionId: "session-test",
      token: "0123456789abcdef0123456789abcdef",
      capabilities: ["context.read"],
      issuedAt: new Date("2026-07-16T00:00:00.000Z"),
      expiresAt: new Date("2026-07-17T00:00:00.000Z"),
    });
    expect(() => {
      authorizeBridgeRequest(authorization, {
        token: "0123456789abcdef0123456789abcdef",
        capability: "context.read",
        now: new Date("2026-07-16T01:00:00.000Z"),
      });
    }).not.toThrow();
    expect(redactBridgeValue({ authorization: "secret", nested: "Bearer abc.def" })).toEqual({
      authorization: "[REDACTED]",
      nested: "Bearer [REDACTED]",
    });
  });

  it("cancels in-flight capture jobs without publishing a manifest", async () => {
    const root = await projectRoot();
    const snapshot = await loadCurrentProjectRevision(root);
    const context = contextFor(
      snapshot.project.projectId,
      snapshot.pointer.revisionId,
      snapshot.timeline.timelineId,
    );
    const blockedRenderer = {
      capture: ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("cancelled", "AbortError"));
            },
            { once: true },
          );
        }),
    };
    const manager = new CaptureJobManager({
      projectRoot: root,
      interactive: blockedRenderer,
      fidelity: blockedRenderer,
    });
    const job = manager.start({
      context,
      current: { projectId: context.projectId, revisionId: context.revisionId },
      request: {
        kind: "contact-sheet",
        mode: "interactive",
        frames: ["0", "12"],
        frameRange: { startFrame: "0", endFrameExclusive: "13" },
        isolatedEntityIds: [],
        effectsApplied: true,
        alpha: false,
        comparisonSide: null,
      },
    });
    manager.cancel(job.id);
    await expect.poll(() => manager.state(job.id).status).toBe("cancelled");
    expect(manager.state(job.id).manifest).toBeNull();
  });
});

const projectRoot = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chai-bridge-"));
  roots.push(parent);
  const root = path.join(parent, "Bridge.chai");
  await initializeProjectFolder(root, { title: "Bridge" });
  return root;
};

const contextFor = (projectId: string, revisionId: string, timelineId: string): SelectionContextManifest => ({
  schemaVersion: "1.0.0",
  contextId: "context-test",
  projectId,
  revisionId,
  timelineId,
  generatedAt: "2026-07-16T00:00:00.000Z",
  selectionStateVersion: 1,
  selectedIds: [timelineId],
  primaryId: timelineId,
  anchorId: null,
  masterFrame: "12",
  sourceFrames: { [timelineId]: "12" },
  timecode: "00:00:00:12",
  fps: { numerator: "30" as never, denominator: "1" as never },
  engine: "none",
  sourcePaths: [],
  props: {},
  variables: {},
  effects: [],
  transitions: [],
  nearbyClips: [],
  entities: [{ id: timelineId, kind: "timeline", summary: {} }],
  preview: {
    sessionId: "preview-test",
    stateVersion: 1,
    mode: "interactive",
    quality: "draft",
    synchronized: true,
  },
  captureIds: [],
  annotationIds: [],
});
