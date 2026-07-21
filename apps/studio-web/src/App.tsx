import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Badge, Button, EmptyState, IconButton, Notice, StatusPill } from "@chai-studio/ui-components";
import { resolvePreviewDegradation, type PreviewDegradationLevel } from "@chai-studio/preview/degradation";
import { studioReleaseIdentity } from "@chai-studio/diagnostics/release";
import { createFrameRange, masterFrame, stableEntityId } from "@chai-studio/timeline/browser";
import { ErrorBoundary } from "./ErrorBoundary.js";
import {
  defaultLayouts,
  fullLayoutViewport,
  loadWorkspaceLayout,
  normalizeLayout,
  saveWorkspaceLayout,
  type WorkspaceLayout,
} from "./layout-store.js";
import { findShortcutConflicts, formatShortcut, shortcutForEvent, type StudioShortcut } from "./shortcuts.js";
import {
  applyShortcutProfile,
  loadShortcutProfile,
  saveShortcutProfile,
  type ShortcutProfile,
} from "./shortcut-profile.js";
import { ShortcutEditor } from "./shortcut-editor.js";
import {
  applyAccessibilityPreferences,
  loadAccessibilityPreferences,
  saveAccessibilityPreferences,
  type AccessibilityPreferences,
} from "./accessibility.js";
import { projectRevisionLabel, type ShellStateId, type WorkspaceId } from "./types.js";
import { useStudioRuntime, type RecentProjectView } from "./use-studio-runtime.js";
import type { StudioDataSource } from "./runtime-mode.js";
import { monitorCommandForShortcut, type MonitorComparisonMode } from "./monitor-contract.js";
import { DeliveryWorkspaceProvider } from "./delivery-workspace.js";
import { ModalDialog } from "./modal-dialog.js";
import {
  WorkspaceCenter,
  WorkspaceLeftPanel,
  WorkspaceLowerPanel,
  WorkspaceRightPanel,
  type WorkspaceMonitorActions,
} from "./workspace-content.js";
import { ChaiIcon, type ChaiIconName } from "./chai-icon.js";
import { ChaiBrandMark } from "./chai-brand.js";

const workspaceLabels: Readonly<Record<WorkspaceId, string>> = {
  edit: "Edit",
  inspect: "Inspect",
  media: "Media",
  animation: "Animation",
  deliver: "Deliver",
};

const workspaceOrder = Object.keys(workspaceLabels) as WorkspaceId[];
const workspaceIcons: Readonly<Record<WorkspaceId, ChaiIconName>> = {
  edit: "workspace-edit",
  inspect: "workspace-inspect",
  media: "workspace-media",
  animation: "workspace-animation",
  deliver: "workspace-deliver",
};
type CompactSurface = "browser" | "main" | "inspector" | "timeline";

const compactSurfaceLabels: Readonly<Record<WorkspaceId, Readonly<Record<CompactSurface, string>>>> = {
  edit: { browser: "Media", main: "Monitor", inspector: "Inspector", timeline: "Timeline" },
  inspect: { browser: "Review", main: "Monitor", inspector: "Inspector", timeline: "Contact sheet" },
  media: { browser: "Browser", main: "Assets", inspector: "Inspector", timeline: "Source" },
  animation: { browser: "Properties", main: "Monitor", inspector: "Inspector", timeline: "Curves" },
  deliver: { browser: "Profiles", main: "Queue", inspector: "Receipt", timeline: "Timeline" },
};

const compactSurfaceOrder: readonly CompactSurface[] = ["browser", "main", "inspector", "timeline"];
const compactSurfaceIcons: Readonly<Record<WorkspaceId, Readonly<Record<CompactSurface, ChaiIconName>>>> = {
  edit: {
    browser: "workspace-media",
    main: "workspace-edit",
    inspector: "metadata",
    timeline: "render-timeline",
  },
  inspect: { browser: "review-bundle", main: "capture-ab", inspector: "metadata", timeline: "contact-sheet" },
  media: { browser: "folder", main: "footage", inspector: "metadata", timeline: "footage" },
  animation: {
    browser: "animated-property",
    main: "workspace-animation",
    inspector: "metadata",
    timeline: "curve-editor",
  },
  deliver: {
    browser: "delivery-profile",
    main: "render-queue",
    inspector: "receipt",
    timeline: "render-timeline",
  },
};
const applicationBootStartedAt = performance.now();

export const App = () => {
  const renderStartedAt = performance.now();
  const runtime = useStudioRuntime();
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspaceLayout(runtime.workspace));
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [shortcutProfile, setShortcutProfile] = useState<ShortcutProfile>(loadShortcutProfile);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [accessibility, setAccessibility] = useState<AccessibilityPreferences>(loadAccessibilityPreferences);
  const [requestedDegradation, setRequestedDegradation] = useState<PreviewDegradationLevel>(0);
  const [animationPropertyPath, setAnimationPropertyPath] = useState("transform.opacity");
  const [comparisonMode, setComparisonMode] = useState<MonitorComparisonMode>("split");
  const [mediaBrowserSelection, setMediaBrowserSelection] = useState("Footage");
  const [welcomeDismissed, setWelcomeDismissed] = useState(loadWelcomeDismissed);
  const [compactSurface, setCompactSurface] = useState<CompactSurface>("main");
  const shellRef = useRef<HTMLDivElement>(null);
  const [compactLayout, setCompactLayout] = useState(
    () => window.innerWidth < fullLayoutViewport.width || window.innerHeight < fullLayoutViewport.height,
  );
  const coldStartRecorded = useRef(false);
  const shortcuts = useMemo(() => applyShortcutProfile(shortcutProfile), [shortcutProfile]);
  const degradation = useMemo(
    () =>
      resolvePreviewDegradation({
        requestedLevel: requestedDegradation,
        droppedFrames: runtime.snapshot.preview.droppedFrames,
        loadClass: runtime.snapshot.preview.droppedFrames > 12 ? "critical" : "elevated",
        renderRangeAvailable: runtime.snapshot.preview.inOutRange !== null,
      }),
    [requestedDegradation, runtime.snapshot.preview.droppedFrames, runtime.snapshot.preview.inOutRange],
  );

  useEffect(() => {
    setLayout(loadWorkspaceLayout(runtime.workspace));
  }, [runtime.workspace]);

  useEffect(() => {
    const update = () => {
      setCompactLayout(
        window.innerWidth < fullLayoutViewport.width || window.innerHeight < fullLayoutViewport.height,
      );
    };
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    saveWorkspaceLayout(runtime.workspace, layout);
  }, [layout, runtime.workspace]);

  useEffect(() => {
    saveShortcutProfile(shortcutProfile);
  }, [shortcutProfile]);

  useEffect(() => {
    saveAccessibilityPreferences(accessibility);
    if (shellRef.current !== null) applyAccessibilityPreferences(shellRef.current, accessibility);
  }, [accessibility]);

  useEffect(() => {
    if (coldStartRecorded.current) return;
    coldStartRecorded.current = true;
    runtime.performance.record("cold-start", performance.now() - applicationBootStartedAt, {
      dataSource: runtime.dataSource,
    });
  }, [runtime.dataSource, runtime.performance]);

  useEffect(() => {
    if (runtime.workspace !== "animation") return;
    const primaryId = runtime.snapshot.timeline.selection.primaryId;
    const clip = primaryId === null ? undefined : runtime.snapshot.timeline.clips[primaryId];
    if (clip === undefined) return;
    const current = BigInt(runtime.snapshot.preview.masterFrame);
    if (current < clip.range.start || current >= clip.range.end) {
      void runtime.dispatchMonitorCommand({ kind: "seek-frame", frame: clip.range.start.toString(10) });
    }
  }, [runtime.workspace, runtime.snapshot.timeline.selection.primaryId]);

  useEffect(() => {
    runtime.performance.record("react-commit", performance.now() - renderStartedAt, {
      workspace: runtime.workspace,
    });
  });

  const resetLayout = useCallback(() => {
    setLayout(defaultLayouts[runtime.workspace]);
  }, [runtime.workspace]);

  const executeShortcut = useCallback(
    (commandId: string) => {
      const workspaceCommand = /^workspace\.(.+)$/.exec(commandId)?.[1] as WorkspaceId | undefined;
      if (workspaceCommand !== undefined && workspaceOrder.includes(workspaceCommand)) {
        runtime.setWorkspace(workspaceCommand);
        return;
      }
      const monitorCommand = monitorCommandForShortcut(commandId);
      if (monitorCommand !== null) void runtime.dispatchMonitorCommand(monitorCommand);
      else if (commandId === "capture.exact") void runtime.requestCapture("exact-fidelity", false);
      else if (commandId === "history.undo") void runtime.moveTimelineHistory("undo");
      else if (commandId === "history.redo") void runtime.moveTimelineHistory("redo");
      else if (
        commandId === "timeline.delete" &&
        runtime.snapshot.timeline.selection.selectedIds.length > 0
      ) {
        void runtime.dispatchTimelineCommand({
          kind: "clips.delete",
          clipIds: runtime.snapshot.timeline.selection.selectedIds,
        });
      } else if (commandId === "timeline.nudge-left" || commandId === "timeline.nudge-right") {
        const delta = commandId === "timeline.nudge-left" ? -1n : 1n;
        const clips = runtime.snapshot.timeline.selection.selectedIds.flatMap((id) => {
          const clip = runtime.snapshot.timeline.clips[id];
          return clip === undefined ? [] : [clip];
        });
        if (clips.length > 0 && clips.every((clip) => clip.range.start + delta >= 0n)) {
          void runtime.dispatchTimelineCommand({
            kind: "clips.move",
            moves: clips.map((clip) => ({
              clipId: clip.id,
              trackId: clip.trackId,
              start: masterFrame(clip.range.start + delta),
            })),
          });
        }
      } else if (commandId === "timeline.split") {
        const atFrame = masterFrame(BigInt(runtime.snapshot.preview.masterFrame));
        const splits = runtime.snapshot.timeline.selection.selectedIds.flatMap((id) => {
          const clip = runtime.snapshot.timeline.clips[id];
          return clip !== undefined && clip.range.start < atFrame && atFrame < clip.range.end
            ? [{ clipId: clip.id, rightClipId: stableEntityId(`clip-split-${crypto.randomUUID()}`) }]
            : [];
        });
        if (splits.length > 0) void runtime.dispatchTimelineCommand({ kind: "clips.split", atFrame, splits });
      } else if (
        commandId === "timeline.roll-left" ||
        commandId === "timeline.roll-right" ||
        commandId === "timeline.slip-left" ||
        commandId === "timeline.slip-right" ||
        commandId === "timeline.slide-left" ||
        commandId === "timeline.slide-right"
      ) {
        const timeline = runtime.snapshot.timeline;
        const primaryId = timeline.selection.primaryId;
        const primary = primaryId === null ? undefined : timeline.clips[primaryId];
        if (primary === undefined) return;
        const ordered = (timeline.tracks[primary.trackId]?.clipIds ?? [])
          .map((id) => timeline.clips[id])
          .filter((clip) => clip !== undefined)
          .sort((left, right) => (left.range.start < right.range.start ? -1 : 1));
        const index = ordered.findIndex((clip) => clip.id === primary.id);
        const right = ordered[index + 1];
        const delta = commandId.endsWith("left") ? -1n : 1n;
        if (commandId.startsWith("timeline.roll")) {
          if (right === undefined) return;
          void runtime.dispatchTimelineCommand({
            kind: "clips.roll",
            leftClipId: primary.id,
            rightClipId: right.id,
            boundary: masterFrame(primary.range.end + delta),
            includeLinked: true,
          });
        } else if (commandId.startsWith("timeline.slip")) {
          void runtime.dispatchTimelineCommand({
            kind: "clip.slip",
            clipId: primary.id,
            deltaTimelineFrames: masterFrame(delta, true),
            includeLinked: true,
          });
        } else {
          void runtime.dispatchTimelineCommand({
            kind: "clip.slide",
            clipId: primary.id,
            start: masterFrame(primary.range.start + delta),
            includeLinked: true,
          });
        }
      } else if (commandId === "layout.reset") resetLayout();
      else if (commandId === "command-palette.open") runtime.setCommandPaletteOpen(true);
    },
    [resetLayout, runtime],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && runtime.commandPaletteOpen) {
        event.preventDefault();
        runtime.setCommandPaletteOpen(false);
        return;
      }
      if (event.key === "Escape" && statusMenuOpen) {
        event.preventDefault();
        setStatusMenuOpen(false);
        return;
      }
      const shortcut = shortcutForEvent(event, shortcuts, runtime.workspace);
      if (shortcut === null) return;
      event.preventDefault();
      executeShortcut(shortcut.commandId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [executeShortcut, runtime, shortcuts, statusMenuOpen]);

  const shellStyle = useMemo(
    () =>
      ({
        "--left-panel": layout.leftCollapsed ? "0px" : `${String(layout.leftWidth)}px`,
        "--right-panel": layout.rightCollapsed ? "0px" : `${String(layout.rightWidth)}px`,
        "--lower-panel": layout.lowerCollapsed ? "0px" : `${String(layout.lowerHeight)}px`,
      }) as CSSProperties,
    [layout],
  );

  const project = runtime.snapshot.project;
  const activeCompactSurface =
    runtime.workspace === "deliver" && compactSurface === "timeline" ? "main" : compactSurface;
  const isShowcaseProject = runtime.snapshot.assets.some((asset) =>
    asset.id.startsWith("asset-chai-showcase-"),
  );
  const showWelcome =
    runtime.dataSource === "server" &&
    runtime.shellState === "ready" &&
    isShowcaseProject &&
    !welcomeDismissed;
  const renderActive = runtime.snapshot.render.status === "rendering";
  const monitorActions = useMemo<WorkspaceMonitorActions>(
    () => ({
      authoritativeCaptureAvailable: runtime.dataSource === "server",
      comparisonMode,
      selectComparisonMode: setComparisonMode,
      command: (command) => {
        void (async () => {
          const preview = await runtime.dispatchMonitorCommand(command);
          if (command.kind !== "mark-in" && command.kind !== "mark-out") return;
          const range = preview.inOutRange;
          if (range === null) return;
          await runtime.dispatchTimelineCommand({
            kind: "range.set",
            range: createFrameRange(
              masterFrame(BigInt(range.startFrame)),
              masterFrame(BigInt(range.endFrameExclusive)),
            ),
          });
        })();
      },
      capture: (mode, includeOverlays, source) => {
        void runtime.requestCapture(mode, includeOverlays, source);
      },
      timeline: (command) => void runtime.dispatchTimelineCommand(command),
      audio: (command) => void runtime.dispatchAudioCommand(command),
      language: (command) => void runtime.dispatchLanguageCommand(command),
      timelineHistory: (direction) => void runtime.moveTimelineHistory(direction),
      timelineUndoLabel: runtime.timelineHistory.undo.at(-1)?.label ?? null,
      timelineRedoLabel: runtime.timelineHistory.redo.at(-1)?.label ?? null,
      animationPropertyPath,
      selectAnimationProperty: setAnimationPropertyPath,
      mediaBrowserSelection,
      selectMediaBrowser: setMediaBrowserSelection,
      navigateWorkspace: runtime.setWorkspace,
      importAssets: (files, rights) => {
        void runtime.importAssets(files, rights);
      },
      inspectAsset: runtime.inspectAsset,
      relinkAsset: runtime.relinkAsset,
      selectAsset: runtime.selectAsset,
    }),
    [animationPropertyPath, comparisonMode, mediaBrowserSelection, runtime],
  );
  if (runtime.dataSource === "unauthenticated") {
    return <AuthenticatedLaunchRequired />;
  }
  return (
    <DeliveryWorkspaceProvider snapshot={runtime.snapshot}>
      <main
        className="studio-app"
        ref={shellRef}
        style={shellStyle}
        data-workspace={runtime.workspace}
        data-compact-layout={compactLayout ? "true" : "false"}
        data-compact-surface={activeCompactSurface}
      >
        <header className="studio-topbar">
          <div className="brand-block">
            <span className="brand-icon" aria-hidden="true">
              <ChaiBrandMark />
            </span>
            <h1>Chai Studio</h1>
          </div>
          <button
            className="project-identity"
            type="button"
            data-revision-id={project?.revisionId}
            data-revision-number={project?.revisionNumber}
            onClick={() => {
              runtime.setDiagnosticsOpen(true);
            }}
          >
            <ChaiIcon name="diagnostics-truth" size={16} />
            <strong>{project?.title ?? "No project"}</strong>
            <span>/</span>
            <span>{project === null ? "Connecting to project" : projectRevisionLabel(project)}</span>
          </button>
          <nav className="workspace-switcher" aria-label="Studio workspaces">
            {workspaceOrder.map((workspace) => (
              <button
                className={runtime.workspace === workspace ? "active" : ""}
                type="button"
                aria-current={runtime.workspace === workspace ? "page" : undefined}
                onClick={() => {
                  runtime.setWorkspace(workspace);
                }}
                key={workspace}
              >
                <ChaiIcon name={workspaceIcons[workspace]} size={16} />
                <span>{workspaceLabels[workspace]}</span>
              </button>
            ))}
          </nav>
          <div className="topbar-truth">
            <button
              className="truth-status"
              type="button"
              aria-controls="studio-truth-popover"
              aria-expanded={statusMenuOpen}
              onClick={() => {
                setStatusMenuOpen((open) => !open);
              }}
            >
              <StatusPill
                tone={runtime.connection.phase === "online" ? (renderActive ? "working" : "info") : "danger"}
              >
                <ChaiIcon
                  name={
                    runtime.connection.phase !== "online"
                      ? "status-danger"
                      : renderActive
                        ? "status-working"
                        : "status-info"
                  }
                  size={14}
                />
                {runtime.dataSource === "ui-fixture" ? "UI fixture · " : ""}
                {renderActive
                  ? `${runtime.snapshot.render.status} · ${runtime.snapshot.render.stage}`
                  : `${runtime.snapshot.preview.mode === "interactive" ? "Interactive" : "Rendered fidelity"} · ${runtime.snapshot.preview.source === "proxy" ? "Proxy" : "Original"}`}
              </StatusPill>
            </button>
            <code className="global-timecode">{runtime.snapshot.preview.timecode}</code>
            <Button
              aria-label={
                runtime.dataSource === "ui-fixture" ? "Authoritative capture unavailable" : "Capture exact"
              }
              disabled={runtime.dataSource === "ui-fixture"}
              onClick={runtime.capture}
              title={
                runtime.dataSource === "ui-fixture"
                  ? "Authoritative capture requires the authenticated local Studio session."
                  : "Render and save an authoritative clean PNG."
              }
            >
              <ChaiIcon name="capture-exact" size={16} />
              Capture
              <span className="topbar-capture-detail">
                {runtime.dataSource === "ui-fixture" ? " unavailable" : " exact"}
              </span>{" "}
              <kbd>C</kbd>
            </Button>
            <Button variant="primary" onClick={runtime.render}>
              <ChaiIcon name="render" size={16} />
              {runtime.workspace === "deliver" ? "New render" : "Render"}
            </Button>
          </div>
          {statusMenuOpen ? (
            <div
              className="truth-popover"
              id="studio-truth-popover"
              role="region"
              aria-label="Persistent production truth"
            >
              <strong>Persistent production truth</strong>
              <TruthRow
                label="Server"
                value={runtime.connection.detail}
                tone={runtime.connection.phase === "online" ? "ready" : "danger"}
              />
              <TruthRow
                label="Frame"
                value={`${runtime.snapshot.preview.masterFrame} · ${runtime.snapshot.preview.timecode}`}
              />
              <TruthRow
                label="Preview"
                value={`${runtime.snapshot.preview.mode} · ${runtime.snapshot.preview.engineState}`}
                tone="info"
              />
              <TruthRow
                label="Render"
                value={`${runtime.snapshot.render.status} · QA ${runtime.snapshot.render.qa}`}
                tone={runtime.snapshot.render.qa === "failed" ? "danger" : "neutral"}
              />
              <TruthRow
                label="Realtime"
                value={
                  degradation.level === 0
                    ? "Within measured budget"
                    : `${String(degradation.droppedFrames)} dropped · ${degradation.step}`
                }
                tone={degradation.level === 0 ? "ready" : "danger"}
              />
              {degradation.visible ? (
                <div className="degradation-controls" aria-label="Honest preview degradation">
                  <p>{degradation.message}</p>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRequestedDegradation(degradation.previousLevel);
                    }}
                  >
                    Restore one step
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRequestedDegradation(degradation.nextLevel);
                    }}
                  >
                    Degrade safely
                  </Button>
                  <Button
                    variant="ghost"
                    disabled
                    title="Preview-range rendering requires the authoritative timeline compositor."
                  >
                    Preview render unavailable
                  </Button>
                </div>
              ) : null}
              {runtime.snapshot.preview.warnings.length > 0 ? (
                <div className="preview-warning-list" aria-label="Preview warnings">
                  {runtime.snapshot.preview.warnings.slice(0, 3).map((warning) => (
                    <div
                      className={`preview-warning ${warning.severity}`}
                      key={`${warning.code}:${warning.layerId ?? "all"}`}
                    >
                      <span>{warning.message}</span>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          runtime.setDiagnosticsOpen(true);
                          setStatusMenuOpen(false);
                        }}
                      >
                        {warning.remedy.label}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  runtime.setDiagnosticsOpen(true);
                }}
              >
                Open diagnostics
              </Button>
            </div>
          ) : null}
        </header>

        <nav className="compact-surface-switcher" aria-label="Compact editor surfaces">
          {compactSurfaceOrder.map((surface) => {
            const unavailable = runtime.workspace === "deliver" && surface === "timeline";
            return (
              <button
                type="button"
                aria-pressed={activeCompactSurface === surface}
                disabled={unavailable}
                title={unavailable ? "Deliver has no lower timeline surface." : undefined}
                onClick={() => {
                  setCompactSurface(surface);
                }}
                key={surface}
              >
                <ChaiIcon name={compactSurfaceIcons[runtime.workspace][surface]} size={16} />
                {compactSurfaceLabels[runtime.workspace][surface]}
              </button>
            );
          })}
        </nav>

        <section className="studio-workspace" aria-label={`${workspaceLabels[runtime.workspace]} workspace`}>
          <aside
            aria-label={`${workspaceLabels[runtime.workspace]} browser panel`}
            className={
              !compactLayout && layout.leftCollapsed
                ? "studio-panel left-panel collapsed"
                : "studio-panel left-panel"
            }
          >
            <PanelCollapse
              label={layout.leftCollapsed ? "Expand left panel" : "Collapse left panel"}
              direction={layout.leftCollapsed ? "right" : "left"}
              onClick={() => {
                setLayout((value) => ({ ...value, leftCollapsed: !value.leftCollapsed }));
              }}
            />
            <ErrorBoundary area={`${workspaceLabels[runtime.workspace]} browser`}>
              <WorkspaceLeftPanel
                workspace={runtime.workspace}
                snapshot={runtime.snapshot}
                monitorActions={monitorActions}
              />
            </ErrorBoundary>
          </aside>
          <ResizeHandle
            axis="x"
            edge="left"
            label="Resize left browser panel"
            value={layout.leftWidth}
            minimum={180}
            maximum={Math.max(220, Math.floor(window.innerWidth * 0.34))}
            disabled={layout.leftCollapsed}
            onResize={(delta) => {
              setLayout((value) =>
                normalizeLayout(
                  { ...value, leftWidth: value.leftWidth + delta },
                  defaultLayouts[runtime.workspace],
                  window.innerWidth,
                  window.innerHeight,
                ),
              );
            }}
          />
          <section className="center-stage">
            <ErrorBoundary area={`${workspaceLabels[runtime.workspace]} main surface`}>
              <WorkspaceCenter
                workspace={runtime.workspace}
                snapshot={runtime.snapshot}
                monitorActions={monitorActions}
              />
            </ErrorBoundary>
          </section>
          <ResizeHandle
            axis="x"
            edge="right"
            label="Resize right inspector panel"
            value={layout.rightWidth}
            minimum={240}
            maximum={Math.max(240, Math.floor(window.innerWidth * 0.34))}
            disabled={layout.rightCollapsed}
            onResize={(delta) => {
              setLayout((value) =>
                normalizeLayout(
                  { ...value, rightWidth: value.rightWidth - delta },
                  defaultLayouts[runtime.workspace],
                  window.innerWidth,
                  window.innerHeight,
                ),
              );
            }}
          />
          <aside
            aria-label={`${workspaceLabels[runtime.workspace]} inspector panel`}
            className={
              !compactLayout && layout.rightCollapsed
                ? "studio-panel right-panel collapsed"
                : "studio-panel right-panel"
            }
          >
            <PanelCollapse
              label={layout.rightCollapsed ? "Expand right panel" : "Collapse right panel"}
              direction={layout.rightCollapsed ? "left" : "right"}
              onClick={() => {
                setLayout((value) => ({ ...value, rightCollapsed: !value.rightCollapsed }));
              }}
            />
            <ErrorBoundary area={`${workspaceLabels[runtime.workspace]} inspector`}>
              <WorkspaceRightPanel
                workspace={runtime.workspace}
                snapshot={runtime.snapshot}
                monitorActions={monitorActions}
              />
            </ErrorBoundary>
          </aside>
          <ResizeHandle
            axis="y"
            edge="lower"
            label="Resize lower timeline panel"
            value={layout.lowerHeight}
            minimum={160}
            maximum={Math.max(180, Math.floor(window.innerHeight * 0.48))}
            disabled={layout.lowerCollapsed}
            onResize={(delta) => {
              setLayout((value) =>
                normalizeLayout(
                  { ...value, lowerHeight: value.lowerHeight - delta },
                  defaultLayouts[runtime.workspace],
                  window.innerWidth,
                  window.innerHeight,
                ),
              );
            }}
          />
          <section
            className={
              !compactLayout && layout.lowerCollapsed
                ? "studio-panel lower-panel collapsed"
                : "studio-panel lower-panel"
            }
          >
            <PanelCollapse
              label={layout.lowerCollapsed ? "Expand lower panel" : "Collapse lower panel"}
              direction="down"
              onClick={() => {
                setLayout((value) => ({ ...value, lowerCollapsed: !value.lowerCollapsed }));
              }}
            />
            <ErrorBoundary area={`${workspaceLabels[runtime.workspace]} lower panel`}>
              <WorkspaceLowerPanel
                workspace={runtime.workspace}
                snapshot={runtime.snapshot}
                monitorActions={monitorActions}
              />
            </ErrorBoundary>
          </section>
        </section>

        <footer className="status-footer">
          <div>
            <span>Selection: {runtime.snapshot.selection.clipIds[0] ?? "None"}</span>
            <span>Frame {runtime.snapshot.preview.masterFrame}</span>
            <span>29.97 DF display</span>
          </div>
          <button
            type="button"
            onClick={() => {
              runtime.setDiagnosticsOpen(true);
            }}
          >
            <span className={`connection-indicator connection-indicator--${runtime.connection.phase}`} />
            <span data-testid="server-status">{runtime.connection.detail}</span>
            <span>
              Event {runtime.connection.lastEventId ?? "—"} · {runtime.connection.eventLagMs} ms
            </span>
          </button>
          <div>
            <span>
              {project?.saved === true ? `${projectRevisionLabel(project)} · Saved` : "Unsaved changes"}
            </span>
          </div>
        </footer>

        <ShellStateOverlay
          state={runtime.shellState}
          dataSource={runtime.dataSource}
          hasOpenProject={runtime.snapshot.project !== null}
          recentProjects={runtime.recentProjects}
          onRetry={() => void runtime.resync()}
          onRefreshRecent={() => void runtime.refreshRecentProjects()}
          onOpenProject={runtime.openProject}
          onCreateProject={runtime.createProject}
          onReady={() => {
            runtime.setShellState("ready");
          }}
        />
        {runtime.commandPaletteOpen ? (
          <CommandPalette
            shortcuts={shortcuts}
            onClose={() => {
              runtime.setCommandPaletteOpen(false);
            }}
            onExecute={executeShortcut}
          />
        ) : null}
        {shortcutEditorOpen ? (
          <ShortcutEditor
            profile={shortcutProfile}
            onApply={setShortcutProfile}
            onClose={() => {
              setShortcutEditorOpen(false);
            }}
          />
        ) : null}
        {runtime.diagnosticsOpen ? (
          <DiagnosticsDrawer
            accessibility={accessibility}
            degradationLevel={degradation.level}
            runtime={runtime}
            onClose={() => {
              runtime.setDiagnosticsOpen(false);
            }}
            resetLayout={resetLayout}
            onAccessibilityChange={setAccessibility}
            onOpenShortcutEditor={() => {
              runtime.setDiagnosticsOpen(false);
              setShortcutEditorOpen(true);
            }}
          />
        ) : null}
        {showWelcome ? (
          <FirstRunWelcome
            onDismiss={() => {
              persistWelcomeDismissed();
              setWelcomeDismissed(true);
            }}
            onPlay={() => {
              persistWelcomeDismissed();
              setWelcomeDismissed(true);
              void (async () => {
                await runtime.dispatchMonitorCommand({ kind: "seek-frame", frame: "0" });
                await runtime.dispatchMonitorCommand({ kind: "toggle-play" });
              })();
            }}
            onCreate={() => {
              persistWelcomeDismissed();
              setWelcomeDismissed(true);
              runtime.setShellState("empty");
            }}
          />
        ) : null}
        <ToastRegion toasts={runtime.toasts} dismiss={runtime.dismissToast} />
      </main>
    </DeliveryWorkspaceProvider>
  );
};

const AuthenticatedLaunchRequired = () => (
  <main className="launch-required" aria-labelledby="launch-required-title">
    <section className="launch-required__card">
      <div className="launch-required__brand" aria-hidden="true">
        <ChaiBrandMark />
      </div>
      <p className="launch-required__eyebrow">Trusted local session</p>
      <h1 id="launch-required-title">Launch Chai Studio from the CLI</h1>
      <p className="launch-required__summary">
        This browser tab has no authenticated local Studio session. Project data, editing controls, sample
        receipts, and render actions stay unavailable until the secure launcher opens the app.
      </p>
      <div className="launch-required__command" aria-label="Launch command">
        <span>Terminal</span>
        <code>chai-studio launch</code>
      </div>
      <ol className="launch-required__steps">
        <li>Close this unauthenticated tab.</li>
        <li>Run the launch command in Terminal.</li>
        <li>Open the local URL printed by the launcher if it does not open automatically.</li>
      </ol>
      <Notice title="Your session token remains private" tone="ready">
        The launcher injects a per-launch token before React starts. Chai Studio never puts it in the URL or
        shows it in this screen.
      </Notice>
      <div className="launch-required__actions">
        <Button
          variant="primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          <ChaiIcon name="status-working" size={16} /> Check again
        </Button>
        <small>Use the same local tab only after the authenticated launcher is running.</small>
      </div>
    </section>
  </main>
);

const FirstRunWelcome = ({
  onCreate,
  onDismiss,
  onPlay,
}: {
  readonly onCreate: () => void;
  readonly onDismiss: () => void;
  readonly onPlay: () => void;
}) => (
  <ModalDialog className="first-run-welcome" labelledBy="first-run-welcome-title" onDismiss={onDismiss}>
    <header>
      <div className="first-run-welcome__mark" aria-hidden="true">
        <ChaiBrandMark />
      </div>
      <div>
        <span>YOUR FIRST LOCAL PROJECT</span>
        <h2 id="first-run-welcome-title">Welcome to Chai Studio</h2>
        <p>A real renderable starter is already open. Nothing here is a sample receipt or fake output.</p>
      </div>
      <IconButton label="Close welcome" onClick={onDismiss}>
        ×
      </IconButton>
    </header>
    <section className="first-run-welcome__path">
      <article>
        <strong>1 · Play</strong>
        <span>Use Space or J/K/L. The clock and red playhead share one frame authority.</span>
      </article>
      <article>
        <strong>2 · Edit</strong>
        <span>Select any of the three clips, move it, blade it, or animate a shared property.</span>
      </article>
      <article>
        <strong>3 · Verify</strong>
        <span>Render a still, run QA, then review the immutable artifact before approval.</span>
      </article>
    </section>
    <Notice title="Starter truth" tone="ready">
      Three locally generated PNGs · owned rights · validated sources · 450 exact frames · no audio
    </Notice>
    <footer>
      <Button variant="primary" onClick={onPlay}>
        <ChaiIcon name="play" size={16} />
        Play the starter
      </Button>
      <Button onClick={onDismiss}>Start editing</Button>
      <Button variant="ghost" onClick={onCreate}>
        <ChaiIcon name="project-new" size={16} /> Create another project
      </Button>
    </footer>
  </ModalDialog>
);

const welcomeStorageKey = "chai-studio.first-run-welcome.v1";

const loadWelcomeDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(welcomeStorageKey) === "dismissed";
  } catch {
    return false;
  }
};

const persistWelcomeDismissed = (): void => {
  try {
    window.localStorage.setItem(welcomeStorageKey, "dismissed");
  } catch {
    // A blocked storage area must not prevent the user from entering the editor.
  }
};

const PanelCollapse = ({
  direction,
  label,
  onClick,
}: {
  readonly direction: "left" | "right" | "down";
  readonly label: string;
  readonly onClick: () => void;
}) => (
  <IconButton className="panel-collapse" label={label} onClick={onClick}>
    <ChaiIcon
      className={`panel-collapse-icon panel-collapse-icon--${direction}`}
      name="panel-collapse-expand"
    />
  </IconButton>
);

const ResizeHandle = ({
  axis,
  disabled,
  edge,
  label,
  maximum,
  minimum,
  onResize,
  value,
}: {
  readonly axis: "x" | "y";
  readonly disabled: boolean;
  readonly edge: string;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onResize: (delta: number) => void;
  readonly value: number;
}) => {
  const origin = useRef(0);
  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    origin.current = axis === "x" ? event.clientX : event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const current = axis === "x" ? event.clientX : event.clientY;
    const delta = current - origin.current;
    if (delta === 0) return;
    origin.current = current;
    onResize(delta);
  };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const setValue = (nextValue: number) => {
    if (disabled) return;
    const bounded = Math.max(minimum, Math.min(maximum, nextValue));
    const valueDelta = bounded - value;
    if (valueDelta === 0) return;
    onResize(edge === "left" ? valueDelta : -valueDelta);
  };
  return (
    <div
      className={`resize-handle resize-handle--${axis} resize-handle--${edge}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.max(minimum, Math.min(maximum, value))}
      aria-valuetext={`${String(value)} pixels`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        const next =
          event.key === "Home"
            ? minimum
            : event.key === "End"
              ? maximum
              : axis === "x" && event.key === "ArrowLeft"
                ? value - 8
                : axis === "x" && event.key === "ArrowRight"
                  ? value + 8
                  : axis === "y" && event.key === "ArrowDown"
                    ? value - 8
                    : axis === "y" && event.key === "ArrowUp"
                      ? value + 8
                      : null;
        if (next === null) return;
        event.preventDefault();
        setValue(next);
      }}
    />
  );
};

const TruthRow = ({
  label,
  tone = "neutral",
  value,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "ready" | "danger" | "info";
}) => (
  <div className="truth-row">
    <span>{label}</span>
    <Badge tone={tone}>{value}</Badge>
  </div>
);

const stateContent: Readonly<
  Record<
    Exclude<ShellStateId, "ready">,
    {
      readonly title: string;
      readonly detail: string;
      readonly icon: ChaiIconName;
      readonly tone: "info" | "attention" | "danger";
    }
  >
> = {
  empty: {
    title: "No project is open",
    detail: "Create a self-contained Chai Studio project or open a recent project folder.",
    icon: "project-open",
    tone: "info",
  },
  loading: {
    title: "Loading project authority",
    detail: "Validating schema, revisions, assets, fonts, and runtime capabilities.",
    icon: "status-working",
    tone: "info",
  },
  offline: {
    title: "Local Studio server is offline",
    detail: "Your project files remain safe. Restart the local launcher, then reconnect.",
    icon: "status-offline",
    tone: "danger",
  },
  reconnecting: {
    title: "Reconnecting to ordered events",
    detail: "Edits are paused until the client resumes or completes a snapshot resync.",
    icon: "status-working",
    tone: "attention",
  },
  migrating: {
    title: "Project migration in progress",
    detail: "The original revision is protected. Editing resumes after validation and backup complete.",
    icon: "save-state",
    tone: "attention",
  },
  recovering: {
    title: "Recovering an interrupted session",
    detail: "Review autosave differences before choosing the authoritative revision.",
    icon: "undo",
    tone: "attention",
  },
  "read-only": {
    title: "Project opened read-only",
    detail: "Another writer owns the project lock. You can inspect and capture without mutating state.",
    icon: "status-read-only",
    tone: "attention",
  },
  conflict: {
    title: "Revision changed before your command",
    detail: "The editor will resync. Review the latest state before retrying the edit.",
    icon: "status-conflict",
    tone: "danger",
  },
};

const ShellStateOverlay = ({
  dataSource,
  hasOpenProject,
  onCreateProject,
  onOpenProject,
  onRefreshRecent,
  onReady,
  onRetry,
  recentProjects,
  state,
}: {
  readonly dataSource: Exclude<StudioDataSource, "unauthenticated">;
  readonly hasOpenProject: boolean;
  readonly recentProjects: readonly RecentProjectView[];
  readonly onRefreshRecent: () => void;
  readonly onOpenProject: (rootPath: string) => Promise<boolean>;
  readonly onCreateProject: (input: {
    readonly targetPath: string;
    readonly title: string;
    readonly starter: "empty" | "showcase" | "launch-film";
  }) => Promise<boolean>;
  readonly state: ShellStateId;
  readonly onRetry: () => void;
  readonly onReady: () => void;
}) => {
  if (state === "ready") return null;
  if (state === "empty") {
    return (
      <ProjectLauncher
        dataSource={dataSource}
        hasOpenProject={hasOpenProject}
        recentProjects={recentProjects}
        onRefresh={onRefreshRecent}
        onOpen={onOpenProject}
        onCreate={onCreateProject}
        onContinue={onReady}
      />
    );
  }
  const content = stateContent[state];
  return (
    <div
      className="state-overlay"
      data-testid={`shell-state-${state}`}
      role={
        state === "loading" || state === "reconnecting" || state === "migrating" || state === "recovering"
          ? "status"
          : "alert"
      }
      aria-label={`${content.title}. ${content.detail}`}
    >
      <EmptyState
        title={content.title}
        description={content.detail}
        symbol={<ChaiIcon name={content.icon} size={24} />}
        action={
          <div className="state-actions">
            <Button variant="primary" onClick={onRetry}>
              <ChaiIcon name="status-working" size={16} />
              Retry and resync
            </Button>
            <Button onClick={onReady}>
              <ChaiIcon name="visibility" size={16} />
              View workspace safely
            </Button>
          </div>
        }
      />
      <StatusPill tone={content.tone}>{state}</StatusPill>
    </div>
  );
};

const ProjectLauncher = ({
  dataSource,
  hasOpenProject,
  onContinue,
  onCreate,
  onOpen,
  onRefresh,
  recentProjects,
}: {
  readonly dataSource: Exclude<StudioDataSource, "unauthenticated">;
  readonly hasOpenProject: boolean;
  readonly recentProjects: readonly RecentProjectView[];
  readonly onRefresh: () => void;
  readonly onOpen: (rootPath: string) => Promise<boolean>;
  readonly onCreate: (input: {
    readonly targetPath: string;
    readonly title: string;
    readonly starter: "empty" | "showcase" | "launch-film";
  }) => Promise<boolean>;
  readonly onContinue: () => void;
}) => {
  const openPathRef = useRef<HTMLInputElement>(null);
  const [openPath, setOpenPath] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [title, setTitle] = useState("");
  const [starter, setStarter] = useState<"empty" | "showcase" | "launch-film">("showcase");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dataSource === "server") onRefresh();
  }, [dataSource, onRefresh]);

  const open = async (rootPath: string): Promise<void> => {
    if (busy || rootPath.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const opened = await onOpen(rootPath);
    if (!opened)
      setError("The local server could not open that project. Review diagnostics and the folder path.");
    setBusy(false);
  };

  const create = async (): Promise<void> => {
    if (busy || targetPath.trim().length === 0 || title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const created = await onCreate({ targetPath, title, starter });
    if (!created)
      setError("The local server could not create that project. Review diagnostics and the target path.");
    setBusy(false);
  };

  return (
    <ModalDialog
      className="project-launcher"
      labelledBy="project-launcher-title"
      initialFocusRef={openPathRef}
      onDismiss={() => {
        if (hasOpenProject) onContinue();
      }}
    >
      <div className="dialog-title">
        <div>
          <span>Local project authority</span>
          <h2 id="project-launcher-title">Open or create a Chai Studio project</h2>
        </div>
        {hasOpenProject ? (
          <IconButton label="Continue current project" onClick={onContinue}>
            ×
          </IconButton>
        ) : null}
      </div>
      {dataSource === "ui-fixture" ? (
        <Notice title="Authenticated launcher required" tone="info">
          Project creation and folder access are unavailable in the explicit UI fixture. Launch the local
          macOS Studio session to use real project paths.
        </Notice>
      ) : (
        <div className="project-launcher__content">
          <section>
            <div className="project-launcher__section-title">
              <div>
                <strong>Recent projects</strong>
                <small>Exact local folders opened by this server session.</small>
              </div>
              <Button variant="ghost" disabled={busy} onClick={onRefresh}>
                <ChaiIcon name="status-working" size={16} /> Refresh
              </Button>
            </div>
            <div className="project-launcher__recent" aria-label="Recent projects">
              {recentProjects.map((project) => (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void open(project.rootPath)}
                  key={project.rootPath}
                >
                  <span>
                    <strong>{project.title}</strong>
                    <small>{project.rootPath}</small>
                  </span>
                  <Badge tone="info">Open</Badge>
                </button>
              ))}
              {recentProjects.length === 0 ? <p>No recent projects are recorded by this session.</p> : null}
            </div>
          </section>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void open(openPath);
            }}
          >
            <strong>Open a project folder</strong>
            <label>
              <span>Absolute .chai folder path</span>
              <input
                ref={openPathRef}
                value={openPath}
                disabled={busy}
                placeholder="/Users/you/Movies/My Film.chai"
                onChange={(event) => {
                  setOpenPath(event.currentTarget.value);
                }}
              />
            </label>
            <Button variant="primary" disabled={busy || openPath.trim().length === 0} type="submit">
              <ChaiIcon name={busy ? "status-working" : "project-open"} size={16} />
              {busy ? "Working…" : "Open folder"}
            </Button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <strong>Create a self-contained project</strong>
            <div className="project-launcher__create-grid">
              <label>
                <span>Project title</span>
                <input
                  value={title}
                  disabled={busy}
                  onChange={(event) => {
                    setTitle(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>Absolute target path</span>
                <input
                  value={targetPath}
                  disabled={busy}
                  placeholder="/Users/you/Movies/My Film.chai"
                  onChange={(event) => {
                    setTargetPath(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span>Starter</span>
                <select
                  value={starter}
                  disabled={busy}
                  onChange={(event) => {
                    setStarter(event.currentTarget.value as "empty" | "showcase" | "launch-film");
                  }}
                >
                  <option value="empty">Empty project</option>
                  <option value="showcase">Chai Studio starter · renderable</option>
                  <option value="launch-film">Legacy contract fixture · unsupported media</option>
                </select>
              </label>
            </div>
            <Button
              variant="primary"
              disabled={busy || title.trim().length === 0 || targetPath.trim().length === 0}
              type="submit"
            >
              <ChaiIcon name={busy ? "status-working" : "project-new"} size={16} />
              {busy ? "Working…" : "Create project"}
            </Button>
          </form>
          {error === null ? null : (
            <p className="project-launcher__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <footer>
        {hasOpenProject ? <Button onClick={onContinue}>Continue current project</Button> : null}
        <small>No project is approved, delivered, or signed by opening it.</small>
      </footer>
    </ModalDialog>
  );
};

const CommandPalette = ({
  onClose,
  onExecute,
  shortcuts,
}: {
  readonly onClose: () => void;
  readonly onExecute: (commandId: string) => void;
  readonly shortcuts: readonly StudioShortcut[];
}) => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const conflicts = findShortcutConflicts(shortcuts);
  const commands = shortcuts.filter(
    (shortcut) => shortcut.enabled !== false && shortcut.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <ModalDialog
      className="command-palette"
      labelledBy="command-palette-title"
      initialFocusRef={inputRef}
      onDismiss={onClose}
    >
      <div className="dialog-title">
        <div>
          <span>Command system</span>
          <h2 id="command-palette-title">Go anywhere. Stay in control.</h2>
        </div>
        <IconButton label="Close command palette" onClick={onClose}>
          ×
        </IconButton>
      </div>
      <label className="palette-search">
        <ChaiIcon name="search" size={14} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search commands and workspaces"
          aria-label="Search commands"
        />
        <kbd>Esc</kbd>
      </label>
      <div className="command-list">
        {commands.map((shortcut) => (
          <button
            type="button"
            key={shortcut.commandId}
            onClick={() => {
              onExecute(shortcut.commandId);
              onClose();
            }}
          >
            <span>
              <strong>{shortcut.label}</strong>
              <small>{shortcut.scope}</small>
            </span>
            <kbd>{formatShortcut(shortcut)}</kbd>
          </button>
        ))}
      </div>
      <footer>
        {conflicts.length === 0 ? (
          <Badge tone="ready">No shortcut conflicts</Badge>
        ) : (
          <Badge tone="danger">{conflicts.length} conflicts</Badge>
        )}
        <span>Text entry safely suppresses editor shortcuts.</span>
      </footer>
    </ModalDialog>
  );
};

const DiagnosticsDrawer = ({
  accessibility,
  degradationLevel,
  onAccessibilityChange,
  onClose,
  onOpenShortcutEditor,
  resetLayout,
  runtime,
}: {
  readonly accessibility: AccessibilityPreferences;
  readonly degradationLevel: PreviewDegradationLevel;
  readonly onAccessibilityChange: (preferences: AccessibilityPreferences) => void;
  readonly onClose: () => void;
  readonly onOpenShortcutEditor: () => void;
  readonly resetLayout: () => void;
  readonly runtime: ReturnType<typeof useStudioRuntime>;
}) => (
  <ModalDialog className="diagnostics-drawer" labelledBy="diagnostics-title" onDismiss={onClose}>
    <div className="dialog-title">
      <div>
        <span>Local diagnostics</span>
        <h2 id="diagnostics-title">Truth, recovery, and performance</h2>
      </div>
      <IconButton label="Close diagnostics" autoFocus onClick={onClose}>
        ×
      </IconButton>
    </div>
    {runtime.diagnostic === null ? (
      <Notice title="No active diagnostic" tone="ready">
        The client has no unresolved server error.
      </Notice>
    ) : (
      <Notice title={runtime.diagnostic.message} tone="danger">
        <p>{runtime.diagnostic.repairHint}</p>
        <code>{runtime.diagnostic.correlationId}</code>
      </Notice>
    )}
    {runtime.reliability === null ? (
      <Notice title="Checking local recovery state" tone="info">
        Startup health, project integrity, and interrupted work are being scanned without changing files.
      </Notice>
    ) : (
      <Notice
        title={runtime.reliability.summary}
        tone={
          runtime.reliability.status === "ready"
            ? "ready"
            : runtime.reliability.status === "blocked"
              ? "danger"
              : "info"
        }
      >
        {runtime.reliability.suggestedRepair === null ? null : <p>{runtime.reliability.suggestedRepair}</p>}
        <p>
          {runtime.reliability.localOnly ? "Local only" : "Local status unknown"} · telemetry{" "}
          {runtime.reliability.telemetryEnabled ? "on" : "off"}
        </p>
      </Notice>
    )}
    {runtime.reliability === null ? null : (
      <section>
        <h3>Startup health</h3>
        {runtime.reliability.checks.map((check) => (
          <TruthRow
            key={check.id}
            label={check.label}
            value={check.state}
            tone={check.state === "passed" ? "ready" : check.state === "failed" ? "danger" : "neutral"}
          />
        ))}
      </section>
    )}
    {runtime.reliability === null || runtime.reliability.issues.length === 0 ? null : (
      <section>
        <h3>Recovery items</h3>
        {runtime.reliability.issues.slice(0, 8).map((issue) => (
          <div className="performance-row" key={issue.id}>
            <span>
              <strong>{issue.summary}</strong>
              <small>{issue.suggestedRepair}</small>
            </span>
            <code>{issue.code}</code>
          </div>
        ))}
      </section>
    )}
    <section>
      <h3>Connection</h3>
      <TruthRow
        label="Phase"
        value={runtime.connection.phase}
        tone={runtime.connection.phase === "online" ? "ready" : "danger"}
      />
      <TruthRow label="Last event" value={String(runtime.connection.lastEventId ?? "none")} />
      <TruthRow label="Event lag" value={`${String(runtime.connection.eventLagMs)} ms`} />
    </section>
    <section>
      <h3>Workspace tools</h3>
      <Button onClick={() => void runtime.resync()}>
        <ChaiIcon name="status-working" size={16} /> Resync snapshot
      </Button>
      <Button onClick={() => void runtime.refreshReliability()}>
        <ChaiIcon name="diagnostics-truth" size={16} /> Run health scan
      </Button>
      <Button onClick={resetLayout}>
        <ChaiIcon name="panel-collapse-expand" size={16} /> Reset layout
      </Button>
      <Button onClick={onOpenShortcutEditor}>
        <ChaiIcon name="command-palette" size={16} /> Customize shortcuts
      </Button>
      <Button
        disabled={runtime.dataSource !== "server"}
        title={
          runtime.dataSource === "server" ? "Open or create a local project." : "Requires authentication."
        }
        onClick={() => {
          onClose();
          runtime.setShellState("empty");
          void runtime.refreshRecentProjects();
        }}
      >
        <ChaiIcon name="project-open" size={16} /> Switch project
      </Button>
      <Button
        onClick={() => {
          runtime.setShellState("conflict");
        }}
      >
        <ChaiIcon name="status-info" size={14} /> Open state gallery
      </Button>
    </section>
    <section className="accessibility-settings" aria-label="Accessibility preferences">
      <h3>Accessibility</h3>
      <label>
        <input
          type="checkbox"
          checked={accessibility.highContrast}
          onChange={(event) => {
            onAccessibilityChange({ ...accessibility, highContrast: event.target.checked });
          }}
        />
        High contrast
      </label>
      <label>
        <input
          type="checkbox"
          checked={accessibility.reducedMotion}
          onChange={(event) => {
            onAccessibilityChange({ ...accessibility, reducedMotion: event.target.checked });
          }}
        />
        Reduced motion
      </label>
      <label>
        <input
          type="checkbox"
          checked={accessibility.screenReaderSummaries}
          onChange={(event) => {
            onAccessibilityChange({ ...accessibility, screenReaderSummaries: event.target.checked });
          }}
        />
        Screen-reader timeline summaries
      </label>
      <label>
        <span>Text scale</span>
        <select
          value={String(accessibility.textScale)}
          onChange={(event) => {
            onAccessibilityChange({
              ...accessibility,
              textScale: Number(event.target.value) as AccessibilityPreferences["textScale"],
            });
          }}
        >
          <option value="1">100%</option>
          <option value="1.15">115%</option>
          <option value="1.3">130%</option>
        </select>
      </label>
      <p>
        Preview degradation level {degradationLevel}. Status is expressed with text and shape, never color
        alone.
      </p>
    </section>
    <section>
      <h3>Privacy-safe support</h3>
      <p>
        Selecting this prepares a redaction preview only. Project media, executable source, and secrets stay
        excluded.
      </p>
      <Button
        disabled={runtime.reliability === null || runtime.reliability.recordIds.length === 0}
        onClick={() => void runtime.prepareSupportBundlePreview()}
      >
        <ChaiIcon name="diagnostics-truth" size={16} /> Preview selected diagnostics
      </Button>
    </section>
    <section>
      <h3>Local performance samples</h3>
      {runtime.performance.snapshot().length === 0 ? (
        <p>No slow operations recorded. Measurements stay on this Mac.</p>
      ) : (
        runtime.performance
          .snapshot()
          .slice(-8)
          .map((sample) => (
            <div className="performance-row" key={sample.id}>
              <span>{sample.name}</span>
              <code>{sample.durationMs.toFixed(1)} ms</code>
            </div>
          ))
      )}
    </section>
    <section aria-label="Release and environment identity">
      <h3>Release &amp; environment identity</h3>
      <TruthRow label="Studio" value={studioReleaseIdentity.version} tone="ready" />
      <TruthRow label="Schema / API" value={studioReleaseIdentity.schemaVersion} />
      <TruthRow
        label="Engines"
        value={`Remotion ${studioReleaseIdentity.engines.remotion ?? "unverified"} · HyperFrames ${studioReleaseIdentity.engines.hyperframes ?? "unverified"}`}
      />
      <TruthRow label="Adapters" value={studioReleaseIdentity.adapterContractVersion} />
      <TruthRow label="Browser QA" value={studioReleaseIdentity.testedBrowser.identity} />
      <TruthRow label="Compositor" value={studioReleaseIdentity.compositorVersion} />
      <TruthRow label="Support class" value={studioReleaseIdentity.supportClass} />
      <p>
        FFmpeg and the live environment fingerprint are verified by <code>chai-studio doctor</code>. Localhost
        launch needs no cloud account or desktop wrapper.
      </p>
    </section>
  </ModalDialog>
);

const ToastRegion = ({
  dismiss,
  toasts,
}: {
  readonly toasts: ReturnType<typeof useStudioRuntime>["toasts"];
  readonly dismiss: (id: string) => void;
}) => (
  <div className="toast-region" aria-live="polite" aria-relevant="additions">
    {toasts.map((toast) => (
      <ToastCard toast={toast} dismiss={dismiss} key={toast.id} />
    ))}
  </div>
);

const ToastCard = ({
  dismiss,
  toast,
}: {
  readonly toast: ReturnType<typeof useStudioRuntime>["toasts"][number];
  readonly dismiss: (id: string) => void;
}) => {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    const timeout = toast.tone === "danger" ? 15_000 : toast.tone === "attention" ? 10_000 : 6_000;
    const timer = window.setTimeout(() => {
      dismissRef.current(toast.id);
    }, timeout);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast.id, toast.tone]);
  return (
    <div className={`studio-toast studio-toast--${toast.tone}`} role="status">
      <ChaiIcon
        className="toast-marker"
        name={
          toast.tone === "danger"
            ? "status-danger"
            : toast.tone === "ready"
              ? "status-ready"
              : toast.tone === "attention"
                ? "status-warning"
                : "status-info"
        }
        size={14}
      />
      <div>
        <strong>{toast.title}</strong>
        <p>{toast.detail}</p>
        {toast.correlationId === null ? null : <code>{toast.correlationId}</code>}
      </div>
      <IconButton
        label="Dismiss notification"
        onClick={() => {
          dismiss(toast.id);
        }}
      >
        ×
      </IconButton>
    </div>
  );
};
