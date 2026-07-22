import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createDefaultAudioGraph, sampleBoundaryForFrame, type DecodedAudioBlock } from "@chai-studio/audio";
import { renderOfflineAudioMix, type OfflineAudioMixArtifact } from "@chai-studio/audio/offline";
import { authorizeAssetPath, sha256File, type ApprovedExternalAssetRoot } from "@chai-studio/media";
import type { AssetRecord, AudioGraphDocument, TimelineClip, TimelineDocument } from "@chai-studio/schema";
import type { DeliveryProfile, RenderScope } from "@chai-studio/render";
import sharp, { type Blend, type OverlayOptions } from "sharp";
import {
  renderNativeCompositionLayer,
  type NativeCompositionInspection,
  type NativeCompositionTrust,
} from "./native-composition-runtime.js";
import type { ProjectSessionService } from "./project-service.js";

type ProjectSnapshot = Awaited<ReturnType<ProjectSessionService["snapshot"]>>;
type TimelineKeyframe = NonNullable<TimelineDocument["keyframes"]>[number];
type TimelinePropertyValue = number | string | boolean | readonly number[];

export interface FullTimelineCompositorResult {
  readonly primaryRelativePath: string;
  readonly additionalRelativePaths: readonly string[];
  readonly range: Readonly<{ startFrame: string; endFrameExclusive: string }>;
  readonly visualLayerCount: number;
  readonly captionCount: number;
  readonly audioMix: OfflineAudioMixArtifact | null;
  readonly nativeLayers: readonly Readonly<{
    assetId: string;
    clipId: string;
    inspection: NativeCompositionInspection;
  }>[];
}

export interface FullTimelineCaptureOptions {
  readonly includeClipIds?: ReadonlySet<string>;
  readonly propertyMode?: "evaluated" | "defaults";
  readonly includeCaptions?: boolean;
  readonly includeAudio?: boolean;
}

interface PreparedVisualLayer {
  readonly clip: TimelineClip;
  readonly asset: AssetRecord;
  readonly timelineStart: bigint;
  readonly timelineEnd: bigint;
  readonly sourceKind: "image" | "sequence";
  readonly imagePath: string | null;
  readonly sequenceDirectory: string | null;
  readonly sequenceStartFrame: bigint;
  readonly nativeInspection: NativeCompositionInspection | null;
}

interface RenderFrameProperties {
  readonly position: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly rotation: number;
  readonly anchor: readonly [number, number];
  readonly opacity: number;
  readonly crop: readonly [number, number, number, number];
  readonly blendMode: string;
}

export const renderFullTimeline = async (input: {
  readonly projects: ProjectSessionService;
  readonly snapshot: ProjectSnapshot;
  readonly profile: DeliveryProfile;
  readonly scope: RenderScope;
  readonly projectRoot?: string;
  readonly outputDirectory: string;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
  readonly ffmpegPath?: string;
  readonly nativeTrustByAssetId?: ReadonlyMap<string, NativeCompositionTrust>;
  readonly approvedExternalRoots?: readonly ApprovedExternalAssetRoot[];
  readonly capture?: FullTimelineCaptureOptions;
}): Promise<FullTimelineCompositorResult> => {
  const ffmpegPath = input.ffmpegPath ?? process.env.CHAI_STUDIO_FFMPEG ?? "ffmpeg";
  const projectRoot = input.projectRoot ?? input.projects.openRootPath();
  const range = renderRange(input.snapshot.timeline, input.scope);
  const width = input.profile.width ?? input.snapshot.project.video.width;
  const height = input.profile.height ?? input.snapshot.project.video.height;
  const fps = input.profile.fps ?? input.snapshot.timeline.fps;
  const temporaryRoot = path.join(input.outputDirectory, `.timeline-${randomUUID()}`);
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  try {
    throwIfAborted(input.signal);
    const prepared = await prepareSharedVisualLayers({
      snapshot: input.snapshot,
      projectRoot,
      range,
      fps,
      temporaryRoot,
      ffmpegPath,
      signal: input.signal,
      report: input.report,
      nativeTrustByAssetId: input.nativeTrustByAssetId ?? new Map(),
      approvedExternalRoots: input.approvedExternalRoots ?? [],
      ...(input.capture?.includeClipIds === undefined
        ? {}
        : { includeClipIds: input.capture.includeClipIds }),
      ...(input.scope.kind === "clip" ? { scopeClipId: input.scope.clipId } : {}),
    });
    const captions =
      input.capture?.includeCaptions === false ? [] : activeCaptions(input.snapshot.timeline, range);
    const framesDirectory = path.join(temporaryRoot, "program-frames");
    const needsVideoFrames = input.profile.outputKind !== "audio";
    const framePaths: string[] = [];
    if (needsVideoFrames) {
      await mkdir(framesDirectory, { recursive: true, mode: 0o700 });
      const frameCount = range.end - range.start;
      for (let offset = 0n; offset < frameCount; offset += 1n) {
        throwIfAborted(input.signal);
        const masterFrame = range.start + offset;
        const outputPath = path.join(framesDirectory, `frame-${padFrame(offset + 1n)}.png`);
        await compositeFrame({
          snapshot: input.snapshot,
          prepared,
          captions,
          masterFrame,
          width,
          height,
          alpha: input.profile.alpha !== "none",
          propertyMode: input.capture?.propertyMode ?? "evaluated",
          outputPath,
        });
        framePaths.push(outputPath);
        input.report(0.28 + 0.42 * (Number(offset + 1n) / Number(frameCount)));
      }
    }

    const audioMix =
      input.capture?.includeAudio === false
        ? null
        : await prepareAudioMix({
            snapshot: input.snapshot,
            projectRoot,
            range,
            profile: input.profile,
            outputPath: path.join(temporaryRoot, "program-audio.wav"),
            ffmpegPath,
            signal: input.signal,
            approvedExternalRoots: input.approvedExternalRoots ?? [],
          });
    input.report(0.78);
    const artifacts = await encodeOutput({
      profile: input.profile,
      range,
      fps,
      framePaths,
      framesDirectory,
      audioMix,
      outputDirectory: input.outputDirectory,
      ffmpegPath,
      signal: input.signal,
    });
    const durableAudioMix =
      audioMix === null ? null : await persistAudioMixEvidence(audioMix, input.outputDirectory);
    input.report(0.96);
    return {
      primaryRelativePath: artifacts[0] ?? fail("Timeline compositor produced no artifact."),
      additionalRelativePaths: [
        ...artifacts.slice(1),
        ...(durableAudioMix === null ? [] : [path.basename(durableAudioMix.outputPath)]),
      ],
      range: {
        startFrame: range.start.toString(10),
        endFrameExclusive: range.end.toString(10),
      },
      visualLayerCount: prepared.length,
      captionCount: captions.length,
      audioMix: durableAudioMix,
      nativeLayers: prepared.flatMap((layer) =>
        layer.nativeInspection === null
          ? []
          : [{ assetId: layer.asset.id, clipId: layer.clip.id, inspection: layer.nativeInspection }],
      ),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

const persistAudioMixEvidence = async (
  artifact: OfflineAudioMixArtifact,
  outputDirectory: string,
): Promise<OfflineAudioMixArtifact> => {
  const outputPath = path.join(outputDirectory, "program-audio-mix.wav");
  await copyFile(artifact.outputPath, outputPath);
  return { ...artifact, outputPath };
};

const prepareSharedVisualLayers = async (input: {
  readonly snapshot: ProjectSnapshot;
  readonly projectRoot: string;
  readonly range: Readonly<{ start: bigint; end: bigint }>;
  readonly fps: Readonly<{ numerator: string; denominator: string }>;
  readonly temporaryRoot: string;
  readonly ffmpegPath: string;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
  readonly nativeTrustByAssetId: ReadonlyMap<string, NativeCompositionTrust>;
  readonly approvedExternalRoots: readonly ApprovedExternalAssetRoot[];
  readonly includeClipIds?: ReadonlySet<string>;
  readonly scopeClipId?: string;
}): Promise<readonly PreparedVisualLayer[]> => {
  const assetById = new Map(input.snapshot.assets.assets.map((asset) => [asset.id, asset]));
  const clips = input.snapshot.timeline.tracks
    .filter((track) => track.kind === "video" && !track.hidden && !track.muted)
    .sort((left, right) => left.order - right.order)
    .flatMap((track) => track.clips)
    .filter(
      (clip) =>
        intersects(clip, input.range) &&
        (input.includeClipIds === undefined || input.includeClipIds.has(clip.id)) &&
        (input.scopeClipId === undefined || clip.id === input.scopeClipId),
    );
  const prepared: PreparedVisualLayer[] = [];
  for (const [index, clip] of clips.entries()) {
    if (clip.assetId === null) throw new Error(`Visual clip ${clip.id} has no registered asset.`);
    const asset = assetById.get(clip.assetId);
    if (asset?.validationState !== "valid") throw new Error(`Visual clip ${clip.id} is not validated.`);
    const sourcePath = await resolveVerifiedAsset(input.projectRoot, asset, input.approvedExternalRoots);
    const timelineStart = maximum(BigInt(clip.startFrame), input.range.start);
    const timelineEnd = minimum(BigInt(clip.startFrame) + BigInt(clip.durationFrames), input.range.end);
    if (clip.engine !== "shared") {
      if (asset.kind !== "composition") {
        throw new Error(`Native visual clip ${clip.id} does not reference a composition manifest.`);
      }
      const sequenceDirectory = path.join(input.temporaryRoot, `layer-${String(index).padStart(4, "0")}`);
      await mkdir(sequenceDirectory, { recursive: true, mode: 0o700 });
      const trustClass = input.nativeTrustByAssetId.get(asset.id);
      if (trustClass === undefined) {
        throw new Error(`Native composition ${asset.id} has no exact render trust classification.`);
      }
      const nativeInspection = await renderNativeCompositionLayer({
        projectRoot: input.projectRoot,
        manifestPath: asset.path,
        clip,
        timelineStart,
        timelineEnd,
        outputDirectory: sequenceDirectory,
        trustClass,
        signal: input.signal,
        onProgress: (progress) => {
          input.report(0.08 + 0.17 * ((index + progress) / clips.length));
        },
      });
      prepared.push({
        clip,
        asset,
        timelineStart,
        timelineEnd,
        sourceKind: "sequence",
        imagePath: null,
        sequenceDirectory,
        sequenceStartFrame: timelineStart,
        nativeInspection,
      });
      continue;
    }
    if (asset.kind !== "video" && asset.kind !== "image") {
      throw new Error(`Shared visual clip ${clip.id} does not reference a video or image source.`);
    }
    if (asset.kind === "image") {
      prepared.push({
        clip,
        asset,
        timelineStart,
        timelineEnd,
        sourceKind: "image",
        imagePath: sourcePath,
        sequenceDirectory: null,
        sequenceStartFrame: timelineStart,
        nativeInspection: null,
      });
      continue;
    }
    const sequenceDirectory = path.join(input.temporaryRoot, `layer-${String(index).padStart(4, "0")}`);
    await mkdir(sequenceDirectory, { recursive: true, mode: 0o700 });
    const speed = numericProperty(clip, "time.speed", 1);
    const sourceFrame =
      BigInt(clip.sourceInFrame) +
      BigInt(Math.floor(Number(timelineStart - BigInt(clip.startFrame)) * speed));
    const sourceFps = asset.fps ?? input.snapshot.timeline.fps;
    const frameCount = timelineEnd - timelineStart;
    const filters = [
      ...(speed === 1 ? [] : [`setpts=(PTS-STARTPTS)/${decimal(speed)}`]),
      `fps=${input.fps.numerator}/${input.fps.denominator}`,
    ];
    await runFfmpeg(
      input.ffmpegPath,
      [
        "-y",
        "-ss",
        frameSeconds(sourceFrame, sourceFps),
        "-i",
        sourcePath,
        "-vf",
        filters.join(","),
        "-frames:v",
        frameCount.toString(10),
        "-an",
        path.join(sequenceDirectory, "frame-%08d.png"),
      ],
      input.signal,
      `shared video layer ${clip.id}`,
    );
    prepared.push({
      clip,
      asset,
      timelineStart,
      timelineEnd,
      sourceKind: "sequence",
      imagePath: null,
      sequenceDirectory,
      sequenceStartFrame: timelineStart,
      nativeInspection: null,
    });
    input.report(0.08 + 0.17 * ((index + 1) / Math.max(1, clips.length)));
  }
  return prepared;
};

const compositeFrame = async (input: {
  readonly snapshot: ProjectSnapshot;
  readonly prepared: readonly PreparedVisualLayer[];
  readonly captions: readonly Readonly<{ start: bigint; end: bigint; text: string }>[];
  readonly masterFrame: bigint;
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean;
  readonly propertyMode: "evaluated" | "defaults";
  readonly outputPath: string;
}): Promise<void> => {
  const composites: OverlayOptions[] = [];
  for (const layer of input.prepared) {
    if (input.masterFrame < layer.timelineStart || input.masterFrame >= layer.timelineEnd) continue;
    const sourcePath =
      layer.sourceKind === "image"
        ? layer.imagePath
        : path.join(
            layer.sequenceDirectory ?? fail("Prepared sequence directory is missing."),
            `frame-${padFrame(input.masterFrame - layer.sequenceStartFrame + 1n)}.png`,
          );
    if (sourcePath === null) throw new Error(`Prepared source for ${layer.clip.id} is missing.`);
    const transformed = await transformLayer(
      sourcePath,
      input.width,
      input.height,
      frameProperties(input.snapshot.timeline, layer.clip, input.masterFrame, input.propertyMode),
    );
    if (transformed === null) continue;
    composites.push({
      input: transformed.buffer,
      left: transformed.left,
      top: transformed.top,
      blend: blendMode(
        frameProperties(input.snapshot.timeline, layer.clip, input.masterFrame, input.propertyMode).blendMode,
      ),
    });
  }
  for (const caption of input.captions) {
    if (input.masterFrame < caption.start || input.masterFrame >= caption.end) continue;
    composites.push({ input: captionSvg(caption.text, input.width, input.height), left: 0, top: 0 });
  }
  await sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 4,
      background: input.alpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(input.outputPath);
};

const transformLayer = async (
  sourcePath: string,
  outputWidth: number,
  outputHeight: number,
  properties: RenderFrameProperties,
): Promise<Readonly<{ buffer: Buffer; left: number; top: number }> | null> => {
  const source = sharp(sourcePath, { failOn: "error" }).ensureAlpha();
  const metadata = await source.metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (
    !Number.isSafeInteger(sourceWidth) ||
    sourceWidth <= 0 ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceHeight <= 0
  ) {
    throw new Error(`Image dimensions are invalid for ${sourcePath}.`);
  }
  const cropTop = clamp(properties.crop[0], 0, 99);
  const cropRight = clamp(properties.crop[1], 0, 99);
  const cropBottom = clamp(properties.crop[2], 0, 99);
  const cropLeft = clamp(properties.crop[3], 0, 99);
  const left = Math.floor((sourceWidth * cropLeft) / 100);
  const top = Math.floor((sourceHeight * cropTop) / 100);
  const croppedWidth = Math.max(1, sourceWidth - left - Math.floor((sourceWidth * cropRight) / 100));
  const croppedHeight = Math.max(1, sourceHeight - top - Math.floor((sourceHeight * cropBottom) / 100));
  const scaleX = clamp(Math.abs(properties.scale[0]), 0.001, 1_000);
  const scaleY = clamp(Math.abs(properties.scale[1]), 0.001, 1_000);
  let pipeline = source.extract({ left, top, width: croppedWidth, height: croppedHeight }).resize({
    width: Math.max(1, Math.round(croppedWidth * (scaleX / 100))),
    height: Math.max(1, Math.round(croppedHeight * (scaleY / 100))),
    fit: "fill",
  });
  if (properties.scale[0] < 0) pipeline = pipeline.flop();
  if (properties.scale[1] < 0) pipeline = pipeline.flip();
  if (properties.rotation !== 0) {
    pipeline = pipeline.rotate(properties.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  const opacity = clamp(properties.opacity / 100, 0, 1);
  const rendered =
    opacity >= 1
      ? await pipeline.png().toBuffer({ resolveWithObject: true })
      : await (async () => {
          const raw = await pipeline.raw().toBuffer({ resolveWithObject: true });
          if (raw.info.channels !== 4) {
            throw new Error(`Opacity evaluation expected RGBA pixels for ${sourcePath}.`);
          }
          for (let offset = 3; offset < raw.data.length; offset += raw.info.channels) {
            raw.data[offset] = Math.round((raw.data[offset] ?? 0) * opacity);
          }
          return sharp(raw.data, {
            raw: {
              width: raw.info.width,
              height: raw.info.height,
              channels: raw.info.channels,
            },
          })
            .png()
            .toBuffer({ resolveWithObject: true });
        })();
  const targetLeft = Math.round(
    outputWidth / 2 + properties.position[0] - rendered.info.width * (properties.anchor[0] / 100),
  );
  const targetTop = Math.round(
    outputHeight / 2 + properties.position[1] - rendered.info.height * (properties.anchor[1] / 100),
  );
  const sourceLeft = Math.max(0, -targetLeft);
  const sourceTop = Math.max(0, -targetTop);
  const visibleWidth = Math.min(rendered.info.width - sourceLeft, outputWidth - Math.max(0, targetLeft));
  const visibleHeight = Math.min(rendered.info.height - sourceTop, outputHeight - Math.max(0, targetTop));
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;
  const buffer =
    sourceLeft === 0 &&
    sourceTop === 0 &&
    visibleWidth === rendered.info.width &&
    visibleHeight === rendered.info.height
      ? rendered.data
      : await sharp(rendered.data)
          .extract({ left: sourceLeft, top: sourceTop, width: visibleWidth, height: visibleHeight })
          .png()
          .toBuffer();
  return { buffer, left: Math.max(0, targetLeft), top: Math.max(0, targetTop) };
};

const prepareAudioMix = async (input: {
  readonly snapshot: ProjectSnapshot;
  readonly projectRoot: string;
  readonly range: Readonly<{ start: bigint; end: bigint }>;
  readonly profile: DeliveryProfile;
  readonly outputPath: string;
  readonly ffmpegPath: string;
  readonly signal: AbortSignal;
  readonly approvedExternalRoots: readonly ApprovedExternalAssetRoot[];
}): Promise<OfflineAudioMixArtifact | null> => {
  if (input.profile.audioCodec === null && input.profile.outputKind !== "audio") return null;
  const graph = deriveAudioGraph(input.snapshot);
  const active = graph.clips.filter(
    (clip) => BigInt(clip.endFrameExclusive) > input.range.start && BigInt(clip.startFrame) < input.range.end,
  );
  if (active.length === 0) {
    throw new Error("The delivery profile requests audio but the immutable timeline has no audible source.");
  }
  const assetById = new Map(input.snapshot.assets.assets.map((asset) => [asset.id, asset]));
  const sourcePathById = new Map(
    await Promise.all(
      graph.sources.map(async (source) => {
        const asset = assetById.get(source.assetId);
        if (asset?.validationState !== "valid") {
          throw new Error(`Audio source ${source.id} has no valid registered asset.`);
        }
        if (source.originalPath !== asset.path || source.contentHash !== asset.contentHash) {
          throw new Error(`Audio source ${source.id} does not match its registered asset identity.`);
        }
        return [
          source.id,
          await resolveVerifiedAsset(input.projectRoot, asset, input.approvedExternalRoots),
        ] as const;
      }),
    ),
  );
  return renderOfflineAudioMix({
    graph,
    timelineFps: input.snapshot.timeline.fps,
    startFrame: input.range.start,
    endFrameExclusive: input.range.end,
    outputPath: input.outputPath,
    signal: input.signal,
    decode: async (request) => {
      const sourcePath = sourcePathById.get(request.sourceId);
      if (sourcePath === undefined) throw new Error(`Audio source path is missing for ${request.sourceId}.`);
      return decodeAudioBlock({ ...request, sourcePath, ffmpegPath: input.ffmpegPath });
    },
  });
};

const deriveAudioGraph = (snapshot: ProjectSnapshot): AudioGraphDocument => {
  const persisted = snapshot.timeline.audioGraph;
  if (persisted !== undefined && persisted.clips.length > 0) return persisted;
  const graph = createDefaultAudioGraph({
    graphId: `${snapshot.timeline.timelineId}:render-audio`,
    sampleRate: snapshot.project.audio.sampleRate,
    channelLayout: snapshot.project.audio.channelLayout,
  });
  const outputChannels = channelsForLayout(graph.channelLayout);
  const assetById = new Map(snapshot.assets.assets.map((asset) => [asset.id, asset]));
  const candidates = snapshot.timeline.tracks
    .filter((track) => !track.hidden && !track.muted && (track.kind === "audio" || track.kind === "video"))
    .flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    .filter(({ clip }) => {
      const asset = clip.assetId === null ? undefined : assetById.get(clip.assetId);
      return clip.engine === "shared" && asset?.validationState === "valid" && asset.hasAudio;
    });
  const sources = candidates.map(({ clip }, index) => {
    const asset =
      assetById.get(clip.assetId ?? fail("Audio clip asset id is missing.")) ??
      fail(`Audio asset is missing for ${clip.id}.`);
    return {
      id: `${graph.graphId}:source:${String(index)}`,
      assetId: asset.id,
      streamIndex: 0,
      contentHash: asset.contentHash,
      originalPath: asset.path,
      proxyPath: null,
      sourceSampleRate: graph.sampleRate,
      sourceChannels: 2,
      previewPolicy: "original-only" as const,
    };
  });
  const channelMaps = sources.map((source) => ({
    id: `${source.id}:map`,
    inputChannels: 2,
    outputChannels,
    matrix: Array.from({ length: outputChannels }, (_, output) =>
      Array.from({ length: 2 }, (_unused, channel) => (output < 2 && output === channel ? 1 : 0)),
    ),
  }));
  const musicBus = graph.buses.find((bus) => bus.kind === "music")?.id ?? graph.masterBusId;
  const clips = candidates.map(({ clip }, index) => {
    const sourceStart = sampleBoundaryForFrame(
      BigInt(clip.sourceInFrame),
      snapshot.timeline.fps,
      graph.sampleRate,
      "floor",
    );
    const sourceEnd = sampleBoundaryForFrame(
      BigInt(clip.sourceInFrame) + BigInt(clip.sourceDurationFrames),
      snapshot.timeline.fps,
      graph.sampleRate,
      "ceil",
    );
    return {
      id: `${graph.graphId}:clip:${String(index)}`,
      timelineClipId: clip.id,
      sourceId: sources[index]?.id ?? fail("Derived audio source is missing."),
      busId: musicBus,
      startFrame: clip.startFrame,
      endFrameExclusive: (BigInt(clip.startFrame) + BigInt(clip.durationFrames)).toString(10) as never,
      sourceStartSample: sourceStart.toString(10) as never,
      sourceEndSampleExclusive: sourceEnd.toString(10) as never,
      gainDb: numericProperty(clip, "audio.volume", 0),
      pan: 0,
      muted: false,
      fadeInFrames: String(Math.max(0, numericProperty(clip, "audio.fadeIn", 0))) as never,
      fadeOutFrames: String(Math.max(0, numericProperty(clip, "audio.fadeOut", 0))) as never,
      fadeCurve: "equal-power" as const,
      automationLaneIds: [],
      channelMapId: channelMaps[index]?.id ?? fail("Derived audio channel map is missing."),
      syncAnchorIds: [],
      processingReferenceIds: [],
    };
  });
  return { ...graph, sources, channelMaps, clips };
};

const decodeAudioBlock = async (input: {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly startSample: bigint;
  readonly endSampleExclusive: bigint;
  readonly targetSampleRate: number;
  readonly targetChannels: number;
  readonly signal: AbortSignal;
  readonly ffmpegPath: string;
}): Promise<DecodedAudioBlock> => {
  const sampleCount = Number(input.endSampleExclusive - input.startSample);
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0)
    throw new Error("Audio decode range is invalid.");
  const bytes = await runFfmpegCapture(
    input.ffmpegPath,
    [
      "-v",
      "error",
      "-ss",
      decimal(Number(input.startSample) / input.targetSampleRate),
      "-i",
      input.sourcePath,
      "-t",
      decimal(sampleCount / input.targetSampleRate),
      "-vn",
      "-ac",
      String(input.targetChannels),
      "-ar",
      String(input.targetSampleRate),
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "pipe:1",
    ],
    input.signal,
    `audio source ${input.sourceId}`,
  );
  const channels = Array.from({ length: input.targetChannels }, () => new Float32Array(sampleCount));
  const decodedSamples = Math.min(sampleCount, Math.floor(bytes.byteLength / 4 / input.targetChannels));
  for (let sample = 0; sample < decodedSamples; sample += 1) {
    for (let channel = 0; channel < input.targetChannels; channel += 1) {
      const outputChannel = channels[channel] ?? fail(`Audio output channel ${String(channel)} is missing.`);
      outputChannel[sample] = bytes.readFloatLE((sample * input.targetChannels + channel) * 4);
    }
  }
  return {
    sourceId: input.sourceId,
    startSample: input.startSample,
    endSampleExclusive: input.endSampleExclusive,
    sampleRate: input.targetSampleRate,
    channels,
    gaps:
      decodedSamples === sampleCount
        ? []
        : [
            {
              startSample: input.startSample + BigInt(decodedSamples),
              endSampleExclusive: input.endSampleExclusive,
            },
          ],
  };
};

const encodeOutput = async (input: {
  readonly profile: DeliveryProfile;
  readonly range: Readonly<{ start: bigint; end: bigint }>;
  readonly fps: Readonly<{ numerator: string; denominator: string }>;
  readonly framePaths: readonly string[];
  readonly framesDirectory: string;
  readonly audioMix: OfflineAudioMixArtifact | null;
  readonly outputDirectory: string;
  readonly ffmpegPath: string;
  readonly signal: AbortSignal;
}): Promise<readonly string[]> => {
  if (input.profile.outputKind === "still") {
    const source = input.framePaths[0] ?? fail("Still output frame is missing.");
    const extension = input.profile.container === "jpeg" ? "jpg" : "png";
    const name = `frame-${input.range.start.toString(10)}.${extension}`;
    const target = path.join(input.outputDirectory, name);
    const pipeline = sharp(source);
    if (extension === "jpg")
      await pipeline.flatten({ background: "black" }).jpeg({ quality: 95 }).toFile(target);
    else await pipeline.png({ compressionLevel: 9 }).toFile(target);
    return [name];
  }
  if (input.profile.outputKind === "image-sequence") {
    const artifacts: string[] = [];
    for (const [index, source] of input.framePaths.entries()) {
      const masterFrame = input.range.start + BigInt(index);
      const name = `frame-${padFrame(masterFrame)}.png`;
      await sharp(source).png({ compressionLevel: 9 }).toFile(path.join(input.outputDirectory, name));
      artifacts.push(name);
    }
    return artifacts;
  }
  if (input.profile.outputKind === "audio") {
    const audio = input.audioMix ?? fail("Audio-only output has no authoritative mix.");
    const extension = input.profile.container;
    const name = `program-audio.${extension}`;
    await runFfmpeg(
      input.ffmpegPath,
      [
        "-y",
        "-i",
        audio.outputPath,
        "-vn",
        ...audioCodecArguments(input.profile.audioCodec),
        path.join(input.outputDirectory, name),
      ],
      input.signal,
      "audio-only encode",
    );
    return [name];
  }
  const extension = input.profile.container;
  const name = `program.${extension}`;
  const arguments_ = [
    "-y",
    "-framerate",
    `${input.fps.numerator}/${input.fps.denominator}`,
    "-i",
    path.join(input.framesDirectory, "frame-%08d.png"),
    ...(input.audioMix === null ? [] : ["-i", input.audioMix.outputPath]),
    "-map",
    "0:v:0",
    ...(input.audioMix === null ? ["-an"] : ["-map", "1:a:0"]),
    ...videoCodecArguments(input.profile.videoCodec, input.profile.alpha),
    ...(input.audioMix === null ? [] : audioCodecArguments(input.profile.audioCodec)),
    "-frames:v",
    String(input.framePaths.length),
    path.join(input.outputDirectory, name),
  ];
  await runFfmpeg(input.ffmpegPath, arguments_, input.signal, "program encode");
  return [name];
};

const frameProperties = (
  timeline: TimelineDocument,
  clip: TimelineClip,
  frame: bigint,
  mode: "evaluated" | "defaults" = "evaluated",
): RenderFrameProperties => ({
  position: vector2(captureProperty(timeline, clip, "transform.position", frame, [0, 0], mode), [0, 0]),
  scale: vector2(captureProperty(timeline, clip, "transform.scale", frame, [100, 100], mode), [100, 100]),
  rotation: numericValue(captureProperty(timeline, clip, "transform.rotation", frame, 0, mode), 0),
  anchor: vector2(captureProperty(timeline, clip, "transform.anchor", frame, [50, 50], mode), [50, 50]),
  opacity: numericValue(captureProperty(timeline, clip, "transform.opacity", frame, 100, mode), 100),
  crop: vector4(captureProperty(timeline, clip, "transform.crop", frame, [0, 0, 0, 0], mode), [0, 0, 0, 0]),
  blendMode: stringValue(
    captureProperty(timeline, clip, "composite.blendMode", frame, "normal", mode),
    "normal",
  ),
});

const captureProperty = (
  timeline: TimelineDocument,
  clip: TimelineClip,
  propertyPath: string,
  frame: bigint,
  fallback: TimelinePropertyValue,
  mode: "evaluated" | "defaults",
): TimelinePropertyValue =>
  mode === "defaults"
    ? (clip.properties?.[propertyPath]?.defaultValue ?? fallback)
    : evaluatedProperty(timeline, clip, propertyPath, frame, fallback);

const evaluatedProperty = (
  timeline: TimelineDocument,
  clip: TimelineClip,
  propertyPath: string,
  frame: bigint,
  fallback: TimelinePropertyValue,
): TimelinePropertyValue => {
  const base = clip.properties?.[propertyPath]?.value ?? fallback;
  const keyframes = (timeline.keyframes ?? [])
    .filter(
      (keyframe) =>
        keyframe.ownerEntityId === clip.id &&
        keyframe.propertyPath === propertyPath &&
        keyframe.authority === "shared" &&
        !keyframe.preserveNativeAnimation,
    )
    .sort((left, right) => Number(BigInt(left.frame) - BigInt(right.frame)));
  if (keyframes.length === 0 || frame < BigInt(keyframes[0]?.frame ?? "0")) return base;
  const exact = keyframes.find((keyframe) => BigInt(keyframe.frame) === frame);
  if (exact !== undefined) return exact.value;
  const rightIndex = keyframes.findIndex((keyframe) => BigInt(keyframe.frame) > frame);
  if (rightIndex === -1) return keyframes.at(-1)?.value ?? base;
  const right = keyframes[rightIndex];
  const left = keyframes[rightIndex - 1];
  if (left === undefined || right === undefined) return base;
  return interpolateKeyframes(left, right, frame);
};

const interpolateKeyframes = (
  left: TimelineKeyframe,
  right: TimelineKeyframe,
  frame: bigint,
): TimelinePropertyValue => {
  if (left.interpolation === "hold" || left.interpolation === "native" || left.interpolation === "spring") {
    return left.value;
  }
  const start = BigInt(left.frame);
  const end = BigInt(right.frame);
  const raw = Number(frame - start) / Number(end - start);
  const progress = easingProgress(left, right, raw);
  if (typeof left.value === "number" && typeof right.value === "number") {
    return left.value + (right.value - left.value) * progress;
  }
  const leftVector = left.value;
  const rightVector = right.value;
  if (numericVector(leftVector) && numericVector(rightVector) && leftVector.length === rightVector.length) {
    return leftVector.map((value, index) => value + ((rightVector[index] ?? value) - value) * progress);
  }
  return progress < 1 ? left.value : right.value;
};

const easingProgress = (left: TimelineKeyframe, right: TimelineKeyframe, progress: number): number => {
  if (left.interpolation === "linear") return progress;
  const presets = {
    ease: { out: [0.25, 0.1], incoming: [0.25, 1] },
    "ease-in": { out: [0.42, 0], incoming: [1, 1] },
    "ease-out": { out: [0, 0], incoming: [0.58, 1] },
    "ease-in-out": { out: [0.42, 0], incoming: [0.58, 1] },
  } as const;
  const tangent =
    left.interpolation === "bezier"
      ? { out: left.outTangent ?? [0.33, 0.33], incoming: right.inTangent ?? [0.67, 0.67] }
      : presets[left.interpolation as keyof typeof presets];
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (cubic(middle, 0, tangent.out[0], tangent.incoming[0], 1) < progress) lower = middle;
    else upper = middle;
  }
  return cubic((lower + upper) / 2, 0, tangent.out[1], tangent.incoming[1], 1);
};

const activeCaptions = (
  timeline: TimelineDocument,
  range: Readonly<{ start: bigint; end: bigint }>,
): readonly Readonly<{ start: bigint; end: bigint; text: string }>[] => {
  const documentCues = (timeline.captionDocuments ?? []).flatMap((document) =>
    document.cues.map((cue) => ({
      start: BigInt(cue.startFrame),
      end: BigInt(cue.endFrameExclusive),
      text: cue.text,
    })),
  );
  const candidates =
    documentCues.length > 0
      ? documentCues
      : timeline.tracks
          .filter((track) => track.kind === "caption" && !track.hidden && !track.muted)
          .flatMap((track) =>
            track.clips.map((clip) => ({
              start: BigInt(clip.startFrame),
              end: BigInt(clip.startFrame) + BigInt(clip.durationFrames),
              text: clip.metadata?.text ?? clip.name ?? "",
            })),
          );
  return candidates.filter(
    (caption) => caption.text.trim() !== "" && caption.end > range.start && caption.start < range.end,
  );
};

const captionSvg = (text: string, width: number, height: number): Buffer => {
  const fontSize = Math.max(24, Math.round(height * 0.055));
  const y = Math.round(height * 0.88);
  const safeText = escapeXml(text);
  return Buffer.from(
    `<svg width="${String(width)}" height="${String(height)}">` +
      `<rect x="${String(Math.round(width * 0.12))}" y="${String(y - fontSize - 18)}" width="${String(Math.round(width * 0.76))}" height="${String(fontSize + 30)}" rx="10" fill="#000" fill-opacity="0.72"/>` +
      `<text x="50%" y="${String(y)}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${String(fontSize)}" font-weight="600" fill="#fff">${safeText}</text>` +
      `</svg>`,
    "utf8",
  );
};

const renderRange = (
  timeline: TimelineDocument,
  scope: RenderScope,
): Readonly<{ start: bigint; end: bigint }> => {
  const range =
    scope.kind === "full-timeline"
      ? { start: 0n, end: BigInt(timeline.durationFrames) }
      : scope.kind === "frame"
        ? { start: BigInt(scope.frame), end: BigInt(scope.frame) + 1n }
        : { start: BigInt(scope.startFrame), end: BigInt(scope.endFrameExclusive) };
  if (range.start < 0n || range.end <= range.start || range.end > BigInt(timeline.durationFrames)) {
    throw new Error("Timeline compositor received an invalid render range.");
  }
  return range;
};

const runFfmpeg = (
  executable: string,
  arguments_: readonly string[],
  signal: AbortSignal,
  stage: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Render cancelled.", "AbortError"));
      return;
    }
    const child = spawn(executable, [...arguments_], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_000);
    });
    const abort = (): void => {
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (cause) => {
      signal.removeEventListener("abort", abort);
      reject(cause);
    });
    child.once("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new DOMException("Render cancelled.", "AbortError"));
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg ${stage} failed (${String(code)}): ${stderr}`));
    });
  });

const runFfmpegCapture = (
  executable: string,
  arguments_: readonly string[],
  signal: AbortSignal,
  stage: string,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Render cancelled.", "AbortError"));
      return;
    }
    const child = spawn(executable, [...arguments_], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_000);
    });
    const abort = (): void => {
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (cause) => {
      signal.removeEventListener("abort", abort);
      reject(cause);
    });
    child.once("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new DOMException("Render cancelled.", "AbortError"));
      else if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`FFmpeg ${stage} failed (${String(code)}): ${stderr}`));
    });
  });

const videoCodecArguments = (codec: string | null, alpha: DeliveryProfile["alpha"]): readonly string[] => {
  if (codec === "h264") return ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"];
  if (codec === "h265") return ["-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-crf", "20"];
  if (codec === "vp8") return ["-c:v", "libvpx", "-pix_fmt", alpha === "none" ? "yuv420p" : "yuva420p"];
  if (codec === "vp9") return ["-c:v", "libvpx-vp9", "-pix_fmt", alpha === "none" ? "yuv420p" : "yuva420p"];
  if (codec === "prores-4444") return ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"];
  if (codec === "prores-422-hq") return ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"];
  if (codec === "png") return ["-c:v", "png"];
  if (codec === "mjpeg") return ["-c:v", "mjpeg", "-q:v", "2"];
  throw new Error(`Unsupported delivery video codec: ${codec ?? "none"}.`);
};

const audioCodecArguments = (codec: string | null): readonly string[] => {
  if (codec === "aac") return ["-c:a", "aac", "-b:a", "320k"];
  if (codec === "pcm-s24le") return ["-c:a", "pcm_s24le"];
  if (codec === "flac") return ["-c:a", "flac"];
  throw new Error(`Unsupported delivery audio codec: ${codec ?? "none"}.`);
};

const blendMode = (value: string): Blend => {
  const aliases: Readonly<Record<string, Blend>> = {
    normal: "over",
    add: "add",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    difference: "difference",
    exclusion: "exclusion",
  };
  return aliases[value] ?? "over";
};

const resolveVerifiedAsset = async (
  projectRoot: string,
  asset: AssetRecord,
  approvedExternalRoots: readonly ApprovedExternalAssetRoot[],
): Promise<string> => {
  const candidatePath = registryCandidatePath(projectRoot, asset.path, approvedExternalRoots);
  const candidate = await lstat(candidatePath).catch((cause: unknown) => {
    throw new Error(`Registered asset ${asset.id} is unavailable.`, { cause });
  });
  if (!candidate.isFile()) {
    throw new Error(`Registered asset ${asset.id} must remain a regular file; symlinks are forbidden.`);
  }
  const authorized = await authorizeAssetPath({
    projectRoot,
    candidatePath,
    approvedExternalRoots,
  });
  if (authorized.registryPath !== asset.path) {
    throw new Error(`Registered asset ${asset.id} no longer resolves to its immutable registry path.`);
  }
  const observedHash = await sha256File(authorized.canonicalPath);
  if (observedHash !== asset.contentHash) {
    throw new Error(`Registered asset ${asset.id} content hash no longer matches its immutable identity.`);
  }
  return authorized.canonicalPath;
};

const registryCandidatePath = (
  projectRoot: string,
  registryPath: string,
  approvedExternalRoots: readonly ApprovedExternalAssetRoot[],
): string => {
  const segments = registryPath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("Timeline compositor asset registry path is invalid.");
  }
  if (segments[0] !== "external") return path.join(projectRoot, ...segments);
  const rootId = segments[1];
  const externalRoot = approvedExternalRoots.find((candidate) => candidate.id === rootId);
  if (externalRoot === undefined || segments.length < 3) {
    throw new Error(`Timeline compositor external asset root is not approved: ${rootId ?? "missing"}.`);
  }
  return path.join(externalRoot.path, ...segments.slice(2));
};

const intersects = (clip: TimelineClip, range: Readonly<{ start: bigint; end: bigint }>): boolean => {
  const start = BigInt(clip.startFrame);
  return start + BigInt(clip.durationFrames) > range.start && start < range.end;
};

const frameSeconds = (frame: bigint, fps: Readonly<{ numerator: string; denominator: string }>): string =>
  decimal((Number(frame) * Number(fps.denominator)) / Number(fps.numerator));

const numericProperty = (clip: TimelineClip, pathName: string, fallback: number): number =>
  numericValue(clip.properties?.[pathName]?.value ?? fallback, fallback);

const numericValue = (value: TimelinePropertyValue, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const stringValue = (value: TimelinePropertyValue, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const vector2 = (
  value: TimelinePropertyValue,
  fallback: readonly [number, number],
): readonly [number, number] =>
  numericVector(value) && value.length >= 2 ? [value[0] ?? fallback[0], value[1] ?? fallback[1]] : fallback;

const vector4 = (
  value: TimelinePropertyValue,
  fallback: readonly [number, number, number, number],
): readonly [number, number, number, number] =>
  numericVector(value) && value.length >= 4
    ? [value[0] ?? fallback[0], value[1] ?? fallback[1], value[2] ?? fallback[2], value[3] ?? fallback[3]]
    : fallback;

const numericVector = (value: TimelinePropertyValue): value is readonly number[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));

const cubic = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
  const inverse = 1 - t;
  return inverse ** 3 * p0 + 3 * inverse ** 2 * t * p1 + 3 * inverse * t ** 2 * p2 + t ** 3 * p3;
};

const channelsForLayout = (layout: AudioGraphDocument["channelLayout"]): number =>
  layout === "mono" ? 1 : layout === "stereo" ? 2 : layout === "5.1" ? 6 : 8;

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Timeline render cancelled.", "AbortError");
};

const decimal = (value: number): string => value.toFixed(9).replace(/0+$/u, "").replace(/\.$/u, "");
const padFrame = (frame: bigint): string => frame.toString(10).padStart(8, "0");
const minimum = (left: bigint, right: bigint): bigint => (left < right ? left : right);
const maximum = (left: bigint, right: bigint): bigint => (left > right ? left : right);
const clamp = (value: number, lower: number, upper: number): number =>
  Math.min(upper, Math.max(lower, value));
const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const fail = (message: string): never => {
  throw new Error(message);
};
