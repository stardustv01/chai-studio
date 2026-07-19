import { capabilityPreviewWarnings, type CapabilityRegistry } from "@chai-studio/engine-adapters";
import type { PreviewWarning } from "../preview-contract.js";
import type { SharedEffectsMetadata } from "./contracts.js";

export const createSharedEffectsMetadata = (input: SharedEffectsMetadata): SharedEffectsMetadata => {
  const blendModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference"];
  if (!blendModes.includes(input.blendMode))
    throw new Error(`Shared blendMode ${input.blendMode} is invalid.`);
  const finiteValues = Object.entries(input.transform);
  for (const [field, value] of finiteValues) {
    if (!Number.isFinite(value)) throw new Error(`Shared transform ${field} must be finite.`);
  }
  if (input.transform.scaleX === 0 || input.transform.scaleY === 0) {
    throw new Error("Shared transform scale cannot be zero.");
  }
  if (!Number.isFinite(input.opacity) || input.opacity < 0 || input.opacity > 1) {
    throw new Error("Shared opacity must be between zero and one.");
  }
  for (const [field, value] of Object.entries(input.crop)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Shared crop ${field} must be between zero and one.`);
    }
  }
  if (input.crop.left + input.crop.right >= 1 || input.crop.top + input.crop.bottom >= 1) {
    throw new Error("Shared crop removes the entire visual.");
  }
  const adjustmentRefs = [...new Set(input.adjustmentRefs)].sort();
  const capabilities = [...input.capabilities].sort(
    (left, right) =>
      left.engine.localeCompare(right.engine) || left.capabilityId.localeCompare(right.capabilityId),
  );
  return Object.freeze({
    ...input,
    transform: Object.freeze({ ...input.transform }),
    crop: Object.freeze({ ...input.crop }),
    adjustmentRefs: Object.freeze(adjustmentRefs),
    capabilities: Object.freeze(capabilities),
  });
};

export const sharedEffectWarnings = (
  registry: CapabilityRegistry,
  layerId: string,
  effects: SharedEffectsMetadata,
): readonly PreviewWarning[] =>
  capabilityPreviewWarnings(registry, effects.capabilities).map((warning) => ({
    code:
      warning.code === "capability-bake-required"
        ? "baked-fallback"
        : warning.code === "capability-fallback"
          ? "proxy-in-use"
          : "unsupported-effect",
    severity: warning.severity,
    message: warning.message,
    layerId,
    remedy: { label: "Resolve capability", action: warning.remedy },
  }));
