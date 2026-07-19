import { createHash } from "node:crypto";

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

export const environmentFingerprint = (manifest) =>
  createHash("sha256").update(JSON.stringify(canonicalize(manifest))).digest("hex");

const major = (value) => String(value).match(/\d+/)?.[0] ?? "unknown";
const compatibilityLine = (value) => {
  const numbers = String(value).match(/\d+/g) ?? [];
  return numbers[0] === "0" ? `${numbers[0] ?? "unknown"}.${numbers[1] ?? "unknown"}` : numbers[0] ?? "unknown";
};

export const buildEnvironmentFingerprints = (manifest) => {
  const strictManifest = canonicalize(manifest);
  const compatiblePreviewManifest = canonicalize({
    platform: manifest.platform,
    architecture: manifest.architecture,
    nodeMajor: major(manifest.node),
    chromeMajor: major(manifest.chrome),
    remotionMajor: major(manifest.remotion),
    hyperframesCompatibilityLine: compatibilityLine(manifest.hyperframes),
    ffmpegMajor: major(manifest.ffmpeg),
  });
  return Object.freeze({
    strictEnvironmentFingerprint: environmentFingerprint(strictManifest),
    compatiblePreviewFingerprint: environmentFingerprint(compatiblePreviewManifest),
    strictManifest,
    compatiblePreviewManifest,
    reusePolicy: Object.freeze({ finalArtifacts: "strict-only", previewArtifacts: "compatible-allowed-with-visible-degradation", portabilityAssumed: false }),
  });
};
