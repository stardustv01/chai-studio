import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  copyTimelineClips,
  createFrameRange,
  formatTimecode,
  masterFrame,
  stableEntityId,
  type ClipSnapshot,
  type TimelineEditCommand,
  type TimelineClipboard,
  type TimelineSnapshotV1,
  type TrackSnapshot,
} from "@chai-studio/timeline/browser";
import { Badge, Button } from "@chai-studio/ui-components";
import { ProfessionalEditBar } from "./professional-edit-bar.js";
import { ModalDialog } from "./modal-dialog.js";
import { ChaiIcon } from "./chai-icon.js";

interface TimelineEditorProps {
  readonly timeline: TimelineSnapshotV1;
  readonly currentFrame: string;
  readonly onSeekFrame: (frame: string) => void;
  readonly onCommand: (command: TimelineEditCommand) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

interface DragState {
  readonly clip: ClipSnapshot;
  readonly originX: number;
  readonly deltaFrames: bigint;
  readonly targetTrackId: ClipSnapshot["trackId"];
  readonly targetTrackIndex: number;
  readonly dropReason: string | null;
  readonly newTrackDrop: NewTrackDrop | null;
}

interface NewTrackDrop {
  readonly track: TrackSnapshot;
  readonly atIndex: number;
}

interface ContextMenuState {
  readonly clip: ClipSnapshot;
  readonly x: number;
  readonly y: number;
}

const rowHeight = 44;
const headerWidth = 198;

export const TimelineEditor = ({
  currentFrame,
  onCommand,
  onRedo,
  onSeekFrame,
  onUndo,
  redoLabel,
  timeline,
  undoLabel,
}: TimelineEditorProps) => {
  const [pixelsPerFrame, setPixelsPerFrame] = useState(0.72);
  const [snap, setSnap] = useState(true);
  const [tool, setTool] = useState<"select" | "blade">("select");
  const [search, setSearch] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragMessage, setDragMessage] = useState<string | null>(null);
  const [bladeFrame, setBladeFrame] = useState<bigint | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingClip, setRenamingClip] = useState<ClipSnapshot | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(300);
  const [clipboard, setClipboard] = useState<TimelineClipboard | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pendingSeekFrameRef = useRef<ReturnType<typeof masterFrame> | null>(null);
  const seekAnimationFrameRef = useRef<number | null>(null);
  const playheadPointerOffsetRef = useRef(0);
  const frame = masterFrame(BigInt(currentFrame));
  const width = Math.max(980, Number(timeline.duration) * pixelsPerFrame);
  const scale = width / Math.max(1, Number(timeline.duration));
  const tracks = useMemo(
    () => timeline.trackIds.map((id) => timeline.tracks[id]).filter((track) => track !== undefined),
    [timeline.trackIds, timeline.tracks],
  );
  const firstVisibleTrack = Math.max(0, Math.floor(Math.max(0, scrollTop - rowHeight) / rowHeight) - 1);
  const lastVisibleTrack = Math.min(
    tracks.length,
    firstVisibleTrack + Math.ceil(viewportHeight / rowHeight) + 3,
  );
  const visibleTracks = tracks.slice(firstVisibleTrack, lastVisibleTrack);
  const normalizedSearch = search.trim().toLocaleLowerCase("en");
  const searchHits = useMemo(
    () =>
      new Set(
        Object.values(timeline.clips)
          .filter((clip) =>
            `${clip.name} ${clip.assetId ?? ""} ${clip.engine} ${Object.values(clip.metadata).join(" ")}`
              .toLocaleLowerCase("en")
              .includes(normalizedSearch),
          )
          .map((clip) => clip.id),
      ),
    [normalizedSearch, timeline.clips],
  );
  const selected = useMemo(() => new Set(timeline.selection.selectedIds), [timeline.selection.selectedIds]);
  const primaryClip =
    timeline.selection.primaryId === null ? null : (timeline.clips[timeline.selection.primaryId] ?? null);
  const splitTargets = timeline.selection.selectedIds.flatMap((id) => {
    const clip = timeline.clips[id];
    return clip !== undefined && clip.range.start < frame && frame < clip.range.end ? [clip] : [];
  });

  const queueSeek = (targetFrame: ReturnType<typeof masterFrame>, commit: boolean): void => {
    if (commit) {
      if (seekAnimationFrameRef.current !== null) cancelAnimationFrame(seekAnimationFrameRef.current);
      seekAnimationFrameRef.current = null;
      pendingSeekFrameRef.current = null;
      onSeekFrame(targetFrame.toString(10));
      return;
    }
    pendingSeekFrameRef.current = targetFrame;
    if (seekAnimationFrameRef.current !== null) return;
    seekAnimationFrameRef.current = requestAnimationFrame(() => {
      seekAnimationFrameRef.current = null;
      const pendingFrame = pendingSeekFrameRef.current;
      pendingSeekFrameRef.current = null;
      if (pendingFrame !== null) onSeekFrame(pendingFrame.toString(10));
    });
  };

  const frameAtTimelinePointer = (clientX: number): ReturnType<typeof masterFrame> => {
    const scroll = scrollRef.current;
    if (scroll === null) return frame;
    const bounds = scroll.getBoundingClientRect();
    const timelineX = clientX - bounds.left + scroll.scrollLeft - headerWidth;
    const rawFrame = BigInt(Math.round(timelineX / scale));
    const lastFrame = timeline.duration > 0n ? timeline.duration - 1n : 0n;
    return masterFrame(rawFrame < 0n ? 0n : rawFrame > lastFrame ? lastFrame : rawFrame);
  };

  const seekAtPointer = (clientX: number, commit: boolean): void => {
    queueSeek(frameAtTimelinePointer(clientX - playheadPointerOffsetRef.current), commit);
  };

  const startSurfaceScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    playheadPointerOffsetRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    seekAtPointer(event.clientX, true);
  };

  const continueSurfaceScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekAtPointer(event.clientX, false);
  };

  const finishSurfaceScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekAtPointer(event.clientX, true);
    event.currentTarget.releasePointerCapture(event.pointerId);
    setScrubbing(false);
  };

  const cancelSurfaceScrub = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    playheadPointerOffsetRef.current = 0;
    setScrubbing(false);
  };

  const splitClipsAtFrame = (
    clips: readonly ClipSnapshot[],
    splitFrame: ReturnType<typeof masterFrame>,
  ): void => {
    if (clips.length === 0) return;
    onCommand({
      kind: "clips.split",
      atFrame: splitFrame,
      splits: clips.map((clip) => ({
        clipId: clip.id,
        rightClipId: stableEntityId(`clip-split-${crypto.randomUUID()}`),
        rightAutomationLaneIds: Object.fromEntries(
          Object.values(timeline.automation)
            .filter(
              (lane) =>
                lane.ownerEntityId === clip.id &&
                lane.keyframeIds.some(
                  (id) =>
                    timeline.keyframes[id]?.frame !== undefined && timeline.keyframes[id].frame >= splitFrame,
                ),
            )
            .map((lane) => [lane.id, stableEntityId(`lane-split-${crypto.randomUUID()}`)]),
        ),
      })),
    });
  };

  const bladeFrameAtPointer = (
    clip: ClipSnapshot,
    clientX: number,
    element: HTMLElement,
  ): ReturnType<typeof masterFrame> => {
    const pointerFrame = frameAtPointer(clip, clientX, element, scale);
    const playheadInsideClip = clip.range.start < frame && frame < clip.range.end;
    const withinPlayheadSnapDistance = Math.abs(Number(pointerFrame - frame) * scale) <= 8;
    return snap && playheadInsideClip && withinPlayheadSnapDistance ? frame : pointerFrame;
  };

  const sendSelection = (clip: ClipSnapshot, event: ReactPointerEvent): void => {
    onCommand({
      kind: "selection.set",
      entityIds: [clip.id],
      mode: event.metaKey || event.ctrlKey ? "toggle" : event.shiftKey ? "add" : "replace",
      primaryId: clip.id,
    });
  };

  const onClipPointerDown = (clip: ClipSnapshot, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (tool === "blade") {
      const splitFrame = bladeFrameAtPointer(clip, event.clientX, event.currentTarget);
      if (splitFrame <= clip.range.start || splitFrame >= clip.range.end) {
        setDragMessage("Choose a frame inside the clip; clip boundaries cannot be split.");
        return;
      }
      splitClipsAtFrame([clip], splitFrame);
      setDragMessage(`Cut ${clip.name} at exact frame ${String(splitFrame)}.`);
      return;
    }
    sendSelection(clip, event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const sourceIndex = tracks.findIndex((track) => track.id === clip.trackId);
    setDrag({
      clip,
      originX: event.clientX,
      deltaFrames: 0n,
      targetTrackId: clip.trackId,
      targetTrackIndex: sourceIndex,
      dropReason: null,
      newTrackDrop: null,
    });
    setDragMessage(null);
  };

  const onClipPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const raw = BigInt(Math.round((event.clientX - drag.originX) / scale));
    const snapped = snap ? BigInt(Math.round(Number(raw) / 5) * 5) : raw;
    const bounds = scrollRef.current?.getBoundingClientRect();
    const contentY =
      bounds === undefined ? 0 : event.clientY - bounds.top + (scrollRef.current?.scrollTop ?? 0);
    const nextStart = drag.clip.range.start + snapped;
    const rawTargetIndex = Math.floor(contentY / rowHeight) - 1;
    if (rawTargetIndex < 0 || rawTargetIndex >= tracks.length) {
      const source = timeline.tracks[drag.clip.trackId];
      if (source === undefined) return;
      const atIndex = rawTargetIndex < 0 ? 0 : tracks.length;
      const newTrackDrop =
        drag.newTrackDrop?.atIndex === atIndex
          ? drag.newTrackDrop
          : { track: createEmptyTrack(source.kind, atIndex, tracks), atIndex };
      const reason = validateNewTrackDrop(timeline, drag.clip, nextStart);
      setDrag({
        ...drag,
        deltaFrames: snapped,
        targetTrackId: newTrackDrop.track.id,
        targetTrackIndex: atIndex,
        dropReason: reason,
        newTrackDrop,
      });
      setDragMessage(
        reason ?? `Release to create ${newTrackDrop.track.name} and move ${drag.clip.name} onto it.`,
      );
      return;
    }
    const targetIndex = rawTargetIndex;
    const target = tracks[targetIndex] ?? timeline.tracks[drag.clip.trackId];
    if (target === undefined) return;
    const reason = validateClipDrop(timeline, drag.clip, target.id, nextStart);
    setDrag({
      ...drag,
      deltaFrames: snapped,
      targetTrackId: target.id,
      targetTrackIndex: targetIndex,
      dropReason: reason,
      newTrackDrop: null,
    });
    setDragMessage(reason);
  };

  const onClipPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const next = drag.clip.range.start + drag.deltaFrames;
    if (
      drag.dropReason === null &&
      (drag.deltaFrames !== 0n || drag.targetTrackId !== drag.clip.trackId) &&
      next >= 0n
    ) {
      if (drag.newTrackDrop === null) {
        onCommand({
          kind: "clips.move",
          moves: [{ clipId: drag.clip.id, trackId: drag.targetTrackId, start: masterFrame(next) }],
        });
      } else {
        onCommand({
          kind: "clips.move-to-new-track",
          track: drag.newTrackDrop.track,
          atIndex: drag.newTrackDrop.atIndex,
          moves: [{ clipId: drag.clip.id, trackId: drag.newTrackDrop.track.id, start: masterFrame(next) }],
        });
      }
      setDragMessage(
        drag.newTrackDrop === null
          ? `Moved ${drag.clip.name} to ${timeline.tracks[drag.targetTrackId]?.name ?? "track"} at frame ${String(next)}.`
          : `Created ${drag.newTrackDrop.track.name} and moved ${drag.clip.name} there at frame ${String(next)}.`,
      );
    } else if (drag.dropReason !== null) {
      setDragMessage(drag.dropReason);
    }
    setDrag(null);
  };

  const nudge = (delta: bigint) => {
    const clips = timeline.selection.selectedIds.flatMap((id) => {
      const clip = timeline.clips[id];
      return clip === undefined ? [] : [clip];
    });
    if (clips.length === 0 || clips.some((clip) => clip.range.start + delta < 0n)) return;
    onCommand({
      kind: "clips.move",
      moves: clips.map((clip) => ({
        clipId: clip.id,
        trackId: clip.trackId,
        start: masterFrame(clip.range.start + delta),
      })),
    });
  };

  const duplicateSelection = () => {
    const clips = timeline.selection.selectedIds.flatMap((id) => {
      const clip = timeline.clips[id];
      return clip === undefined ? [] : [clip];
    });
    const first = clips[0];
    if (first === undefined) return;
    onCommand({
      kind: "clips.duplicate",
      mappings: clips.map((clip) => ({
        sourceClipId: clip.id,
        newClipId: stableEntityId(`clip-duplicate-${crypto.randomUUID()}`),
        targetTrackId: clip.trackId,
      })),
      delta: masterFrame(first.range.end - first.range.start),
    });
  };

  const commitRename = (): void => {
    if (renamingClip === null || renameDraft.trim().length === 0) return;
    onCommand({
      kind: "clip.update",
      clipId: renamingClip.id,
      name: renameDraft.trim(),
      metadataMode: "merge",
    });
    setDragMessage(`Renamed ${renamingClip.name} to ${renameDraft.trim()}.`);
    setRenamingClip(null);
  };

  const selectClipFromKeyboard = (clip: ClipSnapshot) => {
    onCommand({ kind: "selection.set", entityIds: [clip.id], mode: "replace", primaryId: clip.id });
    setDragMessage(`Selected ${clip.name} on ${timeline.tracks[clip.trackId]?.name ?? "track"}.`);
  };

  const moveClipFromKeyboard = (clip: ClipSnapshot, frameDelta: bigint, trackDelta: number) => {
    const sourceIndex = tracks.findIndex((track) => track.id === clip.trackId);
    const target = tracks[sourceIndex + trackDelta] ?? timeline.tracks[clip.trackId];
    if (target === undefined) return;
    const nextStart = clip.range.start + frameDelta;
    const reason = validateClipDrop(timeline, clip, target.id, nextStart);
    if (reason !== null) {
      setDragMessage(reason);
      return;
    }
    onCommand({
      kind: "clips.move",
      moves: [{ clipId: clip.id, trackId: target.id, start: masterFrame(nextStart) }],
    });
    setDragMessage(`Moved ${clip.name} to ${target.name} at frame ${String(nextStart)}.`);
  };

  const trimClipFromKeyboard = (clip: ClipSnapshot, edge: "in" | "out", delta: bigint) => {
    const toFrame = (edge === "in" ? clip.range.start : clip.range.end) + delta;
    if (toFrame < 0n || (edge === "in" ? toFrame >= clip.range.end : toFrame <= clip.range.start)) {
      setDragMessage("That trim would collapse the clip or move before frame 0.");
      return;
    }
    onCommand({
      kind: "clips.trim",
      trims: [{ clipId: clip.id, edge, toFrame: masterFrame(toFrame) }],
      ripple: false,
    });
    setDragMessage(`Trimmed ${clip.name} ${edge} edge to frame ${String(toFrame)}.`);
  };

  const openKeyboardContextMenu = (clip: ClipSnapshot, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    onCommand({ kind: "selection.set", entityIds: [clip.id], mode: "replace", primaryId: clip.id });
    setContextMenu({ clip, x: bounds.left + Math.min(bounds.width, 32), y: bounds.bottom });
  };

  const closeContextMenu = () => {
    const clipId = contextMenu?.clip.id;
    setContextMenu(null);
    if (clipId !== undefined) {
      queueMicrotask(() =>
        scrollRef.current?.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(clipId)}"]`)?.focus(),
      );
    }
  };

  useEffect(() => {
    if (contextMenu === null) return;
    queueMicrotask(() => contextMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }, [contextMenu]);

  useEffect(
    () => () => {
      if (seekAnimationFrameRef.current !== null) cancelAnimationFrame(seekAnimationFrameRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (contextMenu === null || contextMenuRef.current === null) return;
    const menuBounds = contextMenuRef.current.getBoundingClientRect();
    const footerTop = document.querySelector<HTMLElement>(".status-footer")?.getBoundingClientRect().top;
    const margin = 8;
    const usableBottom = Math.min(window.innerHeight, footerTop ?? window.innerHeight) - margin;
    const nextX = Math.max(margin, Math.min(contextMenu.x, window.innerWidth - menuBounds.width - margin));
    const nextY = Math.max(margin, Math.min(contextMenu.y, usableBottom - menuBounds.height));
    if (nextX === contextMenu.x && nextY === contextMenu.y) return;
    setContextMenu({ ...contextMenu, x: nextX, y: nextY });
  }, [contextMenu]);

  return (
    <section className="timeline-editor" aria-label="Frame-exact timeline editor">
      <p className="visually-hidden" role="status" aria-live="polite">
        Timeline summary: {tracks.length} tracks, {Object.keys(timeline.clips).length} clips,{" "}
        {timeline.selection.selectedIds.length} selected. Only visible track rows are mounted.
      </p>
      <p id="timeline-keyboard-instructions" className="visually-hidden">
        Enter or Space selects a clip. Arrow keys move one frame or one compatible track. Alt plus left or
        right trims the in edge. Shift plus left or right trims the out edge. Shift F10 opens clip actions.
      </p>
      {dragMessage === null ? null : (
        <p className="visually-hidden" role="status" aria-live="polite">
          {dragMessage}
        </p>
      )}
      <div className="timeline-commandbar">
        <div className="timeline-toolgroup" role="group" aria-label="Timeline tools">
          <Button
            variant={tool === "select" ? "primary" : "ghost"}
            onClick={() => {
              setTool("select");
              setBladeFrame(null);
            }}
          >
            <ChaiIcon name="select-tool" size={14} />
            <kbd>V</kbd> Select
          </Button>
          <Button
            variant={tool === "blade" ? "primary" : "ghost"}
            onClick={() => {
              setTool("blade");
              setDragMessage(
                "Blade cuts at the exact pointer frame. Split-at-playhead remains a separate command.",
              );
            }}
          >
            <ChaiIcon name="blade-tool" size={14} />
            <kbd>B</kbd> Blade
          </Button>
          <Button
            variant="ghost"
            disabled={splitTargets.length === 0}
            aria-label="Split selected clips at playhead"
            aria-keyshortcuts="Meta+B"
            title={
              splitTargets.length === 0
                ? `Select a clip that crosses playhead frame ${currentFrame}.`
                : `Split ${String(splitTargets.length)} selected clip${splitTargets.length === 1 ? "" : "s"} at exact frame ${currentFrame} (⌘B).`
            }
            onClick={() => {
              splitClipsAtFrame(splitTargets, frame);
              setDragMessage(
                `Cut ${String(splitTargets.length)} selected clip${splitTargets.length === 1 ? "" : "s"} at playhead frame ${currentFrame}.`,
              );
            }}
          >
            <ChaiIcon name="split-playhead" size={16} />
            Playhead
          </Button>
          <button
            className={`timeline-toggle${snap ? " active" : ""}`}
            type="button"
            onClick={() => {
              setSnap(!snap);
            }}
            aria-pressed={snap}
          >
            <ChaiIcon name="snap" size={14} />
            Snap {snap ? "on" : "off"}
          </button>
          <button
            className="timeline-toggle active"
            type="button"
            disabled
            aria-pressed="true"
            title="Linked-clip coverage is enforced by timeline authority and cannot be bypassed in this build."
          >
            <ChaiIcon name="linked-clips" size={16} />
            Linked enforced
          </button>
        </div>
        <label className="timeline-search">
          <span>Search timeline</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Clip, asset, engine, warning"
          />
          {normalizedSearch === "" ? null : <Badge>{searchHits.size} matches</Badge>}
        </label>
        <div className="timeline-edit-actions">
          <Button
            variant="ghost"
            disabled={undoLabel === null}
            onClick={onUndo}
            aria-label={undoLabel === null ? "Undo unavailable" : `Undo ${undoLabel}`}
          >
            <ChaiIcon name="undo" size={14} />
            {undoLabel ?? "Undo"}
          </Button>
          <Button
            variant="ghost"
            disabled={redoLabel === null}
            onClick={onRedo}
            aria-label={redoLabel === null ? "Redo unavailable" : `Redo ${redoLabel}`}
          >
            <ChaiIcon name="redo" size={14} />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              nudge(-1n);
            }}
            aria-label="Nudge selected clips left one frame"
          >
            <ChaiIcon name="nudge-left" size={16} />
            1f
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              nudge(1n);
            }}
            aria-label="Nudge selected clips right one frame"
          >
            1f
            <ChaiIcon name="nudge-right" size={16} />
          </Button>
          <Button
            variant="ghost"
            disabled={primaryClip === null}
            onClick={() => {
              if (primaryClip !== null)
                onCommand({ kind: "clips.delete", clipIds: timeline.selection.selectedIds });
            }}
          >
            <ChaiIcon name="delete" size={14} />
            Delete
          </Button>
          <Button variant="ghost" disabled={primaryClip === null} onClick={duplicateSelection}>
            <ChaiIcon name="duplicate" size={16} />
            Duplicate
          </Button>
          <Button
            variant="ghost"
            disabled={primaryClip === null}
            onClick={() => {
              setClipboard(copyTimelineClips(timeline, timeline.selection.selectedIds));
            }}
          >
            <ChaiIcon name="copy" size={16} />
            Copy
          </Button>
          <Button
            variant="ghost"
            disabled={clipboard === null || primaryClip === null}
            onClick={() => {
              if (clipboard === null || primaryClip === null) return;
              onCommand({
                kind: "clips.paste",
                clipboard,
                atFrame: primaryClip.range.end,
                mappings: clipboard.clips.map((clip) => ({
                  sourceClipId: clip.id,
                  newClipId: stableEntityId(`clip-paste-${crypto.randomUUID()}`),
                  targetTrackId: clip.trackId,
                })),
              });
            }}
          >
            <ChaiIcon name="paste" size={16} />
            Paste
          </Button>
          <Button
            variant="ghost"
            aria-label="Add track"
            onClick={() => {
              const track = createEmptyTrack("video", tracks.length, tracks);
              onCommand({
                kind: "track.add",
                atIndex: tracks.length,
                track,
              });
            }}
          >
            <ChaiIcon name="add-track" size={16} />
            Track
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onCommand({ kind: "range.set", range: createFrameRange(frame, masterFrame(frame + 120n)) });
            }}
          >
            Set I/O
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const viewport = scrollRef.current?.clientWidth ?? 1100;
              setPixelsPerFrame(
                Math.max(0.25, Math.min(2.4, (viewport - headerWidth - 16) / Number(timeline.duration))),
              );
              scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
            }}
          >
            Fit
          </Button>
          <span className="timeline-zoom-label">{pixelsPerFrame.toFixed(2)} px/f</span>
          <input
            aria-label="Timeline zoom"
            type="range"
            min="0.25"
            max="2.4"
            step="0.05"
            value={pixelsPerFrame}
            onChange={(event) => {
              setPixelsPerFrame(Number(event.target.value));
            }}
          />
        </div>
      </div>
      <ProfessionalEditBar timeline={timeline} currentFrame={currentFrame} onCommand={onCommand} />
      <div className="timeline-statusbar">
        <span>
          <kbd>{tool === "select" ? "V" : "B"}</kbd>{" "}
          {tool === "select" ? "Selection and move" : "Blade at pointer frame"}
        </span>
        <strong>{timeline.selection.selectedIds.length} selected</strong>
        <span>Master frame {currentFrame} · integer authority</span>
        {dragMessage === null ? null : <span className="timeline-action-message">{dragMessage}</span>}
        <span>
          {timeline.inOutRange === null
            ? "No I/O range"
            : `I/O ${String(timeline.inOutRange.start)}–${String(timeline.inOutRange.end)}`}
        </span>
      </div>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setViewportHeight(event.currentTarget.clientHeight);
        }}
      >
        <div
          className="timeline-canvas"
          style={{
            width: `${String(width + headerWidth)}px`,
            height: `${String((tracks.length + 1 + (drag?.newTrackDrop === null || drag?.newTrackDrop === undefined ? 0 : 1)) * rowHeight)}px`,
          }}
        >
          <div className="timeline-top-row">
            <div className="timeline-corner">
              TRACKS <span>{tracks.length}</span>
            </div>
            <div
              className={`timeline-ruler${scrubbing ? " scrubbing" : ""}`}
              style={{ left: `${String(headerWidth)}px`, width: `${String(width)}px` }}
              aria-label="Timeline ruler. Click or drag to seek."
              onPointerDown={startSurfaceScrub}
              onPointerMove={continueSurfaceScrub}
              onPointerUp={finishSurfaceScrub}
              onPointerCancel={cancelSurfaceScrub}
              onLostPointerCapture={() => {
                setScrubbing(false);
              }}
            >
              {rulerTicks(timeline.duration, width).map((tick) => (
                <span
                  className={tick.major ? "major" : ""}
                  style={{ left: `${String(tick.left)}px` }}
                  key={tick.frame.toString()}
                >
                  {tick.major ? formatTimecode(tick.frame, timeline.fps, true).text : ""}
                </span>
              ))}
              {Object.values(timeline.markers).map((marker) => (
                <i
                  className={`timeline-marker ${marker.issueSeverity ?? "note"}`}
                  style={{ left: `${String(Number(marker.frame) * scale)}px` }}
                  title={marker.label}
                  key={marker.id}
                />
              ))}
            </div>
          </div>
          <div
            className={`timeline-playhead${scrubbing ? " scrubbing" : ""}${tool === "blade" ? " blade-pass-through" : ""}`}
            style={{ left: `${String(headerWidth + Number(frame) * scale)}px` }}
            role="slider"
            tabIndex={0}
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={Number(timeline.duration > 0n ? timeline.duration - 1n : 0n)}
            aria-valuenow={Number(frame)}
            aria-valuetext={`Frame ${currentFrame}, ${formatTimecode(frame, timeline.fps, true).text}`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const scroll = scrollRef.current;
              if (scroll === null) return;
              const bounds = scroll.getBoundingClientRect();
              const playheadClientX = bounds.left - scroll.scrollLeft + headerWidth + Number(frame) * scale;
              playheadPointerOffsetRef.current = event.clientX - playheadClientX;
              event.currentTarget.setPointerCapture(event.pointerId);
              setScrubbing(true);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              seekAtPointer(event.clientX, false);
            }}
            onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              seekAtPointer(event.clientX, true);
              event.currentTarget.releasePointerCapture(event.pointerId);
              playheadPointerOffsetRef.current = 0;
              setScrubbing(false);
            }}
            onPointerCancel={cancelSurfaceScrub}
            onLostPointerCapture={() => {
              playheadPointerOffsetRef.current = 0;
              setScrubbing(false);
            }}
            onKeyDown={(event) => {
              const lastFrame = timeline.duration > 0n ? timeline.duration - 1n : 0n;
              const delta = event.shiftKey ? 10n : 1n;
              const nextFrame =
                event.key === "Home"
                  ? 0n
                  : event.key === "End"
                    ? lastFrame
                    : event.key === "ArrowLeft"
                      ? frame - delta
                      : event.key === "ArrowRight"
                        ? frame + delta
                        : null;
              if (nextFrame === null) return;
              event.preventDefault();
              queueSeek(
                masterFrame(nextFrame < 0n ? 0n : nextFrame > lastFrame ? lastFrame : nextFrame),
                true,
              );
            }}
          >
            <span>{currentFrame}</span>
          </div>
          {drag === null || !snap ? null : (
            <div
              className="timeline-snap-guide"
              style={{
                left: `${String(headerWidth + Number(drag.clip.range.start + drag.deltaFrames) * scale)}px`,
              }}
            >
              <span>{drag.clip.range.start + drag.deltaFrames}f</span>
            </div>
          )}
          {bladeFrame === null ? null : (
            <div
              className={`timeline-blade-guide${bladeFrame === frame ? " at-playhead" : ""}`}
              style={{ left: `${String(headerWidth + Number(bladeFrame) * scale)}px` }}
            >
              <span>
                {bladeFrame === frame ? "Cut at playhead · " : ""}
                {String(bladeFrame)}f · {formatTimecode(masterFrame(bladeFrame), timeline.fps, true).text}
              </span>
            </div>
          )}
          {timeline.inOutRange === null ? null : (
            <div
              className="timeline-io-range"
              style={{
                left: `${String(headerWidth + Number(timeline.inOutRange.start) * scale)}px`,
                width: `${String(Number(timeline.inOutRange.end - timeline.inOutRange.start) * scale)}px`,
              }}
            />
          )}
          {drag?.newTrackDrop === null || drag?.newTrackDrop === undefined ? null : (
            <div
              className={`timeline-track timeline-new-track${drag.dropReason === null ? " drop-valid" : " drop-invalid"}`}
              style={{ top: `${String((drag.newTrackDrop.atIndex + 1) * rowHeight)}px` }}
              aria-label={`${drag.newTrackDrop.track.name} new ${drag.newTrackDrop.track.kind} track drop target`}
            >
              <div className="timeline-track-header">
                <span className={`track-kind track-kind--${drag.newTrackDrop.track.kind}`}>
                  {drag.newTrackDrop.track.kind.slice(0, 1).toUpperCase()}
                </span>
                <span className="timeline-new-track-label">
                  <strong>{drag.newTrackDrop.track.name}</strong>
                  <small>new {drag.newTrackDrop.track.kind} track</small>
                </span>
              </div>
              <div
                className="timeline-track-lane"
                style={{ left: `${String(headerWidth)}px`, width: `${String(width)}px` }}
              />
            </div>
          )}
          {visibleTracks.map((track, visibleIndex) => {
            const index = firstVisibleTrack + visibleIndex;
            const displayIndex =
              drag?.newTrackDrop !== null &&
              drag?.newTrackDrop !== undefined &&
              drag.newTrackDrop.atIndex <= index
                ? index + 1
                : index;
            return (
              <div
                className={`timeline-track${drag?.targetTrackId === track.id ? (drag.dropReason === null ? " drop-valid" : " drop-invalid") : ""}`}
                style={{ top: `${String((displayIndex + 1) * rowHeight)}px` }}
                key={track.id}
              >
                <div className="timeline-track-header">
                  <span className={`track-kind track-kind--${track.kind}`}>
                    {track.kind.slice(0, 1).toUpperCase()}
                  </span>
                  <button
                    className="track-title"
                    type="button"
                    onDoubleClick={() => {
                      onCommand({
                        kind: "track.update",
                        trackId: track.id,
                        changes: { name: `${track.name} copy` },
                      });
                    }}
                  >
                    <strong>{track.name}</strong>
                    <small>{track.kind}</small>
                  </button>
                  <button
                    type="button"
                    className={track.locked ? "active" : ""}
                    aria-label={`${track.locked ? "Unlock" : "Lock"} ${track.name}`}
                    onClick={() => {
                      onCommand({
                        kind: "track.update",
                        trackId: track.id,
                        changes: { locked: !track.locked },
                      });
                    }}
                  >
                    <ChaiIcon name="track-lock" size={16} />
                  </button>
                  <button
                    type="button"
                    className={track.muted ? "active" : ""}
                    aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
                    onClick={() => {
                      onCommand({
                        kind: "track.update",
                        trackId: track.id,
                        changes: { muted: !track.muted },
                      });
                    }}
                  >
                    <ChaiIcon name="track-mute" size={16} />
                  </button>
                  <button
                    type="button"
                    className={track.solo ? "active" : ""}
                    aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`}
                    onClick={() => {
                      onCommand({ kind: "track.update", trackId: track.id, changes: { solo: !track.solo } });
                    }}
                  >
                    <ChaiIcon name="track-solo" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${track.name}`}
                    onClick={() => {
                      onCommand({ kind: "track.remove", trackId: track.id, removeClips: true });
                    }}
                  >
                    <ChaiIcon name="delete" size={14} />
                  </button>
                </div>
                <div
                  className="timeline-track-lane"
                  aria-label={`${track.name} ${track.kind} track lane`}
                  data-track-id={track.id}
                  style={{ left: `${String(headerWidth)}px`, width: `${String(width)}px` }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) startSurfaceScrub(event);
                  }}
                  onPointerMove={(event) => {
                    if (event.target === event.currentTarget) continueSurfaceScrub(event);
                  }}
                  onPointerUp={(event) => {
                    if (event.target === event.currentTarget) finishSurfaceScrub(event);
                  }}
                  onPointerCancel={(event) => {
                    if (event.target === event.currentTarget) cancelSurfaceScrub(event);
                  }}
                  onLostPointerCapture={() => {
                    setScrubbing(false);
                  }}
                >
                  {track.clipIds.map((clipId) => {
                    const clip = timeline.clips[clipId];
                    if (clip === undefined) return null;
                    const delta = drag?.clip.id === clip.id ? drag.deltaFrames : 0n;
                    const sourceIndex = tracks.findIndex((candidate) => candidate.id === clip.trackId);
                    const displayedSourceIndex =
                      drag?.newTrackDrop !== null &&
                      drag?.newTrackDrop !== undefined &&
                      drag.newTrackDrop.atIndex <= sourceIndex
                        ? sourceIndex + 1
                        : sourceIndex;
                    const verticalDelta =
                      drag?.clip.id === clip.id
                        ? (drag.targetTrackIndex - displayedSourceIndex) * rowHeight
                        : 0;
                    const active = selected.has(clip.id);
                    const hit = normalizedSearch !== "" && searchHits.has(clip.id);
                    return (
                      <button
                        className={`editor-clip editor-clip--${clip.engine}${active ? " selected" : ""}${hit ? " search-hit" : ""}`}
                        style={{
                          left: `${String(Number(clip.range.start + delta) * scale)}px`,
                          width: `${String(Math.max(18, Number(clip.range.end - clip.range.start) * scale))}px`,
                          transform:
                            verticalDelta === 0 ? undefined : `translateY(${String(verticalDelta)}px)`,
                        }}
                        type="button"
                        data-clip-id={clip.id}
                        aria-pressed={active}
                        aria-describedby="timeline-keyboard-instructions"
                        aria-label={`${clip.name}, ${track.name}, frames ${String(clip.range.start)} to ${String(clip.range.end)}, ${active ? "selected" : "not selected"}`}
                        onPointerDown={(event) => {
                          onClipPointerDown(clip, event);
                        }}
                        onPointerMove={onClipPointerMove}
                        onPointerEnter={(event) => {
                          if (tool === "blade")
                            setBladeFrame(bladeFrameAtPointer(clip, event.clientX, event.currentTarget));
                        }}
                        onPointerMoveCapture={(event) => {
                          if (tool === "blade")
                            setBladeFrame(bladeFrameAtPointer(clip, event.clientX, event.currentTarget));
                        }}
                        onPointerLeave={() => {
                          if (tool === "blade") setBladeFrame(null);
                        }}
                        onPointerUp={onClipPointerUp}
                        onPointerCancel={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                            event.currentTarget.releasePointerCapture(event.pointerId);
                          }
                          setDrag(null);
                          setDragMessage("Move canceled.");
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onCommand({
                            kind: "selection.set",
                            entityIds: [clip.id],
                            mode: event.metaKey || event.ctrlKey ? "toggle" : "replace",
                            primaryId: clip.id,
                          });
                          setContextMenu({ clip, x: event.clientX, y: event.clientY });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                            event.preventDefault();
                            openKeyboardContextMenu(clip, event.currentTarget);
                            return;
                          }
                          if (event.key === "Delete" || event.key === "Backspace") {
                            event.preventDefault();
                            onCommand({ kind: "clips.delete", clipIds: [clip.id] });
                            setDragMessage(`Deleted ${clip.name}.`);
                            return;
                          }
                          if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                            event.preventDefault();
                            trimClipFromKeyboard(clip, "in", event.key === "ArrowLeft" ? -1n : 1n);
                            return;
                          }
                          if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                            event.preventDefault();
                            trimClipFromKeyboard(clip, "out", event.key === "ArrowLeft" ? -1n : 1n);
                            return;
                          }
                          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                            event.preventDefault();
                            moveClipFromKeyboard(clip, event.key === "ArrowLeft" ? -1n : 1n, 0);
                            return;
                          }
                          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                            event.preventDefault();
                            moveClipFromKeyboard(clip, 0n, event.key === "ArrowUp" ? -1 : 1);
                            return;
                          }
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectClipFromKeyboard(clip);
                          }
                        }}
                        key={clip.id}
                      >
                        <span className="clip-engine">
                          {clip.engine === "remotion" ? (
                            "R"
                          ) : clip.engine === "hyperframes" ? (
                            "H"
                          ) : track.kind === "audio" ? (
                            <ChaiIcon name="audio-media" size={16} />
                          ) : (
                            "S"
                          )}
                        </span>
                        <strong>{clip.name}</strong>
                        <small>
                          {clip.range.start}–{clip.range.end} · {clip.range.end - clip.range.start}f
                        </small>
                        {clip.metadata.waveform === "true" ? (
                          <i className="clip-waveform" aria-hidden="true" />
                        ) : null}
                        {clip.metadata.keyframes === undefined ? null : (
                          <span className="clip-keyframes" aria-label="Clip has keyframes">
                            <ChaiIcon name="keyframe" size={14} />
                          </span>
                        )}
                        {clip.metadata.bridge === undefined ? null : (
                          <span className="clip-bridge" aria-label="Linked bridge clip">
                            <ChaiIcon name="linked-clips" size={16} />
                          </span>
                        )}
                        {clip.metadata.warning === undefined ? null : (
                          <span className="clip-warning" aria-label="Clip warning">
                            <ChaiIcon name="status-warning" size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu === null ? null : (
        <div
          ref={contextMenuRef}
          className="timeline-context-menu"
          role="menu"
          aria-label={`${contextMenu.clip.name} clip actions`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']")];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "ArrowDown"
                ? items[(current + 1) % items.length]
                : event.key === "ArrowUp"
                  ? items[(current - 1 + items.length) % items.length]
                  : event.key === "Home"
                    ? items[0]
                    : event.key === "End"
                      ? items.at(-1)
                      : null;
            if (event.key === "Escape") {
              event.preventDefault();
              closeContextMenu();
            } else if (next !== null && next !== undefined) {
              event.preventDefault();
              next.focus();
            }
          }}
        >
          <strong>{contextMenu.clip.name}</strong>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              duplicateSelection();
              closeContextMenu();
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCommand({
                kind: "clips.group",
                clipIds: timeline.selection.selectedIds,
                groupId: stableEntityId(`group-${crypto.randomUUID()}`),
              });
              closeContextMenu();
            }}
          >
            Group selected
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenamingClip(contextMenu.clip);
              setRenameDraft(contextMenu.clip.name);
              closeContextMenu();
            }}
          >
            Rename clip…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCommand({
                kind: "clips.link",
                clipIds: timeline.selection.selectedIds,
                linkGroupId: stableEntityId(`link-${crypto.randomUUID()}`),
              });
              closeContextMenu();
            }}
          >
            Link selected
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCommand({ kind: "clips.ripple-delete", clipIds: timeline.selection.selectedIds });
              closeContextMenu();
            }}
          >
            Ripple delete
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCommand({ kind: "clips.lift", clipIds: timeline.selection.selectedIds });
              closeContextMenu();
            }}
          >
            Lift
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCommand({
                kind: "clips.trim",
                trims: [
                  {
                    clipId: contextMenu.clip.id,
                    edge: "in",
                    toFrame: masterFrame(contextMenu.clip.range.start + 1n),
                  },
                ],
                ripple: false,
              });
              closeContextMenu();
            }}
          >
            Trim in +1 frame
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCommand({
                kind: "clips.trim",
                trims: [
                  {
                    clipId: contextMenu.clip.id,
                    edge: "out",
                    toFrame: masterFrame(contextMenu.clip.range.end - 1n),
                  },
                ],
                ripple: false,
              });
              closeContextMenu();
            }}
          >
            Trim out -1 frame
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeContextMenu();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {renamingClip === null ? null : (
        <ModalDialog
          className="timeline-rename-dialog"
          labelledBy="timeline-rename-title"
          initialFocusRef={renameInputRef}
          onDismiss={() => {
            setRenamingClip(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
          >
            <h2 id="timeline-rename-title">Rename clip</h2>
            <label>
              <span>Clip name</span>
              <input
                ref={renameInputRef}
                value={renameDraft}
                onChange={(event) => {
                  setRenameDraft(event.currentTarget.value);
                }}
              />
            </label>
            <div>
              <Button
                onClick={() => {
                  setRenamingClip(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={renameDraft.trim().length === 0}>
                Rename
              </Button>
            </div>
          </form>
        </ModalDialog>
      )}
    </section>
  );
};

const rulerTicks = (duration: bigint, width: number) => {
  const desired = Math.max(5, Math.floor(width / 90));
  const rawStep = Math.max(1, Math.ceil(Number(duration) / desired));
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: { frame: ReturnType<typeof masterFrame>; left: number; major: boolean }[] = [];
  for (let value = 0; value <= Number(duration); value += Math.max(1, Math.floor(step / 5))) {
    const frame = masterFrame(BigInt(value));
    ticks.push({ frame, left: (value / Number(duration || 1n)) * width, major: value % step === 0 });
  }
  return ticks;
};

const frameAtPointer = (
  clip: ClipSnapshot,
  clientX: number,
  element: HTMLElement,
  scale: number,
): ReturnType<typeof masterFrame> => {
  const bounds = element.getBoundingClientRect();
  const offsetFrames = BigInt(Math.floor(Math.max(0, clientX - bounds.left) / scale));
  const candidate = clip.range.start + offsetFrames;
  return masterFrame(candidate >= clip.range.end ? clip.range.end - 1n : candidate);
};

const validateClipDrop = (
  timeline: TimelineSnapshotV1,
  clip: ClipSnapshot,
  targetTrackId: ClipSnapshot["trackId"],
  nextStart: bigint,
): string | null => {
  const source = timeline.tracks[clip.trackId];
  const target = timeline.tracks[targetTrackId];
  if (source === undefined || target === undefined) return "That track is unavailable.";
  if (nextStart < 0n) return "A clip cannot begin before frame 0.";
  if (source.locked) return `${source.name} is locked. Unlock it before moving this clip.`;
  if (target.locked) return `${target.name} is locked. Unlock it before moving this clip.`;
  if (source.kind !== target.kind) {
    return `${clip.name} is a ${source.kind} clip and cannot be placed on ${target.name} (${target.kind}).`;
  }
  const nextEnd = nextStart + (clip.range.end - clip.range.start);
  const collision = target.clipIds
    .map((id) => timeline.clips[id])
    .find(
      (candidate) =>
        candidate !== undefined &&
        candidate.id !== clip.id &&
        nextStart < candidate.range.end &&
        candidate.range.start < nextEnd,
    );
  return collision === undefined
    ? null
    : `${target.name} is occupied by ${collision.name} at frames ${String(collision.range.start)}–${String(collision.range.end)}.`;
};

const validateNewTrackDrop = (
  timeline: TimelineSnapshotV1,
  clip: ClipSnapshot,
  nextStart: bigint,
): string | null => {
  const source = timeline.tracks[clip.trackId];
  if (source === undefined) return "The source track is unavailable.";
  if (source.locked) return `${source.name} is locked. Unlock it before moving this clip.`;
  if (nextStart < 0n) return "A clip cannot begin before frame 0.";
  return null;
};

const createEmptyTrack = (
  kind: TrackSnapshot["kind"],
  order: number,
  tracks: readonly TrackSnapshot[],
): TrackSnapshot => {
  const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : kind === "caption" ? "C" : "D";
  return {
    id: stableEntityId(`track-${kind}-${crypto.randomUUID()}`),
    kind,
    name: `${prefix}${String(tracks.filter((track) => track.kind === kind).length + 1)}`,
    order,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    audioBusId: null,
    clipIds: [],
  };
};
