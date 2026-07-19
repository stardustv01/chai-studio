import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeAudioDocumentEdit } from "../../packages/audio/src/index.js";
import {
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
} from "../../packages/schema/src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P16 authoritative audio document command", () => {
  it("commits audio.edit atomically, persists after reopen, and supports revision undo", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-audio-command-"));
    directories.push(parent);
    const root = path.join(parent, "project");
    const initialized = await initializeProjectFolder(root, { title: "Audio command test" });
    const current = await loadCurrentProjectRevision(root);
    const graph = required(current.timeline.audioGraph);
    const musicBusId = `${graph.graphId}:music`;
    const edit = command({
      projectId: initialized.projectId,
      baseRevisionId: initialized.revisionId,
      affectedEntityIds: [musicBusId],
      kind: "audio.edit",
      payload: { operation: { kind: "audio.bus.update", busId: musicBusId, patch: { gainDb: -9 } } },
    });
    const receipt = await executeProjectCommand(root, edit, {
      revisionId: "revision-audio-command-0002",
      applyAudioEdit: executeAudioDocumentEdit,
    });
    expect(receipt.status).toBe("committed");
    const reopened = await loadCurrentProjectRevision(root);
    expect(reopened.timeline.audioGraph?.buses.find((bus) => bus.id === musicBusId)?.gainDb).toBe(-9);
    const undo = command({
      projectId: initialized.projectId,
      baseRevisionId: "revision-audio-command-0002",
      affectedEntityIds: [],
      kind: "history.undo",
      payload: { steps: 1 },
    });
    const undoReceipt = await executeProjectCommand(root, undo, {
      revisionId: "revision-audio-command-0003",
      applyAudioEdit: executeAudioDocumentEdit,
    });
    expect(undoReceipt.status).toBe("committed");
    expect(
      (await loadCurrentProjectRevision(root)).timeline.audioGraph?.buses.find((bus) => bus.id === musicBusId)
        ?.gainDb,
    ).toBe(0);
  });
});

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Required audio test fixture value is missing.");
  return value;
};

const command = (input: {
  readonly projectId: string;
  readonly baseRevisionId: string;
  readonly affectedEntityIds: readonly string[];
  readonly kind: "audio.edit" | "history.undo";
  readonly payload: Readonly<Record<string, unknown>>;
}) => ({
  schemaVersion: "1.0.0",
  commandId: `command-${input.kind.replace(".", "-")}-${crypto.randomUUID()}`,
  idempotencyId: `idempotency-${crypto.randomUUID()}`,
  actor: { id: "actor-audio-test-0001", kind: "user", sessionId: "session-audio-test-0001" },
  projectId: input.projectId,
  correlationId: `correlation-${crypto.randomUUID()}`,
  issuedAt: "2026-07-16T00:00:00.000Z",
  capability: { name: "audio-edit", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: input.affectedEntityIds,
  declaredScope: "mutation",
  validationOnly: false,
  baseRevisionId: input.baseRevisionId,
  authorizationId: null,
  kind: input.kind,
  payload: input.payload,
});
