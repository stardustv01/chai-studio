import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { builtInDeliveryProfiles, type DeliveryProfile } from "../../packages/render/src/index.js";
import {
  normalizeRational,
  serializeBigInt,
  type AssetRecord,
  type TimelineClip,
  type TimelineDocument,
} from "../../packages/schema/src/index.js";
import { renderFullTimeline } from "../../apps/studio-server/src/full-timeline-compositor.js";
import { ProjectSessionService } from "../../apps/studio-server/src/project-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("full timeline compositor", () => {
  it("renders exact shared layers, keyframes, and captions across a half-open range", async () => {
    const fixture = await compositorFixture();
    const outputDirectory = path.join(fixture.root, "renders", "visual");
    await mkdir(outputDirectory, { recursive: true });
    const imageSequence = profile("image-sequence", {
      width: 160,
      height: 90,
      audioCodec: null,
      audioSampleRate: null,
    });

    const result = await renderFullTimeline({
      projects: fixture.projects,
      snapshot: fixture.snapshot,
      profile: imageSequence,
      scope: { kind: "selected-range", startFrame: "0", endFrameExclusive: "3" },
      outputDirectory,
      signal: new AbortController().signal,
      report: () => undefined,
    });

    expect(result).toMatchObject({
      primaryRelativePath: "frame-00000000.png",
      additionalRelativePaths: ["frame-00000001.png", "frame-00000002.png"],
      range: { startFrame: "0", endFrameExclusive: "3" },
      visualLayerCount: 1,
      captionCount: 1,
      audioMix: null,
    });
    const frame0 = path.join(outputDirectory, "frame-00000000.png");
    const frame1 = path.join(outputDirectory, "frame-00000001.png");
    const frame2 = path.join(outputDirectory, "frame-00000002.png");
    await expect(readPixel(frame0, 80, 45)).resolves.toEqual([252, 0, 0, 255]);
    const halfOpacity = await readPixel(frame1, 80, 45);
    expect(halfOpacity[0]).toBeGreaterThanOrEqual(126);
    expect(halfOpacity[0]).toBeLessThanOrEqual(129);
    expect(halfOpacity.slice(1)).toEqual([0, 0, 255]);
    expect(await hashFile(frame2)).not.toBe(await hashFile(frame1));
  });

  it("derives, measures, persists, and encodes the immutable timeline audio mix", async () => {
    const fixture = await compositorFixture();
    const outputDirectory = path.join(fixture.root, "renders", "audio");
    await mkdir(outputDirectory, { recursive: true });

    const result = await renderFullTimeline({
      projects: fixture.projects,
      snapshot: fixture.snapshot,
      profile: profile("audio"),
      scope: { kind: "selected-range", startFrame: "0", endFrameExclusive: "3" },
      outputDirectory,
      signal: new AbortController().signal,
      report: () => undefined,
    });

    expect(result).toMatchObject({
      primaryRelativePath: "program-audio.wav",
      additionalRelativePaths: ["program-audio-mix.wav"],
      range: { startFrame: "0", endFrameExclusive: "3" },
      audioMix: {
        range: { startFrame: "0", endFrameExclusive: "3" },
        sampleRate: 48_000,
        channels: 2,
        measurements: {
          durationSamples: 4_800n,
          clippedSampleCount: 0,
        },
      },
    });
    expect(result.audioMix?.measurements.integratedLufs).not.toBeNull();
    expect(result.audioMix?.measurements.peakDbfs).toBeLessThan(0);
    await expect(readFile(path.join(outputDirectory, result.primaryRelativePath))).resolves.toSatisfy(
      (bytes: Buffer) => bytes.subarray(0, 4).toString("ascii") === "RIFF",
    );
    await expect(readFile(path.join(outputDirectory, "program-audio-mix.wav"))).resolves.toSatisfy(
      (bytes: Buffer) => bytes.subarray(0, 4).toString("ascii") === "RIFF",
    );
  });

  it("uses property defaults for before-effects capture and excludes captions and audio", async () => {
    const fixture = await compositorFixture();
    const outputDirectory = path.join(fixture.root, "renders", "before-effects");
    await mkdir(outputDirectory, { recursive: true });
    const visual = fixture.snapshot.timeline.tracks[0]?.clips[0];
    if (visual === undefined) throw new Error("Visual fixture clip is missing.");
    const opacity = visual.properties?.["transform.opacity"];
    if (opacity === undefined) throw new Error("Opacity fixture property is missing.");
    const snapshot = {
      ...fixture.snapshot,
      timeline: {
        ...fixture.snapshot.timeline,
        tracks: fixture.snapshot.timeline.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.id === visual.id
              ? {
                  ...clip,
                  properties: {
                    ...clip.properties,
                    "transform.opacity": { ...opacity, value: 10, defaultValue: 100 },
                  },
                }
              : clip,
          ),
        })),
      },
    };

    const result = await renderFullTimeline({
      projects: fixture.projects,
      snapshot,
      profile: profile("still", { width: 160, height: 90, audioCodec: null, audioSampleRate: null }),
      scope: { kind: "frame", frame: "1" },
      outputDirectory,
      signal: new AbortController().signal,
      report: () => undefined,
      capture: {
        includeClipIds: new Set([visual.id]),
        propertyMode: "defaults",
        includeCaptions: false,
        includeAudio: false,
      },
    });

    expect(result).toMatchObject({ visualLayerCount: 1, captionCount: 0, audioMix: null });
    await expect(readPixel(path.join(outputDirectory, result.primaryRelativePath), 80, 45)).resolves.toEqual([
      252, 0, 0, 255,
    ]);
  });

  it("honors the clip ID in clip-scoped final-compositor renders", async () => {
    const fixture = await compositorFixture();
    const outputDirectory = path.join(fixture.root, "renders", "isolated");
    await mkdir(outputDirectory, { recursive: true });
    const assetDirectory = path.join(fixture.root, "assets", "test");
    const blueBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#0000ff"/></svg>',
    );
    await writeFile(path.join(assetDirectory, "blue.svg"), blueBytes);
    const red = fixture.snapshot.timeline.tracks[0]?.clips[0];
    if (red === undefined) throw new Error("Visual fixture clip is missing.");
    const blue: TimelineClip = { ...red, id: "clip-visual-test-0002", assetId: "asset-visual-test-0002" };
    const snapshot = {
      ...fixture.snapshot,
      timeline: {
        ...fixture.snapshot.timeline,
        tracks: fixture.snapshot.timeline.tracks.map((track, index) =>
          index === 0 ? { ...track, clips: [...track.clips, blue] } : track,
        ),
      },
      assets: {
        ...fixture.snapshot.assets,
        assets: [
          ...fixture.snapshot.assets.assets,
          {
            id: "asset-visual-test-0002",
            path: "assets/test/blue.svg",
            contentHash: sha256(blueBytes),
            kind: "image" as const,
            durationFrames: null,
            fps: null,
            hasAudio: false,
            hasAlpha: false,
            variableFrameRate: false,
            rights: "owned" as const,
            validationState: "valid" as const,
          },
        ],
      },
    };

    const result = await renderFullTimeline({
      projects: fixture.projects,
      snapshot,
      profile: profile("still", { width: 160, height: 90, audioCodec: null, audioSampleRate: null }),
      scope: { kind: "clip", clipId: red.id, startFrame: "0", endFrameExclusive: "3" },
      outputDirectory,
      signal: new AbortController().signal,
      report: () => undefined,
      capture: { includeAudio: false },
    });

    expect(result.visualLayerCount).toBe(1);
    await expect(readPixel(path.join(outputDirectory, result.primaryRelativePath), 80, 45)).resolves.toEqual([
      252, 0, 0, 255,
    ]);
  });

  it("rejects registered asset bytes changed after the immutable snapshot was created", async () => {
    const fixture = await compositorFixture();
    await writeFile(path.join(fixture.root, "assets", "test", "red.png"), "changed-after-registration");

    await expect(
      renderFullTimeline({
        projects: fixture.projects,
        snapshot: fixture.snapshot,
        profile: profile("still", { width: 160, height: 90, audioCodec: null, audioSampleRate: null }),
        scope: { kind: "frame", frame: "0" },
        outputDirectory: path.join(fixture.root, "renders", "mutated-asset"),
        signal: new AbortController().signal,
        report: () => undefined,
        capture: { includeAudio: false },
      }),
    ).rejects.toThrow(/content hash no longer matches/i);
  });

  it("rejects a registered project asset replaced by an external symlink", async () => {
    const fixture = await compositorFixture();
    const registeredPath = path.join(fixture.root, "assets", "test", "red.png");
    const originalBytes = await readFile(registeredPath);
    const externalPath = path.join(path.dirname(fixture.root), "outside-red.png");
    await writeFile(externalPath, originalBytes);
    await rm(registeredPath);
    await symlink(externalPath, registeredPath);

    await expect(
      renderFullTimeline({
        projects: fixture.projects,
        snapshot: fixture.snapshot,
        profile: profile("still", { width: 160, height: 90, audioCodec: null, audioSampleRate: null }),
        scope: { kind: "frame", frame: "0" },
        outputDirectory: path.join(fixture.root, "renders", "symlinked-asset"),
        signal: new AbortController().signal,
        report: () => undefined,
        capture: { includeAudio: false },
      }),
    ).rejects.toThrow(/regular file.*symlinks are forbidden/i);
  });

  it("continues to render an exact asset from an explicitly approved external root", async () => {
    const fixture = await compositorFixture();
    const externalRoot = path.join(path.dirname(fixture.root), "approved-stock");
    await mkdir(externalRoot, { recursive: true });
    const externalBytes = await readFile(path.join(fixture.root, "assets", "test", "red.png"));
    await writeFile(path.join(externalRoot, "red.png"), externalBytes);
    const snapshot = {
      ...fixture.snapshot,
      assets: {
        ...fixture.snapshot.assets,
        assets: fixture.snapshot.assets.assets.map((asset) =>
          asset.id === "asset-visual-test-0001" ? { ...asset, path: "external/stock/red.png" } : asset,
        ),
      },
    };
    const outputDirectory = path.join(fixture.root, "renders", "approved-external");

    const result = await renderFullTimeline({
      projects: fixture.projects,
      snapshot,
      profile: profile("still", { width: 160, height: 90, audioCodec: null, audioSampleRate: null }),
      scope: { kind: "frame", frame: "0" },
      outputDirectory,
      signal: new AbortController().signal,
      report: () => undefined,
      approvedExternalRoots: [{ id: "stock", path: externalRoot }],
      capture: { includeAudio: false },
    });

    await expect(readPixel(path.join(outputDirectory, result.primaryRelativePath), 80, 45)).resolves.toEqual([
      252, 0, 0, 255,
    ]);
  });
});

const compositorFixture = async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chai-full-compositor-"));
  temporaryDirectories.push(parent);
  const root = path.join(parent, "Compositor.chai");
  const projects = new ProjectSessionService();
  await projects.create({ targetPath: root, title: "Compositor" });
  const current = await projects.snapshot();
  const assetDirectory = path.join(root, "assets", "test");
  await mkdir(assetDirectory, { recursive: true });
  const imagePath = path.join(assetDirectory, "red.png");
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP4w8AARAwQCgAfjgPxzzTeXgAAAABJRU5ErkJggg==",
    "base64",
  );
  await writeFile(imagePath, imageBytes);
  const audioPath = path.join(assetDirectory, "tone.wav");
  const audioBytes = toneWave(48_000, 4_800, 440, 0.25);
  await writeFile(audioPath, audioBytes);

  const visualClip: TimelineClip = {
    id: "clip-visual-test-0001",
    assetId: "asset-visual-test-0001",
    engine: "shared",
    startFrame: serializeBigInt(0n),
    durationFrames: serializeBigInt(3n),
    sourceInFrame: serializeBigInt(0n),
    sourceDurationFrames: serializeBigInt(3n),
    capability: "unified",
    audioBusId: null,
    name: "Red square",
    properties: {
      "transform.position": property([0, 0], "px"),
      "transform.scale": property([100, 100], "percent"),
      "transform.rotation": property(0, "degrees"),
      "transform.anchor": property([50, 50], "percent"),
      "transform.opacity": property(100, "percent"),
      "transform.crop": property([0, 0, 0, 0], "percent"),
      "composite.blendMode": property("normal", "enum", false),
    },
  };
  const audioClip: TimelineClip = {
    id: "clip-audio-test-0001",
    assetId: "asset-audio-test-0001",
    engine: "shared",
    startFrame: serializeBigInt(0n),
    durationFrames: serializeBigInt(3n),
    sourceInFrame: serializeBigInt(0n),
    sourceDurationFrames: serializeBigInt(3n),
    capability: "unified",
    audioBusId: null,
    name: "Tone",
    properties: {
      "audio.volume": property(0, "decibels"),
      "audio.fadeIn": property(0, "frames"),
      "audio.fadeOut": property(0, "frames"),
    },
  };
  const timeline: TimelineDocument = {
    ...current.timeline,
    durationFrames: serializeBigInt(3n),
    fps: normalizeRational(30n, 1n),
    tracks: [
      {
        id: "track-video-test-0001",
        kind: "video",
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        clips: [visualClip],
      },
      {
        id: "track-audio-test-0001",
        kind: "audio",
        name: "A1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        clips: [audioClip],
      },
    ],
    keyframes: [
      keyframe("keyframe-opacity-test-0001", visualClip.id, 0n, 100),
      keyframe("keyframe-opacity-test-0002", visualClip.id, 1n, 50),
    ],
    captionDocuments: [
      {
        schemaVersion: "1.0.0",
        captionDocumentId: "captions-test-0001",
        transcriptId: null,
        styles: [],
        cues: [
          {
            id: "caption-cue-test-0001",
            trackId: "track-caption-test-0001",
            transcriptId: null,
            phraseId: null,
            startFrame: serializeBigInt(2n),
            endFrameExclusive: serializeBigInt(3n),
            text: "Exact caption",
            lines: ["Exact caption"],
            speakerId: null,
            wordIds: [],
            locked: false,
            styleTemplateId: "caption-style-test-0001",
          },
        ],
      },
    ],
  };
  const assets: readonly AssetRecord[] = [
    {
      id: visualClip.assetId ?? "",
      path: "assets/test/red.png",
      contentHash: sha256(imageBytes),
      kind: "image",
      durationFrames: null,
      fps: null,
      hasAudio: false,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "owned",
      validationState: "valid",
    },
    {
      id: audioClip.assetId ?? "",
      path: "assets/test/tone.wav",
      contentHash: sha256(audioBytes),
      kind: "audio",
      durationFrames: serializeBigInt(3n),
      fps: normalizeRational(30n, 1n),
      hasAudio: true,
      hasAlpha: false,
      variableFrameRate: false,
      rights: "owned",
      validationState: "valid",
    },
  ];
  return {
    root,
    projects,
    snapshot: { ...current, timeline, assets: { ...current.assets, assets } },
  };
};

const property = (
  value: NonNullable<TimelineClip["properties"]>[string]["value"],
  unit: NonNullable<TimelineClip["properties"]>[string]["unit"],
  keyframeable = true,
): NonNullable<TimelineClip["properties"]>[string] => ({
  value,
  defaultValue: value,
  unit,
  minimum: null,
  maximum: null,
  step: null,
  ownership: "shared",
  keyframeable,
  capability: "unified",
  safeToEdit: true,
  nativeAnimation: false,
  supportsSharedConversion: false,
});

const keyframe = (id: string, ownerEntityId: string, frame: bigint, value: number) => ({
  id,
  ownerEntityId,
  propertyPath: "transform.opacity",
  frame: serializeBigInt(frame),
  value,
  interpolation: "linear" as const,
  inTangent: null,
  outTangent: null,
  authority: "shared" as const,
  preserveNativeAnimation: false,
});

const profile = (
  outputKind: DeliveryProfile["outputKind"],
  patch: Partial<DeliveryProfile> = {},
): DeliveryProfile => {
  const candidate = builtInDeliveryProfiles().find((item) => item.outputKind === outputKind);
  if (candidate === undefined) throw new Error(`Built-in ${outputKind} profile is unavailable.`);
  return { ...candidate, ...patch };
};

const readPixel = async (filePath: string, x: number, y: number): Promise<readonly number[]> => {
  const bytes = await runCapture(process.env.CHAI_STUDIO_FFMPEG ?? "ffmpeg", [
    "-v",
    "error",
    "-i",
    filePath,
    "-vf",
    `crop=1:1:${String(x)}:${String(y)}`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1",
  ]);
  return [...bytes.subarray(0, 4)];
};

const runCapture = (executable: string, arguments_: readonly string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`Fixture FFmpeg failed (${String(code)}): ${stderr}`));
    });
  });

const toneWave = (sampleRate: number, sampleCount: number, frequency: number, amplitude: number): Buffer => {
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + sampleCount * 2, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude;
    bytes.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return bytes;
};

const hashFile = async (filePath: string): Promise<string> => sha256(await readFile(filePath));
const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
