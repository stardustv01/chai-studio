export const capabilityStatuses = [
  "native",
  "unified",
  "bake_required",
  "fallback_available",
  "unsupported",
  "experimental",
] as const;

export type CapabilityStatus = (typeof capabilityStatuses)[number];
export type CapabilityEngine = "shared" | "remotion" | "hyperframes" | "render-core";
export type CapabilityFamily =
  | "typography"
  | "media"
  | "captions"
  | "audio"
  | "react"
  | "html-css"
  | "svg"
  | "canvas"
  | "lottie"
  | "rive"
  | "gsap"
  | "waapi"
  | "three-webgl"
  | "shaders"
  | "particles"
  | "transitions"
  | "alpha"
  | "hdr-color-depth"
  | "distributed-rendering";

export interface CapabilityEvidence {
  readonly evidenceId: string;
  readonly level: "contract" | "runtime" | "visual" | "deterministic";
  readonly artifactPath: string;
  readonly assertion: string;
  readonly testedVersion: string;
}

export interface CapabilityFallback {
  readonly fallbackId: string;
  readonly kind: "proxy" | "baked" | "shared-equivalent";
  readonly owner: CapabilityEngine;
  readonly fidelity: "equivalent" | "approximation";
  readonly limitations: readonly string[];
}

export interface CapabilityFixture {
  readonly fixtureId: string;
  readonly testPath: string;
  readonly assertions: readonly string[];
}

export interface CapabilityEntry {
  readonly capabilityId: string;
  readonly family: CapabilityFamily;
  readonly engine: CapabilityEngine;
  readonly status: CapabilityStatus;
  readonly owner: CapabilityEngine;
  readonly previewBehavior: "native" | "shared" | "proxy" | "baked" | "blocked" | "opt-in";
  readonly renderBehavior: "native" | "shared" | "baked" | "blocked" | "opt-in";
  readonly fallback: CapabilityFallback | null;
  readonly restrictions: readonly string[];
  readonly fixture: CapabilityFixture;
  readonly evidence: readonly CapabilityEvidence[];
}

export interface CapabilityRegistry {
  readonly schemaVersion: "1.0.0";
  readonly registryId: string;
  readonly entries: readonly CapabilityEntry[];
}

export interface CapabilityInspectorDescriptor {
  readonly capabilityId: string;
  readonly family: CapabilityFamily;
  readonly engine: CapabilityEngine;
  readonly status: CapabilityStatus;
  readonly controlMode: "editable-native" | "editable-unified" | "read-only" | "conversion-required";
  readonly warning: string | null;
  readonly fixtureId: string;
}

export interface CapabilityPreviewWarning {
  readonly capabilityId: string;
  readonly severity: "info" | "warning" | "error";
  readonly code:
    "capability-bake-required" | "capability-fallback" | "capability-unsupported" | "capability-experimental";
  readonly message: string;
  readonly remedy: string;
}

export interface CapabilityRenderDecision {
  readonly capabilityId: string;
  readonly engine: CapabilityEngine;
  readonly status: CapabilityStatus;
  readonly action: "native" | "unified" | "bake" | "fallback" | "block" | "experimental-opt-in";
  readonly fallbackId: string | null;
  readonly requiresUserOptIn: boolean;
  readonly approximation: boolean;
  readonly evidenceIds: readonly string[];
}
