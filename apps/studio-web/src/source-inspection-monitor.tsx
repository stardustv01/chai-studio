import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "@chai-studio/ui-components";
import type { AssetRecord } from "@chai-studio/schema";
import { normalizeRational } from "@chai-studio/schema/rational";
import {
  buildProfessionalSourceEdit,
  createFrameRange,
  masterFrame,
  stableEntityId,
  type ClipSnapshot,
  type TimelineEditCommand,
  type TimelineSnapshotV1,
} from "@chai-studio/timeline/browser";
import {
  applySourceInspectionCommand,
  assertFoundationSourceInspectionBoundary,
  formatMonitorTimecode,
  type MonitorCaptureMode,
  type SourceInspectionState,
} from "./monitor-contract.js";
import { StudioApiClient } from "./api-client.js";
import { ChaiIcon } from "./chai-icon.js";

interface SourceInspectionMonitorProps {
  readonly assets: readonly AssetRecord[];
  readonly selectedAssetId: string | null;
  readonly timeline: TimelineSnapshotV1;
  readonly timelineFrame: string;
  readonly onCapture: (
    mode: MonitorCaptureMode,
    includeOverlays: boolean,
    source?: SourceInspectionState,
  ) => void;
  readonly onTimelineCommand: (command: TimelineEditCommand) => void;
}

const defaultSourceState: SourceInspectionState = {
  sourceId: "asset-interview-nav-0001",
  sourceKind: "video",
  currentFrame: "364",
  durationFrames: "1728",
  fps: { numerator: "24000", denominator: "1001" },
  auditionValues: {},
  auditionDirty: false,
};

interface SourceDescriptor {
  readonly sourceId: string;
  readonly label: string;
  readonly durationFrames: string;
  readonly fps: Readonly<{ numerator: string; denominator: string }>;
  readonly dimensions: string;
  readonly proxy: string;
  readonly audio: string;
}

const fallbackSourceDescriptors: Readonly<Record<SourceInspectionState["sourceKind"], SourceDescriptor>> = {
  video: {
    sourceId: "asset-interview-nav-0001",
    label: "Interview take 03",
    durationFrames: "1728",
    fps: { numerator: "24000", denominator: "1001" },
    dimensions: "3840×2160",
    proxy: "1080p CFR · map verified",
    audio: "Isolated audition only",
  },
  image: {
    sourceId: "asset-hero-environment-0001",
    label: "Hero environment",
    durationFrames: "1",
    fps: { numerator: "1", denominator: "1" },
    dimensions: "4096×2160",
    proxy: "Display proxy · color managed",
    audio: "Not applicable",
  },
  remotion: {
    sourceId: "asset-future-title-0001",
    label: "FutureTitle_v04",
    durationFrames: "180",
    fps: { numerator: "30000", denominator: "1001" },
    dimensions: "1920×1080",
    proxy: "Deterministic component preview",
    audio: "Composition-owned",
  },
  hyperframes: {
    sourceId: "asset-particle-bridge-0001",
    label: "ParticleBridge",
    durationFrames: "430",
    fps: { numerator: "30000", denominator: "1001" },
    dimensions: "1920×1080",
    proxy: "Baked interactive proxy",
    audio: "Composition-owned",
  },
};

export const SourceInspectionMonitor = ({
  assets,
  onCapture,
  onTimelineCommand,
  selectedAssetId,
  timeline,
  timelineFrame,
}: SourceInspectionMonitorProps) => {
  assertFoundationSourceInspectionBoundary();
  const allowFixtureFallback = window.__CHAI_STUDIO_SESSION__ === undefined;
  const initialKind = selectedSourceKind(assets, timeline, selectedAssetId) ?? "video";
  const [source, setSource] = useState<SourceInspectionState>(() => {
    const initial = sourceDescriptor(initialKind, timeline, assets, selectedAssetId, allowFixtureFallback);
    return {
      ...defaultSourceState,
      sourceKind: initialKind,
      sourceId: initial.sourceId,
      currentFrame: allowFixtureFallback ? defaultSourceState.currentFrame : "0",
      durationFrames: initial.durationFrames,
      fps: initial.fps,
    };
  });
  const [sourceKind, setSourceKind] = useState<SourceInspectionState["sourceKind"]>(initialKind);
  const [sourceIn, setSourceIn] = useState<string | null>(
    () =>
      sourceRangeDefaults(
        sourceDescriptor(initialKind, timeline, assets, selectedAssetId, allowFixtureFallback).durationFrames,
      ).sourceIn,
  );
  const [sourceOut, setSourceOut] = useState<string | null>(
    () =>
      sourceRangeDefaults(
        sourceDescriptor(initialKind, timeline, assets, selectedAssetId, allowFixtureFallback).durationFrames,
      ).sourceOut,
  );
  const [targetTrackId, setTargetTrackId] = useState(timeline.trackIds[0] ?? "");
  const [editKind, setEditKind] = useState<"insert" | "overwrite" | "replace">("overwrite");
  const [editStatus, setEditStatus] = useState("Three points ready");
  const descriptor = useMemo(
    () => sourceDescriptor(sourceKind, timeline, assets, selectedAssetId, allowFixtureFallback),
    [allowFixtureFallback, assets, selectedAssetId, sourceKind, timeline],
  );
  const sourceClient = useMemo(
    () =>
      new StudioApiClient({
        sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
        baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
      }),
    [],
  );
  const [decodedFrame, setDecodedFrame] = useState<DecodedSourceFrame>({
    status: "idle",
    url: null,
    contentHash: null,
    message: "Choose a decoded media source.",
  });
  const timecode = useMemo(
    () => formatMonitorTimecode(source.currentFrame, source.fps),
    [source.currentFrame, source.fps],
  );
  const update = (command: Parameters<typeof applySourceInspectionCommand>[1]) => {
    setSource((current) => applySourceInspectionCommand(current, command));
  };
  useEffect(() => {
    const selectedKind = selectedSourceKind(assets, timeline, selectedAssetId);
    if (selectedKind !== null) setSourceKind(selectedKind);
  }, [assets, selectedAssetId, timeline]);
  useEffect(() => {
    setSource((current) => {
      if (
        current.sourceId === descriptor.sourceId &&
        current.durationFrames === descriptor.durationFrames &&
        current.fps.numerator === descriptor.fps.numerator &&
        current.fps.denominator === descriptor.fps.denominator
      ) {
        return current;
      }
      const lastFrame = BigInt(descriptor.durationFrames) - 1n;
      const currentFrame = BigInt(current.currentFrame);
      return {
        ...current,
        sourceKind,
        sourceId: descriptor.sourceId,
        currentFrame: (currentFrame > lastFrame ? (lastFrame < 0n ? 0n : lastFrame) : currentFrame).toString(
          10,
        ),
        durationFrames: descriptor.durationFrames,
        fps: descriptor.fps,
      };
    });
  }, [descriptor, sourceKind]);
  useEffect(() => {
    const defaults = sourceRangeDefaults(descriptor.durationFrames);
    setSourceIn(defaults.sourceIn);
    setSourceOut(defaults.sourceOut);
  }, [descriptor.durationFrames, descriptor.sourceId]);
  useEffect(() => {
    if (sourceKind !== "video" && sourceKind !== "image") {
      setDecodedFrame({
        status: "idle",
        url: null,
        contentHash: null,
        message: "Native composition source decoding is available only through its validated render adapter.",
      });
      return;
    }
    if (source.sourceId.startsWith("source-unavailable-")) {
      setDecodedFrame({
        status: "idle",
        url: null,
        contentHash: null,
        message: descriptor.label,
      });
      return;
    }
    if (sourceClient.sessionToken === null) {
      setDecodedFrame({
        status: "error",
        url: null,
        contentHash: null,
        message: "Decoded source viewing requires an authenticated local Studio session.",
      });
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let active = true;
    setDecodedFrame({
      status: "loading",
      url: null,
      contentHash: null,
      message: `Decoding original source frame ${source.currentFrame}…`,
    });
    const timer = window.setTimeout(() => {
      void sourceClient
        .assetSourceFrame(source.sourceId, source.currentFrame, controller.signal)
        .then((result) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(result.blob);
          setDecodedFrame({
            status: "ready",
            url: objectUrl,
            contentHash: result.contentHash,
            message: `Decoded original frame ${result.frame}`,
          });
        })
        .catch((error: unknown) => {
          if (!active || controller.signal.aborted) return;
          setDecodedFrame({
            status: "error",
            url: null,
            contentHash: null,
            message: error instanceof Error ? error.message : "Source-frame decoding failed.",
          });
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [descriptor.label, source.currentFrame, source.sourceId, sourceClient, sourceKind]);
  const commitSourceEdit = (): void => {
    const selected = timeline.selection.selectedIds
      .map((id) => timeline.clips[id])
      .find((clip): clip is ClipSnapshot => clip !== undefined);
    const fallback = Object.values(timeline.clips)[0];
    const template = selected ?? fallback;
    const target = timeline.tracks[targetTrackId as keyof typeof timeline.tracks];
    if (template === undefined || target === undefined || sourceIn === null || sourceOut === null) {
      setEditStatus("Select a source range and target track");
      return;
    }
    try {
      const availableEnd = masterFrame(BigInt(source.durationFrames));
      const sourceTemplate: ClipSnapshot = {
        ...template,
        id: stableEntityId(`clip-source-${crypto.randomUUID()}`),
        trackId: target.id,
        assetId: stableEntityId(source.sourceId),
        nestedSequenceId: null,
        engine:
          source.sourceKind === "hyperframes"
            ? "hyperframes"
            : source.sourceKind === "remotion"
              ? "remotion"
              : "shared",
        name: `Source · ${source.sourceKind}`,
        range: createFrameRange(masterFrame(0n), masterFrame(BigInt(sourceOut) - BigInt(sourceIn))),
        sourceRange: createFrameRange(masterFrame(BigInt(sourceIn)), masterFrame(BigInt(sourceOut))),
        sourceRate: normalizeRational(BigInt(source.fps.numerator), BigInt(source.fps.denominator)),
        speed: normalizeRational(1n, 1n),
        availableSourceRange: createFrameRange(masterFrame(0n), availableEnd),
        transitionInId: null,
        transitionOutId: null,
        keyframeIds: [],
        metadata: { capability: "unified", sourceMonitor: "professional" },
      };
      const built = buildProfessionalSourceEdit(
        timeline,
        {
          sourceClip: sourceTemplate,
          targetTrackId: target.id,
          editKind,
          replaceClipId: editKind === "replace" ? (selected?.id ?? null) : null,
          timelineRate: timeline.fps,
          marks: {
            sourceIn: masterFrame(BigInt(sourceIn)),
            sourceOut: masterFrame(BigInt(sourceOut)),
            timelineIn: masterFrame(BigInt(timelineFrame)),
            timelineOut: null,
          },
        },
        masterFrame(BigInt(source.currentFrame)),
      );
      onTimelineCommand(built.command);
      setEditStatus(
        `${capitalize(editKind)} submitted to ${target.name} at frame ${timelineFrame} · source ${sourceIn}–${sourceOut} · derived ${built.resolved.derivedPoint.replace("-", " ")} · awaiting saved revision`,
      );
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : "Source edit failed validation");
    }
  };
  return (
    <section className="source-inspection" aria-label="Professional source monitor">
      <header className="source-inspection__header">
        <div>
          <strong>Professional source</strong>
          <span>Independent source clock · reversible timeline commands</span>
        </div>
        <div className="source-kind-tabs" role="tablist" aria-label="Source type">
          {(["video", "image", "remotion", "hyperframes"] as const).map((kind) => (
            <button
              type="button"
              role="tab"
              aria-selected={sourceKind === kind}
              className={sourceKind === kind ? "active" : ""}
              key={kind}
              onClick={() => {
                const next = sourceDescriptor(kind, timeline, assets, selectedAssetId, allowFixtureFallback);
                const marks = sourceRangeDefaults(next.durationFrames);
                setSourceKind(kind);
                setSourceIn(marks.sourceIn);
                setSourceOut(marks.sourceOut);
                setSource((current) => ({
                  ...current,
                  sourceId: next.sourceId,
                  sourceKind: kind,
                  currentFrame: "0",
                  durationFrames: next.durationFrames,
                  fps: next.fps,
                  auditionValues: {},
                  auditionDirty: false,
                }));
              }}
            >
              {kind === "hyperframes" ? "HyperFrames" : kind === "remotion" ? "Remotion" : capitalize(kind)}
            </button>
          ))}
        </div>
        <Badge tone={decodedFrame.status === "ready" ? "ready" : "attention"}>
          {decodedFrame.status === "ready"
            ? "Decoded original · audio isolated"
            : sourceKind === "video" || sourceKind === "image"
              ? decodedFrame.status === "loading"
                ? "Decoding original"
                : "Source unavailable"
              : "Validated adapter · preview unavailable"}
        </Badge>
      </header>
      <div className="source-inspection__body">
        <div className="source-inspection__viewer">
          <div
            className={`source-inspection__art source-inspection__art--${sourceKind}`}
            data-source-capture-surface
          >
            {decodedFrame.status === "ready" && decodedFrame.url !== null ? (
              <img
                className="source-inspection__decoded-frame"
                src={decodedFrame.url}
                alt={`${descriptor.label} decoded source frame ${source.currentFrame}`}
                data-testid="source-decoded-frame"
              />
            ) : (
              <div className="source-inspection__decode-status" role="status">
                <strong>
                  {sourceKind === "video" || sourceKind === "image" ? "Source frame" : "Native source"}
                </strong>
                <span>{decodedFrame.message}</span>
              </div>
            )}
            <div className="source-inspection__scanline" />
            <div className="source-inspection__identity">
              <span>{descriptor.label}</span>
              <strong>{timecode}</strong>
              <small>
                Source frame {source.currentFrame} · timeline remains frame {timelineFrame}
              </small>
            </div>
          </div>
          <input
            className="source-scrubber"
            type="range"
            min="0"
            max={Math.max(0, Number(source.durationFrames) - 1)}
            value={source.currentFrame}
            aria-label="Independent source frame"
            onChange={(event) => {
              update({ kind: "seek", frame: event.target.value });
            }}
          />
          <div className="source-inspection__transport" aria-label="Independent source transport">
            <button
              type="button"
              aria-label="Previous source frame"
              onClick={() => {
                update({ kind: "step-frame", delta: -1 });
              }}
            >
              <ChaiIcon name="previous-frame" size={14} />
            </button>
            <button
              type="button"
              aria-label="Next source frame"
              onClick={() => {
                update({ kind: "step-frame", delta: 1 });
              }}
            >
              <ChaiIcon name="next-frame" size={14} />
            </button>
            <code>{timecode}</code>
            <span>
              Frame {source.currentFrame} / {source.durationFrames}
            </span>
            <Badge>Source clock</Badge>
          </div>
        </div>
        <aside className="source-inspection__details" aria-label="Source editing, metadata and audition">
          <section className="source-inspection__actions professional-source-edit">
            <h3>Source marks &amp; three-point edit</h3>
            <div className="source-mark-row">
              <Button
                variant="ghost"
                onClick={() => {
                  setSourceIn(source.currentFrame);
                }}
              >
                <ChaiIcon name="mark-in" size={14} /> Mark I
              </Button>
              <code>{sourceIn ?? "—"}</code>
              <Button
                variant="ghost"
                onClick={() => {
                  setSourceOut(String(BigInt(source.currentFrame) + 1n));
                }}
              >
                <ChaiIcon name="mark-out" size={14} /> Mark O
              </Button>
              <code>{sourceOut ?? "—"}</code>
            </div>
            <label className="source-patch-field">
              <span>Target track</span>
              <select
                value={targetTrackId}
                onChange={(event) => {
                  setTargetTrackId(event.target.value);
                }}
              >
                {timeline.trackIds.map((trackId) => {
                  const track = timeline.tracks[trackId];
                  return track === undefined ? null : (
                    <option value={track.id} key={track.id} disabled={track.locked}>
                      {track.name} · {track.kind}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="source-edit-kind" role="radiogroup" aria-label="Source edit kind">
              {(["insert", "overwrite", "replace"] as const).map((kind) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={editKind === kind}
                  className={editKind === kind ? "active" : ""}
                  onClick={() => {
                    setEditKind(kind);
                  }}
                  key={kind}
                >
                  {capitalize(kind)}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={commitSourceEdit}>
              <ChaiIcon name="render-timeline" size={16} /> Apply three-point edit
            </Button>
            <p className="source-edit-status" role="status" aria-live="polite">
              {editStatus}
            </p>
            <h3>Review actions</h3>
            <Button
              disabled
              title="Source-to-timeline comparison is unavailable until two distinct revision-bound captures are selected."
            >
              <ChaiIcon name="capture-ab" size={16} /> Compare to timeline frame
            </Button>
            <Button
              disabled
              title="Adding a decoded source frame to Codex context is not implemented in this build."
            >
              <ChaiIcon name="review-bundle" size={16} /> Add source to Codex context
            </Button>
            <Button
              disabled={decodedFrame.status !== "ready"}
              title={
                decodedFrame.status === "ready"
                  ? "Capture the currently decoded original source frame."
                  : decodedFrame.message
              }
              onClick={() => {
                onCapture("source-frame", false, source);
              }}
            >
              <ChaiIcon name="capture-exact" size={16} /> Capture source frame
            </Button>
            <p className="source-boundary-note">
              Source transport never seeks the master timeline. Every edit validates both ranges and enters
              the same undoable revision history as timeline edits.
            </p>
          </section>
          <section>
            <h3>Metadata</h3>
            <dl className="source-metadata">
              <div>
                <dt>Stable ID</dt>
                <dd>{source.sourceId}</dd>
              </div>
              <div>
                <dt>Kind</dt>
                <dd>{sourceKind}</dd>
              </div>
              <div>
                <dt>Dimensions</dt>
                <dd>{descriptor.dimensions}</dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd>
                  {source.fps.numerator}/{source.fps.denominator}
                </dd>
              </div>
              <div>
                <dt>Proxy</dt>
                <dd>{descriptor.proxy}</dd>
              </div>
              <div>
                <dt>Audio</dt>
                <dd>{descriptor.audio}</dd>
              </div>
              <div>
                <dt>Decoded</dt>
                <dd>
                  {decodedFrame.contentHash === null
                    ? decodedFrame.status
                    : `sha256 ${decodedFrame.contentHash.slice(0, 12)}…`}
                </dd>
              </div>
            </dl>
          </section>
          {sourceKind === "remotion" || sourceKind === "hyperframes" ? (
            <section>
              <h3>Preview-only audition</h3>
              <label className="source-audition-field">
                <span>{sourceKind === "remotion" ? "headline" : "accent"}</span>
                <input
                  value={String(
                    source.auditionValues[sourceKind === "remotion" ? "headline" : "accent"] ??
                      (sourceKind === "remotion" ? "The future starts here" : "#8D87FF"),
                  )}
                  onChange={(event) => {
                    update({
                      kind: "audition-property",
                      propertyId: sourceKind === "remotion" ? "headline" : "accent",
                      value: event.target.value,
                    });
                  }}
                />
              </label>
              <div className="source-audition-status">
                <Badge tone={source.auditionDirty ? "attention" : "ready"}>
                  {source.auditionDirty ? "Preview override" : "Source defaults"}
                </Badge>
                <Button
                  variant="ghost"
                  disabled={!source.auditionDirty}
                  onClick={() => {
                    update({ kind: "reset-audition" });
                  }}
                >
                  <ChaiIcon name="undo" size={14} /> Reset audition
                </Button>
              </div>
              <p>Audition values never commit a source or timeline edit.</p>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
};

const capitalize = (value: string): string => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const sourceDescriptor = (
  kind: SourceInspectionState["sourceKind"],
  timeline: TimelineSnapshotV1,
  assets: readonly AssetRecord[],
  selectedAssetId: string | null,
  allowFixtureFallback: boolean,
): SourceDescriptor => {
  const fallback = fallbackSourceDescriptors[kind];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const selectedAsset = selectedAssetId === null ? undefined : assetsById.get(selectedAssetId);
  if (selectedAsset !== undefined && assetMatchesSourceKind(selectedAsset, kind, timeline)) {
    const duration = BigInt(selectedAsset.durationFrames ?? "1");
    const fps =
      selectedAsset.fps ??
      (selectedAsset.kind === "image" ? { numerator: "1", denominator: "1" } : timeline.fps);
    return {
      sourceId: selectedAsset.id,
      label: selectedAsset.path.split("/").at(-1) ?? selectedAsset.id,
      durationFrames: (duration > 0n ? duration : 1n).toString(10),
      fps: { numerator: fps.numerator, denominator: fps.denominator },
      dimensions: selectedAsset.kind === "image" ? "Image source" : "Native media source",
      proxy: "Decoded original · content-addressed frame cache",
      audio: selectedAsset.hasAudio ? "Source audio available" : "Not applicable",
    };
  }
  const matchesKind = (clip: ClipSnapshot): boolean => {
    if (kind === "remotion" || kind === "hyperframes") return clip.engine === kind;
    const asset = clip.assetId === null ? undefined : assetsById.get(clip.assetId);
    if (asset !== undefined) return clip.engine === "shared" && asset.kind === kind;
    if (kind === "video") return clip.engine === "shared" && /interview|product/iu.test(clip.name);
    return clip.engine === "shared" && /image|hero|environment/iu.test(clip.name);
  };
  const selectedClips = timeline.selection.selectedIds
    .map((id) => timeline.clips[id])
    .filter((clip): clip is ClipSnapshot => clip !== undefined);
  const matchingClip = selectedClips.find(matchesKind) ?? Object.values(timeline.clips).find(matchesKind);
  if (matchingClip === undefined) {
    return allowFixtureFallback
      ? fallback
      : {
          sourceId: `source-unavailable-${kind}`,
          label: `No ${kind} source selected`,
          durationFrames: "1",
          fps: { numerator: timeline.fps.numerator, denominator: timeline.fps.denominator },
          dimensions: "Unavailable",
          proxy: "Select a matching project asset",
          audio: "Not applicable",
        };
  }
  const asset = matchingClip.assetId === null ? undefined : assetsById.get(matchingClip.assetId);
  const sourceDuration =
    asset?.durationFrames === null || asset?.durationFrames === undefined
      ? matchingClip.availableSourceRange.end - matchingClip.availableSourceRange.start
      : BigInt(asset.durationFrames);
  const fps = asset?.fps ?? matchingClip.sourceRate;
  return {
    ...fallback,
    sourceId: matchingClip.assetId ?? fallback.sourceId,
    label: matchingClip.name,
    durationFrames: sourceDuration > 0n ? sourceDuration.toString(10) : fallback.durationFrames,
    fps: {
      numerator: fps.numerator,
      denominator: fps.denominator,
    },
    proxy:
      kind === "video" || kind === "image"
        ? "Decoded original · content-addressed frame cache"
        : fallback.proxy,
  };
};

const selectedSourceKind = (
  assets: readonly AssetRecord[],
  timeline: TimelineSnapshotV1,
  selectedAssetId: string | null,
): SourceInspectionState["sourceKind"] | null => {
  if (selectedAssetId === null) return null;
  const asset = assets.find((candidate) => candidate.id === selectedAssetId);
  if (asset?.kind === "video" || asset?.kind === "image") return asset.kind;
  if (asset?.kind !== "composition") return null;
  const clip = Object.values(timeline.clips).find((candidate) => candidate.assetId === selectedAssetId);
  return clip?.engine === "remotion" || clip?.engine === "hyperframes" ? clip.engine : null;
};

const assetMatchesSourceKind = (
  asset: AssetRecord,
  kind: SourceInspectionState["sourceKind"],
  timeline: TimelineSnapshotV1,
): boolean => {
  if (kind === "video" || kind === "image") return asset.kind === kind;
  if (asset.kind !== "composition") return false;
  return Object.values(timeline.clips).some((clip) => clip.assetId === asset.id && clip.engine === kind);
};

interface DecodedSourceFrame {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly url: string | null;
  readonly contentHash: string | null;
  readonly message: string;
}

const sourceRangeDefaults = (durationFrames: string): Readonly<{ sourceIn: string; sourceOut: string }> => {
  const duration = BigInt(durationFrames);
  const sourceOut = duration < 420n ? duration : 420n;
  const sourceIn = sourceOut > 120n ? sourceOut - 120n : 0n;
  return { sourceIn: sourceIn.toString(10), sourceOut: sourceOut.toString(10) };
};
