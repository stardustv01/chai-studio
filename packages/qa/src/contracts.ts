import { createHash } from "node:crypto";
import { stringifyCanonicalJson, type QaState as SchemaQaState } from "@chai-studio/schema";

export type QaState = SchemaQaState;

export const qaStates = [
  "rendered_unchecked",
  "qa_failed",
  "qa_warning",
  "qa_passed",
  "approved",
  "delivered",
] as const satisfies readonly SchemaQaState[];

export type QaCategory =
  | "schema"
  | "media"
  | "timeline"
  | "capability"
  | "font"
  | "composition"
  | "proxy"
  | "alpha"
  | "audio"
  | "rights"
  | "trust"
  | "disk"
  | "output"
  | "environment"
  | "visual"
  | "caption"
  | "sync"
  | "lifecycle";

export type QaSeverity = "info" | "warning" | "error";
export type QaStage = "pre-render" | "post-render" | "human-review" | "lifecycle";

export interface QaRuleDefinition {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly version: string;
  readonly category: QaCategory;
  readonly stage: QaStage;
  readonly title: string;
  readonly defaultSeverity: QaSeverity;
  readonly blocking: boolean;
  readonly evaluatorVersion: string;
  readonly description: string;
}

export interface QaLocation {
  readonly entityIds: readonly string[];
  readonly artifactPath: string | null;
  readonly frame: string | null;
  readonly frameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
  readonly sampleRange: Readonly<{ startSample: string; endSampleExclusive: string }> | null;
}

export interface QaMetric {
  readonly name: string;
  readonly value: number | string | boolean | null;
  readonly unit: string | null;
  readonly comparator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "range" | "informational";
  readonly threshold: number | string | boolean | readonly [number, number] | null;
}

export interface QaFinding {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly category: QaCategory;
  readonly stage: QaStage;
  readonly severity: QaSeverity;
  readonly blocking: boolean;
  readonly status: "passed" | "failed" | "warning" | "not-applicable" | "requires-review";
  readonly title: string;
  readonly detail: string;
  readonly repairHint: string | null;
  readonly location: QaLocation;
  readonly evidenceHashes: readonly string[];
  readonly metrics: readonly QaMetric[];
  readonly environmentFingerprint: string | null;
  readonly exceptionId: string | null;
}

export interface QaReport {
  readonly schemaVersion: "1.0.0";
  readonly reportVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly outputId: string | null;
  readonly ruleSetIdentity: string;
  readonly rules: readonly Readonly<{ id: string; version: string }>[];
  readonly findings: readonly QaFinding[];
  readonly state: "qa_failed" | "qa_warning" | "qa_passed";
  readonly blockingFindingIds: readonly string[];
  readonly reviewFindingIds: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly createdAt: string;
  readonly identityHash: string;
}

export const qaHash = (value: unknown): string =>
  createHash("sha256").update(stringifyCanonicalJson(value), "utf8").digest("hex");

export const emptyQaLocation = (): QaLocation => ({
  entityIds: [],
  artifactPath: null,
  frame: null,
  frameRange: null,
  sampleRange: null,
});

export const createQaReport = (
  input: Omit<
    QaReport,
    | "schemaVersion"
    | "reportVersion"
    | "identityHash"
    | "state"
    | "blockingFindingIds"
    | "reviewFindingIds"
    | "exceptionIds"
  >,
): QaReport => {
  const blockingFindingIds = input.findings
    .filter((finding) => finding.blocking && finding.status === "failed")
    .map((finding) => finding.id);
  const reviewFindingIds = input.findings
    .filter((finding) => finding.status === "requires-review")
    .map((finding) => finding.id);
  const warning = input.findings.some(
    (finding) => finding.status === "warning" || finding.status === "requires-review",
  );
  const state: QaReport["state"] =
    blockingFindingIds.length > 0 ? "qa_failed" : warning ? "qa_warning" : "qa_passed";
  const exceptionIds = [
    ...new Set(
      input.findings.flatMap((finding) => (finding.exceptionId === null ? [] : [finding.exceptionId])),
    ),
  ].sort();
  const base = {
    schemaVersion: "1.0.0" as const,
    reportVersion: "1.0.0" as const,
    ...input,
    state,
    blockingFindingIds,
    reviewFindingIds,
    exceptionIds,
  };
  return { ...base, identityHash: qaHash(base) };
};

export const qaPackageBoundary = "qa-approval-delivery-lifecycle" as const;
