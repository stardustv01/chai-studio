import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { masterFrame } from "./range.js";
import type { TimelineSnapshotV1 } from "./model.js";
import { assertValidTimelineCore } from "./validation.js";

const masterFrameTag = "$chaiMasterFrame";

export const serializeTimelineSnapshot = (timeline: TimelineSnapshotV1): string => {
  assertValidTimelineCore(timeline);
  return `${JSON.stringify(encodeValue(timeline))}\n`;
};

export const deserializeTimelineSnapshot = (serialized: string): TimelineSnapshotV1 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw serializationError(
      "timeline.serialization.json-invalid",
      "Timeline snapshot is not valid JSON.",
      error,
    );
  }
  const decoded = decodeValue(parsed);
  if (!isRecord(decoded) || decoded.schemaVersion !== "1.0.0") {
    throw serializationError(
      "timeline.serialization.version-invalid",
      "Timeline snapshot has no supported schemaVersion.",
    );
  }
  try {
    return assertValidTimelineCore(decoded as unknown as TimelineSnapshotV1);
  } catch (error) {
    throw serializationError(
      "timeline.serialization.contract-invalid",
      "Decoded timeline snapshot violates the timeline contract.",
      error,
    );
  }
};

const encodeValue = (value: unknown): unknown => {
  if (typeof value === "bigint") return { [masterFrameTag]: String(value) };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, encodeValue(value[key])]),
    );
  }
  return value;
};

const decodeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === masterFrameTag) {
    const encoded = value[masterFrameTag];
    if (typeof encoded !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(encoded)) {
      throw serializationError(
        "timeline.serialization.frame-invalid",
        "Serialized master-frame value is invalid.",
      );
    }
    return masterFrame(BigInt(encoded), true);
  }
  return Object.fromEntries(keys.map((key) => [key, decodeValue(value[key])]));
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const serializationError = (code: string, message: string, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "timeline",
    code,
    correlationId: createCorrelationId(),
    stage: "timeline-serialization",
    message,
    repairHint: "Use the versioned canonical timeline serializer and validate the complete snapshot.",
    ...(cause === undefined ? {} : { cause }),
  });
