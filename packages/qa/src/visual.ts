import { emptyQaLocation, qaHash, type QaFinding, type QaMetric } from "./contracts.js";

export type VisualCheckpointKind =
  | "first-frame"
  | "last-frame"
  | "engine-boundary-before"
  | "engine-boundary-after"
  | "transition-midpoint"
  | "alpha-edge"
  | "proxy-source"
  | "blank-frame"
  | "freeze"
  | "caption"
  | "shader"
  | "transform"
  | "comparison";

export interface VisualCheckpointObservation {
  readonly id: string;
  readonly kind: VisualCheckpointKind;
  readonly frame: string;
  readonly artifactPath: string;
  readonly contentHash: string;
  readonly nonBlank: boolean;
  readonly unexpectedlyFrozen: boolean;
  readonly alphaEdgePassed: boolean | null;
  readonly proxyWatermarkDetected: boolean;
  readonly sourceKind: "original" | "proxy" | "generated";
  readonly finalSourcesRequired: boolean;
  readonly expectedGoldenHash: string | null;
  readonly environmentFingerprint: string;
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
): QaMetric => ({ name, value, comparator, threshold, unit: null });

export const evaluateVisualCheckpoint = (observation: VisualCheckpointObservation): QaFinding => {
  const failures = [
    !observation.nonBlank && "unexpected blank frame",
    observation.unexpectedlyFrozen && "unexpected freeze",
    observation.alphaEdgePassed === false && "alpha edge",
    observation.finalSourcesRequired && observation.sourceKind === "proxy" && "proxy source",
    observation.finalSourcesRequired && observation.proxyWatermarkDetected && "proxy watermark",
    observation.expectedGoldenHash !== null &&
      observation.contentHash !== observation.expectedGoldenHash &&
      "reviewed golden",
  ].filter((value): value is string => typeof value === "string");
  return finding({
    ruleId: "qa.post.visual",
    ruleVersion: "1.0.0",
    category: "visual",
    stage: "post-render",
    severity: failures.length === 0 ? "info" : "error",
    blocking: true,
    status: failures.length === 0 ? "passed" : "failed",
    title: `${observation.kind.replaceAll("-", " ")} at frame ${observation.frame}`,
    detail:
      failures.length === 0
        ? "The exact checkpoint frame passes blank, freeze, alpha, final-source, and reviewed-golden policy."
        : `Failed: ${failures.join(", ")}.`,
    repairHint:
      failures.length === 0
        ? null
        : "Inspect the exact frame and its adjacent native/shared boundary, repair the source or bridge, then regenerate evidence.",
    location: {
      ...emptyQaLocation(),
      artifactPath: observation.artifactPath,
      frame: observation.frame,
    },
    evidenceHashes: [observation.contentHash],
    metrics: [
      metric("nonBlank", observation.nonBlank, "eq", true),
      metric("unexpectedlyFrozen", observation.unexpectedlyFrozen, "eq", false),
      metric("alphaEdgePassed", observation.alphaEdgePassed, "eq", true),
      metric("finalSource", observation.sourceKind === "original", "eq", observation.finalSourcesRequired),
    ],
    environmentFingerprint: observation.environmentFingerprint,
    exceptionId: null,
  });
};

export interface StrictFidelityComparison {
  readonly fixtureId: string;
  readonly frame: string;
  readonly captureHash: string;
  readonly finalHash: string;
  readonly normalizedPixelHashAlgorithm: "rgba8-linear-rec709-v1";
  readonly captureEnvironmentFingerprint: string;
  readonly finalEnvironmentFingerprint: string;
}

export const evaluateStrictFidelity = (value: StrictFidelityComparison): QaFinding => {
  const sameEnvironment = value.captureEnvironmentFingerprint === value.finalEnvironmentFingerprint;
  const exact = value.captureHash === value.finalHash;
  const passed = sameEnvironment && exact;
  return finding({
    ruleId: "qa.post.fidelity.strict",
    ruleVersion: "1.0.0",
    category: "visual",
    stage: "post-render",
    severity: passed ? "info" : "error",
    blocking: true,
    status: passed ? "passed" : "failed",
    title: `Strict normalized-pixel fidelity · ${value.fixtureId}`,
    detail: !sameEnvironment
      ? "Strict comparison is invalid because the capture and final environment identities differ."
      : exact
        ? "Normalized pixel hashes match exactly."
        : "Normalized pixel hashes differ in the same strict environment.",
    repairHint: passed
      ? null
      : "Reproduce capture and final under the same strict environment and inspect the exact frame difference.",
    location: { ...emptyQaLocation(), frame: value.frame },
    evidenceHashes: [value.captureHash, value.finalHash],
    metrics: [metric("exactNormalizedPixelHash", exact, "eq", true)],
    environmentFingerprint: sameEnvironment ? value.finalEnvironmentFingerprint : null,
    exceptionId: null,
  });
};

export interface PerceptualComparisonPolicy {
  readonly fixtureId: string;
  readonly mode: "ssim" | "normalized-rmse" | "delta-e-2000";
  readonly direction: "minimum" | "maximum";
  readonly measuredThreshold: number;
  readonly thresholdEvidenceHash: string;
  readonly policyVersion: string;
}

export const evaluatePerceptualFidelity = (input: {
  readonly policy: PerceptualComparisonPolicy;
  readonly frame: string;
  readonly observed: number;
  readonly captureHash: string;
  readonly finalHash: string;
  readonly captureEnvironmentFingerprint: string;
  readonly finalEnvironmentFingerprint: string;
}): QaFinding => {
  if (!Number.isFinite(input.observed) || !Number.isFinite(input.policy.measuredThreshold)) {
    throw new Error("Perceptual comparison requires finite observed and fixture-measured values.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.policy.thresholdEvidenceHash)) {
    throw new Error("Perceptual comparison requires measured threshold evidence.");
  }
  const passed =
    input.policy.direction === "minimum"
      ? input.observed >= input.policy.measuredThreshold
      : input.observed <= input.policy.measuredThreshold;
  return finding({
    ruleId: "qa.post.fidelity.perceptual",
    ruleVersion: "1.0.0",
    category: "visual",
    stage: "post-render",
    severity: passed ? "info" : "warning",
    blocking: false,
    status: passed ? "passed" : "warning",
    title: `${input.policy.mode} cross-environment comparison · ${input.policy.fixtureId}`,
    detail: passed
      ? "Observed metric passes the fixture-specific measured threshold."
      : "Observed metric is outside the reviewed fixture-specific threshold.",
    repairHint: passed
      ? null
      : "Inspect this fixture and review whether the render or measured policy evidence must change.",
    location: { ...emptyQaLocation(), frame: input.frame },
    evidenceHashes: [input.captureHash, input.finalHash, input.policy.thresholdEvidenceHash],
    metrics: [
      {
        name: input.policy.mode,
        value: input.observed,
        unit: null,
        comparator: input.policy.direction === "minimum" ? "gte" : "lte",
        threshold: input.policy.measuredThreshold,
      },
    ],
    environmentFingerprint: null,
    exceptionId: null,
  });
};
