import { useMemo, useState } from "react";
import { Badge, Button } from "@chai-studio/ui-components";
import {
  createFrameRange,
  masterFrame,
  readProfessionalTimelineState,
  stableEntityId,
  type AdvancedBridgeDefinition,
  type ClipSnapshot,
  type TimelineEditCommand,
  type TimelineSnapshotV1,
} from "@chai-studio/timeline/browser";

export const BridgeEditorPanel = ({
  onCommand,
  timeline,
}: {
  readonly onCommand: (command: TimelineEditCommand) => void;
  readonly timeline: TimelineSnapshotV1;
}) => {
  const pair = useMemo(() => adjacentPair(timeline), [timeline]);
  const [implementation, setImplementation] = useState<AdvancedBridgeDefinition["implementation"]>("shader");
  const [alpha, setAlpha] = useState<AdvancedBridgeDefinition["alpha"]>("premultiplied");
  const [audioEnvelope, setAudioEnvelope] =
    useState<AdvancedBridgeDefinition["audioEnvelope"]>("equal-power");
  const [fallback, setFallback] = useState<AdvancedBridgeDefinition["fallback"]>("crossfade");
  const [status, setStatus] = useState("No rendered boundary evidence yet");
  const state = readProfessionalTimelineState(timeline);
  const save = (): void => {
    if (pair === null) return;
    if (implementation !== "shared") {
      setStatus("Blocked · experimental bridges require rendered boundary QA evidence");
      return;
    }
    const handle = 8n;
    const range = createFrameRange(
      masterFrame(pair.left.range.end - handle),
      masterFrame(pair.right.range.start + handle),
    );
    const bridge: AdvancedBridgeDefinition = {
      id: stableEntityId(`bridge-advanced-ui-${crypto.randomUUID()}`),
      fromClipId: pair.left.id,
      toClipId: pair.right.id,
      range,
      implementation,
      owner: "shared",
      outgoingHandleFrames: masterFrame(handle),
      incomingHandleFrames: masterFrame(handle),
      preRollFrames: masterFrame(2n),
      postRollFrames: masterFrame(2n),
      alpha,
      audioEnvelope,
      experimental: false,
      fallback,
      boundaryQa: "pending",
    };
    onCommand({ kind: "bridge.advanced.upsert", bridge });
    setStatus(`Saved shared bridge · ${String(range.end - range.start)}-frame range · boundary QA pending`);
  };
  return (
    <section className="advanced-bridge-editor" aria-label="Advanced transition and bridge editor">
      <header>
        <div>
          <span className="eyebrow">Cross-engine finishing</span>
          <strong>Advanced bridge editor</strong>
          <small>Handles · alpha · pre/post-roll · audio envelope · fallback · boundary QA</small>
        </div>
        <Badge tone={pair === null ? "attention" : "ready"}>
          {pair === null ? "No adjacent pair" : `${pair.left.engine} → ${pair.right.engine}`}
        </Badge>
      </header>
      <div className="advanced-bridge-editor__body">
        <div className="bridge-range-visual">
          <span className="bridge-range-outgoing">Outgoing · 8f handle</span>
          <i>16 exact frames</i>
          <span className="bridge-range-incoming">Incoming · 8f handle</span>
        </div>
        <div className="bridge-control-grid">
          <label>
            <span>Implementation</span>
            <select
              value={implementation}
              onChange={(event) => {
                setImplementation(event.target.value as typeof implementation);
              }}
            >
              <option value="shared">Shared transition</option>
              <option value="shader">Shader transition</option>
              <option value="custom">Custom transition</option>
            </select>
          </label>
          <label>
            <span>Alpha</span>
            <select
              value={alpha}
              onChange={(event) => {
                setAlpha(event.target.value as typeof alpha);
              }}
            >
              <option value="opaque">Opaque</option>
              <option value="straight">Straight</option>
              <option value="premultiplied">Premultiplied</option>
            </select>
          </label>
          <label>
            <span>Audio envelope</span>
            <select
              value={audioEnvelope}
              onChange={(event) => {
                setAudioEnvelope(event.target.value as typeof audioEnvelope);
              }}
            >
              <option value="none">None</option>
              <option value="linear">Linear</option>
              <option value="equal-power">Equal power</option>
            </select>
          </label>
          <label>
            <span>Fallback</span>
            <select
              value={fallback ?? "none"}
              onChange={(event) => {
                setFallback(
                  event.target.value === "none" ? null : (event.target.value as "crossfade" | "bake"),
                );
              }}
            >
              <option value="crossfade">Shared crossfade</option>
              <option value="bake">Bake range</option>
              <option value="none">None (shared only)</option>
            </select>
          </label>
        </div>
        <div className="bridge-qa-strip">
          <span>Pre-roll 2f</span>
          <span>Post-roll 2f</span>
          <span>Blank/duplicate-frame check pending</span>
          <span>Alpha evidence pending compositor render</span>
        </div>
      </div>
      <footer>
        <Button
          variant="primary"
          disabled={pair === null || implementation !== "shared"}
          title={
            implementation === "shared"
              ? "Save the shared bridge with boundary QA pending."
              : "Shader and custom bridges require rendered boundary QA evidence before persistence."
          }
          onClick={save}
        >
          {implementation === "shared" ? "Save bridge · QA pending" : "Rendered QA required"}
        </Button>
        <span>{status}</span>
        <strong>{String(Object.keys(state.advancedBridges).length)} saved bridges</strong>
      </footer>
    </section>
  );
};

const adjacentPair = (
  timeline: TimelineSnapshotV1,
): Readonly<{ left: ClipSnapshot; right: ClipSnapshot }> | null => {
  for (const trackId of timeline.trackIds) {
    const clips = (timeline.tracks[trackId]?.clipIds ?? [])
      .map((id) => timeline.clips[id])
      .filter((clip): clip is ClipSnapshot => clip !== undefined)
      .sort((left, right) => (left.range.start < right.range.start ? -1 : 1));
    for (let index = 0; index < clips.length - 1; index += 1) {
      const left = clips[index];
      const right = clips[index + 1];
      if (left?.range.end === right?.range.start && left !== undefined && right !== undefined) {
        return { left, right };
      }
    }
  }
  return null;
};
