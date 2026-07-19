import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  type TimelineEditCommand,
} from "../../packages/schema/src/index.js";
import { executeTimelineDocumentEdit } from "../../packages/timeline/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("granular timeline document command", () => {
  it("commits a P05 track operation without destructive authorization", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "chai-timeline-edit-"));
    roots.push(parent);
    const root = path.join(parent, "timeline.chai");
    await initializeProjectFolder(root, {
      title: "Timeline command",
      projectId: "project-timeline-0001",
      revisionId: "revision-timeline-0001",
      actorId: "actor-timeline-0001",
      sessionId: "session-timeline-0001",
      now: new Date("2026-07-15T12:00:00Z"),
    });
    const command: TimelineEditCommand = {
      schemaVersion: "1.0.0",
      commandId: "command-timeline-add-track-0001",
      idempotencyId: "idempotency-timeline-add-track-0001",
      actor: { id: "actor-timeline-0001", kind: "user", sessionId: "session-timeline-0001" },
      projectId: "project-timeline-0001",
      correlationId: "correlation-timeline-add-track-0001",
      issuedAt: "2026-07-15T12:01:00Z",
      capability: { name: "timeline-edit", version: "1.0.0" },
      payloadVersion: "1.0.0",
      affectedEntityIds: ["track-video-main-0001"],
      declaredScope: "mutation",
      validationOnly: false,
      baseRevisionId: "revision-timeline-0001",
      authorizationId: null,
      kind: "timeline.edit",
      payload: {
        operation: {
          kind: "track.add",
          track: {
            id: "track-video-main-0001",
            kind: "video",
            name: "V1",
            order: 0,
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
            audioBusId: null,
            clipIds: [],
          },
          atIndex: 0,
        },
      },
    };

    const receipt = await executeProjectCommand(root, command, {
      revisionId: "revision-timeline-0002",
      now: () => new Date("2026-07-15T12:01:01Z"),
      applyTimelineEdit: executeTimelineDocumentEdit,
    });

    expect(receipt).toMatchObject({ status: "committed", error: null });
    const current = await loadCurrentProjectRevision(root);
    expect(current.timeline.tracks).toEqual([
      expect.objectContaining({ id: "track-video-main-0001", name: "V1", order: 0 }),
    ]);
    expect(current.transaction).toMatchObject({
      declaredScope: "mutation",
      authorizationId: null,
      commandSummary: "Add track",
    });
  });

  it("rejects undeclared affected entities before committing", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "chai-timeline-edit-"));
    roots.push(parent);
    const root = path.join(parent, "timeline.chai");
    await initializeProjectFolder(root, {
      title: "Timeline command",
      projectId: "project-timeline-0002",
      revisionId: "revision-timeline-1001",
    });
    const receipt = await executeProjectCommand(
      root,
      {
        schemaVersion: "1.0.0",
        commandId: "command-timeline-bad-scope-0001",
        idempotencyId: "idempotency-timeline-bad-scope-0001",
        actor: { id: "actor-timeline-0002", kind: "user", sessionId: "session-timeline-0002" },
        projectId: "project-timeline-0002",
        correlationId: "correlation-timeline-bad-scope-0001",
        issuedAt: "2026-07-15T12:02:00Z",
        capability: { name: "timeline-edit", version: "1.0.0" },
        payloadVersion: "1.0.0",
        affectedEntityIds: [],
        declaredScope: "mutation",
        validationOnly: false,
        baseRevisionId: "revision-timeline-1001",
        authorizationId: null,
        kind: "timeline.edit",
        payload: {
          operation: {
            kind: "track.add",
            track: {
              id: "track-video-main-0002",
              kind: "video",
              name: "V1",
              order: 0,
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
              audioBusId: null,
              clipIds: [],
            },
            atIndex: 0,
          },
        },
      },
      { applyTimelineEdit: executeTimelineDocumentEdit },
    );
    expect(receipt).toMatchObject({
      status: "failed",
      error: { code: "command.affected-entities.incomplete" },
    });
  });
});
