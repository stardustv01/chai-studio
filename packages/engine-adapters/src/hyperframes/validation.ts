import { access, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  HyperframesCliEnvelope,
  HyperframesCliFinding,
  HyperframesCompositionDescriptor,
  HyperframesDiagnostic,
  HyperframesDiagnosticCategory,
  HyperframesSourceDescriptor,
  HyperframesValidationReport,
} from "./contracts.js";
import { pinnedHyperframesVersion } from "./contracts.js";
import { cliFindingToDiagnostic, hyperframesDiagnostic } from "./diagnostics.js";
import { parseHyperframesSource } from "./parser.js";
import type { HyperframesCommandRuntime } from "./process-runtime.js";
import { selectHyperframesWorkerPolicy } from "./trust-policy.js";

export const validateHyperframesSource = async (input: {
  readonly source: HyperframesSourceDescriptor;
  readonly composition: HyperframesCompositionDescriptor | null;
  readonly runtime: HyperframesCommandRuntime;
  readonly signal: AbortSignal;
  readonly browserCheck?: boolean;
}): Promise<HyperframesValidationReport> => {
  const diagnostics: HyperframesDiagnostic[] = [];
  const workerPolicy = selectHyperframesWorkerPolicy(input.source);
  const projectRoot = await canonical(input.source.projectRoot);
  const entryFile = await canonical(input.source.entryFile);
  if (!path.isAbsolute(input.source.projectRoot) || !path.isAbsolute(input.source.entryFile)) {
    diagnostics.push(
      policyError("hyperframes.source.path-not-absolute", "Source paths must be absolute.", input.source),
    );
  }
  if (!isInside(entryFile, projectRoot)) {
    diagnostics.push(
      policyError(
        "hyperframes.source.path-outside-project",
        "Entry file escapes the project root.",
        input.source,
      ),
    );
  }
  try {
    await access(entryFile);
  } catch {
    diagnostics.push(policyError("hyperframes.source.entry-missing", "Entry file is missing.", input.source));
  }
  if (
    input.source.expectedVersion !== pinnedHyperframesVersion ||
    input.runtime.version !== pinnedHyperframesVersion
  ) {
    diagnostics.push(
      policyError(
        "hyperframes.runtime.version-mismatch",
        "Source and runtime must use the exact accepted HyperFrames version.",
        input.source,
      ),
    );
  }
  const parsed = await parseHyperframesSource(input.source);
  const approvedUrls = new Set(input.source.approvedNetworkResources.map((resource) => resource.url));
  for (const resource of input.source.approvedNetworkResources) {
    if (!/^[a-f0-9]{64}$/.test(resource.contentHash)) {
      diagnostics.push(
        policyError(
          "hyperframes.network.hash-invalid",
          `Approved URL ${resource.url} lacks a SHA-256 hash.`,
          input.source,
        ),
      );
    }
  }
  for (const url of parsed.externalUrls) {
    if (input.source.trustClass === "imported-untrusted" || !approvedUrls.has(url)) {
      diagnostics.push(
        policyError(
          "hyperframes.network.unapproved",
          `Source references network resource ${url} outside its trust policy.`,
          input.source,
        ),
      );
    }
  }
  const policyPatterns: readonly [RegExp, string, string][] = [
    [/\bwindow\.open\s*\(/, "hyperframes.policy.popup", "Popups are forbidden."],
    [
      /\b(?:location\.(?:assign|replace)|window\.location\s*=)/,
      "hyperframes.policy.navigation",
      "Navigation is forbidden.",
    ],
    [/<a\b[^>]*\bdownload\b/i, "hyperframes.policy.download", "Downloads are forbidden."],
    [/\b(?:eval|Function)\s*\(/, "hyperframes.policy.dynamic-code", "Dynamic code evaluation is forbidden."],
  ];
  for (const [expression, code, message] of policyPatterns) {
    if (expression.test(parsed.html)) diagnostics.push(policyError(code, message, input.source));
  }
  if (/\b(?:Math\.random|Date\.now)\s*\(/.test(parsed.html)) {
    diagnostics.push(
      warning(
        "hyperframes.validation.nondeterministic-api",
        "Composition references nondeterministic time or random state.",
        input.source,
      ),
    );
  }
  if (/\b(?:requestAnimationFrame|setInterval)\s*\(/.test(parsed.html)) {
    diagnostics.push(
      policyError(
        "hyperframes.validation.independent-clock",
        "Composition starts an independent clock outside the seekable framework timeline.",
        input.source,
      ),
    );
  }
  for (const adapter of parsed.frameAdapters) {
    if (!adapter.seekable) {
      diagnostics.push(
        policyError(
          "hyperframes.validation.adapter-not-seekable",
          `Frame adapter ${adapter.adapterId} is not registered as seekable.`,
          input.source,
        ),
      );
    }
    if (adapter.kind === "three" || adapter.kind === "shader" || adapter.kind === "pixijs") {
      diagnostics.push(
        warning(
          "hyperframes.validation.expensive-state",
          `${adapter.kind} state may require a baked fallback for interactive preview.`,
          input.source,
        ),
      );
    }
  }
  const declaredVariables = new Map(
    (input.composition?.variables ?? []).map((variable) => [variable.id, variable] as const),
  );
  const safeVariableIds: string[] = [];
  const blockedVariableIds: string[] = [];
  for (const variableId of Object.keys(input.source.variableOverrides).sort()) {
    const variable = declaredVariables.get(variableId);
    if (variable?.safeToEdit === true) safeVariableIds.push(variableId);
    else {
      blockedVariableIds.push(variableId);
      diagnostics.push(
        policyError(
          "hyperframes.variables.unsafe",
          `Variable ${variableId} is undeclared or fails its safe type contract.`,
          input.source,
        ),
      );
    }
  }
  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    await appendCliDiagnostics(
      input.runtime,
      "lint",
      input.source,
      input.composition,
      input.signal,
      diagnostics,
    );
    if (input.browserCheck !== false && !diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      await appendCliDiagnostics(
        input.runtime,
        "check",
        input.source,
        input.composition,
        input.signal,
        diagnostics,
      );
    }
  }
  return {
    sourceId: input.source.sourceId,
    compositionId: input.composition?.compositionId ?? input.source.compositionId,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    seekable: !diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "hyperframes.validation.independent-clock" ||
        diagnostic.code === "hyperframes.validation.adapter-not-seekable",
    ),
    diagnostics,
    safeVariableIds,
    blockedVariableIds,
    workerPolicy,
  };
};

const appendCliDiagnostics = async (
  runtime: HyperframesCommandRuntime,
  command: "lint" | "check",
  source: HyperframesSourceDescriptor,
  composition: HyperframesCompositionDescriptor | null,
  signal: AbortSignal,
  diagnostics: HyperframesDiagnostic[],
): Promise<void> => {
  let payload: HyperframesCliEnvelope;
  try {
    payload = await runtime.runJson(command, [source.projectRoot], {
      cwd: source.projectRoot,
      signal,
    });
  } catch (cause) {
    diagnostics.push(
      policyError(
        `hyperframes.${command}.failed`,
        cause instanceof Error ? cause.message : String(cause),
        source,
      ),
    );
    return;
  }
  const numericFps =
    composition === null ? 30 : Number(composition.fps.numerator) / Number(composition.fps.denominator);
  if (command === "lint") {
    diagnostics.push(
      ...(payload.findings ?? []).map((finding) =>
        cliFindingToDiagnostic(
          finding,
          "validation",
          composition?.compositionId ?? source.compositionId,
          numericFps,
        ),
      ),
    );
    return;
  }
  const categories: readonly [HyperframesDiagnosticCategory, readonly HyperframesCliFinding[]][] = [
    ["validation", payload.lint?.findings ?? []],
    ["runtime", payload.runtime?.findings ?? []],
    ["layout", payload.layout?.findings ?? []],
    ["motion", payload.motion?.findings ?? []],
    ["contrast", payload.contrast?.findings ?? []],
  ];
  for (const [category, findings] of categories) {
    diagnostics.push(
      ...findings.map((finding) =>
        cliFindingToDiagnostic(
          finding,
          category,
          composition?.compositionId ?? source.compositionId,
          numericFps,
        ),
      ),
    );
  }
  if (payload.ok === false && !diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    diagnostics.push(
      policyError(
        "hyperframes.check.failed-without-finding",
        "HyperFrames check failed without a mapped error finding.",
        source,
      ),
    );
  }
};

const policyError = (
  code: string,
  message: string,
  source: HyperframesSourceDescriptor,
): HyperframesDiagnostic =>
  hyperframesDiagnostic({
    category: code.includes("version") ? "compatibility" : "policy",
    code,
    severity: "error",
    stage: "hyperframes-validation",
    message,
    repairHint: "Remove the violation or explicitly freeze an approved local dependency and policy.",
    sourcePath: source.entryFile,
    compositionId: source.compositionId,
  });

const warning = (code: string, message: string, source: HyperframesSourceDescriptor): HyperframesDiagnostic =>
  hyperframesDiagnostic({
    category: "validation",
    code,
    severity: "warning",
    stage: "hyperframes-validation",
    message,
    repairHint: "Replace state with declared frame-derived behavior or classify the fallback explicitly.",
    sourcePath: source.entryFile,
    compositionId: source.compositionId,
  });

const canonical = async (candidate: string): Promise<string> => {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
};

const isInside = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
