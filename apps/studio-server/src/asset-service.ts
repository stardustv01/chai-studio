import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  assetRightsManifestToAssetRecord,
  authorizeAssetPath,
  buildAssetIndex,
  buildAssetUsageReport,
  createAssetRightsManifest,
  fingerprintProxyProfile,
  generateConstantFrameRateProxy,
  generateMediaView,
  inspectMediaFile,
  prepareAssetRegistration,
  proxyCacheKey,
  searchAssetIndex,
  serializeAssetRightsManifest,
  sha256File,
  type ApprovedExternalAssetRoot,
  type AssetRightsRecord,
  type AssetSearchPage,
  type AssetSearchQuery,
  type GeneratedViewProfile,
  type MediaInspectionV1,
  type ProxyProfile,
  type SourceFrameTimestamp,
} from "@chai-studio/media";
import type {
  AssetManifestUpsertCommand,
  AssetRecord,
  AssetRegisterCommand,
  AssetRelinkCommand,
  AssetReplaceCommand,
  CommandExecutionReceipt,
  ExecuteProjectCommandOptions,
  LoadedProjectRevision,
  ProjectCommandEnvelope,
} from "@chai-studio/schema";
import { normalizeRational, serializeBigInt, type BigIntString } from "@chai-studio/schema";
import { StudioJobRegistry, type StudioJobKind, type StudioJobSnapshot } from "./job-registry.js";
import type { ProjectSessionService } from "./project-service.js";
import { validateNativeCompositionManifest } from "./native-composition-runtime.js";

export interface AssetMutationContext {
  readonly baseRevisionId: string;
  readonly idempotencyId: string;
  readonly actor: ProjectCommandEnvelope["actor"];
}

export class AssetApiService {
  readonly #projects: ProjectSessionService;
  readonly #jobs: StudioJobRegistry;
  readonly #externalRoots: readonly ApprovedExternalAssetRoot[];
  readonly #ffmpegPath: string;
  readonly #ffprobePath: string;
  readonly #inspectMedia: typeof inspectMediaFile;
  readonly #generateProxy: typeof generateConstantFrameRateProxy;
  readonly #generateView: typeof generateMediaView;
  readonly #onAssetCacheInvalidation:
    NonNullable<ExecuteProjectCommandOptions["invalidateAssetCaches"]> | undefined;
  readonly #maximumUploadBytes: number;
  readonly #inspections = new Map<string, MediaInspectionV1>();

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly jobs?: StudioJobRegistry;
    readonly approvedExternalRoots?: readonly ApprovedExternalAssetRoot[];
    readonly ffmpegPath?: string;
    readonly ffprobePath?: string;
    readonly inspectMedia?: typeof inspectMediaFile;
    readonly generateProxy?: typeof generateConstantFrameRateProxy;
    readonly generateView?: typeof generateMediaView;
    readonly maximumUploadBytes?: number;
    readonly onAssetCacheInvalidation?: NonNullable<ExecuteProjectCommandOptions["invalidateAssetCaches"]>;
  }) {
    this.#projects = input.projects;
    this.#jobs = input.jobs ?? new StudioJobRegistry();
    this.#externalRoots = input.approvedExternalRoots ?? [];
    this.#ffmpegPath = input.ffmpegPath ?? "ffmpeg";
    this.#ffprobePath = input.ffprobePath ?? "ffprobe";
    this.#inspectMedia = input.inspectMedia ?? inspectMediaFile;
    this.#generateProxy = input.generateProxy ?? generateConstantFrameRateProxy;
    this.#generateView = input.generateView ?? generateMediaView;
    this.#maximumUploadBytes = input.maximumUploadBytes ?? 50 * 1024 * 1024 * 1024;
    this.#onAssetCacheInvalidation = input.onAssetCacheInvalidation;
  }

  jobs(): StudioJobRegistry {
    return this.#jobs;
  }

  async importAsset(input: {
    readonly sourcePath: string;
    readonly id: string;
    readonly kind: AssetRecord["kind"];
    readonly rights: AssetRecord["rights"];
    readonly context: AssetMutationContext;
  }): Promise<Readonly<{ asset: AssetRecord; receipt: CommandExecutionReceipt }>> {
    const root = this.#projects.openRootPath();
    const authorized = await this.#authorizeSource(root, input.sourcePath);
    const metadata = await this.#registrationMetadata(
      authorized.canonicalPath,
      input.kind,
      authorized.registryPath,
    );
    const asset = await prepareAssetRegistration({
      id: input.id,
      sourceFilePath: authorized.canonicalPath,
      projectRelativePath: authorized.registryPath,
      kind: input.kind,
      rights: input.rights,
      ...metadata,
    });
    const command: AssetRegisterCommand = {
      ...commandBase(await this.#projects.snapshot(), input.context, [asset.id]),
      kind: "asset.register",
      declaredScope: "mutation",
      payload: { asset },
    };
    return { asset, receipt: await this.#projects.executeCommand(command) };
  }

  async importUploadedAsset(input: {
    readonly fileName: string;
    readonly id: string;
    readonly kind: AssetRecord["kind"];
    readonly rights: AssetRecord["rights"];
    readonly content: AsyncIterable<Uint8Array | string>;
    readonly context: AssetMutationContext;
  }): Promise<
    Readonly<{
      asset: AssetRecord;
      receipt: CommandExecutionReceipt;
      storedPath: string;
      bytesWritten: number;
    }>
  > {
    assertUploadAssetId(input.id);
    const fileName = safeUploadFileName(input.fileName);
    const root = this.#projects.openRootPath();
    const directory = path.join(root, "assets", "imported");
    const storedPath = path.join(directory, `${input.id}-${fileName}`);
    const temporaryPath = path.join(directory, `.${input.id}-${randomUUID()}.uploading`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(temporaryPath, "wx", 0o600);
    let bytesWritten = 0;
    let linked = false;
    try {
      for await (const chunk of input.content) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
        bytesWritten += bytes.byteLength;
        if (bytesWritten > this.#maximumUploadBytes) {
          throw new Error(
            `Uploaded asset exceeds the ${String(this.#maximumUploadBytes)} byte project limit.`,
          );
        }
        let offset = 0;
        while (offset < bytes.byteLength) {
          const result = await handle.write(bytes, offset, bytes.byteLength - offset);
          if (result.bytesWritten === 0)
            throw new Error("Asset upload stopped before the chunk was written.");
          offset += result.bytesWritten;
        }
      }
      if (bytesWritten === 0) throw new Error("Uploaded asset is empty.");
      await handle.sync();
      await handle.close();
      await link(temporaryPath, storedPath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === "EEXIST") {
          throw new Error("Uploaded asset destination already exists.");
        }
        throw error;
      });
      linked = true;
      await rm(temporaryPath, { force: true });
      const result = await this.importAsset({
        sourcePath: storedPath,
        id: input.id,
        kind: input.kind,
        rights: input.rights,
        context: input.context,
      });
      if (result.receipt.status !== "committed") {
        await rm(storedPath, { force: true });
        linked = false;
      }
      return {
        ...result,
        storedPath: path.relative(root, storedPath).split(path.sep).join("/"),
        bytesWritten,
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      if (linked) await rm(storedPath, { force: true });
      throw error;
    }
  }

  async enqueueInspection(assetId: string, correlationId: string): Promise<StudioJobSnapshot> {
    return this.#enqueueForAsset("asset.inspect", assetId, correlationId, async (context) => {
      if (context.asset.kind === "composition") {
        if (!context.asset.path.toLowerCase().endsWith(".chai-composition.json")) {
          throw new Error("Composition inspection requires a validated .chai-composition.json manifest.");
        }
        return validateNativeCompositionManifest({
          projectRoot: this.#projects.openRootPath(),
          manifestPath: context.asset.path,
        });
      }
      const inspection = await this.#inspectMedia({
        filePath: context.sourcePath,
        contentHash: context.asset.contentHash,
        cacheDirectory: path.join(context.cacheRoot, "inspections"),
        ffprobePath: this.#ffprobePath,
      });
      this.#inspections.set(context.asset.contentHash, inspection);
      return inspection;
    });
  }

  async enqueueProxy(input: {
    readonly assetId: string;
    readonly correlationId: string;
    readonly profile: ProxyProfile;
    readonly sourceFrames: readonly SourceFrameTimestamp[];
    readonly proxyFrameCount: string;
  }): Promise<StudioJobSnapshot> {
    return this.#enqueueForAsset("asset.proxy", input.assetId, input.correlationId, (context) => {
      const fingerprint = fingerprintProxyProfile(input.profile);
      const cacheKey = proxyCacheKey(context.asset.contentHash, fingerprint);
      return this.#generateProxy({
        sourceAsset: context.asset,
        sourceFilePath: context.sourcePath,
        outputFilePath: path.join(context.cacheRoot, "proxies", `${cacheKey}.${input.profile.container}`),
        profile: input.profile,
        sourceFrames: input.sourceFrames,
        proxyFrameCount: input.proxyFrameCount,
        ffmpegPath: this.#ffmpegPath,
        signal: context.signal,
      });
    });
  }

  async enqueueDefaultProxy(assetId: string, correlationId: string): Promise<StudioJobSnapshot> {
    const snapshot = await this.#projects.snapshot();
    const asset = requireAsset(snapshot, assetId);
    if (asset.kind !== "video" || asset.validationState !== "valid") {
      throw new Error("Proxy generation requires a validated video asset.");
    }
    if (asset.durationFrames === null || asset.fps === null) {
      throw new Error("Proxy generation requires known source duration and frame rate.");
    }
    const sourceFrameCount = BigInt(asset.durationFrames);
    if (sourceFrameCount <= 0n || sourceFrameCount > 500_000n) {
      throw new Error("Proxy generation supports validated sources from 1 through 500000 frames.");
    }
    const sourceRateNumerator = BigInt(asset.fps.numerator);
    const sourceRateDenominator = BigInt(asset.fps.denominator);
    const targetRate = snapshot.timeline.fps;
    const targetRateNumerator = BigInt(targetRate.numerator);
    const targetRateDenominator = BigInt(targetRate.denominator);
    const proxyCountNumerator = sourceFrameCount * sourceRateDenominator * targetRateNumerator;
    const proxyCountDenominator = sourceRateNumerator * targetRateDenominator;
    const proxyFrameCount = (proxyCountNumerator + proxyCountDenominator - 1n) / proxyCountDenominator;
    const sourceFrames: SourceFrameTimestamp[] = [];
    for (let frame = 0n; frame < sourceFrameCount; frame += 1n) {
      sourceFrames.push({
        sourceFrameIndex: frame.toString(10),
        timestampSeconds: normalizeRational(frame * sourceRateDenominator, sourceRateNumerator),
      });
    }
    return this.enqueueProxy({
      assetId,
      correlationId,
      profile: {
        id: "studio-default-720p-cfr",
        width: 1280,
        height: 720,
        targetFrameRate: targetRate,
        videoCodec: "h264",
        audioCodec: "aac",
        quality: 24,
        container: "mp4",
      },
      sourceFrames,
      proxyFrameCount: proxyFrameCount.toString(10),
    });
  }

  async enqueueView(input: {
    readonly assetId: string;
    readonly correlationId: string;
    readonly profile: GeneratedViewProfile;
  }): Promise<StudioJobSnapshot> {
    const kind: StudioJobKind = input.profile.kind === "waveform" ? "asset.waveform" : "asset.thumbnail";
    return this.#enqueueForAsset(kind, input.assetId, input.correlationId, (context) =>
      this.#generateView({
        sourceFilePath: context.sourcePath,
        sourceContentHash: context.asset.contentHash,
        cacheDirectory: path.join(context.cacheRoot, "generated-views"),
        profile: input.profile,
        ffmpegPath: this.#ffmpegPath,
        signal: context.signal,
      }),
    );
  }

  async sourceFrame(input: {
    readonly assetId: string;
    readonly frame: string;
    readonly signal?: AbortSignal;
  }): Promise<
    Readonly<{
      bytes: Buffer;
      contentHash: string;
      fileName: string;
      mediaType: "image/png";
      frame: string;
    }>
  > {
    if (!/^(?:0|[1-9][0-9]{0,11})$/u.test(input.frame)) {
      throw new Error("Source frame must be a non-negative integer.");
    }
    const frame = BigInt(input.frame);
    const root = this.#projects.openRootPath();
    const snapshot = await this.#projects.snapshot();
    const asset = requireAsset(snapshot, input.assetId);
    if (asset.kind !== "video" && asset.kind !== "image") {
      throw new Error("Decoded source frames are available only for video and image assets.");
    }
    if (asset.durationFrames !== null && frame >= BigInt(asset.durationFrames)) {
      throw new Error("Source frame is outside the registered asset duration.");
    }
    if (asset.kind === "image" && frame !== 0n) {
      throw new Error("Still-image sources expose only frame 0.");
    }
    const fps = asset.fps ?? normalizeRational(1n, 1n);
    const sourcePath = await this.#resolveRegisteredPath(root, asset.path);
    const artifact = await this.#generateView({
      sourceFilePath: sourcePath,
      sourceContentHash: asset.contentHash,
      cacheDirectory: path.join(root, ".chai-cache", "media", "generated-views"),
      profile: {
        kind: "thumbnail",
        width: 960,
        height: 540,
        atSeconds: normalizeRational(frame * BigInt(fps.denominator), BigInt(fps.numerator)),
        format: "png",
      },
      ffmpegPath: this.#ffmpegPath,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    return {
      bytes: await readFile(artifact.outputPath),
      contentHash: artifact.outputContentHash,
      fileName: `${asset.id}-frame-${input.frame}.png`,
      mediaType: "image/png",
      frame: input.frame,
    };
  }

  async relink(input: {
    readonly assetId: string;
    readonly sourcePath: string;
    readonly context: AssetMutationContext;
  }): Promise<CommandExecutionReceipt> {
    const root = this.#projects.openRootPath();
    const authorized = await this.#authorizeSource(root, input.sourcePath);
    const command: AssetRelinkCommand = {
      ...commandBase(await this.#projects.snapshot(), input.context, [input.assetId]),
      kind: "asset.relink",
      declaredScope: "mutation",
      payload: {
        assetId: input.assetId,
        newPath: authorized.registryPath,
        observedContentHash: await sha256File(authorized.canonicalPath),
      },
    };
    return this.#projects.executeCommand(command, {
      invalidateAssetCaches: (event) => this.#invalidateAssetCaches(event),
    });
  }

  async replace(input: {
    readonly assetId: string;
    readonly sourcePath: string;
    readonly expectedContentHash: string;
    readonly kind: AssetRecord["kind"];
    readonly rights: AssetRecord["rights"];
    readonly context: AssetMutationContext;
  }): Promise<CommandExecutionReceipt> {
    const root = this.#projects.openRootPath();
    const authorized = await this.#authorizeSource(root, input.sourcePath);
    const metadata = await this.#registrationMetadata(
      authorized.canonicalPath,
      input.kind,
      authorized.registryPath,
    );
    const asset = await prepareAssetRegistration({
      id: input.assetId,
      sourceFilePath: authorized.canonicalPath,
      projectRelativePath: authorized.registryPath,
      kind: input.kind,
      rights: input.rights,
      ...metadata,
    });
    const command: AssetReplaceCommand = {
      ...commandBase(await this.#projects.snapshot(), input.context, [input.assetId]),
      kind: "asset.replace",
      declaredScope: "mutation",
      payload: { expectedContentHash: input.expectedContentHash, asset },
    };
    return this.#projects.executeCommand(command, {
      invalidateAssetCaches: (event) => this.#invalidateAssetCaches(event),
    });
  }

  async updateRights(input: {
    readonly records: readonly AssetRightsRecord[];
    readonly context: AssetMutationContext;
  }): Promise<CommandExecutionReceipt> {
    const snapshot = await this.#projects.snapshot();
    const plannedRevisionId = `revision-${randomUUID()}`;
    const manifest = createAssetRightsManifest({
      projectId: snapshot.project.projectId,
      revisionId: plannedRevisionId,
      records: input.records,
      assets: snapshot.assets,
    });
    const content = serializeAssetRightsManifest(manifest);
    const asset = assetRightsManifestToAssetRecord(manifest, "asset-rights-manifest-0001");
    const command: AssetManifestUpsertCommand = {
      ...commandBase(snapshot, input.context, [asset.id]),
      kind: "asset.manifest.upsert",
      declaredScope: "mutation",
      payload: { manifestType: "rights", asset, content },
    };
    return this.#projects.executeCommand(command, { revisionId: plannedRevisionId });
  }

  async search(query: AssetSearchQuery): Promise<AssetSearchPage> {
    const snapshot = await this.#projects.snapshot();
    const usageCountByAssetId = Object.fromEntries(
      snapshot.assets.assets.map((asset) => [
        asset.id,
        buildAssetUsageReport(asset.id, [snapshot.timeline]).usageCount,
      ]),
    );
    return searchAssetIndex(
      buildAssetIndex(snapshot.assets, {
        inspectionsByContentHash: Object.fromEntries(this.#inspections),
        usageCountByAssetId,
      }),
      query,
    );
  }

  async usage(assetId: string) {
    const snapshot = await this.#projects.snapshot();
    return buildAssetUsageReport(assetId, [snapshot.timeline]);
  }

  async #enqueueForAsset(
    kind: StudioJobKind,
    assetId: string,
    correlationId: string,
    task: (context: {
      readonly asset: AssetRecord;
      readonly sourcePath: string;
      readonly cacheRoot: string;
      readonly signal: AbortSignal;
    }) => Promise<unknown>,
  ): Promise<StudioJobSnapshot> {
    const root = this.#projects.openRootPath();
    const snapshot = await this.#projects.snapshot();
    const asset = requireAsset(snapshot, assetId);
    const sourcePath = await this.#resolveRegisteredPath(root, asset.path);
    return this.#jobs.enqueue({
      kind,
      correlationId,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      task: async ({ signal, report }) => {
        report(0.1);
        const result = await task({
          asset,
          sourcePath,
          cacheRoot: path.join(root, ".chai-cache", "media"),
          signal,
        });
        report(0.95);
        return result;
      },
    });
  }

  #authorizeSource(root: string, candidatePath: string) {
    return authorizeAssetPath({
      projectRoot: root,
      candidatePath,
      approvedExternalRoots: this.#externalRoots,
    });
  }

  async #resolveRegisteredPath(root: string, registryPath: string): Promise<string> {
    const segments = registryPath.split("/");
    let candidatePath: string;
    if (segments[0] === "external") {
      const external = this.#externalRoots.find((entry) => entry.id === segments[1]);
      if (external === undefined || segments.length < 3) {
        throw new Error(`Registered external root is unavailable: ${segments[1] ?? "missing"}.`);
      }
      candidatePath = path.join(external.path, ...segments.slice(2));
    } else {
      candidatePath = path.join(root, registryPath);
    }
    return (await this.#authorizeSource(root, candidatePath)).canonicalPath;
  }

  async #registrationMetadata(
    sourcePath: string,
    kind: AssetRecord["kind"],
    registryPath: string,
  ): Promise<
    Readonly<{
      durationFrames?: AssetRecord["durationFrames"];
      fps?: AssetRecord["fps"];
      hasAudio?: boolean;
      hasAlpha?: boolean;
      variableFrameRate?: boolean;
      validationState?: AssetRecord["validationState"];
    }>
  > {
    if (kind === "composition") {
      if (!registryPath.toLowerCase().endsWith(".chai-composition.json")) {
        return { validationState: "pending" };
      }
      try {
        const root = this.#projects.openRootPath();
        const manifest = await validateNativeCompositionManifest({
          projectRoot: root,
          manifestPath: registryPath,
        });
        return {
          durationFrames: null,
          fps: manifest.fps,
          hasAudio: false,
          hasAlpha: true,
          variableFrameRate: false,
          validationState: "valid",
        };
      } catch (cause: unknown) {
        throw new Error(
          `Composition manifest validation failed: ${cause instanceof Error ? cause.message : "invalid manifest"}`,
          { cause },
        );
      }
    }
    if (kind === "caption" || kind === "data") {
      return { validationState: "pending" };
    }
    const contentHash = await sha256File(sourcePath);
    let inspection: MediaInspectionV1;
    try {
      inspection = await this.#inspectMedia({
        filePath: sourcePath,
        contentHash,
        cacheDirectory: path.join(this.#projects.openRootPath(), ".chai-cache", "media", "inspections"),
        ffprobePath: this.#ffprobePath,
      });
    } catch (cause: unknown) {
      throw new Error(
        `Asset validation failed: ${cause instanceof Error ? cause.message : "media probe failed"}`,
        { cause },
      );
    }
    if (kind === "audio" && !inspection.hasAudio) {
      throw new Error("Asset validation failed: the selected file has no audio stream.");
    }
    if ((kind === "video" || kind === "image") && !inspection.hasVideo) {
      throw new Error("Asset validation failed: the selected file has no video or image stream.");
    }
    const snapshot = await this.#projects.snapshot();
    const video = inspection.videoStreams[0];
    const fps = video?.averageFrameRate ?? video?.realFrameRate ?? snapshot.timeline.fps;
    const duration = video?.durationSeconds ?? inspection.durationSeconds;
    const durationFrames =
      (video?.frameCount === null || video?.frameCount === undefined
        ? null
        : serializeBigInt(BigInt(video.frameCount))) ??
      (kind === "image"
        ? serializeBigInt(1n)
        : duration === null
          ? null
          : rationalFrameCount(duration, snapshot.timeline.fps));
    this.#inspections.set(contentHash, inspection);
    return {
      durationFrames,
      fps: kind === "audio" ? snapshot.timeline.fps : fps,
      hasAudio: inspection.hasAudio,
      hasAlpha: inspection.hasAlpha,
      variableFrameRate: inspection.variableFrameRate,
      validationState: "valid",
    };
  }

  async #invalidateAssetCaches(
    event: Readonly<{ assetId: string; beforeHash: string; afterHash: string }>,
  ): Promise<void> {
    this.#inspections.delete(event.beforeHash);
    if (event.afterHash !== event.beforeHash) this.#inspections.delete(event.afterHash);
    await this.#onAssetCacheInvalidation?.(event);
  }
}

const commandBase = (
  snapshot: LoadedProjectRevision,
  context: AssetMutationContext,
  affectedEntityIds: readonly string[],
) => ({
  schemaVersion: "1.0.0" as const,
  commandId: `command-${randomUUID()}`,
  idempotencyId: context.idempotencyId,
  actor: context.actor,
  projectId: snapshot.project.projectId,
  correlationId: `correlation-${randomUUID()}`,
  issuedAt: new Date().toISOString(),
  capability: { name: "media-assets", version: "1.0.0" },
  payloadVersion: "1.0.0" as const,
  affectedEntityIds,
  validationOnly: false,
  baseRevisionId: context.baseRevisionId,
  authorizationId: null,
});

const requireAsset = (snapshot: LoadedProjectRevision, assetId: string): AssetRecord => {
  const asset = snapshot.assets.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) throw new Error(`Unknown asset ID: ${assetId}.`);
  return asset;
};

const assertUploadAssetId = (assetId: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(assetId)) {
    throw new Error("Uploaded asset ID is invalid.");
  }
};

const safeUploadFileName = (value: string): string => {
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 180 ||
    normalized !== path.basename(normalized) ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    hasControlCharacter(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new Error("Uploaded asset filename is invalid.");
  }
  return normalized;
};

const isNodeError = (value: unknown): value is NodeJS.ErrnoException => value instanceof Error;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return true;
  }
  return false;
};

const rationalFrameCount = (
  duration: Readonly<{ numerator: string; denominator: string }>,
  fps: Readonly<{ numerator: string; denominator: string }>,
): BigIntString => {
  const numerator = BigInt(duration.numerator) * BigInt(fps.numerator);
  const denominator = BigInt(duration.denominator) * BigInt(fps.denominator);
  if (denominator <= 0n) throw new Error("Asset validation failed: duration has an invalid denominator.");
  return serializeBigInt((numerator + denominator / 2n) / denominator);
};
