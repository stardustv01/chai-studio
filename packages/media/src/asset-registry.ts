import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import {
  assertProjectDocument,
  type AssetRecord,
  type AssetsDocument,
  type BigIntString,
  type NormalizedRational,
} from "@chai-studio/schema";

export interface PrepareAssetRegistrationInput {
  readonly id: string;
  readonly sourceFilePath: string;
  readonly projectRelativePath: string;
  readonly kind: AssetRecord["kind"];
  readonly rights: AssetRecord["rights"];
  readonly durationFrames?: BigIntString | null;
  readonly fps?: NormalizedRational | null;
  readonly hasAudio?: boolean;
  readonly hasAlpha?: boolean;
  readonly variableFrameRate?: boolean;
  readonly validationState?: AssetRecord["validationState"];
}

export interface AssetRegistryIssue {
  readonly code: string;
  readonly assetId: string | null;
  readonly path: string;
  readonly message: string;
  readonly repairHint: string;
}

export interface AssetRegistryAudit {
  readonly passed: boolean;
  readonly assetCount: number;
  readonly issues: readonly AssetRegistryIssue[];
}

export const prepareAssetRegistration = async (
  input: PrepareAssetRegistrationInput,
): Promise<AssetRecord> => {
  assertStableAssetId(input.id);
  const projectRelativePath = normalizeAssetRegistryPath(input.projectRelativePath);
  const file = await stat(input.sourceFilePath).catch((error: unknown) => {
    throw mediaError(
      "media.asset.source-missing",
      `Cannot read asset source ${input.sourceFilePath}.`,
      "Choose an existing regular file and retry registration.",
      error,
    );
  });
  if (!file.isFile()) {
    throw mediaError(
      "media.asset.source-not-file",
      `Asset source is not a regular file: ${input.sourceFilePath}.`,
      "Register a regular media or project asset file.",
    );
  }
  const contentHash = await sha256File(input.sourceFilePath);
  return {
    id: input.id,
    path: projectRelativePath,
    contentHash,
    kind: input.kind,
    durationFrames: input.durationFrames ?? null,
    fps: input.fps ?? null,
    hasAudio: input.hasAudio ?? input.kind === "audio",
    hasAlpha: input.hasAlpha ?? false,
    variableFrameRate: input.variableFrameRate ?? false,
    rights: input.rights,
    validationState: input.validationState ?? "pending",
  };
};

export const registerAssetRecord = (document: AssetsDocument, asset: AssetRecord): AssetsDocument => {
  assertProjectDocument("assets", document);
  assertAssetRecord(asset);
  if (document.assets.some((existing) => existing.id === asset.id)) {
    throw mediaError(
      "media.asset.id-duplicate",
      `Asset ID already exists: ${asset.id}.`,
      "Reuse the existing asset or supply a new stable asset ID.",
    );
  }
  if (document.assets.some((existing) => existing.path === asset.path)) {
    throw mediaError(
      "media.asset.path-duplicate",
      `Asset path is already registered: ${asset.path}.`,
      "Inspect the existing record and use relink/replace instead of silent substitution.",
    );
  }
  return assertProjectDocument("assets", {
    ...document,
    assets: [...document.assets, asset],
  });
};

export const auditAssetRegistry = (document: AssetsDocument): AssetRegistryAudit => {
  const issues: AssetRegistryIssue[] = [];
  try {
    assertProjectDocument("assets", document);
  } catch (error) {
    issues.push({
      code: "media.asset.document-invalid",
      assetId: null,
      path: "/",
      message: error instanceof Error ? error.message : "Assets document is structurally invalid.",
      repairHint: "Repair assets.json against the versioned authoritative schema.",
    });
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const [index, asset] of document.assets.entries()) {
    if (ids.has(asset.id)) {
      issues.push(registryIssue("media.asset.id-duplicate", asset, index, "Stable asset ID is duplicated."));
    }
    if (paths.has(asset.path)) {
      issues.push(
        registryIssue("media.asset.path-duplicate", asset, index, "Canonical asset path is duplicated."),
      );
    }
    ids.add(asset.id);
    paths.add(asset.path);
    try {
      assertAssetRecord(asset);
    } catch (error) {
      issues.push({
        code: error instanceof ChaiError ? error.code : "media.asset.record-invalid",
        assetId: asset.id,
        path: `/assets/${String(index)}`,
        message: error instanceof Error ? error.message : "Asset record is invalid.",
        repairHint: "Repair identity, canonical path, content hash, media family, rights, or status.",
      });
    }
  }
  return { passed: issues.length === 0, assetCount: document.assets.length, issues };
};

export const normalizeAssetRegistryPath = (value: string): string => {
  const normalized = value.normalize("NFC").replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.length > 1_024 ||
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith("./") ||
    normalized.endsWith("/") ||
    normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw mediaError(
      "media.asset.path-invalid",
      `Asset path is not canonical project-relative form: ${JSON.stringify(value)}.`,
      "Use an NFC-normalized POSIX path without traversal, empty segments, or a leading slash.",
    );
  }
  return normalized;
};

export const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) hash.update(chunk);
  } catch (error) {
    throw mediaError(
      "media.asset.hash-failed",
      `Failed to hash asset source ${filePath}.`,
      "Verify file readability and retry without changing the stable asset ID.",
      error,
    );
  }
  return hash.digest("hex");
};

const assertAssetRecord = (asset: AssetRecord): void => {
  assertStableAssetId(asset.id);
  if (normalizeAssetRegistryPath(asset.path) !== asset.path) {
    throw mediaError(
      "media.asset.path-noncanonical",
      `Asset path is normalized but not canonical: ${asset.path}.`,
      "Store the normalized path returned by normalizeAssetRegistryPath.",
    );
  }
  if (!/^[a-f0-9]{64}$/.test(asset.contentHash)) {
    throw mediaError(
      "media.asset.hash-invalid",
      `Asset ${asset.id} has an invalid SHA-256 content hash.`,
      "Hash the complete source bytes with SHA-256 before registration.",
    );
  }
};

const assertStableAssetId = (id: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(id)) {
    throw mediaError(
      "media.asset.id-invalid",
      `Invalid stable asset ID: ${id}.`,
      "Use a stable ID beginning with a letter and only contract-safe characters.",
    );
  }
};

const registryIssue = (
  code: string,
  asset: AssetRecord,
  index: number,
  message: string,
): AssetRegistryIssue => ({
  code,
  assetId: asset.id,
  path: `/assets/${String(index)}`,
  message,
  repairHint: "Keep one stable ID and one canonical path per authoritative asset record.",
});

const mediaError = (code: string, message: string, repairHint: string, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "asset-registry",
    message,
    repairHint,
    ...(cause === undefined ? {} : { cause }),
  });
