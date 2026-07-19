import { useEffect, useMemo, useState } from "react";
import type { JsonValue, QaState, ReviewBundleDocument, ReviewStateDocument } from "@chai-studio/schema";
import { serializeBigInt } from "@chai-studio/schema/rational";
import { Badge, Button, TextField } from "@chai-studio/ui-components";
import { StudioApiClient } from "./api-client.js";
import { ChaiIcon } from "./chai-icon.js";
import type { StudioSnapshot } from "./types.js";

interface ReviewWorkspaceSnapshot {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly durationFrames: string;
  readonly qaState: QaState | null;
  readonly state: ReviewStateDocument;
  readonly auditTrail: readonly Readonly<{
    revisionId: string;
    commandSummary: string;
    diffSummary: string;
    timestamp: string;
  }>[];
}

const actor = { id: "actor-studio-user", kind: "user" as const, sessionId: "session-studio-desktop" };

export const ReviewNavigator = ({ snapshot }: { readonly snapshot: StudioSnapshot }) => {
  const [client] = useState(() => studioClient());
  const [workspace, setWorkspace] = useState(() => fallbackWorkspace(snapshot));
  const [status, setStatus] = useState(client.sessionToken === null ? "UI fixture" : "Loading authority");
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [issueDraft, setIssueDraft] = useState("");
  const canPersist = client.sessionToken !== null && snapshot.project !== null;

  const refresh = async (): Promise<void> => {
    if (!canPersist) {
      setWorkspace(fallbackWorkspace(snapshot));
      setStatus("UI fixture");
      return;
    }
    try {
      const latest = await client.request<ReviewWorkspaceSnapshot>("/api/v1/review/workspace", {
        method: "GET",
      });
      setWorkspace(latest);
      setStatus("Revision-bound");
    } catch {
      setStatus("Refresh required");
    }
  };

  useEffect(() => {
    void refresh();
  }, [snapshot.project?.revisionId]);

  const apply = async (operation: JsonValue): Promise<boolean> => {
    if (!canPersist) return false;
    setStatus("Committing review edit");
    try {
      const result = await client.request<{ readonly workspace: ReviewWorkspaceSnapshot }>(
        "/api/v1/review/operations",
        { method: "POST", body: JSON.stringify({ actor, operation }) },
      );
      setWorkspace(result.workspace);
      setStatus("Revision-bound");
      return true;
    } catch {
      setStatus("Review edit failed");
      return false;
    }
  };

  const activeBundle =
    workspace.state.bundles.find((bundle) => bundle.id === activeBundleId) ?? workspace.state.bundles[0];

  const createBundle = (): void => {
    if (snapshot.project === null) return;
    const selected = snapshot.timeline.selection.selectedIds;
    const duration = BigInt(snapshot.preview.durationFrames);
    const frame = BigInt(snapshot.preview.masterFrame);
    const inRange = duration > 0n && frame < duration;
    const now = new Date().toISOString();
    const id = `bundle-${crypto.randomUUID()}`;
    const bundle: ReviewBundleDocument = {
      schemaVersion: "1.0.0",
      id,
      projectId: snapshot.project.projectId,
      targetRevisionId: snapshot.project.revisionId,
      title: `Review at ${snapshot.preview.timecode}`,
      origin: selected.length > 0 ? "selection" : inRange ? "range" : "delivery-candidate",
      selectedEntityIds: selected,
      markerIds: [],
      phraseIds: [],
      frames: inRange ? [serializeBigInt(frame)] : [],
      ranges: inRange
        ? [{ startFrame: serializeBigInt(frame), endFrameExclusive: serializeBigInt(frame + 1n) }]
        : [],
      captureIds: [],
      annotationIds: [],
      issueIds: [],
      author: actor,
      status: "draft",
      requestedDecision: "feedback",
      createdAt: now,
      updatedAt: now,
    };
    void apply({ kind: "review.bundle.create", bundle } as unknown as JsonValue);
  };

  const createIssue = (): void => {
    const bundle = activeBundle;
    if (bundle === undefined || issueDraft.trim().length === 0) return;
    const now = new Date().toISOString();
    void (async () => {
      const committed = await apply({
        kind: "review.issue.create",
        issue: {
          id: `issue-${crypto.randomUUID()}`,
          bundleId: bundle.id,
          title: issueDraft.trim().slice(0, 120),
          body: issueDraft.trim(),
          category: "visual",
          severity: "warning",
          status: "open",
          entityIds: bundle.selectedEntityIds,
          frameRange: bundle.ranges[0] ?? null,
          annotationIds: bundle.annotationIds,
          transitions: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      if (committed) setIssueDraft("");
    })();
  };

  const requestFeedback = (): void => {
    const bundle = activeBundle;
    if (bundle === undefined) return;
    const now = new Date().toISOString();
    void apply({
      kind: "review.request.create",
      request: {
        id: `request-${crypto.randomUUID()}`,
        bundleId: bundle.id,
        requestedBy: actor,
        requestedDecision: bundle.requestedDecision,
        targetRevisionId: bundle.targetRevisionId,
        requiredQaState: null,
        status: "open",
        createdAt: now,
        updatedAt: now,
      },
    });
  };

  const recommendApproval = (): void => {
    const request = workspace.state.requests.find((candidate) => candidate.status === "open");
    if (request === undefined) return;
    void apply({
      kind: "review.action.record",
      action: {
        id: `action-${crypto.randomUUID()}`,
        requestId: request.id,
        actor,
        decision: "recommended-approval",
        comment: "Recommendation recorded. QA lifecycle authority remains separate.",
        evidenceHashes: [],
        revisionId: request.targetRevisionId,
        lifecycleEffect: "none",
        qaTransitionId: null,
        createdAt: new Date().toISOString(),
      },
    });
  };

  const openIssues = workspace.state.issues.filter(
    (issue) => !["resolved", "accepted-exception", "rejected"].includes(issue.status),
  );
  const openRequest = workspace.state.requests.find((request) => request.status === "open");

  return (
    <div className="review-navigator" aria-label="Authoritative review desk">
      <div className="review-navigator__header">
        <div>
          <strong>Review desk</strong>
          <small>
            {shortRevision(workspace.revisionId)} · {status}
          </small>
        </div>
        <Badge tone={workspace.qaState === "approved" ? "ready" : "attention"}>
          {workspace.qaState === null ? "QA not evaluated" : workspace.qaState.replaceAll("_", " ")}
        </Badge>
      </div>
      <Button variant="primary" disabled={!canPersist} onClick={createBundle}>
        <ChaiIcon name="review-bundle" size={16} /> Bundle from selection
      </Button>
      {!canPersist ? (
        <p className="review-authority-note">Preview only · local project session required to commit</p>
      ) : null}

      <section className="review-nav-section review-decision-card">
        <div className="review-nav-section__title">
          <span>Decision record</span>
          <b>No lifecycle effect</b>
        </div>
        <p>Review actions can recommend. Only the QA service can approve or deliver.</p>
        <div className="review-decision-actions">
          <Button disabled={!canPersist || activeBundle === undefined} onClick={requestFeedback}>
            <ChaiIcon name="feedback-request" size={16} /> Request feedback
          </Button>
          <Button disabled={!canPersist || openRequest === undefined} onClick={recommendApproval}>
            <ChaiIcon name="approve" size={14} /> Recommend approval
          </Button>
        </div>
      </section>

      <section className="review-nav-section">
        <div className="review-nav-section__title">
          <span>Bundles</span>
          <b>{workspace.state.bundles.length}</b>
        </div>
        {workspace.state.bundles.length === 0 ? (
          <p>No review bundle in this revision.</p>
        ) : (
          workspace.state.bundles.slice(0, 4).map((bundle, index) => (
            <button
              className={bundle.id === activeBundle?.id ? "review-item active" : "review-item"}
              type="button"
              aria-pressed={bundle.id === activeBundle?.id}
              onClick={() => {
                setActiveBundleId(bundle.id);
              }}
              key={bundle.id}
            >
              <span className="review-item__index">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{bundle.title}</strong>
                <small>
                  {bundle.origin} · {shortRevision(bundle.targetRevisionId)}
                </small>
              </span>
              <Badge>{bundle.status}</Badge>
            </button>
          ))
        )}
      </section>

      <section className="review-nav-section">
        <div className="review-nav-section__title">
          <span>Issues</span>
          <b>{openIssues.length} open</b>
        </div>
        {workspace.state.issues.slice(0, 4).map((issue) => (
          <div className="review-issue" key={issue.id}>
            <i data-severity={issue.severity} />
            <span>
              <strong>{issue.title}</strong>
              <small>
                {issue.status} · {rangeLabel(issue.frameRange)}
              </small>
            </span>
          </div>
        ))}
        <div className="review-compose">
          <TextField
            label="New exact-frame issue"
            placeholder="Describe what must change"
            value={issueDraft}
            onChange={(event) => {
              setIssueDraft(event.currentTarget.value);
            }}
          />
          <Button
            disabled={!canPersist || activeBundle === undefined || issueDraft.trim().length === 0}
            onClick={createIssue}
          >
            <ChaiIcon name="review-issue" size={16} /> Add issue
          </Button>
        </div>
      </section>
    </div>
  );
};

export const ReviewContactSheet = ({
  snapshot,
  onSeek,
  onSelectRange,
}: {
  readonly snapshot: StudioSnapshot;
  readonly onSeek: (frame: string) => void;
  readonly onSelectRange: (startFrame: string, endFrameExclusive: string) => void;
}) => {
  const [comparisonMode, setComparisonMode] = useState<"split" | "wipe" | "difference">("split");
  const [exported, setExported] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<bigint | null>(null);
  const frames = useMemo(() => {
    const current = BigInt(snapshot.preview.masterFrame);
    const duration = BigInt(snapshot.preview.durationFrames);
    const lastFrame = duration > 0n ? duration - 1n : 0n;
    const unique = new Set<string>();
    for (const offset of [-12n, -8n, -4n, 0n, 4n, 8n]) {
      const requested = current + offset;
      const bounded = requested < 0n ? 0n : requested > lastFrame ? lastFrame : requested;
      unique.add(bounded.toString(10));
    }
    return [...unique].map((frame) => BigInt(frame));
  }, [snapshot.preview.durationFrames, snapshot.preview.masterFrame]);
  const manifest = {
    schemaVersion: "1.0.0",
    revisionId: snapshot.project?.revisionId ?? "revision-ui-fixture",
    timelineId: snapshot.timeline.id,
    frameRange: {
      startFrame: frames[0]?.toString(10),
      endFrameExclusive: ((frames.at(-1) ?? 0n) + 1n).toString(10),
    },
    frames: frames.map((frame) => frame.toString(10)),
    comparison: { linkedNavigation: true, mode: comparisonMode },
    parity: snapshot.preview.fidelityEquivalent ? "eligible" : "interactive-not-eligible",
  };
  return (
    <div className="contact-sheet review-contact-sheet" aria-label="Exact review contact sheet">
      <div className="lower-title review-contact-sheet__header">
        <div>
          <strong>Exact review · {snapshot.preview.timecode}</strong>
          <span>{shortRevision(manifest.revisionId)} · linked frame navigation</span>
        </div>
        <div className="comparison-mode-strip" aria-label="Comparison modes">
          {(["split", "wipe", "difference"] as const).map((mode) => (
            <button
              className={comparisonMode === mode ? "active" : ""}
              type="button"
              aria-pressed={comparisonMode === mode}
              onClick={() => {
                setComparisonMode(mode);
              }}
              key={mode}
            >
              {mode === "split" ? "Split" : mode === "wipe" ? "Wipe" : "Difference"}
            </button>
          ))}
        </div>
        <Button
          aria-label={exported ? "Manifest exported" : "Export capture manifest"}
          onClick={() => {
            void copyReviewManifest(JSON.stringify(manifest, null, 2)).then(() => {
              setExported(true);
            });
          }}
        >
          {exported ? "Exported" : "Export JSON"}
        </Button>
      </div>
      <div className="contact-grid">
        {frames.map((frame) => (
          <button
            className={
              frame.toString(10) === snapshot.preview.masterFrame
                ? "contact-frame contact-frame--active"
                : "contact-frame"
            }
            type="button"
            title="Click to seek. Shift-click a second frame to mark a range."
            onClick={(event) => {
              onSeek(frame.toString(10));
              if (!event.shiftKey) {
                setRangeAnchor(frame);
                return;
              }
              const anchor = rangeAnchor ?? BigInt(snapshot.preview.masterFrame);
              const start = anchor < frame ? anchor : frame;
              const end = (anchor > frame ? anchor : frame) + 1n;
              onSelectRange(start.toString(10), end.toString(10));
              setRangeAnchor(null);
            }}
            key={frame.toString(10)}
          >
            <span>
              <i />
            </span>
            <strong>
              {frame.toString(10)}
              {frame.toString(10) === snapshot.preview.masterFrame ? " · Current" : ""}
            </strong>
          </button>
        ))}
      </div>
      <div className="review-contact-footer">
        <span>
          <i className="truth-dot" /> Interactive compositor
        </span>
        <span>Parity: {snapshot.preview.fidelityEquivalent ? "eligible" : "not claimed"}</span>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("chai:reveal-source", {
                detail: { revisionId: manifest.revisionId, timelineId: manifest.timelineId },
              }),
            );
          }}
        >
          <ChaiIcon name="visibility" size={14} /> Reveal source
        </button>
      </div>
    </div>
  );
};

const studioClient = (): StudioApiClient =>
  new StudioApiClient({
    sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
    baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
  });

const fallbackWorkspace = (snapshot: StudioSnapshot): ReviewWorkspaceSnapshot => {
  const projectId = snapshot.project?.projectId ?? "project-ui-fixture";
  const revisionId = snapshot.project?.revisionId ?? "revision-ui-fixture";
  const state: ReviewStateDocument = {
    schemaVersion: "1.0.0",
    bundles: [
      {
        schemaVersion: "1.0.0",
        id: "bundle-opening-rhythm",
        projectId,
        targetRevisionId: revisionId,
        title: "Opening rhythm",
        origin: "selection",
        selectedEntityIds: snapshot.timeline.selection.selectedIds,
        markerIds: [],
        phraseIds: [],
        frames: [serializeBigInt(BigInt(snapshot.preview.masterFrame))],
        ranges: [{ startFrame: serializeBigInt(420n), endFrameExclusive: serializeBigInt(493n) }],
        captureIds: ["capture-fidelity-0444"],
        annotationIds: [],
        issueIds: ["issue-title-alignment"],
        author: actor,
        status: "in-review",
        requestedDecision: "feedback",
        createdAt: "2026-07-16T08:00:00.000Z",
        updatedAt: "2026-07-16T08:06:00.000Z",
      },
    ],
    issues: [
      {
        id: "issue-title-alignment",
        bundleId: "bundle-opening-rhythm",
        title: "Title alignment drifts",
        body: "Compare the shared frame range.",
        category: "visual",
        severity: "warning",
        status: "acknowledged",
        entityIds: snapshot.timeline.selection.selectedIds,
        frameRange: { startFrame: serializeBigInt(438n), endFrameExclusive: serializeBigInt(451n) },
        annotationIds: [],
        transitions: [],
        createdAt: "2026-07-16T08:01:00.000Z",
        updatedAt: "2026-07-16T08:03:00.000Z",
      },
      {
        id: "issue-copy-density",
        bundleId: "bundle-opening-rhythm",
        title: "Copy density at reveal",
        body: "Verify after the alternate take.",
        category: "visual",
        severity: "info",
        status: "fixed-unverified",
        entityIds: snapshot.timeline.selection.selectedIds,
        frameRange: { startFrame: serializeBigInt(452n), endFrameExclusive: serializeBigInt(493n) },
        annotationIds: [],
        transitions: [],
        createdAt: "2026-07-16T08:02:00.000Z",
        updatedAt: "2026-07-16T08:05:00.000Z",
      },
    ],
    comparisons: [],
    requests: [],
    actions: [],
    exceptions: [],
    alternateTakes: [],
  };
  return {
    projectId,
    revisionId,
    timelineId: snapshot.timeline.id,
    durationFrames: snapshot.preview.durationFrames,
    qaState: null,
    state,
    auditTrail: [],
  };
};

const shortRevision = (revision: string): string =>
  revision.length > 20 ? `${revision.slice(0, 12)}…${revision.slice(-5)}` : revision;

const rangeLabel = (range: Readonly<{ startFrame: string; endFrameExclusive: string }> | null): string =>
  range === null
    ? "all frames"
    : `${range.startFrame}–${(BigInt(range.endFrameExclusive) - 1n).toString(10)}f`;

const copyReviewManifest = async (manifest: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(manifest);
  } catch {
    const url = URL.createObjectURL(new Blob([manifest], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "chai-review-capture-manifest.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }
};
