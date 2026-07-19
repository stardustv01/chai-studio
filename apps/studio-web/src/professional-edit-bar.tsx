import { normalizeRational } from "@chai-studio/schema/rational";
import { Button } from "@chai-studio/ui-components";
import {
  createFrameRange,
  masterFrame,
  readProfessionalTimelineState,
  stableEntityId,
  type ClipSnapshot,
  type CompoundDefinition,
  type TimelineEditCommand,
  type TimelineSnapshotV1,
} from "@chai-studio/timeline/browser";

export const ProfessionalEditBar = ({
  currentFrame,
  onCommand,
  timeline,
}: {
  readonly currentFrame: string;
  readonly onCommand: (command: TimelineEditCommand) => void;
  readonly timeline: TimelineSnapshotV1;
}) => {
  const selected = timeline.selection.selectedIds.flatMap((id) => {
    const clip = timeline.clips[id];
    return clip === undefined ? [] : [clip];
  });
  const primary =
    timeline.selection.primaryId === null ? undefined : timeline.clips[timeline.selection.primaryId];
  const primaryAssetId = primary?.assetId ?? null;
  const neighbors = primary === undefined ? null : clipNeighbors(timeline, primary);
  const slideUnavailableReason = slideDisabledReason(primary, neighbors);
  const slipUnavailableReason =
    primary === undefined
      ? "Select one clip before slipping source media."
      : primary.availableSourceRange.end - primary.availableSourceRange.start <= 1n
        ? "Still and frozen sources have no source handles to slip."
        : null;
  const frame = masterFrame(BigInt(currentFrame));
  const professionalState = readProfessionalTimelineState(timeline);
  const roll = (delta: -1n | 1n): void => {
    if (primary === undefined || neighbors?.right === undefined) return;
    onCommand({
      kind: "clips.roll",
      leftClipId: primary.id,
      rightClipId: neighbors.right.id,
      boundary: masterFrame(primary.range.end + delta),
      includeLinked: true,
    });
  };
  const slip = (delta: -1n | 1n): void => {
    if (primary === undefined) return;
    onCommand({
      kind: "clip.slip",
      clipId: primary.id,
      deltaTimelineFrames: masterFrame(delta, true),
      includeLinked: true,
    });
  };
  const slide = (delta: -1n | 1n): void => {
    if (primary === undefined || neighbors?.left === undefined || neighbors.right === undefined) return;
    onCommand({
      kind: "clip.slide",
      clipId: primary.id,
      start: masterFrame(primary.range.start + delta),
      includeLinked: true,
    });
  };
  const createCompound = (): void => {
    if (selected.length < 2) return;
    const ordered = [...selected].sort((left, right) => (left.range.start < right.range.start ? -1 : 1));
    const first = ordered[0];
    const last = ordered.at(-1);
    if (first === undefined || last === undefined || ordered.some((clip) => clip.trackId !== first.trackId))
      return;
    const compoundId = stableEntityId(`compound-ui-${crypto.randomUUID()}`);
    const compoundClipId = stableEntityId(`clip-compound-ui-${crypto.randomUUID()}`);
    const nestedId = stableEntityId(`nested-ui-${crypto.randomUUID()}`);
    const range = createFrameRange(first.range.start, last.range.end);
    const childIds = new Set(ordered.map((clip) => clip.id));
    const childKeyframes = Object.values(timeline.keyframes).filter((key) => childIds.has(key.ownerEntityId));
    const childKeyIds = new Set(childKeyframes.map((key) => key.id));
    const childAutomation = Object.values(timeline.automation).filter(
      (lane) => childIds.has(lane.ownerEntityId) || lane.keyframeIds.some((id) => childKeyIds.has(id)),
    );
    const compound: CompoundDefinition = {
      id: compoundId,
      compoundClipId,
      nestedSequence: {
        id: nestedId,
        timelineId: stableEntityId(`timeline-nested-ui-${crypto.randomUUID()}`),
        rate: first.sourceRate,
        duration: masterFrame(range.end - range.start),
      },
      sourceTrackId: first.trackId,
      childClips: ordered,
      childKeyframes,
      childAutomation,
      childTransitions: Object.values(timeline.transitions).filter(
        (transition) => childIds.has(transition.fromClipId) || childIds.has(transition.toClipId),
      ),
      childBridges: Object.values(timeline.bridges).filter(
        (bridge) => childIds.has(bridge.fromEntityId) || childIds.has(bridge.toEntityId),
      ),
      dependencyIds: ordered.flatMap((clip) =>
        clip.assetId === null
          ? clip.nestedSequenceId === null
            ? []
            : [clip.nestedSequenceId]
          : [clip.assetId],
      ),
    };
    onCommand({
      kind: "compound.create",
      compound,
      compoundClip: {
        ...first,
        id: compoundClipId,
        assetId: null,
        nestedSequenceId: nestedId,
        name: `Compound · ${String(ordered.length)} clips`,
        range,
        sourceRange: createFrameRange(masterFrame(0n), masterFrame(range.end - range.start)),
        availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(range.end - range.start)),
        speed: normalizeRational(1n, 1n),
        keyframeIds: [],
      },
    });
  };

  return (
    <div className="professional-edit-bar" aria-label="Professional edit controls">
      <strong>PRO</strong>
      <span className="professional-edit-group">
        <Button
          disabled={primary === undefined || neighbors?.right === undefined}
          onClick={() => {
            roll(-1n);
          }}
        >
          Roll −1
        </Button>
        <Button
          disabled={primary === undefined || neighbors?.right === undefined}
          onClick={() => {
            roll(1n);
          }}
        >
          Roll +1
        </Button>
      </span>
      <span className="professional-edit-group">
        <span id="timeline-slip-availability" className="visually-hidden">
          {slipUnavailableReason ?? "Slip is available because the source has reusable handles."}
        </span>
        <Button
          disabled={slipUnavailableReason !== null}
          aria-describedby="timeline-slip-availability"
          title={slipUnavailableReason ?? "Slip the source left one frame."}
          onClick={() => {
            slip(-1n);
          }}
        >
          Slip −1
        </Button>
        <Button
          disabled={slipUnavailableReason !== null}
          aria-describedby="timeline-slip-availability"
          title={slipUnavailableReason ?? "Slip the source right one frame."}
          onClick={() => {
            slip(1n);
          }}
        >
          Slip +1
        </Button>
      </span>
      <span className="professional-edit-group">
        <span id="timeline-slide-availability" className="visually-hidden">
          {slideUnavailableReason ??
            "Slide is available because this clip has contiguous neighbors on both sides."}
        </span>
        <Button
          disabled={slideUnavailableReason !== null}
          aria-describedby="timeline-slide-availability"
          title={slideUnavailableReason ?? "Slide this clip left one frame."}
          onClick={() => {
            slide(-1n);
          }}
        >
          Slide −1
        </Button>
        <Button
          disabled={slideUnavailableReason !== null}
          aria-describedby="timeline-slide-availability"
          title={slideUnavailableReason ?? "Slide this clip right one frame."}
          onClick={() => {
            slide(1n);
          }}
        >
          Slide +1
        </Button>
      </span>
      <label>
        <span>Speed</span>
        <select
          disabled={primary === undefined}
          value={primary === undefined ? "1/1" : `${primary.speed.numerator}/${primary.speed.denominator}`}
          onChange={(event) => {
            if (primary === undefined) return;
            const [numerator = "1", denominator = "1"] = event.target.value.split("/");
            onCommand({
              kind: "clip.speed",
              clipId: primary.id,
              speed: normalizeRational(BigInt(numerator), BigInt(denominator)),
              reconcile: "preserve-source-range",
              audioBehavior: "preserve-pitch",
            });
          }}
        >
          <option value="1/2">50%</option>
          <option value="1/1">100%</option>
          <option value="2/1">200%</option>
        </select>
      </label>
      <Button
        disabled={primary === undefined}
        onClick={() => {
          if (primary === undefined) return;
          onCommand({
            kind: "clip.playback",
            clipId: primary.id,
            mode: "reverse",
            freezeSourceFrame: null,
            audioBehavior: "mute",
          });
        }}
      >
        Reverse
      </Button>
      <Button
        disabled={primary === undefined}
        onClick={() => {
          if (primary === undefined) return;
          const offset = frame < primary.range.start ? 0n : frame - primary.range.start;
          const sourceFrame =
            primary.sourceRange.start +
            (offset >= primary.range.end - primary.range.start
              ? primary.range.end - primary.range.start - 1n
              : offset);
          onCommand({
            kind: "clip.playback",
            clipId: primary.id,
            mode: "freeze",
            freezeSourceFrame: masterFrame(sourceFrame),
            audioBehavior: "mute",
          });
        }}
      >
        Freeze
      </Button>
      <Button disabled={selected.length < 2} onClick={createCompound}>
        Compound
      </Button>
      <Button
        disabled={primary === undefined}
        onClick={() => {
          if (primary === undefined) return;
          onCommand({
            kind: "clip.time-remap",
            definition: {
              clipId: primary.id,
              monotonicPolicy: "forward-only",
              audioBehavior: "resample",
              points: [
                {
                  id: stableEntityId(`remap-ui-${crypto.randomUUID()}`),
                  timelineFrame: primary.range.start,
                  sourceFrame: primary.sourceRange.start,
                  interpolation: "linear",
                },
                {
                  id: stableEntityId(`remap-ui-${crypto.randomUUID()}`),
                  timelineFrame: masterFrame(
                    primary.range.start + (primary.range.end - primary.range.start) / 2n,
                  ),
                  sourceFrame: masterFrame(
                    primary.sourceRange.start + (primary.sourceRange.end - primary.sourceRange.start) / 3n,
                  ),
                  interpolation: "linear",
                },
                {
                  id: stableEntityId(`remap-ui-${crypto.randomUUID()}`),
                  timelineFrame: primary.range.end,
                  sourceFrame: primary.sourceRange.end,
                  interpolation: "linear",
                },
              ],
            },
          });
        }}
      >
        Speed curve
      </Button>
      <Button
        disabled={primaryAssetId === null}
        onClick={() => {
          if (primary === undefined || primaryAssetId === null) return;
          const stackId = stableEntityId(`take-stack-ui-${crypto.randomUUID()}`);
          const activeId = stableEntityId(`take-ui-${crypto.randomUUID()}`);
          const alternateId = stableEntityId(`take-ui-${crypto.randomUUID()}`);
          onCommand({
            kind: "takes.set",
            stack: {
              id: stackId,
              clipId: primary.id,
              activeTakeId: activeId,
              takes: [
                {
                  id: activeId,
                  label: "Current take",
                  assetId: primaryAssetId,
                  nestedSequenceId: null,
                  reviewRevisionId: timeline.revisionId,
                },
                {
                  id: alternateId,
                  label: "Alternate review take",
                  assetId: stableEntityId(`asset-alternate-${crypto.randomUUID()}`),
                  nestedSequenceId: null,
                  reviewRevisionId: timeline.revisionId,
                },
              ],
            },
          });
        }}
      >
        Version stack
      </Button>
      <Button
        disabled={primary === undefined}
        onClick={() => {
          if (primary === undefined) return;
          const inset = primary.range.end - primary.range.start > 8n ? 4n : 0n;
          onCommand({
            kind: "adjustment.upsert",
            layer: {
              id: stableEntityId(`adjustment-ui-${crypto.randomUUID()}`),
              clipId: primary.id,
              range: createFrameRange(
                masterFrame(primary.range.start + inset),
                masterFrame(primary.range.end - inset),
              ),
              effects: [
                {
                  id: stableEntityId(`effect-ui-${crypto.randomUUID()}`),
                  name: "Shared exposure",
                  ownership: "common",
                  engine: null,
                  capability: "unified",
                  parameters: { exposure: 0.25 },
                  fallback: "shared",
                },
              ],
            },
          });
        }}
      >
        Range effect
      </Button>
      <span className="professional-edit-truth">
        {primary === undefined
          ? "Select a clip"
          : `${primary.name} · exact ${primary.speed.numerator}/${primary.speed.denominator} · ${String(Object.keys(professionalState.adjustmentLayers).length)} cached ranges`}
      </span>
    </div>
  );
};

const clipNeighbors = (
  timeline: TimelineSnapshotV1,
  clip: ClipSnapshot,
): Readonly<{ left: ClipSnapshot | undefined; right: ClipSnapshot | undefined }> => {
  const ordered = (timeline.tracks[clip.trackId]?.clipIds ?? [])
    .map((id) => timeline.clips[id])
    .filter((item): item is ClipSnapshot => item !== undefined)
    .sort((left, right) => (left.range.start < right.range.start ? -1 : 1));
  const index = ordered.findIndex((item) => item.id === clip.id);
  return { left: ordered[index - 1], right: ordered[index + 1] };
};

const slideDisabledReason = (
  clip: ClipSnapshot | undefined,
  neighbors: Readonly<{ left: ClipSnapshot | undefined; right: ClipSnapshot | undefined }> | null,
): string | null => {
  if (clip === undefined) return "Select a clip to use Slide.";
  if (neighbors?.left === undefined || neighbors.right === undefined) {
    return "Slide requires contiguous clips on both sides of the selected clip.";
  }
  if (neighbors.left.range.end !== clip.range.start || clip.range.end !== neighbors.right.range.start) {
    return "Slide requires both neighboring clips to touch the selected clip without gaps.";
  }
  return null;
};
