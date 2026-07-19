import { useEffect, useMemo, useState } from "react";
import { Badge, Button } from "@chai-studio/ui-components";
import {
  curveTangentsForPreset,
  masterFrame,
  sampleKeyframeCurve,
  stableEntityId,
  type CurvePreset,
  type TimelineEditCommand,
  type TimelineSnapshotV1,
} from "@chai-studio/timeline/browser";
import { ChaiIcon } from "./chai-icon.js";

interface KeyframeCurveEditorProps {
  readonly timeline: TimelineSnapshotV1;
  readonly currentFrame: string;
  readonly onCommand: (command: TimelineEditCommand) => void;
  readonly onSeek: (frame: string) => void;
  readonly propertyPath: string;
  readonly onPropertyChange: (propertyPath: string) => void;
}

type ClipboardKey = Readonly<{
  frame: bigint;
  value: number | string | boolean | readonly number[];
  interpolation: CurvePreset;
}>;

export const KeyframeCurveEditor = ({
  currentFrame,
  onCommand,
  onSeek,
  timeline,
  propertyPath,
  onPropertyChange,
}: KeyframeCurveEditorProps) => {
  const clipId = timeline.selection.selectedIds.find((id) => timeline.clips[id] !== undefined) ?? null;
  const clip = clipId === null ? undefined : timeline.clips[clipId];
  const lanes = Object.values(timeline.automation).filter((lane) => lane.ownerEntityId === clipId);
  const [selectedProperties, setSelectedProperties] = useState<readonly string[]>([propertyPath]);
  const [graphMode, setGraphMode] = useState<"value" | "speed">("value");
  const [graphZoom, setGraphZoom] = useState(1);
  const [clipboard, setClipboard] = useState<readonly ClipboardKey[]>([]);
  const lane = lanes.find((item) => item.propertyPath === propertyPath) ?? null;
  const keys = useMemo(
    () =>
      Object.values(timeline.keyframes)
        .filter((key) => key.ownerEntityId === clipId && key.propertyPath === propertyPath)
        .sort((left, right) =>
          left.frame < right.frame
            ? -1
            : left.frame > right.frame
              ? 1
              : left.id.localeCompare(right.id, "en"),
        ),
    [clipId, propertyPath, timeline.keyframes],
  );
  const numericKeys = keys.filter(
    (key): key is typeof key & { readonly value: number } => typeof key.value === "number",
  );
  const multiKeys = Object.values(timeline.keyframes).filter(
    (key) => key.ownerEntityId === clipId && selectedProperties.includes(key.propertyPath),
  );
  const samples = numericKeys
    .slice(0, -1)
    .flatMap((key, index) => {
      const next = numericKeys[index + 1];
      return next === undefined ? [] : sampleKeyframeCurve(key, next, 20);
    })
    .filter(
      (sample): sample is typeof sample & { readonly value: number } => typeof sample.value === "number",
    );
  const graphSamples = samples.flatMap((sample) => {
    const value = graphMode === "value" ? sample.value : sample.speed;
    return typeof value === "number" ? [{ frame: sample.frame, value }] : [];
  });
  const bounds = curveBounds(graphSamples, numericKeys);
  const path = graphSamples
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"}${String(pointX(sample.frame, bounds))} ${String(pointY(sample.value, bounds))}`,
    )
    .join(" ");
  const current = BigInt(currentFrame);
  const exact = keys.find((key) => key.frame === current);
  const property = clip?.properties?.[propertyPath];
  const propertyOptions = Object.entries(clip?.properties ?? {}).filter(([, state]) => state.keyframeable);
  const validFrame = clip !== undefined && current >= clip.range.start && current < clip.range.end;
  const [valueDraft, setValueDraft] = useState(() => String(property?.value ?? ""));
  const [valueError, setValueError] = useState<string | null>(null);
  const interpolation = useMemo(() => {
    const values = new Set(keys.map((key) => key.interpolation));
    return values.size === 0 ? "linear" : values.size === 1 ? (keys[0]?.interpolation ?? "linear") : "mixed";
  }, [keys]);
  const tangentMode = useMemo(() => tangentModeForKeys(exact === undefined ? keys : [exact]), [exact, keys]);

  useEffect(() => {
    setSelectedProperties([propertyPath]);
    setValueDraft(String(exact?.value ?? property?.value ?? ""));
    setValueError(null);
  }, [exact?.value, property?.value, propertyPath]);

  const updateInterpolation = (preset: CurvePreset): void => {
    const tangents =
      preset === "hold" || preset === "linear"
        ? { outTangent: null, inTangent: null }
        : preset === "bezier"
          ? { outTangent: [0.33, 0.33] as const, inTangent: [0.67, 0.67] as const }
          : (() => {
              const value = curveTangentsForPreset(preset);
              return { outTangent: value.out, inTangent: value.in };
            })();
    onCommand({
      kind: "keyframes.update",
      updates: keys.map((key) => ({ keyframeId: key.id, changes: { interpolation: preset, ...tangents } })),
    });
  };
  const addAtCurrent = (): void => {
    if (clipId === null || property === undefined) return;
    const parsed = parseKeyValue(valueDraft, property.value);
    if (!parsed.ok) {
      setValueError(parsed.message);
      return;
    }
    onCommand({
      kind: "keyframe.add",
      keyframe: {
        id: stableEntityId(`keyframe-ui-${crypto.randomUUID()}`),
        ownerEntityId: clipId,
        propertyPath,
        frame: masterFrame(current),
        value: parsed.value,
        interpolation: "linear",
        inTangent: null,
        outTangent: null,
        authority: "shared",
        preserveNativeAnimation: false,
      },
      automationLaneId: lane?.id ?? null,
    });
  };
  const seekRelative = (direction: -1 | 1): void => {
    const candidates = direction < 0 ? [...keys].reverse() : keys;
    const target = candidates.find((key) => (direction < 0 ? key.frame < current : key.frame > current));
    if (target !== undefined) onSeek(String(target.frame));
  };

  return (
    <div className="curve-editor keyframe-curve-editor" aria-label="Deterministic keyframe curve editor">
      <div className="lower-title">
        <strong>
          {clip === undefined
            ? "Select one animation owner"
            : `${clip.name} · ${String(clip.range.start)}–${String(clip.range.end)} (end exclusive)`}
        </strong>
        <select
          aria-label="Animated property"
          value={propertyPath}
          onChange={(event) => {
            onPropertyChange(event.target.value);
            setSelectedProperties([event.target.value]);
          }}
        >
          {propertyOptions.length === 0 ? (
            <option value={propertyPath}>{propertyPath}</option>
          ) : (
            propertyOptions.map(([path]) => (
              <option value={path} key={path}>
                {path}
              </option>
            ))
          )}
        </select>
        <Badge tone={keys.length > 0 ? "ready" : "attention"}>{String(keys.length)} keys</Badge>
        <span />
        <Button
          aria-label="Previous keyframe"
          onClick={() => {
            seekRelative(-1);
          }}
        >
          <ChaiIcon name="previous-key" size={14} /> Key
        </Button>
        <Button
          aria-label="Next keyframe"
          onClick={() => {
            seekRelative(1);
          }}
        >
          Key <ChaiIcon name="next-key" size={14} />
        </Button>
        <Button
          variant="primary"
          disabled={property === undefined || !validFrame}
          onClick={() => {
            if (exact === undefined) addAtCurrent();
            else onCommand({ kind: "keyframes.remove", keyframeIds: [exact.id] });
          }}
        >
          <ChaiIcon name={exact === undefined ? "key-add" : "key-remove"} size={14} />
          {exact === undefined ? "Add key" : "Remove key"}
        </Button>
        {clip === undefined || validFrame ? null : (
          <Button
            onClick={() => {
              onSeek(clip.range.start.toString(10));
            }}
          >
            Go to clip
          </Button>
        )}
      </div>
      <div className="curve-tools">
        <label className="curve-value-control">
          <span>Key value</span>
          <input
            aria-label="Keyframe value"
            value={valueDraft}
            onChange={(event) => {
              setValueDraft(event.currentTarget.value);
              setValueError(null);
            }}
            onBlur={() => {
              if (exact === undefined || property === undefined) return;
              const parsed = parseKeyValue(valueDraft, property.value);
              if (!parsed.ok) {
                setValueError(parsed.message);
                return;
              }
              onCommand({
                kind: "keyframes.update",
                updates: [
                  {
                    keyframeId: exact.id,
                    changes: { value: parsed.value },
                  },
                ],
              });
              setValueError(null);
            }}
            aria-invalid={valueError !== null}
            aria-describedby={valueError === null ? undefined : "keyframe-value-error"}
          />
          {valueError === null ? null : (
            <small id="keyframe-value-error" role="alert">
              {valueError}
            </small>
          )}
        </label>
        <label className="curve-multi-property">
          <span>Properties</span>
          <select
            multiple
            aria-label="Multi-property curve selection"
            value={selectedProperties}
            onChange={(event) => {
              const values = [...event.currentTarget.selectedOptions].map((option) => option.value);
              setSelectedProperties(values.length === 0 ? [propertyPath] : values);
            }}
          >
            {propertyOptions.map(([path]) => (
              <option value={path} key={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Curve graph mode"
          value={graphMode}
          onChange={(event) => {
            setGraphMode(event.target.value as "value" | "speed");
          }}
        >
          <option value="value">Value graph</option>
          <option value="speed">Speed graph</option>
        </select>
        <select
          aria-label="Tangent mode"
          value={tangentMode}
          disabled={multiKeys.length === 0}
          onChange={(event) => {
            const mode = event.target.value as typeof tangentMode;
            const tangent =
              mode === "flat"
                ? { inTangent: [0.67, 0] as const, outTangent: [0.33, 0] as const }
                : mode === "broken"
                  ? { inTangent: [0.75, 0.9] as const, outTangent: [0.25, 0.1] as const }
                  : mode === "continuous"
                    ? { inTangent: [0.67, 0.67] as const, outTangent: [0.33, 0.33] as const }
                    : curveTangentsForPreset("ease-in-out");
            onCommand({
              kind: "keyframes.update",
              updates: multiKeys.map((key) => ({
                keyframeId: key.id,
                changes: {
                  interpolation: "bezier",
                  inTangent: "in" in tangent ? tangent.in : tangent.inTangent,
                  outTangent: "out" in tangent ? tangent.out : tangent.outTangent,
                },
              })),
            });
          }}
        >
          <option value="auto">Auto tangents</option>
          <option value="continuous">Continuous</option>
          <option value="broken">Broken</option>
          <option value="flat">Flat</option>
        </select>
        <select
          aria-label="Interpolation"
          value={interpolation}
          disabled={keys.length === 0}
          onChange={(event) => {
            updateInterpolation(event.target.value as CurvePreset);
          }}
        >
          {interpolation === "mixed" ? <option value="mixed">mixed</option> : null}
          {(["linear", "hold", "ease", "ease-in", "ease-out", "ease-in-out", "bezier"] as const).map(
            (item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ),
          )}
        </select>
        <Button
          disabled={keys.length === 0}
          onClick={() => {
            setClipboard(
              keys.map((key) => ({
                frame: key.frame,
                value: key.value,
                interpolation: key.interpolation as CurvePreset,
              })),
            );
          }}
        >
          Copy
        </Button>
        <Button
          disabled={clipboard.length === 0 || clipId === null}
          onClick={() => {
            if (clipId === null || clipboard.length === 0) return;
            const origin = clipboard[0]?.frame ?? 0n;
            const clip = timeline.clips[clipId];
            if (clip === undefined) return;
            const last = clipboard.at(-1)?.frame ?? origin;
            const span = last - origin;
            const latestStart = clip.range.end - 1n - span;
            const pasteStart =
              current < clip.range.start ? clip.range.start : current > latestStart ? latestStart : current;
            onCommand({
              kind: "keyframes.add",
              entries: clipboard.map((key) => ({
                keyframe: {
                  id: stableEntityId(`keyframe-ui-${crypto.randomUUID()}`),
                  ownerEntityId: clipId,
                  propertyPath,
                  frame: masterFrame(pasteStart + key.frame - origin),
                  value: key.value,
                  interpolation: key.interpolation,
                  inTangent: null,
                  outTangent: null,
                  authority: "shared",
                  preserveNativeAnimation: false,
                },
                automationLaneId: lane?.id ?? null,
              })),
            });
          }}
        >
          Paste
        </Button>
        <Button
          disabled={multiKeys.length < 2}
          onClick={() => {
            const numeric = multiKeys.filter(
              (key): key is typeof key & { readonly value: number } => typeof key.value === "number",
            );
            if (numeric.length < 2) return;
            const average = numeric.reduce((sum, key) => sum + key.value, 0) / numeric.length;
            onCommand({
              kind: "keyframes.update",
              updates: numeric.map((key) => ({ keyframeId: key.id, changes: { value: average } })),
            });
          }}
        >
          Align values
        </Button>
        <Button
          disabled={multiKeys.length < 3}
          onClick={() => {
            const ordered = [...multiKeys].sort((left, right) =>
              left.frame < right.frame ? -1 : left.frame > right.frame ? 1 : left.id.localeCompare(right.id),
            );
            const first = ordered[0];
            const last = ordered.at(-1);
            if (first === undefined || last === undefined) return;
            const span = last.frame - first.frame;
            onCommand({
              kind: "keyframes.update",
              updates: ordered.map((key, index) => ({
                keyframeId: key.id,
                changes: {
                  frame: masterFrame(first.frame + (span * BigInt(index)) / BigInt(ordered.length - 1)),
                },
              })),
            });
          }}
        >
          Distribute time
        </Button>
        <Button
          disabled={keys.length < 2}
          onClick={() => {
            const origin = keys[0]?.frame ?? 0n;
            onCommand({
              kind: "keyframes.update",
              updates: keys.map((key) => ({
                keyframeId: key.id,
                changes: { frame: masterFrame(origin + ((key.frame - origin) * 9n) / 10n) },
              })),
            });
          }}
        >
          Retime 90%
        </Button>
        <label className="curve-zoom-control">
          <span>Zoom {Math.round(graphZoom * 100)}%</span>
          <input
            aria-label="Curve graph zoom"
            type="range"
            min="1"
            max="4"
            step="0.25"
            value={graphZoom}
            onChange={(event) => {
              setGraphZoom(Number(event.target.value));
            }}
          />
        </label>
      </div>
      <svg
        viewBox={`0 0 ${String(900 / graphZoom)} 210`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={`${propertyPath} exact ${graphMode} curve`}
      >
        <defs>
          <pattern id="keyframe-grid" width="90" height="42" patternUnits="userSpaceOnUse">
            <path d="M90 0L0 0 0 42" fill="none" stroke="#26364a" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="900" height="210" fill="url(#keyframe-grid)" />
        {path === "" ? (
          <text x="450" y="106" textAnchor="middle" fill="#607287">
            Add two numeric keyframes to draw a curve
          </text>
        ) : (
          <path d={path} fill="none" stroke="#8d87ff" strokeWidth="3" />
        )}
        {numericKeys.map((key) => (
          <g key={key.id}>
            <circle
              cx={pointX(key.frame, bounds)}
              cy={pointY(key.value, bounds)}
              r="6"
              fill="#edf4fb"
              stroke="#746dff"
              strokeWidth="3"
            />
            <text x={pointX(key.frame, bounds) + 9} y={pointY(key.value, bounds) - 8} fill="#8fa1b6">
              {String(key.frame)}f
            </text>
          </g>
        ))}
      </svg>
      <div className="curve-readout">
        <span>{graphMode === "value" ? "Value graph" : "Speed graph"}</span>
        <span>{selectedProperties.length} properties selected</span>
        <span>{tangentMode} tangents</span>
        <span>Exact integer master frames</span>
        <span>Deterministic cubic evaluation</span>
        <span>Current {currentFrame}f</span>
      </div>
    </div>
  );
};

const curveBounds = (
  samples: readonly { readonly frame: bigint; readonly value: number }[],
  keys: readonly { readonly frame: bigint; readonly value: number }[],
) => {
  const source = samples.length > 0 ? samples : keys;
  const frames = source.map((item) => item.frame);
  const values = source.map((item) => item.value);
  return {
    minFrame: frames[0] ?? 0n,
    maxFrame: frames.at(-1) ?? 1n,
    minValue: Math.min(...values, 0),
    maxValue: Math.max(...values, 1),
  };
};

const parseKeyValue = (
  draft: string,
  fallback: number | string | boolean | readonly number[],
):
  | Readonly<{ ok: true; value: number | string | boolean | readonly number[] }>
  | Readonly<{ ok: false; message: string }> => {
  const value = draft.trim();
  if (typeof fallback === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, message: "Enter a finite numeric keyframe value." };
  }
  if (typeof fallback === "boolean") {
    return value === "true" || value === "false"
      ? { ok: true, value: value === "true" }
      : { ok: false, message: "Enter true or false for this keyframe." };
  }
  if (typeof fallback === "object") {
    const parsed = value.split(",").map((item) => Number(item.trim()));
    return parsed.length === fallback.length && parsed.every((item) => Number.isFinite(item))
      ? { ok: true, value: parsed }
      : { ok: false, message: `Enter ${String(fallback.length)} comma-separated finite numbers.` };
  }
  return value === "" ? { ok: false, message: "Keyframe text cannot be empty." } : { ok: true, value };
};

const tangentModeForKeys = (
  keys: readonly Readonly<{
    inTangent: readonly [number, number] | null;
    outTangent: readonly [number, number] | null;
  }>[],
): "auto" | "continuous" | "broken" | "flat" => {
  if (keys.length === 0 || keys.every((key) => key.inTangent === null && key.outTangent === null))
    return "auto";
  if (keys.every((key) => (key.inTangent?.[1] ?? 0) === 0 && (key.outTangent?.[1] ?? 0) === 0)) return "flat";
  if (
    keys.every(
      (key) =>
        key.inTangent !== null &&
        key.outTangent !== null &&
        Math.abs(key.inTangent[1] - key.outTangent[1]) < 0.0001,
    )
  )
    return "continuous";
  return "broken";
};
const pointX = (frame: bigint, bounds: ReturnType<typeof curveBounds>): number =>
  28 + (Number(frame - bounds.minFrame) / Math.max(1, Number(bounds.maxFrame - bounds.minFrame))) * 844;
const pointY = (value: number, bounds: ReturnType<typeof curveBounds>): number =>
  186 - ((value - bounds.minValue) / Math.max(0.0001, bounds.maxValue - bounds.minValue)) * 160;
