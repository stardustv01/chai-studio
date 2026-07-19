import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { compareRationals, normalizeRational } from "@chai-studio/schema";
import type {
  HyperframesCompositionDescriptor,
  HyperframesCliEnvelope,
  HyperframesDiagnostic,
  HyperframesDiscoveryReport,
  HyperframesSourceDescriptor,
} from "./contracts.js";
import { pinnedHyperframesVersion } from "./contracts.js";
import { hyperframesDiagnostic } from "./diagnostics.js";
import { parseHyperframesSource } from "./parser.js";
import type { HyperframesCommandRuntime } from "./process-runtime.js";

interface CliComposition {
  readonly id?: unknown;
  readonly duration?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly elementCount?: unknown;
}

export const discoverHyperframesCompositions = async (input: {
  readonly source: HyperframesSourceDescriptor;
  readonly runtime: HyperframesCommandRuntime;
  readonly signal: AbortSignal;
}): Promise<HyperframesDiscoveryReport> => {
  const diagnostics: HyperframesDiagnostic[] = [];
  const canonicalRoot = await canonical(input.source.projectRoot);
  const canonicalEntry = await canonical(input.source.entryFile);
  if (!path.isAbsolute(input.source.projectRoot) || !path.isAbsolute(input.source.entryFile)) {
    diagnostics.push(
      error(
        "hyperframes.source.path-not-absolute",
        "Project and entry paths must be absolute.",
        input.source,
      ),
    );
  }
  if (!isInside(canonicalEntry, canonicalRoot)) {
    diagnostics.push(
      error("hyperframes.source.path-outside-project", "Entry file escapes the project root.", input.source),
    );
  }
  try {
    await access(canonicalEntry);
  } catch {
    diagnostics.push(
      error("hyperframes.source.entry-missing", "HyperFrames entry file is missing.", input.source),
    );
  }
  if (input.source.expectedVersion !== pinnedHyperframesVersion) {
    diagnostics.push(
      error(
        "hyperframes.version.unpinned",
        `Expected HyperFrames ${input.source.expectedVersion} does not match ${pinnedHyperframesVersion}.`,
        input.source,
      ),
    );
  }
  if (input.runtime.version !== pinnedHyperframesVersion) {
    diagnostics.push(
      error(
        "hyperframes.runtime.version-mismatch",
        `HyperFrames runtime ${input.runtime.version} does not match ${pinnedHyperframesVersion}.`,
        input.source,
      ),
    );
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    return emptyReport(input.source, diagnostics);

  const parsed = await parseHyperframesSource(input.source);
  let cliPayload: HyperframesCliEnvelope & Readonly<{ compositions?: unknown }>;
  try {
    cliPayload = await input.runtime.runJson("compositions", [input.source.projectRoot], {
      cwd: input.source.projectRoot,
      signal: input.signal,
    });
  } catch (cause) {
    diagnostics.push(
      error(
        "hyperframes.discovery.failed",
        cause instanceof Error ? cause.message : String(cause),
        input.source,
      ),
    );
    return emptyReport(input.source, diagnostics);
  }
  const cliCompositions = Array.isArray(cliPayload.compositions)
    ? (cliPayload.compositions as readonly CliComposition[])
    : [];
  const htmlIds = parsed.compositions.map((composition) => composition.id);
  for (const duplicateId of duplicates(htmlIds)) {
    diagnostics.push(
      error(
        "hyperframes.composition.duplicate-id",
        `Composition ID ${duplicateId} is declared more than once.`,
        input.source,
        duplicateId,
      ),
    );
  }
  const compositions = cliCompositions.flatMap((cli): readonly HyperframesCompositionDescriptor[] => {
    const id = typeof cli.id === "string" ? cli.id : "";
    const declared = parsed.compositions.find((composition) => composition.id === id);
    if (declared === undefined) {
      diagnostics.push(
        error(
          "hyperframes.composition.cli-html-conflict",
          `CLI composition ${id || "<missing>"} has no matching HTML declaration.`,
          input.source,
          id || null,
        ),
      );
      return [];
    }
    const width = numeric(cli.width);
    const height = numeric(cli.height);
    const durationSeconds = numeric(cli.duration);
    const elementCount = numeric(cli.elementCount);
    if (
      width === null ||
      height === null ||
      durationSeconds === null ||
      elementCount === null ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(elementCount) ||
      width < 1 ||
      height < 1 ||
      durationSeconds <= 0 ||
      elementCount < 0
    ) {
      diagnostics.push(
        error(
          "hyperframes.composition.metadata-invalid",
          `Composition ${id} returned invalid CLI metadata.`,
          input.source,
          id,
        ),
      );
      return [];
    }
    if (
      declared.width !== width ||
      declared.height !== height ||
      declared.durationSeconds !== durationSeconds ||
      declared.fps === null
    ) {
      diagnostics.push(
        error(
          "hyperframes.composition.metadata-conflict",
          `Composition ${id} CLI and declared metadata conflict or omit FPS.`,
          input.source,
          id,
        ),
      );
    }
    const fps = declared.fps ?? input.source.declaredFps;
    if (id === input.source.compositionId && compareRationals(fps, input.source.declaredFps) !== 0) {
      diagnostics.push(
        error(
          "hyperframes.composition.fps-mismatch",
          `Composition ${id} FPS does not match the declared rational rate.`,
          input.source,
          id,
        ),
      );
    }
    const numericFps = Number(fps.numerator) / Number(fps.denominator);
    const durationFrames = Math.round(durationSeconds * numericFps);
    if (
      !Number.isSafeInteger(durationFrames) ||
      Math.abs(durationFrames / numericFps - durationSeconds) > 1e-6
    ) {
      diagnostics.push(
        error(
          "hyperframes.composition.duration-not-frame-exact",
          `Composition ${id} duration does not end on an exact declared frame.`,
          input.source,
          id,
        ),
      );
    }
    return [
      {
        compositionId: id,
        sourceId: input.source.sourceId,
        sourcePath: parsed.sourcePath,
        width,
        height,
        fps: normalizeRational(BigInt(fps.numerator), BigInt(fps.denominator)),
        durationSeconds,
        durationFrames: Math.max(0, durationFrames).toString(10),
        elementCount,
        tracks: declared.tracks,
        timingAttributeCount: declared.timingAttributeCount,
        variables: declared.variables,
        frameAdapters: parsed.frameAdapters,
        adapterVersion: pinnedHyperframesVersion,
      },
    ];
  });
  for (const declaredId of htmlIds) {
    if (!cliCompositions.some((composition) => composition.id === declaredId)) {
      diagnostics.push(
        error(
          "hyperframes.composition.not-inspectable",
          `Declared composition ${declaredId} was not returned by the CLI.`,
          input.source,
          declaredId,
        ),
      );
    }
  }
  const selected =
    input.source.compositionId === null
      ? compositions.length === 1
        ? (compositions[0] ?? null)
        : null
      : (compositions.find((composition) => composition.compositionId === input.source.compositionId) ??
        null);
  if (selected === null) {
    diagnostics.push(
      error(
        input.source.compositionId === null
          ? "hyperframes.composition.selection-ambiguous"
          : "hyperframes.composition.missing",
        input.source.compositionId === null
          ? "HyperFrames source must select one composition when multiple are present."
          : `Composition ${input.source.compositionId} was not discovered.`,
        input.source,
        input.source.compositionId,
      ),
    );
  }
  return {
    sourceId: input.source.sourceId,
    compositions,
    selectedComposition: selected,
    diagnostics,
    valid: selected !== null && !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
};

const emptyReport = (
  source: HyperframesSourceDescriptor,
  diagnostics: readonly HyperframesDiagnostic[],
): HyperframesDiscoveryReport => ({
  sourceId: source.sourceId,
  compositions: [],
  selectedComposition: null,
  diagnostics,
  valid: false,
});

const error = (
  code: string,
  message: string,
  source: HyperframesSourceDescriptor,
  compositionId: string | null = source.compositionId,
): HyperframesDiagnostic =>
  hyperframesDiagnostic({
    category: code.includes("version") ? "compatibility" : "discovery",
    code,
    severity: "error",
    stage: "hyperframes-discovery",
    message,
    repairHint: "Correct the declared source metadata or pinned CLI environment before preview.",
    sourcePath: source.entryFile,
    compositionId,
  });

const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const canonical = async (candidate: string): Promise<string> => {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
};

const isInside = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const duplicates = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
};
