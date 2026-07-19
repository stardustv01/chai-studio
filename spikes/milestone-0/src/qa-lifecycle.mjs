const transitions = Object.freeze({
  rendered_unchecked: new Set(["qa_failed", "qa_warning", "qa_passed"]),
  qa_warning: new Set(["approved"]),
  qa_passed: new Set(["approved"]),
  approved: new Set(["delivered"]),
  qa_failed: new Set(),
  delivered: new Set(),
});

export class QaLifecycle {
  constructor({ outputIdentity, revisionId, state = "rendered_unchecked", history = [] }) {
    this.outputIdentity = outputIdentity;
    this.revisionId = revisionId;
    this.state = state;
    this.history = [...history];
  }

  transition({ to, actorId, timestamp, evidenceHashes = [], exceptions = [] }) {
    if (!transitions[this.state]?.has(to)) throw Object.assign(new Error(`invalid QA transition ${this.state} -> ${to}`), { code: "INVALID_QA_TRANSITION" });
    if (!actorId || !timestamp || evidenceHashes.length === 0) throw Object.assign(new Error("transition evidence is incomplete"), { code: "QA_EVIDENCE_REQUIRED" });
    if (this.state === "qa_warning" && to === "approved" && exceptions.length === 0) {
      throw Object.assign(new Error("warning approval requires scoped exceptions"), { code: "QA_EXCEPTION_REQUIRED" });
    }
    this.history.push(Object.freeze({ from: this.state, to, actorId, timestamp, evidenceHashes, exceptions, outputIdentity: this.outputIdentity, revisionId: this.revisionId }));
    this.state = to;
    return this.state;
  }

  invalidate({ outputIdentity, revisionId, reason }) {
    if (!outputIdentity || !revisionId || !reason) throw new Error("invalidation requires new identity, revision, and reason");
    this.history.push(Object.freeze({ from: this.state, to: "rendered_unchecked", reason, invalidatedOutputIdentity: this.outputIdentity }));
    this.outputIdentity = outputIdentity;
    this.revisionId = revisionId;
    this.state = "rendered_unchecked";
  }
}

export const qaTransitions = transitions;
