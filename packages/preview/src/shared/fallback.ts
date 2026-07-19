import { createHash } from "node:crypto";
import type { PreviewWarning } from "../preview-contract.js";
import type { SharedFallbackProvenance } from "./contracts.js";

export const createSharedFallbackProvenance = (
  input: Omit<SharedFallbackProvenance, "provenanceId">,
): SharedFallbackProvenance => {
  for (const [field, value] of Object.entries({
    sourceIdentity: input.sourceIdentity,
    sourceContentHash: input.sourceContentHash,
    cacheKey: input.cacheKey,
    environmentClass: input.environmentClass,
    producerVersion: input.producerVersion,
  })) {
    if (value.trim() === "") throw new Error(`Fallback provenance ${field} is required.`);
  }
  if (input.fidelity === "approximation" && input.approximationLimits.length === 0) {
    throw new Error("Approximate fallback provenance must name at least one limitation.");
  }
  if (input.fidelity === "equivalent" && input.approximationLimits.length > 0) {
    throw new Error("Equivalent fallback provenance cannot declare approximation limits.");
  }
  const base = {
    ...input,
    approximationLimits: Object.freeze([...input.approximationLimits]),
  };
  return Object.freeze({
    ...base,
    provenanceId: createHash("sha256").update(JSON.stringify(base)).digest("hex"),
  });
};

export const sharedFallbackWarnings = (
  layerId: string,
  provenance: SharedFallbackProvenance,
): readonly PreviewWarning[] => [
  {
    code: provenance.createdBy === "proxy" ? "proxy-in-use" : "baked-fallback",
    severity: provenance.fidelity === "equivalent" ? "info" : "warning",
    message:
      provenance.fidelity === "equivalent"
        ? `${provenance.createdBy} artifact is provenance-verified and fidelity equivalent.`
        : `${provenance.createdBy} artifact is approximate: ${provenance.approximationLimits.join("; ")}`,
    layerId,
    remedy: { label: "Inspect provenance", action: `fallback:inspect:${provenance.provenanceId}` },
  },
];
