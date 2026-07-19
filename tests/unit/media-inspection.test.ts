import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMediaFile, parseFfprobeOutput } from "../../packages/media/src/index.js";

const temporaryDirectories: string[] = [];
const contentHash = "b".repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ffprobe media inspection", () => {
  it("parses container, video, audio, exact rates, alpha, duration, and VFR status", () => {
    const inspection = parseFfprobeOutput(ffprobeFixture(), contentHash, "ffprobe version fixture-1");
    expect(inspection.containerNames).toEqual(["mov", "mp4"]);
    expect(inspection.containerLongName).toBe("QuickTime / MOV");
    expect(inspection.durationSeconds).toEqual({ numerator: "2469", denominator: "200" });
    expect(inspection.sizeBytes).toBe("123456");
    expect(inspection.videoStreams[0]).toMatchObject({
      codec: "prores",
      pixelFormat: "yuva444p10le",
      width: 1920,
      height: 1080,
      averageFrameRate: { numerator: "30000", denominator: "1001" },
      realFrameRate: { numerator: "30", denominator: "1" },
      timeBase: { numerator: "1", denominator: "30000" },
      hasAlpha: true,
      variableFrameRate: true,
    });
    expect(inspection.audioStreams[0]).toMatchObject({
      codec: "pcm_s24le",
      sampleRate: 48000,
      channels: 2,
      channelLayout: "stereo",
    });
    expect(inspection).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      hasAlpha: true,
      variableFrameRate: true,
    });
  });

  it("caches validated results by content hash and survives corrupt cache replacement", async () => {
    const cacheDirectory = await temporaryDirectory();
    let probeRuns = 0;
    const runProbe = () => {
      probeRuns += 1;
      return Promise.resolve({ stdout: ffprobeFixture(), probeVersion: "ffprobe version fixture-1" });
    };
    const first = await inspectMediaFile({
      filePath: "/unused/by-injected-probe.mov",
      contentHash,
      cacheDirectory,
      runProbe,
    });
    const second = await inspectMediaFile({
      filePath: "/also-unused.mov",
      contentHash,
      cacheDirectory,
      runProbe,
    });
    expect(second).toEqual(first);
    expect(probeRuns).toBe(1);
  });

  it("rejects malformed probe contracts", () => {
    expect(() => parseFfprobeOutput("not-json", contentHash, "fixture")).toThrow(/invalid JSON/);
    expect(() => parseFfprobeOutput(JSON.stringify({ streams: [] }), contentHash, "fixture")).toThrow(
      /lacks streams or format/,
    );
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-inspection-cache-"));
  temporaryDirectories.push(directory);
  return directory;
};

const ffprobeFixture = (): string =>
  JSON.stringify({
    streams: [
      {
        index: 0,
        codec_name: "prores",
        profile: "4444",
        codec_type: "video",
        pix_fmt: "yuva444p10le",
        width: 1920,
        height: 1080,
        r_frame_rate: "30/1",
        avg_frame_rate: "30000/1001",
        time_base: "1/30000",
        duration: "12.345000",
        nb_frames: "370",
      },
      {
        index: 1,
        codec_name: "pcm_s24le",
        profile: "unknown",
        codec_type: "audio",
        sample_rate: "48000",
        channels: 2,
        channel_layout: "stereo",
        time_base: "1/48000",
        duration: "12.345000",
      },
    ],
    format: {
      format_name: "mov,mp4",
      format_long_name: "QuickTime / MOV",
      duration: "12.345000",
      size: "123456",
    },
  });
