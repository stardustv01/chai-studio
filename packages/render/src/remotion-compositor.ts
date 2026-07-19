import { writeFile } from "node:fs/promises";
import {
  generateRemotionFinishingComposition,
  pinnedRemotionVersion,
  type RemotionFinishingLayer,
} from "@chai-studio/engine-adapters";
import { normalizeRational } from "@chai-studio/schema";
import type { MasterCompositor, MasterCompositorRequest, MasterCompositorResult } from "./execution.js";

export type RemotionFinishingRender = (input: {
  readonly sourceCode: string;
  readonly sourceHash: string;
  readonly outputPath: string;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
}) => Promise<Readonly<{ frameCount: string; durationSamples: string | null; logs: readonly string[] }>>;

export class RemotionMasterCompositor implements MasterCompositor {
  readonly implementationId = "remotion-finishing-compositor";
  readonly implementationVersion = pinnedRemotionVersion;
  readonly #render: RemotionFinishingRender;

  constructor(render: RemotionFinishingRender) {
    this.#render = render;
  }

  async compose(request: MasterCompositorRequest): Promise<MasterCompositorResult> {
    const input = asRecord(request.node.input);
    const width = numeric(input.width, "width");
    const height = numeric(input.height, "height");
    const durationFrames = decimal(input.durationFrames, "durationFrames");
    const fpsNumerator = decimal(input.fpsNumerator, "fpsNumerator");
    const fpsDenominator = decimal(input.fpsDenominator, "fpsDenominator");
    const allLayers = [...request.visualLayers, ...request.bridgeLayers, ...request.captionLayers];
    const layers: RemotionFinishingLayer[] = allLayers.map((artifact, index) => ({
      layerId: artifact.descriptor.artifactId,
      artifactPath: artifactPath(input, artifact.cacheKey),
      startFrame: artifact.descriptor.frameRange?.startFrame ?? "0",
      durationFrames:
        artifact.descriptor.frameRange === null
          ? durationFrames
          : (
              BigInt(artifact.descriptor.frameRange.endFrameExclusive) -
              BigInt(artifact.descriptor.frameRange.startFrame)
            ).toString(10),
      zIndex: index,
      hasAlpha: artifact.descriptor.alphaMode !== "opaque" && artifact.descriptor.alphaMode !== null,
    }));
    const plan = generateRemotionFinishingComposition({
      compositionId: `ChaiFinish${request.node.id.replace(/[^A-Za-z0-9]/g, "")}`,
      width,
      height,
      fps: normalizeRational(BigInt(fpsNumerator), BigInt(fpsDenominator)),
      durationFrames,
      layers,
    });
    await writeFile(`${request.outputPath}.source.tsx`, plan.sourceCode, { mode: 0o600 });
    const rendered = await this.#render({
      sourceCode: plan.sourceCode,
      sourceHash: plan.sourceHash,
      outputPath: request.outputPath,
      signal: request.signal,
      report: request.report,
    });
    return {
      implementationId: this.implementationId,
      implementationVersion: this.implementationVersion,
      outputPath: request.outputPath,
      frameCount: rendered.frameCount,
      durationSamples: rendered.durationSamples,
      logs: rendered.logs,
    };
  }
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Master compositor node input is invalid.");
  }
  return value as Readonly<Record<string, unknown>>;
};

const numeric = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error(`Compositor ${label} is invalid.`);
  return value as number;
};

const decimal = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/.test(value)) {
    throw new Error(`Compositor ${label} is invalid.`);
  }
  return value;
};

const artifactPath = (input: Readonly<Record<string, unknown>>, cacheKey: string): string => {
  const paths = input.artifactPaths;
  if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error("Master compositor artifact path map is missing.");
  }
  const value = (paths as Readonly<Record<string, unknown>>)[cacheKey];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Master compositor artifact path is missing for ${cacheKey}.`);
  }
  return value;
};
