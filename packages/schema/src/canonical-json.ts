import { createHash } from "node:crypto";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const canonicalizeJson = (value: unknown): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw canonicalError("Numbers must be finite JSON values and cannot be negative zero.");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null)
      throw canonicalError("Only plain JSON objects can be canonicalized.");
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => {
          if (item === undefined) throw canonicalError(`Undefined is not valid JSON at key ${key}.`);
          return [key, canonicalizeJson(item)];
        }),
    );
  }
  throw canonicalError(`Unsupported canonical JSON value type: ${typeof value}.`);
};

export const stringifyCanonicalJson = (value: unknown): string =>
  `${JSON.stringify(canonicalizeJson(value), null, 2)}\n`;

export const sha256CanonicalJson = (value: unknown): string =>
  createHash("sha256").update(stringifyCanonicalJson(value)).digest("hex");

const canonicalError = (message: string): ChaiError =>
  new ChaiError({
    category: "schema",
    code: "schema.canonical-json.invalid",
    correlationId: createCorrelationId(),
    stage: "canonical-serialization",
    message,
    repairHint: "Encode BigInt values as canonical decimal strings and remove non-JSON values.",
  });
