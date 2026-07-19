import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  releaseEnvironmentFingerprint,
  studioReleaseIdentity,
} from "../../packages/diagnostics/src/release.js";

describe("P27 release identity", () => {
  it("freezes a localhost-only release candidate without cloud or wrapper dependencies", () => {
    expect(studioReleaseIdentity).toMatchObject({
      version: "1.0.0-rc.3",
      supportClass: "apple-m4-16gb",
      launchModel: "localhost-web-server",
      cloudAccountRequired: false,
      desktopWrapperRequired: false,
      engines: { remotion: "4.0.489", hyperframes: "0.7.58" },
    });
  });

  it("creates a stable environment fingerprint input", () => {
    const input = {
      platform: "darwin",
      architecture: "arm64",
      cpuModel: "Apple M4",
      memoryGiB: 16,
      nodeVersion: "v22.17.0",
      ffmpegVersion: "7.1.1",
      browserIdentity: "playwright-managed:chromium-1228",
    };
    expect(releaseEnvironmentFingerprint(input)).toBe(releaseEnvironmentFingerprint(input));
    expect(releaseEnvironmentFingerprint({ ...input, nodeVersion: "v22.18.0" })).not.toBe(
      releaseEnvironmentFingerprint(input),
    );
  });

  it("keeps every distributable workspace on the declared release candidate", async () => {
    const manifests = [
      "package.json",
      "apps/studio-server/package.json",
      "apps/studio-web/package.json",
      "packages/audio/package.json",
      "packages/bridge/package.json",
      "packages/captions/package.json",
      "packages/diagnostics/package.json",
      "packages/engine-adapters/package.json",
      "packages/media/package.json",
      "packages/preview/package.json",
      "packages/qa/package.json",
      "packages/render/package.json",
      "packages/review/package.json",
      "packages/schema/package.json",
      "packages/security/package.json",
      "packages/timeline/package.json",
      "packages/ui-components/package.json",
    ];
    const versions = await Promise.all(
      manifests.map(async (manifest) => {
        const parsed = JSON.parse(await readFile(manifest, "utf8")) as { readonly version?: string };
        return [manifest, parsed.version] as const;
      }),
    );

    expect(versions).toEqual(manifests.map((manifest) => [manifest, studioReleaseIdentity.version] as const));
  });

  it("indexes all nine release examples with existing descriptors", async () => {
    const manifest = JSON.parse(await readFile("examples/manifest.json", "utf8")) as {
      examples: readonly { file: string }[];
    };
    expect(manifest.examples).toHaveLength(9);
    await Promise.all(
      manifest.examples.map((example) => expect(readFile(`examples/${example.file}`)).resolves.toBeDefined()),
    );
  });
});
