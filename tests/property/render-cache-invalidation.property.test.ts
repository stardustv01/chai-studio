import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildRenderCacheKey, type RenderCacheKeyInput } from "../../packages/render/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

describe("P20 render cache invalidation properties", () => {
  it("canonical object ordering never changes identity", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(fc.stringMatching(/^[a-z]{1,12}$/), fc.integer()), {
          minLength: 1,
          maxLength: 20,
          selector: ([key]) => key,
        }),
        (entries) => {
          const forward = Object.fromEntries(entries);
          const reverse = Object.fromEntries([...entries].reverse());
          expect(buildRenderCacheKey(input(forward))).toBe(buildRenderCacheKey(input(reverse)));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("every generated meaningful source, environment, frame, quality, or seed change invalidates", () => {
    fc.assert(
      fc.property(
        fc.record({
          source: fc.string({ minLength: 1, maxLength: 30 }),
          environment: fc.string({ minLength: 1, maxLength: 30 }),
          endFrame: fc.integer({ min: 2, max: 10_000 }),
          quality: fc.constantFrom("draft", "review", "final"),
          seed: fc.integer({ min: 1, max: 1_000_000 }),
        }),
        (change) => {
          const baseline = input({ title: "Chai" });
          const changed: RenderCacheKeyInput = {
            ...baseline,
            sourceHashes: [hash(`source-${change.source}`)],
            strictEnvironmentFingerprint: hash(`environment-${change.environment}`),
            range: { ...baseline.range, endFrameExclusive: change.endFrame.toString(10) },
            quality: change.quality,
            seeds: { default: change.seed.toString(10) },
          };
          expect(buildRenderCacheKey(changed)).not.toBe(buildRenderCacheKey(baseline));
        },
      ),
      { numRuns: 200 },
    );
  });
});

const input = (propsAndVariables: Record<string, string | number>): RenderCacheKeyInput => ({
  schemaVersion: "1.0.0",
  nodeKind: "native-remotion",
  nodeInput: { compositionId: "ChaiMain" },
  dependencyManifestHash: hash("dependencies"),
  strictEnvironmentFingerprint: hash("environment-baseline"),
  portableEnvironmentContractHash: null,
  sourceHashes: [hash("source-baseline")],
  propsAndVariables,
  assetHashes: [hash("asset")],
  fontHashes: [hash("font")],
  versions: { remotion: "4.0.489" },
  dimensions: { width: 1920, height: 1080 },
  fps: normalizeRational(30n, 1n),
  range: { startFrame: "0", endFrameExclusive: "30" },
  colorSpace: "rec709",
  alphaMode: "opaque",
  pixelFormat: "yuv420p",
  quality: "final",
  transitions: [],
  audioSegment: { startSample: "0", endSampleExclusive: "48000" },
  browserIdentity: "playwright-managed:chromium_headless_shell-1228",
  rendererIdentity: "remotion-4.0.489",
  ffmpegVersion: "7.1.1",
  os: "darwin",
  architecture: "arm64",
  gpu: "apple",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  seeds: { default: "0" },
  lockfileHash: hash("lockfile"),
  approvedNetworkHashes: [],
});
