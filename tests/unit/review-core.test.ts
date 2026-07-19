import { describe, expect, it } from "vitest";
import {
  buildVersionStacks,
  executeReviewDocumentEdit,
  type ReviewOperation,
} from "../../packages/review/src/index.js";
import { serializeBigInt } from "../../packages/schema/src/index.js";
import type {
  AcceptedExceptionDocument,
  AlternateTakeDocument,
  NamedVersionsDocument,
  ReviewActionDocument,
  ReviewBundleDocument,
  ReviewComparisonDocument,
  ReviewIssueDocument,
  ReviewIssueTransition,
  ReviewRequestDocument,
  TimelineDocument,
} from "../../packages/schema/src/index.js";

const actor = { id: "actor-review-0001", kind: "user" as const, sessionId: "session-review-0001" };
const at = "2026-07-16T10:00:00.000Z";

describe("P19 authoritative review documents", () => {
  it("preserves issue evidence across acknowledge, fix, resolve, and reopen", () => {
    let timeline = baseTimeline();
    timeline = apply(timeline, { kind: "review.bundle.create", bundle: bundle() }, "revision-review-0001");
    timeline = apply(timeline, { kind: "review.issue.create", issue: issue() }, "revision-review-0002");

    for (const issueTransition of [
      transition("open", "acknowledged", "revision-review-0002", "Acknowledged by editor."),
      transition("acknowledged", "fixed-unverified", "revision-review-0003", "Fix rendered for review."),
      transition("fixed-unverified", "resolved", "revision-review-0004", "Verified on the exact range."),
      transition("resolved", "acknowledged", "revision-review-0005", "Reopened after regression."),
    ]) {
      timeline = apply(
        timeline,
        { kind: "review.issue.transition", issueId: "issue-review-0001", transition: issueTransition },
        `${issueTransition.revisionId}-next`,
      );
    }

    expect(timeline.reviewState?.issues[0]).toMatchObject({
      status: "acknowledged",
      transitions: [
        { from: "open", to: "acknowledged" },
        { from: "acknowledged", to: "fixed-unverified" },
        { from: "fixed-unverified", to: "resolved" },
        { from: "resolved", to: "acknowledged", comment: "Reopened after regression." },
      ],
    });
    expect(timeline.reviewState?.issues[0]?.transitions.every((entry) => entry.actor.id === actor.id)).toBe(
      true,
    );
  });

  it("records exact comparisons, non-lifecycle review decisions, and scoped exceptions", () => {
    let timeline = baseTimeline();
    timeline = apply(timeline, { kind: "review.bundle.create", bundle: bundle() }, "revision-review-1001");
    timeline = apply(timeline, { kind: "review.issue.create", issue: issue() }, "revision-review-1002");
    timeline = apply(
      timeline,
      {
        kind: "review.comparison.create",
        comparison: comparison(),
      },
      "revision-review-1003",
    );
    const request: ReviewRequestDocument = {
      id: "request-review-0001",
      bundleId: "bundle-review-0001",
      requestedBy: actor,
      requestedDecision: "feedback",
      targetRevisionId: "revision-base-0001",
      requiredQaState: null,
      status: "open",
      createdAt: at,
      updatedAt: at,
    };
    timeline = apply(timeline, { kind: "review.request.create", request }, "revision-review-1004");
    const action: ReviewActionDocument = {
      id: "action-review-0001",
      requestId: request.id,
      actor,
      decision: "recommended-approval",
      comment: "The candidate is ready for the separate QA authority.",
      evidenceHashes: ["a".repeat(64)],
      revisionId: request.targetRevisionId,
      lifecycleEffect: "none",
      qaTransitionId: null,
      createdAt: at,
    };
    timeline = apply(timeline, { kind: "review.action.record", action }, "revision-review-1005");
    timeline = apply(
      timeline,
      {
        kind: "review.issue.transition",
        issueId: "issue-review-0001",
        transition: transition("open", "accepted-exception", "revision-review-1005", "Accepted narrowly."),
      },
      "revision-review-1006",
    );
    const exception: AcceptedExceptionDocument = {
      id: "exception-review-0001",
      issueId: "issue-review-0001",
      scope: {
        kind: "frame-range",
        entityIds: [],
        frameRange: { startFrame: serializeBigInt(24n), endFrameExclusive: serializeBigInt(48n) },
        qaCodes: [],
        outputId: null,
      },
      reason: "The creative hold is intentional in this exact range.",
      evidenceHashes: ["b".repeat(64)],
      approver: actor,
      acceptedAt: at,
      expiresAt: "2026-08-16T10:00:00.000Z",
      reviewAt: "2026-08-01T10:00:00.000Z",
      active: true,
    };
    timeline = apply(timeline, { kind: "review.exception.accept", exception }, "revision-review-1007");

    expect(timeline.reviewState).toMatchObject({
      comparisons: [{ linkedNavigation: true, frameRange: { startFrame: "24", endFrameExclusive: "72" } }],
      requests: [{ status: "acted" }],
      actions: [{ lifecycleEffect: "none", qaTransitionId: null }],
      exceptions: [{ scope: { kind: "frame-range" }, active: true }],
    });
  });

  it("keeps one active alternate take per stack without duplicating media", () => {
    let timeline = baseTimeline();
    const first = take("take-review-0001", "revision-base-0001", true);
    const second = take("take-review-0002", "revision-base-0002", true);
    timeline = apply(timeline, { kind: "review.take.add", take: first }, "revision-review-2001");
    timeline = apply(timeline, { kind: "review.take.add", take: second }, "revision-review-2002");
    expect(timeline.reviewState?.alternateTakes).toMatchObject([
      { id: first.id, active: false, clipIds: ["clip-review-0001"], sourceIds: ["asset-review-0001"] },
      { id: second.id, active: true, clipIds: ["clip-review-0001"], sourceIds: ["asset-review-0001"] },
    ]);
    const namedVersions: NamedVersionsDocument = {
      schemaVersion: "1.0.0",
      projectId: "project-review-0001",
      versions: [],
    };
    expect(buildVersionStacks(namedVersions, timeline.reviewState?.alternateTakes ?? [])).toMatchObject([
      { stackId: "stack-review-0001", takes: [{ id: first.id }, { id: second.id }] },
    ]);
  });

  it("rejects approximate, mismatched, or evidence-free review claims", () => {
    expect(() =>
      apply(
        baseTimeline(),
        { kind: "review.bundle.create", bundle: { ...bundle(), selectedEntityIds: [] } },
        "revision-review-bad-0001",
      ),
    ).toThrow(/no exact evidence/);
    expect(() =>
      apply(
        baseTimeline(),
        {
          kind: "review.comparison.create",
          comparison: { ...comparison(), rightRevisionId: "revision-base-0001" },
        },
        "revision-review-bad-0002",
      ),
    ).toThrow(/must differ/);
    expect(() =>
      apply(
        baseTimeline(),
        {
          kind: "review.take.activate",
          stackId: "stack-review-0001",
          takeId: "take-review-missing",
        },
        "revision-review-bad-0003",
      ),
    ).toThrow(/Unknown alternate take/);
  });
});

const apply = (timeline: TimelineDocument, operation: ReviewOperation, revision: string) =>
  executeReviewDocumentEdit(timeline, operation, revision).timeline;

const baseTimeline = (): TimelineDocument => ({
  schemaVersion: "1.0.0",
  projectId: "project-review-0001",
  revisionId: "revision-base-0001",
  timelineId: "timeline-review-0001",
  fps: { numerator: serializeBigInt(24n), denominator: serializeBigInt(1n) },
  durationFrames: serializeBigInt(240n),
  tracks: [],
  audioBusIds: [],
  approvalReferenceIds: [],
});

const bundle = (): ReviewBundleDocument => ({
  schemaVersion: "1.0.0",
  id: "bundle-review-0001",
  projectId: "project-review-0001",
  targetRevisionId: "revision-base-0001",
  title: "Opening rhythm",
  origin: "selection",
  selectedEntityIds: ["timeline-review-0001"],
  markerIds: [],
  phraseIds: [],
  frames: [serializeBigInt(24n)],
  ranges: [{ startFrame: serializeBigInt(24n), endFrameExclusive: serializeBigInt(72n) }],
  captureIds: [],
  annotationIds: [],
  issueIds: [],
  author: actor,
  status: "draft",
  requestedDecision: "feedback",
  createdAt: at,
  updatedAt: at,
});

const issue = (): ReviewIssueDocument => ({
  id: "issue-review-0001",
  bundleId: "bundle-review-0001",
  title: "Opening beat feels late",
  body: "Review the exact selected range.",
  category: "sync",
  severity: "warning",
  status: "open",
  entityIds: ["timeline-review-0001"],
  frameRange: { startFrame: serializeBigInt(24n), endFrameExclusive: serializeBigInt(72n) },
  annotationIds: [],
  transitions: [],
  createdAt: at,
  updatedAt: at,
});

const transition = (
  from: ReviewIssueTransition["from"],
  to: ReviewIssueTransition["to"],
  revisionId: string,
  comment: string,
): ReviewIssueTransition => ({
  from,
  to,
  actor,
  revisionId,
  evidenceHashes: ["c".repeat(64)],
  comment,
  at,
});

const comparison = (): ReviewComparisonDocument => ({
  id: "comparison-review-0001",
  leftRevisionId: "revision-base-0001",
  rightRevisionId: "revision-base-0002",
  timelineId: "timeline-review-0001",
  frameRange: { startFrame: serializeBigInt(24n), endFrameExclusive: serializeBigInt(72n) },
  mode: "wipe",
  linkedNavigation: true,
  split: 0.5,
  captureIds: [],
  createdAt: at,
});

const take = (id: string, revisionId: string, active: boolean): AlternateTakeDocument => ({
  id,
  stackId: "stack-review-0001",
  label: id.endsWith("1") ? "Original" : "Tighter alt",
  revisionId,
  clipIds: ["clip-review-0001"],
  sourceIds: ["asset-review-0001"],
  active,
  createdAt: at,
});
