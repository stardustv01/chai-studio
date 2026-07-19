import type {
  HyperframesCompositionDescriptor,
  HyperframesInspectorDescriptor,
  HyperframesValidationReport,
} from "./contracts.js";
import type { TimelinePropertyState } from "@chai-studio/timeline";

export const createHyperframesInspectorDescriptor = (input: {
  readonly composition: HyperframesCompositionDescriptor;
  readonly validation: HyperframesValidationReport;
}): HyperframesInspectorDescriptor => ({
  compositionId: input.composition.compositionId,
  sourcePath: input.composition.sourcePath,
  dimensions: { width: input.composition.width, height: input.composition.height },
  fps: input.composition.fps,
  durationFrames: input.composition.durationFrames,
  timingAttributeCount: input.composition.timingAttributeCount,
  tracks: input.composition.tracks,
  variables: input.composition.variables.map((variable) => ({
    ...variable,
    safeToEdit: variable.safeToEdit && input.validation.safeVariableIds.includes(variable.id),
    warning:
      variable.safeToEdit && input.validation.safeVariableIds.includes(variable.id)
        ? variable.warning
        : (variable.warning ?? "Variable is read-only under the validated source policy."),
  })),
  frameAdapters: input.composition.frameAdapters,
  warnings: input.validation.diagnostics
    .filter((diagnostic) => diagnostic.severity !== "info")
    .map((diagnostic) => diagnostic.message),
  trust: {
    trustClass: input.validation.workerPolicy.trustClass,
    policyVersion: input.validation.workerPolicy.policyVersion,
    policyIdentity: input.validation.workerPolicy.cacheNamespace,
    networkMode: input.validation.workerPolicy.networkMode,
    promotionRequired: input.validation.workerPolicy.trustClass === "imported-untrusted",
  },
  capabilityClassifications: {
    htmlCss: "native",
    gsap: "native",
    lottie: "native",
    three: "native",
    rive: "native",
    waapi: "native",
    d3: "native",
    pixijs: "native",
    shaders: "native",
    commonTransforms: "unified",
    programAudio: "unified",
    nonSeekableState: "bake_required",
    navigationPopupsDownloads: "unsupported",
  },
});

export const hyperframesInspectorPropertyStates = (
  descriptor: HyperframesInspectorDescriptor,
): Readonly<Record<string, TimelinePropertyState>> =>
  Object.fromEntries(
    descriptor.variables.map((variable) => [
      `native.hyperframes.${variable.id}`,
      {
        value: inspectorValue(variable.value),
        defaultValue: inspectorValue(variable.defaultValue),
        unit:
          variable.type === "number"
            ? "ratio"
            : variable.type === "boolean"
              ? "boolean"
              : variable.type === "color"
                ? "color"
                : variable.type === "image" || variable.type === "video"
                  ? "file"
                  : "text",
        minimum: null,
        maximum: null,
        step: variable.type === "number" ? 0.01 : null,
        ownership: "engine-native",
        keyframeable: false,
        capability: "native",
        safeToEdit: variable.safeToEdit && isInspectorValue(variable.value),
        nativeAnimation: false,
        supportsSharedConversion: false,
      } satisfies TimelinePropertyState,
    ]),
  );

const inspectorValue = (value: unknown): TimelinePropertyState["value"] => {
  if (isInspectorValue(value)) return value;
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "null";
};

const isInspectorValue = (value: unknown): value is TimelinePropertyState["value"] =>
  typeof value === "number" ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every((item) => typeof item === "number"));
