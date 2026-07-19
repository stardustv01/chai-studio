import { useMemo, useState } from "react";
import {
  createAudioInspectorDescriptor,
  evaluateAudioGraphAtFrame,
  type AudioGraphCommand,
  type AudioGraphDocument,
} from "@chai-studio/audio";
import { Badge, Button } from "@chai-studio/ui-components";
import { ChaiIcon } from "./chai-icon.js";

export const AudioMixerPanel = ({
  currentFrame,
  graph,
  onCommand,
}: {
  readonly currentFrame: string;
  readonly graph: AudioGraphDocument;
  readonly onCommand: (command: AudioGraphCommand) => void;
}) => {
  const [selectedId, setSelectedId] = useState(graph.clips[0]?.id ?? graph.masterBusId);
  const selectedClip = graph.clips.find((clip) => clip.id === selectedId) ?? graph.clips[0];
  const frame = BigInt(currentFrame);
  const evaluated = useMemo(() => evaluateAudioGraphAtFrame(graph, frame), [frame, graph]);
  const descriptor = createAudioInspectorDescriptor(graph, selectedId);
  const duckingRule = graph.duckingRules[0];
  const crossfade = graph.crossfades[0];
  const sequenceEndFrame = graph.clips.reduce(
    (latest, clip) => (BigInt(clip.endFrameExclusive) > latest ? BigInt(clip.endFrameExclusive) : latest),
    0n,
  );
  return (
    <section className="audio-mixer" aria-label="Authoritative audio mixer">
      <header className="audio-mixer__header">
        <div>
          <span className="eyebrow">Program audio authority</span>
          <strong>48 kHz timeline mix</strong>
          <small>Scheduler follower · native engine audio suppressed</small>
        </div>
        <div className="audio-truth-badges">
          <Badge tone="ready">Frame/sample mapping</Badge>
          <Badge tone="info">Graph preview</Badge>
          <Badge tone="attention">Signal meters unavailable</Badge>
        </div>
      </header>

      <div className="audio-workbench">
        <div className="audio-lanes" aria-label="Audio waveform and automation lanes">
          <div className="audio-lanes__ruler">
            <span>Frame 0</span>
            <span>Frame {currentFrame}</span>
            <span>End {sequenceEndFrame.toString(10)}f</span>
          </div>
          {graph.clips.map((clip, index) => {
            const active = clip.id === selectedId;
            const source = graph.sources.find((item) => item.id === clip.sourceId);
            return (
              <button
                className={active ? "audio-lane audio-lane--active" : "audio-lane"}
                type="button"
                onClick={() => {
                  setSelectedId(clip.id);
                }}
                key={clip.id}
              >
                <span className="audio-lane__label">
                  <strong>{source?.originalPath.split("/").at(-1) ?? clip.id}</strong>
                  <small>{graph.buses.find((bus) => bus.id === clip.busId)?.name}</small>
                </span>
                <span className={`audio-waveform audio-waveform--${String(index + 1)}`} aria-hidden="true">
                  <i className="fade-handle fade-handle--in" />
                  <i className="fade-handle fade-handle--out" />
                  {clip.automationLaneIds.length > 0 ? (
                    <>
                      <b className="automation-line" />
                      <em className="automation-point automation-point--one" />
                      <em className="automation-point automation-point--two" />
                    </>
                  ) : null}
                  {clip.syncAnchorIds.length > 0 ? <mark className="sync-anchor">SYNC</mark> : null}
                </span>
                <span className="audio-lane__value">{clip.gainDb.toFixed(1)} dB</span>
              </button>
            );
          })}
          <div className="audio-automation-summary">
            <span>
              <ChaiIcon name="keyframe" size={14} /> Volume automation
            </span>
            <span>
              <ChaiIcon name="crossfade" size={14} /> Equal-power fades
            </span>
            <span>
              <ChaiIcon name="sync-anchor" size={16} /> 1 sync anchor · ±1 sample
            </span>
          </div>
        </div>

        <aside className="audio-clip-inspector" aria-label="Audio inspector">
          <div className="audio-inspector-title">
            <div>
              <span className="eyebrow">{descriptor.context}</span>
              <strong>{selectedClip?.id ?? selectedId}</strong>
            </div>
            <Badge tone="ready">Shared</Badge>
          </div>
          {selectedClip === undefined ? null : (
            <>
              <AudioNumberField
                label="Gain"
                value={selectedClip.gainDb}
                minimum={-60}
                maximum={12}
                suffix="dB"
                onCommit={(gainDb) => {
                  onCommand({ kind: "audio.clip.update", clipId: selectedClip.id, patch: { gainDb } });
                }}
              />
              <AudioNumberField
                label="Pan"
                value={selectedClip.pan}
                minimum={-1}
                maximum={1}
                suffix=""
                onCommit={(pan) => {
                  onCommand({ kind: "audio.clip.update", clipId: selectedClip.id, patch: { pan } });
                }}
              />
              <div className="audio-inspector-grid">
                <span>
                  Fade in<strong>{selectedClip.fadeInFrames}f</strong>
                </span>
                <span>
                  Fade out<strong>{selectedClip.fadeOutFrames}f</strong>
                </span>
                <span>
                  Curve<strong>Equal power</strong>
                </span>
                <span>
                  Map<strong>{selectedClip.channelMapId.includes("mono") ? "1 → 2" : "2 → 2"}</strong>
                </span>
              </div>
            </>
          )}
          <div className="audio-inspector-actions">
            <Button
              disabled
              title="Automatic ducking requires analysed trigger-bus signal windows; no signal analyser is connected in this view."
            >
              Ducking analysis unavailable
            </Button>
            <Button
              disabled={selectedClip === undefined}
              onClick={() => {
                if (selectedClip === undefined) return;
                onCommand({
                  kind: "audio.sync-anchor.upsert",
                  clipId: selectedClip.id,
                  anchor: {
                    id: `audio-sync-${crypto.randomUUID()}`,
                    label: "Manual sync",
                    frame: currentFrame as (typeof graph.syncAnchors)[number]["frame"],
                    sourceSample: selectedClip.sourceStartSample,
                    toleranceSamples: "1" as (typeof graph.syncAnchors)[number]["toleranceSamples"],
                  },
                });
              }}
            >
              <ChaiIcon name="sync-anchor" size={16} /> Add sync anchor
            </Button>
            <Button
              disabled={crossfade === undefined}
              onClick={() => {
                if (crossfade === undefined) return;
                onCommand({
                  kind: "audio.crossfade.upsert",
                  crossfade: {
                    ...crossfade,
                    curve: crossfade.curve === "linear" ? "equal-power" : "linear",
                  },
                });
              }}
            >
              <ChaiIcon name="crossfade" size={14} /> Crossfade {crossfade?.curve ?? "unavailable"}
            </Button>
            <Button
              disabled={duckingRule === undefined}
              onClick={() => {
                if (duckingRule === undefined) return;
                onCommand({
                  kind: "audio.ducking.upsert",
                  rule: { ...duckingRule, reductionDb: duckingRule.reductionDb === -8 ? -12 : -8 },
                });
              }}
            >
              <ChaiIcon name="ducking" size={16} /> Duck {duckingRule?.reductionDb ?? 0} dB
            </Button>
            <Button
              onClick={() => {
                const bus = graph.buses.find((item) => item.id === graph.masterBusId);
                if (bus === undefined) return;
                onCommand({
                  kind: "audio.automation.upsert",
                  lane: {
                    id: `audio-bus-lane-${crypto.randomUUID()}`,
                    targetKind: "bus",
                    targetId: bus.id,
                    property: "gainDb",
                    keyframes: [
                      {
                        id: `audio-bus-key-${crypto.randomUUID()}`,
                        frame:
                          currentFrame as (typeof graph.automationLanes)[number]["keyframes"][number]["frame"],
                        value: bus.gainDb,
                        interpolation: "linear",
                      },
                    ],
                  },
                });
              }}
            >
              <ChaiIcon name="key-add" size={14} /> Key master bus
            </Button>
            <Button disabled title="Loudness normalization planning is not implemented in this build.">
              Normalization unavailable
            </Button>
          </div>
          <p className="audio-authority-note">
            Edits create one atomic <code>audio.edit</code> revision. Preview and final mix read this same
            graph.
          </p>
        </aside>
      </div>

      <div className="mixer-channels" aria-label="Audio bus meters">
        {graph.buses.map((bus) => {
          const state = evaluated.buses.find((item) => item.busId === bus.id);
          return (
            <div
              className={bus.kind === "master" ? "mixer-strip mixer-strip--master" : "mixer-strip"}
              key={bus.id}
            >
              <strong>{bus.name}</strong>
              <small>{bus.kind}</small>
              <div className="stereo-meter" aria-label={`${bus.name} signal meter unavailable`}>
                <i style={{ height: "0%" }} />
                <i style={{ height: "0%" }} />
                <span>—</span>
              </div>
              <input
                aria-label={`${bus.name} gain`}
                type="range"
                min="-60"
                max="12"
                step="0.5"
                value={bus.gainDb}
                onChange={(event) => {
                  onCommand({
                    kind: "audio.bus.update",
                    busId: bus.id,
                    patch: { gainDb: Number(event.currentTarget.value) },
                  });
                }}
              />
              <span className="mixer-strip__gain">{bus.gainDb.toFixed(1)} dB</span>
              <div className="mixer-strip__buttons">
                <button
                  className={bus.muted ? "active" : ""}
                  type="button"
                  aria-pressed={bus.muted}
                  onClick={() => {
                    onCommand({ kind: "audio.bus.update", busId: bus.id, patch: { muted: !bus.muted } });
                  }}
                >
                  M
                </button>
                <button
                  className={bus.solo ? "active" : ""}
                  type="button"
                  aria-pressed={bus.solo}
                  onClick={() => {
                    onCommand({ kind: "audio.bus.update", busId: bus.id, patch: { solo: !bus.solo } });
                  }}
                >
                  S
                </button>
              </div>
              <span className={state?.audible === false ? "bus-state bus-state--muted" : "bus-state"}>
                {state?.audible === false ? "Muted" : "Graph active"}
              </span>
            </div>
          );
        })}
      </div>
      <footer className="audio-mixer__footer">
        <span>Preview LUFS unavailable</span>
        <span>True peak measured after render</span>
        <span>Clipping measured after render</span>
        <span>
          Output {graph.sampleRate / 1_000} kHz · {graph.channelLayout}
        </span>
        <span>{evaluated.buses.length} graph-evaluated buses</span>
      </footer>
    </section>
  );
};

const AudioNumberField = ({
  label,
  maximum,
  minimum,
  onCommit,
  suffix,
  value,
}: {
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onCommit: (value: number) => void;
  readonly suffix: string;
  readonly value: number;
}) => (
  <label className="audio-number-field">
    <span>{label}</span>
    <input
      type="number"
      min={minimum}
      max={maximum}
      step="0.1"
      value={value}
      onChange={(event) => {
        onCommit(Number(event.currentTarget.value));
      }}
    />
    <small>{suffix}</small>
  </label>
);
