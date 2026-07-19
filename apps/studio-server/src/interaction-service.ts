import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import {
  writeLatestContext,
  type BridgeEntityContext,
  type SelectionContextManifest,
} from "@chai-studio/bridge";
import {
  abortSourceEdit,
  beginSourceEdit,
  commitSourceEdit,
  readSourceEditSession,
  type CommandExecutionReceipt,
  type CommitActor,
  type ExecuteProjectCommandOptions,
  type AnnotationDocument,
  type AnnotationGeometry,
  type SourceEditSession,
} from "@chai-studio/schema";
import type { PreviewSessionService } from "./preview-service.js";
import type { ProjectSessionService } from "./project-service.js";
import type { RenderOutputRecord } from "./render-service.js";

export interface EditorSelectionState {
  readonly projectId: string;
  readonly selectedIds: readonly string[];
  readonly primaryId: string | null;
  readonly anchorId: string | null;
  readonly stateVersion: number;
  readonly updatedAt: string;
}

export type EditorContextEntity = BridgeEntityContext;
export type EditorContextSnapshot = SelectionContextManifest;

export interface CaptureRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly previewSessionId: string;
  readonly previewStateVersion: number;
  readonly frame: string;
  readonly truthMode: "interactive-approximation" | "rendered-fidelity";
  readonly quality: "draft" | "balanced" | "full";
  readonly renderOutputId: string | null;
  readonly label: string;
  readonly mimeType: "image/png";
  readonly relativePath: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly createdAt: string;
}

export type AnnotationRecord = AnnotationDocument;

/** Non-authoritative visual pairing of two capture files. Exact revision A/B authority lives in TimelineDocument.reviewState. */
export interface CaptureComparisonView {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly leftCaptureId: string;
  readonly rightCaptureId: string;
  readonly mode: "side-by-side" | "wipe" | "difference" | "onion-skin";
  readonly split: number;
  readonly createdAt: string;
}

export type ComparisonRecord = CaptureComparisonView;

export interface StudioInteractionEvent {
  readonly type:
    | "capture.created"
    | "annotation.created"
    | "annotation.updated"
    | "annotation.deleted"
    | "comparison.created"
    | "comparison.deleted";
  readonly projectId: string;
  readonly revisionId: string;
  readonly payload: unknown;
}

interface CaptureViewDocument<T> {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly records: readonly T[];
}

export class StudioInteractionService {
  readonly #projects: ProjectSessionService;
  readonly #preview: PreviewSessionService;
  readonly #now: () => Date;
  readonly #validateSource: ExecuteProjectCommandOptions["validateSource"];
  readonly #invalidateSourceCaches: ExecuteProjectCommandOptions["invalidateSourceCaches"];
  readonly #unsubscribe: readonly (() => void)[];
  readonly #listeners = new Set<(event: StudioInteractionEvent) => void>();
  #selection: EditorSelectionState | null = null;
  #selectionOverride = false;
  #contextRefresh: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly preview: PreviewSessionService;
    readonly now?: () => Date;
    readonly validateSource?: ExecuteProjectCommandOptions["validateSource"];
    readonly invalidateSourceCaches?: ExecuteProjectCommandOptions["invalidateSourceCaches"];
  }) {
    this.#projects = input.projects;
    this.#preview = input.preview;
    this.#now = input.now ?? (() => new Date());
    this.#validateSource = input.validateSource;
    this.#invalidateSourceCaches = input.invalidateSourceCaches;
    this.#unsubscribe = [
      this.#projects.subscribe((event) => {
        if (event.type === "project.opened" || event.type === "project.created") {
          this.#selectionOverride = false;
        }
        this.#queueContextRefresh();
      }),
      this.#preview.subscribe(() => {
        this.#queueContextRefresh();
      }),
    ];
  }

  async shutdown(): Promise<void> {
    if (this.#disposed) return this.#contextRefresh;
    this.#disposed = true;
    for (const stop of this.#unsubscribe) stop();
    this.#listeners.clear();
    await this.#contextRefresh;
  }

  subscribe(listener: (event: StudioInteractionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async selection(): Promise<EditorSelectionState> {
    const snapshot = await this.#projects.snapshot();
    return this.#selectionForSnapshot(snapshot);
  }

  async setSelection(input: {
    readonly ids: readonly string[];
    readonly primaryId: string | null;
    readonly anchorId: string | null;
    readonly mode: "replace" | "add" | "toggle";
    readonly expectedStateVersion: number;
  }): Promise<EditorSelectionState> {
    const snapshot = await this.#projects.snapshot();
    const current = this.#selectionForSnapshot(snapshot);
    if (current.stateVersion !== input.expectedStateVersion) {
      throw new Error(
        `Editor selection conflict: expected ${String(input.expectedStateVersion)}, current ${String(current.stateVersion)}.`,
      );
    }
    if (input.ids.length > 256 || new Set(input.ids).size !== input.ids.length) {
      throw new Error("Editor selection must be unique and bounded to 256 entities.");
    }
    const known = entityMap(snapshot);
    for (const id of input.ids) if (!known.has(id)) throw new Error(`Unknown selectable entity: ${id}.`);
    let selected = [...current.selectedIds];
    if (input.mode === "replace") selected = [...input.ids];
    if (input.mode === "add") selected = [...new Set([...selected, ...input.ids])];
    if (input.mode === "toggle") {
      for (const id of input.ids) {
        selected = selected.includes(id)
          ? selected.filter((candidate) => candidate !== id)
          : [...selected, id];
      }
    }
    if (input.primaryId !== null && !selected.includes(input.primaryId)) {
      throw new Error("Editor selection primaryId must be selected.");
    }
    if (input.anchorId !== null && !selected.includes(input.anchorId)) {
      throw new Error("Editor selection anchorId must be selected.");
    }
    this.#selection = {
      projectId: snapshot.project.projectId,
      selectedIds: selected,
      primaryId: input.primaryId ?? selected[0] ?? null,
      anchorId: input.anchorId,
      stateVersion: current.stateVersion + 1,
      updatedAt: this.#timestamp(),
    };
    this.#selectionOverride = true;
    await this.context();
    return this.#selection;
  }

  async context(): Promise<EditorContextSnapshot> {
    const snapshot = await this.#projects.snapshot();
    const selection = this.#selectionForSnapshot(snapshot);
    const entities = entityMap(snapshot);
    const preview = await previewStatusOrDefault(this.#preview, snapshot.pointer.revisionId);
    const selectedEntities = selection.selectedIds.map((id) => {
      const entity = entities.get(id);
      if (entity === undefined) throw new Error(`Selected entity disappeared: ${id}.`);
      return entity;
    });
    const primary = selection.primaryId === null ? null : (entities.get(selection.primaryId) ?? null);
    const engines = new Set(
      selectedEntities.flatMap((entity) => {
        const engine = entity.summary.engine;
        return engine === "remotion" || engine === "hyperframes" || engine === "shared" ? [engine] : [];
      }),
    );
    const sourcePaths = selectedEntities.flatMap((entity) => {
      const sourcePath = entity.summary.sourcePath;
      return typeof sourcePath === "string" ? [sourcePath] : [];
    });
    const currentFrame = preview.state.currentFrame;
    const captures = await this.#readCaptureRecords(snapshot.project.projectId);
    const context: SelectionContextManifest = {
      schemaVersion: "1.0.0",
      contextId: `context-${snapshot.pointer.revisionId}-${String(selection.stateVersion)}`,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      timelineId: snapshot.timeline.timelineId,
      generatedAt: this.#timestamp(),
      selectionStateVersion: selection.stateVersion,
      selectedIds: selection.selectedIds,
      primaryId: selection.primaryId,
      anchorId: selection.anchorId,
      masterFrame: currentFrame,
      sourceFrames: Object.fromEntries(
        selectedEntities.map((entity) => [entity.id, sourceFrame(entity, currentFrame)]),
      ),
      timecode: frameToTimecode(currentFrame, snapshot.timeline.fps),
      fps: snapshot.timeline.fps,
      engine: contextEngine(engines),
      sourcePaths: [...new Set(sourcePaths)].sort(),
      props: recordSummary(primary?.summary.props),
      variables: recordSummary(primary?.summary.variables),
      effects: recordArray(primary?.summary.effects),
      transitions: recordArray(primary?.summary.transitions),
      nearbyClips: nearbyClipEntities(snapshot, primary),
      entities: selectedEntities,
      preview: {
        sessionId: preview.state.sessionId,
        stateVersion: preview.state.stateVersion,
        mode: preview.state.truthMode === "rendered-fidelity" ? "fidelity" : "interactive",
        quality: preview.state.quality,
        synchronized: preview.synchronized,
      },
      captureIds: captures
        .filter((capture) => capture.revisionId === snapshot.pointer.revisionId)
        .map((capture) => capture.id),
      annotationIds: (snapshot.timeline.annotations ?? []).map((annotation) => annotation.id),
    };
    await writeLatestContext(this.#projects.openRootPath(), context);
    return context;
  }

  async createCapture(input: {
    readonly label: string;
    readonly imageBase64: string;
    readonly expectedPreviewStateVersion: number;
  }): Promise<CaptureRecord> {
    const snapshot = await this.#projects.snapshot();
    const preview = await this.#preview.status();
    if (!preview.synchronized || preview.state.revisionId !== snapshot.pointer.revisionId) {
      throw new Error("Preview capture requires a session synchronized to the current project revision.");
    }
    if (preview.state.stateVersion !== input.expectedPreviewStateVersion) {
      throw new Error(
        `Preview state conflict: expected ${String(input.expectedPreviewStateVersion)}, current ${String(preview.state.stateVersion)}.`,
      );
    }
    const bytes = decodePng(input.imageBase64);
    const id = `capture-${randomUUID()}`;
    const relativePath = `captures/${id}.png`;
    const record: CaptureRecord = {
      schemaVersion: "1.0.0",
      id,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      timelineId: snapshot.timeline.timelineId,
      previewSessionId: preview.state.sessionId,
      previewStateVersion: preview.state.stateVersion,
      frame: preview.state.currentFrame,
      truthMode: preview.state.truthMode,
      quality: preview.state.quality,
      renderOutputId: null,
      label: boundedText(input.label, "capture label", 256, true),
      mimeType: "image/png",
      relativePath,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      createdAt: this.#timestamp(),
    };
    const root = this.#projects.openRootPath();
    await writeBytesAtomic(path.join(root, relativePath), bytes);
    await writeJsonAtomic(path.join(root, "captures", `${id}.json`), record);
    await this.context();
    this.#emit({
      type: "capture.created",
      projectId: record.projectId,
      revisionId: record.revisionId,
      payload: record,
    });
    return record;
  }

  async createCaptureFromRender(input: {
    readonly label: string;
    readonly output: RenderOutputRecord;
    readonly expectedPreviewStateVersion: number;
  }): Promise<CaptureRecord> {
    const snapshot = await this.#projects.snapshot();
    const preview = await this.#preview.status();
    if (!preview.synchronized || preview.state.revisionId !== snapshot.pointer.revisionId) {
      throw new Error("Exact capture requires a preview synchronized to the current project revision.");
    }
    if (preview.state.stateVersion !== input.expectedPreviewStateVersion) {
      throw new Error(
        `Preview state conflict: expected ${String(input.expectedPreviewStateVersion)}, current ${String(preview.state.stateVersion)}.`,
      );
    }
    const output = input.output;
    if (
      output.projectId !== snapshot.project.projectId ||
      output.activationRevisionId !== snapshot.pointer.revisionId ||
      output.scope.kind !== "frame" ||
      output.scope.frame !== preview.state.currentFrame
    ) {
      throw new Error("Exact capture output does not match the current project revision and preview frame.");
    }
    if (output.profile.outputKind !== "still" || output.profile.container !== "png") {
      throw new Error("Exact capture requires an immutable PNG still render.");
    }
    const artifact = output.artifacts.find((candidate) => candidate.primary);
    if (!artifact?.relativePath.endsWith(".png")) {
      throw new Error("Exact capture output has no primary PNG artifact.");
    }
    const root = path.resolve(this.#projects.openRootPath());
    const sourcePath = path.resolve(root, artifact.relativePath);
    if (!sourcePath.startsWith(`${root}${path.sep}`)) {
      throw new Error("Exact capture artifact escapes the open project root.");
    }
    const bytes = await readFile(sourcePath);
    assertPngBytes(bytes);
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== artifact.byteLength || contentHash !== artifact.contentHash) {
      throw new Error("Exact capture artifact no longer matches its immutable render receipt.");
    }
    const id = `capture-${randomUUID()}`;
    const relativePath = `captures/${id}.png`;
    const record: CaptureRecord = {
      schemaVersion: "1.0.0",
      id,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      timelineId: snapshot.timeline.timelineId,
      previewSessionId: preview.state.sessionId,
      previewStateVersion: preview.state.stateVersion,
      frame: preview.state.currentFrame,
      truthMode: "rendered-fidelity",
      quality: "full",
      renderOutputId: output.id,
      label: boundedText(input.label, "capture label", 256, true),
      mimeType: "image/png",
      relativePath,
      contentHash,
      byteLength: bytes.length,
      createdAt: this.#timestamp(),
    };
    await writeBytesAtomic(path.join(root, relativePath), bytes);
    await writeJsonAtomic(path.join(root, "captures", `${id}.json`), record);
    await this.context();
    this.#emit({
      type: "capture.created",
      projectId: record.projectId,
      revisionId: record.revisionId,
      payload: record,
    });
    return record;
  }

  async listCaptures(): Promise<readonly CaptureRecord[]> {
    const snapshot = await this.#projects.snapshot();
    return this.#readCaptureRecords(snapshot.project.projectId);
  }

  async createAnnotation(input: {
    readonly entityIds: readonly string[];
    readonly frame?: string | null;
    readonly frameRange?: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
    readonly captureId: string | null;
    readonly body: string;
    readonly category?: AnnotationDocument["category"];
    readonly severity?: "note" | "warning" | "error";
    readonly geometry?: AnnotationGeometry;
    readonly color?: string;
    readonly privacyBehavior?: AnnotationDocument["privacyBehavior"];
    readonly author: CommitActor;
  }): Promise<AnnotationRecord> {
    const snapshot = await this.#projects.snapshot();
    const known = entityMap(snapshot);
    if (input.entityIds.length > 64 || new Set(input.entityIds).size !== input.entityIds.length) {
      throw new Error("Annotation entity IDs must be unique and bounded.");
    }
    for (const id of input.entityIds)
      if (!known.has(id)) throw new Error(`Unknown annotation entity: ${id}.`);
    const frameRange =
      input.frameRange ??
      (input.frame == null
        ? null
        : { startFrame: input.frame, endFrameExclusive: (BigInt(input.frame) + 1n).toString(10) });
    if (frameRange !== null) {
      assertFrameInTimeline(frameRange.startFrame, snapshot.timeline.durationFrames);
      if (BigInt(frameRange.endFrameExclusive) > BigInt(snapshot.timeline.durationFrames)) {
        throw new Error("Annotation frame range is outside timeline.");
      }
    }
    if (input.captureId !== null) await this.#requireCapture(input.captureId, snapshot.project.projectId);
    const now = this.#timestamp();
    const id = `annotation-${randomUUID()}`;
    const record: AnnotationDocument = {
      schemaVersion: "1.0.0",
      id,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      entityIds: [...input.entityIds],
      captureId: input.captureId,
      frameRange: frameRange as AnnotationDocument["frameRange"],
      coordinateSpace: "source-normalized",
      geometry: input.geometry ?? { kind: "point", point: { x: 0.5, y: 0.5 } },
      category:
        input.category ?? (input.severity === "error" || input.severity === "warning" ? "issue" : "note"),
      color: input.color ?? (input.severity === "error" ? "#FF5A6F" : "#F4C95D"),
      body: boundedText(input.body, "annotation body", 16_384),
      author: input.author,
      order: (snapshot.timeline.annotations ?? []).length,
      visible: true,
      locked: false,
      privacyBehavior:
        input.geometry?.kind === "blur-privacy"
          ? "redact-preview-and-export"
          : (input.privacyBehavior ?? "none"),
      createdAt: now,
      updatedAt: now,
    };
    const receipt = await this.#projects.executeCommand(
      annotationCommand(
        snapshot.project.projectId,
        snapshot.pointer.revisionId,
        input.author,
        {
          kind: "annotation.create",
          annotation: record,
        },
        [id, ...input.entityIds],
        now,
      ),
    );
    assertCommitted(receipt);
    const created = await this.#requireAnnotation(id);
    await this.context();
    this.#emit({
      type: "annotation.created",
      projectId: created.projectId,
      revisionId: created.revisionId,
      payload: created,
    });
    return created;
  }

  async listAnnotations(): Promise<readonly AnnotationRecord[]> {
    const snapshot = await this.#projects.snapshot();
    return snapshot.timeline.annotations ?? [];
  }

  async updateAnnotation(
    id: string,
    changes: Readonly<Partial<Omit<AnnotationDocument, "schemaVersion" | "id" | "projectId" | "createdAt">>>,
  ): Promise<AnnotationRecord> {
    const snapshot = await this.#projects.snapshot();
    const before = (snapshot.timeline.annotations ?? []).find((record) => record.id === id);
    if (before === undefined) throw new Error(`Unknown annotation ID: ${id}.`);
    const normalizedChanges = {
      ...changes,
      ...(changes.body === undefined ? {} : { body: boundedText(changes.body, "annotation body", 16_384) }),
      updatedAt: this.#timestamp(),
    };
    const receipt = await this.#projects.executeCommand(
      annotationCommand(
        snapshot.project.projectId,
        snapshot.pointer.revisionId,
        before.author,
        {
          kind: "annotation.update",
          annotationId: id,
          changes: normalizedChanges,
        },
        [id, ...before.entityIds, ...(changes.entityIds ?? [])],
        this.#timestamp(),
      ),
    );
    assertCommitted(receipt);
    const updated = await this.#requireAnnotation(id);
    await this.context();
    this.#emit({
      type: "annotation.updated",
      projectId: updated.projectId,
      revisionId: updated.revisionId,
      payload: updated,
    });
    return updated;
  }

  async deleteAnnotation(id: string): Promise<boolean> {
    const snapshot = await this.#projects.snapshot();
    const before = (snapshot.timeline.annotations ?? []).find((record) => record.id === id);
    if (before === undefined) return false;
    const receipt = await this.#projects.executeCommand(
      annotationCommand(
        snapshot.project.projectId,
        snapshot.pointer.revisionId,
        before.author,
        {
          kind: "annotation.delete",
          annotationId: id,
        },
        [id, ...before.entityIds],
        this.#timestamp(),
      ),
    );
    assertCommitted(receipt);
    await this.context();
    this.#emit({
      type: "annotation.deleted",
      projectId: snapshot.project.projectId,
      revisionId: receipt.resultingRevisionId ?? snapshot.pointer.revisionId,
      payload: { id },
    });
    return true;
  }

  async createComparison(input: {
    readonly leftCaptureId: string;
    readonly rightCaptureId: string;
    readonly mode: CaptureComparisonView["mode"];
    readonly split: number;
  }): Promise<CaptureComparisonView> {
    const snapshot = await this.#projects.snapshot();
    if (input.leftCaptureId === input.rightCaptureId) throw new Error("Comparison captures must differ.");
    await this.#requireCapture(input.leftCaptureId, snapshot.project.projectId);
    await this.#requireCapture(input.rightCaptureId, snapshot.project.projectId);
    if (!Number.isFinite(input.split) || input.split < 0 || input.split > 1) {
      throw new Error("Comparison split must be between zero and one.");
    }
    const record: CaptureComparisonView = {
      schemaVersion: "1.0.0",
      id: `comparison-${randomUUID()}`,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      leftCaptureId: input.leftCaptureId,
      rightCaptureId: input.rightCaptureId,
      mode: input.mode,
      split: input.split,
      createdAt: this.#timestamp(),
    };
    const records = await this.listComparisons();
    await this.#writeCaptureViewDocument("comparison-views.json", snapshot.project.projectId, [
      ...records,
      record,
    ]);
    this.#emit({
      type: "comparison.created",
      projectId: record.projectId,
      revisionId: record.revisionId,
      payload: record,
    });
    return record;
  }

  async listComparisons(): Promise<readonly CaptureComparisonView[]> {
    const snapshot = await this.#projects.snapshot();
    return this.#readCaptureViewDocument<CaptureComparisonView>(
      "comparison-views.json",
      snapshot.project.projectId,
    );
  }

  async deleteComparison(id: string): Promise<boolean> {
    const snapshot = await this.#projects.snapshot();
    const records = await this.listComparisons();
    if (!records.some((record) => record.id === id)) return false;
    await this.#writeCaptureViewDocument(
      "comparison-views.json",
      snapshot.project.projectId,
      records.filter((record) => record.id !== id),
    );
    this.#emit({
      type: "comparison.deleted",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      payload: { id },
    });
    return true;
  }

  beginSourceEdit(input: { readonly path: string; readonly actor: CommitActor }): Promise<SourceEditSession> {
    return beginSourceEdit(this.#projects.openRootPath(), {
      path: input.path,
      actor: input.actor,
      now: this.#now(),
    });
  }

  sourceEdit(sourceSessionId: string): Promise<SourceEditSession> {
    return readSourceEditSession(this.#projects.openRootPath(), sourceSessionId);
  }

  async commitSourceEdit(sourceSessionId: string, content: string): Promise<CommandExecutionReceipt> {
    const receipt = await commitSourceEdit(this.#projects.openRootPath(), sourceSessionId, {
      content: boundedText(content, "source content", 2_000_000, true),
      now: this.#now(),
      ...(this.#validateSource === undefined ? {} : { validateSource: this.#validateSource }),
      ...(this.#invalidateSourceCaches === undefined
        ? {}
        : { invalidateSourceCaches: this.#invalidateSourceCaches }),
    });
    if (receipt.status === "committed") await this.context();
    return receipt;
  }

  abortSourceEdit(sourceSessionId: string): Promise<boolean> {
    return abortSourceEdit(this.#projects.openRootPath(), sourceSessionId);
  }

  #selectionFor(projectId: string): EditorSelectionState {
    if (this.#selection?.projectId !== projectId) {
      this.#selection = {
        projectId,
        selectedIds: [],
        primaryId: null,
        anchorId: null,
        stateVersion: 1,
        updatedAt: this.#timestamp(),
      };
    }
    return this.#selection;
  }

  #selectionForSnapshot(
    snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
  ): EditorSelectionState {
    const current = this.#selectionFor(snapshot.project.projectId);
    const authoritative = snapshot.timeline.selection;
    if (authoritative === undefined || this.#selectionOverride) return current;
    const differs =
      current.primaryId !== authoritative.primaryId ||
      current.anchorId !== authoritative.anchorId ||
      current.selectedIds.length !== authoritative.selectedIds.length ||
      current.selectedIds.some((id, index) => id !== authoritative.selectedIds[index]);
    if (!differs) return current;
    this.#selection = {
      projectId: snapshot.project.projectId,
      selectedIds: authoritative.selectedIds,
      primaryId: authoritative.primaryId,
      anchorId: authoritative.anchorId,
      stateVersion: current.stateVersion + 1,
      updatedAt: this.#timestamp(),
    };
    return this.#selection;
  }

  async #readCaptureRecords(projectId: string): Promise<readonly CaptureRecord[]> {
    const directory = path.join(this.#projects.openRootPath(), "captures");
    let names: readonly string[];
    try {
      names = (await readdir(directory)).filter((name) => /^capture-.+\.json$/.test(name)).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    const records = await Promise.all(
      names.map(
        async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as CaptureRecord,
      ),
    );
    return records.filter((record) => record.projectId === projectId);
  }

  async #requireCapture(id: string, projectId: string): Promise<CaptureRecord> {
    const record = (await this.#readCaptureRecords(projectId)).find((candidate) => candidate.id === id);
    if (record === undefined) throw new Error(`Unknown capture ID: ${id}.`);
    return record;
  }

  async #requireAnnotation(id: string): Promise<AnnotationRecord> {
    const snapshot = await this.#projects.snapshot();
    const annotation = (snapshot.timeline.annotations ?? []).find((candidate) => candidate.id === id);
    if (annotation === undefined) throw new Error(`Unknown annotation ID: ${id}.`);
    return annotation;
  }

  async #readCaptureViewDocument<T>(name: string, projectId: string): Promise<readonly T[]> {
    try {
      const parsed = JSON.parse(
        await readFile(path.join(this.#projects.openRootPath(), "captures", name), "utf8"),
      ) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Capture view document ${name} is invalid for the open project.`);
      }
      const document = parsed as Record<string, unknown>;
      if (
        document.schemaVersion !== "1.0.0" ||
        document.projectId !== projectId ||
        !Array.isArray(document.records)
      ) {
        throw new Error(`Capture view document ${name} is invalid for the open project.`);
      }
      return document.records as readonly T[];
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  #writeCaptureViewDocument(name: string, projectId: string, records: readonly unknown[]): Promise<void> {
    return writeJsonAtomic(path.join(this.#projects.openRootPath(), "captures", name), {
      schemaVersion: "1.0.0",
      projectId,
      records,
    } satisfies CaptureViewDocument<unknown>);
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #emit(event: StudioInteractionEvent): void {
    for (const listener of this.#listeners) listener(structuredClone(event));
  }

  #queueContextRefresh(): void {
    if (this.#disposed) return;
    this.#contextRefresh = this.#contextRefresh.then(async () => {
      try {
        await this.context();
      } catch {
        // Project or preview may be between lifecycle states; the next stable event refreshes context.
      }
    });
  }
}

const entityMap = (
  snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
): Map<string, EditorContextEntity> => {
  const entities = new Map<string, EditorContextEntity>();
  entities.set(snapshot.project.projectId, {
    id: snapshot.project.projectId,
    kind: "project",
    summary: { title: snapshot.project.title },
  });
  entities.set(snapshot.timeline.timelineId, {
    id: snapshot.timeline.timelineId,
    kind: "timeline",
    summary: { durationFrames: snapshot.timeline.durationFrames, fps: snapshot.timeline.fps },
  });
  for (const asset of snapshot.assets.assets) {
    entities.set(asset.id, {
      id: asset.id,
      kind: "asset",
      summary: {
        path: asset.path,
        kind: asset.kind,
        contentHash: asset.contentHash,
        rights: asset.rights,
        validationState: asset.validationState,
      },
    });
  }
  for (const track of snapshot.timeline.tracks) {
    entities.set(track.id, {
      id: track.id,
      kind: "track",
      summary: { kind: track.kind, name: track.name, order: track.order, locked: track.locked },
    });
    for (const clip of track.clips) {
      entities.set(clip.id, {
        id: clip.id,
        kind: "clip",
        summary: {
          ...clip,
          trackId: track.id,
          sourcePath:
            clip.assetId === null
              ? null
              : (snapshot.assets.assets.find((asset) => asset.id === clip.assetId)?.path ?? null),
          props: clip.properties ?? {},
          variables: clip.metadata ?? {},
          effects: [],
          transitions: [],
        },
      });
    }
  }
  return entities;
};

const previewStatusOrDefault = async (
  preview: PreviewSessionService,
  _revisionId: string,
): Promise<
  Readonly<{
    state: Readonly<{
      sessionId: string;
      stateVersion: number;
      currentFrame: string;
      truthMode: "interactive-approximation" | "rendered-fidelity";
      quality: "draft" | "balanced" | "full";
    }>;
    synchronized: boolean;
  }>
> => {
  try {
    return await preview.status();
  } catch {
    return {
      state: {
        sessionId: "preview-none",
        stateVersion: 1,
        currentFrame: "0",
        truthMode: "interactive-approximation",
        quality: "draft",
      },
      synchronized: false,
    };
  }
};

const sourceFrame = (entity: EditorContextEntity, masterFrame: string): string => {
  if (entity.kind !== "clip") return masterFrame;
  const start = typeof entity.summary.startFrame === "string" ? BigInt(entity.summary.startFrame) : 0n;
  const sourceIn =
    typeof entity.summary.sourceInFrame === "string" ? BigInt(entity.summary.sourceInFrame) : 0n;
  const master = BigInt(masterFrame);
  return (master < start ? sourceIn : sourceIn + master - start).toString(10);
};

const frameToTimecode = (
  frameValue: string,
  fps: Readonly<{ numerator: string; denominator: string }>,
): string => {
  const frame = BigInt(frameValue);
  const numerator = BigInt(fps.numerator);
  const denominator = BigInt(fps.denominator);
  const nominal = (numerator + denominator / 2n) / denominator;
  const safeNominal = nominal > 0n ? nominal : 1n;
  const totalSeconds = frame / safeNominal;
  const frames = frame % safeNominal;
  const seconds = totalSeconds % 60n;
  const minutes = (totalSeconds / 60n) % 60n;
  const hours = totalSeconds / 3600n;
  return [hours, minutes, seconds, frames].map((part) => part.toString(10).padStart(2, "0")).join(":");
};

const recordSummary = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const recordArray = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Readonly<Record<string, unknown>> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    : [];

const contextEngine = (engines: ReadonlySet<string>): SelectionContextManifest["engine"] => {
  if (engines.size === 0) return "none";
  if (engines.size > 1) return "mixed";
  const engine = [...engines][0];
  return engine === "remotion" || engine === "hyperframes" || engine === "shared" ? engine : "none";
};

const nearbyClipEntities = (
  snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
  primary: EditorContextEntity | null,
): readonly EditorContextEntity[] => {
  if (primary?.kind !== "clip") return [];
  const clips = snapshot.timeline.tracks.flatMap((track) =>
    track.clips.map((clip) => ({ clip, trackId: track.id })),
  );
  const index = clips.findIndex(({ clip }) => clip.id === primary.id);
  if (index < 0) return [];
  return clips.slice(Math.max(0, index - 2), index + 3).map(({ clip, trackId }) => ({
    id: clip.id,
    kind: "clip" as const,
    summary: { ...clip, trackId },
  }));
};

const decodePng = (encoded: string): Buffer => {
  if (encoded.length === 0 || encoded.length > 24_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Capture imageBase64 is invalid or exceeds the bounded size limit.");
  }
  const bytes = Buffer.from(encoded, "base64");
  assertPngBytes(bytes);
  return bytes;
};

const assertPngBytes = (bytes: Uint8Array): void => {
  if (bytes.length === 0 || bytes.length > 16_777_216) throw new Error("Capture PNG exceeds 16 MiB.");
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.from(bytes.subarray(0, pngSignature.length)).equals(pngSignature)) {
    throw new Error("Capture bytes are not a PNG image.");
  }
};

const assertFrameInTimeline = (frame: string, durationFrames: string): void => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(frame)) throw new Error("Annotation frame is invalid.");
  const duration = BigInt(durationFrames);
  if (duration === 0n || BigInt(frame) >= duration) throw new Error("Annotation frame is outside timeline.");
};

const boundedText = (value: string, field: string, maximum: number, allowEmpty = false): string => {
  if (value.length > maximum || (!allowEmpty && value.trim().length === 0) || value.includes("\0")) {
    throw new Error(`${field} is invalid or exceeds bounded limits.`);
  }
  return value;
};

const annotationCommand = (
  projectId: string,
  revisionId: string,
  actor: CommitActor,
  operation: unknown,
  affectedEntityIds: readonly string[],
  issuedAt: string,
): unknown => {
  const commandId = `command-${randomUUID()}`;
  return {
    schemaVersion: "1.0.0",
    commandId,
    idempotencyId: `idempotency-${randomUUID()}`,
    actor,
    projectId,
    correlationId: `correlation-${randomUUID()}`,
    issuedAt,
    capability: { name: "chai.bridge.annotation", version: "1.0.0" },
    payloadVersion: "1.0.0",
    affectedEntityIds: [...new Set(affectedEntityIds)],
    declaredScope: "mutation",
    validationOnly: false,
    baseRevisionId: revisionId,
    authorizationId: null,
    kind: "annotation.edit",
    payload: { operation },
  };
};

const assertCommitted = (receipt: CommandExecutionReceipt): void => {
  if (receipt.status !== "committed") {
    throw new Error(receipt.error?.message ?? "Annotation command was not committed.");
  }
};

const writeBytesAtomic = async (target: string, bytes: Uint8Array): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
};

const writeJsonAtomic = (target: string, value: unknown): Promise<void> =>
  writeBytesAtomic(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
