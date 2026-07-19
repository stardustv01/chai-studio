import type { PreviewWarning } from "./preview-contract.js";

export type PreviewQuality = "draft" | "balanced" | "full";
export type PreviewTruthMode = "interactive-approximation" | "rendered-fidelity";
export type PreviewLoadClass = "nominal" | "elevated" | "critical";

export interface PreviewQualityPolicy {
  readonly quality: PreviewQuality;
  readonly truthMode: PreviewTruthMode;
  readonly mediaSource: "proxy" | "original";
  readonly resolutionScale: 0.25 | 0.5 | 0.75 | 1;
  readonly expensiveEffects: "enabled" | "disabled";
  readonly fallbackLayersAllowed: boolean;
  readonly loadClass: PreviewLoadClass;
  readonly fidelityEquivalent: boolean;
  readonly warnings: readonly PreviewWarning[];
}

export const resolvePreviewQualityPolicy = (input: {
  readonly quality: PreviewQuality;
  readonly truthMode: PreviewTruthMode;
  readonly loadClass?: PreviewLoadClass;
  readonly hasBakedFallback?: boolean;
  readonly unsupportedEffects?: boolean;
}): PreviewQualityPolicy => {
  const loadClass = input.loadClass ?? "nominal";
  if (input.truthMode === "rendered-fidelity") {
    return {
      quality: "full",
      truthMode: "rendered-fidelity",
      mediaSource: "original",
      resolutionScale: 1,
      expensiveEffects: "enabled",
      fallbackLayersAllowed: false,
      loadClass,
      fidelityEquivalent: true,
      warnings: [],
    };
  }
  const effectiveQuality = loadClass === "critical" ? "draft" : input.quality;
  const settings =
    effectiveQuality === "draft"
      ? { resolutionScale: 0.25 as const, expensiveEffects: "disabled" as const }
      : effectiveQuality === "balanced"
        ? { resolutionScale: 0.5 as const, expensiveEffects: "disabled" as const }
        : { resolutionScale: 0.75 as const, expensiveEffects: "enabled" as const };
  const warnings: PreviewWarning[] = [
    warning(
      "proxy-in-use",
      "Interactive preview uses proxy media and is not final-render truth.",
      "Switch to rendered fidelity",
      "preview.request-fidelity",
    ),
    warning(
      "render-required-difference",
      "Some final compositor behavior requires a rendered-fidelity request.",
      "Render exact frame",
      "preview.render-exact-frame",
    ),
  ];
  if (input.hasBakedFallback === true) {
    warnings.push(
      warning(
        "baked-fallback",
        "A prepared fallback is replacing a native interactive layer.",
        "Inspect fallback",
        "preview.inspect-fallback",
      ),
    );
  }
  if (input.unsupportedEffects === true) {
    warnings.push(
      warning(
        "unsupported-effect",
        "An effect is unavailable in interactive preview.",
        "Render exact frame",
        "preview.render-exact-frame",
      ),
    );
  }
  return {
    quality: input.quality,
    truthMode: input.truthMode,
    mediaSource: "proxy",
    ...settings,
    fallbackLayersAllowed: true,
    loadClass,
    fidelityEquivalent: false,
    warnings,
  };
};

export const warning = (
  code: PreviewWarning["code"],
  message: string,
  remedyLabel: string,
  remedyAction: string,
  layerId: string | null = null,
  severity: PreviewWarning["severity"] = "warning",
): PreviewWarning => ({
  code,
  severity,
  message,
  layerId,
  remedy: { label: remedyLabel, action: remedyAction },
});

export const createPreviewIntegrityWarnings = (input: {
  readonly missingAssetIds?: readonly string[];
  readonly missingFontIds?: readonly string[];
  readonly proxyInUse?: boolean;
  readonly bakedFallbackLayerIds?: readonly string[];
  readonly unsupportedEffectLayerIds?: readonly string[];
  readonly staleCacheAdapterIds?: readonly string[];
  readonly bufferingFor?: readonly ("media" | "engine" | "render-fallback" | "audio")[];
  readonly droppedFrames?: number;
  readonly renderRequiredDifference?: boolean;
}): readonly PreviewWarning[] => {
  const warnings: PreviewWarning[] = [];
  for (const assetId of [...(input.missingAssetIds ?? [])].sort()) {
    warnings.push(
      warning(
        "missing-asset",
        `Preview asset ${assetId} is missing.`,
        "Relink asset",
        "media.relink",
        assetId,
        "error",
      ),
    );
  }
  for (const fontId of [...(input.missingFontIds ?? [])].sort()) {
    warnings.push(
      warning(
        "missing-font",
        `Preview font ${fontId} is missing.`,
        "Resolve font",
        "media.resolve-font",
        fontId,
        "error",
      ),
    );
  }
  if (input.proxyInUse === true) {
    warnings.push(
      warning(
        "proxy-in-use",
        "Interactive preview uses proxy media and is not final-render truth.",
        "Switch to rendered fidelity",
        "preview.request-fidelity",
      ),
    );
  }
  for (const layerId of [...(input.bakedFallbackLayerIds ?? [])].sort()) {
    warnings.push(
      warning(
        "baked-fallback",
        `Layer ${layerId} is using a prepared fallback.`,
        "Inspect fallback",
        "preview.inspect-fallback",
        layerId,
      ),
    );
  }
  for (const layerId of [...(input.unsupportedEffectLayerIds ?? [])].sort()) {
    warnings.push(
      warning(
        "unsupported-effect",
        `Layer ${layerId} contains an effect unavailable in interactive preview.`,
        "Render exact frame",
        "preview.render-exact-frame",
        layerId,
      ),
    );
  }
  if ((input.staleCacheAdapterIds?.length ?? 0) > 0) {
    warnings.push(
      warning(
        "stale-cache",
        `Stale preview cache reported by ${[...(input.staleCacheAdapterIds ?? [])].sort().join(", ")}.`,
        "Refresh cache",
        "preview.refresh-cache",
      ),
    );
  }
  if ((input.bufferingFor?.length ?? 0) > 0) {
    warnings.push(
      warning(
        "buffering",
        `Preview is waiting for ${[...(input.bufferingFor ?? [])].sort().join(", ")}.`,
        "Inspect preload",
        "preview.open-buffering-diagnostics",
      ),
    );
  }
  if ((input.droppedFrames ?? 0) > 0) {
    warnings.push(
      warning(
        "dropped-frames",
        `${String(input.droppedFrames)} preview frames were dropped.`,
        "Inspect sync diagnostics",
        "preview.open-sync-diagnostics",
      ),
    );
  }
  if (input.renderRequiredDifference === true) {
    warnings.push(
      warning(
        "render-required-difference",
        "Final compositor behavior requires a rendered-fidelity request.",
        "Render exact frame",
        "preview.render-exact-frame",
      ),
    );
  }
  return warnings;
};
