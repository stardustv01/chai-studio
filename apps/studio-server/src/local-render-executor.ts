import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildRenderEnvironmentIdentity,
  createRenderPlan,
  mergeRenderDependencies,
  type RenderPlan,
} from "@chai-studio/render";
import { sha256File } from "@chai-studio/media";
import { normalizeRational } from "@chai-studio/schema";
import { renderFullTimeline, type FullTimelineCompositorResult } from "./full-timeline-compositor.js";
import type { ProjectSessionService } from "./project-service.js";
import {
  renderAudioEvidenceFromMixArtifact,
  type RenderExecutor,
  type RenderRequestRecord,
  type RenderSecurityEvidence,
} from "./render-service.js";

const compositorVersion = "chai-full-timeline-compositor-v2";
const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface LocalRenderRuntimeFacts {
  readonly ffmpegPath: string;
  readonly ffmpegVersion: string;
  readonly ffmpegExecutableHash: string;
  readonly ffmpegConfigurationHash: string;
  readonly lockfilePath: string;
  readonly lockfileHash: string;
}

export const collectLocalRenderRuntimeFacts = async (input?: {
  readonly ffmpegPath?: string;
  readonly lockfilePath?: string;
}): Promise<LocalRenderRuntimeFacts> => {
  const configuredFfmpegPath = input?.ffmpegPath ?? process.env.CHAI_STUDIO_FFMPEG ?? "ffmpeg";
  const ffmpegPath = await resolveExecutable(configuredFfmpegPath);
  const lockfilePath = await realpath(input?.lockfilePath ?? path.join(repositoryRoot, "pnpm-lock.yaml"));
  const [{ stdout }, lockfile, ffmpegExecutableHash] = await Promise.all([
    execFileAsync(ffmpegPath, ["-version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1_048_576,
    }),
    readFile(lockfilePath),
    sha256File(ffmpegPath),
  ]);
  const ffmpegVersion = stdout.split(/\r?\n/u)[0]?.trim();
  if (ffmpegVersion === undefined || !/^ffmpeg version\s+\S+/u.test(ffmpegVersion)) {
    throw new Error("The configured FFmpeg executable did not report a measurable version.");
  }
  return {
    ffmpegPath,
    ffmpegVersion,
    ffmpegExecutableHash,
    ffmpegConfigurationHash: createHash("sha256").update(stdout, "utf8").digest("hex"),
    lockfilePath,
    lockfileHash: createHash("sha256").update(lockfile).digest("hex"),
  };
};

const resolveExecutable = async (configuredPath: string): Promise<string> => {
  const candidates =
    path.isAbsolute(configuredPath) || configuredPath.includes(path.sep)
      ? [path.resolve(configuredPath)]
      : (process.env.PATH ?? "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, configuredPath));
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return await realpath(candidate);
    } catch {
      // Keep searching PATH. The final error names only the configured token.
    }
  }
  throw new Error(`The configured FFmpeg executable is unavailable: ${configuredPath}`);
};

/**
 * Exact immutable timeline compositor for shared media, shared properties,
 * keyframes, captions, native engine layers, and the authoritative offline
 * AudioGraph mix. Unsupported native cases remain fail-closed in preflight.
 */
export const createLocalRenderExecutor =
  (projects: ProjectSessionService): RenderExecutor =>
  async (input) => {
    const snapshot = await projects.snapshot();
    if (snapshot.pointer.revisionId !== input.request.revisionId) {
      throw new Error("The full timeline compositor received a stale project revision.");
    }
    const fps = input.request.profile.fps ?? snapshot.timeline.fps;
    const runtimeFacts = await collectLocalRenderRuntimeFacts();
    const rendered = await renderFullTimeline({
      projects,
      snapshot,
      profile: input.request.profile,
      scope: input.request.scope,
      outputDirectory: input.outputDirectory,
      ffmpegPath: runtimeFacts.ffmpegPath,
      signal: input.signal,
      report: input.report,
      nativeTrustByAssetId: new Map(
        input.request.preflight.security.trustRecords.map((record) => [
          record.compositionId,
          record.trustClass === "trusted_authored" ? "trusted-authored" : "imported-untrusted",
        ]),
      ),
    });
    const plan = renderPlan(
      input.request,
      snapshot.timeline.timelineId,
      rendered.range,
      fps,
      rendered.visualLayerCount,
      rendered.captionCount,
      rendered.audioMix !== null,
      rendered.nativeLayers,
      runtimeFacts,
    );
    return {
      primaryRelativePath: rendered.primaryRelativePath,
      additionalRelativePaths: rendered.additionalRelativePaths,
      engines: [
        {
          engine: "shared",
          version: compositorVersion,
          role: "exact timeline composition, captions, encoding, and offline AudioGraph mix",
        },
        ...[...new Map(rendered.nativeLayers.map((layer) => [layer.inspection.engine, layer])).values()].map(
          (layer) => ({
            engine: layer.inspection.engine,
            version: layer.inspection.adapterVersion,
            role: `exact native ${layer.inspection.engine} layer rendering`,
          }),
        ),
      ],
      cacheLineage: [],
      warnings: [],
      reproductionCommands: [
        `chai-studio render --request ${input.request.id} --revision ${input.request.revisionId}`,
      ],
      audio:
        rendered.audioMix === null
          ? {
              status: "not-applicable",
              measurementVersion: null,
              reason: "delivery-profile-declares-no-audio",
            }
          : renderAudioEvidenceFromMixArtifact(rendered.audioMix, snapshot.project.audio.channelLayout),
      plan,
      security: securityEvidence(
        input.request,
        rendered.nativeLayers,
        plan.environment.strictEnvironmentFingerprint,
      ),
    };
  };

const renderPlan = (
  request: RenderRequestRecord,
  timelineId: string,
  range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
  fps: Readonly<{ numerator: string; denominator: string }>,
  layerCount: number,
  captionCount: number,
  hasAudio: boolean,
  nativeLayers: FullTimelineCompositorResult["nativeLayers"],
  runtimeFacts: LocalRenderRuntimeFacts,
): RenderPlan => {
  const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
  const dependencyManifest = mergeRenderDependencies([
    [
      {
        category: "project",
        id: request.projectId,
        contentHash: request.revisionHash,
        source: "immutable-project-revision",
        requiredBy: ["node-full-timeline"],
        portability: "strict",
        metadata: {
          revisionId: request.revisionId,
          layerCount: String(layerCount),
          captionCount: String(captionCount),
          hasAudio: String(hasAudio),
        },
      },
    ],
    nativeLayers.map((layer) => ({
      category: "adapter" as const,
      id: `${layer.inspection.engine}:${layer.assetId}`,
      contentHash: layer.inspection.dependencyGraphHash,
      source: "native-composition-dependency-graph",
      requiredBy: [`node-native-${layer.clipId}`],
      portability: "strict" as const,
      metadata: {
        clipId: layer.clipId,
        compositionId: layer.inspection.compositionId,
        adapterVersion: layer.inspection.adapterVersion,
      },
    })),
    [
      {
        category: "lockfile",
        id: "pnpm-lock.yaml",
        contentHash: runtimeFacts.lockfileHash,
        source: "measured-repository-lockfile",
        requiredBy: ["node-full-timeline"],
        portability: "strict",
        metadata: {},
      },
    ],
    [
      {
        category: "environment",
        id: "ffmpeg-executable",
        contentHash: runtimeFacts.ffmpegExecutableHash,
        source: "measured-canonical-ffmpeg-executable",
        requiredBy: ["node-full-timeline"],
        portability: "strict",
        metadata: {
          executableName: path.basename(runtimeFacts.ffmpegPath),
          version: runtimeFacts.ffmpegVersion,
          configurationHash: runtimeFacts.ffmpegConfigurationHash,
        },
      },
    ],
  ]);
  const rendererVersions = {
    shared: compositorVersion,
    ...Object.fromEntries(
      nativeLayers.map((layer) => [layer.inspection.engine, layer.inspection.adapterVersion]),
    ),
  };
  const browserIdentities = [
    ...new Set(nativeLayers.map((layer) => layer.inspection.browserIdentity)),
  ].sort();
  const browserHashes = [
    ...new Set(nativeLayers.map((layer) => layer.inspection.browserExecutableHash)),
  ].sort();
  const [singleBrowserHash] = browserHashes;
  const browserExecutableHash =
    browserHashes.length < 2
      ? (singleBrowserHash ?? digest(JSON.stringify([])))
      : digest(JSON.stringify(browserHashes));
  const browserMajor = measuredBrowserMajor(nativeLayers);
  const environment = buildRenderEnvironmentIdentity(
    {
      schemaVersion: "1.0.0",
      os: process.platform,
      architecture: process.arch,
      osVersion: os.release(),
      gpu:
        nativeLayers.length === 0
          ? "not-applicable:no-native-browser"
          : "unknown:native-browser-gpu-not-measured",
      nodeVersion: process.version,
      browserExecutableHash,
      browserIdentity:
        browserIdentities.length === 0 ? "not-applicable:shared-timeline" : browserIdentities.join("+"),
      rendererVersions,
      ffmpegVersion: `${runtimeFacts.ffmpegVersion}; executable-sha256=${runtimeFacts.ffmpegExecutableHash}; configuration-sha256=${runtimeFacts.ffmpegConfigurationHash}`,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      colorContractId: "chai-studio-shared-timeline-v2",
      lockfileHash: runtimeFacts.lockfileHash,
    },
    {
      schemaVersion: "1.0.0",
      architecture: process.arch,
      browserMajor,
      rendererVersions,
      colorContractId: "chai-studio-shared-timeline-v2",
    },
  );
  return createRenderPlan({
    id: `render-plan-${request.id}`,
    dag: {
      schemaVersion: "1.0.0",
      id: `render-dag-${request.id}`,
      projectId: request.projectId,
      revisionId: request.revisionId,
      timelineId,
      range,
      fps: normalizeRational(BigInt(fps.numerator), BigInt(fps.denominator)),
      nodes: [
        ...nativeLayers.map((layer) => ({
          schemaVersion: "1.0.0" as const,
          id: `node-native-${layer.clipId}`,
          kind:
            layer.inspection.engine === "remotion"
              ? ("native-remotion" as const)
              : ("native-hyperframes" as const),
          label: `Exact ${layer.inspection.engine} layer ${layer.inspection.compositionId}`,
          dependsOn: [],
          input: {
            assetId: layer.assetId,
            clipId: layer.clipId,
            compositionId: layer.inspection.compositionId,
            dependencyGraphHash: layer.inspection.dependencyGraphHash,
          },
          expectedOutputs: [],
          cachePolicy: "strict" as const,
          trustClass: "trusted-authored" as const,
          resources: { cpu: 2, memoryMiB: 1024, gpu: "shared" as const, browser: true },
          retryPolicy: { maxAttempts: 1, resumable: true, retryableStages: [] },
        })),
        {
          schemaVersion: "1.0.0",
          id: "node-full-timeline",
          kind: "master-composition",
          label: "Exact shared timeline compositor",
          dependsOn: nativeLayers.map((layer) => `node-native-${layer.clipId}`),
          input: {
            profileId: request.profile.id,
            scopeKind: request.scope.kind,
            layerCount,
            captionCount,
            hasAudio,
          },
          expectedOutputs: [],
          cachePolicy: "strict",
          trustClass: "trusted-authored",
          resources: { cpu: 2, memoryMiB: 512, gpu: "none", browser: false },
          retryPolicy: { maxAttempts: 1, resumable: true, retryableStages: [] },
        },
      ],
      roots: ["node-full-timeline"],
    },
    dependencyManifest,
    environment,
    decisions: [
      {
        entityId: timelineId,
        path: "unified",
        owner: "shared",
        capabilityIdentity: digest(`${compositorVersion}:${request.revisionHash}`),
        approximation: null,
        fallback: null,
        findings: [],
      },
      ...nativeLayers.map((layer) => ({
        entityId: layer.clipId,
        path: "native" as const,
        owner: layer.inspection.engine,
        capabilityIdentity: layer.inspection.dependencyGraphHash,
        approximation: null,
        fallback: null,
        findings: [],
      })),
    ],
  });
};

const securityEvidence = (
  request: RenderRequestRecord,
  nativeLayers: FullTimelineCompositorResult["nativeLayers"],
  strictEnvironmentFingerprint: string,
): RenderSecurityEvidence => {
  const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
  const nativeEngines = [...new Set(nativeLayers.map((layer) => layer.inspection.engine))].sort();
  return {
    schemaVersion: "1.0.0",
    policyIdentity: digest(request.preflight.security.policyIdentities.slice().sort().join(":")),
    trustClasses: request.preflight.security.trustClasses,
    workerPoolIds: [
      `local-${process.platform}-${process.arch}-shared-timeline-v2`,
      ...nativeEngines.map(
        (engine) => `local-${process.platform}-${process.arch}-${engine}-managed-browser-v1`,
      ),
    ],
    cacheNamespaces: [
      "local-shared-timeline-cache-v2",
      ...nativeEngines.map((engine) => `local-${engine}-native-cache-v1`),
    ],
    environmentIdentity: strictEnvironmentFingerprint,
    approvedNetworkHashes: [],
    isolationEvidenceHash: request.preflight.security.isolationEvidenceHash,
    violations: [],
  };
};

const measuredBrowserMajor = (nativeLayers: FullTimelineCompositorResult["nativeLayers"]): string => {
  const majors = [
    ...new Set(
      nativeLayers.map((layer) => layer.inspection.browserVersion.split(".")[0] ?? "").filter(Boolean),
    ),
  ].sort();
  return majors.length === 0 ? "not-applicable" : majors.join("+");
};
