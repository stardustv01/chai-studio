import path from "node:path";
import {
  deserializeRational,
  normalizeRational,
  parseBigIntString,
  type AssetRecord,
  type AssetsDocument,
  type NormalizedRational,
} from "@chai-studio/schema";
import type { MediaInspectionV1 } from "./media-inspection.js";

export interface AssetIndexBuildSources {
  readonly inspectionsByContentHash?: Readonly<Record<string, MediaInspectionV1>>;
  readonly usageCountByAssetId?: Readonly<Record<string, number>>;
  readonly registeredAtByAssetId?: Readonly<Record<string, string>>;
}

export interface AssetIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: AssetRecord["kind"];
  readonly contentHash: string;
  readonly durationSeconds: NormalizedRational | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly rights: AssetRecord["rights"];
  readonly validationState: AssetRecord["validationState"];
  readonly registeredAt: string | null;
  readonly usageCount: number;
  readonly searchableText: string;
}

export interface AssetSearchQuery {
  readonly text?: string;
  readonly kinds?: readonly AssetRecord["kind"][];
  readonly rights?: readonly AssetRecord["rights"][];
  readonly validationStates?: readonly AssetRecord["validationState"][];
  readonly minimumDurationSeconds?: NormalizedRational;
  readonly maximumDurationSeconds?: NormalizedRational;
  readonly minimumWidth?: number;
  readonly minimumHeight?: number;
  readonly registeredAfter?: string;
  readonly registeredBefore?: string;
  readonly usedOnly?: boolean;
  readonly sortBy: "name" | "type" | "duration" | "resolution" | "rights" | "status" | "date" | "usage";
  readonly direction: "ascending" | "descending";
  readonly offset: number;
  readonly limit: number;
}

export interface AssetSearchPage {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly entries: readonly AssetIndexEntry[];
}

export const buildAssetIndex = (
  document: AssetsDocument,
  sources: AssetIndexBuildSources = {},
): readonly AssetIndexEntry[] =>
  document.assets
    .map((asset) => {
      const inspection = sources.inspectionsByContentHash?.[asset.contentHash];
      const video = inspection?.videoStreams[0];
      const usageCount = sources.usageCountByAssetId?.[asset.id] ?? 0;
      const registeredAt = sources.registeredAtByAssetId?.[asset.id] ?? null;
      if (!Number.isSafeInteger(usageCount) || usageCount < 0) {
        throw new Error(`Invalid usage count for ${asset.id}.`);
      }
      if (registeredAt !== null && Number.isNaN(Date.parse(registeredAt))) {
        throw new Error(`Invalid registration date for ${asset.id}.`);
      }
      const name = path.posix.basename(asset.path);
      return {
        id: asset.id,
        name,
        path: asset.path,
        kind: asset.kind,
        contentHash: asset.contentHash,
        durationSeconds: inspection?.durationSeconds ?? assetDurationSeconds(asset),
        width: video?.width ?? null,
        height: video?.height ?? null,
        rights: asset.rights,
        validationState: asset.validationState,
        registeredAt,
        usageCount,
        searchableText: normalizeSearchText(
          `${name} ${asset.path} ${asset.id} ${asset.kind} ${asset.rights} ${asset.validationState}`,
        ),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

export const searchAssetIndex = (
  index: readonly AssetIndexEntry[],
  query: AssetSearchQuery,
): AssetSearchPage => {
  if (
    !Number.isSafeInteger(query.offset) ||
    query.offset < 0 ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 1_000
  ) {
    throw new Error("Asset search pagination is outside bounded safe limits.");
  }
  const terms = normalizeSearchText(query.text ?? "")
    .split(" ")
    .filter((term) => term.length > 0);
  const after = query.registeredAfter === undefined ? null : Date.parse(query.registeredAfter);
  const before = query.registeredBefore === undefined ? null : Date.parse(query.registeredBefore);
  if (
    (after !== null && Number.isNaN(after)) ||
    (before !== null && Number.isNaN(before)) ||
    (after !== null && before !== null && after > before)
  ) {
    throw new Error("Asset search registration date range is invalid.");
  }
  const filtered = index.filter((entry) => {
    if (terms.some((term) => !entry.searchableText.includes(term))) return false;
    if (query.kinds !== undefined && !query.kinds.includes(entry.kind)) return false;
    if (query.rights !== undefined && !query.rights.includes(entry.rights)) return false;
    if (query.validationStates !== undefined && !query.validationStates.includes(entry.validationState)) {
      return false;
    }
    if (query.usedOnly === true && entry.usageCount === 0) return false;
    if (query.minimumWidth !== undefined && (entry.width === null || entry.width < query.minimumWidth))
      return false;
    if (query.minimumHeight !== undefined && (entry.height === null || entry.height < query.minimumHeight))
      return false;
    if (
      query.minimumDurationSeconds !== undefined &&
      (entry.durationSeconds === null ||
        compareRational(entry.durationSeconds, query.minimumDurationSeconds) < 0)
    ) {
      return false;
    }
    if (
      query.maximumDurationSeconds !== undefined &&
      (entry.durationSeconds === null ||
        compareRational(entry.durationSeconds, query.maximumDurationSeconds) > 0)
    ) {
      return false;
    }
    const registered = entry.registeredAt === null ? null : Date.parse(entry.registeredAt);
    if (after !== null && (registered === null || registered < after)) return false;
    if (before !== null && (registered === null || registered > before)) return false;
    return true;
  });
  filtered.sort((left, right) => {
    const primary = compareEntry(left, right, query.sortBy);
    const directed = query.direction === "ascending" ? primary : 0 - primary;
    return directed || left.id.localeCompare(right.id, "en");
  });
  return {
    total: filtered.length,
    offset: query.offset,
    limit: query.limit,
    entries: filtered.slice(query.offset, query.offset + query.limit),
  };
};

const compareEntry = (
  left: AssetIndexEntry,
  right: AssetIndexEntry,
  sortBy: AssetSearchQuery["sortBy"],
): number => {
  switch (sortBy) {
    case "name":
      return left.name.localeCompare(right.name, "en");
    case "type":
      return left.kind.localeCompare(right.kind, "en");
    case "duration":
      return compareNullableRational(left.durationSeconds, right.durationSeconds);
    case "resolution":
      return resolutionArea(left) - resolutionArea(right);
    case "rights":
      return left.rights.localeCompare(right.rights, "en");
    case "status":
      return left.validationState.localeCompare(right.validationState, "en");
    case "date":
      return (
        (left.registeredAt === null ? -1 : Date.parse(left.registeredAt)) -
        (right.registeredAt === null ? -1 : Date.parse(right.registeredAt))
      );
    case "usage":
      return left.usageCount - right.usageCount;
  }
};

const resolutionArea = (entry: AssetIndexEntry): number =>
  entry.width === null || entry.height === null ? -1 : entry.width * entry.height;

const assetDurationSeconds = (asset: AssetRecord): NormalizedRational | null => {
  if (asset.durationFrames === null || asset.fps === null) return null;
  const fps = rationalParts(asset.fps);
  return normalizeRational(parseBigIntString(asset.durationFrames) * fps.denominator, fps.numerator);
};

const compareNullableRational = (
  left: NormalizedRational | null,
  right: NormalizedRational | null,
): number => (left === null ? (right === null ? 0 : -1) : right === null ? 1 : compareRational(left, right));

const compareRational = (left: NormalizedRational, right: NormalizedRational): number => {
  const a = rationalParts(left);
  const b = rationalParts(right);
  const leftValue = a.numerator * b.denominator;
  const rightValue = b.numerator * a.denominator;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

const rationalParts = (value: NormalizedRational): Readonly<{ numerator: bigint; denominator: bigint }> => {
  const rational = deserializeRational(value);
  return {
    numerator: parseBigIntString(rational.numerator),
    denominator: parseBigIntString(rational.denominator),
  };
};

const normalizeSearchText = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
