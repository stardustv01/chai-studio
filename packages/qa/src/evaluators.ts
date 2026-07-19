import { emptyQaLocation, qaHash, type QaFinding, type QaMetric } from "./contracts.js";

export interface StructuralOutputExpectation {
  readonly artifactPath: string;
  readonly probeEvidenceHash: string;
  readonly probeVersion: string;
  readonly readable: boolean;
  readonly contentHash: string;
  readonly expectedContentHash: string | null;
  readonly durationFrames: string;
  readonly expectedDurationFrames: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly expectedWidth: number | null;
  readonly expectedHeight: number | null;
  readonly fps: Readonly<{ numerator: string; denominator: string }> | null;
  readonly expectedFps: Readonly<{ numerator: string; denominator: string }> | null;
  readonly container: string;
  readonly expectedContainer: string;
  readonly videoCodec: string | null;
  readonly expectedVideoCodec: string | null;
  readonly audioCodec: string | null;
  readonly expectedAudioCodec: string | null;
  readonly audioPresent: boolean;
  readonly expectedAudio: boolean;
  readonly sampleRate: number | null;
  readonly expectedSampleRate: number | null;
  readonly channels: number | null;
  readonly expectedChannels: number | null;
  readonly frameCount: string | null;
  readonly frame: string | null;
  readonly frameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
}

export interface AudioQaMeasurements {
  readonly artifactHash: string;
  readonly durationSamples: string;
  readonly expectedDurationSamples: string;
  readonly integratedLufs: number | null;
  readonly targetLufs: number;
  readonly loudnessToleranceLufs: number;
  readonly truePeakDbtp: number | null;
  readonly maximumTruePeakDbtp: number;
  readonly clippedSampleCount: number;
  readonly silentSampleCount: number;
  readonly totalSampleCount: string;
  readonly channels: number;
  readonly expectedChannels: number;
  readonly syncDeltaSamples: string;
  readonly maximumSyncDeltaSamples: string;
}

const finding = (input: Omit<QaFinding, "schemaVersion" | "id">): QaFinding => ({
  schemaVersion: "1.0.0",
  id: `qa-finding-${qaHash(input).slice(0, 24)}`,
  ...input,
});

const metric = (
  name: string,
  value: QaMetric["value"],
  comparator: QaMetric["comparator"],
  threshold: QaMetric["threshold"],
  unit: string | null,
): QaMetric => ({ name, value, comparator, threshold, unit });

const rationalEquals = (
  left: Readonly<{ numerator: string; denominator: string }> | null,
  right: Readonly<{ numerator: string; denominator: string }> | null,
): boolean => {
  if (left === null || right === null) return left === right;
  try {
    return (
      BigInt(left.numerator) * BigInt(right.denominator) ===
      BigInt(right.numerator) * BigInt(left.denominator)
    );
  } catch {
    return false;
  }
};

export const evaluateStructuralOutput = (value: StructuralOutputExpectation): QaFinding => {
  const mismatches = [
    !value.readable && "file unreadable",
    value.durationFrames !== value.expectedDurationFrames && "duration",
    value.width !== value.expectedWidth && "width",
    value.height !== value.expectedHeight && "height",
    !rationalEquals(value.fps, value.expectedFps) && "rational FPS",
    value.container !== value.expectedContainer && "container",
    value.videoCodec !== value.expectedVideoCodec && "video codec",
    value.audioCodec !== value.expectedAudioCodec && "audio codec",
    value.audioPresent !== value.expectedAudio && "audio presence",
    value.sampleRate !== value.expectedSampleRate && "sample rate",
    value.channels !== value.expectedChannels && "channels",
    value.expectedContentHash !== null && value.contentHash !== value.expectedContentHash && "output hash",
    value.frameCount !== null && value.frameCount !== value.expectedDurationFrames && "frame count",
  ].filter((item): item is string => typeof item === "string");
  return finding({
    ruleId: "qa.post.structure",
    ruleVersion: "1.0.0",
    category: "output",
    stage: "post-render",
    severity: mismatches.length === 0 ? "info" : "error",
    blocking: true,
    status: mismatches.length === 0 ? "passed" : "failed",
    title: "Output structure matches requested profile",
    detail:
      mismatches.length === 0
        ? `Artifact bytes and ${value.probeVersion} measurements match the requested output profile.`
        : `Mismatched: ${mismatches.join(", ")}.`,
    repairHint:
      mismatches.length === 0
        ? null
        : "Re-render from the immutable request after repairing the reported encoder or source mismatch.",
    location: {
      ...emptyQaLocation(),
      artifactPath: value.artifactPath,
      frame: value.frame,
      frameRange: value.frameRange,
    },
    evidenceHashes: [...new Set([value.contentHash, value.probeEvidenceHash])],
    metrics: [
      metric("durationFrames", value.durationFrames, "eq", value.expectedDurationFrames, "frames"),
      metric("frameCount", value.frameCount, "eq", value.expectedDurationFrames, "frames"),
      metric("width", value.width, "eq", value.expectedWidth, "pixels"),
      metric("height", value.height, "eq", value.expectedHeight, "pixels"),
      metric("container", value.container, "eq", value.expectedContainer, null),
      metric("videoCodec", value.videoCodec, "eq", value.expectedVideoCodec, null),
      metric("audioCodec", value.audioCodec, "eq", value.expectedAudioCodec, null),
      metric("audioPresent", value.audioPresent, "eq", value.expectedAudio, null),
    ],
    environmentFingerprint: null,
    exceptionId: null,
  });
};

export const evaluateAudioMeasurements = (value: AudioQaMeasurements): QaFinding => {
  const loudnessDelta =
    value.integratedLufs === null ? null : Math.abs(value.integratedLufs - value.targetLufs);
  const failures = [
    value.durationSamples !== value.expectedDurationSamples && "duration",
    value.clippedSampleCount > 0 && "clipping",
    value.truePeakDbtp !== null && value.truePeakDbtp > value.maximumTruePeakDbtp && "true peak",
    value.channels !== value.expectedChannels && "channels",
    BigInt(value.syncDeltaSamples.replace("-", "")) > BigInt(value.maximumSyncDeltaSamples) && "sync",
    BigInt(value.silentSampleCount) === BigInt(value.totalSampleCount) && "silence",
  ].filter((item): item is string => typeof item === "string");
  const warning = loudnessDelta === null || loudnessDelta > value.loudnessToleranceLufs;
  return finding({
    ruleId: "qa.post.audio",
    ruleVersion: "1.0.0",
    category: "audio",
    stage: "post-render",
    severity: failures.length > 0 ? "error" : warning ? "warning" : "info",
    blocking: true,
    status: failures.length > 0 ? "failed" : warning ? "warning" : "passed",
    title: "Authoritative audio measurements",
    detail:
      failures.length > 0
        ? `Failed: ${failures.join(", ")}.`
        : warning
          ? "Audio is structurally safe but loudness needs review."
          : "Audio duration, peaks, channels, loudness, silence, and sync pass.",
    repairHint:
      failures.length > 0
        ? "Repair the authoritative AudioGraph or offline mix and re-render."
        : warning
          ? "Review loudness policy for this delivery profile."
          : null,
    location: emptyQaLocation(),
    evidenceHashes: [value.artifactHash],
    metrics: [
      metric(
        "integratedLufs",
        value.integratedLufs,
        "range",
        [value.targetLufs - value.loudnessToleranceLufs, value.targetLufs + value.loudnessToleranceLufs],
        "LUFS",
      ),
      metric("truePeak", value.truePeakDbtp, "lte", value.maximumTruePeakDbtp, "dBTP"),
      metric("syncDelta", value.syncDeltaSamples, "lte", value.maximumSyncDeltaSamples, "samples"),
    ],
    environmentFingerprint: null,
    exceptionId: null,
  });
};
