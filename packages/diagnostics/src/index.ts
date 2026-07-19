export const diagnosticCategories = [
  "schema",
  "timeline",
  "preview",
  "adapter",
  "media",
  "audio",
  "render",
  "bridge",
  "qa",
  "security",
  "environment",
  "internal",
] as const;

export type DiagnosticCategory = (typeof diagnosticCategories)[number];
export type DiagnosticSeverity = "debug" | "info" | "warning" | "error";

export interface ErrorContext {
  readonly category: DiagnosticCategory;
  readonly code: string;
  readonly correlationId: string;
  readonly stage: string;
  readonly message: string;
  readonly entityId?: string;
  readonly repairHint?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export interface SerializedChaiError extends Omit<ErrorContext, "cause"> {
  readonly name: "ChaiError";
  readonly cause?: string;
}

export class ChaiError extends Error {
  readonly category: DiagnosticCategory;
  readonly code: string;
  readonly correlationId: string;
  readonly stage: string;
  readonly entityId: string | undefined;
  readonly repairHint: string | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(context: ErrorContext) {
    super(context.message, context.cause === undefined ? undefined : { cause: context.cause });
    this.name = "ChaiError";
    this.category = context.category;
    this.code = context.code;
    this.correlationId = context.correlationId;
    this.stage = context.stage;
    this.entityId = context.entityId;
    this.repairHint = context.repairHint;
    this.details = context.details;
  }

  toJSON(): SerializedChaiError {
    const serialized: SerializedChaiError = {
      name: "ChaiError",
      category: this.category,
      code: this.code,
      correlationId: this.correlationId,
      stage: this.stage,
      message: this.message,
      ...(this.entityId === undefined ? {} : { entityId: this.entityId }),
      ...(this.repairHint === undefined ? {} : { repairHint: this.repairHint }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.cause === undefined ? {} : { cause: causeMessage(this.cause) }),
    };
    return serialized;
  }

  static fromJSON(serialized: SerializedChaiError): ChaiError {
    return new ChaiError({
      category: serialized.category,
      code: serialized.code,
      correlationId: serialized.correlationId,
      stage: serialized.stage,
      message: serialized.message,
      ...(serialized.entityId === undefined ? {} : { entityId: serialized.entityId }),
      ...(serialized.repairHint === undefined ? {} : { repairHint: serialized.repairHint }),
      ...(serialized.details === undefined ? {} : { details: serialized.details }),
      ...(serialized.cause === undefined ? {} : { cause: serialized.cause }),
    });
  }
}

export type Result<T, E extends ChaiError = ChaiError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends ChaiError>(error: E): Result<never, E> => ({ ok: false, error });
export const createCorrelationId = (): string => globalThis.crypto.randomUUID();

const secretPattern =
  /\b(api[_-]?key|authorization|cookie|credential|password|secret|token)\b\s*[:=]\s*([^\s,;]+)/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const homePathPattern = /\/Users\/[^/\s]+/g;
const privateTemporaryPathPattern = /\/private\/(?:tmp|var\/folders)\/[^\s"']+/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export interface RedactionContext {
  readonly projectRoot?: string | null;
  readonly allowedEnvironmentKeys?: readonly string[];
}

export const redactText = (value: string): string => redactTextWithContext(value);

export const redactTextWithContext = (value: string, context: RedactionContext = {}): string => {
  let redacted = value;
  if (context.projectRoot !== undefined && context.projectRoot !== null) {
    const root = context.projectRoot.replace(/\/+$/, "");
    redacted = redacted.replaceAll(root, "<project>");
  }
  return redacted
    .replace(bearerPattern, "Bearer [REDACTED]")
    .replace(secretPattern, "$1=[REDACTED]")
    .replace(emailPattern, "[EMAIL]")
    .replace(homePathPattern, "$HOME")
    .replace(privateTemporaryPathPattern, (match) => `<temporary:${shortHash(match)}>`);
};

export const redactValue = (value: unknown): unknown => {
  return redactValueWithContext(value);
};

export const redactValueWithContext = (value: unknown, context: RedactionContext = {}): unknown => {
  if (typeof value === "string") return redactTextWithContext(value, context);
  if (Array.isArray(value)) return value.map((item) => redactValueWithContext(item, context));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /api[_-]?key|authorization|cookie|credential|password|secret|token/i.test(key)
          ? "[REDACTED]"
          : key === "environment" && item !== null && typeof item === "object"
            ? redactEnvironment(
                item as Readonly<Record<string, unknown>>,
                context.allowedEnvironmentKeys ?? [],
              )
            : redactValueWithContext(item, context),
      ]),
    );
  }
  return value;
};

const redactEnvironment = (
  environment: Readonly<Record<string, unknown>>,
  allowlist: readonly string[],
): Readonly<Record<string, unknown>> => {
  const allowed = new Set(allowlist);
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      allowed.has(key) ? redactValueWithContext(value) : "[REDACTED]",
    ]),
  );
};

const shortHash = (value: string): string => {
  let left = 2_166_136_261;
  let right = 2_654_435_761;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    left = Math.imul(left ^ code, 16_777_619) >>> 0;
    right = Math.imul(right ^ code, 2_246_822_519) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`.slice(0, 12);
};

export interface DiagnosticRecord {
  readonly timestamp: string;
  readonly severity: DiagnosticSeverity;
  readonly category: DiagnosticCategory;
  readonly event: string;
  readonly correlationId: string;
  readonly data?: unknown;
}

export type DiagnosticSink = (record: DiagnosticRecord) => void;

export interface SupportBundlePreviewManifest {
  readonly schemaVersion: "1.0.0";
  readonly createdByExplicitAction: true;
  readonly includedRecordIds: readonly string[];
  readonly includeSourceMedia: false;
  readonly includeExecutableSource: false;
  readonly sanitizedMetadata: unknown;
}

export const createSupportBundlePreviewManifest = (input: {
  readonly createdByExplicitAction: boolean;
  readonly includedRecordIds: readonly string[];
  readonly metadata: unknown;
  readonly context?: RedactionContext;
}): SupportBundlePreviewManifest => {
  if (!input.createdByExplicitAction) {
    throw new Error("Support bundle preview requires an explicit user action.");
  }
  if (
    input.includedRecordIds.length === 0 ||
    input.includedRecordIds.some((id) => !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(id))
  ) {
    throw new Error("Support bundle selection is invalid or empty.");
  }
  return {
    schemaVersion: "1.0.0",
    createdByExplicitAction: true,
    includedRecordIds: [...new Set(input.includedRecordIds)].sort(),
    includeSourceMedia: false,
    includeExecutableSource: false,
    sanitizedMetadata: redactValueWithContext(input.metadata, input.context),
  };
};

export const createLogger = (sink: DiagnosticSink, now: () => Date = () => new Date()) => ({
  write(
    severity: DiagnosticSeverity,
    category: DiagnosticCategory,
    event: string,
    correlationId: string,
    data?: unknown,
  ): void {
    sink({
      timestamp: now().toISOString(),
      severity,
      category,
      event,
      correlationId,
      ...(data === undefined ? {} : { data: redactValue(data) }),
    });
  },
});

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return redactText(cause.message);
  if (typeof cause === "string") return redactText(cause);
  return "Unknown cause";
};

export {
  CachePerformanceLedger,
  comparePerformanceRegression,
  evaluatePerformanceBudget,
  LocalPerformanceLedger,
  performanceMetricNames,
  summarizePerformanceSamples,
  type BenchmarkFixtureDefinition,
  type PerformanceBudget,
  type PerformanceBudgetResult,
  type PerformanceMetricName,
  type PerformanceMetricSummary,
  type PerformanceSampleV1,
  type PerformanceUnit,
  type ProjectClassId,
  type SupportedHardwareClass,
} from "./performance.js";
export {
  assertCompleteSoakCoverage,
  evaluateSoakScenario,
  requiredSoakScenarios,
  type SoakCheckpoint,
  type SoakScenario,
  type SoakScenarioResult,
} from "./stress.js";
export {
  releaseEnvironmentFingerprint,
  studioReleaseIdentity,
  type StudioReleaseIdentity,
} from "./release.js";
