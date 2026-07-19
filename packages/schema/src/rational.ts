import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
export { rationalJsonSchema } from "./generated/rational-schema.js";

declare const bigintStringBrand: unique symbol;
export type BigIntString = string & { readonly [bigintStringBrand]: true };

export interface NormalizedRational {
  readonly numerator: BigIntString;
  readonly denominator: BigIntString;
}

const signedIntegerPattern = /^-?(?:0|[1-9][0-9]{0,77})$/;
const positiveIntegerPattern = /^[1-9][0-9]{0,77}$/;

export const serializeBigInt = (value: bigint): BigIntString => {
  const serialized = value.toString(10);
  if (!signedIntegerPattern.test(serialized)) {
    throw validationError(
      "schema.bigint.out-of-range",
      "value",
      "Use a signed integer that fits the 256-bit persistence budget.",
    );
  }
  return serialized as BigIntString;
};

export const parseBigIntString = (value: unknown, field = "value"): bigint => {
  if (typeof value !== "string" || !signedIntegerPattern.test(value) || value === "-0") {
    throw validationError(
      "schema.bigint.invalid",
      field,
      "Use a canonical base-10 integer string without leading zeros.",
    );
  }
  return BigInt(value);
};

export const normalizeRational = (
  numeratorInput: bigint | string,
  denominatorInput: bigint | string,
): NormalizedRational => {
  let numerator =
    typeof numeratorInput === "bigint" ? numeratorInput : parseBigIntString(numeratorInput, "numerator");
  let denominator =
    typeof denominatorInput === "bigint"
      ? denominatorInput
      : parseBigIntString(denominatorInput, "denominator");
  if (denominator === 0n) {
    throw validationError("schema.rational.zero-denominator", "denominator", "Use a non-zero denominator.");
  }
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  if (numerator === 0n) return { numerator: serializeBigInt(0n), denominator: serializeBigInt(1n) };
  const divisor = gcd(abs(numerator), denominator);
  return {
    numerator: serializeBigInt(numerator / divisor),
    denominator: serializeBigInt(denominator / divisor),
  };
};

export const deserializeRational = (value: unknown): NormalizedRational => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(
      "schema.rational.invalid",
      "rational",
      "Use an object with numerator and denominator strings.",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "denominator" || keys[1] !== "numerator") {
    throw validationError(
      "schema.rational.shape",
      "rational",
      "Remove unknown fields and include numerator and denominator.",
    );
  }
  if (typeof record.denominator !== "string" || !positiveIntegerPattern.test(record.denominator)) {
    throw validationError(
      "schema.rational.denominator",
      "denominator",
      "Use a canonical positive denominator string.",
    );
  }
  const numerator = parseBigIntString(record.numerator, "numerator");
  const denominator = BigInt(record.denominator);
  const normalized = normalizeRational(numerator, denominator);
  if (normalized.numerator !== record.numerator || normalized.denominator !== record.denominator) {
    throw validationError(
      "schema.rational.not-normalized",
      "rational",
      "Reduce the rational to lowest terms before persistence.",
    );
  }
  return normalized;
};

export const assertPositiveRational = (value: NormalizedRational, field = "rational"): NormalizedRational => {
  if (parseBigIntString(value.numerator, `${field}.numerator`) <= 0n) {
    throw validationError("schema.rational.not-positive", field, "Use a rational greater than zero.");
  }
  return value;
};

export const multiplyRationals = (left: NormalizedRational, right: NormalizedRational): NormalizedRational =>
  normalizeRational(
    parseBigIntString(left.numerator) * parseBigIntString(right.numerator),
    parseBigIntString(left.denominator) * parseBigIntString(right.denominator),
  );

export const compareRationals = (left: NormalizedRational, right: NormalizedRational): -1 | 0 | 1 => {
  const difference =
    parseBigIntString(left.numerator) * parseBigIntString(right.denominator) -
    parseBigIntString(right.numerator) * parseBigIntString(left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

const gcd = (left: bigint, right: bigint): bigint => {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

const validationError = (code: string, entityId: string, repairHint: string): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "rational-validation",
    message: `Invalid persisted rational at ${entityId}. ${repairHint}`,
    entityId,
    repairHint,
  });
