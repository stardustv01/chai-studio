import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import type { AudioGraphCommand } from "@chai-studio/audio";
import type { SelectionContextManifest } from "@chai-studio/bridge";
import type { LanguageCommand } from "@chai-studio/captions";
import type { AnnotationDocument, AssetRecord, NormalizedRational } from "@chai-studio/schema";
import { normalizeRational } from "@chai-studio/schema/rational";
import { Badge, Button, TextField } from "@chai-studio/ui-components";
import {
  createDefaultTimelineClipProperties,
  createFrameRange,
  formatTimecode,
  masterFrame,
  stableEntityId,
  type TrackSnapshot,
  type TimelineEditCommand,
} from "@chai-studio/timeline/browser";
import type {
  MonitorCaptureMode,
  MonitorComparisonMode,
  ProgramMonitorCommand,
  SourceInspectionState,
} from "./monitor-contract.js";
import { ProgramMonitor } from "./program-monitor.js";
import { SourceInspectionMonitor } from "./source-inspection-monitor.js";
import { TimelineEditor } from "./timeline-editor.js";
import { ContextualInspector } from "./inspector-panel.js";
import { KeyframeCurveEditor } from "./keyframe-editor.js";
import { AudioMixerPanel } from "./audio-mixer-panel.js";
import { TranscriptCaptionPanel } from "./transcript-caption-panel.js";
import type { StudioSnapshot, WorkspaceId } from "./types.js";
import { StudioApiClient, type StudioJobView } from "./api-client.js";
import { ReviewContactSheet, ReviewNavigator } from "./review-workspace.js";
import { DeliveryProfilesPanel, DeliveryQueueCenter, DeliveryReceiptPanel } from "./delivery-workspace.js";
import { BridgeEditorPanel } from "./bridge-editor-panel.js";
import { ChaiIcon } from "./chai-icon.js";

interface WorkspaceContentProps {
  readonly workspace: WorkspaceId;
  readonly snapshot: StudioSnapshot;
  readonly monitorActions: WorkspaceMonitorActions;
}

export interface WorkspaceMonitorActions {
  readonly authoritativeCaptureAvailable: boolean;
  readonly command: (command: ProgramMonitorCommand) => void;
  readonly comparisonMode: MonitorComparisonMode;
  readonly selectComparisonMode: (mode: MonitorComparisonMode) => void;
  readonly capture: (
    mode: MonitorCaptureMode,
    includeOverlays: boolean,
    source?: SourceInspectionState,
  ) => void;
  readonly sourceReview: (
    action: "compare-to-timeline" | "add-to-context",
    source: SourceInspectionState,
  ) => void;
  readonly timeline: (command: TimelineEditCommand) => void;
  readonly audio: (command: AudioGraphCommand) => void;
  readonly language: (command: LanguageCommand) => void;
  readonly timelineHistory: (direction: "undo" | "redo") => void;
  readonly timelineUndoLabel: string | null;
  readonly timelineRedoLabel: string | null;
  readonly animationPropertyPath: string;
  readonly selectAnimationProperty: (propertyPath: string) => void;
  readonly mediaBrowserSelection: string;
  readonly selectMediaBrowser: (selection: string) => void;
  readonly navigateWorkspace: (workspace: WorkspaceId) => void;
  readonly importAssets: (files: readonly File[], rights: AssetRecord["rights"]) => void;
  readonly inspectAsset: (assetId: string) => Promise<boolean>;
  readonly relinkAsset: (assetId: string, sourcePath: string) => Promise<boolean>;
  readonly selectAsset: (assetId: string) => void;
}

export const WorkspaceLeftPanel = ({ monitorActions, workspace, snapshot }: WorkspaceContentProps) => {
  const [assetQuery, setAssetQuery] = useState("");
  const [projectAssetQuery, setProjectAssetQuery] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [mediaTab, setMediaTab] = useState("Media");
  const [assetCollection, setAssetCollection] = useState("All sequence assets");
  const [importRights, setImportRights] = useState<AssetRecord["rights"]>("unknown");
  const importInput = useRef<HTMLInputElement>(null);
  const assets = sequenceAssets(snapshot);
  const visibleAssets = assets.filter((asset) => {
    const matchesQuery = `${asset.label} ${asset.meta} ${asset.type} ${asset.engine}`
      .toLocaleLowerCase()
      .includes(assetQuery.trim().toLocaleLowerCase());
    const matchesCollection =
      assetCollection === "All sequence assets" ||
      (assetCollection === "Titles" && asset.type === "R") ||
      (assetCollection === "Product footage" && asset.label.toLocaleLowerCase().includes("product")) ||
      (assetCollection === "Music & SFX" && asset.type === "Audio");
    return matchesQuery && matchesCollection;
  });
  if (workspace === "deliver") {
    return <DeliveryProfilesPanel />;
  }
  if (workspace === "inspect") {
    return <ReviewNavigator snapshot={snapshot} />;
  }
  if (workspace === "media") {
    const browserRows = [
      "Project root",
      "Footage",
      "Interviews",
      "Product",
      "Audio",
      "Graphics",
      "Compositions",
    ] as const;
    const smartRows = [
      ["Missing / offline", "warning"],
      ["Validation pending", "info"],
      ["Approved", "ready"],
      ["Duplicate hash", "neutral"],
    ] as const;
    const query = projectQuery.trim().toLocaleLowerCase();
    return (
      <PanelContent
        title="Project browser"
        action={<ChaiIcon name="import-media" size={16} />}
        actionTitle="Import media into this project"
        onAction={() => {
          importInput.current?.click();
        }}
      >
        <AssetImportControls
          inputRef={importInput}
          rights={importRights}
          onRightsChange={setImportRights}
          onImport={monitorActions.importAssets}
        />
        <TextField
          label="Search project"
          placeholder="Folders and collections"
          value={projectQuery}
          onChange={(event) => {
            setProjectQuery(event.currentTarget.value);
          }}
        />
        <ListSection title="Folders">
          {browserRows
            .filter((label) => label.toLocaleLowerCase().includes(query))
            .map((label) => (
              <ListRow
                active={monitorActions.mediaBrowserSelection === label}
                label={label}
                meta={String(filterMediaAssetsByBrowserSelection(assets, label).length)}
                onSelect={() => {
                  monitorActions.selectMediaBrowser(label);
                }}
                key={label}
              />
            ))}
        </ListSection>
        <ListSection title="Smart collections">
          {smartRows
            .filter(([label]) => label.toLocaleLowerCase().includes(query))
            .map(([label, tone]) => (
              <ListRow
                active={monitorActions.mediaBrowserSelection === label}
                label={label}
                meta={String(filterMediaAssetsByBrowserSelection(assets, label).length)}
                tone={tone}
                onSelect={() => {
                  monitorActions.selectMediaBrowser(label);
                }}
                key={label}
              />
            ))}
        </ListSection>
        {browserRows.every((label) => !label.toLocaleLowerCase().includes(query)) &&
        smartRows.every(([label]) => !label.toLocaleLowerCase().includes(query)) ? (
          <p className="empty-filter-state">No folders or collections match “{projectQuery}”.</p>
        ) : null}
      </PanelContent>
    );
  }
  if (workspace === "animation") {
    const primaryId = snapshot.timeline.selection.primaryId;
    const clip = primaryId === null ? undefined : snapshot.timeline.clips[primaryId];
    const properties = Object.entries(clip?.properties ?? {}).filter(([, state]) => state.keyframeable);
    return (
      <PanelContent title="Animated property">
        {properties.map(([path]) => (
          <ListRow
            active={monitorActions.animationPropertyPath === path}
            label={
              <>
                <ChaiIcon name="animated-property" size={16} /> {propertyDisplayName(path)}
              </>
            }
            onSelect={() => {
              monitorActions.selectAnimationProperty(path);
            }}
            key={path}
          />
        ))}
        <div className="panel-callout panel-callout--bottom">
          <span>Ownership</span>
          <strong>{clip?.name ?? "Select one clip"}</strong>
          <small>
            {clip === undefined
              ? "No animation owner"
              : `${clip.engine} · frames ${String(clip.range.start)}–${String(clip.range.end)} (end exclusive)`}
          </small>
        </div>
      </PanelContent>
    );
  }
  return (
    <PanelContent
      title="Media"
      tabs={["Media", "Project", "Transcript"]}
      activeTab={mediaTab}
      onTabChange={setMediaTab}
      action={<ChaiIcon name="import-media" size={16} />}
      actionTitle="Import media into this project"
      onAction={() => {
        importInput.current?.click();
      }}
    >
      <AssetImportControls
        inputRef={importInput}
        rights={importRights}
        onRightsChange={setImportRights}
        onImport={monitorActions.importAssets}
      />
      {mediaTab === "Media" ? (
        <>
          <TextField
            label="Search assets"
            placeholder="Assets, comps, transcripts"
            value={assetQuery}
            onChange={(event) => {
              setAssetQuery(event.currentTarget.value);
            }}
          />
          <ListSection title="Used in sequence">
            {visibleAssets.map((asset) => (
              <AssetRow
                active={asset.selected}
                assetId={asset.assetId}
                label={asset.label}
                meta={asset.meta}
                type={asset.type}
                onSelect={() => {
                  monitorActions.selectAsset(asset.assetId);
                  selectAssetInTimeline(snapshot, asset.assetId, monitorActions.timeline);
                }}
                key={asset.assetId}
              />
            ))}
            {visibleAssets.length === 0 ? (
              <p className="empty-filter-state">No sequence assets match this filter.</p>
            ) : null}
          </ListSection>
          <ListSection title="Collections">
            {["All sequence assets", "Titles", "Product footage", "Music & SFX"].map((label) => (
              <ListRow
                active={assetCollection === label}
                label={label}
                {...(label === "All sequence assets" ? { meta: String(assets.length) } : {})}
                onSelect={() => {
                  setAssetCollection(label);
                }}
                key={label}
              />
            ))}
          </ListSection>
        </>
      ) : mediaTab === "Project" ? (
        <>
          <div className="panel-callout">
            <span>Current project</span>
            <strong>{snapshot.project?.title ?? "No project open"}</strong>
            <small>
              {snapshot.project === null
                ? "Open a project to browse its registered media."
                : `${String(snapshot.assets.length)} registered assets · ${String(assets.filter((asset) => asset.used).length)} used`}
            </small>
          </div>
          <TextField
            label="Search project assets"
            placeholder="Name, type, status"
            value={projectAssetQuery}
            onChange={(event) => {
              setProjectAssetQuery(event.currentTarget.value);
            }}
          />
          <ListSection title="Registered assets">
            {assets
              .filter((asset) =>
                `${asset.label} ${asset.type} ${asset.validationState}`
                  .toLocaleLowerCase()
                  .includes(projectAssetQuery.trim().toLocaleLowerCase()),
              )
              .map((asset) => (
                <AssetRow
                  active={asset.selected}
                  assetId={asset.assetId}
                  label={asset.label}
                  meta={`${asset.used ? "Used" : "Unused"} · ${asset.validationState}`}
                  type={asset.type}
                  onSelect={() => {
                    monitorActions.selectAsset(asset.assetId);
                    selectAssetInTimeline(snapshot, asset.assetId, monitorActions.timeline);
                  }}
                  key={asset.assetId}
                />
              ))}
          </ListSection>
        </>
      ) : (
        <>
          <div className="panel-callout">
            <span>Linked language</span>
            <strong>{String(snapshot.transcripts.length)} transcript documents</strong>
            <small>{String(snapshot.captionDocuments.length)} caption documents</small>
          </div>
          {snapshot.transcripts.length === 0 ? (
            <div className="honest-unavailable-state" role="status">
              <strong>No linked transcript</strong>
              <span>Import validated SRT, VTT, or an internal transcript to begin.</span>
            </div>
          ) : (
            snapshot.transcripts.map((transcript) => (
              <ListSection
                title={`${transcript.language} · ${String(transcript.phrases.length)} phrases`}
                key={transcript.transcriptId}
              >
                {transcript.phrases.map((phrase) => (
                  <ListRow
                    label={phrase.text}
                    meta={`${phrase.startFrame}–${phrase.endFrameExclusive}`}
                    onSelect={() => {
                      monitorActions.command({ kind: "seek-frame", frame: phrase.startFrame });
                      monitorActions.timeline({
                        kind: "range.set",
                        range: createFrameRange(
                          masterFrame(BigInt(phrase.startFrame)),
                          masterFrame(BigInt(phrase.endFrameExclusive)),
                        ),
                      });
                      monitorActions.language({
                        kind: "language.range.select",
                        transcriptId: transcript.transcriptId,
                        phraseId: phrase.id,
                      });
                    }}
                    key={phrase.id}
                  />
                ))}
              </ListSection>
            ))
          )}
        </>
      )}
    </PanelContent>
  );
};

export const WorkspaceCenter = ({ monitorActions, workspace, snapshot }: WorkspaceContentProps) => {
  if (workspace === "deliver") return <DeliveryQueueCenter snapshot={snapshot} />;
  if (workspace === "media")
    return (
      <MediaCenter
        browserSelection={monitorActions.mediaBrowserSelection}
        selectBrowser={monitorActions.selectMediaBrowser}
        snapshot={snapshot}
        timeline={monitorActions.timeline}
        selectAsset={monitorActions.selectAsset}
      />
    );
  const inspect = workspace === "inspect";
  const animation = workspace === "animation";
  const authenticated = window.__CHAI_STUDIO_SESSION__ !== undefined;
  const selectedClips = snapshot.timeline.selection.selectedIds.flatMap((id) => {
    const clip = snapshot.timeline.clips[id];
    const track = clip === undefined ? undefined : snapshot.timeline.tracks[clip.trackId];
    return clip === undefined || track?.kind !== "video" ? [] : [clip];
  });
  const programArtwork = authenticated ? (
    <AuthenticatedProgramArtwork snapshot={snapshot} />
  ) : (
    <ProgramArtwork
      animation={animation}
      snapshot={snapshot}
      propertyPath={monitorActions.animationPropertyPath}
      onExplore={() => {
        monitorActions.navigateWorkspace("inspect");
      }}
    />
  );
  return (
    <ProgramMonitor
      authoritativeCaptureAvailable={monitorActions.authoritativeCaptureAvailable}
      preview={snapshot.preview}
      revision={snapshot.project}
      artwork={programArtwork}
      captureContext={{
        selectedClipCount: selectedClips.length,
        selectedClipsAreShared:
          selectedClips.length > 0 && selectedClips.every((clip) => clip.engine === "shared"),
        hasInOutRange: snapshot.preview.inOutRange !== null,
      }}
      comparisonArtwork={
        authenticated ? (
          programArtwork
        ) : (
          <ProgramArtwork animation={false} comparisonVariant snapshot={snapshot} />
        )
      }
      comparison={inspect}
      comparisonMode={monitorActions.comparisonMode}
      selectedLayerLabel={animation ? "ParticleBridge" : "FutureTitle_v04"}
      onCommand={monitorActions.command}
      onComparisonModeChange={monitorActions.selectComparisonMode}
      onCapture={monitorActions.capture}
    />
  );
};

export const WorkspaceRightPanel = ({ monitorActions, workspace, snapshot }: WorkspaceContentProps) => {
  if (workspace === "deliver") return <DeliveryReceiptPanel snapshot={snapshot} />;
  if (workspace === "inspect")
    return <ContextInspector snapshot={snapshot} monitorActions={monitorActions} />;
  if (workspace === "media")
    return (
      <MediaInspector
        snapshot={snapshot}
        onCommand={monitorActions.timeline}
        onRelinkAsset={monitorActions.relinkAsset}
      />
    );
  return (
    <ContextualInspector
      snapshot={snapshot}
      onCommand={monitorActions.timeline}
      onInspectAsset={monitorActions.inspectAsset}
      assetInspectionAvailable={monitorActions.authoritativeCaptureAvailable}
    />
  );
};

export const WorkspaceLowerPanel = ({
  monitorActions,
  snapshot,
  workspace,
}: Pick<WorkspaceContentProps, "workspace" | "snapshot" | "monitorActions">) => {
  if (workspace === "deliver") return null;
  if (workspace === "inspect")
    return (
      <ReviewContactSheet
        comparisonMode={monitorActions.comparisonMode}
        snapshot={snapshot}
        onComparisonModeChange={monitorActions.selectComparisonMode}
        onSeek={(frame) => {
          monitorActions.command({ kind: "seek-frame", frame });
        }}
        onSelectRange={(startFrame, endFrameExclusive) => {
          monitorActions.timeline({
            kind: "range.set",
            range: createFrameRange(masterFrame(BigInt(startFrame)), masterFrame(BigInt(endFrameExclusive))),
          });
        }}
      />
    );
  if (workspace === "media") {
    return (
      <SourceAndTranscript
        snapshot={snapshot}
        capture={monitorActions.capture}
        sourceReview={monitorActions.sourceReview}
        seek={monitorActions.command}
        timeline={monitorActions.timeline}
        language={monitorActions.language}
      />
    );
  }
  if (workspace === "animation") {
    return <AnimationLowerPanel snapshot={snapshot} monitorActions={monitorActions} />;
  }
  return (
    <TimelineEditor
      timeline={snapshot.timeline}
      currentFrame={snapshot.preview.masterFrame}
      onSeekFrame={(frame) => {
        monitorActions.command({ kind: "seek-frame", frame });
      }}
      onCommand={monitorActions.timeline}
      onUndo={() => {
        monitorActions.timelineHistory("undo");
      }}
      onRedo={() => {
        monitorActions.timelineHistory("redo");
      }}
      undoLabel={monitorActions.timelineUndoLabel}
      redoLabel={monitorActions.timelineRedoLabel}
      onAssetDrop={({ assetId, frame, trackId }) =>
        placeAssetAtTimelineFrame(snapshot, assetId, trackId, frame, monitorActions.timeline)
      }
    />
  );
};

const AnimationLowerPanel = ({
  monitorActions,
  snapshot,
}: Pick<WorkspaceContentProps, "snapshot" | "monitorActions">) => {
  const [surface, setSurface] = useState<"keyframes" | "audio" | "bridge">("keyframes");
  return (
    <div className="animation-lower-stack">
      <div className="lower-surface-switcher" role="tablist" aria-label="Animation lower surface">
        <button
          className={surface === "keyframes" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={surface === "keyframes"}
          onClick={() => {
            setSurface("keyframes");
          }}
        >
          Keyframes
        </button>
        <button
          className={surface === "audio" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={surface === "audio"}
          onClick={() => {
            setSurface("audio");
          }}
        >
          Audio mix
        </button>
        <button
          className={surface === "bridge" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={surface === "bridge"}
          onClick={() => {
            setSurface("bridge");
          }}
        >
          Bridge editor
        </button>
      </div>
      {surface === "keyframes" ? (
        <KeyframeCurveEditor
          timeline={snapshot.timeline}
          currentFrame={snapshot.preview.masterFrame}
          onCommand={monitorActions.timeline}
          onSeek={(frame) => {
            monitorActions.command({ kind: "seek-frame", frame });
          }}
          propertyPath={monitorActions.animationPropertyPath}
          onPropertyChange={monitorActions.selectAnimationProperty}
        />
      ) : surface === "audio" ? (
        <AudioMixerPanel
          graph={snapshot.audioGraph}
          currentFrame={snapshot.preview.masterFrame}
          onCommand={monitorActions.audio}
        />
      ) : (
        <BridgeEditorPanel timeline={snapshot.timeline} onCommand={monitorActions.timeline} />
      )}
    </div>
  );
};

const PanelContent = ({
  actionDisabled = false,
  actionTitle,
  activeTab,
  action,
  children,
  onAction,
  onTabChange,
  tabs,
  title,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly actionDisabled?: boolean;
  readonly actionTitle?: string;
  readonly onAction?: () => void;
  readonly tabs?: readonly string[];
  readonly activeTab?: string;
  readonly onTabChange?: (tab: string) => void;
  readonly children: React.ReactNode;
}) => (
  <div className="panel-content">
    <div className="panel-titlebar">
      {tabs === undefined ? (
        <strong>{title}</strong>
      ) : (
        <div className="mini-tabs">
          {tabs.map((tab) => (
            <button
              className={(activeTab ?? tabs[0]) === tab ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={(activeTab ?? tabs[0]) === tab}
              onClick={() => {
                onTabChange?.(tab);
              }}
              key={tab}
            >
              {tab}
            </button>
          ))}
        </div>
      )}
      {action === undefined ? null : (
        <button
          className="panel-add"
          type="button"
          aria-label={
            actionDisabled ? `${actionTitle ?? `Add to ${title}`} (unavailable)` : `Add to ${title}`
          }
          disabled={actionDisabled}
          title={actionTitle}
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </div>
    <div className="panel-scroll">{children}</div>
  </div>
);

const AssetImportControls = ({
  inputRef,
  onImport,
  onRightsChange,
  rights,
}: {
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onImport: (files: readonly File[], rights: AssetRecord["rights"]) => void;
  readonly onRightsChange: (rights: AssetRecord["rights"]) => void;
  readonly rights: AssetRecord["rights"];
}) => (
  <div className="asset-import-controls">
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      aria-label="Choose project media"
      onChange={(event) => {
        const files = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = "";
        onImport(files, rights);
      }}
    />
    <label>
      <span>Import rights</span>
      <select
        aria-label="Import rights"
        value={rights}
        onChange={(event) => {
          onRightsChange(event.currentTarget.value as AssetRecord["rights"]);
        }}
      >
        <option value="unknown">Unknown — review required</option>
        <option value="owned">Owned</option>
        <option value="licensed">Licensed</option>
        <option value="public-domain">Public domain</option>
      </select>
    </label>
    <small>Files are copied into the project; unknown rights remain release-blocking.</small>
  </div>
);

const ListSection = ({ children, title }: { readonly children: React.ReactNode; readonly title: string }) => (
  <section className="list-section">
    <h3>{title}</h3>
    {children}
  </section>
);

const ListRow = ({
  active = false,
  label,
  meta,
  tone = "neutral",
  onSelect,
}: {
  readonly active?: boolean;
  readonly label: React.ReactNode;
  readonly meta?: string;
  readonly tone?: "neutral" | "info" | "ready" | "warning" | "danger";
  readonly onSelect?: () => void;
}) => (
  <button
    className={active ? "list-row list-row--active" : "list-row"}
    type="button"
    aria-pressed={active}
    onClick={onSelect}
  >
    <span className={`row-dot row-dot--${tone}`} aria-hidden="true" />
    <span>{label}</span>
    {meta === undefined ? null : <small>{meta}</small>}
  </button>
);

const AssetRow = ({
  active = false,
  assetId,
  label,
  meta,
  type,
  onSelect,
}: {
  readonly active?: boolean;
  readonly assetId: string;
  readonly label: string;
  readonly meta: string;
  readonly type: string;
  readonly onSelect: () => void;
}) => (
  <button
    className={active ? "asset-row asset-row--active" : "asset-row"}
    type="button"
    draggable
    aria-pressed={active}
    title="Select this asset or drag it onto a timeline track."
    onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-chai-studio-asset-id", assetId);
      event.dataTransfer.setData("text/plain", assetId);
    }}
    onClick={onSelect}
  >
    <span className="asset-thumb">
      <i />
    </span>
    <span className="asset-copy">
      <strong>{label}</strong>
      <small>{meta}</small>
    </span>
    <Badge tone={type === "H" ? "attention" : type === "R" ? "info" : "ready"}>{type}</Badge>
  </button>
);

const ProgramArtwork = ({
  animation,
  comparisonVariant = false,
  onExplore,
  snapshot,
  propertyPath = "transform.opacity",
}: {
  readonly animation: boolean;
  readonly comparisonVariant?: boolean;
  readonly onExplore?: () => void;
  readonly snapshot: StudioSnapshot;
  readonly propertyPath?: string;
}) => (
  <div
    className={`${animation ? "program-art program-art--animation" : "program-art"}${comparisonVariant ? " program-art--comparison-variant" : ""}`}
    style={{ opacity: comparisonVariant ? 1 : evaluatedOpacity(snapshot, propertyPath) }}
    data-capture-surface="program"
  >
    <div className="art-safe-area" />
    <div className="art-grid" />
    <div className="art-orb" />
    <div className="art-copy">
      <span>{animation ? "Engine bridge" : "Chai Studio"}</span>
      <h2>
        {animation ? (
          <>
            Pixels cross the
            <br />
            boundary without
            <br />
            losing time.
          </>
        ) : (
          <>
            The future starts at
            <br />
            frame zero.
          </>
        )}
      </h2>
      <p>
        {animation
          ? "Outgoing Remotion title → HyperFrames particle field"
          : "One timeline. Two native engines. Exact visual context for every revision."}
      </p>
      {!animation && onExplore !== undefined ? (
        <Button variant="ghost" onClick={onExplore}>
          Explore the system →
        </Button>
      ) : null}
    </div>
  </div>
);

const AuthenticatedProgramArtwork = ({ snapshot }: { readonly snapshot: StudioSnapshot }) => {
  const [client] = useState(
    () =>
      new StudioApiClient({
        sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
        baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
      }),
  );
  const [frame, setFrame] = useState<Readonly<{
    url: string;
    masterFrame: string;
    revisionId: string;
    contentHash: string;
  }> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const frameUrl = useRef<string | null>(null);
  const revisionId = snapshot.project?.revisionId ?? null;
  const masterFrame = snapshot.preview.masterFrame;
  const liveMasterFrame = useRef(masterFrame);
  const liveRevisionId = useRef(revisionId);
  liveMasterFrame.current = masterFrame;
  liveRevisionId.current = revisionId;

  const loadProgramFrame = useCallback(
    async (requestedFrame: string, requestedRevisionId: string, signal: AbortSignal): Promise<void> => {
      const payload = await client.programFrame(requestedFrame, requestedRevisionId, signal);
      const url = URL.createObjectURL(payload.blob);
      if (signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      if (frameUrl.current !== null) URL.revokeObjectURL(frameUrl.current);
      frameUrl.current = url;
      setFrame({
        url,
        masterFrame: payload.frame,
        revisionId: payload.revisionId,
        contentHash: payload.contentHash,
      });
      setStatus("ready");
    },
    [client],
  );

  useEffect(() => {
    if (revisionId === null || snapshot.preview.durationFrames === "0") {
      setStatus("unavailable");
      return;
    }
    if (snapshot.preview.playback === "playing") return;
    const controller = new AbortController();
    setStatus("loading");
    void loadProgramFrame(masterFrame, revisionId, controller.signal).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setStatus("unavailable");
    });
    return () => {
      controller.abort();
    };
  }, [loadProgramFrame, masterFrame, revisionId, snapshot.preview.durationFrames, snapshot.preview.playback]);

  useEffect(() => {
    if (
      snapshot.preview.playback !== "playing" ||
      revisionId === null ||
      snapshot.preview.durationFrames === "0"
    )
      return;
    const controller = new AbortController();
    let requestInFlight = false;
    const refresh = (): void => {
      const currentRevisionId = liveRevisionId.current;
      if (requestInFlight || currentRevisionId === null) return;
      requestInFlight = true;
      void loadProgramFrame(liveMasterFrame.current, currentRevisionId, controller.signal)
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setStatus("unavailable");
        })
        .finally(() => {
          requestInFlight = false;
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 125);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [loadProgramFrame, revisionId, snapshot.preview.durationFrames, snapshot.preview.playback]);

  useEffect(
    () => () => {
      if (frameUrl.current !== null) URL.revokeObjectURL(frameUrl.current);
    },
    [],
  );

  if (frame === null) {
    return (
      <div className="program-frame-state" data-capture-surface="program" role="status">
        <strong>
          {status === "loading" ? "Compositing authoritative program frame" : "Program frame unavailable"}
        </strong>
        <span>
          {status === "loading"
            ? `Revision ${revisionId ?? "loading"} · frame ${masterFrame}`
            : "No synthetic picture is substituted. Check validated media and compositor diagnostics."}
        </span>
      </div>
    );
  }
  return (
    <figure className="program-frame" data-capture-surface="program">
      <img src={frame.url} alt={`Authoritative program frame ${frame.masterFrame}`} draggable={false} />
      <figcaption>
        <span>
          {snapshot.preview.playback === "playing"
            ? `Rendered frame ${frame.masterFrame} · transport at ${masterFrame}`
            : `Rendered frame ${frame.masterFrame}`}
        </span>
        <code>{frame.contentHash.slice(0, 10)}</code>
      </figcaption>
    </figure>
  );
};

const propertyDisplayName = (path: string): string => {
  const value = path.split(".").at(-1) ?? path;
  return value.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/^./u, (character) => character.toUpperCase());
};

const evaluatedOpacity = (snapshot: StudioSnapshot, propertyPath: string): number => {
  if (propertyPath !== "transform.opacity") return 1;
  const clipId = snapshot.timeline.selection.primaryId;
  const clip = clipId === null ? undefined : snapshot.timeline.clips[clipId];
  if (clip === undefined) return 1;
  const base = clip.properties?.[propertyPath]?.value;
  const keys = Object.values(snapshot.timeline.keyframes)
    .filter(
      (key): key is typeof key & { readonly value: number } =>
        key.ownerEntityId === clip.id && key.propertyPath === propertyPath && typeof key.value === "number",
    )
    .sort((left, right) => (left.frame < right.frame ? -1 : left.frame > right.frame ? 1 : 0));
  const frame = BigInt(snapshot.preview.masterFrame);
  let value = typeof base === "number" ? base : 100;
  if (keys.length > 0) {
    const left = [...keys].reverse().find((key) => key.frame <= frame) ?? keys[0];
    const right = keys.find((key) => key.frame >= frame) ?? keys.at(-1);
    if (left !== undefined && right !== undefined) {
      if (left.id === right.id || right.frame === left.frame || left.interpolation === "hold")
        value = left.value;
      else {
        const raw = Number(frame - left.frame) / Number(right.frame - left.frame);
        const t = left.interpolation === "linear" ? raw : raw * raw * (3 - 2 * raw);
        value = left.value + (right.value - left.value) * t;
      }
    }
  }
  return Math.max(0, Math.min(1, value / 100));
};

const InspectorSection = ({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) => (
  <section className="inspector-section">
    <h3>{title}</h3>
    {children}
  </section>
);

const Property = ({ label, value }: { readonly label: string; readonly value: string }) => (
  <div className="property">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const ContextInspector = ({
  monitorActions,
  snapshot,
}: {
  readonly snapshot: StudioSnapshot;
  readonly monitorActions: WorkspaceMonitorActions;
}) => {
  const [client] = useState(
    () =>
      new StudioApiClient({
        sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
        baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
      }),
  );
  const [context, setContext] = useState<SelectionContextManifest | null>(null);
  const [annotations, setAnnotations] = useState<readonly AnnotationDocument[]>([]);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<AnnotationDocument["category"]>("note");
  const [privacyOnly, setPrivacyOnly] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState("Revision-bound");
  const [scopeKind, setScopeKind] = useState<ChangeScopeKind>("current-frame");
  const [customStart, setCustomStart] = useState(snapshot.preview.masterFrame);
  const [customEnd, setCustomEnd] = useState((BigInt(snapshot.preview.masterFrame) + 1n).toString(10));
  const captureClips = snapshot.timeline.selection.selectedIds.flatMap((id) => {
    const clip = snapshot.timeline.clips[id];
    return clip === undefined ? [] : [clip];
  });
  const hasSelectedClip = captureClips.length > 0;
  const selectedClipsAreShared = hasSelectedClip && captureClips.every((clip) => clip.engine === "shared");
  const hasMarkedRange = snapshot.timeline.inOutRange !== null;

  const refresh = async (): Promise<void> => {
    if (client.sessionToken === null) return;
    try {
      const [latest, annotationList] = await Promise.all([
        client.request<SelectionContextManifest>("/api/v1/editor/context", { method: "GET" }),
        client.request<readonly AnnotationDocument[]>("/api/v1/annotations", { method: "GET" }),
      ]);
      setContext(latest);
      setAnnotations(annotationList);
      setBridgeStatus(latest.preview.synchronized ? "Fresh · synchronized" : "Refresh required");
    } catch {
      setBridgeStatus("Local context unavailable");
    }
  };

  useEffect(() => {
    void refresh();
  }, [snapshot.project?.revisionId, snapshot.preview.masterFrame, snapshot.selection.clipIds.join("|")]);

  const createAnnotation = async (): Promise<void> => {
    if (draft.trim().length === 0 || client.sessionToken === null) return;
    const entityIds = context?.selectedIds.length
      ? context.selectedIds
      : [snapshot.project?.projectId ?? "project-local"];
    await client.request<AnnotationDocument>("/api/v1/annotations", {
      method: "POST",
      body: JSON.stringify({
        entityIds,
        frame: snapshot.preview.masterFrame,
        captureId: null,
        body: draft,
        category,
        privacyBehavior: category === "privacy" ? "redact-preview-and-export" : "none",
        author: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
      }),
    });
    setDraft("");
    await refresh();
  };

  const visibleAnnotations = privacyOnly
    ? annotations.filter((annotation) => annotation.category === "privacy")
    : annotations;
  const baseManifest = context ?? {
    projectId: snapshot.project?.projectId ?? null,
    revisionId: snapshot.project?.revisionId ?? null,
    masterFrame: snapshot.preview.masterFrame,
    timecode: snapshot.preview.timecode,
    selectedIds: snapshot.selection.clipIds,
    preview: { mode: snapshot.preview.mode, stateVersion: snapshot.preview.stateVersion },
  };
  const scope = changeScopeManifest(snapshot, scopeKind, customStart, customEnd);
  const manifest = { ...baseManifest, changeScope: scope };

  return (
    <PanelContent title="Codex context">
      <div className="bridge-status-row">
        <Badge tone={bridgeStatus.startsWith("Fresh") ? "ready" : "attention"}>{bridgeStatus}</Badge>
        <small>{context?.contextId ?? "Waiting for latest-context.json"}</small>
      </div>
      <div className="split-actions">
        <Button
          variant="primary"
          onClick={() => void navigator.clipboard.writeText(JSON.stringify(manifest, null, 2))}
        >
          Copy exact context
        </Button>
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>
      <InspectorSection title="Change scope">
        <label className="scope-control">
          <span>Apply requested change to</span>
          <select
            value={scopeKind}
            onChange={(event) => {
              setScopeKind(event.currentTarget.value as ChangeScopeKind);
            }}
          >
            <option value="current-frame">Current frame</option>
            <option value="selected-clips">Selected clip(s)</option>
            <option value="marked-range">Marked I/O range</option>
            <option value="custom-range">Custom range</option>
            <option value="entire-sequence">Entire sequence</option>
          </select>
        </label>
        {scopeKind !== "custom-range" ? null : (
          <div className="scope-range-inputs">
            <TextField
              label="Start frame"
              value={customStart}
              onChange={(event) => {
                setCustomStart(event.currentTarget.value);
              }}
            />
            <TextField
              label="End frame (exclusive)"
              value={customEnd}
              onChange={(event) => {
                setCustomEnd(event.currentTarget.value);
              }}
            />
          </div>
        )}
        <p className={scope.valid ? "scope-summary" : "scope-summary scope-summary--invalid"}>
          {scope.summary}
        </p>
      </InspectorSection>
      <InspectorSection title="Selection manifest">
        <details className="manifest-disclosure">
          <summary>Show raw context JSON</summary>
          <pre className="manifest">{JSON.stringify(manifest, null, 2)}</pre>
        </details>
      </InspectorSection>
      <InspectorSection title="Capture jobs">
        <div className="capture-action-grid">
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable}
            title={
              monitorActions.authoritativeCaptureAvailable
                ? "Render and preserve the current immutable timeline frame."
                : "Requires the authenticated authoritative timeline compositor."
            }
            onClick={() => {
              monitorActions.capture("exact-fidelity", false);
            }}
          >
            Fidelity frame
          </Button>
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable || !hasSelectedClip}
            title={
              !monitorActions.authoritativeCaptureAvailable
                ? "Requires the authenticated authoritative timeline compositor."
                : hasSelectedClip
                  ? "Render only the selected visual clip through the final compositor."
                  : "Select a timeline clip first."
            }
            onClick={() => {
              monitorActions.capture("isolated-clip", false);
            }}
          >
            Isolate
          </Button>
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable || !selectedClipsAreShared}
            title={
              !monitorActions.authoritativeCaptureAvailable
                ? "Requires the authenticated authoritative timeline compositor."
                : selectedClipsAreShared
                  ? "Render the selected shared clip with shared properties reset to source defaults."
                  : "Select at least one shared timeline clip first."
            }
            onClick={() => {
              monitorActions.capture("before-effects", false);
            }}
          >
            Before effects
          </Button>
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable}
            title="Render an exact transparent-background PNG through the final compositor."
            onClick={() => {
              monitorActions.capture("alpha", false);
            }}
          >
            Alpha
          </Button>
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable}
            title="Capture the active Inspect comparison as revision-bound review evidence."
            onClick={() => {
              monitorActions.capture("comparison", false);
            }}
          >
            A/B
          </Button>
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable || !hasMarkedRange}
            title={hasMarkedRange ? "Render every marked review-range frame." : "Mark In and Out first."}
            onClick={() => {
              monitorActions.capture("range", false);
            }}
          >
            Review range
          </Button>
          <Button
            disabled={!monitorActions.authoritativeCaptureAvailable || !hasMarkedRange}
            title={
              hasMarkedRange
                ? "Build six exact final-compositor samples from the marked range."
                : "Mark In and Out first."
            }
            onClick={() => {
              monitorActions.capture("contact-sheet", false);
            }}
          >
            Contact sheet
          </Button>
        </div>
        <CheckRow
          label="Fidelity provenance"
          detail={
            monitorActions.authoritativeCaptureAvailable
              ? "final timeline compositor · immutable output receipt"
              : "unavailable · authenticated compositor required"
          }
        />
        <CheckRow label="Interactive provenance" detail="preview-compositor · no parity claim" />
      </InspectorSection>
      <InspectorSection title="Annotations">
        <CheckRow label="Coordinate space" detail="source-normalized · revision-bound" />
        <div className="annotation-compose">
          <TextField
            label="Review note"
            placeholder="Describe the exact visual change"
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
          />
          <label>
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.currentTarget.value as AnnotationDocument["category"]);
              }}
            >
              <option value="note">Note</option>
              <option value="issue">Issue</option>
              <option value="privacy">Privacy blur</option>
              <option value="approval">Approval</option>
              <option value="guide">Guide</option>
            </select>
          </label>
          <Button variant="primary" onClick={() => void createAnnotation()}>
            <ChaiIcon name="annotation" size={16} /> Add at frame
          </Button>
        </div>
        <label className="annotation-filter">
          <input
            type="checkbox"
            checked={privacyOnly}
            onChange={(event) => {
              setPrivacyOnly(event.currentTarget.checked);
            }}
          />
          Privacy only
        </label>
        {visibleAnnotations.length === 0 ? (
          <div className="info-note">No annotations in this revision.</div>
        ) : (
          visibleAnnotations.map((annotation, index) => (
            <div className="annotation-card" key={annotation.id}>
              <span className="annotation-number">{String(index + 1)}</span>
              <div>
                <strong>{annotation.category}</strong>
                <p>{annotation.body}</p>
                <small>
                  {annotation.frameRange === null
                    ? "All frames"
                    : `${annotation.frameRange.startFrame}–${annotation.frameRange.endFrameExclusive}`}{" "}
                  · {annotation.geometry.kind}
                </small>
              </div>
              <button
                type="button"
                aria-label={`Toggle ${annotation.id}`}
                onClick={() => {
                  void client
                    .request(`/api/v1/annotations/${annotation.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ visible: !annotation.visible }),
                    })
                    .then(refresh);
                }}
              >
                <ChaiIcon name="visibility" size={14} style={{ opacity: annotation.visible ? 1 : 0.4 }} />
              </button>
            </div>
          ))
        )}
      </InspectorSection>
      <div className="info-note">
        Codex reads this local, revision-bound bridge. No second chat or remote push exists.
      </div>
    </PanelContent>
  );
};

type ChangeScopeKind =
  "current-frame" | "selected-clips" | "marked-range" | "custom-range" | "entire-sequence";

const changeScopeManifest = (
  snapshot: StudioSnapshot,
  scopeKind: ChangeScopeKind,
  customStart: string,
  customEnd: string,
) => {
  const clips = snapshot.timeline.selection.selectedIds.flatMap((id) => {
    const clip = snapshot.timeline.clips[id];
    return clip === undefined ? [] : [clip];
  });
  let start: bigint | null = null;
  let end: bigint | null = null;
  let error: string | null = null;
  try {
    if (scopeKind === "current-frame") {
      start = BigInt(snapshot.preview.masterFrame);
      end = start + 1n;
    } else if (scopeKind === "selected-clips") {
      const firstClip = clips[0];
      if (firstClip === undefined) error = "Select at least one timeline clip.";
      else {
        start = clips.reduce(
          (value, clip) => (clip.range.start < value ? clip.range.start : value),
          firstClip.range.start,
        );
        end = clips.reduce(
          (value, clip) => (clip.range.end > value ? clip.range.end : value),
          firstClip.range.end,
        );
      }
    } else if (scopeKind === "marked-range") {
      const range =
        snapshot.timeline.inOutRange ??
        (snapshot.preview.inOutRange === null
          ? null
          : createFrameRange(
              masterFrame(BigInt(snapshot.preview.inOutRange.startFrame)),
              masterFrame(BigInt(snapshot.preview.inOutRange.endFrameExclusive)),
            ));
      if (range === null) error = "Mark an In and Out range before choosing this scope.";
      else {
        start = range.start;
        end = range.end;
      }
    } else if (scopeKind === "custom-range") {
      start = BigInt(customStart);
      end = BigInt(customEnd);
    } else {
      start = 0n;
      end = BigInt(snapshot.preview.durationFrames);
    }
  } catch {
    error = "Enter whole-number frame values.";
  }
  const duration = start === null || end === null ? null : end - start;
  if (error === null && (start === null || end === null || start < 0n || end <= start)) {
    error = "The scope end must be after its non-negative start frame.";
  }
  if (error === null && end !== null && end > BigInt(snapshot.preview.durationFrames)) {
    error = "The requested scope extends beyond the sequence duration.";
  }
  const timecode = (value: bigint): string =>
    formatTimecode(masterFrame(value), snapshot.timeline.fps, true).text;
  const valid = error === null && start !== null && end !== null && duration !== null;
  const validStart = valid ? start : null;
  const validEnd = valid ? end : null;
  const validDuration = valid ? duration : null;
  return {
    scopeKind,
    valid,
    selectedEntityIds: clips.map((clip) => clip.id),
    startFrame: validStart?.toString(10) ?? null,
    endFrameExclusive: validEnd?.toString(10) ?? null,
    startTimecode: validStart === null ? null : timecode(validStart),
    endTimecodeExclusive: validEnd === null ? null : timecode(validEnd),
    durationFrames: validDuration?.toString(10) ?? null,
    durationTimecode: validDuration === null ? null : timecode(validDuration),
    clipRanges: clips.map((clip) => ({
      clipId: clip.id,
      assetId: clip.assetId,
      startFrame: clip.range.start.toString(10),
      endFrameExclusive: clip.range.end.toString(10),
      sourceStartFrame: clip.sourceRange.start.toString(10),
      sourceEndFrameExclusive: clip.sourceRange.end.toString(10),
    })),
    summary:
      validStart !== null && validEnd !== null && validDuration !== null
        ? `Change ${scopeKind.replaceAll("-", " ")} from ${timecode(validStart)} to ${timecode(validEnd)} — ${validDuration.toString(10)} frames.`
        : (error ?? "Choose an explicit change scope."),
  };
};

const MediaInspector = ({
  onCommand,
  onRelinkAsset,
  snapshot,
}: {
  readonly onCommand: (command: TimelineEditCommand) => void;
  readonly onRelinkAsset: (assetId: string, sourcePath: string) => Promise<boolean>;
  readonly snapshot: StudioSnapshot;
}) => {
  const assets = sequenceAssets(snapshot);
  const explicitlySelectedAssetId = snapshot.selection.assetIds[0];
  const asset =
    assets.find((candidate) => candidate.assetId === explicitlySelectedAssetId) ??
    assets.find((candidate) => candidate.selected) ??
    assets[0];
  const client = useMemo(
    () =>
      new StudioApiClient({
        sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
        baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
      }),
    [],
  );
  const [relinkPath, setRelinkPath] = useState("");
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [proxyJob, setProxyJob] = useState<StudioJobView | null>(null);
  useEffect(() => {
    setRelinkPath(asset?.path ?? "");
    setProxyJob(null);
  }, [asset?.assetId, asset?.path]);
  useEffect(() => {
    if (proxyJob === null || (proxyJob.status !== "queued" && proxyJob.status !== "running")) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void client
        .studioJob(proxyJob.id, controller.signal)
        .then(setProxyJob)
        .catch(() => undefined);
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, proxyJob]);
  if (asset === undefined)
    return (
      <PanelContent title="Asset metadata">
        <p className="info-note">No asset selected.</p>
      </PanelContent>
    );
  const clips = Object.values(snapshot.timeline.clips).filter((clip) => clip.assetId === asset.assetId);
  const placement = mediaPlacementPlan(snapshot, asset);
  return (
    <PanelContent title="Asset metadata">
      <div className="inspector-identity">
        <div>
          <strong>{asset.label}</strong>
          <small>{asset.assetId}</small>
        </div>
        <Badge tone={asset.used ? "ready" : "neutral"}>
          {asset.used ? "Used in sequence" : "Project asset"}
        </Badge>
      </div>
      <InspectorSection title="Media">
        <div className="property-grid">
          <Property label="Type" value={asset.type} />
          <Property label="Engine" value={asset.engine} />
          <Property label="Rights" value={asset.rights} />
          <Property label="Validation" value={asset.validationState} />
          <Property label="Occurrences" value={String(clips.length)} />
          <Property label="Duration" value={`${String(asset.durationFrames)} frames`} />
        </div>
      </InspectorSection>
      <InspectorSection title="Usage">
        {clips.length === 0 ? (
          <p className="info-note">Registered in the project but not placed on this timeline.</p>
        ) : (
          clips.map((clip) => (
            <CheckRow
              label={clip.name}
              detail={`${snapshot.timeline.tracks[clip.trackId]?.name ?? "Track"} · Frames ${String(clip.range.start)}–${String(clip.range.end)}`}
              key={clip.id}
            />
          ))
        )}
      </InspectorSection>
      <InspectorSection title="Source management">
        <label className="media-source-path">
          <span>Project-relative or approved source path</span>
          <input
            value={relinkPath}
            disabled={relinkBusy || client.sessionToken === null}
            onChange={(event) => {
              setRelinkPath(event.currentTarget.value);
            }}
          />
        </label>
        <div className="media-source-actions">
          <Button
            variant="ghost"
            disabled={
              relinkBusy ||
              client.sessionToken === null ||
              relinkPath.trim().length === 0 ||
              relinkPath.trim() === asset.path
            }
            title={
              client.sessionToken === null
                ? "Relinking requires an authenticated local Studio session."
                : relinkPath.trim() === asset.path
                  ? "Enter a different existing source path inside the project or an approved external root."
                  : "Verify the file, content hash, and path policy before committing the relink."
            }
            onClick={() => {
              setRelinkBusy(true);
              void onRelinkAsset(asset.assetId, relinkPath).finally(() => {
                setRelinkBusy(false);
              });
            }}
          >
            <ChaiIcon name={relinkBusy ? "status-working" : "relink"} size={16} />
            {relinkBusy ? "Relinking…" : "Relink source"}
          </Button>
          <Button
            variant="ghost"
            disabled={
              client.sessionToken === null ||
              asset.kind !== "video" ||
              asset.validationState !== "valid" ||
              proxyJob?.status === "queued" ||
              proxyJob?.status === "running"
            }
            title={
              client.sessionToken === null
                ? "Proxy generation requires an authenticated local Studio session."
                : asset.kind !== "video" || asset.validationState !== "valid"
                  ? "A validated video source is required for proxy generation."
                  : "Generate a content-addressed 720p constant-frame-rate editing proxy."
            }
            onClick={() => {
              setProxyJob(null);
              void client
                .assetDefaultProxy(asset.assetId)
                .then(setProxyJob)
                .catch((error: unknown) => {
                  setProxyJob({
                    id: "job-proxy-failed",
                    kind: "asset.proxy",
                    status: "failed",
                    progress: 0,
                    stage: "Request failed",
                    error: error instanceof Error ? error.message : "Proxy request failed.",
                  });
                });
            }}
          >
            <ChaiIcon
              name={
                proxyJob?.status === "queued" || proxyJob?.status === "running"
                  ? "status-working"
                  : "generate-proxy"
              }
              size={16}
            />
            {proxyJob?.status === "queued" || proxyJob?.status === "running"
              ? "Generating proxy…"
              : "Generate proxy"}
          </Button>
        </div>
        {proxyJob === null ? (
          <p className="info-note">No proxy job has been started for this selected asset.</p>
        ) : (
          <div className="media-proxy-progress" role="status">
            <progress
              aria-label="Proxy generation progress"
              max={1}
              value={Math.max(0, Math.min(1, proxyJob.progress))}
            />
            <span>
              {proxyJob.status} · {proxyJob.stage} · {String(Math.round(proxyJob.progress * 100))}%
            </span>
            {proxyJob.error === null ? null : <strong>{proxyJob.error}</strong>}
          </div>
        )}
        <p className="info-note">
          Relink is revision-backed. Proxies are regenerable cache artifacts and never replace the original.
        </p>
      </InspectorSection>
      <InspectorSection title="Selection behavior">
        <p className="info-note">
          Selecting an asset selects every occurrence on the timeline; the nearest occurrence becomes primary.
        </p>
      </InspectorSection>
      <InspectorSection title="Timeline placement">
        <Button
          variant="primary"
          disabled={!placement.allowed}
          title={placement.reason}
          onClick={() => {
            appendAssetToTimeline(snapshot, asset, placement, onCommand);
          }}
        >
          <ChaiIcon name="add-track" size={16} /> Append to timeline
        </Button>
        <p className="info-note">
          Placement is revision-backed. Compositions still require trust review and an engine compositor.
        </p>
      </InspectorSection>
    </PanelContent>
  );
};

const MediaCenter = ({
  browserSelection,
  selectBrowser,
  selectAsset,
  snapshot,
  timeline,
}: {
  readonly browserSelection: string;
  readonly selectBrowser: (selection: string) => void;
  readonly selectAsset: (assetId: string) => void;
  readonly snapshot: StudioSnapshot;
  readonly timeline: (command: TimelineEditCommand) => void;
}) => {
  const [query, setQuery] = useState("");
  const assets = sequenceAssets(snapshot);
  const browserAssets = filterMediaAssetsByBrowserSelection(assets, browserSelection);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleAssets = browserAssets.filter((asset) =>
    `${asset.label} ${asset.meta} ${asset.type} ${asset.engine}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const hiddenSelectedAsset = assets.find(
    (asset) => asset.selected && !visibleAssets.some((visible) => visible.assetId === asset.assetId),
  );
  return (
    <div className="media-center">
      <div className="media-toolbar">
        <div>
          <strong>{browserSelection}</strong>
          <span>
            {normalizedQuery.length === 0
              ? `${String(browserAssets.length)} ${browserAssets.length === 1 ? "asset" : "assets"}`
              : `${String(visibleAssets.length)} of ${String(browserAssets.length)} assets`}
          </span>
        </div>
        <TextField
          label="Search footage"
          placeholder="Name, metadata, transcript"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
      </div>
      <div className="asset-grid">
        {hiddenSelectedAsset === undefined ? null : (
          <div className="asset-selection-context" role="status">
            <span>
              Selected asset <strong>{hiddenSelectedAsset.label}</strong> is outside the current filter or
              search.
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                selectBrowser("Project root");
              }}
            >
              Show selected asset
            </Button>
          </div>
        )}
        {visibleAssets.map((asset, index) => (
          <button
            className={asset.selected ? "media-card media-card--active" : "media-card"}
            type="button"
            draggable
            aria-pressed={asset.selected}
            title="Select this asset or drag it onto a timeline track in Edit."
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData("application/x-chai-studio-asset-id", asset.assetId);
              event.dataTransfer.setData("text/plain", asset.assetId);
            }}
            onClick={() => {
              selectAsset(asset.assetId);
              selectAssetInTimeline(snapshot, asset.assetId, timeline);
            }}
            key={asset.assetId}
          >
            <span className={`media-card__art art-${String((index % 4) + 1)}`}>
              <i />
            </span>
            <strong>{asset.label}</strong>
            <small>{asset.meta}</small>
          </button>
        ))}
        {visibleAssets.length === 0 ? (
          <div className="honest-unavailable-state asset-grid__empty" role="status">
            <strong>
              {normalizedQuery.length === 0
                ? `No assets in ${browserSelection}.`
                : `No assets match “${query}” in ${browserSelection}.`}
            </strong>
            {normalizedQuery.length > 0 ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery("");
                }}
              >
                Clear search
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

interface SequenceAssetView {
  readonly assetId: string;
  readonly label: string;
  readonly meta: string;
  readonly type: string;
  readonly engine: "shared" | "remotion" | "hyperframes" | "composition";
  readonly durationFrames: bigint;
  readonly selected: boolean;
  readonly contentHash: string | null;
  readonly rights: AssetRecord["rights"];
  readonly validationState: AssetRecord["validationState"];
  readonly used: boolean;
  readonly kind: AssetRecord["kind"];
  readonly path: string;
}

const filterMediaAssetsByBrowserSelection = (
  assets: readonly SequenceAssetView[],
  selection: string,
): readonly SequenceAssetView[] => {
  const includesLabel = (asset: SequenceAssetView, fragment: string): boolean =>
    asset.label.toLocaleLowerCase().includes(fragment);
  switch (selection) {
    case "Project root":
      return assets;
    case "Footage":
      return assets.filter((asset) => asset.type === "Video" || asset.type === "Image");
    case "Interviews":
      return assets.filter((asset) => includesLabel(asset, "interview"));
    case "Product":
      return assets.filter((asset) => includesLabel(asset, "product"));
    case "Audio":
      return assets.filter((asset) => asset.type === "Audio");
    case "Graphics":
      return assets.filter(
        (asset) =>
          asset.type === "R" ||
          asset.type === "H" ||
          asset.type === "Image" ||
          asset.type === "Caption" ||
          asset.type === "Composition",
      );
    case "Compositions":
      return assets.filter(
        (asset) => asset.type === "R" || asset.type === "H" || asset.type === "Composition",
      );
    case "Missing / offline":
      return assets.filter((asset) => ["missing", "corrupt", "unsupported"].includes(asset.validationState));
    case "Validation pending":
      return assets.filter((asset) => asset.validationState === "pending");
    case "Approved":
      return assets.filter((asset) => asset.rights !== "unknown" && asset.validationState === "valid");
    case "Duplicate hash": {
      const counts = new Map<string, number>();
      for (const asset of assets) {
        if (asset.contentHash !== null)
          counts.set(asset.contentHash, (counts.get(asset.contentHash) ?? 0) + 1);
      }
      return assets.filter((asset) => asset.contentHash !== null && (counts.get(asset.contentHash) ?? 0) > 1);
    }
    default:
      return assets;
  }
};

const sequenceAssets = (snapshot: StudioSnapshot): readonly SequenceAssetView[] => {
  const primary =
    snapshot.timeline.selection.primaryId === null
      ? null
      : (snapshot.timeline.clips[snapshot.timeline.selection.primaryId] ?? null);
  const selectedAssetIds = new Set<string>(
    snapshot.timeline.selection.selectedIds.flatMap((id) => {
      const assetId = snapshot.timeline.clips[id]?.assetId;
      return assetId === null || assetId === undefined ? [] : [assetId];
    }),
  );
  for (const assetId of snapshot.selection.assetIds) selectedAssetIds.add(assetId);
  const groups = new Map<string, SequenceAssetView>();
  for (const asset of snapshot.assets) {
    const storedName = asset.path.split("/").at(-1) ?? asset.id;
    const uploadPrefix = `${asset.id}-`;
    const label = storedName.startsWith(uploadPrefix) ? storedName.slice(uploadPrefix.length) : storedName;
    groups.set(asset.id, {
      assetId: asset.id,
      label,
      meta: `${asset.kind} · ${asset.validationState}${asset.durationFrames === null ? "" : ` · ${asset.durationFrames}f`}`,
      type: assetTypeLabel(asset.kind),
      engine: asset.kind === "composition" ? "composition" : "shared",
      durationFrames: BigInt(asset.durationFrames ?? "0"),
      selected: selectedAssetIds.has(asset.id),
      contentHash: asset.contentHash,
      rights: asset.rights,
      validationState: asset.validationState,
      used: false,
      kind: asset.kind,
      path: asset.path,
    });
  }
  for (const clip of Object.values(snapshot.timeline.clips)) {
    if (clip.assetId === null) continue;
    const track = snapshot.timeline.tracks[clip.trackId];
    const label = assetLabel(clip.name);
    const registered = groups.get(clip.assetId);
    const type =
      registered !== undefined
        ? assetTypeLabel(registered.kind)
        : clip.engine === "remotion"
          ? "R"
          : clip.engine === "hyperframes"
            ? "H"
            : track?.kind === "audio"
              ? "Audio"
              : track?.kind === "caption"
                ? "Caption"
                : "Video";
    const placeholder =
      registered?.validationState === "unsupported" &&
      snapshot.assets.find((asset) => asset.id === clip.assetId)?.path.startsWith("assets/starter/") === true;
    groups.set(clip.assetId, {
      assetId: clip.assetId,
      label: placeholder ? label : (registered?.label ?? label),
      meta: `${registered?.kind ?? (clip.engine === "shared" ? (track?.kind ?? "media") : `${clip.engine} composition`)} · ${String(clip.range.end - clip.range.start)}f${registered === undefined ? "" : ` · ${registered.validationState}`}`,
      type,
      engine: clip.engine,
      durationFrames:
        registered === undefined || registered.durationFrames === 0n
          ? clip.range.end - clip.range.start
          : registered.durationFrames,
      selected: selectedAssetIds.has(clip.assetId) || primary?.assetId === clip.assetId,
      contentHash: registered?.contentHash ?? null,
      rights: registered?.rights ?? "unknown",
      validationState: registered?.validationState ?? "pending",
      used: true,
      kind: registered?.kind ?? assetKindFromTrack(track?.kind, clip.engine),
      path: registered?.path ?? "",
    });
  }
  return [...groups.values()];
};

const assetKindFromTrack = (
  trackKind: "video" | "audio" | "caption" | "data" | undefined,
  engine: "shared" | "remotion" | "hyperframes",
): AssetRecord["kind"] => {
  if (engine !== "shared") return "composition";
  if (trackKind === "audio") return "audio";
  if (trackKind === "caption") return "caption";
  if (trackKind === "data") return "data";
  return "video";
};

const appendAssetToTimeline = (
  snapshot: StudioSnapshot,
  asset: SequenceAssetView,
  placement: MediaPlacementPlan,
  onCommand: (command: TimelineEditCommand) => void,
): void => {
  const track = placement.track;
  const engine = placement.engine;
  if (!placement.allowed || track === null || engine === null) {
    throw new Error(placement.reason);
  }
  const start = Object.values(snapshot.timeline.clips).reduce((end, clip) => {
    return clip.range.end > end ? clip.range.end : end;
  }, masterFrame(0n));
  insertAssetClip(snapshot, asset, track, engine, start, onCommand);
};

const placeAssetAtTimelineFrame = (
  snapshot: StudioSnapshot,
  assetId: string,
  trackId: string,
  frame: string,
  onCommand: (command: TimelineEditCommand) => void,
): string => {
  const asset = sequenceAssets(snapshot).find((candidate) => candidate.assetId === assetId);
  if (asset === undefined) return "The dragged asset is no longer available in this project.";
  const placement = mediaPlacementPlan(snapshot, asset, trackId);
  if (!placement.allowed || placement.track === null || placement.engine === null) return placement.reason;
  const start = masterFrame(BigInt(frame));
  insertAssetClip(snapshot, asset, placement.track, placement.engine, start, onCommand);
  return `Placed ${asset.label} on ${placement.track.name} at frame ${frame}.`;
};

const insertAssetClip = (
  snapshot: StudioSnapshot,
  asset: SequenceAssetView,
  track: TrackSnapshot,
  engine: "shared" | "remotion" | "hyperframes",
  start: ReturnType<typeof masterFrame>,
  onCommand: (command: TimelineEditCommand) => void,
): void => {
  const timelineDuration =
    asset.kind === "image" ? (asset.durationFrames > 0n ? asset.durationFrames : 150n) : asset.durationFrames;
  const duration = timelineDuration > 0n ? timelineDuration : 1n;
  const sourceDuration = asset.kind === "image" ? 1n : duration;
  const clipId = stableEntityId(`clip-import-${globalThis.crypto.randomUUID()}`);
  const assetId = stableEntityId(asset.assetId);
  onCommand({
    kind: "clip.insert",
    clip: {
      id: clipId,
      trackId: track.id,
      assetId,
      nestedSequenceId: null,
      engine,
      name: asset.label,
      range: createFrameRange(start, masterFrame(BigInt(start) + duration)),
      sourceRange: createFrameRange(masterFrame(0n), masterFrame(sourceDuration)),
      sourceRate: snapshot.timeline.fps,
      speed: normalizeRational(1n, 1n),
      availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(sourceDuration)),
      linkGroupId: null,
      selectionGroupId: null,
      transitionInId: null,
      transitionOutId: null,
      keyframeIds: [],
      metadata: {
        source: "project-asset",
        validationState: asset.validationState,
        assetKind: asset.kind,
      },
      properties: createDefaultTimelineClipProperties({
        engine,
        kind: asset.kind === "audio" ? "audio" : "visual",
        hasAudio: asset.kind === "audio" || asset.kind === "video",
      }),
    },
  });
};

interface MediaPlacementPlan {
  readonly allowed: boolean;
  readonly track: TrackSnapshot | null;
  readonly engine: "shared" | "remotion" | "hyperframes" | null;
  readonly reason: string;
}

const mediaPlacementPlan = (
  snapshot: StudioSnapshot,
  asset: SequenceAssetView,
  requestedTrackId?: string,
): MediaPlacementPlan => {
  if (asset.validationState !== "valid") {
    return {
      allowed: false,
      track: null,
      engine: null,
      reason: "Validate this source before timeline placement.",
    };
  }
  if (asset.kind === "data" || asset.kind === "caption") {
    return {
      allowed: false,
      track: null,
      engine: null,
      reason: `${asset.kind === "caption" ? "Caption" : "Data"} assets require their dedicated authoring workflow.`,
    };
  }
  if (asset.kind === "composition" && asset.engine === "composition") {
    return {
      allowed: false,
      track: null,
      engine: null,
      reason: "Choose a validated Remotion or HyperFrames composition adapter before placement.",
    };
  }
  const trackKind = asset.kind === "audio" ? "audio" : "video";
  const requestedTrack =
    requestedTrackId === undefined ? undefined : snapshot.timeline.tracks[stableEntityId(requestedTrackId)];
  if (requestedTrackId !== undefined && requestedTrack === undefined) {
    return { allowed: false, track: null, engine: null, reason: "That timeline track no longer exists." };
  }
  if (requestedTrack?.locked === true) {
    return {
      allowed: false,
      track: null,
      engine: null,
      reason: `Unlock ${requestedTrack.name} before placing media on it.`,
    };
  }
  if (requestedTrack !== undefined && requestedTrack.kind !== trackKind) {
    return {
      allowed: false,
      track: null,
      engine: null,
      reason: `${asset.label} requires an unlocked ${trackKind} track.`,
    };
  }
  const track =
    requestedTrack ??
    Object.values(snapshot.timeline.tracks)
      .filter((candidate) => candidate.kind === trackKind && !candidate.locked)
      .sort((left, right) => left.order - right.order)[0] ??
    null;
  if (track === null) {
    return {
      allowed: false,
      track: null,
      engine: null,
      reason: `No compatible unlocked ${trackKind} track is available.`,
    };
  }
  const engine = asset.engine === "remotion" || asset.engine === "hyperframes" ? asset.engine : "shared";
  return {
    allowed: true,
    track,
    engine,
    reason: `Append to ${track.name} as a ${engine} clip with revision-backed placement.`,
  };
};

const assetTypeLabel = (kind: AssetRecord["kind"]): string => {
  switch (kind) {
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "image":
      return "Image";
    case "caption":
      return "Caption";
    case "composition":
      return "Composition";
    case "data":
      return "Data";
  }
};

const assetLabel = (clipName: string): string => {
  const known: Readonly<Record<string, string>> = {
    "Interview A": "interview_nav.mov",
    "Product macro": "product_macro_02.mov",
    "Data sequence": "data_sequence.html",
    FutureTitle_v04: "FutureTitle_v04",
    "Particle bridge": "ParticleBridge",
    "score_master.wav": "score_master.wav",
  };
  return known[clipName] ?? clipName;
};

const selectAssetInTimeline = (
  snapshot: StudioSnapshot,
  assetId: string,
  timeline: (command: TimelineEditCommand) => void,
): void => {
  const current = BigInt(snapshot.preview.masterFrame);
  const clips = Object.values(snapshot.timeline.clips)
    .filter((clip) => clip.assetId === assetId)
    .sort((left, right) => {
      const leftDistance = distanceToRange(current, left.range.start, left.range.end);
      const rightDistance = distanceToRange(current, right.range.start, right.range.end);
      return leftDistance < rightDistance ? -1 : leftDistance > rightDistance ? 1 : 0;
    });
  const primary = clips[0];
  if (primary === undefined) {
    timeline({ kind: "selection.set", entityIds: [], mode: "replace", primaryId: null });
    return;
  }
  timeline({
    kind: "selection.set",
    entityIds: clips.map((clip) => clip.id),
    mode: "replace",
    primaryId: primary.id,
  });
};

const distanceToRange = (frame: bigint, start: bigint, end: bigint): bigint =>
  frame < start ? start - frame : frame >= end ? frame - end + 1n : 0n;

const SourceAndTranscript = ({
  capture,
  snapshot,
  sourceReview,
  seek,
  timeline,
  language,
}: {
  readonly snapshot: StudioSnapshot;
  readonly capture: (
    mode: MonitorCaptureMode,
    includeOverlays: boolean,
    source?: SourceInspectionState,
  ) => void;
  readonly sourceReview: (
    action: "compare-to-timeline" | "add-to-context",
    source: SourceInspectionState,
  ) => void;
  readonly seek: (command: ProgramMonitorCommand) => void;
  readonly timeline: (command: TimelineEditCommand) => void;
  readonly language: (command: LanguageCommand) => void;
}) => (
  <div className="source-transcript">
    <SourceInspectionMonitor
      assets={snapshot.assets}
      selectedAssetId={
        snapshot.selection.assetIds[0] ??
        (snapshot.timeline.selection.primaryId === null
          ? null
          : (snapshot.timeline.clips[snapshot.timeline.selection.primaryId]?.assetId ?? null))
      }
      timeline={snapshot.timeline}
      timelineFrame={snapshot.preview.masterFrame}
      onTimelineCommand={timeline}
      onCapture={capture}
      onCompareToTimeline={(source) => {
        sourceReview("compare-to-timeline", source);
      }}
      onAddToContext={(source) => {
        sourceReview("add-to-context", source);
      }}
    />
    <TranscriptCaptionPanel
      currentFrame={snapshot.preview.masterFrame}
      fps={snapshot.preview.timelineFps as NormalizedRational}
      transcripts={snapshot.transcripts}
      captionDocuments={snapshot.captionDocuments}
      onSeek={(frame) => {
        seek({ kind: "seek-frame", frame });
      }}
      onSelectRange={(startFrame, endFrameExclusive) => {
        timeline({
          kind: "range.set",
          range: createFrameRange(masterFrame(BigInt(startFrame)), masterFrame(BigInt(endFrameExclusive))),
        });
      }}
      onMarker={(phrase) => {
        timeline({
          kind: "marker.add",
          marker: {
            id: stableEntityId(`marker-${phrase.id}`),
            frame: masterFrame(BigInt(phrase.startFrame)),
            duration: masterFrame(BigInt(phrase.endFrameExclusive) - BigInt(phrase.startFrame)),
            label: phrase.text,
            category: "note",
            issueSeverity: null,
            annotationReferenceIds: [stableEntityId(phrase.id)],
            ripplePolicy: "anchored-content",
          },
        });
      }}
      onSplit={(frame) => {
        splitTimelineAtPhrase(snapshot, frame, timeline);
      }}
      onCommand={(command) => {
        language(command);
      }}
    />
  </div>
);

const splitTimelineAtPhrase = (
  snapshot: StudioSnapshot,
  frame: string,
  timeline: (command: TimelineEditCommand) => void,
): void => {
  const atFrame = masterFrame(BigInt(frame));
  const selectedIds = new Set(snapshot.timeline.selection.selectedIds);
  const selectedLinkGroups = new Set(
    Object.values(snapshot.timeline.clips)
      .filter((clip) => selectedIds.has(clip.id) && clip.linkGroupId !== null)
      .map((clip) => clip.linkGroupId),
  );
  const splits = Object.values(snapshot.timeline.clips)
    .filter(
      (clip) =>
        clip.range.start < atFrame &&
        atFrame < clip.range.end &&
        (selectedIds.has(clip.id) || (clip.linkGroupId !== null && selectedLinkGroups.has(clip.linkGroupId))),
    )
    .map((clip) => {
      const laneEntries = Object.values(snapshot.timeline.automation)
        .filter((lane) => lane.ownerEntityId === clip.id)
        .map((lane) => [lane.id, stableEntityId(`lane-transcript-split-${crypto.randomUUID()}`)] as const);
      return {
        clipId: clip.id,
        rightClipId: stableEntityId(`clip-transcript-split-${crypto.randomUUID()}`),
        ...(laneEntries.length === 0 ? {} : { rightAutomationLaneIds: Object.fromEntries(laneEntries) }),
      };
    });
  if (splits.length > 0) timeline({ kind: "clips.split", atFrame, splits });
};

const CheckRow = ({ detail, label }: { readonly detail: string; readonly label: string }) => (
  <div className="check-row">
    <span>
      <ChaiIcon name="status-ready" size={14} />
    </span>
    <div>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  </div>
);
