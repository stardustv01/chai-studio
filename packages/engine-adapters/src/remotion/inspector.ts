import type {
  RemotionCompositionDescriptor,
  RemotionInspectorControl,
  RemotionInspectorDescriptor,
  RemotionValidationReport,
} from "./contracts.js";
import type { TimelinePropertyState } from "@chai-studio/timeline";
import { pinnedRemotionVersion } from "./contracts.js";

export const createRemotionInspectorDescriptor = (input: {
  readonly composition: RemotionCompositionDescriptor;
  readonly validation: RemotionValidationReport;
}): RemotionInspectorDescriptor => {
  const schema = input.composition.inputPropsSchema;
  const required = new Set(schema?.required ?? []);
  const safe = new Set(input.validation.safeInputPropNames);
  const controls: RemotionInspectorControl[] = [];
  const propNames = new Set([
    ...Object.keys(input.composition.defaultProps),
    ...Object.keys(input.composition.calculatedProps),
    ...Object.keys(schema?.properties ?? {}),
  ]);
  for (const propName of [...propNames].sort()) {
    const property = schema?.properties[propName];
    const value =
      input.composition.calculatedProps[propName] ?? input.composition.defaultProps[propName] ?? null;
    const mutable = property !== undefined && safe.has(propName) && property.readOnly !== true;
    controls.push({
      propName,
      label: property?.title ?? titleCase(propName),
      control: property === undefined ? "readonly-json" : controlFor(property.type, property.enum),
      required: required.has(propName),
      readOnly: !mutable,
      value,
      options: property?.enum ?? [],
      minimum: property?.minimum ?? null,
      maximum: property?.maximum ?? null,
      warning:
        property === undefined
          ? "No safe input-prop schema is declared."
          : mutable
            ? null
            : "This prop is complex, blocked, or explicitly read-only.",
    });
  }
  return {
    compositionId: input.composition.compositionId,
    sourcePath: input.composition.componentPath,
    dimensions: { width: input.composition.width, height: input.composition.height },
    fps: input.composition.fps,
    durationFrames: input.composition.durationFrames,
    adapterVersion: pinnedRemotionVersion,
    controls,
    warnings: input.validation.diagnostics
      .filter((diagnostic) => diagnostic.severity !== "info")
      .map((diagnostic) => diagnostic.message),
    capabilityClassifications: {
      reactComponents: "native",
      remotionSequences: "native",
      commonTransforms: "unified",
      programAudio: "unified",
      unsupportedInteractiveEffects: "bake_required",
    },
  };
};

export const remotionInspectorPropertyStates = (
  descriptor: RemotionInspectorDescriptor,
): Readonly<Record<string, TimelinePropertyState>> =>
  Object.fromEntries(
    descriptor.controls.map((control) => [
      `native.remotion.${control.propName}`,
      {
        value: inspectorValue(control.value),
        defaultValue: inspectorValue(control.value),
        unit:
          control.control === "number" || control.control === "integer"
            ? "ratio"
            : control.control === "boolean"
              ? "boolean"
              : control.control === "select"
                ? "enum"
                : "text",
        minimum: control.minimum,
        maximum: control.maximum,
        step: control.control === "integer" ? 1 : control.control === "number" ? 0.01 : null,
        ownership: "engine-native",
        keyframeable: false,
        capability: "native",
        safeToEdit: !control.readOnly && isInspectorValue(control.value),
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

const controlFor = (
  type: "string" | "number" | "integer" | "boolean" | "array" | "object",
  enumValues: readonly (string | number | boolean)[] | undefined,
): RemotionInspectorControl["control"] =>
  enumValues !== undefined
    ? "select"
    : type === "string"
      ? "text"
      : type === "number"
        ? "number"
        : type === "integer"
          ? "integer"
          : type === "boolean"
            ? "boolean"
            : "readonly-json";

const titleCase = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
