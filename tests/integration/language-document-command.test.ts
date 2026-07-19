import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeLanguageDocumentEdit, importTimedText } from "../../packages/captions/src/index.js";
import {
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  normalizeRational,
  serializeBigInt,
  type JsonValue,
  type ProjectCommandEnvelope,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("P17 language commands through immutable project authority", () => {
  it("imports linked transcript/captions, edits a phrase, reopens, and undoes atomically", async () => {
    const root = await createProject();
    await executeProjectCommand(root, assetCommand("revision-language-0001"), {
      revisionId: "revision-language-0002",
      now: clock(2),
    });
    const afterAsset = await loadCurrentProjectRevision(root);
    await executeProjectCommand(root, timelineCommand(afterAsset), {
      revisionId: "revision-language-0003",
      now: clock(3),
    });
    const imported = importTimedText({
      format: "srt",
      text: "1\n00:00:01,000 --> 00:00:03,000\nLanguage remains linked.\n",
      transcriptId: "transcript-language-0001",
      captionDocumentId: "caption-document-language-0001",
      captionTrackId: "caption-track-language-0001",
      sourceAudio: {
        assetId: "asset-language-audio-0001",
        streamIndex: 0,
        contentHash: "a".repeat(64),
        sampleRate: 48_000,
      },
      fps: normalizeRational(30_000n, 1_001n),
      language: "en-US",
    });
    if (imported.transcript === null || imported.captions === null) throw new Error("Import fixture failed.");
    const importOperation = {
      kind: "language.import.upsert",
      transcript: imported.transcript,
      captions: imported.captions,
    } as unknown as JsonValue;
    const importAffected = [
      imported.transcript.transcriptId,
      imported.captions.captionDocumentId,
      ...imported.captions.cues.map((cue) => cue.id),
    ];
    const importReceipt = await executeProjectCommand(
      root,
      languageCommand("revision-language-0003", "import", importOperation, importAffected),
      {
        revisionId: "revision-language-0004",
        now: clock(4),
        applyLanguageEdit: executeLanguageDocumentEdit,
      },
    );
    expect(importReceipt.status).toBe("committed");

    const editOperation = {
      kind: "transcript.phrase.update",
      transcriptId: imported.transcript.transcriptId,
      phraseId: "transcript-phrase-0001",
      patch: { text: "Language remains exactly linked.", correctionState: "corrected" },
    } as unknown as JsonValue;
    const editReceipt = await executeProjectCommand(
      root,
      languageCommand("revision-language-0004", "edit", editOperation, [
        imported.transcript.transcriptId,
        "transcript-phrase-0001",
        imported.captions.captionDocumentId,
        "caption-cue-0001",
        ...(imported.transcript.phrases[0]?.wordIds ?? []),
        "transcript-phrase-0001-word-edit-001",
        "transcript-phrase-0001-word-edit-002",
        "transcript-phrase-0001-word-edit-003",
        "transcript-phrase-0001-word-edit-004",
      ]),
      {
        revisionId: "revision-language-0005",
        now: clock(5),
        applyLanguageEdit: executeLanguageDocumentEdit,
      },
    );
    expect(editReceipt.status).toBe("committed");
    let reopened = await loadCurrentProjectRevision(root);
    expect(reopened.timeline.transcripts?.[0]?.phrases[0]).toMatchObject({
      text: "Language remains exactly linked.",
      correctionState: "corrected",
    });
    expect(reopened.timeline.transcripts?.[0]?.words.map((word) => word.text)).toEqual([
      "Language",
      "remains",
      "exactly",
      "linked.",
    ]);
    expect(reopened.timeline.captionDocuments?.[0]?.cues[0]).toMatchObject({
      phraseId: "transcript-phrase-0001",
      startFrame: "29",
      text: "Language remains exactly linked.",
      lines: ["Language remains exactly linked."],
    });

    const undo = await executeProjectCommand(root, historyUndo("revision-language-0005"), {
      revisionId: "revision-language-0006",
      now: clock(6),
    });
    expect(undo.status).toBe("committed");
    reopened = await loadCurrentProjectRevision(root);
    expect(reopened.timeline.transcripts?.[0]?.phrases[0]?.text).toBe("Language remains linked.");
  });
});

const createProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chai-language-command-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "project.chai");
  await initializeProjectFolder(root, {
    title: "Language command",
    projectId: "project-language-0001",
    revisionId: "revision-language-0001",
    actorId: "actor-language-0001",
    sessionId: "session-language-0001",
    now: new Date("2026-07-16T00:00:00Z"),
  });
  return root;
};

const base = (baseRevisionId: string, suffix: string) => ({
  schemaVersion: "1.0.0" as const,
  commandId: `command-language-${suffix}`,
  idempotencyId: `idempotency-language-${suffix}`,
  actor: { id: "actor-language-0001", kind: "user" as const, sessionId: "session-language-0001" },
  projectId: "project-language-0001",
  correlationId: `correlation-language-${suffix}`,
  issuedAt: "2026-07-16T00:01:00Z",
  capability: { name: "language-edit", version: "1.0.0" },
  payloadVersion: "1.0.0" as const,
  declaredScope: "mutation" as const,
  validationOnly: false,
  baseRevisionId,
  authorizationId: null,
});

const assetCommand = (baseRevisionId: string): ProjectCommandEnvelope => ({
  ...base(baseRevisionId, "asset"),
  kind: "asset.register",
  affectedEntityIds: ["asset-language-audio-0001"],
  payload: {
    asset: {
      id: "asset-language-audio-0001",
      path: "assets/language.wav",
      contentHash: "a".repeat(64),
      kind: "audio",
      durationFrames: serializeBigInt(300n),
      fps: null,
      hasAudio: true,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "owned",
      validationState: "valid",
    },
  },
});

const timelineCommand = (
  current: Awaited<ReturnType<typeof loadCurrentProjectRevision>>,
): ProjectCommandEnvelope => ({
  ...base(current.pointer.revisionId, "timeline"),
  kind: "timeline.replace",
  declaredScope: "destructive",
  authorizationId: "authorization-language-timeline-0001",
  affectedEntityIds: [current.timeline.timelineId, "caption-track-language-0001"],
  payload: {
    timeline: {
      ...current.timeline,
      durationFrames: serializeBigInt(300n),
      tracks: [
        {
          id: "caption-track-language-0001",
          kind: "caption",
          name: "Captions",
          order: 0,
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          clips: [],
        },
      ],
    },
  },
});

const languageCommand = (
  baseRevisionId: string,
  suffix: string,
  operation: JsonValue,
  affectedEntityIds: readonly string[],
): ProjectCommandEnvelope => ({
  ...base(baseRevisionId, suffix),
  kind: "language.edit",
  affectedEntityIds,
  payload: { operation },
});

const historyUndo = (baseRevisionId: string): ProjectCommandEnvelope => ({
  ...base(baseRevisionId, "undo"),
  kind: "history.undo",
  affectedEntityIds: ["project-language-0001"],
  payload: { steps: 1 },
});

const clock = (minute: number) => () => new Date(`2026-07-16T00:0${String(minute)}:00Z`);
