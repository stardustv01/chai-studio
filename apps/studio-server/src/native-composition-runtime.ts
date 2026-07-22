import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { access, copyFile, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  collectHyperframesDependencies,
  collectRemotionDependencies,
  discoverHyperframesCompositions,
  discoverRemotionCompositions,
  HyperframesCliRuntime,
  NodeRemotionRuntime,
  pinnedHyperframesVersion,
  pinnedRemotionVersion,
  RemotionRenderer,
  validateHyperframesSource,
  type HyperframesCompositionDescriptor,
  type HyperframesSourceDescriptor,
  type RemotionCompositionDescriptor,
  type RemotionSourceDescriptor,
} from "@chai-studio/engine-adapters";
import { normalizeRational, type TimelineClip } from "@chai-studio/schema";

export type NativeCompositionTrust = "trusted-authored" | "imported-untrusted";

export interface NativeCompositionInspection {
  readonly engine: "remotion" | "hyperframes";
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: Readonly<{ numerator: string; denominator: string }>;
  readonly durationFrames: string;
  readonly dependencyGraphHash: string;
  readonly adapterVersion: string;
  readonly browserIdentity: string;
  readonly browserVersion: string;
  readonly browserExecutableHash: string;
}

const execFileAsync = promisify(execFile);

export interface NativeCompositionManifestInspection {
  readonly engine: "remotion" | "hyperframes";
  readonly compositionId: string;
  readonly fps: ReturnType<typeof normalizeRational>;
}

interface NativeManifestBase {
  readonly schemaVersion: "1.0.0";
  readonly projectRoot: string;
  readonly compositionId: string;
  readonly declaredFps: Readonly<{ numerator: string; denominator: string }>;
}

interface RemotionManifest extends NativeManifestBase {
  readonly engine: "remotion";
  readonly entryPoint: string;
  readonly componentPath: string;
  readonly inputProps: Readonly<Record<string, unknown>>;
  readonly inputPropsSchema: RemotionSourceDescriptor["inputPropsSchema"];
  readonly allowDelayRender: boolean;
  readonly delayTimeoutMs: number;
  readonly assetPaths: readonly string[];
  readonly fontPaths: readonly string[];
  readonly generatedCodePaths: readonly string[];
  readonly approvedNetworkResources: RemotionSourceDescriptor["approvedNetworkResources"];
}

interface HyperframesManifest extends NativeManifestBase {
  readonly engine: "hyperframes";
  readonly entryFile: string;
  readonly variableOverrides: Readonly<Record<string, unknown>>;
  readonly approvedNetworkResources: HyperframesSourceDescriptor["approvedNetworkResources"];
}

type NativeCompositionManifest = RemotionManifest | HyperframesManifest;

export const validateNativeCompositionManifest = async (input: {
  readonly projectRoot: string;
  readonly manifestPath: string;
  readonly expectedEngine?: "remotion" | "hyperframes";
}): Promise<NativeCompositionManifestInspection> => {
  const manifest = await loadManifest(input.projectRoot, input.manifestPath);
  if (input.expectedEngine !== undefined && manifest.engine !== input.expectedEngine) {
    throw new Error(`Native manifest engine ${manifest.engine} does not match ${input.expectedEngine}.`);
  }
  const sourceRoot = resolveInside(input.projectRoot, manifest.projectRoot, "native project root");
  await assertCanonicalInside(input.projectRoot, sourceRoot, "native project root");
  await access(sourceRoot);
  if (manifest.engine === "remotion") {
    const paths = [
      resolveInside(sourceRoot, manifest.entryPoint, "Remotion entry point"),
      resolveInside(sourceRoot, manifest.componentPath, "Remotion component path"),
      ...manifest.assetPaths.map((item) => resolveInside(sourceRoot, item, "Remotion asset")),
      ...manifest.fontPaths.map((item) => resolveInside(sourceRoot, item, "Remotion font")),
      ...manifest.generatedCodePaths.map((item) =>
        resolveInside(sourceRoot, item, "Remotion generated source"),
      ),
    ];
    await Promise.all(
      paths.map(async (candidate) => {
        await assertCanonicalInside(sourceRoot, candidate, "Remotion source dependency");
        await access(candidate);
      }),
    );
  } else {
    const entryFile = resolveInside(sourceRoot, manifest.entryFile, "HyperFrames entry file");
    await assertCanonicalInside(sourceRoot, entryFile, "HyperFrames entry file");
    await access(entryFile);
  }
  return {
    engine: manifest.engine,
    compositionId: manifest.compositionId,
    fps: normalizeRational(BigInt(manifest.declaredFps.numerator), BigInt(manifest.declaredFps.denominator)),
  };
};

export const renderNativeCompositionLayer = async (input: {
  readonly projectRoot: string;
  readonly manifestPath: string;
  readonly clip: TimelineClip;
  readonly timelineStart: bigint;
  readonly timelineEnd: bigint;
  readonly outputDirectory: string;
  readonly trustClass: NativeCompositionTrust;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: number) => void;
}): Promise<NativeCompositionInspection> => {
  if (input.clip.engine === "shared") throw new Error("A shared clip cannot enter the native renderer.");
  if (input.trustClass === "imported-untrusted") {
    throw new Error(
      "Imported native execution requires an isolated worker selection that is not connected locally.",
    );
  }
  const prepared = await prepareNativeComposition({
    projectRoot: input.projectRoot,
    manifestPath: input.manifestPath,
    expectedEngine: input.clip.engine,
    trustClass: input.trustClass,
    signal: input.signal,
    clip: input.clip,
  });
  try {
    if (prepared.engine === "remotion") {
      const dependencies = await collectRemotionDependencies(
        prepared.source,
        prepared.composition.compositionId,
      );
      const renderer = new RemotionRenderer(prepared.runtime);
      const frameCount = input.timelineEnd - input.timelineStart;
      for (let offset = 0n; offset < frameCount; offset += 1n) {
        throwIfAborted(input.signal);
        const sourceFrame = sourceFrameFor(input.clip, input.timelineStart + offset);
        assertSourceFrame(sourceFrame, prepared.composition.durationFrames);
        await renderer.renderStill({
          source: prepared.source,
          composition: prepared.composition,
          serveUrl: prepared.serveUrl,
          frame: sourceFrame.toString(10),
          outputPath: path.join(input.outputDirectory, `frame-${padFrame(offset + 1n)}.png`),
          imageFormat: "png",
          environment: {
            strictEnvironmentFingerprint: environmentHash(
              `remotion:${pinnedRemotionVersion}:${prepared.browserIdentity}`,
            ),
            browserExecutable: prepared.browserExecutable,
            browserIdentity: prepared.browserIdentity,
            colorContractId: "chai-remotion-rgba8-straight-v1",
            colorSpace: "default",
            alphaMode: "straight",
            settingsHash: environmentHash("remotion-native-layer-settings-v1"),
          },
          dependencySet: dependencies,
          signal: input.signal,
        });
        input.onProgress?.(Number(offset + 1n) / Number(frameCount));
      }
      return inspectionFrom(
        prepared.composition,
        dependencies.dependencyGraphHash,
        "remotion",
        prepared.browserIdentity,
        prepared.browserVersion,
        prepared.browserExecutableHash,
      );
    }

    const validation = await validateHyperframesSource({
      source: prepared.source,
      composition: prepared.composition,
      runtime: prepared.runtime,
      signal: input.signal,
    });
    if (!validation.valid || !validation.seekable) {
      throw new Error(
        `HyperFrames native layer is not exactly seekable: ${validation.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    const dependencies = await collectHyperframesDependencies(
      prepared.source,
      prepared.composition.compositionId,
    );
    const renderedDirectory = path.join(input.outputDirectory, ".hyperframes-full");
    const result = await prepared.runtime.run(
      "render",
      [
        prepared.source.projectRoot,
        "--composition",
        path.relative(prepared.source.projectRoot, prepared.source.entryFile),
        "--output",
        renderedDirectory,
        "--format",
        "png-sequence",
        "--quality",
        "draft",
        "--workers",
        "1",
        "--fps",
        `${prepared.composition.fps.numerator}/${prepared.composition.fps.denominator}`,
        "--variables",
        JSON.stringify(prepared.source.variableOverrides),
        "--strict-variables",
        "--strict",
        "--no-best-effort",
        "--no-browser-gpu",
        "--quiet",
      ],
      { cwd: prepared.source.projectRoot, signal: input.signal },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
    const frames = (await readdir(renderedDirectory, { recursive: true }))
      .filter((candidate) => candidate.toLowerCase().endsWith(".png"))
      .sort()
      .map((candidate) => path.join(renderedDirectory, candidate));
    if (frames.length !== Number(prepared.composition.durationFrames)) {
      throw new Error(
        `HyperFrames sequence produced ${String(frames.length)} frames; expected ${prepared.composition.durationFrames}.`,
      );
    }
    const frameCount = input.timelineEnd - input.timelineStart;
    for (let offset = 0n; offset < frameCount; offset += 1n) {
      const sourceFrame = sourceFrameFor(input.clip, input.timelineStart + offset);
      assertSourceFrame(sourceFrame, prepared.composition.durationFrames);
      const source = frames[Number(sourceFrame)];
      if (source === undefined)
        throw new Error(`HyperFrames source frame ${sourceFrame.toString(10)} is missing.`);
      await copyFile(source, path.join(input.outputDirectory, `frame-${padFrame(offset + 1n)}.png`));
      input.onProgress?.(Number(offset + 1n) / Number(frameCount));
    }
    return inspectionFrom(
      prepared.composition,
      dependencies.dependencyGraphHash,
      "hyperframes",
      prepared.browserIdentity,
      prepared.browserVersion,
      prepared.browserExecutableHash,
    );
  } finally {
    await prepared.dispose();
  }
};

type PreparedNative =
  | Readonly<{
      engine: "remotion";
      source: RemotionSourceDescriptor;
      composition: RemotionCompositionDescriptor;
      runtime: NodeRemotionRuntime;
      serveUrl: string;
      browserExecutable: string;
      browserIdentity: string;
      browserVersion: string;
      browserExecutableHash: string;
      dispose: () => Promise<void>;
    }>
  | Readonly<{
      engine: "hyperframes";
      source: HyperframesSourceDescriptor;
      composition: HyperframesCompositionDescriptor;
      runtime: HyperframesCliRuntime;
      browserExecutable: string;
      browserIdentity: string;
      browserVersion: string;
      browserExecutableHash: string;
      dispose: () => Promise<void>;
    }>;

const prepareNativeComposition = async (input: {
  readonly projectRoot: string;
  readonly manifestPath: string;
  readonly expectedEngine?: "remotion" | "hyperframes";
  readonly trustClass: NativeCompositionTrust;
  readonly signal: AbortSignal;
  readonly clip?: TimelineClip;
}): Promise<PreparedNative> => {
  const manifest = await loadManifest(input.projectRoot, input.manifestPath);
  await validateNativeCompositionManifest({
    projectRoot: input.projectRoot,
    manifestPath: input.manifestPath,
    ...(input.expectedEngine === undefined ? {} : { expectedEngine: input.expectedEngine }),
  });
  if (input.expectedEngine !== undefined && manifest.engine !== input.expectedEngine) {
    throw new Error(
      `Native manifest engine ${manifest.engine} does not match clip engine ${input.expectedEngine}.`,
    );
  }
  const browser = await managedHeadlessShell();
  if (manifest.engine === "remotion") {
    const source = remotionSource(input.projectRoot, manifest, input.clip);
    const runtime = new NodeRemotionRuntime();
    const discovery = await discoverRemotionCompositions({
      source,
      runtime,
      browserExecutable: browser.executable,
      signal: input.signal,
    });
    if (!discovery.valid || discovery.selectedComposition === null || discovery.serveUrl === null) {
      await runtime.dispose();
      throw new Error(
        `Remotion composition discovery failed: ${discovery.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    return {
      engine: "remotion",
      source,
      composition: discovery.selectedComposition,
      runtime,
      serveUrl: discovery.serveUrl,
      browserExecutable: browser.executable,
      browserIdentity: browser.identity,
      browserVersion: browser.version,
      browserExecutableHash: browser.executableHash,
      dispose: () => runtime.dispose(),
    };
  }
  const source = hyperframesSource(input.projectRoot, manifest, input.trustClass, input.clip);
  const runtime = new HyperframesCliRuntime(hyperframesExecutable(), browser.executable);
  const discovery = await discoverHyperframesCompositions({ source, runtime, signal: input.signal });
  if (!discovery.valid || discovery.selectedComposition === null) {
    throw new Error(
      `HyperFrames composition discovery failed: ${discovery.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("; ")}`,
    );
  }
  return {
    engine: "hyperframes",
    source,
    composition: discovery.selectedComposition,
    runtime,
    browserExecutable: browser.executable,
    browserIdentity: browser.identity,
    browserVersion: browser.version,
    browserExecutableHash: browser.executableHash,
    dispose: () => Promise.resolve(),
  };
};

const remotionSource = (
  projectRoot: string,
  manifest: RemotionManifest,
  clip: TimelineClip | undefined,
): RemotionSourceDescriptor => {
  const sourceRoot = resolveInside(projectRoot, manifest.projectRoot, "native project root");
  return {
    sourceId: `source:${path.basename(manifest.compositionId)}`,
    projectRoot: sourceRoot,
    entryPoint: resolveInside(sourceRoot, manifest.entryPoint, "Remotion entry point"),
    componentPath: resolveInside(sourceRoot, manifest.componentPath, "Remotion component path"),
    compositionId: manifest.compositionId,
    declaredFps: normalizeRational(
      BigInt(manifest.declaredFps.numerator),
      BigInt(manifest.declaredFps.denominator),
    ),
    inputProps: { ...manifest.inputProps, ...clipOverrides(clip, "native.remotion.") },
    inputPropsSchema: manifest.inputPropsSchema,
    allowDelayRender: manifest.allowDelayRender,
    delayTimeoutMs: manifest.delayTimeoutMs,
    assetPaths: manifest.assetPaths.map((item) => resolveInside(sourceRoot, item, "Remotion asset")),
    fontPaths: manifest.fontPaths.map((item) => resolveInside(sourceRoot, item, "Remotion font")),
    generatedCodePaths: manifest.generatedCodePaths.map((item) =>
      resolveInside(sourceRoot, item, "Remotion generated source"),
    ),
    approvedNetworkResources: manifest.approvedNetworkResources,
    expectedVersions: {
      remotion: pinnedRemotionVersion,
      renderer: pinnedRemotionVersion,
      bundler: pinnedRemotionVersion,
      player: pinnedRemotionVersion,
    },
  };
};

const hyperframesSource = (
  projectRoot: string,
  manifest: HyperframesManifest,
  trustClass: NativeCompositionTrust,
  clip: TimelineClip | undefined,
): HyperframesSourceDescriptor => {
  const sourceRoot = resolveInside(projectRoot, manifest.projectRoot, "native project root");
  return {
    sourceId: `source:${path.basename(manifest.compositionId)}`,
    projectRoot: sourceRoot,
    entryFile: resolveInside(sourceRoot, manifest.entryFile, "HyperFrames entry file"),
    compositionId: manifest.compositionId,
    declaredFps: normalizeRational(
      BigInt(manifest.declaredFps.numerator),
      BigInt(manifest.declaredFps.denominator),
    ),
    variableOverrides: { ...manifest.variableOverrides, ...clipOverrides(clip, "native.hyperframes.") },
    trustClass,
    approvedNetworkResources: manifest.approvedNetworkResources,
    expectedVersion: pinnedHyperframesVersion,
  };
};

const loadManifest = async (
  projectRoot: string,
  manifestPath: string,
): Promise<NativeCompositionManifest> => {
  const absolute = resolveInside(projectRoot, manifestPath, "native manifest");
  await assertCanonicalInside(projectRoot, absolute, "native manifest");
  const bytes = await readFile(absolute);
  if (bytes.byteLength > 1_048_576) throw new Error("Native composition manifest exceeds 1 MiB.");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (cause) {
    throw new Error("Native composition asset must be a valid JSON manifest.", { cause });
  }
  const record = object(value, "native composition manifest");
  if (record.schemaVersion !== "1.0.0")
    throw new Error("Native composition manifest version is unsupported.");
  const engine = enumValue(record.engine, ["remotion", "hyperframes"] as const, "engine");
  const base = {
    schemaVersion: "1.0.0" as const,
    engine,
    projectRoot: relativePath(record.projectRoot, "projectRoot"),
    compositionId: text(record.compositionId, "compositionId"),
    declaredFps: rational(record.declaredFps),
  };
  const approvedNetworkResources = networkResources(record.approvedNetworkResources);
  if (engine === "remotion") {
    return {
      ...base,
      engine,
      entryPoint: relativePath(record.entryPoint, "entryPoint"),
      componentPath: relativePath(record.componentPath, "componentPath"),
      inputProps: optionalRecord(record.inputProps),
      inputPropsSchema: (record.inputPropsSchema ?? null) as RemotionSourceDescriptor["inputPropsSchema"],
      allowDelayRender: record.allowDelayRender === true,
      delayTimeoutMs: boundedInteger(record.delayTimeoutMs ?? 30_000, 1_000, 120_000, "delayTimeoutMs"),
      assetPaths: pathArray(record.assetPaths),
      fontPaths: pathArray(record.fontPaths),
      generatedCodePaths: pathArray(record.generatedCodePaths),
      approvedNetworkResources,
    };
  }
  return {
    ...base,
    engine,
    entryFile: relativePath(record.entryFile, "entryFile"),
    variableOverrides: optionalRecord(record.variableOverrides),
    approvedNetworkResources,
  };
};

const managedHeadlessShell = async (): Promise<
  Readonly<{ executable: string; identity: string; version: string; executableHash: string }>
> => {
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
  ].filter((item): item is string => typeof item === "string" && item !== "");
  const suffixes = [
    path.join("chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
    path.join("chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    path.join("chrome-headless-shell-mac", "chrome-headless-shell"),
    path.join("chrome-headless-shell-linux64", "chrome-headless-shell"),
  ];
  for (const cacheRoot of cacheRoots) {
    let builds: string[];
    try {
      builds = (await readdir(cacheRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^chromium_headless_shell-[0-9]+$/u.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => Number(right.split("-").at(-1)) - Number(left.split("-").at(-1)));
    } catch {
      continue;
    }
    for (const build of builds) {
      for (const suffix of suffixes) {
        const candidate = path.join(cacheRoot, build, suffix);
        try {
          await access(candidate);
        } catch {
          continue;
        }
        const canonicalCacheRoot = await realpath(cacheRoot);
        const canonicalCandidate = await realpath(candidate);
        const relativeCandidate = path.relative(canonicalCacheRoot, canonicalCandidate);
        if (
          relativeCandidate.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeCandidate) ||
          !canonicalCandidate.includes(`${path.sep}ms-playwright${path.sep}`)
        ) {
          throw new Error("Native rendering refused a non-Playwright browser executable.");
        }
        const { stdout } = await execFileAsync(canonicalCandidate, ["--version"], {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 1_048_576,
        });
        const version = /(?:Chrome(?: for Testing)?|Chromium)\s+([0-9]+(?:\.[0-9]+){1,3})/u.exec(
          stdout.trim(),
        )?.[1];
        if (version === undefined) {
          throw new Error("Managed Chromium did not report a measurable browser version.");
        }
        return {
          executable: canonicalCandidate,
          identity: `playwright-managed:${build}`,
          version,
          executableHash: await sha256File(canonicalCandidate),
        };
      }
    }
  }
  throw new Error("No Playwright-managed Chromium headless shell is available for native rendering.");
};

const hyperframesExecutable = (): string => {
  const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workspaceExecutable = path.resolve(
    runtimeDirectory,
    "../../../packages/engine-adapters/node_modules/.bin/hyperframes",
  );
  if (existsSync(workspaceExecutable)) return workspaceExecutable;
  try {
    return fileURLToPath(import.meta.resolve("hyperframes/dist/cli.js"));
  } catch {
    throw new Error("The pinned HyperFrames CLI is unavailable in this Chai Studio installation.");
  }
};

const clipOverrides = (clip: TimelineClip | undefined, prefix: string): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(clip?.properties ?? {})
      .filter(([propertyPath, property]) => propertyPath.startsWith(prefix) && property.safeToEdit)
      .map(([propertyPath, property]) => [propertyPath.slice(prefix.length), property.value]),
  );

const sourceFrameFor = (clip: TimelineClip, masterFrame: bigint): bigint => {
  const speed = clip.properties?.["time.speed"]?.value ?? 1;
  if (speed !== 1) throw new Error("Native layer time remapping requires an exact prepared speed evaluator.");
  return BigInt(clip.sourceInFrame) + masterFrame - BigInt(clip.startFrame);
};

const assertSourceFrame = (frame: bigint, durationFrames: string): void => {
  if (frame < 0n || frame >= BigInt(durationFrames)) {
    throw new Error(`Native source frame ${frame.toString(10)} is outside the composition.`);
  }
};

const inspectionFrom = (
  composition: RemotionCompositionDescriptor | HyperframesCompositionDescriptor,
  dependencyGraphHash: string,
  engine: NativeCompositionInspection["engine"],
  browserIdentity: string,
  browserVersion: string,
  browserExecutableHash: string,
): NativeCompositionInspection => ({
  engine,
  compositionId: composition.compositionId,
  width: composition.width,
  height: composition.height,
  fps: composition.fps,
  durationFrames: composition.durationFrames,
  dependencyGraphHash,
  adapterVersion: engine === "remotion" ? pinnedRemotionVersion : pinnedHyperframesVersion,
  browserIdentity,
  browserVersion,
  browserExecutableHash,
});

const resolveInside = (root: string, relative: string, label: string): string => {
  const resolvedRoot = path.resolve(root);
  if (path.isAbsolute(relative) || relative.includes("\0"))
    throw new Error(`${label} must be project-relative.`);
  const candidate = path.resolve(resolvedRoot, relative);
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its project root.`);
  }
  return candidate;
};

const assertCanonicalInside = async (root: string, candidate: string, label: string): Promise<void> => {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (canonicalCandidate !== canonicalRoot && !canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`${label} resolves outside its project root.`);
  }
};

const networkResources = (value: unknown): readonly Readonly<{ url: string; contentHash: string }>[] =>
  (Array.isArray(value) ? value : []).map((item) => {
    const record = object(item, "approved network resource");
    const url = text(record.url, "approved network URL");
    const contentHash = text(record.contentHash, "approved network hash");
    if (!url.startsWith("https://") || !/^[a-f0-9]{64}$/u.test(contentHash)) {
      throw new Error("Approved native network resources require HTTPS and an exact SHA-256 hash.");
    }
    return { url, contentHash };
  });

const rational = (value: unknown): Readonly<{ numerator: string; denominator: string }> => {
  const record = object(value, "declaredFps");
  const numerator = text(record.numerator, "declaredFps.numerator");
  const denominator = text(record.denominator, "declaredFps.denominator");
  normalizeRational(BigInt(numerator), BigInt(denominator));
  return { numerator, denominator };
};

const pathArray = (value: unknown): readonly string[] =>
  (Array.isArray(value) ? value : []).map((item) => relativePath(item, "native source path"));

const relativePath = (value: unknown, label: string): string => {
  const result = text(value, label);
  if (path.isAbsolute(result) || result.includes("\0")) throw new Error(`${label} must be relative.`);
  return result;
};

const optionalRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value === undefined ? {} : object(value, "native override object");

const object = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "" || value.length > 4_096) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], label: string): T => {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${label} is invalid.`);
  return value as T;
};

const boundedInteger = (value: unknown, minimum: number, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is outside supported bounds.`);
  }
  return value as number;
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Native composition render cancelled.", "AbortError");
};

const environmentHash = (value: string): string => createHash("sha256").update(value).digest("hex");
const sha256File = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      resolve(hash.digest("hex"));
    });
  });
const padFrame = (frame: bigint): string => frame.toString(10).padStart(8, "0");
