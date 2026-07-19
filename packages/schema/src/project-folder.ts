import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { sha256CanonicalJson, stringifyCanonicalJson } from "./canonical-json.js";
import { normalizeRational, type NormalizedRational } from "./rational.js";
import {
  assertProjectDocument,
  type ApprovalStateDocument,
  type AssetsDocument,
  type AutosaveMetadataDocument,
  type ChaiProjectDocument,
  type CurrentRevisionPointer,
  type NamedVersionsDocument,
  type SettingsDocument,
  type TimelineDocument,
  type TransactionDocument,
} from "./project-documents.js";
import { validateProjectSnapshot } from "./project-validation.js";

export const canonicalProjectDirectories = [
  "revisions",
  "working",
  "scenes/remotion",
  "scenes/hyperframes",
  "scenes/shared",
  "assets",
  "transcripts",
  "captions",
  "captures",
  "reviews",
  "renders",
  "receipts",
  "autosaves",
  ".chai-cache",
] as const;

export const revisionDocumentNames = [
  "chai.project.json",
  "timeline.json",
  "assets.json",
  "settings.json",
  "approval-state.json",
  "transaction.json",
] as const;

export interface InitializeProjectOptions {
  readonly title: string;
  readonly projectId?: string;
  readonly revisionId?: string;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly now?: Date;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: NormalizedRational;
  readonly sampleRate?: 44_100 | 48_000 | 96_000;
}

export interface InitializedProject {
  readonly rootPath: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionHash: string;
  readonly pointer: CurrentRevisionPointer;
}

export const initializeProjectFolder = async (
  targetPath: string,
  options: InitializeProjectOptions,
): Promise<InitializedProject> => {
  const parent = path.dirname(path.resolve(targetPath));
  const target = path.resolve(targetPath);
  await assertTargetAvailable(target);
  const projectId = options.projectId ?? stableId("project");
  const revisionId = options.revisionId ?? stableId("revision");
  const actorId = options.actorId ?? stableId("actor");
  const sessionId = options.sessionId ?? stableId("session");
  const now = (options.now ?? new Date()).toISOString();
  const timelineId = `${projectId}:timeline-main`;
  const transactionId = `${revisionId}:transaction`;
  const staging = path.join(parent, `.${path.basename(target)}.chai-init-${projectId}`);

  try {
    await mkdir(staging, { recursive: false });
    for (const directory of canonicalProjectDirectories)
      await mkdir(path.join(staging, directory), { recursive: true });
    const revisionDirectory = path.join(staging, "revisions", revisionId);
    await mkdir(revisionDirectory, { recursive: false });

    const project: ChaiProjectDocument = {
      schemaVersion: "1.0.0",
      projectId,
      revisionId,
      title: options.title,
      createdAt: now,
      updatedAt: now,
      video: {
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        fps: options.fps ?? normalizeRational(30_000n, 1_001n),
        colorSpace: "rec709",
      },
      audio: { sampleRate: options.sampleRate ?? 48_000, channelLayout: "stereo" },
      activeTimelineId: timelineId,
      deliveryProfileId: null,
      enginePins: {},
      capabilityFlags: { mixedEngine: true },
      rightsNotes: [],
      sources: {},
    };
    const timeline: TimelineDocument = {
      schemaVersion: "1.0.0",
      projectId,
      revisionId,
      timelineId,
      fps: project.video.fps,
      durationFrames: "0" as TimelineDocument["durationFrames"],
      tracks: [],
      audioBusIds: [],
      approvalReferenceIds: [],
      audioGraph: {
        schemaVersion: "1.0.0",
        graphId: `${timelineId}:audio`,
        sampleRate: project.audio.sampleRate,
        channelLayout: project.audio.channelLayout,
        masterBusId: `${timelineId}:audio:master`,
        sources: [],
        buses: [
          ...(["voiceover", "music", "sfx", "ambience"] as const).map((kind) => ({
            id: `${timelineId}:audio:${kind}`,
            name: kind === "sfx" ? "SFX" : `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}`,
            kind,
            parentBusId: `${timelineId}:audio:master`,
            gainDb: 0,
            pan: 0,
            muted: false,
            solo: false,
            automationLaneIds: [],
          })),
          {
            id: `${timelineId}:audio:master`,
            name: "Master",
            kind: "master",
            parentBusId: null,
            gainDb: 0,
            pan: 0,
            muted: false,
            solo: false,
            automationLaneIds: [],
          },
        ],
        clips: [],
        automationLanes: [],
        crossfades: [],
        duckingRules: [],
        channelMaps: [],
        syncAnchors: [],
        processingReferences: [],
      },
      transcripts: [],
      captionDocuments: [],
    };
    const assets: AssetsDocument = { schemaVersion: "1.0.0", projectId, revisionId, assets: [] };
    const settings: SettingsDocument = {
      schemaVersion: "1.0.0",
      projectId,
      revisionId,
      autosaveIntervalMs: 5_000,
      autosaveRetention: 20,
      outputDirectory: "renders",
      allowImportedExecutableContent: false,
      networkAllowlist: [],
    };
    const approvalState: ApprovalStateDocument = {
      schemaVersion: "1.0.0",
      projectId,
      revisionId,
      state: null,
      outputId: null,
      updatedAt: now,
      history: [],
    };
    const contentDocuments = {
      "chai.project.json": project,
      "timeline.json": timeline,
      "assets.json": assets,
      "settings.json": settings,
      "approval-state.json": approvalState,
    } as const;
    const afterHashes = Object.fromEntries(
      Object.entries(contentDocuments).map(([name, document]) => [name, sha256CanonicalJson(document)]),
    );
    const transaction: TransactionDocument = {
      schemaVersion: "1.0.0",
      transactionId,
      commandId: `${revisionId}:initialize`,
      idempotencyId: `${revisionId}:initialize`,
      correlationId: `${revisionId}:correlation`,
      commandEnvelopeHash: sha256CanonicalJson({ commandId: `${revisionId}:initialize` }),
      actor: { id: actorId, kind: "user", sessionId },
      capability: { name: "project-core", version: "1.0.0" },
      declaredScope: "mutation",
      authorizationId: null,
      validationOnly: false,
      result: "committed",
      history: { action: "commit", contentRevisionId: revisionId, undoStack: [], redoStack: [] },
      namedVersion: {
        id: `${revisionId}:draft`,
        name: "Draft",
        revisionId,
        createdAt: now,
        actorId,
        outputId: null,
      },
      timestamp: now,
      parentRevisionId: null,
      resultingRevisionId: revisionId,
      beforeHashes: {},
      afterHashes,
      affectedEntityIds: [projectId, timelineId],
      commandSummary: "Create project",
      diffSummary: "Created the initial self-contained project revision.",
      warnings: [],
      sourceEdit: null,
    };

    for (const [kind, document] of [
      ["chai.project", project],
      ["timeline", timeline],
      ["assets", assets],
      ["settings", settings],
      ["approval-state", approvalState],
      ["transaction", transaction],
    ] as const) {
      assertProjectDocument(kind, document);
    }
    const semantic = validateProjectSnapshot({
      project,
      timeline,
      assets,
      settings,
      transaction,
      approvalState,
    });
    if (!semantic.passed)
      throw projectError(
        "project.initialize.semantic-invalid",
        semantic.issues[0]?.message ?? "Initial project is invalid.",
      );

    const revisionDocuments = { ...contentDocuments, "transaction.json": transaction };
    for (const [name, document] of Object.entries(revisionDocuments)) {
      await writeDurableJson(path.join(revisionDirectory, name), document);
    }
    const revisionHash = hashRevisionDocuments(revisionDocuments);
    const pointer: CurrentRevisionPointer = {
      schemaVersion: "1.0.0",
      projectId,
      revisionId,
      revisionHash,
      committedAt: now,
    };
    const autosave: AutosaveMetadataDocument = {
      schemaVersion: "1.0.0",
      projectId,
      cleanShutdown: true,
      lastOpenedRevisionId: revisionId,
      entries: [],
    };
    const versions: NamedVersionsDocument = {
      schemaVersion: "1.0.0",
      projectId,
      versions: [
        { id: `${revisionId}:draft`, name: "Draft", revisionId, createdAt: now, actorId, outputId: null },
      ],
    };
    assertProjectDocument("current-revision", pointer);
    assertProjectDocument("autosave-metadata", autosave);
    assertProjectDocument("named-versions", versions);
    await writeDurableJson(path.join(staging, "current-revision.json"), pointer);
    await writeDurableJson(path.join(staging, "autosave-metadata.json"), autosave);
    await writeDurableJson(path.join(staging, "named-versions.json"), versions);
    await rename(staging, target);
    return { rootPath: target, projectId, revisionId, revisionHash, pointer };
  } catch (cause) {
    await rm(staging, { recursive: true, force: true });
    if (cause instanceof ChaiError) throw cause;
    throw projectError(
      "project.initialize.failed",
      cause instanceof Error ? cause.message : "Unknown initialization failure",
      cause,
    );
  }
};

export const hashRevisionDocuments = (documents: Readonly<Record<string, unknown>>): string => {
  const manifest = Object.fromEntries(
    Object.entries(documents)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([name, document]) => [name, sha256CanonicalJson(document)]),
  );
  return sha256CanonicalJson({ algorithm: "sha256", files: manifest });
};

const writeDurableJson = async (filePath: string, value: unknown): Promise<void> => {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const assertTargetAvailable = async (target: string): Promise<void> => {
  try {
    const targetStat = await stat(target);
    if (!targetStat.isDirectory() || (await readdir(target)).length > 0) {
      throw projectError(
        "project.initialize.target-exists",
        `Target already exists and is not empty: ${target}`,
      );
    }
    throw projectError("project.initialize.target-exists", `Target already exists: ${target}`);
  } catch (cause) {
    if (cause instanceof ChaiError) throw cause;
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
};

const stableId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const projectError = (code: string, message: string, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "project-initialization",
    message,
    repairHint: "Choose a new empty project path and verify the parent directory is writable.",
    ...(cause === undefined ? {} : { cause }),
  });
