import {
  resolvePreviewQualityPolicy,
  type PreviewLoadClass,
  type PreviewQualityPolicy,
} from "./quality-policy.js";

export type PreviewDegradationLevel = 0 | 1 | 2 | 3 | 4;
export type PreviewDegradationStep =
  | "nominal"
  | "report-dropped-frames"
  | "lower-preview-quality"
  | "disable-expensive-effects"
  | "render-preview-range";

export interface PreviewDegradationState {
  readonly level: PreviewDegradationLevel;
  readonly step: PreviewDegradationStep;
  readonly droppedFrames: number;
  readonly visible: boolean;
  readonly reversible: true;
  readonly framePerfectRealtimeClaimed: false;
  readonly qualityPolicy: PreviewQualityPolicy;
  readonly message: string;
  readonly nextLevel: PreviewDegradationLevel;
  readonly previousLevel: PreviewDegradationLevel;
}

export const resolvePreviewDegradation = (input: {
  readonly requestedLevel?: PreviewDegradationLevel;
  readonly droppedFrames: number;
  readonly loadClass: PreviewLoadClass;
  readonly renderRangeAvailable: boolean;
}): PreviewDegradationState => {
  if (!Number.isSafeInteger(input.droppedFrames) || input.droppedFrames < 0) {
    throw new Error("Dropped frames must be a non-negative safe integer.");
  }
  const automaticLevel: PreviewDegradationLevel =
    input.droppedFrames === 0 && input.loadClass === "nominal"
      ? 0
      : input.loadClass === "critical" && input.renderRangeAvailable
        ? 4
        : input.loadClass === "critical"
          ? 3
          : input.droppedFrames > 0
            ? 1
            : 2;
  const level = Math.max(automaticLevel, input.requestedLevel ?? 0) as PreviewDegradationLevel;
  const step = steps[level];
  const qualityPolicy = resolvePreviewQualityPolicy({
    quality: level >= 2 ? "draft" : "balanced",
    truthMode: "interactive-approximation",
    loadClass: level >= 3 ? "critical" : input.loadClass,
  });
  return {
    level,
    step,
    droppedFrames: input.droppedFrames,
    visible: level > 0,
    reversible: true,
    framePerfectRealtimeClaimed: false,
    qualityPolicy,
    message: messages[level].replace("{count}", String(input.droppedFrames)),
    nextLevel: Math.min(4, level + 1) as PreviewDegradationLevel,
    previousLevel: Math.max(0, level - 1) as PreviewDegradationLevel,
  };
};

const steps: Readonly<Record<PreviewDegradationLevel, PreviewDegradationStep>> = {
  0: "nominal",
  1: "report-dropped-frames",
  2: "lower-preview-quality",
  3: "disable-expensive-effects",
  4: "render-preview-range",
};

const messages: Readonly<Record<PreviewDegradationLevel, string>> = {
  0: "Interactive preview is within the measured real-time budget; rendered fidelity remains authoritative.",
  1: "{count} preview frames dropped. Playback is not frame-perfect real time.",
  2: "Preview quality is reduced to protect transport responsiveness.",
  3: "Expensive preview effects are disabled; exact render output is unchanged.",
  4: "Real-time preview is unavailable for this range. Render a preview range for exact playback.",
};
