import { createHash } from "node:crypto";
import { stringifyCanonicalJson, type JsonValue } from "@chai-studio/schema";
import type {
  PreviewEnvironmentManifest,
  RenderCacheKeyInput,
  RenderDependencyEntry,
  RenderDependencyManifest,
  RenderEnvironmentIdentity,
  StrictEnvironmentManifest,
} from "./contracts.js";

const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

export const hashCanonicalRenderValue = (value: JsonValue): string => sha256(stringifyCanonicalJson(value));

export const mergeRenderDependencies = (
  groups: readonly (readonly RenderDependencyEntry[])[],
): RenderDependencyManifest => {
  const merged = new Map<string, RenderDependencyEntry>();
  for (const entry of groups.flat()) {
    assertHash(entry.contentHash, `dependency ${entry.id}`);
    const key = `${entry.category}:${entry.id}`;
    const existing = merged.get(key);
    if (existing !== undefined && existing.contentHash !== entry.contentHash) {
      throw new Error(`Render dependency conflict for ${key}.`);
    }
    merged.set(key, {
      ...entry,
      requiredBy: [...new Set([...(existing?.requiredBy ?? []), ...entry.requiredBy])].sort(),
      metadata: { ...(existing?.metadata ?? {}), ...entry.metadata },
      portability:
        existing?.portability === "strict" || entry.portability === "strict" ? "strict" : "portable-proven",
    });
  }
  const entries = [...merged.values()].sort((left, right) =>
    `${left.category}:${left.id}`.localeCompare(`${right.category}:${right.id}`, "en"),
  );
  const identityHash = hashCanonicalRenderValue({
    schemaVersion: "1.0.0",
    entries,
  } as unknown as JsonValue);
  return { schemaVersion: "1.0.0", entries, identityHash };
};

export const buildRenderEnvironmentIdentity = (
  strictManifest: StrictEnvironmentManifest,
  previewManifest: PreviewEnvironmentManifest,
): RenderEnvironmentIdentity => {
  assertHash(strictManifest.browserExecutableHash, "browser executable");
  assertHash(strictManifest.lockfileHash, "lockfile");
  return {
    strictEnvironmentFingerprint: hashCanonicalRenderValue(strictManifest as unknown as JsonValue),
    compatiblePreviewFingerprint: hashCanonicalRenderValue(previewManifest as unknown as JsonValue),
    strictManifest,
    previewManifest,
  };
};

export const buildRenderCacheKey = (input: RenderCacheKeyInput): string => {
  for (const [label, values] of [
    ["source", input.sourceHashes],
    ["asset", input.assetHashes],
    ["font", input.fontHashes],
    ["network", input.approvedNetworkHashes],
  ] as const) {
    for (const hash of values) assertHash(hash, label);
  }
  assertHash(input.dependencyManifestHash, "dependency manifest");
  assertHash(input.strictEnvironmentFingerprint, "strict environment");
  assertHash(input.lockfileHash, "lockfile");
  if (input.portableEnvironmentContractHash !== null) {
    assertHash(input.portableEnvironmentContractHash, "portable environment contract");
  }
  const start = BigInt(input.range.startFrame);
  const end = BigInt(input.range.endFrameExclusive);
  if (start < 0n || end <= start) throw new Error("Render cache range must be non-empty and half-open.");
  if (input.dimensions.width < 1 || input.dimensions.height < 1) {
    throw new Error("Render cache dimensions are invalid.");
  }
  return hashCanonicalRenderValue(input as unknown as JsonValue);
};

export const assertHash = (value: string, label: string): void => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} hash is invalid.`);
};
