import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  startStudioServer,
  type ApiSuccessEnvelope,
  type ReviewWorkspaceSnapshot,
  type StartedStudioServer,
} from "../../apps/studio-server/src/index.js";
import type { LoadedProjectRevision } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];
const startedServers: StartedStudioServer[] = [];
const actor = { id: "actor-review-api-0001", kind: "user" as const, sessionId: "session-review-api-0001" };
const at = "2026-07-16T11:00:00.000Z";

afterEach(async () => {
  await Promise.all(startedServers.splice(0).map((started) => started.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P19 review HTTP API", () => {
  it("persists bundles, issues, exact A/B, decisions, exceptions, undo/redo, and audit records", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-review-api-"));
    temporaryDirectories.push(parent);
    const started = await startStudioServer({
      preferredPort: 0,
      runtimeDirectory: path.join(parent, "runtime"),
    });
    startedServers.push(started);
    const request = requestFor(started);
    const projectPath = path.join(parent, "Review API.chai");
    expect(
      (
        await request("/api/v1/projects/create", {
          method: "POST",
          body: JSON.stringify({ targetPath: projectPath, title: "Review API" }),
        })
      ).status,
    ).toBe(201);

    let snapshot = await projectSnapshot(request);
    expect(
      (
        await request("/api/v1/commands", {
          method: "POST",
          body: JSON.stringify(durationCommand(snapshot)),
        })
      ).status,
    ).toBe(200);
    snapshot = await projectSnapshot(request);
    expect(snapshot.timeline.durationFrames).toBe("240");
    const reviewTargetRevision = snapshot.pointer.revisionId;

    let workspace = await reviewOperation(request, {
      kind: "review.bundle.create",
      bundle: {
        schemaVersion: "1.0.0",
        id: "bundle-review-api-0001",
        projectId: snapshot.project.projectId,
        targetRevisionId: reviewTargetRevision,
        title: "Opening review",
        origin: "selection",
        selectedEntityIds: [snapshot.timeline.timelineId],
        markerIds: [],
        phraseIds: [],
        frames: ["12"],
        ranges: [{ startFrame: "12", endFrameExclusive: "48" }],
        captureIds: [],
        annotationIds: [],
        issueIds: [],
        author: actor,
        status: "draft",
        requestedDecision: "feedback",
        createdAt: at,
        updatedAt: at,
      },
    });
    expect(workspace.state.bundles).toHaveLength(1);

    workspace = await reviewOperation(request, {
      kind: "review.issue.create",
      issue: {
        id: "issue-review-api-0001",
        bundleId: "bundle-review-api-0001",
        title: "Opening cadence",
        body: "The beat lands late in the exact selected range.",
        category: "sync",
        severity: "warning",
        status: "open",
        entityIds: [snapshot.timeline.timelineId],
        frameRange: { startFrame: "12", endFrameExclusive: "48" },
        annotationIds: [],
        transitions: [],
        createdAt: at,
        updatedAt: at,
      },
    });
    expect(workspace.state.bundles[0]?.issueIds).toEqual(["issue-review-api-0001"]);

    workspace = await transitionIssue(request, workspace, "open", "acknowledged", "Editor acknowledged.");
    workspace = await transitionIssue(
      request,
      workspace,
      "acknowledged",
      "fixed-unverified",
      "Candidate fix rendered.",
    );
    workspace = await transitionIssue(
      request,
      workspace,
      "fixed-unverified",
      "resolved",
      "Verified at frames 12 through 47.",
    );
    workspace = await transitionIssue(
      request,
      workspace,
      "resolved",
      "acknowledged",
      "Reopened after the linked comparison exposed a regression.",
    );
    expect(workspace.state.issues[0]).toMatchObject({ status: "acknowledged", transitions: { length: 4 } });

    const rightRevisionId = workspace.revisionId;
    workspace = await reviewOperation(request, {
      kind: "review.comparison.create",
      comparison: {
        id: "comparison-review-api-0001",
        leftRevisionId: reviewTargetRevision,
        rightRevisionId,
        timelineId: snapshot.timeline.timelineId,
        frameRange: { startFrame: "12", endFrameExclusive: "48" },
        mode: "difference",
        linkedNavigation: true,
        split: 0.5,
        captureIds: [],
        createdAt: at,
      },
    });
    expect(workspace.state.comparisons[0]).toMatchObject({
      mode: "difference",
      linkedNavigation: true,
      leftRevisionId: reviewTargetRevision,
      rightRevisionId,
    });

    await reviewOperation(request, {
      kind: "review.request.create",
      request: {
        id: "request-review-api-0001",
        bundleId: "bundle-review-api-0001",
        requestedBy: actor,
        requestedDecision: "feedback",
        targetRevisionId: reviewTargetRevision,
        requiredQaState: null,
        status: "open",
        createdAt: at,
        updatedAt: at,
      },
    });
    workspace = await reviewOperation(request, {
      kind: "review.action.record",
      action: {
        id: "action-review-api-0001",
        requestId: "request-review-api-0001",
        actor,
        decision: "recommended-approval",
        comment: "Recommendation only; QA authority remains separate.",
        evidenceHashes: ["a".repeat(64)],
        revisionId: reviewTargetRevision,
        lifecycleEffect: "none",
        qaTransitionId: null,
        createdAt: at,
      },
    });
    expect(workspace.qaState).toBeNull();
    expect(workspace.state.actions[0]).toMatchObject({ lifecycleEffect: "none", qaTransitionId: null });

    snapshot = await projectSnapshot(request);
    expect(
      (
        await request("/api/v1/commands", {
          method: "POST",
          body: JSON.stringify(historyCommand(snapshot, "undo")),
        })
      ).status,
    ).toBe(200);
    workspace = await reviewWorkspace(request);
    expect(workspace.state.actions).toHaveLength(0);
    expect(workspace.state.requests[0]?.status).toBe("open");
    snapshot = await projectSnapshot(request);
    expect(
      (
        await request("/api/v1/commands", {
          method: "POST",
          body: JSON.stringify(historyCommand(snapshot, "redo")),
        })
      ).status,
    ).toBe(200);
    workspace = await reviewWorkspace(request);
    expect(workspace.state.actions).toHaveLength(1);

    await reviewOperation(request, {
      kind: "review.issue.transition",
      issueId: "issue-review-api-0001",
      transition: {
        from: "acknowledged",
        to: "accepted-exception",
        actor,
        revisionId: workspace.revisionId,
        evidenceHashes: ["b".repeat(64)],
        comment: "Accepted for this frame range only.",
        at,
      },
    });
    workspace = await reviewOperation(request, {
      kind: "review.exception.accept",
      exception: {
        id: "exception-review-api-0001",
        issueId: "issue-review-api-0001",
        scope: {
          kind: "frame-range",
          entityIds: [],
          frameRange: { startFrame: "12", endFrameExclusive: "48" },
          qaCodes: [],
          outputId: null,
        },
        reason: "The late cadence is an intentional creative choice.",
        evidenceHashes: ["c".repeat(64)],
        approver: actor,
        acceptedAt: at,
        expiresAt: "2026-08-16T11:00:00.000Z",
        reviewAt: "2026-08-01T11:00:00.000Z",
        active: true,
      },
    });
    expect(workspace.state.exceptions).toMatchObject([{ id: "exception-review-api-0001", active: true }]);
    expect(workspace.auditTrail.length).toBeGreaterThanOrEqual(10);

    snapshot = await projectSnapshot(request);
    const named = await request("/api/v1/commands", {
      method: "POST",
      body: JSON.stringify(versionCommand(snapshot)),
    });
    expect(named.status).toBe(200);
    expect((await request("/api/v1/projects/current/named-versions")).status).toBe(200);
  });
});

const transitionIssue = async (
  request: ReturnType<typeof requestFor>,
  workspace: ReviewWorkspaceSnapshot,
  from: string,
  to: string,
  comment: string,
): Promise<ReviewWorkspaceSnapshot> =>
  reviewOperation(request, {
    kind: "review.issue.transition",
    issueId: "issue-review-api-0001",
    transition: {
      from,
      to,
      actor,
      revisionId: workspace.revisionId,
      evidenceHashes: ["d".repeat(64)],
      comment,
      at,
    },
  });

const reviewOperation = async (
  request: ReturnType<typeof requestFor>,
  operation: Readonly<Record<string, unknown>>,
): Promise<ReviewWorkspaceSnapshot> => {
  const response = await request("/api/v1/review/operations", {
    method: "POST",
    body: JSON.stringify({ actor, operation }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as ApiSuccessEnvelope<{ workspace: ReviewWorkspaceSnapshot }>).data
    .workspace;
};

const reviewWorkspace = async (request: ReturnType<typeof requestFor>): Promise<ReviewWorkspaceSnapshot> =>
  ((await (await request("/api/v1/review/workspace")).json()) as ApiSuccessEnvelope<ReviewWorkspaceSnapshot>)
    .data;

const projectSnapshot = async (request: ReturnType<typeof requestFor>): Promise<LoadedProjectRevision> =>
  (
    (await (
      await request("/api/v1/projects/current/snapshot")
    ).json()) as ApiSuccessEnvelope<LoadedProjectRevision>
  ).data;

const durationCommand = (snapshot: LoadedProjectRevision) =>
  command(
    snapshot,
    "timeline.replace",
    {
      timeline: { ...snapshot.timeline, durationFrames: "240" },
    },
    "destructive",
    `authorization-review-${crypto.randomUUID()}`,
  );

const historyCommand = (snapshot: LoadedProjectRevision, direction: "undo" | "redo") =>
  command(snapshot, `history.${direction}`, { steps: 1 }, "mutation", null);

const versionCommand = (snapshot: LoadedProjectRevision) =>
  command(snapshot, "version.create", { name: "Review", outputId: null }, "mutation", null);

const command = (
  snapshot: LoadedProjectRevision,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
  declaredScope: "mutation" | "destructive",
  authorizationId: string | null,
) => {
  const nonce = crypto.randomUUID();
  return {
    schemaVersion: "1.0.0",
    commandId: `command-review-test-${nonce}`,
    idempotencyId: `idempotency-review-test-${nonce}`,
    actor,
    projectId: snapshot.project.projectId,
    correlationId: `correlation-review-test-${nonce}`,
    issuedAt: new Date().toISOString(),
    capability: { name: "review-test", version: "1.0.0" },
    payloadVersion: "1.0.0",
    affectedEntityIds: [],
    declaredScope,
    validationOnly: false,
    baseRevisionId: snapshot.pointer.revisionId,
    authorizationId,
    kind,
    payload,
  };
};

const requestFor =
  (started: StartedStudioServer) =>
  (endpoint: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${started.sessionToken}`);
    headers.set("x-chai-csrf-token", started.sessionToken);
    headers.set("content-type", "application/json");
    headers.set("origin", started.report.origins[0] ?? `http://127.0.0.1:${started.report.port.toString()}`);
    return fetch(`http://127.0.0.1:${started.report.port.toString()}${endpoint}`, { ...init, headers });
  };
