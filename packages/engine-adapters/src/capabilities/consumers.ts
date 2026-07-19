import type {
  CapabilityEngine,
  CapabilityInspectorDescriptor,
  CapabilityPreviewWarning,
  CapabilityRegistry,
  CapabilityRenderDecision,
} from "./contracts.js";
import { resolveCapability } from "./registry.js";

export const buildCapabilityInspectorDescriptors = (
  registry: CapabilityRegistry,
  requests: readonly Readonly<{ engine: CapabilityEngine; capabilityId: string }>[],
): readonly CapabilityInspectorDescriptor[] =>
  requests.map(({ engine, capabilityId }) => {
    const entry = resolveCapability(registry, engine, capabilityId);
    const controlMode =
      entry.status === "native"
        ? "editable-native"
        : entry.status === "unified"
          ? "editable-unified"
          : entry.status === "bake_required" || entry.status === "fallback_available"
            ? "conversion-required"
            : "read-only";
    return {
      capabilityId,
      family: entry.family,
      engine,
      status: entry.status,
      controlMode,
      warning:
        entry.status === "native" || entry.status === "unified"
          ? null
          : `Capability ${capabilityId} is ${entry.status.replaceAll("_", " ")}.`,
      fixtureId: entry.fixture.fixtureId,
    };
  });

export const capabilityPreviewWarnings = (
  registry: CapabilityRegistry,
  requests: readonly Readonly<{ engine: CapabilityEngine; capabilityId: string }>[],
): readonly CapabilityPreviewWarning[] =>
  requests.flatMap(({ engine, capabilityId }) => {
    const entry = resolveCapability(registry, engine, capabilityId);
    if (entry.status === "native" || entry.status === "unified") return [];
    const code =
      entry.status === "bake_required"
        ? "capability-bake-required"
        : entry.status === "fallback_available"
          ? "capability-fallback"
          : entry.status === "unsupported"
            ? "capability-unsupported"
            : "capability-experimental";
    return [
      {
        capabilityId,
        severity: entry.status === "unsupported" ? "error" : "warning",
        code,
        message: `${engine} capability ${capabilityId} is ${entry.status.replaceAll("_", " ")}.`,
        remedy:
          entry.fallback === null
            ? entry.status === "experimental"
              ? "Explicitly opt in after reviewing evidence and limitations."
              : "Remove or replace the unsupported capability."
            : `Use declared fallback ${entry.fallback.fallbackId}.`,
      },
    ];
  });

export const planCapabilityRender = (
  registry: CapabilityRegistry,
  request: Readonly<{ engine: CapabilityEngine; capabilityId: string; experimentalOptIn: boolean }>,
): CapabilityRenderDecision => {
  const entry = resolveCapability(registry, request.engine, request.capabilityId);
  const action =
    entry.status === "native"
      ? "native"
      : entry.status === "unified"
        ? "unified"
        : entry.status === "bake_required"
          ? "bake"
          : entry.status === "fallback_available"
            ? "fallback"
            : entry.status === "experimental" && request.experimentalOptIn
              ? "experimental-opt-in"
              : "block";
  return {
    capabilityId: entry.capabilityId,
    engine: entry.engine,
    status: entry.status,
    action,
    fallbackId: action === "bake" || action === "fallback" ? (entry.fallback?.fallbackId ?? null) : null,
    requiresUserOptIn: entry.status === "experimental",
    approximation: entry.fallback?.fidelity === "approximation",
    evidenceIds: entry.evidence.map((evidence) => evidence.evidenceId),
  };
};

export const selectCapabilityFallback = (
  registry: CapabilityRegistry,
  engine: CapabilityEngine,
  capabilityId: string,
) => resolveCapability(registry, engine, capabilityId).fallback;

export const selectCapabilityUpgradeFixtures = (
  registry: CapabilityRegistry,
  input: Readonly<{
    changedEngines: readonly CapabilityEngine[];
    changedCapabilityIds?: readonly string[];
  }>,
): readonly string[] => {
  const engines = new Set(input.changedEngines);
  const capabilities = input.changedCapabilityIds === undefined ? null : new Set(input.changedCapabilityIds);
  return [
    ...new Set(
      registry.entries
        .filter(
          (entry) =>
            engines.has(entry.engine) && (capabilities === null || capabilities.has(entry.capabilityId)),
        )
        .map((entry) => entry.fixture.testPath),
    ),
  ].sort();
};
