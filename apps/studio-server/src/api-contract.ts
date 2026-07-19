import { createCorrelationId, type ChaiError, type DiagnosticCategory } from "@chai-studio/diagnostics";

export const studioApiVersion = "2026-07-15" as const;

export interface ApiSuccessEnvelope<T> {
  readonly apiVersion: typeof studioApiVersion;
  readonly ok: true;
  readonly correlationId: string;
  readonly data: T;
}

export interface ApiErrorDescriptor {
  readonly category: DiagnosticCategory;
  readonly code: string;
  readonly stage: string;
  readonly entityId: string | null;
  readonly retryable: boolean;
  readonly message: string;
  readonly repairHint: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

export interface ApiErrorEnvelope {
  readonly apiVersion: typeof studioApiVersion;
  readonly ok: false;
  readonly correlationId: string;
  readonly error: ApiErrorDescriptor;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export const apiSuccess = <T>(correlationId: string, data: T): ApiSuccessEnvelope<T> => ({
  apiVersion: studioApiVersion,
  ok: true,
  correlationId: assertCorrelationId(correlationId),
  data,
});

export const apiFailure = (error: ChaiError, retryable = false): ApiErrorEnvelope => ({
  apiVersion: studioApiVersion,
  ok: false,
  correlationId: assertCorrelationId(error.correlationId),
  error: {
    category: error.category,
    code: error.code,
    stage: error.stage,
    entityId: error.entityId ?? null,
    retryable,
    message: error.message,
    repairHint: error.repairHint ?? null,
    details: error.details ?? null,
  },
});

export const requestCorrelationId = (headerValue: string | readonly string[] | undefined): string => {
  const value = typeof headerValue === "string" ? headerValue : headerValue?.[0];
  return value !== undefined && correlationIdPattern.test(value) ? value : createCorrelationId();
};

export const assertApiEnvelope = <T>(value: ApiEnvelope<T>): ApiEnvelope<T> => {
  assertCorrelationId(value.correlationId);
  if (!value.ok && (value.error.code.trim().length === 0 || value.error.stage.trim().length === 0)) {
    throw new Error("API error envelope lacks code or stage.");
  }
  return value;
};

const correlationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertCorrelationId = (value: string): string => {
  if (!correlationIdPattern.test(value)) throw new Error("API correlation ID is invalid.");
  return value;
};
