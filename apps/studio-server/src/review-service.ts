import { randomUUID } from "node:crypto";
import { emptyReviewState, executeReviewDocumentEdit } from "@chai-studio/review";
import { loadProjectRevision } from "@chai-studio/schema";
import type {
  CommandExecutionReceipt,
  JsonValue,
  QaState,
  ReviewActor,
  ReviewStateDocument,
} from "@chai-studio/schema";
import type { ProjectRevisionHistoryItem, ProjectSessionService } from "./project-service.js";

export interface ReviewWorkspaceSnapshot {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly durationFrames: string;
  readonly qaState: QaState | null;
  readonly state: ReviewStateDocument;
  readonly auditTrail: readonly ProjectRevisionHistoryItem[];
}

export class ReviewApiService {
  readonly #projects: ProjectSessionService;
  readonly #now: () => Date;

  constructor(input: { readonly projects: ProjectSessionService; readonly now?: () => Date }) {
    this.#projects = input.projects;
    this.#now = input.now ?? (() => new Date());
  }

  async workspace(): Promise<ReviewWorkspaceSnapshot> {
    const snapshot = await this.#projects.snapshot();
    const auditTrail = (await this.#projects.revisionHistory()).filter(
      (entry) =>
        entry.commandSummary.toLocaleLowerCase("en").includes("review") ||
        entry.commandSummary.toLocaleLowerCase("en").includes("exception") ||
        entry.commandSummary.toLocaleLowerCase("en").includes("alternate take"),
    );
    return {
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      timelineId: snapshot.timeline.timelineId,
      durationFrames: snapshot.timeline.durationFrames,
      qaState: snapshot.approvalState.state,
      state: snapshot.timeline.reviewState ?? emptyReviewState(),
      auditTrail,
    };
  }

  async apply(input: {
    readonly actor: ReviewActor;
    readonly operation: JsonValue;
  }): Promise<Readonly<{ receipt: CommandExecutionReceipt; workspace: ReviewWorkspaceSnapshot }>> {
    const snapshot = await this.#projects.snapshot();
    await this.#validateRevisionReferences(input.operation);
    const plannedRevisionId = `revision-review-${randomUUID()}`;
    const preview = executeReviewDocumentEdit(snapshot.timeline, input.operation, plannedRevisionId);
    const issuedAt = this.#now().toISOString();
    const receipt = await this.#projects.executeCommand(
      {
        schemaVersion: "1.0.0",
        commandId: `command-review-${randomUUID()}`,
        idempotencyId: `idempotency-review-${randomUUID()}`,
        actor: input.actor,
        projectId: snapshot.project.projectId,
        correlationId: `correlation-review-${randomUUID()}`,
        issuedAt,
        capability: { name: "chai-studio.review", version: "1.0.0" },
        payloadVersion: "1.0.0",
        affectedEntityIds: preview.affectedEntityIds,
        declaredScope: "mutation",
        validationOnly: false,
        baseRevisionId: snapshot.pointer.revisionId,
        authorizationId: null,
        kind: "review.edit",
        payload: { operation: input.operation },
      },
      { revisionId: plannedRevisionId },
    );
    if (receipt.status !== "committed") {
      throw new Error(receipt.error?.message ?? "Review edit did not commit.");
    }
    return { receipt, workspace: await this.workspace() };
  }

  async #validateRevisionReferences(operation: JsonValue): Promise<void> {
    if (!isRecord(operation) || typeof operation.kind !== "string") return;
    const root = this.#projects.openRootPath();
    if (operation.kind === "review.bundle.create" && isRecord(operation.bundle)) {
      await loadProjectRevision(
        root,
        requiredString(operation.bundle.targetRevisionId, "bundle target revision"),
      );
    }
    if (operation.kind === "review.request.create" && isRecord(operation.request)) {
      await loadProjectRevision(
        root,
        requiredString(operation.request.targetRevisionId, "request target revision"),
      );
    }
    if (operation.kind === "review.action.record" && isRecord(operation.action)) {
      await loadProjectRevision(root, requiredString(operation.action.revisionId, "action revision"));
    }
    if (operation.kind === "review.take.add" && isRecord(operation.take)) {
      const revision = await loadProjectRevision(
        root,
        requiredString(operation.take.revisionId, "alternate take revision"),
      );
      const clipIds = requiredStringArray(operation.take.clipIds, "alternate take clip IDs");
      const sourceIds = requiredStringArray(operation.take.sourceIds, "alternate take source IDs");
      const knownClips = new Set(
        revision.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
      );
      const knownSources = new Set(revision.assets.assets.map((asset) => asset.id));
      for (const id of clipIds)
        if (!knownClips.has(id)) throw new Error(`Unknown alternate take clip: ${id}.`);
      for (const id of sourceIds)
        if (!knownSources.has(id)) throw new Error(`Unknown alternate take source: ${id}.`);
    }
    if (operation.kind === "review.comparison.create" && isRecord(operation.comparison)) {
      const left = await loadProjectRevision(
        root,
        requiredString(operation.comparison.leftRevisionId, "left comparison revision"),
      );
      const right = await loadProjectRevision(
        root,
        requiredString(operation.comparison.rightRevisionId, "right comparison revision"),
      );
      const timelineId = requiredString(operation.comparison.timelineId, "comparison timeline");
      if (left.timeline.timelineId !== timelineId || right.timeline.timelineId !== timelineId) {
        throw new Error("A/B revisions do not share the requested exact timeline identity.");
      }
      if (
        left.timeline.fps.numerator !== right.timeline.fps.numerator ||
        left.timeline.fps.denominator !== right.timeline.fps.denominator
      ) {
        throw new Error("A/B revisions do not share the exact frame clock.");
      }
      if (!isRecord(operation.comparison.frameRange)) throw new Error("Comparison frame range is invalid.");
      const end = BigInt(
        requiredString(operation.comparison.frameRange.endFrameExclusive, "comparison end frame"),
      );
      if (end > BigInt(left.timeline.durationFrames) || end > BigInt(right.timeline.durationFrames)) {
        throw new Error("A/B comparison range is not present in both exact revisions.");
      }
    }
  }
}

const isRecord = (value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requiredString = (value: JsonValue | undefined, label: string): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid.`);
  return value;
};

const requiredStringArray = (value: JsonValue | undefined, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} are invalid.`);
  }
  return value as readonly string[];
};
