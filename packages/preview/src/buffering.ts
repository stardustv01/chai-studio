import type { PreviewFrameRange } from "./master-clock.js";
import type { PreviewPreloadResult } from "./preview-contract.js";

export type PreviewBufferWaitReason = "media" | "engine" | "render-fallback" | "audio";

export interface PreviewBufferingSnapshot {
  readonly status: "ready" | "waiting" | "back-pressure" | "error";
  readonly requestedRange: PreviewFrameRange;
  readonly bufferedRange: PreviewFrameRange | null;
  readonly waitingFor: readonly PreviewBufferWaitReason[];
  readonly staleAdapterIds: readonly string[];
  readonly inFlightRequests: number;
  readonly maximumInFlightRequests: number;
}

export const aggregatePreviewBuffering = (input: {
  readonly requestedRange: PreviewFrameRange;
  readonly results: readonly PreviewPreloadResult[];
  readonly inFlightRequests?: number;
  readonly maximumInFlightRequests?: number;
  readonly failedAdapterIds?: readonly string[];
}): PreviewBufferingSnapshot => {
  const maximumInFlightRequests = input.maximumInFlightRequests ?? 4;
  const inFlightRequests = input.inFlightRequests ?? 0;
  if (
    !Number.isSafeInteger(maximumInFlightRequests) ||
    maximumInFlightRequests < 1 ||
    maximumInFlightRequests > 32
  ) {
    throw new Error("Preview preload concurrency limit is invalid.");
  }
  if (!Number.isSafeInteger(inFlightRequests) || inFlightRequests < 0) {
    throw new Error("Preview preload in-flight count is invalid.");
  }
  const failedAdapterIds = [...(input.failedAdapterIds ?? [])].sort();
  const waitingFor = [
    ...new Set(input.results.map((result) => result.waitingFor).filter((reason) => reason !== "none")),
  ].sort() as PreviewBufferWaitReason[];
  const staleAdapterIds = input.results
    .filter((result) => result.freshness === "stale")
    .map((result) => result.adapterId)
    .sort();
  const bufferedRange = intersectRanges(input.results.map((result) => result.range));
  const status =
    failedAdapterIds.length > 0
      ? "error"
      : inFlightRequests >= maximumInFlightRequests
        ? "back-pressure"
        : waitingFor.length > 0 || bufferedRange === null
          ? "waiting"
          : "ready";
  return {
    status,
    requestedRange: input.requestedRange,
    bufferedRange,
    waitingFor,
    staleAdapterIds,
    inFlightRequests,
    maximumInFlightRequests,
  };
};

export const intersectRanges = (ranges: readonly PreviewFrameRange[]): PreviewFrameRange | null => {
  if (ranges.length === 0) return null;
  let start = BigInt(ranges[0]?.startFrame ?? "0");
  let end = BigInt(ranges[0]?.endFrameExclusive ?? "0");
  for (const range of ranges.slice(1)) {
    const candidateStart = BigInt(range.startFrame);
    const candidateEnd = BigInt(range.endFrameExclusive);
    if (candidateStart > start) start = candidateStart;
    if (candidateEnd < end) end = candidateEnd;
  }
  return end <= start ? null : { startFrame: start.toString(10), endFrameExclusive: end.toString(10) };
};
