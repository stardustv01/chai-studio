import type {
  AcceptedExceptionDocument,
  AlternateTakeDocument,
  JsonValue,
  NamedVersionsDocument,
  ReviewActionDocument,
  ReviewBundleDocument,
  ReviewComparisonDocument,
  ReviewIssueDocument,
  ReviewRequestDocument,
  ReviewStateDocument,
  TimelineDocument,
} from "@chai-studio/schema";

export type ReviewOperation =
  | Readonly<{ kind: "review.bundle.create"; bundle: ReviewBundleDocument }>
  | Readonly<{ kind: "review.bundle.delete"; bundleId: string }>
  | Readonly<{ kind: "review.issue.create"; issue: ReviewIssueDocument }>
  | Readonly<{
      kind: "review.issue.transition";
      issueId: string;
      transition: ReviewIssueDocument["transitions"][number];
    }>
  | Readonly<{ kind: "review.comparison.create"; comparison: ReviewComparisonDocument }>
  | Readonly<{ kind: "review.request.create"; request: ReviewRequestDocument }>
  | Readonly<{ kind: "review.action.record"; action: ReviewActionDocument }>
  | Readonly<{ kind: "review.exception.accept"; exception: AcceptedExceptionDocument }>
  | Readonly<{ kind: "review.take.add"; take: AlternateTakeDocument }>
  | Readonly<{ kind: "review.take.activate"; stackId: string; takeId: string }>;

export interface ReviewEditResult {
  readonly timeline: TimelineDocument;
  readonly label: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly string[];
  readonly warnings: readonly string[];
}

export const emptyReviewState = (): ReviewStateDocument => ({
  schemaVersion: "1.0.0",
  bundles: [],
  issues: [],
  comparisons: [],
  requests: [],
  actions: [],
  exceptions: [],
  alternateTakes: [],
});

export const executeReviewDocumentEdit = (
  timeline: TimelineDocument,
  operationValue: JsonValue | ReviewOperation,
  revisionId: string,
): ReviewEditResult => {
  const operation = assertReviewOperation(operationValue);
  const state = timeline.reviewState ?? emptyReviewState();
  switch (operation.kind) {
    case "review.bundle.create": {
      assertUnique(state.bundles, operation.bundle.id, "review bundle");
      assertReviewBundle(operation.bundle, timeline);
      return result(
        timeline,
        revisionId,
        { ...state, bundles: [...state.bundles, operation.bundle] },
        "Create review bundle",
        `Created ${operation.bundle.origin} review bundle ${operation.bundle.id}.`,
        [operation.bundle.id, ...operation.bundle.selectedEntityIds],
      );
    }
    case "review.bundle.delete": {
      const bundle = requireById(state.bundles, operation.bundleId, "review bundle");
      if (state.issues.some((issue) => issue.bundleId === bundle.id)) {
        throw new Error("Review bundle with issue history cannot be deleted; close it instead.");
      }
      return result(
        timeline,
        revisionId,
        { ...state, bundles: state.bundles.filter((candidate) => candidate.id !== bundle.id) },
        "Delete draft review bundle",
        `Deleted empty review bundle ${bundle.id}.`,
        [bundle.id],
      );
    }
    case "review.issue.create": {
      assertUnique(state.issues, operation.issue.id, "review issue");
      requireById(state.bundles, operation.issue.bundleId, "review bundle");
      assertIssue(operation.issue, timeline);
      return result(
        timeline,
        revisionId,
        {
          ...state,
          issues: [...state.issues, operation.issue],
          bundles: state.bundles.map((bundle) =>
            bundle.id === operation.issue.bundleId
              ? {
                  ...bundle,
                  issueIds: [...bundle.issueIds, operation.issue.id],
                  updatedAt: operation.issue.updatedAt,
                }
              : bundle,
          ),
        },
        "Create review issue",
        `Created ${operation.issue.severity} review issue ${operation.issue.id}.`,
        [operation.issue.id, operation.issue.bundleId, ...operation.issue.entityIds],
      );
    }
    case "review.issue.transition": {
      const issue = requireById(state.issues, operation.issueId, "review issue");
      assertIssueTransition(issue, operation.transition);
      const updated = {
        ...issue,
        status: operation.transition.to,
        transitions: [...issue.transitions, operation.transition],
        updatedAt: operation.transition.at,
      };
      return result(
        timeline,
        revisionId,
        {
          ...state,
          issues: state.issues.map((candidate) => (candidate.id === issue.id ? updated : candidate)),
        },
        "Transition review issue",
        `Transitioned ${issue.id} from ${issue.status} to ${updated.status}.`,
        [issue.id, issue.bundleId],
      );
    }
    case "review.comparison.create": {
      assertUnique(state.comparisons, operation.comparison.id, "review comparison");
      assertComparison(operation.comparison, timeline);
      return result(
        timeline,
        revisionId,
        { ...state, comparisons: [...state.comparisons, operation.comparison] },
        "Create exact A/B comparison",
        `Compared revisions ${operation.comparison.leftRevisionId} and ${operation.comparison.rightRevisionId}.`,
        [operation.comparison.id],
      );
    }
    case "review.request.create": {
      assertUnique(state.requests, operation.request.id, "review request");
      const bundle = requireById(state.bundles, operation.request.bundleId, "review bundle");
      if (operation.request.targetRevisionId !== bundle.targetRevisionId)
        throw new Error("Review request must target the bundle's exact revision.");
      if (operation.request.requestedDecision !== bundle.requestedDecision)
        throw new Error("Review request decision must match the bundle.");
      return result(
        timeline,
        revisionId,
        { ...state, requests: [...state.requests, operation.request] },
        "Create review request",
        `Requested ${operation.request.requestedDecision} without changing lifecycle state.`,
        [operation.request.id, operation.request.bundleId],
      );
    }
    case "review.action.record": {
      assertUnique(state.actions, operation.action.id, "review action");
      const request = requireById(state.requests, operation.action.requestId, "review request");
      if (request.status !== "open") throw new Error("Review request is not open for an action.");
      if (operation.action.revisionId !== request.targetRevisionId)
        throw new Error("Review action must cite the requested revision.");
      const lifecycleClaim = operation.action as unknown as Readonly<{
        lifecycleEffect: unknown;
        qaTransitionId: unknown;
      }>;
      if (lifecycleClaim.lifecycleEffect !== "none" || lifecycleClaim.qaTransitionId !== null) {
        throw new Error("Review action cannot perform a QA lifecycle transition.");
      }
      return result(
        timeline,
        revisionId,
        {
          ...state,
          actions: [...state.actions, operation.action],
          requests: state.requests.map((candidate) =>
            candidate.id === request.id
              ? { ...candidate, status: "acted", updatedAt: operation.action.createdAt }
              : candidate,
          ),
        },
        "Record review action",
        `Recorded ${operation.action.decision}; lifecycle state remains unchanged.`,
        [operation.action.id, request.id],
      );
    }
    case "review.exception.accept": {
      assertUnique(state.exceptions, operation.exception.id, "accepted exception");
      const issue = requireById(state.issues, operation.exception.issueId, "review issue");
      if (issue.status !== "accepted-exception")
        throw new Error("Issue must transition to accepted-exception first.");
      assertException(operation.exception);
      return result(
        timeline,
        revisionId,
        { ...state, exceptions: [...state.exceptions, operation.exception] },
        "Record accepted exception",
        `Recorded scoped exception ${operation.exception.id}.`,
        [operation.exception.id, issue.id],
      );
    }
    case "review.take.add": {
      assertUnique(state.alternateTakes, operation.take.id, "alternate take");
      return result(
        timeline,
        revisionId,
        {
          ...state,
          alternateTakes: [
            ...state.alternateTakes.map((candidate) =>
              operation.take.active && candidate.stackId === operation.take.stackId
                ? { ...candidate, active: false }
                : candidate,
            ),
            operation.take,
          ],
        },
        "Add alternate take",
        `Added immutable revision ${operation.take.revisionId} to stack ${operation.take.stackId}.`,
        [operation.take.id, ...operation.take.clipIds, ...operation.take.sourceIds],
      );
    }
    case "review.take.activate": {
      const take = requireById(state.alternateTakes, operation.takeId, "alternate take");
      if (take.stackId !== operation.stackId)
        throw new Error("Alternate take does not belong to the requested stack.");
      return result(
        timeline,
        revisionId,
        {
          ...state,
          alternateTakes: state.alternateTakes.map((candidate) =>
            candidate.stackId === operation.stackId
              ? { ...candidate, active: candidate.id === take.id }
              : candidate,
          ),
        },
        "Activate alternate take",
        `Activated ${take.id} without duplicating media.`,
        [take.id, ...take.clipIds, ...take.sourceIds],
      );
    }
  }
};

export const buildVersionStacks = (
  versions: NamedVersionsDocument,
  takes: readonly AlternateTakeDocument[],
): readonly Readonly<{
  stackId: string;
  versions: NamedVersionsDocument["versions"];
  takes: readonly AlternateTakeDocument[];
}>[] => {
  const stackIds = [...new Set(takes.map((take) => take.stackId))].sort();
  return stackIds.map((stackId) => ({
    stackId,
    versions: versions.versions,
    takes: takes.filter((take) => take.stackId === stackId),
  }));
};

const assertReviewOperation = (value: JsonValue | ReviewOperation): ReviewOperation => {
  if (value === null || Array.isArray(value) || typeof value !== "object")
    throw new Error("Review operation is invalid.");
  const record = value as Readonly<Record<string, JsonValue>>;
  if (typeof record.kind !== "string" || !record.kind.startsWith("review.")) {
    throw new Error("Review operation is invalid.");
  }
  return record as unknown as ReviewOperation;
};

const assertReviewBundle = (bundle: ReviewBundleDocument, timeline: TimelineDocument): void => {
  if (bundle.projectId !== timeline.projectId) throw new Error("Review bundle project identity mismatch.");
  const originHasEvidence =
    (bundle.origin === "selection" && bundle.selectedEntityIds.length > 0) ||
    (bundle.origin === "marker" && bundle.markerIds.length > 0) ||
    (bundle.origin === "phrase" && bundle.phraseIds.length > 0) ||
    (bundle.origin === "capture" && bundle.captureIds.length > 0) ||
    (bundle.origin === "range" && bundle.ranges.length > 0) ||
    bundle.origin === "delivery-candidate";
  if (!originHasEvidence) throw new Error(`Review bundle origin ${bundle.origin} has no exact evidence.`);
  for (const frame of bundle.frames)
    if (BigInt(frame) >= BigInt(timeline.durationFrames))
      throw new Error("Review frame is outside the timeline.");
  for (const range of bundle.ranges) assertRange(range, timeline);
};

const assertIssue = (issue: ReviewIssueDocument, timeline: TimelineDocument): void => {
  if (issue.frameRange !== null) assertRange(issue.frameRange, timeline);
  if (issue.transitions.length !== 0 || issue.status !== "open")
    throw new Error("New review issue must begin open with no transitions.");
};

const transitions = new Set([
  "open->acknowledged",
  "acknowledged->fixed-unverified",
  "fixed-unverified->resolved",
  "resolved->acknowledged",
  "accepted-exception->acknowledged",
  "rejected->acknowledged",
  "open->accepted-exception",
  "acknowledged->accepted-exception",
  "open->rejected",
  "acknowledged->rejected",
  "fixed-unverified->acknowledged",
]);
const assertIssueTransition = (
  issue: ReviewIssueDocument,
  transition: ReviewIssueDocument["transitions"][number],
): void => {
  if (transition.from !== issue.status || !transitions.has(`${transition.from}->${transition.to}`))
    throw new Error(`Invalid review issue transition ${issue.status}->${transition.to}.`);
  if (transition.comment.trim().length === 0) throw new Error("Issue transition comment is required.");
};

const assertComparison = (comparison: ReviewComparisonDocument, timeline: TimelineDocument): void => {
  if (comparison.leftRevisionId === comparison.rightRevisionId) throw new Error("A/B revisions must differ.");
  if (comparison.timelineId !== timeline.timelineId)
    throw new Error("A/B comparison must use one linked timeline clock.");
  assertRange(comparison.frameRange, timeline);
};

const assertException = (exception: AcceptedExceptionDocument): void => {
  if (exception.reason.trim().length === 0 || exception.evidenceHashes.length === 0)
    throw new Error("Accepted exception requires reason and evidence.");
  if (exception.expiresAt !== null && Date.parse(exception.expiresAt) <= Date.parse(exception.acceptedAt))
    throw new Error("Accepted exception expiry must follow acceptance.");
  if (Date.parse(exception.reviewAt) < Date.parse(exception.acceptedAt))
    throw new Error("Accepted exception review date is invalid.");
  const scopeIsPopulated =
    (exception.scope.kind === "entity" && exception.scope.entityIds.length > 0) ||
    (exception.scope.kind === "frame-range" && exception.scope.frameRange !== null) ||
    (exception.scope.kind === "qa-code" && exception.scope.qaCodes.length > 0) ||
    (exception.scope.kind === "output" && exception.scope.outputId !== null);
  if (!scopeIsPopulated) throw new Error("Accepted exception scope is incomplete.");
};

const assertRange = (
  range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
  timeline: TimelineDocument,
): void => {
  if (
    BigInt(range.startFrame) >= BigInt(range.endFrameExclusive) ||
    BigInt(range.endFrameExclusive) > BigInt(timeline.durationFrames)
  )
    throw new Error("Review range is outside the exact timeline.");
};

const assertUnique = (records: readonly { id: string }[], id: string, label: string): void => {
  if (records.some((record) => record.id === id)) throw new Error(`${label} ${id} already exists.`);
};
const requireById = <T extends { id: string }>(records: readonly T[], id: string, label: string): T => {
  const record = records.find((candidate) => candidate.id === id);
  if (record === undefined) throw new Error(`Unknown ${label}: ${id}.`);
  return record;
};

const result = (
  timeline: TimelineDocument,
  revisionId: string,
  reviewState: ReviewStateDocument,
  label: string,
  diffSummary: string,
  affectedEntityIds: readonly string[],
): ReviewEditResult => ({
  timeline: { ...timeline, revisionId, reviewState },
  label,
  diffSummary,
  affectedEntityIds: [...new Set(affectedEntityIds)],
  warnings: [],
});
