import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Badge, Button, IconButton } from "@chai-studio/ui-components";
import {
  calculateMonitorViewport,
  mapMonitorPointToComposition,
  monitorTruthPresentation,
  type MonitorCaptureMode,
  type MonitorComparisonMode,
  type MonitorFitMode,
  type MonitorMappedPoint,
  type MonitorViewportGeometry,
  type ProgramMonitorCommand,
} from "./monitor-contract.js";
import { projectRevisionLabel, type PreviewTruth, type ProjectIdentity } from "./types.js";
import { ModalDialog } from "./modal-dialog.js";
import { ChaiIcon } from "./chai-icon.js";

interface ProgramMonitorProps {
  readonly authoritativeCaptureAvailable: boolean;
  readonly preview: PreviewTruth;
  readonly revision: ProjectIdentity | null;
  readonly artwork: ReactNode;
  readonly comparisonArtwork?: ReactNode;
  readonly comparison?: boolean;
  readonly selectedLayerLabel?: string;
  readonly onCommand: (command: ProgramMonitorCommand) => void;
  readonly onCapture: (mode: MonitorCaptureMode, includeOverlays: boolean) => void;
}

interface MonitorOverlays {
  readonly safeZones: boolean;
  readonly grid: boolean;
  readonly centerLines: boolean;
  readonly customGuides: boolean;
  readonly selectedLayer: boolean;
}

const defaultOverlays: MonitorOverlays = {
  safeZones: true,
  grid: false,
  centerLines: true,
  customGuides: false,
  selectedLayer: true,
};

const captureModes: readonly Readonly<{
  mode: MonitorCaptureMode;
  label: string;
  hint: string;
  disabled: boolean;
}>[] = [
  {
    mode: "interactive-frame",
    label: "Current preview frame",
    hint: "Fast · visibly approximate",
    disabled: false,
  },
  {
    mode: "exact-fidelity",
    label: "Exact fidelity frame",
    hint: "Authoritative shared-media still · overlays excluded",
    disabled: false,
  },
  {
    mode: "isolated-clip",
    label: "Selected clip only",
    hint: "Unavailable · authoritative compositor required",
    disabled: true,
  },
  {
    mode: "before-effects",
    label: "Before effects",
    hint: "Unavailable · authoritative compositor required",
    disabled: true,
  },
  {
    mode: "alpha",
    label: "Alpha inspection",
    hint: "Unavailable · authoritative compositor required",
    disabled: true,
  },
  {
    mode: "comparison",
    label: "A/B comparison",
    hint: "Unavailable · authoritative compositor required",
    disabled: true,
  },
  {
    mode: "range",
    label: "Review range",
    hint: "Unavailable · authoritative compositor required",
    disabled: true,
  },
  {
    mode: "contact-sheet",
    label: "Contact sheet",
    hint: "Unavailable · authoritative compositor required",
    disabled: true,
  },
];

export const ProgramMonitor = ({
  authoritativeCaptureAvailable,
  artwork,
  comparison = false,
  comparisonArtwork,
  onCapture,
  onCommand,
  preview,
  revision,
  selectedLayerLabel = "FutureTitle_v04",
}: ProgramMonitorProps) => {
  const monitorRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureButtonRef = useRef<HTMLButtonElement>(null);
  const captureAnchorRef = useRef<HTMLDivElement>(null);
  const overlayAnchorRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const panOrigin = useRef<Readonly<{ x: number; y: number; panX: number; panY: number }> | null>(null);
  const [size, setSize] = useState({ width: 960, height: 540 });
  const [fitMode, setFitMode] = useState<MonitorFitMode>("fit");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [checkerboard, setCheckerboard] = useState(true);
  const [overlays, setOverlays] = useState(defaultOverlays);
  const [overlayMenuOpen, setOverlayMenuOpen] = useState(false);
  const [captureMenuOpen, setCaptureMenuOpen] = useState(false);
  const [includeOverlays, setIncludeOverlays] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<MonitorComparisonMode>("split");
  const [comparisonSplit, setComparisonSplit] = useState(50);
  const [fullscreen, setFullscreen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<Readonly<{ x: number; y: number }> | null>(null);
  const [mappedPoint, setMappedPoint] = useState<MonitorMappedPoint | null>(null);

  const geometry = useMemo(
    () =>
      calculateMonitorViewport({
        sourceWidth: 1920,
        sourceHeight: 1080,
        containerWidth: Math.max(1, size.width),
        containerHeight: Math.max(1, size.height),
        fitMode,
        zoom,
        panX: pan.x,
        panY: pan.y,
        devicePixelRatio: Math.min(8, Math.max(1, window.devicePixelRatio || 1)),
      }),
    [fitMode, pan.x, pan.y, size.height, size.width, zoom],
  );
  const truth = monitorTruthPresentation(preview);
  const revisionLabel = revision === null ? "Revision loading" : projectRevisionLabel(revision);
  const availableCaptureModes = useMemo(
    () =>
      captureModes.map((item) =>
        item.mode === "exact-fidelity" && !authoritativeCaptureAvailable
          ? {
              ...item,
              hint: "Unavailable · authoritative compositor required",
              disabled: true,
            }
          : item,
      ),
    [authoritativeCaptureAvailable],
  );

  useEffect(() => {
    const node = viewportRef.current;
    if (node === null) return;
    const update = () => {
      const bounds = node.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) setSize({ width: bounds.width, height: bounds.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    drawMonitorOverlays(canvasRef.current, geometry, overlays);
  }, [geometry, overlays]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === monitorRef.current;
      setFullscreen(active);
      if (!active) monitorRef.current?.focus();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!captureMenuOpen && !overlayMenuOpen && contextMenu === null) return;
    const closeMenus = (returnFocus: boolean) => {
      if (returnFocus) {
        if (captureMenuOpen) captureButtonRef.current?.focus();
        else if (overlayMenuOpen)
          overlayAnchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        else monitorRef.current?.focus();
      }
      setCaptureMenuOpen(false);
      setOverlayMenuOpen(false);
      setContextMenu(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const insideOpenMenu =
        (captureMenuOpen && captureAnchorRef.current?.contains(event.target) === true) ||
        (overlayMenuOpen && overlayAnchorRef.current?.contains(event.target) === true) ||
        (contextMenu !== null && contextMenuRef.current?.contains(event.target) === true);
      if (!insideOpenMenu) closeMenus(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenus(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const activeMenu =
        contextMenuRef.current ??
        captureAnchorRef.current?.querySelector<HTMLElement>("[role='menu']") ??
        overlayAnchorRef.current?.querySelector<HTMLElement>("[role='menu']") ??
        null;
      if (activeMenu === null) return;
      const controls = [
        ...activeMenu.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
      ];
      if (controls.length === 0) return;
      event.preventDefault();
      const currentIndex = controls.findIndex((control) => control === document.activeElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? controls.length - 1
            : event.key === "ArrowUp"
              ? (currentIndex <= 0 ? controls.length : currentIndex) - 1
              : (currentIndex + 1) % controls.length;
      controls[nextIndex]?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [captureMenuOpen, contextMenu, overlayMenuOpen]);

  useEffect(() => {
    if (contextMenu === null) return;
    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [contextMenu]);

  const toggleFullscreen = useCallback(async () => {
    const monitor = monitorRef.current;
    if (monitor === null) return;
    if (document.fullscreenElement === monitor) {
      await document.exitFullscreen();
      return;
    }
    await monitor.requestFullscreen();
    setFullscreen(true);
  }, []);

  const capture = (mode: MonitorCaptureMode) => {
    onCapture(mode, includeOverlays);
    setCaptureMenuOpen(false);
    captureButtonRef.current?.focus();
  };

  const viewportStyle = {
    "--monitor-width": `${String(geometry.displayWidth)}px`,
    "--monitor-height": `${String(geometry.displayHeight)}px`,
    "--monitor-x": `${String(geometry.offsetX)}px`,
    "--monitor-y": `${String(geometry.offsetY)}px`,
    "--comparison-split": `${String(comparisonSplit)}%`,
  } as CSSProperties;

  return (
    <section
      className={`program-monitor${fullscreen ? " program-monitor--fullscreen" : ""}`}
      ref={monitorRef}
      aria-label="Program monitor"
      data-truth-mode={preview.mode}
      tabIndex={-1}
    >
      <header className="monitor-toolbar">
        <div className="monitor-truth-cluster">
          <Badge tone={preview.mode === "rendered-fidelity" ? "ready" : "attention"}>
            {truth.fidelityLabel}
          </Badge>
          <Badge tone={preview.source === "original" ? "ready" : "attention"}>{truth.sourceLabel}</Badge>
          <Badge tone={preview.engineState === "baked-fallback" ? "attention" : "info"}>
            {truth.engineLabel}
          </Badge>
          {truth.buffering ? <Badge tone="attention">Buffering</Badge> : null}
          {truth.droppedFrameLabel === null ? null : (
            <Badge tone="attention">{truth.droppedFrameLabel}</Badge>
          )}
        </div>
        <div className="monitor-view-controls">
          {comparison ? (
            <label className="monitor-select-label">
              <span className="sr-only">Comparison mode</span>
              <select
                aria-label="Comparison mode"
                value={comparisonMode}
                onChange={(event) => {
                  setComparisonMode(event.target.value as MonitorComparisonMode);
                }}
              >
                <option value="split">Split</option>
                <option value="wipe">Wipe</option>
                <option value="onion">Onion</option>
                <option value="difference">Difference</option>
              </select>
            </label>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => {
              setFitMode((value) => (value === "fit" ? "fill" : "fit"));
              setPan({ x: 0, y: 0 });
            }}
          >
            {fitMode === "fit" ? "Fit" : "Fill"}
          </Button>
          <label className="monitor-zoom">
            <span>Zoom</span>
            <input
              aria-label="Monitor zoom"
              type="range"
              min="0.5"
              max="4"
              step="0.1"
              value={zoom}
              onChange={(event) => {
                setZoom(Number(event.target.value));
              }}
            />
            <code>{Math.round(zoom * 100)}%</code>
          </label>
          <div className="monitor-menu-anchor" ref={overlayAnchorRef}>
            <Button
              variant="ghost"
              onClick={() => {
                setOverlayMenuOpen((open) => !open);
              }}
            >
              Overlays
            </Button>
            {overlayMenuOpen ? (
              <div className="monitor-popover monitor-overlay-menu" role="menu" aria-label="Monitor overlays">
                <Toggle label="Transparency checker" checked={checkerboard} onChange={setCheckerboard} />
                <OverlayToggle
                  field="safeZones"
                  label="Title and action safe"
                  value={overlays}
                  set={setOverlays}
                />
                <OverlayToggle field="grid" label="Thirds grid" value={overlays} set={setOverlays} />
                <OverlayToggle field="centerLines" label="Center lines" value={overlays} set={setOverlays} />
                <OverlayToggle
                  field="customGuides"
                  label="Custom guides"
                  value={overlays}
                  set={setOverlays}
                />
                <OverlayToggle
                  field="selectedLayer"
                  label={`Selected layer · ${selectedLayerLabel}`}
                  value={overlays}
                  set={setOverlays}
                />
              </div>
            ) : null}
          </div>
          <IconButton
            label={fullscreen ? "Exit fullscreen monitor" : "Open fullscreen monitor"}
            onClick={() => void toggleFullscreen()}
          >
            <ChaiIcon name="fullscreen" size={16} />
          </IconButton>
        </div>
      </header>

      <div
        className={`monitor-viewport monitor-viewport--${geometry.bars}${checkerboard ? " monitor-viewport--checker" : ""}`}
        ref={viewportRef}
        style={viewportStyle}
        data-backing-width={geometry.backingWidth}
        data-backing-height={geometry.backingHeight}
        data-program-capture-surface
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerDown={(event) => {
          if (zoom <= 1 && !event.altKey) return;
          panOrigin.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const origin = panOrigin.current;
          if (origin !== null && event.currentTarget.hasPointerCapture(event.pointerId)) {
            setPan({
              x: origin.panX + event.clientX - origin.x,
              y: origin.panY + event.clientY - origin.y,
            });
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          setMappedPoint(
            mapMonitorPointToComposition(geometry, event.clientX - bounds.left, event.clientY - bounds.top),
          );
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          panOrigin.current = null;
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          panOrigin.current = null;
        }}
        onLostPointerCapture={() => {
          panOrigin.current = null;
        }}
      >
        <div className="monitor-canvas-shell" data-comparison-mode={comparisonMode}>
          {comparison ? (
            <ComparisonCanvas
              mode={comparisonMode}
              primary={artwork}
              secondary={comparisonArtwork ?? artwork}
            />
          ) : (
            artwork
          )}
        </div>
        <canvas
          ref={canvasRef}
          className="monitor-overlay-canvas"
          width={geometry.backingWidth}
          height={geometry.backingHeight}
          aria-hidden="true"
        />
        <div
          className="monitor-frame-identities"
          aria-label="Monitor artifact identity"
          data-revision-id={revision?.revisionId}
          data-revision-number={revision?.revisionNumber}
        >
          {comparison ? (
            <>
              <span>A · comparison source · frame {preview.masterFrame}</span>
              <span>
                B · current {revisionLabel} · frame {preview.masterFrame}
              </span>
            </>
          ) : (
            <span>
              Current {revisionLabel} · frame {preview.masterFrame} · {preview.mode}
            </span>
          )}
        </div>
        {comparison && (comparisonMode === "wipe" || comparisonMode === "split") ? (
          <input
            className="comparison-split-control"
            type="range"
            min="0"
            max="100"
            value={comparisonSplit}
            aria-label="Comparison split position"
            onChange={(event) => {
              setComparisonSplit(Number(event.target.value));
            }}
          />
        ) : null}
      </div>

      <MonitorWarningStrip preview={preview} />
      <TransportBar preview={preview} onCommand={onCommand} />
      <footer className="monitor-statusbar">
        <span>{geometry.bars === "none" ? "Canvas fills monitor" : geometry.bars}</span>
        <span>
          1920×1080 · {preview.timelineFps.numerator}/{preview.timelineFps.denominator}
        </span>
        <span>
          DPR {geometry.devicePixelRatio.toFixed(1)} · backing {geometry.backingWidth}×
          {geometry.backingHeight}
        </span>
        <span>
          {mappedPoint?.inside === true
            ? `x ${mappedPoint.normalizedX.toFixed(3)} · y ${mappedPoint.normalizedY.toFixed(3)}`
            : "Pointer outside composition"}
        </span>
        <button
          type="button"
          onClick={() => {
            setHelpOpen(true);
          }}
        >
          Keyboard help
        </button>
        <div className="monitor-capture-anchor" ref={captureAnchorRef}>
          <button
            className="monitor-capture-primary"
            type="button"
            disabled={!authoritativeCaptureAvailable}
            aria-label={authoritativeCaptureAvailable ? "Capture exact" : "Exact unavailable"}
            title={
              authoritativeCaptureAvailable
                ? "Render and save an authoritative clean PNG at the current frame."
                : "Authoritative capture requires the authenticated local Studio session."
            }
            onClick={() => {
              capture("exact-fidelity");
            }}
          >
            <ChaiIcon name="capture-exact" size={16} />
            {authoritativeCaptureAvailable ? "Capture exact" : "Exact unavailable"}
          </button>
          <button
            ref={captureButtonRef}
            className="monitor-capture-menu-button"
            type="button"
            aria-label="Open capture modes"
            aria-expanded={captureMenuOpen}
            onClick={() => {
              setCaptureMenuOpen((open) => !open);
            }}
          >
            ▾
          </button>
          {captureMenuOpen ? (
            <div className="monitor-popover capture-menu" role="menu" aria-label="Capture modes">
              {availableCaptureModes.map((item) => (
                <button
                  type="button"
                  role="menuitem"
                  key={item.mode}
                  disabled={item.disabled}
                  aria-disabled={item.disabled}
                  onClick={() => {
                    capture(item.mode);
                  }}
                >
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                </button>
              ))}
              <Toggle
                label="Include review overlays"
                checked={includeOverlays}
                onChange={setIncludeOverlays}
              />
              <p>Overlays are excluded unless this option is explicitly enabled.</p>
            </div>
          ) : null}
        </div>
      </footer>

      {contextMenu === null ? null : (
        <div
          ref={contextMenuRef}
          className="monitor-context-menu"
          role="menu"
          aria-label="Program monitor context menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
              setFitMode("fit");
              setContextMenu(null);
            }}
          >
            Fit composition
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOverlays((value) => ({ ...value, safeZones: !value.safeZones }));
              setContextMenu(null);
            }}
          >
            Toggle safe zones
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!authoritativeCaptureAvailable}
            aria-disabled={!authoritativeCaptureAvailable}
            title={
              authoritativeCaptureAvailable
                ? "Capture an authoritative frame from the current revision."
                : "Authoritative capture requires the authenticated local Studio session."
            }
            onClick={() => {
              capture("exact-fidelity");
              setContextMenu(null);
            }}
          >
            Capture exact frame
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setHelpOpen(true);
              setContextMenu(null);
            }}
          >
            Keyboard help
          </button>
        </div>
      )}
      {helpOpen ? (
        <MonitorKeyboardHelp
          onClose={() => {
            setHelpOpen(false);
          }}
        />
      ) : null}
    </section>
  );
};

const ComparisonCanvas = ({
  mode,
  primary,
  secondary,
}: {
  readonly mode: MonitorComparisonMode;
  readonly primary: ReactNode;
  readonly secondary: ReactNode;
}) => (
  <div className={`monitor-comparison monitor-comparison--${mode}`}>
    <div className="monitor-comparison__a">{primary}</div>
    <div className="monitor-comparison__b">{secondary}</div>
    <div className="monitor-comparison__divider" />
  </div>
);

const TransportBar = ({
  onCommand,
  preview,
}: {
  readonly preview: PreviewTruth;
  readonly onCommand: (command: ProgramMonitorCommand) => void;
}) => (
  <div className="monitor-transport" aria-label="Program monitor transport">
    <button
      type="button"
      aria-label="Go to timeline start"
      onClick={() => {
        onCommand({ kind: "seek-start" });
      }}
    >
      <ChaiIcon name="seek-start" size={14} />
    </button>
    <button
      type="button"
      aria-label="Step backward one second"
      onClick={() => {
        onCommand({ kind: "step-second", seconds: -1 });
      }}
    >
      −1s
    </button>
    <button
      type="button"
      aria-label="Previous frame"
      onClick={() => {
        onCommand({ kind: "step-frame", delta: -1 });
      }}
    >
      <ChaiIcon name="previous-frame" size={14} />
    </button>
    <button
      className="transport-shortcut-button"
      type="button"
      aria-label="Shuttle backward"
      onClick={() => {
        onCommand({ kind: "shuttle", direction: "backward" });
      }}
    >
      <ChaiIcon name="shuttle-backward" size={14} />
      <kbd>J</kbd>
    </button>
    <button
      className="transport-shortcut-button"
      type="button"
      aria-label="Pause shuttle"
      onClick={() => {
        onCommand({ kind: "shuttle", direction: "pause" });
      }}
    >
      <ChaiIcon name="pause" size={14} />
      <kbd>K</kbd>
    </button>
    <button
      className="transport-shortcut-button"
      type="button"
      aria-label="Shuttle forward"
      onClick={() => {
        onCommand({ kind: "shuttle", direction: "forward" });
      }}
    >
      <ChaiIcon name="shuttle-forward" size={14} />
      <kbd>L</kbd>
    </button>
    <button
      className="monitor-play"
      type="button"
      aria-label={preview.playback === "playing" ? "Pause program preview" : "Play program preview"}
      onClick={() => {
        onCommand({ kind: "toggle-play" });
      }}
    >
      <ChaiIcon name={preview.playback === "playing" ? "pause" : "play"} size={14} />
    </button>
    <button
      type="button"
      aria-label="Next frame"
      onClick={() => {
        onCommand({ kind: "step-frame", delta: 1 });
      }}
    >
      <ChaiIcon name="next-frame" size={14} />
    </button>
    <button
      type="button"
      aria-label="Step forward one second"
      onClick={() => {
        onCommand({ kind: "step-second", seconds: 1 });
      }}
    >
      +1s
    </button>
    <button
      type="button"
      aria-label="Go to timeline end"
      onClick={() => {
        onCommand({ kind: "seek-end" });
      }}
    >
      <ChaiIcon name="seek-end" size={14} />
    </button>
    <span className="transport-divider" />
    <button
      type="button"
      aria-label="Mark timeline in"
      onClick={() => {
        onCommand({ kind: "mark-in" });
      }}
    >
      <ChaiIcon name="mark-in" size={14} />
    </button>
    <button
      type="button"
      aria-label="Mark timeline out"
      onClick={() => {
        onCommand({ kind: "mark-out" });
      }}
    >
      <ChaiIcon name="mark-out" size={14} />
    </button>
    <button
      type="button"
      className={preview.loopRange === null ? "" : "active"}
      aria-label="Toggle timeline loop"
      aria-pressed={preview.loopRange !== null}
      onClick={() => {
        onCommand({ kind: "toggle-loop" });
      }}
    >
      <ChaiIcon name="loop-range" size={16} />
    </button>
    <label>
      <span className="sr-only">Playback rate</span>
      <select
        aria-label="Playback rate"
        value={preview.playRate.numerator}
        onChange={(event) => {
          onCommand({
            kind: "set-rate",
            numerator: Number(event.target.value) as -4 | -2 | -1 | 1 | 2 | 4,
          });
        }}
      >
        {[-4, -2, -1, 1, 2, 4].map((rate) => (
          <option value={rate} key={rate}>
            {rate > 0 ? "+" : ""}
            {rate}×
          </option>
        ))}
      </select>
    </label>
    <FrameAuthority onCommand={onCommand} preview={preview} />
  </div>
);

const FrameAuthority = ({
  onCommand,
  preview,
}: {
  readonly preview: PreviewTruth;
  readonly onCommand: (command: ProgramMonitorCommand) => void;
}) => {
  const [draft, setDraft] = useState(preview.masterFrame);
  useEffect(() => {
    setDraft(preview.masterFrame);
  }, [preview.masterFrame]);
  const commit = (): void => {
    try {
      const frame = BigInt(draft);
      const lastFrame = BigInt(preview.durationFrames) - 1n;
      if (frame < 0n || frame > lastFrame) throw new Error("Frame is outside the timeline.");
      onCommand({ kind: "seek-frame", frame: frame.toString(10) });
    } catch {
      setDraft(preview.masterFrame);
    }
  };
  return (
    <div className="monitor-time-authority">
      <div>
        <code>{preview.timecode}</code>
        <input
          aria-label="Current frame"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setDraft(preview.masterFrame);
            }
          }}
        />
      </div>
      <span>
        Frame {preview.masterFrame} / {preview.durationFrames}
      </span>
    </div>
  );
};

const MonitorWarningStrip = ({ preview }: { readonly preview: PreviewTruth }) => {
  const warnings = monitorTruthPresentation(preview).warnings;
  if (warnings.length === 0) return null;
  return (
    <div className="monitor-warning-strip" aria-label="Program monitor warnings">
      {warnings.slice(0, 3).map((warning) => (
        <span className={`monitor-warning monitor-warning--${warning.severity}`} key={warning.code}>
          <i aria-hidden="true" /> {warning.message}
        </span>
      ))}
    </div>
  );
};

const Toggle = ({
  checked,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) => (
  <label className="monitor-toggle">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
    />
    <span>{label}</span>
  </label>
);

const OverlayToggle = ({
  field,
  label,
  set,
  value,
}: {
  readonly field: keyof MonitorOverlays;
  readonly label: string;
  readonly value: MonitorOverlays;
  readonly set: React.Dispatch<React.SetStateAction<MonitorOverlays>>;
}) => (
  <Toggle
    label={label}
    checked={value[field]}
    onChange={(checked) => {
      set((current) => ({ ...current, [field]: checked }));
    }}
  />
);

const MonitorKeyboardHelp = ({ onClose }: { readonly onClose: () => void }) => (
  <ModalDialog className="monitor-help" labelledBy="monitor-help-title" onDismiss={onClose}>
    <div>
      <span>Program monitor</span>
      <h2 id="monitor-help-title">Keyboard controls</h2>
    </div>
    <IconButton label="Close monitor keyboard help" autoFocus onClick={onClose}>
      ×
    </IconButton>
    <dl>
      <div>
        <dt>Space</dt>
        <dd>Play / pause</dd>
      </div>
      <div>
        <dt>← / →</dt>
        <dd>Step one frame</dd>
      </div>
      <div>
        <dt>⇧← / ⇧→</dt>
        <dd>Step one second</dd>
      </div>
      <div>
        <dt>J / K / L</dt>
        <dd>Shuttle backward / pause / forward</dd>
      </div>
      <div>
        <dt>I / O</dt>
        <dd>Timeline in / out</dd>
      </div>
      <div>
        <dt>Home / End</dt>
        <dd>Timeline start / end</dd>
      </div>
      <div>
        <dt>C</dt>
        <dd>Exact fidelity capture</dd>
      </div>
    </dl>
    <p>Text entry suppresses editor shortcuts. Source inspection uses its own clock.</p>
  </ModalDialog>
);

const drawMonitorOverlays = (
  canvas: HTMLCanvasElement | null,
  geometry: MonitorViewportGeometry,
  overlays: MonitorOverlays,
): void => {
  if (canvas === null) return;
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(geometry.devicePixelRatio, geometry.devicePixelRatio);
  context.translate(geometry.offsetX, geometry.offsetY);
  context.lineWidth = 1 / geometry.devicePixelRatio;
  if (overlays.safeZones) {
    context.strokeStyle = "rgba(255,255,255,.52)";
    strokeNormalizedRect(context, geometry, 0.05, 0.05, 0.9, 0.9);
    context.strokeStyle = "rgba(141,135,255,.72)";
    strokeNormalizedRect(context, geometry, 0.1, 0.1, 0.8, 0.8);
  }
  if (overlays.grid) {
    context.strokeStyle = "rgba(255,255,255,.24)";
    for (const position of [1 / 3, 2 / 3]) {
      line(
        context,
        geometry.displayWidth * position,
        0,
        geometry.displayWidth * position,
        geometry.displayHeight,
      );
      line(
        context,
        0,
        geometry.displayHeight * position,
        geometry.displayWidth,
        geometry.displayHeight * position,
      );
    }
  }
  if (overlays.centerLines) {
    context.strokeStyle = "rgba(97,219,231,.55)";
    line(context, geometry.displayWidth / 2, 0, geometry.displayWidth / 2, geometry.displayHeight);
    line(context, 0, geometry.displayHeight / 2, geometry.displayWidth, geometry.displayHeight / 2);
  }
  if (overlays.customGuides) {
    context.strokeStyle = "rgba(243,189,79,.68)";
    line(context, geometry.displayWidth * 0.3, 0, geometry.displayWidth * 0.3, geometry.displayHeight);
    line(context, 0, geometry.displayHeight * 0.72, geometry.displayWidth, geometry.displayHeight * 0.72);
  }
  if (overlays.selectedLayer) {
    context.strokeStyle = "rgba(141,135,255,.95)";
    context.setLineDash([5, 3]);
    strokeNormalizedRect(context, geometry, 0.09, 0.19, 0.72, 0.54);
    context.setLineDash([]);
  }
};

const strokeNormalizedRect = (
  context: CanvasRenderingContext2D,
  geometry: MonitorViewportGeometry,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  context.strokeRect(
    geometry.displayWidth * x,
    geometry.displayHeight * y,
    geometry.displayWidth * width,
    geometry.displayHeight * height,
  );
};

const line = (
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) => {
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
};
