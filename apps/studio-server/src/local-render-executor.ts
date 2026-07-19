import { createHash } from "node:crypto";
import os from "node:os";
import {
  buildRenderEnvironmentIdentity,
  createRenderPlan,
  mergeRenderDependencies,
  type RenderPlan,
} from "@chai-studio/render";
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
    const rendered = await renderFullTimeline({
      projects,
      snapshot,
      profile: input.request.profile,
      scope: input.request.scope,
      outputDirectory: input.outputDirectory,
      signal: input.signal,
      report: input.report,
      nativeTrustByAssetId: new Map(
        input.request.preflight.security.trustRecords.map((record) => [
          record.compositionId,
          record.trustClass === "trusted_authored" ? "trusted-authored" : "imported-untrusted",
        ]),
      ),
    });
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
      plan: renderPlan(
        input.request,
        snapshot.timeline.timelineId,
        rendered.range,
        fps,
        rendered.visualLayerCount,
        rendered.captionCount,
        rendered.audioMix !== null,
        rendered.nativeLayers,
      ),
      security: securityEvidence(input.request, rendered.nativeLayers),
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
  const environment = buildRenderEnvironmentIdentity(
    {
      schemaVersion: "1.0.0",
      os: process.platform,
      architecture: process.arch,
      osVersion: os.release(),
      gpu: "none",
      nodeVersion: process.version,
      browserExecutableHash:
        browserHashes.length === 0
          ? digest("no-browser-shared-timeline")
          : browserHashes.length === 1
            ? (browserHashes[0] ?? digest("missing-browser-hash"))
            : digest(browserHashes.join(":")),
      browserIdentity: browserIdentities.length === 0 ? "none:shared-timeline" : browserIdentities.join("+"),
      rendererVersions,
      ffmpegVersion: process.env.CHAI_STUDIO_FFMPEG_VERSION ?? "local-system-ffmpeg",
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      colorContractId: "chai-studio-shared-timeline-v2",
      lockfileHash: digest("chai-studio-lockfile-v1"),
    },
    {
      schemaVersion: "1.0.0",
      architecture: process.arch,
      browserMajor: "none",
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
          resources: { cpu: 2, memoryMiB: 1024, gpu: "none" as const, browser: true },
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
): RenderSecurityEvidence => {
  const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
  const nativeEngines = [...new Set(nativeLayers.map((layer) => layer.inspection.engine))].sort();
  const browserHashes = [
    ...new Set(nativeLayers.map((layer) => layer.inspection.browserExecutableHash)),
  ].sort();
  return {
    schemaVersion: "1.0.0",
    policyIdentity: digest(request.preflight.security.policyIdentities.slice().sort().join(":")),
    trustClasses: request.preflight.security.trustClasses,
    workerPoolIds: [
      "local-macos-shared-timeline-v2",
      ...nativeEngines.map((engine) => `local-macos-${engine}-managed-browser-v1`),
    ],
    cacheNamespaces: [
      "local-shared-timeline-cache-v2",
      ...nativeEngines.map((engine) => `local-${engine}-native-cache-v1`),
    ],
    environmentIdentity: digest([request.id, request.revisionHash, ...browserHashes].join(":")),
    approvedNetworkHashes: [],
    isolationEvidenceHash: request.preflight.security.isolationEvidenceHash,
    violations: [],
  };
};
