import {
  createPreviewFrameRange,
  framesForSecondStep,
  normalizePreviewRational,
  presentationTimestampForFrame,
  type PreviewFrameRange,
  type PreviewRational,
} from "./master-clock.js";
import { resolvePreviewQualityPolicy, type PreviewQuality, type PreviewTruthMode } from "./quality-policy.js";
import type { PreviewWarning } from "./preview-contract.js";
import type { PreviewTransportState } from "./transport-machine.js";

export type { PreviewQuality, PreviewTruthMode } from "./quality-policy.js";

export type PreviewEngine = "remotion" | "hyperframes";
export type PreviewTransport = PreviewTransportState;
export type PreviewAdapterStatus = "not-required" | "disconnected" | "ready" | "degraded" | "failed";

export interface PreviewAdapterDiagnostics {
  readonly engine: PreviewEngine;
  readonly required: boolean;
  readonly status: PreviewAdapterStatus;
  readonly adapterVersion: string | null;
  readonly processId: number | null;
  readonly lastHeartbeatAt: string | null;
  readonly loadedRevisionId: string | null;
  readonly loadedFrame: string | null;
  readonly preloadedRange: Readonly<{ startFrame: string; endFrame: string }> | null;
  readonly warning: string | null;
}

export interface PreviewSessionState {
  readonly schemaVersion: "1.0.0";
  readonly sessionId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly durationFrames: string;
  readonly currentFrame: string;
  readonly presentationTimestamp: PreviewRational;
  readonly timelineFps: PreviewRational;
  readonly playRate: PreviewRational;
  readonly loopRange: PreviewFrameRange | null;
  readonly inOutRange: PreviewFrameRange | null;
  readonly transport: PreviewTransport;
  readonly quality: PreviewQuality;
  readonly truthMode: PreviewTruthMode;
  readonly approximationWarningVisible: boolean;
  readonly fidelityEquivalent: boolean;
  readonly preload: Readonly<{ beforeFrames: number; afterFrames: number }>;
  readonly buffering: Readonly<{
    status: "idle" | "ready" | "waiting" | "back-pressure" | "error";
    waitingFor: readonly ("media" | "engine" | "render-fallback" | "audio")[];
    bufferedRange: PreviewFrameRange | null;
  }>;
  readonly adapters: Readonly<Record<PreviewEngine, PreviewAdapterDiagnostics>>;
  readonly warnings: readonly PreviewWarning[];
  readonly droppedFrames: number;
  readonly lastError: string | null;
  readonly stateVersion: number;
  readonly loadedAt: string;
  readonly updatedAt: string;
}

export type PreviewControl =
  | Readonly<{ kind: "play" }>
  | Readonly<{ kind: "pause" }>
  | Readonly<{ kind: "stop" }>
  | Readonly<{ kind: "seek"; frame: string }>
  | Readonly<{ kind: "step"; delta: number }>
  | Readonly<{ kind: "step-seconds"; seconds: number }>
  | Readonly<{ kind: "play-rate"; playRate: PreviewRational }>
  | Readonly<{ kind: "loop-range"; range: PreviewFrameRange | null }>
  | Readonly<{ kind: "in-out-range"; range: PreviewFrameRange | null }>
  | Readonly<{ kind: "quality"; quality: PreviewQuality; truthMode: PreviewTruthMode }>;

export const createPreviewSessionState = (input: {
  readonly sessionId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly durationFrames: string;
  readonly requiredEngines: readonly PreviewEngine[];
  readonly timelineFps?: PreviewRational;
  readonly now: string;
}): PreviewSessionState => {
  assertIdentifier(input.sessionId, "sessionId");
  assertIdentifier(input.projectId, "projectId");
  assertIdentifier(input.revisionId, "revisionId");
  assertIdentifier(input.timelineId, "timelineId");
  parseFrame(input.durationFrames, "durationFrames");
  assertTimestamp(input.now);
  const timelineFps = input.timelineFps ?? { numerator: "30", denominator: "1" };
  assertPositiveRate(timelineFps, "timelineFps");
  const qualityPolicy = resolvePreviewQualityPolicy({
    quality: "balanced",
    truthMode: "interactive-approximation",
  });
  const required = new Set(input.requiredEngines);
  return {
    schemaVersion: "1.0.0",
    sessionId: input.sessionId,
    projectId: input.projectId,
    revisionId: input.revisionId,
    timelineId: input.timelineId,
    durationFrames: input.durationFrames,
    currentFrame: "0",
    presentationTimestamp: { numerator: "0", denominator: "1" },
    timelineFps,
    playRate: { numerator: "1", denominator: "1" },
    loopRange: null,
    inOutRange: null,
    transport: "paused",
    quality: "balanced",
    truthMode: "interactive-approximation",
    approximationWarningVisible: true,
    fidelityEquivalent: false,
    preload: { beforeFrames: 12, afterFrames: 48 },
    buffering: { status: "idle", waitingFor: [], bufferedRange: null },
    adapters: {
      remotion: disconnectedDiagnostics("remotion", required.has("remotion")),
      hyperframes: disconnectedDiagnostics("hyperframes", required.has("hyperframes")),
    },
    warnings: qualityPolicy.warnings,
    droppedFrames: 0,
    lastError: null,
    stateVersion: 1,
    loadedAt: input.now,
    updatedAt: input.now,
  };
};

export const applyPreviewControl = (
  state: PreviewSessionState,
  control: PreviewControl,
  now: string,
): PreviewSessionState => {
  assertTimestamp(now);
  let next: PreviewSessionState;
  switch (control.kind) {
    case "play":
      if (parseFrame(state.durationFrames, "durationFrames") === 0n) {
        throw new Error("Cannot play an empty timeline.");
      }
      next = { ...state, transport: "playing" };
      break;
    case "pause":
      next = { ...state, transport: "paused" };
      break;
    case "stop":
      next = withFrame({ ...state, transport: "stopped" }, "0");
      break;
    case "seek":
      next = withFrame({ ...state, transport: "paused" }, boundedFrame(control.frame, state));
      break;
    case "step": {
      if (!Number.isSafeInteger(control.delta) || control.delta === 0 || Math.abs(control.delta) > 1_000) {
        throw new Error("Preview frame-step delta is outside bounded safe limits.");
      }
      const current = parseFrame(state.currentFrame, "currentFrame");
      const candidate = current + BigInt(control.delta);
      next = withFrame(
        { ...state, transport: "paused" },
        clampFrame(candidate, state.durationFrames).toString(10),
      );
      break;
    }
    case "step-seconds": {
      const current = parseFrame(state.currentFrame, "currentFrame");
      const candidate = current + framesForSecondStep(control.seconds, state.timelineFps);
      next = withFrame(
        { ...state, transport: "paused" },
        clampFrame(candidate, state.durationFrames).toString(10),
      );
      break;
    }
    case "play-rate": {
      const playRate = normalizePreviewRational(control.playRate.numerator, control.playRate.denominator);
      const numerator = BigInt(playRate.numerator);
      if (numerator === 0n || absolute(numerator) > 4n * BigInt(playRate.denominator)) {
        throw new Error("Preview play rate must be non-zero and within -4x to +4x.");
      }
      const audioWarning =
        playRate.numerator === playRate.denominator
          ? []
          : [
              {
                code: "audio-muted-for-rate" as const,
                severity: "info" as const,
                message: "Program audio is muted outside +1x playback.",
                layerId: null,
                remedy: { label: "Return to +1x", action: "preview.set-rate-1x" },
              },
            ];
      next = {
        ...state,
        playRate,
        warnings: [...state.warnings.filter((item) => item.code !== "audio-muted-for-rate"), ...audioWarning],
      };
      break;
    }
    case "loop-range":
      next = { ...state, loopRange: validateRange(control.range, state, "loopRange") };
      break;
    case "in-out-range":
      next = { ...state, inOutRange: validateRange(control.range, state, "inOutRange") };
      break;
    case "quality": {
      const qualityPolicy = resolvePreviewQualityPolicy({
        quality: control.quality,
        truthMode: control.truthMode,
      });
      next = {
        ...state,
        quality: qualityPolicy.quality,
        truthMode: control.truthMode,
        approximationWarningVisible: control.truthMode === "interactive-approximation",
        fidelityEquivalent: qualityPolicy.fidelityEquivalent,
        warnings: qualityPolicy.warnings,
      };
      break;
    }
  }
  return advance(next, now);
};

/**
 * Advances the authoritative program clock without changing the optimistic
 * control version. The version protects user commands; playback ticks are
 * continuously projected state and must not make a Pause click stale between
 * animation frames.
 */
export const advancePreviewPlayback = (
  state: PreviewSessionState,
  frameDelta: bigint,
  now: string,
): PreviewSessionState => {
  assertTimestamp(now);
  if (state.transport !== "playing" || frameDelta === 0n) return state;
  const duration = parseFrame(state.durationFrames, "durationFrames");
  if (duration === 0n) return { ...state, transport: "paused", updatedAt: now };
  const loopStart = BigInt(state.loopRange?.startFrame ?? "0");
  const loopEnd = BigInt(state.loopRange?.endFrameExclusive ?? state.durationFrames);
  let candidate = BigInt(state.currentFrame) + frameDelta;
  let transport: PreviewTransport = state.transport;
  if (frameDelta > 0n && candidate >= loopEnd) {
    if (state.loopRange === null) {
      candidate = duration - 1n;
      transport = "paused";
    } else {
      candidate = loopStart + ((candidate - loopStart) % (loopEnd - loopStart));
    }
  } else if (frameDelta < 0n && candidate < loopStart) {
    if (state.loopRange === null) {
      candidate = 0n;
      transport = "paused";
    } else {
      const length = loopEnd - loopStart;
      candidate = loopEnd - 1n - ((loopStart - 1n - candidate) % length);
    }
  }
  return {
    ...withFrame(state, candidate.toString(10)),
    transport,
    updatedAt: now,
  };
};

export const applyPreviewPreload = (
  state: PreviewSessionState,
  preload: Readonly<{ beforeFrames: number; afterFrames: number }>,
  now: string,
): PreviewSessionState => {
  assertPreload(preload.beforeFrames, "beforeFrames");
  assertPreload(preload.afterFrames, "afterFrames");
  return advance(
    {
      ...state,
      preload,
      buffering: {
        status: state.adapters.remotion.required || state.adapters.hyperframes.required ? "waiting" : "ready",
        waitingFor: state.adapters.remotion.required || state.adapters.hyperframes.required ? ["engine"] : [],
        bufferedRange: preloadRange(state, preload),
      },
    },
    now,
  );
};

export const updatePreviewAdapterDiagnostics = (
  state: PreviewSessionState,
  diagnostics: PreviewAdapterDiagnostics,
  now: string,
): PreviewSessionState => {
  if (diagnostics.required !== state.adapters[diagnostics.engine].required) {
    throw new Error("Preview adapter requirement cannot change inside a loaded session.");
  }
  const adapters = { ...state.adapters, [diagnostics.engine]: diagnostics };
  const requiredAdapters = Object.values(adapters).filter((adapter) => adapter.required);
  const ready = requiredAdapters.every(
    (adapter) => adapter.status === "ready" || adapter.status === "degraded",
  );
  const failed = requiredAdapters.some((adapter) => adapter.status === "failed");
  return advance(
    {
      ...state,
      adapters,
      buffering: {
        ...state.buffering,
        status: failed ? "error" : ready ? "ready" : "waiting",
        waitingFor: failed || !ready ? ["engine"] : [],
      },
    },
    now,
  );
};

const disconnectedDiagnostics = (engine: PreviewEngine, required: boolean): PreviewAdapterDiagnostics => ({
  engine,
  required,
  status: required ? "disconnected" : "not-required",
  adapterVersion: null,
  processId: null,
  lastHeartbeatAt: null,
  loadedRevisionId: null,
  loadedFrame: null,
  preloadedRange: null,
  warning: required ? "Native adapter worker is not connected." : null,
});

const boundedFrame = (value: string, state: PreviewSessionState): string => {
  const frame = parseFrame(value, "frame");
  const duration = parseFrame(state.durationFrames, "durationFrames");
  if (duration === 0n && frame === 0n) return value;
  if (duration === 0n || frame >= duration) throw new Error("Preview seek frame is outside the timeline.");
  return value;
};

const withFrame = (state: PreviewSessionState, frame: string): PreviewSessionState => ({
  ...state,
  currentFrame: frame,
  presentationTimestamp: presentationTimestampForFrame(frame, state.timelineFps),
});

const validateRange = (
  range: PreviewFrameRange | null,
  state: PreviewSessionState,
  field: string,
): PreviewFrameRange | null => {
  if (range === null) return null;
  const normalized = createPreviewFrameRange(range.startFrame, range.endFrameExclusive);
  if (BigInt(normalized.endFrameExclusive) > BigInt(state.durationFrames)) {
    throw new Error(`Preview ${field} is outside the timeline.`);
  }
  return normalized;
};

const preloadRange = (
  state: PreviewSessionState,
  preload: Readonly<{ beforeFrames: number; afterFrames: number }>,
): PreviewFrameRange | null => {
  const duration = BigInt(state.durationFrames);
  if (duration === 0n) return null;
  const frame = BigInt(state.currentFrame);
  const start = frame - BigInt(preload.beforeFrames) < 0n ? 0n : frame - BigInt(preload.beforeFrames);
  const end = frame + BigInt(preload.afterFrames) + 1n;
  return createPreviewFrameRange(start, end > duration ? duration : end);
};

const clampFrame = (value: bigint, durationValue: string): bigint => {
  const duration = parseFrame(durationValue, "durationFrames");
  if (duration === 0n || value < 0n) return 0n;
  return value >= duration ? duration - 1n : value;
};

const parseFrame = (value: string, field: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error(`Preview ${field} is invalid.`);
  return BigInt(value);
};

const assertIdentifier = (value: string, field: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`Preview ${field} is invalid.`);
};

const assertTimestamp = (value: string): void => {
  if (Number.isNaN(Date.parse(value))) throw new Error("Preview state timestamp is invalid.");
};

const assertPreload = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 600) {
    throw new Error(`Preview preload ${field} is outside bounded safe limits.`);
  }
};

const assertPositiveRate = (value: PreviewRational, field: string): void => {
  const normalized = normalizePreviewRational(value.numerator, value.denominator);
  if (BigInt(normalized.numerator) <= 0n) throw new Error(`Preview ${field} must be positive.`);
  if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) {
    throw new Error(`Preview ${field} must be normalized.`);
  }
};

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);

const advance = (state: PreviewSessionState, now: string): PreviewSessionState => ({
  ...state,
  stateVersion: state.stateVersion + 1,
  updatedAt: now,
});
