import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { pinnedHyperframesVersion, pinnedRemotionVersion } from "@chai-studio/engine-adapters";
import { assertQaLifecycleTransition, type QaReport } from "@chai-studio/qa";
import {
  auditRevisionStorage,
  commitProjectRevision,
  currentProjectSchemaVersion,
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  loadProjectRevision,
  markProjectCleanShutdown,
  markProjectOpened,
  projectMigrationRegistry,
  rebuildNamedVersions,
  validateProjectSnapshot,
  serializeBigInt,
  type InitializedProject,
  type CommandExecutionReceipt,
  type ExecuteProjectCommandOptions,
  type LoadedProjectRevision,
  type NamedVersionsDocument,
  type ProjectMigrationReport,
  type ProjectValidationReport,
  type RevisionStorageAudit,
  type AcceptedExceptionDocument,
  type CommitActor,
  type LifecycleTransitionCommand,
  type QaState,
} from "@chai-studio/schema";
import {
  createDefaultTimelineClipProperties,
  createStudioTimelineFixture,
  executeTimelineDocumentEdit,
  timelineSnapshotToDocument,
} from "@chai-studio/timeline";
import { executeAudioDocumentEdit } from "@chai-studio/audio";
import { executeLanguageDocumentEdit } from "@chai-studio/captions";
import { executeAnnotationDocumentEdit } from "@chai-studio/bridge";
import { executeReviewDocumentEdit } from "@chai-studio/review";

export interface RecentProjectEntry {
  readonly projectId: string;
  readonly title: string;
  readonly rootPath: string;
  readonly revisionId: string;
  readonly lastOpenedAt: string;
}

export interface OpenProjectResult {
  readonly rootPath: string;
  readonly projectId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly revisionHash: string;
}

export interface ProjectRevisionHistoryItem {
  readonly revisionId: string;
  readonly revisionHash: string;
  readonly parentRevisionId: string | null;
  readonly commandId: string;
  readonly commandSummary: string;
  readonly diffSummary: string;
  readonly timestamp: string;
  readonly actorId: string;
}

export interface ProjectRepairReport {
  readonly passed: boolean;
  readonly rootPath: string;
  readonly revisionId: string;
  readonly storage: RevisionStorageAudit;
  readonly semantics: ProjectValidationReport;
  readonly recommendedActions: readonly string[];
}

export interface ProjectSchemaStatus {
  readonly currentVersion: typeof currentProjectSchemaVersion;
  readonly projectVersion: string;
  readonly migrationRequired: boolean;
  readonly availableMigrations: typeof projectMigrationRegistry;
  readonly dryRunReport: ProjectMigrationReport;
}

export interface ProjectSessionEvent {
  readonly type: "project.created" | "project.opened" | "project.closed" | "project.command";
  readonly projectId: string;
  readonly revisionId: string;
  readonly correlationId: string | null;
  readonly payload: unknown;
}

export interface ProjectOperationLease {
  readonly rootPath: string;
  readonly release: () => void;
}

export interface QaLifecycleTransitionInput {
  readonly outputId: string;
  readonly to: QaState;
  readonly actor: CommitActor;
  readonly expectedRevisionId: string;
  readonly report: QaReport | null;
  readonly exceptions: readonly AcceptedExceptionDocument[];
  readonly evidenceHashes: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly resultingRevisionId?: string;
}

export class ProjectSessionService {
  readonly #recentLimit: number;
  readonly #now: () => Date;
  readonly #recent = new Map<string, RecentProjectEntry>();
  readonly #listeners = new Set<(event: ProjectSessionEvent) => void>();
  #openRoot: string | null = null;
  #sessionTransitionInProgress = false;
  #sessionTransitionReadReady = false;
  #operationLeaseCount = 0;

  constructor(options: { readonly recentLimit?: number; readonly now?: () => Date } = {}) {
    this.#recentLimit = options.recentLimit ?? 20;
    this.#now = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.#recentLimit) || this.#recentLimit < 1 || this.#recentLimit > 100) {
      throw new Error("Recent project limit is outside bounded safe limits.");
    }
  }

  async create(input: {
    readonly targetPath: string;
    readonly title: string;
    readonly starter?: "empty" | "showcase" | "launch-film";
  }): Promise<InitializedProject> {
    return this.#withSessionTransition(async () => {
      assertNonEmpty(input.targetPath, "targetPath");
      assertNonEmpty(input.title, "title");
      const created = await initializeProjectFolder(input.targetPath, {
        title: input.title.trim(),
        now: this.#now(),
      });
      if (input.starter === "launch-film") await seedLaunchFilmProject(created.rootPath);
      if (input.starter === "showcase") await seedShowcaseProject(created.rootPath);
      await this.#open(created.rootPath);
      this.#emit({
        type: "project.created",
        projectId: created.projectId,
        revisionId: created.revisionId,
        correlationId: null,
        payload: { rootPath: created.rootPath },
      });
      return created;
    });
  }

  async open(rootPath: string): Promise<OpenProjectResult> {
    return this.#withSessionTransition(() => this.#open(rootPath));
  }

  async #open(rootPath: string): Promise<OpenProjectResult> {
    assertNonEmpty(rootPath, "rootPath");
    const root = path.resolve(rootPath);
    if (this.#openRoot !== null && this.#openRoot !== root) await this.#close();
    const current = await loadCurrentProjectRevision(root);
    await markProjectOpened(root);
    this.#openRoot = root;
    this.#sessionTransitionReadReady = true;
    const result = summarizeOpen(root, current);
    this.#recordRecent(result);
    this.#emit({
      type: "project.opened",
      projectId: result.projectId,
      revisionId: result.revisionId,
      correlationId: null,
      payload: result,
    });
    return result;
  }

  async close(): Promise<Readonly<{ closed: boolean; rootPath: string | null }>> {
    return this.#withSessionTransition(() => this.#close());
  }

  async #close(): Promise<Readonly<{ closed: boolean; rootPath: string | null }>> {
    const root = this.#openRoot;
    if (root === null) return { closed: false, rootPath: null };
    await markProjectCleanShutdown(root);
    const current = await loadCurrentProjectRevision(root);
    this.#openRoot = null;
    this.#emit({
      type: "project.closed",
      projectId: current.project.projectId,
      revisionId: current.pointer.revisionId,
      correlationId: null,
      payload: { rootPath: root },
    });
    return { closed: true, rootPath: root };
  }

  listRecent(): readonly RecentProjectEntry[] {
    return [...this.#recent.values()].sort((left, right) =>
      right.lastOpenedAt.localeCompare(left.lastOpenedAt, "en"),
    );
  }

  async snapshot(): Promise<LoadedProjectRevision> {
    return loadCurrentProjectRevision(this.#requireOpenRoot());
  }

  openRootPath(): string {
    return this.#requireOpenRoot();
  }

  acquireOperationLease(): ProjectOperationLease {
    const rootPath = this.#requireOpenRoot();
    this.#operationLeaseCount += 1;
    let released = false;
    return {
      rootPath,
      release: () => {
        if (released) return;
        released = true;
        this.#operationLeaseCount -= 1;
      },
    };
  }

  async executeCommand(
    input: unknown,
    options: ExecuteProjectCommandOptions = {},
  ): Promise<CommandExecutionReceipt> {
    if (isLifecycleCommand(input)) {
      throw new Error(
        "Lifecycle transitions are accepted only through the authoritative QA lifecycle service.",
      );
    }
    return this.#executeCommandUnchecked(input, options);
  }

  async transitionQaLifecycle(input: QaLifecycleTransitionInput): Promise<CommandExecutionReceipt> {
    const snapshot = await this.snapshot();
    if (snapshot.pointer.revisionId !== input.expectedRevisionId) {
      throw new Error(
        `Lifecycle revision conflict: expected ${input.expectedRevisionId}, current ${snapshot.pointer.revisionId}.`,
      );
    }
    const now = this.#now().toISOString();
    assertQaLifecycleTransition({
      from: snapshot.approvalState.state,
      currentOutputId: snapshot.approvalState.outputId,
      to: input.to,
      outputId: input.outputId,
      report: input.report,
      exceptions: input.exceptions,
      evidenceHashes: input.evidenceHashes,
      now,
    });
    const applicableExceptionIds = new Set(input.exceptions.map((exception) => exception.id));
    if (input.exceptionIds.some((id) => !applicableExceptionIds.has(id))) {
      throw new Error("Lifecycle transition references an unavailable accepted exception.");
    }
    const command: LifecycleTransitionCommand = {
      schemaVersion: "1.0.0",
      commandId: `command-lifecycle-${randomUUID()}`,
      idempotencyId: `idempotency-lifecycle-${randomUUID()}`,
      actor: input.actor,
      projectId: snapshot.project.projectId,
      correlationId: `correlation-lifecycle-${randomUUID()}`,
      issuedAt: now,
      capability: { name: "qa-lifecycle", version: "1.0.0" },
      payloadVersion: "1.0.0",
      affectedEntityIds: [input.outputId],
      declaredScope: "mutation",
      validationOnly: false,
      baseRevisionId: input.expectedRevisionId,
      authorizationId: null,
      kind: "lifecycle.transition",
      payload: {
        to: input.to,
        outputId: input.outputId,
        evidenceHashes: input.evidenceHashes,
        exceptionIds: input.exceptionIds,
      },
    };
    return this.#executeCommandUnchecked(command, {
      ...(input.resultingRevisionId === undefined ? {} : { revisionId: input.resultingRevisionId }),
    });
  }

  async #executeCommandUnchecked(
    input: unknown,
    options: ExecuteProjectCommandOptions = {},
  ): Promise<CommandExecutionReceipt> {
    const root = this.#requireOpenRoot();
    const receipt = await executeProjectCommand(root, input, {
      ...options,
      applyTimelineEdit: options.applyTimelineEdit ?? executeTimelineDocumentEdit,
      applyAudioEdit: options.applyAudioEdit ?? executeAudioDocumentEdit,
      applyLanguageEdit: options.applyLanguageEdit ?? executeLanguageDocumentEdit,
      applyAnnotationEdit: options.applyAnnotationEdit ?? executeAnnotationDocumentEdit,
      applyReviewEdit: options.applyReviewEdit ?? executeReviewDocumentEdit,
    });
    const current = await loadCurrentProjectRevision(root);
    this.#recordRecent(summarizeOpen(root, current));
    this.#emit({
      type: "project.command",
      projectId: receipt.projectId,
      revisionId: receipt.resultingRevisionId ?? current.pointer.revisionId,
      correlationId: receipt.correlationId,
      payload: receipt,
    });
    return receipt;
  }

  subscribe(listener: (event: ProjectSessionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async revisionHistory(): Promise<readonly ProjectRevisionHistoryItem[]> {
    const root = this.#requireOpenRoot();
    const storage = await auditRevisionStorage(root);
    const history = await Promise.all(
      storage.reachableRevisionIds.map(async (revisionId) => {
        const revision = await loadProjectRevision(root, revisionId);
        return {
          revisionId,
          revisionHash: revision.revisionHash,
          parentRevisionId: revision.transaction.parentRevisionId,
          commandId: revision.transaction.commandId,
          commandSummary: revision.transaction.commandSummary,
          diffSummary: revision.transaction.diffSummary,
          timestamp: revision.transaction.timestamp,
          actorId: revision.transaction.actor.id,
        } satisfies ProjectRevisionHistoryItem;
      }),
    );
    return history.sort((left, right) => right.timestamp.localeCompare(left.timestamp, "en"));
  }

  async namedVersions(): Promise<NamedVersionsDocument> {
    return rebuildNamedVersions(this.#requireOpenRoot());
  }

  async migrationReport(): Promise<ProjectSchemaStatus> {
    const current = await this.snapshot();
    const projectVersion = current.project.schemaVersion;
    const hash = current.revisionHash;
    return {
      currentVersion: currentProjectSchemaVersion,
      projectVersion,
      migrationRequired: false,
      availableMigrations: projectMigrationRegistry,
      dryRunReport: {
        migrationId: null,
        fromVersion: projectVersion,
        toVersion: currentProjectSchemaVersion,
        dryRun: true,
        changedPaths: [],
        sourceHash: hash,
        targetHash: hash,
        backupPath: null,
        migrated: false,
      },
    };
  }

  async repairReport(): Promise<ProjectRepairReport> {
    const root = this.#requireOpenRoot();
    const current = await loadCurrentProjectRevision(root);
    const storage = await auditRevisionStorage(root);
    const semantics = validateProjectSnapshot(current);
    const recommendedActions = [
      ...(storage.stagingEntries.length > 0 ? ["Inspect and clean interrupted staging revisions."] : []),
      ...(storage.orphanRevisionIds.length > 0 ? ["Review orphan revisions before cleanup."] : []),
      ...(storage.invalidRevisionIds.length > 0 ? ["Restore invalid revisions from verified backups."] : []),
      ...semantics.issues.map((issue) => issue.repairHint),
    ];
    return {
      passed: storage.passed && semantics.passed,
      rootPath: root,
      revisionId: current.pointer.revisionId,
      storage,
      semantics,
      recommendedActions: [...new Set(recommendedActions)],
    };
  }

  #requireOpenRoot(): string {
    if (this.#sessionTransitionInProgress && !this.#sessionTransitionReadReady) {
      throw new Error("Project session transition is in progress.");
    }
    if (this.#openRoot === null) throw new Error("No project is open in this Studio session.");
    return this.#openRoot;
  }

  async #withSessionTransition<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.#sessionTransitionInProgress) {
      throw new Error("Project session transition is already in progress.");
    }
    if (this.#operationLeaseCount > 0) {
      throw new Error(
        `Project session transition is blocked while ${String(this.#operationLeaseCount)} operation lease(s) are active.`,
      );
    }
    this.#sessionTransitionInProgress = true;
    this.#sessionTransitionReadReady = false;
    try {
      return await operation();
    } finally {
      this.#sessionTransitionInProgress = false;
      this.#sessionTransitionReadReady = false;
    }
  }

  #recordRecent(project: OpenProjectResult): void {
    this.#recent.delete(project.rootPath);
    this.#recent.set(project.rootPath, {
      projectId: project.projectId,
      title: project.title,
      rootPath: project.rootPath,
      revisionId: project.revisionId,
      lastOpenedAt: this.#now().toISOString(),
    });
    const overflow = this.listRecent().slice(this.#recentLimit);
    for (const entry of overflow) this.#recent.delete(entry.rootPath);
  }

  #emit(event: ProjectSessionEvent): void {
    for (const listener of this.#listeners) listener(structuredClone(event));
  }
}

const seedLaunchFilmProject = async (rootPath: string): Promise<void> => {
  const current = await loadCurrentProjectRevision(rootPath);
  const fixture = createStudioTimelineFixture();
  const converted = timelineSnapshotToDocument(fixture, current.timeline, current.pointer.revisionId);
  const starterAudioBusId = current.timeline.audioGraph?.masterBusId ?? `${fixture.id}:audio:master`;
  const timeline = {
    ...converted,
    projectId: current.project.projectId,
    audioBusIds: [starterAudioBusId],
    tracks: converted.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        audioBusId: track.kind === "audio" ? starterAudioBusId : null,
      })),
    })),
  };
  const clips = timeline.tracks.flatMap((track) => track.clips.map((clip) => ({ clip, track })));
  const starterAssets = [
    ...new Map(
      clips.flatMap(({ clip, track }) =>
        clip.assetId === null
          ? []
          : [
              [
                clip.assetId,
                {
                  id: clip.assetId,
                  path: `assets/starter/${clip.assetId}.json`,
                  kind:
                    clip.engine !== "shared"
                      ? ("composition" as const)
                      : track.kind === "audio"
                        ? ("audio" as const)
                        : track.kind === "caption"
                          ? ("caption" as const)
                          : ("video" as const),
                  durationFrames: clip.sourceDurationFrames,
                  fps: timeline.fps,
                  hasAudio: track.kind === "audio",
                  hasAlpha: false,
                  variableFrameRate: false,
                  rights: "unknown" as const,
                  validationState: "unsupported" as const,
                },
              ] as const,
            ],
      ),
    ).values(),
  ];
  await mkdir(path.join(rootPath, "assets", "starter"), { recursive: true, mode: 0o700 });
  const assets = await Promise.all(
    starterAssets.map(async (asset) => {
      const descriptor = `${JSON.stringify({
        schemaVersion: "1.0.0",
        id: asset.id,
        role: "non-renderable Chai Studio first-run placeholder descriptor",
        engine: clips.find(({ clip }) => clip.assetId === asset.id)?.clip.engine ?? "shared",
      })}\n`;
      await writeFile(path.join(rootPath, asset.path), descriptor, { encoding: "utf8", mode: 0o600 });
      return {
        ...asset,
        contentHash: createHash("sha256").update(descriptor, "utf8").digest("hex"),
      };
    }),
  );
  await commitProjectRevision(rootPath, {
    baseRevisionId: current.pointer.revisionId,
    commandId: `command-starter-${randomUUID()}`,
    actor: { id: "actor-chai-studio", kind: "system", sessionId: "session-first-launch" },
    capability: { name: "project-starter", version: "1.0.0" },
    declaredScope: "destructive",
    authorizationId: "authorization-first-launch-starter",
    commandSummary: "Create Launch Film placeholder timeline",
    diffSummary:
      "Created an editable revision-backed starter sequence with explicitly unsupported placeholder assets.",
    affectedEntityIds: [timeline.timelineId, ...timeline.tracks.map((track) => track.id)],
    documents: {
      project: {
        ...current.project,
        activeTimelineId: timeline.timelineId,
        enginePins: {
          ...current.project.enginePins,
          remotion: pinnedRemotionVersion,
          hyperframes: pinnedHyperframesVersion,
        },
      },
      timeline,
      assets: { ...current.assets, assets },
      settings: current.settings,
      approvalState: current.approvalState,
    },
  });
};

const seedShowcaseProject = async (rootPath: string): Promise<void> => {
  const current = await loadCurrentProjectRevision(rootPath);
  const assetDirectory = path.join(rootPath, "assets", "starter");
  await mkdir(assetDirectory, { recursive: true, mode: 0o700 });
  const scenes = [
    {
      id: "asset-chai-showcase-intro-0001",
      fileName: "chai-showcase-01-intro.png",
      kicker: "CHAI STUDIO",
      title: "Make the cut.\nKeep the truth.",
      body: "One frame-exact timeline for shared media, Remotion, and HyperFrames.",
      accent: "#8d87ff",
      label: "01 · EDIT",
    },
    {
      id: "asset-chai-showcase-shape-0001",
      fileName: "chai-showcase-02-shape.png",
      kicker: "SHARED CONTROL",
      title: "Shape every\nlayer.",
      body: "Inspect, animate, compare, and revise without losing source ownership.",
      accent: "#65d7e7",
      label: "02 · ANIMATE",
    },
    {
      id: "asset-chai-showcase-deliver-0001",
      fileName: "chai-showcase-03-deliver.png",
      kicker: "RELEASE TRUTH",
      title: "Deliver only\nwhat passed.",
      body: "Immutable output, QA evidence, and explicit approval before release.",
      accent: "#74e0ad",
      label: "03 · DELIVER",
    },
  ] as const;
  const assets = await Promise.all(
    scenes.map(async (scene, index) => {
      const bytes = await sharp(Buffer.from(showcaseSvg(scene, index), "utf8"))
        .png()
        .toBuffer();
      const relativePath = `assets/starter/${scene.fileName}`;
      await writeFile(path.join(rootPath, relativePath), bytes, { mode: 0o600 });
      return {
        id: scene.id,
        path: relativePath,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        kind: "image" as const,
        durationFrames: null,
        fps: null,
        hasAudio: false,
        hasAlpha: false,
        variableFrameRate: false,
        rights: "owned" as const,
        validationState: "valid" as const,
      };
    }),
  );
  const clipDuration = 150n;
  const clips = scenes.map((scene, index) => ({
    id: `clip-chai-showcase-${String(index + 1).padStart(2, "0")}`,
    assetId: scene.id,
    engine: "shared" as const,
    startFrame: serializeBigInt(BigInt(index) * clipDuration),
    durationFrames: serializeBigInt(clipDuration),
    sourceInFrame: serializeBigInt(0n),
    sourceDurationFrames: serializeBigInt(1n),
    capability: "unified" as const,
    audioBusId: null,
    name: scene.title.replace("\n", " "),
    metadata: { starter: "chai-showcase-v1", scene: String(index + 1) },
    properties: createDefaultTimelineClipProperties({
      engine: "shared",
      kind: "visual",
      hasAudio: false,
    }),
  }));
  const timeline = {
    ...current.timeline,
    durationFrames: serializeBigInt(clipDuration * BigInt(clips.length)),
    tracks: [
      {
        id: "track-chai-showcase-video-0001",
        kind: "video" as const,
        name: "Starter story",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        clips,
      },
    ],
    audioBusIds: [],
    selection: {
      primaryId: clips[0]?.id ?? null,
      selectedIds: clips[0] === undefined ? [] : [clips[0].id],
      anchorId: clips[0]?.id ?? null,
    },
    markers: scenes.map((scene, index) => ({
      id: `marker-chai-showcase-${String(index + 1).padStart(2, "0")}`,
      frame: serializeBigInt(BigInt(index) * clipDuration),
      duration: serializeBigInt(0n),
      label: scene.label,
      category: "chapter" as const,
      issueSeverity: null,
      annotationReferenceIds: [],
      ripplePolicy: "anchored-content" as const,
    })),
    keyframes: [],
    automation: [],
  };
  await commitProjectRevision(rootPath, {
    baseRevisionId: current.pointer.revisionId,
    commandId: `command-starter-${randomUUID()}`,
    actor: { id: "actor-chai-studio", kind: "system", sessionId: "session-first-launch" },
    capability: { name: "project-starter", version: "1.0.0" },
    declaredScope: "destructive",
    authorizationId: "authorization-first-launch-starter",
    commandSummary: "Create Chai Studio renderable starter",
    diffSummary: "Created a local, owned, frame-exact starter sequence with validated PNG media.",
    affectedEntityIds: [
      timeline.timelineId,
      "track-chai-showcase-video-0001",
      ...clips.map((clip) => clip.id),
    ],
    documents: {
      project: {
        ...current.project,
        activeTimelineId: timeline.timelineId,
        rightsNotes: [
          ...current.project.rightsNotes,
          "The Chai Studio starter artwork is generated locally and marked owned for this project.",
        ],
      },
      timeline,
      assets: { ...current.assets, assets },
      settings: current.settings,
      approvalState: current.approvalState,
    },
  });
};

const showcaseSvg = (
  scene: Readonly<{
    kicker: string;
    title: string;
    body: string;
    accent: string;
    label: string;
  }>,
  activeIndex: number,
): string => {
  const [titleLineOne, titleLineTwo] = scene.title.split("\n");
  const timelineLabels = ["Make the cut", "Shape every layer", "Deliver what passed"] as const;
  const tabs = ["EDIT", "ANIMATE", "DELIVER"]
    .map((tab, index) => {
      const active = index === activeIndex;
      return `<g transform="translate(${String(1310 + index * 150)} 104)"><rect width="132" height="46" rx="23" fill="${active ? scene.accent : "#121d2c"}" fill-opacity="${active ? "0.18" : "1"}" stroke="${active ? scene.accent : "#2b3b50"}"/><text x="66" y="29" text-anchor="middle" fill="${active ? "#edfaff" : "#7890a9"}" font-size="15" font-weight="700">${tab}</text></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07101b"/><stop offset="0.55" stop-color="#0c1827"/><stop offset="1" stop-color="#07111d"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="${scene.accent}" stop-opacity="0.42"/><stop offset="1" stop-color="${scene.accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#15243a"/><stop offset="1" stop-color="#0b1421"/></linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <circle cx="1530" cy="350" r="520" fill="url(#glow)" opacity="0.7"/>
  <g font-family="Inter, Helvetica, Arial, sans-serif">
    <rect x="80" y="70" width="54" height="54" rx="14" fill="#9feaff"/><text x="107" y="107" text-anchor="middle" fill="#08111b" font-size="28" font-weight="900">C</text>
    <text x="154" y="105" fill="#edf5ff" font-size="24" font-weight="800">Chai Studio</text>
    ${tabs}
    <text x="110" y="300" fill="${scene.accent}" font-size="20" font-weight="800" letter-spacing="6">${scene.kicker}</text>
    <text x="105" y="420" fill="#f4f7ff" font-size="92" font-weight="850" letter-spacing="-4"><tspan x="105">${titleLineOne ?? ""}</tspan><tspan x="105" dy="98">${titleLineTwo ?? ""}</tspan></text>
    <text x="110" y="650" fill="#9db0c8" font-size="28" font-weight="450">${scene.body}</text>
    <g transform="translate(1075 235)">
      <rect width="690" height="430" rx="20" fill="url(#panel)" stroke="#344861" stroke-width="2"/>
      <rect x="26" y="26" width="638" height="316" rx="12" fill="#09111d" stroke="#263a51"/>
      <circle cx="500" cy="142" r="102" fill="${scene.accent}" opacity="0.82"/>
      <path d="M80 278 L270 112 L390 238 L505 86 L620 278 Z" fill="#14243a" stroke="#35506f" stroke-width="2"/>
      <rect x="26" y="362" width="638" height="42" rx="8" fill="#0a1421"/>
      <rect x="48" y="376" width="392" height="13" rx="6.5" fill="#283a50"/><rect x="48" y="376" width="${String(120 + activeIndex * 115)}" height="13" rx="6.5" fill="${scene.accent}"/>
      <circle cx="${String(168 + activeIndex * 115)}" cy="382.5" r="10" fill="#f4f7ff"/>
    </g>
    <g transform="translate(80 805)">
      <rect width="1760" height="190" rx="18" fill="#09131f" stroke="#2c4057" stroke-width="2"/>
      <text x="28" y="42" fill="#7f94ad" font-size="15" font-weight="700" letter-spacing="2">FRAME-EXACT TIMELINE</text>
      ${timelineLabels.map((label, index) => `<rect x="${String(250 + index * 495)}" y="68" width="465" height="78" rx="12" fill="${index === activeIndex ? scene.accent : "#1a2a40"}" fill-opacity="${index === activeIndex ? "0.44" : "1"}" stroke="${index === activeIndex ? scene.accent : "#344b65"}" stroke-width="2"/><text x="${String(278 + index * 495)}" y="115" fill="#edf5ff" font-size="21" font-weight="750">${label}</text>`).join("")}
      <line x1="${String(470 + activeIndex * 495)}" y1="54" x2="${String(470 + activeIndex * 495)}" y2="166" stroke="#ff6b7a" stroke-width="3"/>
    </g>
    <text x="1810" y="1030" text-anchor="end" fill="#7890a9" font-size="14" font-weight="700" letter-spacing="2">${scene.label}</text>
  </g>
</svg>`;
};

const summarizeOpen = (rootPath: string, current: LoadedProjectRevision): OpenProjectResult => ({
  rootPath,
  projectId: current.project.projectId,
  title: current.project.title,
  revisionId: current.pointer.revisionId,
  revisionHash: current.revisionHash,
});

const assertNonEmpty = (value: string, field: string): void => {
  if (value.trim().length === 0 || value.length > 4_096) {
    throw new Error(`Project API field ${field} is invalid.`);
  }
};

const isLifecycleCommand = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as Readonly<{ kind?: unknown }>).kind === "lifecycle.transition";
