import type { AcceptedExceptionDocument, QaState } from "@chai-studio/schema";
import type { QaFinding, QaReport } from "./contracts.js";

const allowedTransitions = new Set([
  "null->rendered_unchecked",
  "rendered_unchecked->rendered_unchecked",
  "qa_failed->rendered_unchecked",
  "qa_warning->rendered_unchecked",
  "qa_passed->rendered_unchecked",
  "approved->rendered_unchecked",
  "delivered->rendered_unchecked",
  "rendered_unchecked->qa_failed",
  "rendered_unchecked->qa_warning",
  "rendered_unchecked->qa_passed",
  "qa_warning->approved",
  "qa_passed->approved",
  "approved->delivered",
]);

export const assertQaLifecycleTransition = (input: {
  readonly from: QaState | null;
  readonly currentOutputId: string | null;
  readonly to: QaState;
  readonly outputId: string;
  readonly report: QaReport | null;
  readonly exceptions: readonly AcceptedExceptionDocument[];
  readonly evidenceHashes: readonly string[];
  readonly now: string;
}): void => {
  const key = `${input.from ?? "null"}->${input.to}`;
  if (!allowedTransitions.has(key)) throw new Error(`QA lifecycle transition ${key} is forbidden.`);
  if (input.evidenceHashes.length === 0 || input.evidenceHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
    throw new Error("QA lifecycle transition requires valid evidence hashes.");
  if (input.to === "rendered_unchecked") {
    if (input.report !== null || input.outputId === input.currentOutputId)
      throw new Error(
        "Rendered output invalidation requires a new immutable output identity and no QA report.",
      );
  } else if (input.to.startsWith("qa_")) {
    if (input.report?.outputId !== input.outputId || input.report.state !== input.to)
      throw new Error("QA transition requires the matching immutable QA report.");
  }
  if (input.to === "approved") {
    if (input.report?.outputId !== input.outputId || input.report.state !== input.from)
      throw new Error("Approval requires the matching immutable QA report and prior QA state.");
  }
  if (input.to === "approved" && input.from === "qa_warning") {
    if (input.report === null) throw new Error("Warning approval requires its QA report.");
    const unresolved = input.report.findings.filter(
      (finding) =>
        (finding.status === "warning" || finding.status === "requires-review") &&
        !exceptionApplies(finding, input.outputId, input.exceptions, input.now),
    );
    if (unresolved.length > 0)
      throw new Error("QA warning approval has unresolved or out-of-scope findings.");
  }
  if (input.to === "delivered" && input.from !== "approved")
    throw new Error("Delivery requires explicit prior approval.");
};

export const exceptionApplies = (
  finding: QaFinding,
  outputId: string,
  exceptions: readonly AcceptedExceptionDocument[],
  now: string,
): boolean =>
  exceptions.some((exception) => {
    if (!exception.active || (exception.expiresAt !== null && exception.expiresAt <= now)) return false;
    if (!exception.scope.qaCodes.includes(finding.ruleId)) return false;
    if (exception.scope.outputId !== null && exception.scope.outputId !== outputId) return false;
    if (
      exception.scope.entityIds.length > 0 &&
      !finding.location.entityIds.some((id) => exception.scope.entityIds.includes(id))
    )
      return false;
    if (exception.scope.frameRange !== null) {
      const range = finding.location.frameRange;
      if (
        range === null ||
        BigInt(range.startFrame) < BigInt(exception.scope.frameRange.startFrame) ||
        BigInt(range.endFrameExclusive) > BigInt(exception.scope.frameRange.endFrameExclusive)
      )
        return false;
    }
    return true;
  });
