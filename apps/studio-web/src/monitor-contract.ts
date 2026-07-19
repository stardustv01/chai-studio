import type { PreviewTruth } from "./types.js";

export type MonitorFitMode = "fit" | "fill";
export type MonitorCaptureMode =
  | "interactive-frame"
  | "exact-fidelity"
  | "isolated-clip"
  | "before-effects"
  | "alpha"
  | "comparison"
  | "range"
  | "contact-sheet";
export type MonitorComparisonMode = "split" | "wipe" | "onion" | "difference";

export interface MonitorViewportInput {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly fitMode: MonitorFitMode;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly devicePixelRatio: number;
}

export interface MonitorViewportGeometry {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly bars: "none" | "letterbox" | "pillarbox";
  readonly devicePixelRatio: number;
}

export interface MonitorMappedPoint {
  readonly inside: boolean;
  readonly normalizedX: number;
  readonly normalizedY: number;
  readonly sourceX: number;
  readonly sourceY: number;
}

export interface MonitorTruthPresentation {
  readonly fidelityLabel: "Interactive approximation" | "Rendered fidelity";
  readonly sourceLabel: "Original media" | "Proxy media";
  readonly engineLabel: "Native" | "Mixed engines" | "Baked fallback";
  readonly buffering: boolean;
  readonly droppedFrameLabel: string | null;
  readonly warnings: readonly Readonly<{
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
  }>[];
}

export type ProgramMonitorCommand =
  | Readonly<{ kind: "toggle-play" }>
  | Readonly<{ kind: "pause" }>
  | Readonly<{ kind: "step-frame"; delta: -1 | 1 }>
  | Readonly<{ kind: "step-second"; seconds: -1 | 1 }>
  | Readonly<{ kind: "seek-start" }>
  | Readonly<{ kind: "seek-end" }>
  | Readonly<{ kind: "seek-frame"; frame: string }>
  | Readonly<{ kind: "mark-in" }>
  | Readonly<{ kind: "mark-out" }>
  | Readonly<{ kind: "toggle-loop" }>
  | Readonly<{ kind: "set-rate"; numerator: -4 | -2 | -1 | 1 | 2 | 4 }>
  | Readonly<{ kind: "shuttle"; direction: "backward" | "pause" | "forward" }>;

export const monitorTruthPresentation = (preview: PreviewTruth): MonitorTruthPresentation => ({
  fidelityLabel: preview.mode === "rendered-fidelity" ? "Rendered fidelity" : "Interactive approximation",
  sourceLabel: preview.source === "original" ? "Original media" : "Proxy media",
  engineLabel:
    preview.engineState === "native"
      ? "Native"
      : preview.engineState === "mixed"
        ? "Mixed engines"
        : "Baked fallback",
  buffering: preview.bufferingStatus === "waiting" || preview.playback === "buffering",
  droppedFrameLabel: preview.droppedFrames > 0 ? `${String(preview.droppedFrames)} dropped` : null,
  warnings:
    preview.mode === "interactive" && preview.warnings.length === 0
      ? [
          {
            code: "interactive",
            severity: "warning",
            message: "Interactive approximation is not final truth.",
          },
        ]
      : preview.warnings,
});

export interface PreviewControlRequest {
  readonly endpoint:
    "transport" | "seek" | "step" | "step-seconds" | "play-rate" | "loop-range" | "in-out-range";
  readonly body: Readonly<Record<string, unknown>>;
}

export const calculateMonitorViewport = (input: MonitorViewportInput): MonitorViewportGeometry => {
  for (const [field, value] of Object.entries(input)) {
    if (field === "fitMode") continue;
    if (!Number.isFinite(value)) throw new Error(`Monitor ${field} must be finite.`);
  }
  if (
    input.sourceWidth <= 0 ||
    input.sourceHeight <= 0 ||
    input.containerWidth <= 0 ||
    input.containerHeight <= 0
  ) {
    throw new Error("Monitor source and container dimensions must be positive.");
  }
  if (input.zoom < 0.1 || input.zoom > 16) throw new Error("Monitor zoom must be between 0.1x and 16x.");
  if (input.devicePixelRatio < 1 || input.devicePixelRatio > 8) {
    throw new Error("Monitor device pixel ratio must be between 1 and 8.");
  }
  const widthScale = input.containerWidth / input.sourceWidth;
  const heightScale = input.containerHeight / input.sourceHeight;
  const baseScale =
    input.fitMode === "fit" ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
  const scale = baseScale * input.zoom;
  const rawWidth = input.sourceWidth * scale;
  const rawHeight = input.sourceHeight * scale;
  const displayWidth = approximately(rawWidth, input.containerWidth) ? input.containerWidth : rawWidth;
  const displayHeight = approximately(rawHeight, input.containerHeight) ? input.containerHeight : rawHeight;
  const offsetX = cleanFloat((input.containerWidth - displayWidth) / 2 + input.panX);
  const offsetY = cleanFloat((input.containerHeight - displayHeight) / 2 + input.panY);
  return {
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    containerWidth: input.containerWidth,
    containerHeight: input.containerHeight,
    displayWidth,
    displayHeight,
    offsetX,
    offsetY,
    scale,
    backingWidth: Math.max(1, Math.round(input.containerWidth * input.devicePixelRatio)),
    backingHeight: Math.max(1, Math.round(input.containerHeight * input.devicePixelRatio)),
    bars:
      input.fitMode === "fill" ||
      (approximately(displayWidth, input.containerWidth) &&
        approximately(displayHeight, input.containerHeight))
        ? "none"
        : displayWidth < input.containerWidth
          ? "pillarbox"
          : "letterbox",
    devicePixelRatio: input.devicePixelRatio,
  };
};

export const mapMonitorPointToComposition = (
  geometry: MonitorViewportGeometry,
  containerX: number,
  containerY: number,
): MonitorMappedPoint => {
  if (!Number.isFinite(containerX) || !Number.isFinite(containerY)) {
    throw new Error("Monitor pointer coordinates must be finite.");
  }
  const normalizedX = (containerX - geometry.offsetX) / geometry.displayWidth;
  const normalizedY = (containerY - geometry.offsetY) / geometry.displayHeight;
  return {
    inside: normalizedX >= 0 && normalizedX <= 1 && normalizedY >= 0 && normalizedY <= 1,
    normalizedX,
    normalizedY,
    sourceX: normalizedX * geometry.sourceWidth,
    sourceY: normalizedY * geometry.sourceHeight,
  };
};

export const monitorCommandForShortcut = (commandId: string): ProgramMonitorCommand | null => {
  if (commandId === "transport.toggle") return { kind: "toggle-play" };
  if (commandId === "transport.previous-frame") return { kind: "step-frame", delta: -1 };
  if (commandId === "transport.next-frame") return { kind: "step-frame", delta: 1 };
  if (commandId === "transport.previous-second") return { kind: "step-second", seconds: -1 };
  if (commandId === "transport.next-second") return { kind: "step-second", seconds: 1 };
  if (commandId === "transport.start") return { kind: "seek-start" };
  if (commandId === "transport.end") return { kind: "seek-end" };
  if (commandId === "transport.mark-in") return { kind: "mark-in" };
  if (commandId === "transport.mark-out") return { kind: "mark-out" };
  if (commandId === "transport.loop") return { kind: "toggle-loop" };
  if (commandId === "transport.shuttle-backward") return { kind: "shuttle", direction: "backward" };
  if (commandId === "transport.shuttle-pause") return { kind: "shuttle", direction: "pause" };
  if (commandId === "transport.shuttle-forward") return { kind: "shuttle", direction: "forward" };
  return null;
};

export const previewControlRequests = (
  command: ProgramMonitorCommand,
  preview: PreviewTruth,
): readonly PreviewControlRequest[] => {
  const expectedStateVersion = preview.stateVersion;
  if (command.kind === "toggle-play") {
    return [
      request("transport", {
        action: preview.playback === "playing" ? "pause" : "play",
        expectedStateVersion,
      }),
    ];
  }
  if (command.kind === "pause") return [request("transport", { action: "pause", expectedStateVersion })];
  if (command.kind === "step-frame") {
    return [request("step", { delta: command.delta, expectedStateVersion })];
  }
  if (command.kind === "step-second") {
    return [request("step-seconds", { seconds: command.seconds, expectedStateVersion })];
  }
  if (command.kind === "seek-start") return [request("seek", { frame: "0", expectedStateVersion })];
  if (command.kind === "seek-end") {
    const end = BigInt(preview.durationFrames) === 0n ? 0n : BigInt(preview.durationFrames) - 1n;
    return [request("seek", { frame: end.toString(), expectedStateVersion })];
  }
  if (command.kind === "seek-frame") {
    const requested = BigInt(command.frame);
    const duration = BigInt(preview.durationFrames);
    const frame =
      duration === 0n ? 0n : requested < 0n ? 0n : requested >= duration ? duration - 1n : requested;
    return [request("seek", { frame: frame.toString(), expectedStateVersion })];
  }
  if (command.kind === "mark-in" || command.kind === "mark-out") {
    const current = BigInt(preview.masterFrame);
    const duration = BigInt(preview.durationFrames);
    const previousStart = BigInt(preview.inOutRange?.startFrame ?? "0");
    const previousEnd = BigInt(preview.inOutRange?.endFrameExclusive ?? preview.durationFrames);
    const start =
      command.kind === "mark-in" ? current : previousStart < current + 1n ? previousStart : current;
    const end =
      command.kind === "mark-out"
        ? current + 1n
        : previousEnd > current
          ? previousEnd
          : duration > current + 1n
            ? current + 1n
            : duration;
    return [
      request("in-out-range", {
        range: { startFrame: start.toString(), endFrameExclusive: end.toString() },
        expectedStateVersion,
      }),
    ];
  }
  if (command.kind === "toggle-loop") {
    return [
      request("loop-range", {
        range:
          preview.loopRange === null
            ? (preview.inOutRange ?? { startFrame: "0", endFrameExclusive: preview.durationFrames })
            : null,
        expectedStateVersion,
      }),
    ];
  }
  if (command.kind === "set-rate") {
    return [
      request("play-rate", {
        playRate: { numerator: command.numerator.toString(), denominator: "1" },
        expectedStateVersion,
      }),
    ];
  }
  if (command.direction === "pause") return [request("transport", { action: "pause", expectedStateVersion })];
  return [
    request("play-rate", {
      playRate: { numerator: command.direction === "backward" ? "-1" : "1", denominator: "1" },
      expectedStateVersion,
    }),
    request("transport", { action: "play", expectedStateVersion: expectedStateVersion + 1 }),
  ];
};

export const applyContractMockPreviewCommand = (
  preview: PreviewTruth,
  command: ProgramMonitorCommand,
): PreviewTruth => {
  let next = preview;
  for (const control of previewControlRequests(command, preview)) {
    const duration = BigInt(next.durationFrames);
    const current = BigInt(next.masterFrame);
    if (control.endpoint === "transport") {
      next = { ...next, playback: control.body.action === "play" ? "playing" : "paused" };
    } else if (control.endpoint === "seek") {
      next = { ...next, masterFrame: String(control.body.frame), playback: "paused" };
    } else if (control.endpoint === "step" || control.endpoint === "step-seconds") {
      const delta =
        control.endpoint === "step"
          ? BigInt(Number(control.body.delta))
          : framesForSeconds(Number(control.body.seconds), next.timelineFps);
      const candidate = current + delta;
      const frame =
        duration === 0n ? 0n : candidate < 0n ? 0n : candidate >= duration ? duration - 1n : candidate;
      next = { ...next, masterFrame: frame.toString(), playback: "paused" };
    } else if (control.endpoint === "play-rate") {
      next = { ...next, playRate: control.body.playRate as PreviewTruth["playRate"] };
    } else if (control.endpoint === "loop-range") {
      next = { ...next, loopRange: control.body.range as PreviewTruth["loopRange"] };
    } else {
      next = { ...next, inOutRange: control.body.range as PreviewTruth["inOutRange"] };
    }
    next = { ...next, stateVersion: next.stateVersion + 1 };
  }
  return { ...next, timecode: formatMonitorTimecode(next.masterFrame, next.timelineFps) };
};

export const advanceContractMockPreviewFrame = (preview: PreviewTruth): PreviewTruth => {
  if (preview.playback !== "playing") return preview;
  const rate = BigInt(preview.playRate.numerator) / BigInt(preview.playRate.denominator);
  const delta = rate === 0n ? (BigInt(preview.playRate.numerator) < 0n ? -1n : 1n) : rate;
  const duration = BigInt(preview.durationFrames);
  const loopStart = BigInt(preview.loopRange?.startFrame ?? "0");
  const loopEnd = BigInt(preview.loopRange?.endFrameExclusive ?? preview.durationFrames);
  let frame = BigInt(preview.masterFrame) + delta;
  let playback: PreviewTruth["playback"] = preview.playback;
  if (delta > 0n && frame >= loopEnd) {
    if (preview.loopRange === null) {
      frame = duration === 0n ? 0n : duration - 1n;
      playback = "paused";
    } else {
      frame = loopStart + ((frame - loopStart) % (loopEnd - loopStart));
    }
  } else if (delta < 0n && frame < loopStart) {
    if (preview.loopRange === null) {
      frame = 0n;
      playback = "paused";
    } else {
      const length = loopEnd - loopStart;
      frame = loopEnd - 1n - ((loopStart - 1n - frame) % length);
    }
  }
  return {
    ...preview,
    masterFrame: frame.toString(10),
    timecode: formatMonitorTimecode(frame.toString(10), preview.timelineFps),
    playback,
  };
};

export const formatMonitorTimecode = (
  frameInput: string,
  rate: Readonly<{ numerator: string; denominator: string }>,
): string => {
  const frame = BigInt(frameInput);
  if (frame < 0n) throw new Error("Monitor timecode frame cannot be negative.");
  const numerator = BigInt(rate.numerator);
  const denominator = BigInt(rate.denominator);
  const dropFrame = (numerator === 30_000n || numerator === 60_000n) && denominator === 1_001n;
  const nominal = Number((numerator + denominator / 2n) / denominator);
  let displayFrame = frame;
  if (dropFrame) {
    const dropCount = nominal === 60 ? 4n : 2n;
    const nominalBigInt = BigInt(nominal);
    const perTenMinutes = nominalBigInt * 600n - dropCount * 9n;
    const perMinute = nominalBigInt * 60n - dropCount;
    const wrapped = frame % (perTenMinutes * 6n * 24n);
    const chunks = wrapped / perTenMinutes;
    const remainder = wrapped % perTenMinutes;
    displayFrame =
      wrapped +
      dropCount * 9n * chunks +
      (remainder >= dropCount ? dropCount * ((remainder - dropCount) / perMinute) : 0n);
  }
  const nominalBigInt = BigInt(nominal);
  const frames = displayFrame % nominalBigInt;
  const totalSeconds = displayFrame / nominalBigInt;
  const seconds = totalSeconds % 60n;
  const minutes = (totalSeconds / 60n) % 60n;
  const hours = (totalSeconds / 3_600n) % 24n;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${dropFrame ? ";" : ":"}${pad2(frames)}`;
};

export const foundationSourceInspectionActions = [
  "seek",
  "step-frame",
  "audition-property",
  "reset-audition",
  "compare-to-timeline",
  "add-to-context",
  "capture",
] as const;

export type FoundationSourceInspectionAction = (typeof foundationSourceInspectionActions)[number];
export const forbiddenFoundationSourceActions = [
  "mark-in",
  "mark-out",
  "patch-track",
  "insert",
  "overwrite",
  "replace",
  "three-point-edit",
] as const;

export const assertFoundationSourceInspectionBoundary = (
  actions: readonly string[] = foundationSourceInspectionActions,
): void => {
  const forbidden = actions.filter((action) =>
    (forbiddenFoundationSourceActions as readonly string[]).includes(action),
  );
  if (forbidden.length > 0) {
    throw new Error(`Foundation source inspection exposes reserved edit actions: ${forbidden.join(", ")}.`);
  }
};

export interface SourceInspectionState {
  readonly sourceId: string;
  readonly sourceKind: "video" | "image" | "remotion" | "hyperframes";
  readonly currentFrame: string;
  readonly durationFrames: string;
  readonly fps: Readonly<{ numerator: string; denominator: string }>;
  readonly auditionValues: Readonly<Record<string, string | number | boolean>>;
  readonly auditionDirty: boolean;
}

export type SourceInspectionCommand =
  | Readonly<{ kind: "seek"; frame: string }>
  | Readonly<{ kind: "step-frame"; delta: -1 | 1 }>
  | Readonly<{ kind: "audition-property"; propertyId: string; value: string | number | boolean }>
  | Readonly<{ kind: "reset-audition" }>;

export const applySourceInspectionCommand = (
  state: SourceInspectionState,
  command: SourceInspectionCommand,
): SourceInspectionState => {
  assertFoundationSourceInspectionBoundary();
  if (command.kind === "audition-property") {
    if (!/^[A-Za-z][A-Za-z0-9._-]{1,127}$/.test(command.propertyId)) {
      throw new Error("Source audition property ID is invalid.");
    }
    return {
      ...state,
      auditionValues: { ...state.auditionValues, [command.propertyId]: command.value },
      auditionDirty: true,
    };
  }
  if (command.kind === "reset-audition") {
    return { ...state, auditionValues: {}, auditionDirty: false };
  }
  const duration = BigInt(state.durationFrames);
  const requested =
    command.kind === "seek" ? BigInt(command.frame) : BigInt(state.currentFrame) + BigInt(command.delta);
  const frame =
    duration === 0n ? 0n : requested < 0n ? 0n : requested >= duration ? duration - 1n : requested;
  return { ...state, currentFrame: frame.toString() };
};

const request = (
  endpoint: PreviewControlRequest["endpoint"],
  body: Readonly<Record<string, unknown>>,
): PreviewControlRequest => ({ endpoint, body });

const framesForSeconds = (
  seconds: number,
  rate: Readonly<{ numerator: string; denominator: string }>,
): bigint => {
  const numerator = BigInt(rate.numerator) * BigInt(seconds);
  const denominator = BigInt(rate.denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  return numerator > 0n ? quotient + 1n : quotient - 1n;
};

const pad2 = (value: bigint): string => value.toString().padStart(2, "0");
const approximately = (left: number, right: number): boolean => Math.abs(left - right) < 0.01;
const cleanFloat = (value: number): number => (Math.abs(value) < 1e-10 ? 0 : value);
