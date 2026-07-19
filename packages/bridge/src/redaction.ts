import { redactValueWithContext, type RedactionContext } from "@chai-studio/diagnostics";

export const redactBridgeValue = (value: unknown, context: RedactionContext = {}): unknown =>
  redactValueWithContext(value, context);

export interface BridgeLogRecord {
  readonly timestamp: string;
  readonly correlationId: string;
  readonly operation: string;
  readonly status: "started" | "succeeded" | "failed" | "cancelled";
  readonly details: unknown;
}

export const createBridgeLogRecord = (
  input: Omit<BridgeLogRecord, "details"> & Readonly<{ details: unknown }>,
): BridgeLogRecord => ({ ...input, details: redactBridgeValue(input.details) });
