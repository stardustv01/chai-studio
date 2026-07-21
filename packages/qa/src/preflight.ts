import { createQaReport, emptyQaLocation, qaHash, type QaFinding, type QaReport } from "./contracts.js";
import { centralizedQaRules, qaRuleSetIdentity } from "./rules.js";

export interface PreRenderFindingInput {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly blocking: boolean;
  readonly title: string;
  readonly detail: string;
  readonly repair: string | null;
}

const deliveryCodeToRule = new Map<string, string>([
  ["delivery.dependencies.missing", "qa.pre.media"],
  ["delivery.capability.unsupported", "qa.pre.capability"],
  ["delivery.rights.unresolved", "qa.pre.rights"],
  ["delivery.originals.missing", "qa.pre.proxy"],
  ["delivery.proxy.preview-only", "qa.pre.proxy"],
  ["delivery.disk.insufficient", "qa.pre.disk"],
  ["delivery.scope.outside-timeline", "qa.pre.timeline"],
  ["security.trust.unclassified", "qa.pre.trust"],
  ["security.imported-execution.disabled", "qa.pre.trust"],
  ["security.network.hash-required", "qa.pre.trust"],
  ["render.compositor.unavailable", "qa.pre.composition"],
  ["render.compositor.range-empty", "qa.pre.timeline"],
  ["render.compositor.native-time-remap-unavailable", "qa.pre.capability"],
  ["render.compositor.imported-worker-unavailable", "qa.pre.trust"],
  ["render.compositor.property-unavailable", "qa.pre.capability"],
  ["render.compositor.audio-source-missing", "qa.pre.audio"],
  ["render.compositor.video-codec-unavailable", "qa.pre.capability"],
  ["render.compositor.audio-codec-unavailable", "qa.pre.capability"],
]);

export const createPreRenderQaReport = (input: {
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly createdAt: string;
  readonly findings: readonly PreRenderFindingInput[];
  readonly evidenceHashes: readonly string[];
  readonly environmentFingerprint: string | null;
}): QaReport => {
  const rules = centralizedQaRules().filter((rule) => rule.stage === "pre-render");
  const findings = rules.map((rule): QaFinding => {
    const matched = input.findings.filter(
      (finding) => (deliveryCodeToRule.get(finding.code) ?? "qa.pre.schema") === rule.id,
    );
    const failed = matched.find((finding) => finding.blocking || finding.severity === "error");
    const warning = matched.find((finding) => finding.severity === "warning");
    const observed = failed ?? warning;
    const status: QaFinding["status"] =
      failed === undefined ? (warning === undefined ? "passed" : "warning") : "failed";
    const base = {
      ruleId: rule.id,
      ruleVersion: rule.version,
      category: rule.category,
      stage: rule.stage,
      severity:
        status === "failed"
          ? ("error" as const)
          : status === "warning"
            ? ("warning" as const)
            : ("info" as const),
      blocking: rule.blocking,
      status,
      title: observed?.title ?? rule.title,
      detail: observed?.detail ?? `${rule.title} passed for the immutable render request.`,
      repairHint: observed?.repair ?? null,
      location: emptyQaLocation(),
      evidenceHashes: input.evidenceHashes,
      metrics: [],
      environmentFingerprint: input.environmentFingerprint,
      exceptionId: null,
    };
    return { schemaVersion: "1.0.0", id: `qa-finding-${qaHash(base).slice(0, 24)}`, ...base };
  });
  return createQaReport({
    id: input.id,
    projectId: input.projectId,
    revisionId: input.revisionId,
    outputId: null,
    ruleSetIdentity: qaRuleSetIdentity(),
    rules: rules.map(({ id, version }) => ({ id, version })),
    findings,
    createdAt: input.createdAt,
  });
};
