import type {
  HyperframesCliFinding,
  HyperframesDiagnostic,
  HyperframesDiagnosticCategory,
  HyperframesDiagnosticSeverity,
} from "./contracts.js";

export const hyperframesDiagnostic = (input: {
  readonly category: HyperframesDiagnosticCategory;
  readonly code: string;
  readonly severity: HyperframesDiagnosticSeverity;
  readonly stage: string;
  readonly message: string;
  readonly repairHint: string;
  readonly sourcePath?: string | null;
  readonly selector?: string | null;
  readonly elementId?: string | null;
  readonly adapterId?: string | null;
  readonly compositionId?: string | null;
  readonly frame?: string | null;
}): HyperframesDiagnostic => ({
  category: input.category,
  code: input.code,
  severity: input.severity,
  stage: input.stage,
  message: input.message,
  repairHint: input.repairHint,
  sourcePath: input.sourcePath ?? null,
  selector: input.selector ?? null,
  elementId: input.elementId ?? null,
  adapterId: input.adapterId ?? null,
  compositionId: input.compositionId ?? null,
  frame: input.frame ?? null,
});

export const cliFindingToDiagnostic = (
  finding: HyperframesCliFinding,
  category: HyperframesDiagnosticCategory,
  compositionId: string | null,
  fps: number,
): HyperframesDiagnostic => {
  const severity = finding.severity === "error" ? "error" : finding.severity === "info" ? "info" : "warning";
  return hyperframesDiagnostic({
    category,
    code: `hyperframes.${category}.${finding.code ?? "finding"}`,
    severity,
    stage: `hyperframes-${category}`,
    message: finding.message ?? "HyperFrames reported an unspecified finding.",
    repairHint: repairHintFor(category),
    sourcePath: finding.sourceFile ?? finding.file ?? null,
    selector: finding.selector ?? null,
    elementId: finding.hfId ?? null,
    adapterId: finding.adapter ?? null,
    compositionId,
    frame:
      finding.time === undefined || !Number.isFinite(finding.time)
        ? null
        : Math.max(0, Math.round(finding.time * fps)).toString(10),
  });
};

const repairHintFor = (category: HyperframesDiagnosticCategory): string => {
  switch (category) {
    case "layout":
      return "Open the mapped element and correct its held overflow, overlap, or occlusion.";
    case "motion":
      return "Correct the seek-safe timeline or frame-adapter registration and rerun check.";
    case "contrast":
      return "Apply a compliant foreground/background pair and rerun check.";
    case "runtime":
      return "Open the mapped source and remove the runtime error or failed request.";
    default:
      return "Inspect the mapped HyperFrames finding and rerun validation.";
  }
};
