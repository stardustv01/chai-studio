import { compareRationals } from "@chai-studio/schema";
import type {
  RemotionAdapterDiagnostic,
  RemotionCompositionDescriptor,
  RemotionDiscoveryReport,
  RemotionSourceDescriptor,
} from "./contracts.js";
import { pinnedRemotionVersion } from "./contracts.js";
import { browserLogToDiagnostic, remotionDiagnostic } from "./diagnostics.js";
import type { RemotionRuntime } from "./runtime-contract.js";
import { rationalFromRemotionFps, validateRemotionSource } from "./validation.js";

export const discoverRemotionCompositions = async (input: {
  readonly source: RemotionSourceDescriptor;
  readonly runtime: RemotionRuntime;
  readonly browserExecutable?: string;
  readonly signal: AbortSignal;
}): Promise<RemotionDiscoveryReport> => {
  const diagnostics: RemotionAdapterDiagnostic[] = [];
  const preliminary = await validateRemotionSource(input.source);
  diagnostics.push(...preliminary.diagnostics);
  for (const [runtimeName, actualVersion] of Object.entries(input.runtime.versions)) {
    if (actualVersion !== pinnedRemotionVersion) {
      diagnostics.push(
        remotionDiagnostic({
          category: "compatibility",
          code: "remotion.runtime.version-mismatch",
          severity: "error",
          stage: "composition-discovery",
          message: `${runtimeName} runtime ${actualVersion} does not match ${pinnedRemotionVersion}.`,
          repairHint: "Restore the pinned Remotion lockfile before discovery or rendering.",
          sourcePath: input.source.entryPoint,
          compositionId: input.source.compositionId,
        }),
      );
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return emptyReport(input.source, diagnostics);
  }
  let serveUrl: string;
  try {
    serveUrl = await input.runtime.bundle(input.source.entryPoint, input.signal);
  } catch (cause) {
    diagnostics.push(
      remotionDiagnostic({
        category: "discovery",
        code: "remotion.bundle.failed",
        severity: "error",
        stage: "composition-bundle",
        message: cause instanceof Error ? cause.message : String(cause),
        repairHint: "Fix the entry-point bundle error and retry discovery.",
        sourcePath: input.source.entryPoint,
        compositionId: input.source.compositionId,
      }),
    );
    return emptyReport(input.source, diagnostics);
  }
  const browserLogs: Parameters<typeof browserLogToDiagnostic>[0][] = [];
  let runtimeCompositions;
  try {
    runtimeCompositions = await input.runtime.discover({
      serveUrl,
      inputProps: input.source.inputProps,
      ...(input.browserExecutable === undefined ? {} : { browserExecutable: input.browserExecutable }),
      signal: input.signal,
      onBrowserLog: (log) => {
        browserLogs.push(log);
      },
    });
  } catch (cause) {
    diagnostics.push(
      remotionDiagnostic({
        category: "discovery",
        code: "remotion.discovery.failed",
        severity: "error",
        stage: "composition-discovery",
        message: cause instanceof Error ? cause.message : String(cause),
        repairHint: "Inspect browser and delay diagnostics, then fix the composition root.",
        sourcePath: input.source.entryPoint,
        compositionId: input.source.compositionId,
      }),
    );
    diagnostics.push(...browserLogs.map(browserLogToDiagnostic));
    return { ...emptyReport(input.source, diagnostics), serveUrl };
  }
  diagnostics.push(...browserLogs.map(browserLogToDiagnostic));
  const duplicatedIds = duplicateIds(runtimeCompositions.map((composition) => composition.id));
  for (const compositionId of duplicatedIds) {
    diagnostics.push(
      remotionDiagnostic({
        category: "discovery",
        code: "remotion.composition.duplicate-id",
        severity: "error",
        stage: "composition-discovery",
        message: `Composition ID ${compositionId} is ambiguous.`,
        repairHint: "Give every Remotion composition a unique stable ID.",
        sourcePath: input.source.entryPoint,
        compositionId,
      }),
    );
  }
  const compositions = runtimeCompositions.map((composition): RemotionCompositionDescriptor => {
    validateDimensions(composition.width, composition.height, composition.id, input.source, diagnostics);
    if (!Number.isSafeInteger(composition.durationInFrames) || composition.durationInFrames < 1) {
      diagnostics.push(
        remotionDiagnostic({
          category: "discovery",
          code: "remotion.composition.duration-invalid",
          severity: "error",
          stage: "composition-discovery",
          message: `Composition ${composition.id} has invalid duration ${String(composition.durationInFrames)}.`,
          repairHint: "Use a positive safe integer durationInFrames.",
          sourcePath: input.source.componentPath,
          compositionId: composition.id,
        }),
      );
    }
    const discoveredFps = rationalFromRemotionFps(composition.fps);
    const fps = composition.id === input.source.compositionId ? input.source.declaredFps : discoveredFps;
    if (
      composition.id === input.source.compositionId &&
      compareRationals(discoveredFps, input.source.declaredFps) !== 0
    ) {
      const numericDeclared =
        Number(input.source.declaredFps.numerator) / Number(input.source.declaredFps.denominator);
      if (Math.abs(composition.fps - numericDeclared) > 1e-6) {
        diagnostics.push(
          remotionDiagnostic({
            category: "discovery",
            code: "remotion.composition.fps-invalid",
            severity: "error",
            stage: "composition-discovery",
            message: `Composition ${composition.id} FPS does not match its declared rational rate.`,
            repairHint: "Declare the exact rational rate used by the composition.",
            sourcePath: input.source.componentPath,
            compositionId: composition.id,
          }),
        );
      }
    }
    return {
      compositionId: composition.id,
      sourceId: input.source.sourceId,
      componentPath: input.source.componentPath,
      width: composition.width,
      height: composition.height,
      fps,
      durationFrames: Math.max(0, composition.durationInFrames).toString(10),
      defaultProps: composition.defaultProps,
      calculatedProps: composition.props,
      inputPropsSchema: composition.id === input.source.compositionId ? input.source.inputPropsSchema : null,
      adapterVersion: pinnedRemotionVersion,
    };
  });
  const selected =
    input.source.compositionId === null
      ? compositions.length === 1
        ? (compositions[0] ?? null)
        : null
      : (compositions.find((composition) => composition.compositionId === input.source.compositionId) ??
        null);
  if (selected === null) {
    diagnostics.push(
      remotionDiagnostic({
        category: "discovery",
        code:
          input.source.compositionId === null
            ? "remotion.composition.selection-ambiguous"
            : "remotion.composition.missing",
        severity: "error",
        stage: "composition-selection",
        message:
          input.source.compositionId === null
            ? "The source exposes multiple compositions and does not select one."
            : `Composition ${input.source.compositionId} was not discovered.`,
        repairHint: "Select one discovered composition ID explicitly.",
        sourcePath: input.source.entryPoint,
        compositionId: input.source.compositionId,
      }),
    );
  }
  return {
    sourceId: input.source.sourceId,
    serveUrl,
    compositions,
    selectedComposition: selected,
    diagnostics,
    valid: selected !== null && !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
};

const emptyReport = (
  source: RemotionSourceDescriptor,
  diagnostics: readonly RemotionAdapterDiagnostic[],
): RemotionDiscoveryReport => ({
  sourceId: source.sourceId,
  serveUrl: null,
  compositions: [],
  selectedComposition: null,
  diagnostics,
  valid: false,
});

const duplicateIds = (ids: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
};

const validateDimensions = (
  width: number,
  height: number,
  compositionId: string,
  source: RemotionSourceDescriptor,
  diagnostics: RemotionAdapterDiagnostic[],
): void => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16_384 ||
    height > 16_384
  ) {
    diagnostics.push(
      remotionDiagnostic({
        category: "discovery",
        code: "remotion.composition.dimensions-invalid",
        severity: "error",
        stage: "composition-discovery",
        message: `Composition ${compositionId} dimensions ${String(width)}x${String(height)} are invalid.`,
        repairHint: "Use positive integer dimensions no larger than 16384 pixels per side.",
        sourcePath: source.componentPath,
        compositionId,
      }),
    );
  }
};
