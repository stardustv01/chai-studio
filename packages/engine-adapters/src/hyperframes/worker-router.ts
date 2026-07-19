import type { HyperframesSourceDescriptor, HyperframesWorkerPolicy } from "./contracts.js";
import { pinnedHyperframesVersion } from "./contracts.js";
import type { HyperframesCommandRuntime } from "./process-runtime.js";
import { selectHyperframesWorkerPolicy } from "./trust-policy.js";

export interface HyperframesIsolationEvidence {
  readonly profileVersion: "macos-hyperframes-imported-v1";
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly adversarialEvidenceHash: string;
  readonly stale: boolean;
  readonly enforcementMechanisms: readonly (
    | "sandbox-exec-network-denial"
    | "canonical-root-policy"
    | "sanitized-environment"
    | "separate-browser-profile"
    | "wall-time-output-memory-caps"
  )[];
}

export interface HyperframesWorkerSelection {
  readonly runtime: HyperframesCommandRuntime;
  readonly policy: HyperframesWorkerPolicy;
  readonly isolationEvidence: HyperframesIsolationEvidence | null;
}

export class HyperframesWorkerRouter {
  readonly #trustedRuntime: HyperframesCommandRuntime;
  readonly #importedRuntime: HyperframesCommandRuntime | null;
  readonly #isolationEvidence: HyperframesIsolationEvidence | null;

  constructor(input: {
    readonly trustedRuntime: HyperframesCommandRuntime;
    readonly importedRuntime?: HyperframesCommandRuntime;
    readonly isolationEvidence?: HyperframesIsolationEvidence;
  }) {
    this.#trustedRuntime = input.trustedRuntime;
    this.#importedRuntime = input.importedRuntime ?? null;
    this.#isolationEvidence = input.isolationEvidence ?? null;
    if (this.#importedRuntime !== null && this.#importedRuntime === this.#trustedRuntime) {
      throw new Error("Trusted and imported HyperFrames workers must use distinct runtime identities.");
    }
  }

  select(source: HyperframesSourceDescriptor): HyperframesWorkerSelection {
    const policy = selectHyperframesWorkerPolicy(source);
    if (this.#trustedRuntime.version !== pinnedHyperframesVersion) {
      throw new Error("Trusted HyperFrames worker runtime does not match the pinned version.");
    }
    if (source.trustClass === "trusted-authored") {
      return { runtime: this.#trustedRuntime, policy, isolationEvidence: null };
    }
    const runtime = this.#importedRuntime;
    const evidence = this.#isolationEvidence;
    if (runtime === null || evidence === null) {
      throw new Error("Imported HyperFrames execution is disabled without a distinct isolated worker.");
    }
    if (runtime.version !== pinnedHyperframesVersion) {
      throw new Error("Imported HyperFrames worker runtime does not match the pinned version.");
    }
    assertCurrentIsolationEvidence(evidence);
    return { runtime, policy, isolationEvidence: evidence };
  }
}

const assertCurrentIsolationEvidence = (evidence: HyperframesIsolationEvidence): void => {
  if (evidence.stale || !/^[a-f0-9]{64}$/.test(evidence.adversarialEvidenceHash)) {
    throw new Error("Imported HyperFrames isolation evidence is unavailable, stale, or invalid.");
  }
  const required = [
    "sandbox-exec-network-denial",
    "canonical-root-policy",
    "sanitized-environment",
    "separate-browser-profile",
    "wall-time-output-memory-caps",
  ] as const;
  if (!required.every((mechanism) => evidence.enforcementMechanisms.includes(mechanism))) {
    throw new Error("Imported HyperFrames isolation evidence omits a required enforcement mechanism.");
  }
};
