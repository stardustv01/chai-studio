import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  assertValidAudioGraph,
  executeAudioGraphCommand,
  type AudioGraphCommand,
  type AudioGraphDocument,
} from "@chai-studio/audio";
import { executeLanguageCommand, type LanguageCommand } from "@chai-studio/captions";
import type { AssetRecord, CaptionDocument, TimelineDocument, TranscriptDocument } from "@chai-studio/schema";
import {
  executeTimelineCommand,
  timelineDocumentToSnapshot,
  type TimelineEditCommand,
  type TimelineSnapshotV1,
} from "@chai-studio/timeline/browser";
import { StaleRevisionError, StudioApiClient, StudioApiError } from "./api-client.js";
import { subscribeToStudioEvents } from "./event-stream.js";
import { LocalPerformanceMonitor } from "./performance.js";
import { captureStudioProgramFrame } from "./capture-surface.js";
import {
  applyContractMockPreviewCommand,
  advanceContractMockPreviewFrame,
  formatMonitorTimecode,
  previewControlRequests,
  type MonitorCaptureMode,
  type ProgramMonitorCommand,
  type SourceInspectionState,
} from "./monitor-contract.js";
import {
  shellStateIds,
  type ConnectionState,
  type ShellStateId,
  type StudioDiagnostic,
  type StudioEvent,
  type PreviewTruth,
  type PreviewWarningView,
  type RenderTruth,
  type StudioSnapshot,
  type ToastMessage,
  type WorkspaceId,
  workspaceIds,
} from "./types.js";
import { initialStudioSnapshot } from "./runtime-snapshot.js";
import {
  resolveStudioDataSource,
  studioUiFixtureModeEnabled,
  type StudioDataSource,
} from "./runtime-mode.js";

interface RuntimeState {
  readonly workspace: WorkspaceId;
  readonly shellState: ShellStateId;
  readonly snapshot: StudioSnapshot;
  readonly connection: ConnectionState;
  readonly diagnostic: StudioDiagnostic | null;
  readonly toasts: readonly ToastMessage[];
  readonly commandPaletteOpen: boolean;
  readonly diagnosticsOpen: boolean;
  readonly reliability: ReliabilityDiagnosticsView | null;
  readonly timelineHistory: {
    readonly undo: readonly TimelineHistoryEntry[];
    readonly redo: readonly TimelineHistoryEntry[];
  };
  readonly recentProjects: readonly RecentProjectView[];
}

interface TimelineHistoryEntry {
  readonly snapshot: TimelineSnapshotV1;
  readonly label: string;
}

export interface RecentProjectView {
  readonly projectId: string;
  readonly title: string;
  readonly rootPath: string;
  readonly revisionId: string;
  readonly lastOpenedAt: string;
}

type RuntimeAction =
  | Readonly<{ type: "workspace"; workspace: WorkspaceId }>
  | Readonly<{ type: "shell-state"; shellState: ShellStateId }>
  | Readonly<{ type: "connection"; connection: Partial<ConnectionState> }>
  | Readonly<{ type: "project-snapshot"; payload: Readonly<Record<string, unknown>> }>
  | Readonly<{ type: "asset-selection"; assetIds: readonly string[] }>
  | Readonly<{
      type: "timeline-local";
      timeline: TimelineSnapshotV1;
      label: string;
      recordHistory: boolean;
    }>
  | Readonly<{ type: "audio-local"; audioGraph: AudioGraphDocument }>
  | Readonly<{
      type: "language-local";
      transcripts: readonly TranscriptDocument[];
      captionDocuments: readonly CaptionDocument[];
    }>
  | Readonly<{ type: "timeline-history"; direction: "undo" | "redo" }>
  | Readonly<{ type: "preview-state"; payload: Readonly<Record<string, unknown>> }>
  | Readonly<{ type: "preview-local"; preview: PreviewTruth }>
  | Readonly<{ type: "preview-tick" }>
  | Readonly<{ type: "render-state"; payload: unknown }>
  | Readonly<{ type: "resynced" }>
  | Readonly<{ type: "event"; event: StudioEvent }>
  | Readonly<{ type: "diagnostic"; diagnostic: StudioDiagnostic | null }>
  | Readonly<{ type: "toast"; toast: ToastMessage }>
  | Readonly<{ type: "dismiss-toast"; id: string }>
  | Readonly<{ type: "command-palette"; open: boolean }>
  | Readonly<{ type: "diagnostics"; open: boolean }>
  | Readonly<{ type: "reliability"; value: ReliabilityDiagnosticsView | null }>
  | Readonly<{ type: "recent-projects"; projects: readonly RecentProjectView[] }>;

export interface ReliabilityDiagnosticsView {
  readonly summary: string;
  readonly status: "ready" | "degraded" | "blocked";
  readonly affectedEntity: string | null;
  readonly stage: string | null;
  readonly frame: string | null;
  readonly suggestedRepair: string | null;
  readonly safeRetry: boolean;
  readonly inspectSource: boolean;
  readonly issueCount: number;
  readonly checks: readonly Readonly<{
    id: string;
    label: string;
    state: "passed" | "warning" | "failed";
    impact: "blocking" | "degraded" | "repairable";
    summary: string;
    repair: string | null;
  }>[];
  readonly issues: readonly Readonly<{
    id: string;
    code: string;
    summary: string;
    suggestedRepair: string;
    entityId: string | null;
  }>[];
  readonly recordIds: readonly string[];
  readonly localOnly: boolean;
  readonly telemetryEnabled: boolean;
}

export interface StudioRuntime extends RuntimeState {
  readonly performance: LocalPerformanceMonitor;
  readonly dataSource: StudioDataSource;
  readonly setWorkspace: (workspace: WorkspaceId) => void;
  readonly setShellState: (state: ShellStateId) => void;
  readonly refreshRecentProjects: () => Promise<void>;
  readonly openProject: (rootPath: string) => Promise<boolean>;
  readonly createProject: (input: {
    readonly targetPath: string;
    readonly title: string;
    readonly starter: "empty" | "showcase" | "launch-film";
  }) => Promise<boolean>;
  readonly resync: () => Promise<void>;
  readonly capture: () => void;
  readonly requestCapture: (
    mode: MonitorCaptureMode,
    includeOverlays?: boolean,
    source?: SourceInspectionState,
  ) => Promise<void>;
  readonly importAssets: (files: readonly File[], rights: AssetRecord["rights"]) => Promise<void>;
  readonly inspectAsset: (assetId: string) => Promise<boolean>;
  readonly relinkAsset: (assetId: string, sourcePath: string) => Promise<boolean>;
  readonly selectAsset: (assetId: string) => void;
  readonly dispatchMonitorCommand: (command: ProgramMonitorCommand) => Promise<PreviewTruth>;
  readonly dispatchTimelineCommand: (command: TimelineEditCommand) => Promise<void>;
  readonly dispatchAudioCommand: (command: AudioGraphCommand) => Promise<void>;
  readonly dispatchLanguageCommand: (command: LanguageCommand) => Promise<void>;
  readonly moveTimelineHistory: (direction: "undo" | "redo") => Promise<void>;
  readonly render: () => void;
  readonly dismissToast: (id: string) => void;
  readonly setCommandPaletteOpen: (open: boolean) => void;
  readonly setDiagnosticsOpen: (open: boolean) => void;
  readonly refreshReliability: () => Promise<void>;
  readonly prepareSupportBundlePreview: () => Promise<void>;
}

export const useStudioRuntime = (): StudioRuntime => {
  const client = useMemo(
    () =>
      new StudioApiClient({
        sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
        baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
      }),
    [],
  );
  const performanceMonitor = useMemo(() => new LocalPerformanceMonitor(), []);
  const dataSource = useMemo(
    () =>
      resolveStudioDataSource({
        hasAuthenticatedSession: client.sessionToken !== null,
        uiFixtureMode: studioUiFixtureModeEnabled(),
      }),
    [client],
  );
  const [state, dispatch] = useReducer(runtimeReducer, undefined, initialRuntimeState);
  const latestPreviewRef = useRef(state.snapshot.preview);
  latestPreviewRef.current = state.snapshot.preview;
  const monitorCommandQueue = useRef<Promise<void>>(Promise.resolve());
  const timelineMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const resyncQueue = useRef<Promise<void>>(Promise.resolve());
  const eventCursor = useRef<number | null>(null);

  const enqueueTimelineMutation = useCallback((task: () => Promise<void>): Promise<void> => {
    const pending = timelineMutationQueue.current.then(task, task);
    timelineMutationQueue.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    if (client.sessionToken === null) {
      dispatch({ type: "recent-projects", projects: [] });
      return;
    }
    try {
      dispatch({
        type: "recent-projects",
        projects: recentProjectsFromPayload(await client.recentProjects()),
      });
    } catch (cause: unknown) {
      handleRuntimeError(cause, dispatch);
    }
  }, [client]);

  const resync = useCallback((): Promise<void> => {
    const run = async (): Promise<void> => {
      if (client.sessionToken === null) return;
      const startedAt = performance.now();
      try {
        const [project, revisions, preview, queue] = await Promise.all([
          client.projectSnapshot(),
          client.projectRevisions(),
          client.previewSnapshot(),
          client.renderQueue(),
        ]);
        dispatch({ type: "project-snapshot", payload: { ...project, revisionNumber: revisions.length } });
        dispatch({ type: "preview-state", payload: preview });
        dispatch({ type: "render-state", payload: queue });
        dispatch({ type: "resynced" });
        dispatch({ type: "shell-state", shellState: "ready" });
        dispatch({ type: "diagnostic", diagnostic: null });
      } catch (cause: unknown) {
        if (cause instanceof StudioApiError && cause.diagnostic.code === "server.project-not-open") {
          const recent = await client.recentProjects().catch(() => []);
          dispatch({ type: "recent-projects", projects: recentProjectsFromPayload(recent) });
          dispatch({ type: "shell-state", shellState: "empty" });
          dispatch({ type: "diagnostic", diagnostic: null });
        } else {
          handleRuntimeError(cause, dispatch);
        }
      } finally {
        performanceMonitor.record("project-open", performance.now() - startedAt, {
          dataSource: "server",
        });
      }
    };
    const pending = resyncQueue.current.then(run, run);
    resyncQueue.current = pending.catch(() => undefined);
    return pending;
  }, [client, performanceMonitor]);

  useEffect(() => {
    performanceMonitor.start();
    const controller = new AbortController();
    if (dataSource === "unauthenticated") {
      dispatch({
        type: "connection",
        connection: {
          phase: "offline",
          detail: "Authenticated launch required",
          attempts: 0,
        },
      });
      return () => {
        controller.abort();
        performanceMonitor.stop();
      };
    }
    dispatch({ type: "connection", connection: { phase: "connecting", detail: "Connecting" } });
    void client
      .health(controller.signal)
      .then((health) => {
        const version = typeof health.contractVersion === "string" ? health.contractVersion : "local";
        dispatch({
          type: "connection",
          connection: { phase: "online", detail: `Local · ${version}`, attempts: 0 },
        });
        if (client.sessionToken !== null) void resync();
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        dispatch({ type: "connection", connection: { phase: "offline", detail: "Server offline" } });
      });
    return () => {
      controller.abort();
      performanceMonitor.stop();
    };
  }, [client, dataSource, performanceMonitor, resync]);

  useEffect(() => {
    if (client.sessionToken === null) return;
    const controller = new AbortController();
    void subscribeToStudioEvents({
      url: `${client.baseUrl}/api/v1/events`,
      sessionToken: client.sessionToken,
      signal: controller.signal,
      lastEventId: eventCursor.current,
      onEvent: (event) => {
        eventCursor.current = event.id;
        dispatch({ type: "event", event });
        if (event.type.startsWith("job.")) dispatch({ type: "render-state", payload: event.payload });
        if (
          event.type === "project.command" ||
          event.type.startsWith("annotation.") ||
          event.type.startsWith("comparison.")
        ) {
          void resync();
        }
        if (event.type === "capture.created") {
          const capture = event.payload;
          dispatch({
            type: "toast",
            toast: {
              id: globalThis.crypto.randomUUID(),
              tone: "ready",
              title: "Capture available",
              detail: `${typeof capture.label === "string" ? capture.label : "Rendered capture"} · ${typeof capture.relativePath === "string" ? capture.relativePath : "saved in project"}`,
              correlationId: event.correlationId,
            },
          });
        }
      },
      onConnection: (phase, attempts) => {
        dispatch({
          type: "connection",
          connection: {
            phase,
            attempts,
            detail:
              phase === "online"
                ? "Local · live"
                : phase === "reconnecting"
                  ? "Reconnecting"
                  : "Event stream offline",
          },
        });
      },
      onResyncRequired: resync,
    });
    return () => {
      controller.abort();
    };
  }, [client, resync]);

  useEffect(() => {
    if (client.sessionToken !== null || state.snapshot.preview.playback !== "playing") return;
    const interval = window.setInterval(() => {
      dispatch({ type: "preview-tick" });
    }, 33);
    return () => {
      window.clearInterval(interval);
    };
  }, [client, state.snapshot.preview.playback]);

  const setWorkspace = useCallback((workspace: WorkspaceId) => {
    dispatch({ type: "workspace", workspace });
    const url = new URL(window.location.href);
    url.searchParams.set("workspace", workspace);
    window.history.replaceState(null, "", url);
  }, []);

  const setShellState = useCallback((shellState: ShellStateId) => {
    dispatch({ type: "shell-state", shellState });
  }, []);

  const openProject = useCallback(
    async (rootPath: string): Promise<boolean> => {
      if (client.sessionToken === null || rootPath.trim().length === 0) return false;
      dispatch({ type: "shell-state", shellState: "loading" });
      try {
        await client.openProject(rootPath.trim());
        await resync();
        await refreshRecentProjects();
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "ready",
            title: "Project opened",
            detail: rootPath.trim(),
            correlationId: null,
          },
        });
        return true;
      } catch (cause: unknown) {
        handleRuntimeError(cause, dispatch);
        dispatch({ type: "shell-state", shellState: "empty" });
        return false;
      }
    },
    [client, refreshRecentProjects, resync],
  );

  const createProject = useCallback(
    async (input: {
      readonly targetPath: string;
      readonly title: string;
      readonly starter: "empty" | "showcase" | "launch-film";
    }): Promise<boolean> => {
      if (
        client.sessionToken === null ||
        input.targetPath.trim().length === 0 ||
        input.title.trim().length === 0
      ) {
        return false;
      }
      dispatch({ type: "shell-state", shellState: "loading" });
      try {
        await client.createProject({
          targetPath: input.targetPath.trim(),
          title: input.title.trim(),
          starter: input.starter,
        });
        await resync();
        await refreshRecentProjects();
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "ready",
            title: "Project created",
            detail: input.targetPath.trim(),
            correlationId: null,
          },
        });
        return true;
      } catch (cause: unknown) {
        handleRuntimeError(cause, dispatch);
        dispatch({ type: "shell-state", shellState: "empty" });
        return false;
      }
    },
    [client, refreshRecentProjects, resync],
  );

  const requestCapture = useCallback(
    async (
      mode: MonitorCaptureMode,
      includeOverlays = false,
      source?: SourceInspectionState,
    ): Promise<void> => {
      const startedAt = performance.now();
      if (client.sessionToken === null) {
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "attention",
            title: "Preview only — capture unavailable",
            detail: "Launch the authenticated local Studio session before creating capture evidence.",
            correlationId: null,
          },
        });
        return;
      }
      try {
        const authoritative = await client.previewSnapshot();
        let preview = previewTruthFromPayload(latestPreviewRef.current, unwrapPreviewState(authoritative));
        latestPreviewRef.current = preview;
        dispatch({ type: "preview-state", payload: authoritative });
        if (preview.playback === "playing") {
          const paused = await client.previewControl("transport", {
            action: "pause",
            expectedStateVersion: preview.stateVersion,
          });
          preview = previewTruthFromPayload(preview, unwrapPreviewState(paused));
          dispatch({ type: "preview-state", payload: paused });
        }
        const labels: Readonly<Record<MonitorCaptureMode, string>> = {
          "interactive-frame": "Interactive frame",
          "source-frame": "Source frame",
          "exact-fidelity": "Exact fidelity frame",
          "isolated-clip": "Isolated clip",
          "before-effects": "Before effects",
          alpha: "Alpha inspection",
          comparison: "A/B comparison",
          range: "Review range",
          "contact-sheet": "Contact sheet",
        };
        let captureRecord: Readonly<Record<string, unknown>>;
        if (mode === "exact-fidelity") {
          captureRecord = await requestExactFidelityCapture(
            client,
            preview,
            state.snapshot.project?.title ?? "Studio",
          );
        } else if (
          mode === "isolated-clip" ||
          mode === "before-effects" ||
          mode === "alpha" ||
          mode === "range" ||
          mode === "contact-sheet"
        ) {
          const selectedClipIds = state.snapshot.timeline.selection.selectedIds.filter((id) => {
            const clip = state.snapshot.timeline.clips[id];
            return clip !== undefined && state.snapshot.timeline.tracks[clip.trackId]?.kind === "video";
          });
          const manifest = await requestExactCaptureJob(client, {
            mode,
            masterFrame: preview.masterFrame,
            inOutRange: preview.inOutRange,
            selectedClipIds,
          });
          captureRecord = {
            id: manifest.id,
            relativePath: Array.isArray(manifest.outputPaths)
              ? manifest.outputPaths.filter((item): item is string => typeof item === "string").join(", ")
              : "saved in project",
          };
        } else {
          const sourceIdentity =
            mode === "source-frame" && source !== undefined
              ? ` · ${source.sourceId} · source frame ${source.currentFrame}`
              : "";
          const label = `${labels[mode]}${sourceIdentity} · ${includeOverlays ? "review evidence — overlays included" : "clean frame — overlays excluded"}`;
          let attempt = 0;
          for (;;) {
            const imageBase64 = (
              await captureStudioProgramFrame(includeOverlays, mode === "source-frame" ? "source" : "program")
            ).replace(/^data:image\/png;base64,/u, "");
            try {
              captureRecord = await client.request<Readonly<Record<string, unknown>>>("/api/v1/captures", {
                method: "POST",
                body: JSON.stringify({
                  label,
                  imageBase64,
                  expectedPreviewStateVersion: preview.stateVersion,
                }),
              });
              break;
            } catch (cause: unknown) {
              if (!(cause instanceof StaleRevisionError) || attempt > 0) throw cause;
              attempt += 1;
              const refreshed = await client.previewSnapshot();
              preview = previewTruthFromPayload(preview, unwrapPreviewState(refreshed));
              latestPreviewRef.current = preview;
              dispatch({ type: "preview-state", payload: refreshed });
            }
          }
        }
        const captureId = typeof captureRecord.id === "string" ? captureRecord.id : "Capture";
        const capturePath =
          typeof captureRecord.relativePath === "string" ? captureRecord.relativePath : "saved in project";
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "ready",
            title: `${labels[mode]} completed`,
            detail: `${captureCompletionDetail(mode, includeOverlays, source)} ${captureId} · ${capturePath}`,
            correlationId: null,
          },
        });
      } catch (cause: unknown) {
        handleRuntimeError(cause, dispatch);
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "danger",
            title: "Capture failed",
            detail: cause instanceof Error ? cause.message : "The capture job could not be completed.",
            correlationId: null,
          },
        });
      } finally {
        performanceMonitor.record("exact-capture", performance.now() - startedAt, {
          mode,
          includeOverlays: includeOverlays ? 1 : 0,
        });
      }
    },
    [
      client,
      performanceMonitor,
      state.snapshot.preview,
      state.snapshot.project?.title,
      state.snapshot.timeline,
    ],
  );

  const capture = useCallback(() => {
    void requestCapture("exact-fidelity", false);
  }, [requestCapture]);

  const dispatchMonitorCommand = useCallback(
    (command: ProgramMonitorCommand): Promise<PreviewTruth> => {
      const run = async (): Promise<PreviewTruth> => {
        const startedAt = performance.now();
        const metric =
          command.kind === "step-frame"
            ? "frame-step"
            : command.kind.startsWith("seek")
              ? "seek"
              : "play-drift";
        const current = latestPreviewRef.current;
        if (client.sessionToken === null) {
          const next = applyContractMockPreviewCommand(current, command);
          latestPreviewRef.current = next;
          dispatch({
            type: "preview-local",
            preview: next,
          });
          performanceMonitor.record(metric, performance.now() - startedAt, {
            dataSource: "ui-fixture",
            command: command.kind,
          });
          return next;
        }
        try {
          const authoritative = await client.previewSnapshot();
          let latest = previewTruthFromPayload(current, unwrapPreviewState(authoritative));
          latestPreviewRef.current = latest;
          const requests = previewControlRequests(command, latest);
          for (const control of requests) {
            let payload: Readonly<Record<string, unknown>>;
            try {
              payload = await client.previewControl(control.endpoint, {
                ...control.body,
                expectedStateVersion: latest.stateVersion,
              });
            } catch (cause: unknown) {
              if (!(cause instanceof StaleRevisionError)) throw cause;
              const refreshed = await client.previewSnapshot();
              latest = previewTruthFromPayload(latest, unwrapPreviewState(refreshed));
              latestPreviewRef.current = latest;
              dispatch({ type: "preview-state", payload: refreshed });
              payload = await client.previewControl(control.endpoint, {
                ...control.body,
                expectedStateVersion: latest.stateVersion,
              });
            }
            const projected = previewTruthFromPayload(latest, unwrapPreviewState(payload));
            latest = projected;
            latestPreviewRef.current = latest;
            dispatch({ type: "preview-state", payload });
          }
          return latest;
        } catch (cause: unknown) {
          handleRuntimeError(cause, dispatch);
          return current;
        } finally {
          performanceMonitor.record(metric, performance.now() - startedAt, {
            dataSource: "server",
            command: command.kind,
          });
        }
      };
      const pending = monitorCommandQueue.current.then(
        () => run(),
        () => run(),
      );
      monitorCommandQueue.current = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [client, performanceMonitor],
  );

  const dispatchTimelineCommand = useCallback(
    (command: TimelineEditCommand): Promise<void> =>
      enqueueTimelineMutation(async (): Promise<void> => {
        const startedAt = performance.now();
        let commandSnapshot = state.snapshot;
        if (client.sessionToken !== null && command.kind !== "selection.set") {
          try {
            const authoritative = await client.projectSnapshot();
            commandSnapshot = projectSnapshotFromPayload(state.snapshot, authoritative) ?? state.snapshot;
          } catch (cause: unknown) {
            handleRuntimeError(cause, dispatch);
            dispatchTimelineFailureToast(cause, dispatch);
            return;
          }
        }
        let result: ReturnType<typeof executeTimelineCommand>;
        try {
          result = executeTimelineCommand(commandSnapshot.timeline, command);
        } catch (cause: unknown) {
          dispatch({
            type: "toast",
            toast: {
              id: globalThis.crypto.randomUUID(),
              tone: "danger",
              title: "Timeline edit blocked",
              detail:
                cause instanceof Error
                  ? cause.message
                  : "The frame-exact timeline contract rejected this edit.",
              correlationId: null,
            },
          });
          return;
        }
        if (client.sessionToken === null) {
          dispatch({
            type: "timeline-local",
            timeline: result.snapshot,
            label: result.label,
            recordHistory: command.kind !== "selection.set",
          });
          performanceMonitor.record("timeline-interaction", performance.now() - startedAt, {
            dataSource: "ui-fixture",
            command: command.kind,
          });
          return;
        }
        if (command.kind === "selection.set") {
          dispatch({
            type: "timeline-local",
            timeline: result.snapshot,
            label: result.label,
            recordHistory: false,
          });
          try {
            const currentSelection = await client.request<Readonly<Record<string, unknown>>>(
              "/api/v1/editor/selection",
              { method: "GET" },
            );
            await client.request("/api/v1/editor/selection", {
              method: "PUT",
              body: JSON.stringify({
                ids: command.entityIds,
                primaryId: command.primaryId,
                anchorId: command.primaryId,
                mode: command.mode,
                expectedStateVersion:
                  typeof currentSelection.stateVersion === "number" ? currentSelection.stateVersion : 1,
              }),
            });
          } catch (cause: unknown) {
            handleRuntimeError(cause, dispatch);
          }
          return;
        }
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const project = commandSnapshot.project;
            if (project === null) return;
            const nonce = globalThis.crypto.randomUUID();
            try {
              await client.command(
                "/api/v1/commands",
                {
                  schemaVersion: "1.0.0",
                  commandId: `command-timeline-${nonce}`,
                  idempotencyId: `idempotency-timeline-${nonce}`,
                  actor: {
                    id: "actor-studio-user",
                    kind: "user",
                    sessionId: "session-studio-desktop",
                  },
                  projectId: project.projectId,
                  correlationId: `correlation-timeline-${nonce}`,
                  issuedAt: new Date().toISOString(),
                  capability: { name: "timeline-edit", version: "1.0.0" },
                  payloadVersion: "1.0.0",
                  affectedEntityIds: result.affectedEntityIds,
                  declaredScope: "mutation",
                  validationOnly: false,
                  baseRevisionId: project.revisionId,
                  authorizationId: null,
                  kind: "timeline.edit",
                  payload: { operation: timelineCommandToJson(command) },
                },
                project.revisionId,
              );
              dispatch({
                type: "timeline-local",
                timeline: result.snapshot,
                label: result.label,
                recordHistory: true,
              });
              await resync();
              return;
            } catch (cause: unknown) {
              if (!(cause instanceof StaleRevisionError) || attempt > 0) throw cause;
              const authoritative = await client.projectSnapshot();
              const refreshed = projectSnapshotFromPayload(commandSnapshot, authoritative);
              if (refreshed === null) throw cause;
              commandSnapshot = refreshed;
              result = executeTimelineCommand(commandSnapshot.timeline, command);
            }
          }
        } catch (cause: unknown) {
          handleRuntimeError(cause, dispatch);
          dispatchTimelineFailureToast(cause, dispatch);
        } finally {
          performanceMonitor.record("timeline-interaction", performance.now() - startedAt, {
            dataSource: "server",
            command: command.kind,
          });
        }
      }),
    [client, enqueueTimelineMutation, performanceMonitor, resync, state.snapshot],
  );

  const dispatchAudioCommand = useCallback(
    (command: AudioGraphCommand): Promise<void> => {
      const execute = (snapshot: StudioSnapshot): ReturnType<typeof executeAudioGraphCommand> | null => {
        try {
          return executeAudioGraphCommand(snapshot.audioGraph, command);
        } catch (cause: unknown) {
          dispatch({
            type: "toast",
            toast: {
              id: globalThis.crypto.randomUUID(),
              tone: "danger",
              title: "Audio edit blocked",
              detail:
                cause instanceof Error ? cause.message : "The authoritative audio graph rejected this edit.",
              correlationId: null,
            },
          });
          return null;
        }
      };
      if (client.sessionToken === null) {
        const result = execute(state.snapshot);
        if (result !== null) dispatch({ type: "audio-local", audioGraph: result.graph });
        return Promise.resolve();
      }
      return enqueueTimelineMutation(async (): Promise<void> => {
        let commandSnapshot = state.snapshot;
        try {
          const authoritative = await client.projectSnapshot();
          commandSnapshot = projectSnapshotFromPayload(commandSnapshot, authoritative) ?? commandSnapshot;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const project = commandSnapshot.project;
            if (project === null) return;
            const result = execute(commandSnapshot);
            if (result === null) return;
            const nonce = globalThis.crypto.randomUUID();
            try {
              await client.command(
                "/api/v1/commands",
                {
                  schemaVersion: "1.0.0",
                  commandId: `command-audio-${nonce}`,
                  idempotencyId: `idempotency-audio-${nonce}`,
                  actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
                  projectId: project.projectId,
                  correlationId: `correlation-audio-${nonce}`,
                  issuedAt: new Date().toISOString(),
                  capability: { name: "audio-edit", version: "1.0.0" },
                  payloadVersion: "1.0.0",
                  affectedEntityIds: result.affectedEntityIds,
                  declaredScope: "mutation",
                  validationOnly: false,
                  baseRevisionId: project.revisionId,
                  authorizationId: null,
                  kind: "audio.edit",
                  payload: { operation: timelineCommandToJson(command) },
                },
                project.revisionId,
              );
              await resync();
              return;
            } catch (cause: unknown) {
              if (!(cause instanceof StaleRevisionError) || attempt > 0) throw cause;
              const authoritativeRetry = await client.projectSnapshot();
              const refreshed = projectSnapshotFromPayload(commandSnapshot, authoritativeRetry);
              if (refreshed === null) throw cause;
              commandSnapshot = refreshed;
            }
          }
        } catch (cause: unknown) {
          handleRuntimeError(cause, dispatch);
        }
      });
    },
    [client, enqueueTimelineMutation, resync, state.snapshot],
  );

  const dispatchLanguageCommand = useCallback(
    (command: LanguageCommand): Promise<void> => {
      const execute = (snapshot: StudioSnapshot): ReturnType<typeof executeLanguageCommand> | null => {
        const project = snapshot.project;
        if (project === null) return null;
        const languageTimeline: TimelineDocument = {
          schemaVersion: "1.0.0",
          projectId: project.projectId,
          revisionId: project.revisionId,
          timelineId: snapshot.timeline.id,
          fps: snapshot.preview.timelineFps as TimelineDocument["fps"],
          durationFrames: snapshot.preview.durationFrames as TimelineDocument["durationFrames"],
          tracks: [],
          audioBusIds: [],
          approvalReferenceIds: [],
          audioGraph: snapshot.audioGraph,
          transcripts: snapshot.transcripts,
          captionDocuments: snapshot.captionDocuments,
        };
        try {
          return executeLanguageCommand(languageTimeline, command);
        } catch (cause: unknown) {
          dispatch({
            type: "toast",
            toast: {
              id: globalThis.crypto.randomUUID(),
              tone: "danger",
              title: "Transcript or caption edit blocked",
              detail: cause instanceof Error ? cause.message : "Language authority rejected this edit.",
              correlationId: null,
            },
          });
          return null;
        }
      };
      if (client.sessionToken === null) {
        const result = execute(state.snapshot);
        if (result !== null) {
          dispatch({
            type: "language-local",
            transcripts: result.timeline.transcripts ?? [],
            captionDocuments: result.timeline.captionDocuments ?? [],
          });
        }
        return Promise.resolve();
      }
      return enqueueTimelineMutation(async (): Promise<void> => {
        let commandSnapshot = state.snapshot;
        try {
          const authoritative = await client.projectSnapshot();
          commandSnapshot = projectSnapshotFromPayload(commandSnapshot, authoritative) ?? commandSnapshot;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const project = commandSnapshot.project;
            if (project === null) return;
            const result = execute(commandSnapshot);
            if (result === null) return;
            const nonce = globalThis.crypto.randomUUID();
            try {
              await client.command(
                "/api/v1/commands",
                {
                  schemaVersion: "1.0.0",
                  commandId: `command-language-${nonce}`,
                  idempotencyId: `idempotency-language-${nonce}`,
                  actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
                  projectId: project.projectId,
                  correlationId: `correlation-language-${nonce}`,
                  issuedAt: new Date().toISOString(),
                  capability: { name: "language-edit", version: "1.0.0" },
                  payloadVersion: "1.0.0",
                  affectedEntityIds: result.affectedEntityIds,
                  declaredScope: "mutation",
                  validationOnly: false,
                  baseRevisionId: project.revisionId,
                  authorizationId: null,
                  kind: "language.edit",
                  payload: { operation: timelineCommandToJson(command) },
                },
                project.revisionId,
              );
              await resync();
              return;
            } catch (cause: unknown) {
              if (!(cause instanceof StaleRevisionError) || attempt > 0) throw cause;
              const authoritativeRetry = await client.projectSnapshot();
              const refreshed = projectSnapshotFromPayload(commandSnapshot, authoritativeRetry);
              if (refreshed === null) throw cause;
              commandSnapshot = refreshed;
            }
          }
        } catch (cause: unknown) {
          handleRuntimeError(cause, dispatch);
        }
      });
    },
    [client, enqueueTimelineMutation, resync, state.snapshot],
  );

  const moveTimelineHistory = useCallback(
    (direction: "undo" | "redo"): Promise<void> =>
      enqueueTimelineMutation(async (): Promise<void> => {
        if (client.sessionToken === null) {
          dispatch({ type: "timeline-history", direction });
          return;
        }
        let project = state.snapshot.project;
        try {
          const authoritative = await client.projectSnapshot();
          project = projectSnapshotFromPayload(state.snapshot, authoritative)?.project ?? project;
        } catch (cause: unknown) {
          handleRuntimeError(cause, dispatch);
          return;
        }
        if (project === null) return;
        const nonce = globalThis.crypto.randomUUID();
        try {
          await client.command(
            "/api/v1/commands",
            {
              schemaVersion: "1.0.0",
              commandId: `command-history-${nonce}`,
              idempotencyId: `idempotency-history-${nonce}`,
              actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
              projectId: project.projectId,
              correlationId: `correlation-history-${nonce}`,
              issuedAt: new Date().toISOString(),
              capability: { name: "timeline-edit", version: "1.0.0" },
              payloadVersion: "1.0.0",
              affectedEntityIds: [],
              declaredScope: "mutation",
              validationOnly: false,
              baseRevisionId: project.revisionId,
              authorizationId: null,
              kind: `history.${direction}`,
              payload: { steps: 1 },
            },
            project.revisionId,
          );
          dispatch({ type: "timeline-history", direction });
          await resync();
        } catch (cause: unknown) {
          handleRuntimeError(cause, dispatch);
        }
      }),
    [client, enqueueTimelineMutation, resync, state.snapshot],
  );

  const render = useCallback(() => {
    setWorkspace("deliver");
    dispatch({
      type: "toast",
      toast: {
        id: globalThis.crypto.randomUUID(),
        tone: "info",
        title: "Delivery workspace opened",
        detail:
          "Choose a profile, run the live preflight, then start a render from the current saved revision.",
        correlationId: null,
      },
    });
  }, [setWorkspace]);

  const selectAsset = useCallback((assetId: string): void => {
    dispatch({ type: "asset-selection", assetIds: [assetId] });
  }, []);

  const inspectAsset = useCallback(
    async (assetId: string): Promise<boolean> => {
      if (client.sessionToken === null || !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/u.test(assetId)) return false;
      try {
        await client.request(`/api/v1/assets/${encodeURIComponent(assetId)}/inspect`, { method: "POST" });
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "info",
            title: "Source validation queued",
            detail: `Inspection is running for ${assetId}.`,
            correlationId: null,
          },
        });
        return true;
      } catch (cause: unknown) {
        handleRuntimeError(cause, dispatch);
        return false;
      }
    },
    [client],
  );

  const relinkAsset = useCallback(
    async (assetId: string, sourcePath: string): Promise<boolean> => {
      const project = state.snapshot.project;
      if (client.sessionToken === null || project === null || sourcePath.trim().length === 0) return false;
      try {
        const receipt = await client.relinkAsset({
          assetId,
          sourcePath: sourcePath.trim(),
          baseRevisionId: project.revisionId,
          idempotencyId: `idempotency-asset-relink-${globalThis.crypto.randomUUID()}`,
        });
        if (receipt.status !== "committed") throw new Error("The asset relink was not committed.");
        await resync();
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "ready",
            title: "Asset relinked",
            detail: "The canonical project source path and content hash were revalidated and committed.",
            correlationId: null,
          },
        });
        return true;
      } catch (cause: unknown) {
        await resync();
        handleRuntimeError(cause, dispatch);
        return false;
      }
    },
    [client, resync, state.snapshot.project],
  );

  const importAssets = useCallback(
    async (files: readonly File[], rights: AssetRecord["rights"]): Promise<void> => {
      if (files.length === 0) return;
      const project = state.snapshot.project;
      if (client.sessionToken === null || project === null) {
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "danger",
            title: "Import unavailable",
            detail: "Launch the authenticated local Studio session before importing project media.",
            correlationId: null,
          },
        });
        return;
      }
      let baseRevisionId = project.revisionId;
      let importedCount = 0;
      let pendingValidationCount = 0;
      try {
        for (const file of files) {
          const nonce = globalThis.crypto.randomUUID();
          const result = await client.uploadAsset({
            file,
            assetId: `asset-${nonce}`,
            kind: assetKindForFile(file),
            rights,
            baseRevisionId,
            idempotencyId: `idempotency-asset-upload-${nonce}`,
          });
          if (result.receipt.status !== "committed" || result.receipt.resultingRevisionId === null) {
            throw new Error(`The server did not commit ${file.name}.`);
          }
          baseRevisionId = result.receipt.resultingRevisionId;
          if (result.asset.validationState !== "valid") pendingValidationCount += 1;
          importedCount += 1;
        }
        await resync();
        dispatch({
          type: "toast",
          toast: {
            id: globalThis.crypto.randomUUID(),
            tone: "ready",
            title: importedCount === 1 ? "Asset imported" : `${String(importedCount)} assets imported`,
            detail:
              pendingValidationCount === 0
                ? `Stored inside the project with ${rights} rights. Media validation passed.`
                : `Stored inside the project with ${rights} rights. ${String(pendingValidationCount)} asset${pendingValidationCount === 1 ? " requires" : "s require"} further validation.`,
            correlationId: null,
          },
        });
      } catch (cause: unknown) {
        await resync();
        handleRuntimeError(cause, dispatch);
      }
    },
    [client, resync, state.snapshot.project],
  );

  const refreshReliability = useCallback(async (): Promise<void> => {
    if (client.sessionToken === null) return;
    try {
      const payload = await client.reliabilityDiagnostics();
      dispatch({ type: "reliability", value: parseReliabilityDiagnostics(payload) });
    } catch (cause: unknown) {
      handleRuntimeError(cause, dispatch);
    }
  }, [client]);

  const prepareSupportBundlePreview = useCallback(async (): Promise<void> => {
    if (client.sessionToken === null || state.reliability === null) return;
    if (state.reliability.recordIds.length === 0) {
      dispatch({
        type: "toast",
        toast: {
          id: globalThis.crypto.randomUUID(),
          tone: "info",
          title: "Nothing selected",
          detail: "No local diagnostic records are available for a support-bundle preview.",
          correlationId: null,
        },
      });
      return;
    }
    try {
      await client.supportBundlePreview(state.reliability.recordIds);
      dispatch({
        type: "toast",
        toast: {
          id: globalThis.crypto.randomUUID(),
          tone: "ready",
          title: "Redaction preview prepared",
          detail:
            "Only the selected local records are included. Media, executable source, and secrets remain excluded.",
          correlationId: null,
        },
      });
    } catch (cause: unknown) {
      handleRuntimeError(cause, dispatch);
    }
  }, [client, state.reliability]);

  return {
    ...state,
    performance: performanceMonitor,
    dataSource,
    setWorkspace,
    setShellState,
    refreshRecentProjects,
    openProject,
    createProject,
    resync,
    capture,
    requestCapture,
    importAssets,
    inspectAsset,
    relinkAsset,
    selectAsset,
    dispatchMonitorCommand,
    dispatchTimelineCommand,
    dispatchAudioCommand,
    dispatchLanguageCommand,
    moveTimelineHistory,
    render,
    refreshReliability,
    prepareSupportBundlePreview,
    dismissToast: (id) => {
      dispatch({ type: "dismiss-toast", id });
    },
    setCommandPaletteOpen: (open) => {
      dispatch({ type: "command-palette", open });
    },
    setDiagnosticsOpen: (open) => {
      dispatch({ type: "diagnostics", open });
      if (open) void refreshReliability();
    },
  };
};

const initialRuntimeState = (): RuntimeState => {
  const query = new URLSearchParams(window.location.search);
  const workspaceValue = query.get("workspace");
  const stateValue = query.get("state");
  const workspace = workspaceIds.find((candidate) => candidate === workspaceValue) ?? "edit";
  const shellState = shellStateIds.find((candidate) => candidate === stateValue) ?? "ready";
  const snapshot =
    window.__CHAI_STUDIO_SESSION__ === undefined
      ? initialStudioSnapshot
      : { ...initialStudioSnapshot, project: null };
  return {
    workspace,
    shellState,
    snapshot,
    connection: {
      phase: "connecting",
      detail: "Connecting",
      attempts: 0,
      lastEventId: null,
      eventLagMs: 0,
    },
    diagnostic: null,
    toasts: [],
    commandPaletteOpen: false,
    diagnosticsOpen: false,
    reliability: null,
    timelineHistory: { undo: [], redo: [] },
    recentProjects: [],
  };
};

const runtimeReducer = (state: RuntimeState, action: RuntimeAction): RuntimeState => {
  switch (action.type) {
    case "workspace":
      return { ...state, workspace: action.workspace };
    case "shell-state":
      return { ...state, shellState: action.shellState };
    case "connection":
      return { ...state, connection: { ...state.connection, ...action.connection } };
    case "project-snapshot": {
      const projected = projectSnapshotFromPayload(state.snapshot, action.payload);
      return projected === null ? state : { ...state, snapshot: projected };
    }
    case "asset-selection":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          selection: { ...state.snapshot.selection, assetIds: action.assetIds },
        },
      };
    case "timeline-local":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          timeline: action.timeline,
          selection: { ...state.snapshot.selection, clipIds: action.timeline.selection.selectedIds },
        },
        timelineHistory: action.recordHistory
          ? {
              undo: [
                ...state.timelineHistory.undo.slice(-99),
                { snapshot: state.snapshot.timeline, label: action.label },
              ],
              redo: [],
            }
          : state.timelineHistory,
      };
    case "audio-local":
      return { ...state, snapshot: { ...state.snapshot, audioGraph: action.audioGraph } };
    case "language-local":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          transcripts: action.transcripts,
          captionDocuments: action.captionDocuments,
        },
      };
    case "timeline-history": {
      const source = state.timelineHistory[action.direction];
      const entry = source.at(-1);
      if (entry === undefined) return state;
      const destination = action.direction === "undo" ? "redo" : "undo";
      const nextHistory = {
        ...state.timelineHistory,
        [action.direction]: source.slice(0, -1),
        [destination]: [
          ...state.timelineHistory[destination].slice(-99),
          { snapshot: state.snapshot.timeline, label: entry.label },
        ],
      };
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          timeline: entry.snapshot,
          selection: { ...state.snapshot.selection, clipIds: entry.snapshot.selection.selectedIds },
        },
        timelineHistory: nextHistory,
      };
    }
    case "preview-state":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          preview: previewTruthFromPayload(state.snapshot.preview, unwrapPreviewState(action.payload)),
        },
      };
    case "preview-local":
      return { ...state, snapshot: { ...state.snapshot, preview: action.preview } };
    case "preview-tick":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          preview: advanceContractMockPreviewFrame(state.snapshot.preview),
        },
      };
    case "render-state":
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          render: renderTruthFromPayload(state.snapshot.render, action.payload),
        },
      };
    case "resynced":
      return {
        ...state,
        snapshot: { ...state.snapshot, serverSequence: state.snapshot.serverSequence + 1 },
      };
    case "event": {
      const lag = Math.max(0, Date.now() - Date.parse(action.event.occurredAt));
      const preview =
        action.event.type === "preview.state"
          ? previewTruthFromPayload(state.snapshot.preview, action.event.payload)
          : state.snapshot.preview;
      return {
        ...state,
        snapshot: { ...state.snapshot, preview, serverSequence: action.event.id },
        connection: {
          ...state.connection,
          phase: "online",
          detail: "Local · live",
          attempts: 0,
          lastEventId: action.event.id,
          eventLagMs: lag,
        },
      };
    }
    case "diagnostic":
      return { ...state, diagnostic: action.diagnostic };
    case "toast":
      return { ...state, toasts: [...state.toasts.slice(-3), action.toast] };
    case "dismiss-toast":
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case "command-palette":
      return { ...state, commandPaletteOpen: action.open };
    case "diagnostics":
      return { ...state, diagnosticsOpen: action.open };
    case "reliability":
      return { ...state, reliability: action.value };
    case "recent-projects":
      return { ...state, recentProjects: action.projects };
  }
};

const parseReliabilityDiagnostics = (
  payload: Readonly<Record<string, unknown>>,
): ReliabilityDiagnosticsView => {
  const status = payload.status;
  const details = isRecord(payload.details) ? payload.details : {};
  const privacy = isRecord(payload.privacy) ? payload.privacy : {};
  if (
    typeof payload.summary !== "string" ||
    (status !== "ready" && status !== "degraded" && status !== "blocked") ||
    typeof payload.issueCount !== "number"
  ) {
    throw new Error("Reliability diagnostics payload is invalid.");
  }
  const checks = Array.isArray(details.checks)
    ? details.checks.flatMap<ReliabilityDiagnosticsView["checks"][number]>((value) => {
        if (!isRecord(value)) return [];
        const state = value.state;
        const impact = value.impact;
        if (
          typeof value.id !== "string" ||
          typeof value.label !== "string" ||
          typeof value.summary !== "string" ||
          (state !== "passed" && state !== "warning" && state !== "failed") ||
          (impact !== "blocking" && impact !== "degraded" && impact !== "repairable")
        ) {
          return [];
        }
        return [
          {
            id: value.id,
            label: value.label,
            state,
            impact,
            summary: value.summary,
            repair: typeof value.repair === "string" ? value.repair : null,
          },
        ];
      })
    : [];
  const issues = Array.isArray(details.issues)
    ? details.issues.flatMap((value) => {
        if (
          !isRecord(value) ||
          typeof value.id !== "string" ||
          typeof value.code !== "string" ||
          typeof value.summary !== "string" ||
          typeof value.suggestedRepair !== "string"
        ) {
          return [];
        }
        return [
          {
            id: value.id,
            code: value.code,
            summary: value.summary,
            suggestedRepair: value.suggestedRepair,
            entityId: typeof value.entityId === "string" ? value.entityId : null,
          },
        ];
      })
    : [];
  const recordIds = Array.isArray(details.logs)
    ? details.logs.flatMap((value) => (isRecord(value) && typeof value.id === "string" ? [value.id] : []))
    : [];
  return {
    summary: payload.summary,
    status,
    affectedEntity: typeof payload.affectedEntity === "string" ? payload.affectedEntity : null,
    stage: typeof payload.stage === "string" ? payload.stage : null,
    frame: typeof payload.frame === "string" ? payload.frame : null,
    suggestedRepair: typeof payload.suggestedRepair === "string" ? payload.suggestedRepair : null,
    safeRetry: payload.safeRetry === true,
    inspectSource: payload.inspectSource === true,
    issueCount: payload.issueCount,
    checks,
    issues,
    recordIds,
    localOnly: privacy.localOnly === true,
    telemetryEnabled: privacy.telemetryEnabled === true,
  };
};

const unwrapPreviewState = (
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const state = payload.state;
  return isRecord(state) ? state : payload;
};

export const previewTruthFromPayload = (
  current: PreviewTruth,
  payload: Readonly<Record<string, unknown>>,
): PreviewTruth => {
  const truthMode = payload.truthMode;
  const transport = payload.transport;
  const warnings = parsePreviewWarnings(payload.warnings);
  const allowedTransport = new Set([
    "stopped",
    "loading",
    "paused",
    "playing",
    "seeking",
    "buffering",
    "error",
  ]);
  const timelineFps = parseRational(payload.timelineFps) ?? current.timelineFps;
  const currentFrame = typeof payload.currentFrame === "string" ? payload.currentFrame : current.masterFrame;
  const range = (value: unknown): PreviewTruth["loopRange"] => parsePreviewRange(value);
  const buffering = isRecord(payload.buffering) ? payload.buffering.status : undefined;
  const quality = payload.quality;
  return {
    ...current,
    masterFrame: currentFrame,
    durationFrames:
      typeof payload.durationFrames === "string" ? payload.durationFrames : current.durationFrames,
    timecode: formatMonitorTimecode(currentFrame, timelineFps),
    timelineFps,
    playRate: parseRational(payload.playRate) ?? current.playRate,
    stateVersion:
      typeof payload.stateVersion === "number" && Number.isSafeInteger(payload.stateVersion)
        ? payload.stateVersion
        : current.stateVersion,
    quality: quality === "draft" || quality === "balanced" || quality === "full" ? quality : current.quality,
    fidelityEquivalent:
      typeof payload.fidelityEquivalent === "boolean"
        ? payload.fidelityEquivalent
        : current.fidelityEquivalent,
    loopRange: Object.hasOwn(payload, "loopRange") ? range(payload.loopRange) : current.loopRange,
    inOutRange: Object.hasOwn(payload, "inOutRange") ? range(payload.inOutRange) : current.inOutRange,
    bufferingStatus:
      buffering === "idle" ||
      buffering === "ready" ||
      buffering === "waiting" ||
      buffering === "back-pressure" ||
      buffering === "error"
        ? buffering
        : current.bufferingStatus,
    mode:
      truthMode === "rendered-fidelity"
        ? "rendered-fidelity"
        : truthMode === "interactive-approximation"
          ? "interactive"
          : current.mode,
    source:
      truthMode === "rendered-fidelity"
        ? "original"
        : truthMode === "interactive-approximation"
          ? "proxy"
          : current.source,
    engineState: warnings.some((item) => item.code === "baked-fallback")
      ? "baked-fallback"
      : current.engineState,
    playback:
      typeof transport === "string" && allowedTransport.has(transport)
        ? (transport as PreviewTruth["playback"])
        : current.playback,
    droppedFrames:
      typeof payload.droppedFrames === "number" && Number.isSafeInteger(payload.droppedFrames)
        ? payload.droppedFrames
        : current.droppedFrames,
    warnings,
  };
};

const parseRational = (value: unknown): Readonly<{ numerator: string; denominator: string }> | null => {
  if (!isRecord(value) || typeof value.numerator !== "string" || typeof value.denominator !== "string") {
    return null;
  }
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value.numerator) || !/^[1-9][0-9]*$/.test(value.denominator)) {
    return null;
  }
  return { numerator: value.numerator, denominator: value.denominator };
};

const parsePreviewRange = (value: unknown): PreviewTruth["loopRange"] => {
  if (
    !isRecord(value) ||
    typeof value.startFrame !== "string" ||
    typeof value.endFrameExclusive !== "string"
  ) {
    return null;
  }
  return { startFrame: value.startFrame, endFrameExclusive: value.endFrameExclusive };
};

const parsePreviewWarnings = (value: unknown): readonly PreviewWarningView[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): readonly PreviewWarningView[] => {
    if (!isRecord(candidate) || !isRecord(candidate.remedy)) return [];
    const severity = candidate.severity;
    if (
      typeof candidate.code !== "string" ||
      (severity !== "info" && severity !== "warning" && severity !== "error") ||
      typeof candidate.message !== "string" ||
      (candidate.layerId !== null && typeof candidate.layerId !== "string") ||
      typeof candidate.remedy.label !== "string" ||
      typeof candidate.remedy.action !== "string"
    ) {
      return [];
    }
    return [
      {
        code: candidate.code,
        severity,
        message: candidate.message,
        layerId: candidate.layerId,
        remedy: { label: candidate.remedy.label, action: candidate.remedy.action },
      },
    ];
  });
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recentProjectsFromPayload = (value: unknown): readonly RecentProjectView[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): readonly RecentProjectView[] => {
    if (
      !isRecord(candidate) ||
      typeof candidate.projectId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.rootPath !== "string" ||
      typeof candidate.revisionId !== "string" ||
      typeof candidate.lastOpenedAt !== "string"
    ) {
      return [];
    }
    return [
      {
        projectId: candidate.projectId,
        title: candidate.title,
        rootPath: candidate.rootPath,
        revisionId: candidate.revisionId,
        lastOpenedAt: candidate.lastOpenedAt,
      },
    ];
  });
};

const timelineCommandToJson = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(timelineCommandToJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timelineCommandToJson(item)]));
  }
  return value;
};

const projectSnapshotFromPayload = (
  current: StudioSnapshot,
  payload: Readonly<Record<string, unknown>>,
): StudioSnapshot | null => {
  if (!isRecord(payload.project) || !isRecord(payload.pointer) || !isRecord(payload.timeline)) return null;
  if (
    typeof payload.project.projectId !== "string" ||
    typeof payload.project.title !== "string" ||
    typeof payload.pointer.revisionId !== "string"
  ) {
    return null;
  }
  try {
    const assets =
      isRecord(payload.assets) && Array.isArray(payload.assets.assets)
        ? (payload.assets.assets as unknown as readonly AssetRecord[])
        : current.assets;
    const assetKinds = new Map(assets.map((asset) => [asset.id, asset.kind] as const));
    const convertedTimeline = timelineDocumentToSnapshot(
      payload.timeline as unknown as Parameters<typeof timelineDocumentToSnapshot>[0],
    );
    const convertedClips = Object.fromEntries(
      Object.entries(convertedTimeline.clips).map(([clipId, clip]) => {
        const assetKind = clip.assetId === null ? undefined : assetKinds.get(clip.assetId);
        return [
          clipId,
          assetKind === undefined ? clip : { ...clip, metadata: { ...clip.metadata, assetKind } },
        ];
      }),
    ) as typeof convertedTimeline.clips;
    const assetAwareTimeline = { ...convertedTimeline, clips: convertedClips };
    const explicitRevision =
      typeof payload.revisionNumber === "number" && Number.isSafeInteger(payload.revisionNumber)
        ? payload.revisionNumber
        : null;
    const preservedSelectionIds = current.timeline.selection.selectedIds.filter(
      (id) => assetAwareTimeline.clips[id] !== undefined,
    );
    const selection =
      preservedSelectionIds.length === 0
        ? convertedTimeline.selection
        : {
            selectedIds: preservedSelectionIds,
            primaryId:
              current.timeline.selection.primaryId !== null &&
              preservedSelectionIds.includes(current.timeline.selection.primaryId)
                ? current.timeline.selection.primaryId
                : (preservedSelectionIds[0] ?? null),
            anchorId:
              current.timeline.selection.anchorId !== null &&
              preservedSelectionIds.includes(current.timeline.selection.anchorId)
                ? current.timeline.selection.anchorId
                : (preservedSelectionIds[0] ?? null),
          };
    const timeline = { ...assetAwareTimeline, selection };
    const selectedClipIds = selection.selectedIds;
    const assetIds = new Set(assets.map((asset) => asset.id));
    const selectedAssetIds = current.selection.assetIds.filter((assetId) => assetIds.has(assetId));
    const audioGraph = isRecord(payload.timeline.audioGraph)
      ? assertValidAudioGraph(payload.timeline.audioGraph as unknown as AudioGraphDocument)
      : current.audioGraph;
    const transcripts = Array.isArray(payload.timeline.transcripts)
      ? (payload.timeline.transcripts as unknown as readonly TranscriptDocument[])
      : current.transcripts;
    const captionDocuments = Array.isArray(payload.timeline.captionDocuments)
      ? (payload.timeline.captionDocuments as unknown as readonly CaptionDocument[])
      : current.captionDocuments;
    return {
      ...current,
      project: {
        projectId: payload.project.projectId,
        title: payload.project.title,
        revisionId: payload.pointer.revisionId,
        revisionNumber:
          explicitRevision ??
          (payload.pointer.revisionId === current.project?.revisionId
            ? current.project.revisionNumber
            : (current.project?.revisionNumber ?? 1)),
        saved: true,
        readOnly: false,
      },
      timeline,
      assets,
      audioGraph,
      transcripts,
      captionDocuments,
      selection: { clipIds: selectedClipIds, assetIds: selectedAssetIds },
    };
  } catch {
    return null;
  }
};

const assetKindForFile = (file: File): AssetRecord["kind"] => {
  const type = file.type.toLocaleLowerCase();
  const fileName = file.name.toLocaleLowerCase();
  const extension = fileName.split(".").at(-1) ?? "";
  if (fileName.endsWith(".chai-composition.json")) return "composition";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  if (["srt", "vtt", "ass", "ssa"].includes(extension)) return "caption";
  if (["html", "htm", "tsx", "jsx", "js", "mjs", "css"].includes(extension)) return "composition";
  return "data";
};

export const renderTruthFromPayload = (current: RenderTruth, payload: unknown): RenderTruth => {
  const records = Array.isArray(payload) ? (payload as readonly unknown[]) : [payload];
  const renderRecords = records.filter((candidate) => {
    if (!isRecord(candidate)) return false;
    const candidateJob = isRecord(candidate.job) ? candidate.job : candidate;
    return candidateJob.kind === "render.execute" || candidateJob.kind === "render.qa";
  });
  const record: unknown =
    renderRecords.find((candidate) => {
      if (!isRecord(candidate)) return false;
      const candidateJob = isRecord(candidate.job) ? candidate.job : candidate;
      return candidateJob.status === "running" || candidate.persistedStatus === "running";
    }) ??
    renderRecords.find((candidate) => {
      if (!isRecord(candidate)) return false;
      const candidateJob = isRecord(candidate.job) ? candidate.job : candidate;
      return candidateJob.status === "queued" || candidate.persistedStatus === "queued";
    }) ??
    renderRecords.at(-1);
  if (record === undefined) {
    if (!Array.isArray(payload)) return current;
    return {
      status: "idle",
      progress: 0,
      stage: "Ready",
      qa: "not-run",
      approval: "not-requested",
    };
  }
  if (!isRecord(record)) return current;
  const job = isRecord(record.job) ? record.job : record;
  if (job.kind !== "render.execute" && job.kind !== "render.qa") return current;
  const statusValue =
    typeof job.status === "string"
      ? job.status
      : typeof record.persistedStatus === "string"
        ? record.persistedStatus
        : "queued";
  const status: RenderTruth["status"] =
    statusValue === "queued"
      ? "queued"
      : statusValue === "running"
        ? "rendering"
        : statusValue === "completed"
          ? job.kind === "render.qa"
            ? "qa"
            : "complete"
          : statusValue === "cancelled"
            ? "idle"
            : "failed";
  const qaState = typeof record.qaState === "string" ? record.qaState : null;
  const qa: RenderTruth["qa"] =
    qaState === "qa_passed"
      ? "passed"
      : qaState === "qa_warning"
        ? "warning"
        : qaState === "qa_failed"
          ? "failed"
          : job.kind === "render.qa" && (statusValue === "queued" || statusValue === "running")
            ? "pending"
            : current.qa;
  return {
    status,
    progress:
      typeof job.progress === "number"
        ? Math.max(0, Math.min(1, job.progress))
        : typeof record.progress === "number"
          ? Math.max(0, Math.min(1, record.progress))
          : status === "complete"
            ? 1
            : current.progress,
    stage:
      typeof job.stage === "string"
        ? job.stage
        : typeof record.stage === "string"
          ? record.stage
          : status === "complete"
            ? "Rendered · QA not run"
            : current.stage,
    qa,
    approval: qaState === "approved" || qaState === "delivered" ? "approved" : current.approval,
  };
};

const requestExactCaptureJob = async (
  client: StudioApiClient,
  input: Readonly<{
    mode: "isolated-clip" | "before-effects" | "alpha" | "range" | "contact-sheet";
    masterFrame: string;
    inOutRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
    selectedClipIds: readonly string[];
  }>,
): Promise<Readonly<Record<string, unknown>>> => {
  const kind = {
    "isolated-clip": "isolated-selection",
    "before-effects": "before-effects",
    alpha: "alpha",
    range: "range",
    "contact-sheet": "contact-sheet",
  }[input.mode];
  const needsRange = input.mode === "range" || input.mode === "contact-sheet";
  if (needsRange && input.inOutRange === null) throw new Error("Mark In and Out before this capture.");
  const frames =
    input.mode === "range"
      ? everyFrame(input.inOutRange)
      : input.mode === "contact-sheet"
        ? sampledFrames(input.inOutRange, 6)
        : [input.masterFrame];
  const started = await client.request<Readonly<Record<string, unknown>>>("/api/v1/capture-jobs", {
    method: "POST",
    body: JSON.stringify({
      kind,
      frames,
      frameRange: needsRange ? input.inOutRange : null,
      isolatedEntityIds:
        input.mode === "isolated-clip" || input.mode === "before-effects" ? input.selectedClipIds : [],
    }),
  });
  const id = typeof started.id === "string" ? started.id : null;
  if (id === null) throw new Error("Exact capture job identity is missing.");
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const state = await client.request<Readonly<Record<string, unknown>>>(`/api/v1/capture-jobs/${id}`, {
      method: "GET",
    });
    if (state.status === "completed" && isRecord(state.manifest)) return state.manifest;
    if (state.status === "failed") {
      throw new Error(typeof state.error === "string" ? state.error : "Exact capture job failed.");
    }
    if (state.status === "cancelled") throw new Error("Exact capture job was cancelled.");
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 150);
    });
  }
  throw new Error("Exact capture job timed out.");
};

const everyFrame = (
  range: Readonly<{ startFrame: string; endFrameExclusive: string }> | null,
): readonly string[] => {
  if (range === null) return [];
  const start = BigInt(range.startFrame);
  const end = BigInt(range.endFrameExclusive);
  if (end - start > 900n) throw new Error("Review range capture is limited to 900 frames.");
  const result: string[] = [];
  for (let frame = start; frame < end; frame += 1n) result.push(frame.toString(10));
  return result;
};

const sampledFrames = (
  range: Readonly<{ startFrame: string; endFrameExclusive: string }> | null,
  targetCount: number,
): readonly string[] => {
  if (range === null) return [];
  const start = BigInt(range.startFrame);
  const end = BigInt(range.endFrameExclusive);
  const frameCount = end - start;
  const count = Math.min(targetCount, Number(frameCount));
  if (count < 2) throw new Error("Contact sheet range must contain at least two frames.");
  return Array.from({ length: count }, (_, index) =>
    (start + (BigInt(index) * (frameCount - 1n)) / BigInt(count - 1)).toString(10),
  );
};

const captureCompletionDetail = (
  mode: MonitorCaptureMode,
  includeOverlays: boolean,
  source: SourceInspectionState | undefined,
): string => {
  if (mode === "exact-fidelity") return "Rendered fidelity — review overlays excluded by design.";
  if (mode === "source-frame") {
    return `Original source evidence${source === undefined ? "" : ` · ${source.sourceId} frame ${source.currentFrame}`}.`;
  }
  if (mode === "isolated-clip") return "Final-compositor frame with only the selected visual clip.";
  if (mode === "before-effects") return "Final-compositor source with shared properties reset to defaults.";
  if (mode === "alpha") return "Final-compositor PNG with transparent background preserved.";
  if (mode === "range") return "Final-compositor PNG sequence for the marked I/O range.";
  if (mode === "contact-sheet") return "Contact sheet built from exact final-compositor samples.";
  if (mode === "comparison") return "Interactive A/B review evidence — not final-render truth.";
  return includeOverlays
    ? "Review evidence — overlays included."
    : "Clean preview frame — overlays excluded.";
};

const requestExactFidelityCapture = async (
  client: StudioApiClient,
  preview: PreviewTruth,
  projectTitle: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const snapshot = await client.projectSnapshot();
  const pointer = isRecord(snapshot.pointer) ? snapshot.pointer : null;
  const revisionId = typeof pointer?.revisionId === "string" ? pointer.revisionId : null;
  if (revisionId === null) throw new Error("Exact capture could not resolve the authoritative revision.");
  const profiles = await client.request<readonly Readonly<Record<string, unknown>>[]>(
    "/api/v1/renders/profiles",
    { method: "GET" },
  );
  const profile = profiles.find((candidate) => candidate.id === "profile-still-png");
  if (profile === undefined) throw new Error("The authoritative PNG still profile is unavailable.");
  const scope = { kind: "frame", frame: preview.masterFrame } as const;
  const preflight = await client.request<Readonly<Record<string, unknown>>>("/api/v1/renders/preflight", {
    method: "POST",
    body: JSON.stringify({ profile, scope, expectedRevisionId: revisionId }),
  });
  if (preflight.executable !== true) {
    const findingsValue: unknown = preflight.findings;
    const findings: readonly unknown[] = Array.isArray(findingsValue) ? findingsValue : [];
    const finding = findings.find((candidate) => isRecord(candidate) && candidate.blocking === true);
    const title =
      isRecord(finding) && typeof finding.title === "string" ? finding.title : "preflight blocked";
    throw new Error(`Exact capture unavailable: ${title}.`);
  }
  const queued = await client.request<Readonly<Record<string, unknown>>>("/api/v1/renders", {
    method: "POST",
    body: JSON.stringify({
      profile,
      scope,
      name: `${projectTitle} · Exact capture · frame ${preview.masterFrame}`,
      priority: 10,
      actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
      expectedRevisionId: revisionId,
    }),
  });
  const request = isRecord(queued.request) ? queued.request : null;
  const renderRequestId = typeof request?.id === "string" ? request.id : null;
  if (renderRequestId === null) throw new Error("Exact capture render request identity is missing.");
  const output = await waitForRenderOutput(client, renderRequestId);
  const outputId = typeof output.id === "string" ? output.id : null;
  const activationRevisionId =
    typeof output.activationRevisionId === "string" ? output.activationRevisionId : null;
  if (outputId === null || activationRevisionId === null) {
    throw new Error("Exact capture output identity is incomplete.");
  }
  let previewStateVersion = await waitForSynchronizedPreview(
    client,
    activationRevisionId,
    preview.masterFrame,
  );
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.request<Readonly<Record<string, unknown>>>("/api/v1/captures/from-render", {
        method: "POST",
        body: JSON.stringify({
          outputId,
          expectedPreviewStateVersion: previewStateVersion,
          label: "Exact fidelity frame · clean frame · review overlays excluded",
        }),
      });
    } catch (cause: unknown) {
      if (!(cause instanceof StaleRevisionError) || attempt > 0) throw cause;
      previewStateVersion = await waitForSynchronizedPreview(
        client,
        activationRevisionId,
        preview.masterFrame,
      );
    }
  }
};

const waitForRenderOutput = async (
  client: StudioApiClient,
  renderRequestId: string,
): Promise<Readonly<Record<string, unknown>>> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const outputs = await client.request<readonly Readonly<Record<string, unknown>>[]>(
      "/api/v1/renders/outputs",
      { method: "GET" },
    );
    const output = outputs.find((candidate) => candidate.renderRequestId === renderRequestId);
    if (output !== undefined) return output;
    const queue = await client.request<readonly Readonly<Record<string, unknown>>[]>(
      "/api/v1/renders/queue",
      { method: "GET" },
    );
    const item = queue.find(
      (candidate) => isRecord(candidate.request) && candidate.request.id === renderRequestId,
    );
    if (item?.persistedStatus === "failed" || item?.persistedStatus === "cancelled") {
      throw new Error(`Exact capture render ${item.persistedStatus}.`);
    }
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 100);
    });
  }
  throw new Error("Exact capture render did not finish within 20 seconds.");
};

const waitForSynchronizedPreview = async (
  client: StudioApiClient,
  revisionId: string,
  frame: string,
): Promise<number> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const payload = await client.previewSnapshot();
    const state = unwrapPreviewState(payload);
    if (
      payload.synchronized === true &&
      state.revisionId === revisionId &&
      state.currentFrame === frame &&
      typeof state.stateVersion === "number"
    ) {
      return state.stateVersion;
    }
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 50);
    });
  }
  throw new Error("Exact capture output completed, but preview revision synchronization timed out.");
};

const handleRuntimeError = (cause: unknown, dispatch: (action: RuntimeAction) => void): void => {
  if (cause instanceof StudioApiError) {
    dispatch({ type: "diagnostic", diagnostic: cause.diagnostic });
    if (cause.diagnostic.code.includes("revision")) dispatch({ type: "shell-state", shellState: "conflict" });
    return;
  }
  dispatch({
    type: "diagnostic",
    diagnostic: {
      category: "internal",
      code: "client.unexpected",
      stage: "studio-web",
      entityId: null,
      retryable: true,
      message: cause instanceof Error ? cause.message : "An unexpected client error occurred.",
      repairHint: "Resync the workspace.",
      correlationId: globalThis.crypto.randomUUID(),
      detail: null,
    },
  });
};

const dispatchTimelineFailureToast = (cause: unknown, dispatch: (action: RuntimeAction) => void): void => {
  const detail =
    cause instanceof StudioApiError
      ? `${cause.diagnostic.message}${cause.diagnostic.repairHint === null ? "" : ` ${cause.diagnostic.repairHint}`}`
      : cause instanceof Error
        ? cause.message
        : "The local Studio server did not accept the edit.";
  dispatch({
    type: "toast",
    toast: {
      id: globalThis.crypto.randomUUID(),
      tone: "danger",
      title: "Timeline edit not applied",
      detail,
      correlationId: cause instanceof StudioApiError ? cause.diagnostic.correlationId : null,
    },
  });
};

declare global {
  interface Window {
    readonly __CHAI_STUDIO_SESSION__?: {
      readonly token: string;
      readonly serverOrigin: string;
    };
  }
}
