import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  buildWaveformEnvelope,
  fingerprintGeneratedViewProfile,
  generateMediaView,
  generatedViewFfmpegArguments,
  generatedViewIsCurrent,
  type ContactSheetViewProfile,
  type FilmstripViewProfile,
  type ThumbnailViewProfile,
} from "../../packages/media/src/index.js";

const temporaryDirectories: string[] = [];
const sourceHash = "9".repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("content-addressed generated media views", () => {
  it("caches verified output and regenerates after deletion or profile/source invalidation", async () => {
    const cacheDirectory = await temporaryDirectory();
    let productions = 0;
    const producer = async (context: { readonly outputPath: string }) => {
      productions += 1;
      await writeFile(context.outputPath, `view-${String(productions)}`);
    };
    const first = await generateMediaView({
      sourceFilePath: "unused.mov",
      sourceContentHash: sourceHash,
      cacheDirectory,
      profile: thumbnail(),
      producer,
    });
    const cached = await generateMediaView({
      sourceFilePath: "different-path-same-content.mov",
      sourceContentHash: sourceHash,
      cacheDirectory,
      profile: thumbnail(),
      producer,
    });
    expect(cached).toEqual(first);
    expect(productions).toBe(1);

    await rm(first.outputPath);
    const restarted = await generateMediaView({
      sourceFilePath: "unused.mov",
      sourceContentHash: sourceHash,
      cacheDirectory,
      profile: thumbnail(),
      producer,
    });
    expect(productions).toBe(2);
    expect(restarted.outputContentHash).not.toBe(first.outputContentHash);

    const changedProfile = { ...thumbnail(), width: 640 };
    const changed = await generateMediaView({
      sourceFilePath: "unused.mov",
      sourceContentHash: sourceHash,
      cacheDirectory,
      profile: changedProfile,
      producer,
    });
    expect(productions).toBe(3);
    expect(changed.cacheKey).not.toBe(first.cacheKey);
    expect(generatedViewIsCurrent(first, sourceHash, changedProfile)).toBe(false);
  });

  it("builds deterministic thumbnail, contact-sheet, and filmstrip ffmpeg plans", () => {
    const thumbnailArguments = generatedViewFfmpegArguments("source.mov", "thumb.png", thumbnail());
    expect(thumbnailArguments.join(" ")).toContain("select='gte(t,1/2)'");

    const contact: ContactSheetViewProfile = {
      kind: "contact-sheet",
      tileWidth: 320,
      tileHeight: 180,
      columns: 4,
      rows: 3,
      sampleFrameRate: normalizeRational(1n, 2n),
      format: "jpeg",
    };
    expect(generatedViewFfmpegArguments("source.mov", "sheet.jpg", contact).join(" ")).toContain("tile=4x3");

    const filmstrip: FilmstripViewProfile = {
      kind: "filmstrip",
      tileWidth: 160,
      tileHeight: 90,
      frameCount: 8,
      sampleFrameRate: normalizeRational(2n, 1n),
      format: "png",
    };
    expect(generatedViewFfmpegArguments("source.mov", "strip.png", filmstrip).join(" ")).toContain(
      "tile=8x1",
    );
    expect(fingerprintGeneratedViewProfile(filmstrip)).toHaveLength(64);
  });

  it("reduces interleaved PCM into deterministic per-channel min/max waveform buckets", () => {
    const pcm = Buffer.alloc(8 * 4);
    const samples = [-1, 0.5, -0.5, 1, 0.25, -0.25, 0.75, -0.75];
    samples.forEach((sample, index) => pcm.writeFloatLE(sample, index * 4));
    expect(buildWaveformEnvelope(pcm, 2, 2)).toEqual({
      schemaVersion: "1.0.0",
      channels: 2,
      bucketCount: 2,
      minimums: [
        [-1, 0],
        [0, -0.75],
      ],
      maximums: [
        [0, 0.75],
        [1, 0],
      ],
    });
  });

  it("cancels before production and leaves no published cache artifact", async () => {
    const cacheDirectory = await temporaryDirectory();
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateMediaView({
        sourceFilePath: "unused.mov",
        sourceContentHash: sourceHash,
        cacheDirectory,
        profile: thumbnail(),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-generated-view-"));
  temporaryDirectories.push(directory);
  return directory;
};

const thumbnail = (): ThumbnailViewProfile => ({
  kind: "thumbnail",
  width: 320,
  height: 180,
  atSeconds: normalizeRational(1n, 2n),
  format: "png",
});
