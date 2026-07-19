import { createHash } from "node:crypto";
import type { HyperframesSourceDescriptor, HyperframesWorkerPolicy } from "./contracts.js";

export const selectHyperframesWorkerPolicy = (
  source: HyperframesSourceDescriptor,
): HyperframesWorkerPolicy => {
  const identity = createHash("sha256")
    .update(
      JSON.stringify({
        policyVersion: "hyperframes-worker-policy.v1",
        sourceId: source.sourceId,
        trustClass: source.trustClass,
        approvedNetworkResources:
          source.trustClass === "trusted-authored"
            ? [...source.approvedNetworkResources].sort((left, right) => left.url.localeCompare(right.url))
            : [],
      }),
    )
    .digest("hex");
  return {
    policyVersion: "hyperframes-worker-policy.v1",
    trustClass: source.trustClass,
    workerId:
      source.trustClass === "trusted-authored"
        ? "hyperframes-worker-trusted-v1"
        : "hyperframes-worker-untrusted-v1",
    cacheNamespace: `hf-${source.trustClass}-${identity}`,
    networkMode: source.trustClass === "trusted-authored" ? "approved-only" : "denied",
    navigationAllowed: false,
    popupsAllowed: false,
    downloadsAllowed: false,
    nativeAudioAllowed: false,
  };
};

export const assertHyperframesCachePolicy = (
  artifactPolicy: HyperframesWorkerPolicy,
  requestedPolicy: HyperframesWorkerPolicy,
): void => {
  if (
    artifactPolicy.trustClass !== requestedPolicy.trustClass ||
    artifactPolicy.workerId !== requestedPolicy.workerId ||
    artifactPolicy.cacheNamespace !== requestedPolicy.cacheNamespace
  ) {
    throw new Error("HyperFrames artifact policy is incompatible with the requested trust context.");
  }
};
