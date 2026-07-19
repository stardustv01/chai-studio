import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { assertPositiveRational, compareRationals, normalizeRational } from "@chai-studio/schema";
import type {
  RemotionAdapterDiagnostic,
  RemotionCompositionDescriptor,
  RemotionInputPropSchema,
  RemotionSourceDescriptor,
  RemotionValidationReport,
} from "./contracts.js";
import { pinnedRemotionVersion } from "./contracts.js";
import { remotionDiagnostic } from "./diagnostics.js";

export const validateRemotionSource = async (
  source: RemotionSourceDescriptor,
  composition: RemotionCompositionDescriptor | null = null,
): Promise<RemotionValidationReport> => {
  const diagnostics: RemotionAdapterDiagnostic[] = [];
  const safeInputPropNames: string[] = [];
  const blockedInputPropNames: string[] = [];
  assertIdentifier(source.sourceId, "sourceId");
  assertPositiveRational(source.declaredFps, "declaredFps");
  if (!path.isAbsolute(source.projectRoot)) {
    diagnostics.push(error("remotion.source.project-root", "Project root must be an absolute path.", source));
  }
  const projectRoot = await canonicalPath(source.projectRoot);
  const entryPoint = await validateSourcePath(
    source.entryPoint,
    projectRoot,
    "entry point",
    source,
    diagnostics,
  );
  const componentPath = await validateSourcePath(
    source.componentPath,
    projectRoot,
    "component path",
    source,
    diagnostics,
  );
  if (!/\.[cm]?[jt]sx?$/.test(source.entryPoint)) {
    diagnostics.push(
      error("remotion.source.entry-extension", "Entry point must be JavaScript or TypeScript.", source),
    );
  }
  if (!/\.[cm]?[jt]sx?$/.test(source.componentPath)) {
    diagnostics.push(
      error(
        "remotion.source.component-extension",
        "Component path must be JavaScript or TypeScript.",
        source,
      ),
    );
  }
  for (const [runtime, version] of Object.entries(source.expectedVersions)) {
    if (version !== pinnedRemotionVersion) {
      diagnostics.push(
        error(
          "remotion.version.unpinned",
          `${runtime} ${version} does not match pinned ${pinnedRemotionVersion}.`,
          source,
          "Pin every Remotion runtime package to the accepted adapter version.",
        ),
      );
    }
  }
  if (
    !Number.isSafeInteger(source.delayTimeoutMs) ||
    source.delayTimeoutMs < 1_000 ||
    source.delayTimeoutMs > 120_000
  ) {
    diagnostics.push(
      error("remotion.delay.timeout", "Delay timeout must be between 1 and 120 seconds.", source),
    );
  }
  const propDiagnostics = validateProps(source.inputProps, source.inputPropsSchema, source);
  diagnostics.push(...propDiagnostics.diagnostics);
  safeInputPropNames.push(...propDiagnostics.safe);
  blockedInputPropNames.push(...propDiagnostics.blocked);
  if (composition !== null && compareRationals(composition.fps, source.declaredFps) !== 0) {
    diagnostics.push(
      error(
        "remotion.composition.fps-mismatch",
        "Discovered composition FPS does not match the declared rational FPS.",
        source,
        "Correct the declared rational rate or the Remotion composition metadata.",
      ),
    );
  }
  if (componentPath !== null) {
    const sourceText = await readFile(componentPath, "utf8");
    if (/\bdelayRender\s*\(/.test(sourceText) && !source.allowDelayRender) {
      diagnostics.push(
        error(
          "remotion.delay.not-approved",
          "The component uses delayRender but the source policy does not approve delayed rendering.",
          source,
          "Approve a bounded delay policy or remove delayRender.",
        ),
      );
    }
    if (/\b(?:eval|Function)\s*\(/.test(sourceText)) {
      diagnostics.push(
        error("remotion.source.dynamic-code", "Dynamic code evaluation is unsupported.", source),
      );
    }
    if (/\b(?:Math\.random|Date\.now)\s*\(/.test(sourceText)) {
      diagnostics.push(
        warning(
          "remotion.source.nondeterministic-api",
          "The component references a nondeterministic time or random API.",
          source,
          "Replace it with frame-derived values and declared seeds.",
        ),
      );
    }
    const networkUrls = [...sourceText.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((match) => match[0]);
    const approvedUrls = new Set(source.approvedNetworkResources.map((resource) => resource.url));
    for (const url of networkUrls) {
      if (!approvedUrls.has(url)) {
        diagnostics.push(
          error(
            "remotion.network.unapproved",
            `Source references unapproved network resource ${url}.`,
            source,
            "Freeze the resource locally or approve it with a content hash.",
          ),
        );
      }
    }
  }
  for (const assetPath of [...source.assetPaths, ...source.fontPaths, ...source.generatedCodePaths]) {
    await validateDependencyPath(assetPath, projectRoot, source, diagnostics);
  }
  if (entryPoint !== null && componentPath !== null && !componentPath.startsWith(projectRoot)) {
    diagnostics.push(
      error("remotion.source.component-outside-project", "Component path escapes the project.", source),
    );
  }
  return {
    sourceId: source.sourceId,
    compositionId: composition?.compositionId ?? source.compositionId,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
    safeInputPropNames: safeInputPropNames.sort(),
    blockedInputPropNames: blockedInputPropNames.sort(),
  };
};

export const rationalFromRemotionFps = (fps: number) => {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Remotion FPS must be finite and positive.");
  const text = fps.toString();
  if (!text.includes(".") && !/[eE]/.test(text)) return normalizeRational(BigInt(text), 1n);
  const precision = 1_000_000n;
  return normalizeRational(BigInt(Math.round(fps * Number(precision))), precision);
};

const validateProps = (
  props: Readonly<Record<string, unknown>>,
  schema: RemotionInputPropSchema | null,
  source: RemotionSourceDescriptor,
): Readonly<{
  diagnostics: readonly RemotionAdapterDiagnostic[];
  safe: readonly string[];
  blocked: readonly string[];
}> => {
  const diagnostics: RemotionAdapterDiagnostic[] = [];
  const safe: string[] = [];
  const blocked: string[] = [];
  try {
    assertJsonSafe(props, "inputProps", 0);
  } catch (cause) {
    diagnostics.push(
      error("remotion.props.not-json-safe", cause instanceof Error ? cause.message : String(cause), source),
    );
  }
  if (schema === null) {
    blocked.push(...Object.keys(props));
    if (Object.keys(props).length > 0) {
      diagnostics.push(
        warning(
          "remotion.props.schema-missing",
          "Input props have no declared safe inspector schema.",
          source,
          "Declare a bounded JSON input-prop schema; props remain read-only until then.",
        ),
      );
    }
    return { diagnostics, safe, blocked };
  }
  const required = new Set(schema.required ?? []);
  for (const requiredName of required) {
    if (!Object.hasOwn(props, requiredName)) {
      diagnostics.push(
        error("remotion.props.required", `Required input prop ${requiredName} is missing.`, source),
      );
    }
  }
  for (const [name, value] of Object.entries(props)) {
    const property = schema.properties[name];
    if (property === undefined) {
      blocked.push(name);
      if (schema.additionalProperties !== true) {
        diagnostics.push(
          error("remotion.props.unknown", `Input prop ${name} is not declared by the schema.`, source),
        );
      }
      continue;
    }
    if (!matchesPropType(value, property.type)) {
      blocked.push(name);
      diagnostics.push(
        error("remotion.props.type", `Input prop ${name} does not match ${property.type}.`, source),
      );
      continue;
    }
    if (property.readOnly === true || property.type === "array" || property.type === "object")
      blocked.push(name);
    else safe.push(name);
  }
  return { diagnostics, safe, blocked };
};

const validateSourcePath = async (
  candidate: string,
  projectRoot: string,
  label: string,
  source: RemotionSourceDescriptor,
  diagnostics: RemotionAdapterDiagnostic[],
): Promise<string | null> => {
  if (!path.isAbsolute(candidate)) {
    diagnostics.push(
      error("remotion.source.path-not-absolute", `${label} must be an absolute path.`, source),
    );
    return null;
  }
  const resolved = await canonicalPath(candidate);
  if (!isInside(resolved, projectRoot)) {
    diagnostics.push(
      error("remotion.source.path-outside-project", `${label} escapes the project root.`, source),
    );
    return null;
  }
  try {
    await access(resolved);
  } catch {
    diagnostics.push(error("remotion.source.path-missing", `${label} does not exist.`, source));
    return null;
  }
  return resolved;
};

const validateDependencyPath = async (
  candidate: string,
  projectRoot: string,
  source: RemotionSourceDescriptor,
  diagnostics: RemotionAdapterDiagnostic[],
): Promise<void> => {
  const absolute = path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
  const resolved = await canonicalPath(absolute);
  if (!isInside(resolved, projectRoot)) {
    diagnostics.push(
      error("remotion.asset.path-outside-project", `Dependency ${candidate} escapes the project.`, source),
    );
    return;
  }
  try {
    await access(resolved);
  } catch {
    diagnostics.push(error("remotion.asset.missing", `Dependency ${candidate} is missing.`, source));
  }
};

const assertJsonSafe = (value: unknown, field: string, depth: number): void => {
  if (depth > 20) throw new Error(`${field} exceeds the maximum JSON depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error(`${field} exceeds the maximum array length.`);
    value.forEach((item, index) => {
      assertJsonSafe(item, `${field}[${index.toString()}]`, depth + 1);
    });
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`${field} has a custom prototype.`);
    for (const [name, item] of Object.entries(value)) assertJsonSafe(item, `${field}.${name}`, depth + 1);
    return;
  }
  throw new Error(`${field} contains unsupported ${typeof value}.`);
};

const matchesPropType = (
  value: unknown,
  type: RemotionInputPropSchema["properties"][string]["type"],
): boolean =>
  type === "array"
    ? Array.isArray(value)
    : type === "object"
      ? typeof value === "object" && value !== null && !Array.isArray(value)
      : type === "integer"
        ? typeof value === "number" && Number.isSafeInteger(value)
        : typeof value === type;

const canonicalPath = async (candidate: string): Promise<string> => {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
};

const isInside = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);

const assertIdentifier = (value: string, field: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`Remotion ${field} is invalid.`);
};

const error = (
  code: string,
  message: string,
  source: RemotionSourceDescriptor,
  repairHint = "Correct the Remotion source configuration and validate again.",
): RemotionAdapterDiagnostic =>
  remotionDiagnostic({
    category: code.includes("version") ? "compatibility" : code.includes("asset") ? "asset" : "validation",
    code,
    severity: "error",
    stage: "source-validation",
    message,
    repairHint,
    sourcePath: source.componentPath,
    compositionId: source.compositionId,
  });

const warning = (
  code: string,
  message: string,
  source: RemotionSourceDescriptor,
  repairHint: string,
): RemotionAdapterDiagnostic =>
  remotionDiagnostic({
    category: "validation",
    code,
    severity: "warning",
    stage: "source-validation",
    message,
    repairHint,
    sourcePath: source.componentPath,
    compositionId: source.compositionId,
  });
