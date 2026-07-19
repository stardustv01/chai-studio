import { emptyQaLocation, qaHash, type QaFinding, type QaMetric } from "./contracts.js";

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

export interface CaptionQaObservation {
  readonly cueId: string;
  readonly startFrame: string;
  readonly endFrameExclusive: string;
  readonly charactersPerSecond: number;
  readonly maximumCharactersPerSecond: number;
  readonly maximumLineCharacters: number;
  readonly observedMaximumLineCharacters: number;
  readonly lineCount: number;
  readonly maximumLineCount: number;
  readonly contrastRatio: number;
  readonly minimumContrastRatio: number;
  readonly collisionFree: boolean;
  readonly insideSafeZone: boolean;
  readonly phraseSyncDeltaFrames: number;
  readonly maximumPhraseSyncDeltaFrames: number;
  readonly evidenceHashes: readonly string[];
}

export const evaluateCaptionQa = (value: CaptionQaObservation): QaFinding => {
  const failures = [
    value.charactersPerSecond > value.maximumCharactersPerSecond && "reading speed",
    value.observedMaximumLineCharacters > value.maximumLineCharacters && "line length",
    value.lineCount > value.maximumLineCount && "line count",
    value.contrastRatio < value.minimumContrastRatio && "contrast",
    !value.collisionFree && "collision",
    !value.insideSafeZone && "safe zone",
    Math.abs(value.phraseSyncDeltaFrames) > value.maximumPhraseSyncDeltaFrames && "phrase sync",
  ].filter((item): item is string => typeof item === "string");
  return finding({
    ruleId: "qa.post.caption",
    ruleVersion: "1.0.0",
    category: "caption",
    stage: "post-render",
    severity: failures.length === 0 ? "info" : "error",
    blocking: true,
    status: failures.length === 0 ? "passed" : "failed",
    title: `Caption cue ${value.cueId}`,
    detail:
      failures.length === 0
        ? "Readability, layout, safe zone, and phrase synchronization pass."
        : `Failed: ${failures.join(", ")}.`,
    repairHint:
      failures.length === 0
        ? null
        : "Edit the linked cue/style at the exact range and regenerate caption evidence.",
    location: {
      ...emptyQaLocation(),
      entityIds: [value.cueId],
      frameRange: { startFrame: value.startFrame, endFrameExclusive: value.endFrameExclusive },
    },
    evidenceHashes: value.evidenceHashes,
    metrics: [
      metric(
        "charactersPerSecond",
        value.charactersPerSecond,
        "lte",
        value.maximumCharactersPerSecond,
        "characters/second",
      ),
      metric(
        "lineCharacters",
        value.observedMaximumLineCharacters,
        "lte",
        value.maximumLineCharacters,
        "characters",
      ),
      metric("contrastRatio", value.contrastRatio, "gte", value.minimumContrastRatio, "ratio"),
      metric(
        "phraseSyncDelta",
        value.phraseSyncDeltaFrames,
        "range",
        [-value.maximumPhraseSyncDeltaFrames, value.maximumPhraseSyncDeltaFrames],
        "frames",
      ),
    ],
    environmentFingerprint: null,
    exceptionId: null,
  });
};

export type SyncAnchorKind =
  "vo-visual" | "caption-transcript" | "music-cue" | "sfx-cue" | "long-timeline-drift" | "engine-boundary";

export interface SyncAnchorObservation {
  readonly id: string;
  readonly kind: SyncAnchorKind;
  readonly expectedFrame: string;
  readonly observedFrame: string;
  readonly frameDelta: string;
  readonly maximumAbsoluteFrameDelta: string;
  readonly expectedSample: string | null;
  readonly observedSample: string | null;
  readonly sampleDelta: string | null;
  readonly maximumAbsoluteSampleDelta: string | null;
  readonly evidenceHashes: readonly string[];
}

export const evaluateSyncAnchor = (value: SyncAnchorObservation): QaFinding => {
  const frameFailed = absoluteBigInt(value.frameDelta) > BigInt(value.maximumAbsoluteFrameDelta);
  const sampleFailed =
    value.sampleDelta !== null &&
    value.maximumAbsoluteSampleDelta !== null &&
    absoluteBigInt(value.sampleDelta) > BigInt(value.maximumAbsoluteSampleDelta);
  const failed = frameFailed || sampleFailed;
  return finding({
    ruleId: "qa.post.sync",
    ruleVersion: "1.0.0",
    category: "sync",
    stage: "post-render",
    severity: failed ? "error" : "info",
    blocking: true,
    status: failed ? "failed" : "passed",
    title: `${value.kind.replaceAll("-", " ")} · ${value.id}`,
    detail: failed
      ? `Observed frame/sample delta exceeds the declared bound (${value.frameDelta} frames, ${value.sampleDelta ?? "not measured"} samples).`
      : `Frame/sample delta passes (${value.frameDelta} frames, ${value.sampleDelta ?? "not measured"} samples).`,
    repairHint: failed
      ? "Repair the linked anchor, mapping, bridge, or authoritative audio cue and rerun exact sync QA."
      : null,
    location: { ...emptyQaLocation(), entityIds: [value.id], frame: value.observedFrame },
    evidenceHashes: value.evidenceHashes,
    metrics: [
      metric(
        "frameDelta",
        value.frameDelta,
        "range",
        [`-${value.maximumAbsoluteFrameDelta}`, value.maximumAbsoluteFrameDelta].join(".."),
        "frames",
      ),
      metric("sampleDelta", value.sampleDelta, "informational", value.maximumAbsoluteSampleDelta, "samples"),
    ],
    environmentFingerprint: null,
    exceptionId: null,
  });
};

const absoluteBigInt = (value: string): bigint => {
  const parsed = BigInt(value);
  return parsed < 0n ? -parsed : parsed;
};
