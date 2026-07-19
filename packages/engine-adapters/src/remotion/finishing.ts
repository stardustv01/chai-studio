import { createHash } from "node:crypto";
import type { RemotionFinishingCompositionPlan, RemotionFinishingLayer } from "./contracts.js";

export const generateRemotionFinishingComposition = (input: {
  readonly compositionId: string;
  readonly width: number;
  readonly height: number;
  readonly fps: RemotionFinishingCompositionPlan["fps"];
  readonly durationFrames: string;
  readonly layers: readonly RemotionFinishingLayer[];
}): RemotionFinishingCompositionPlan => {
  assertIdentifier(input.compositionId);
  if (
    !Number.isSafeInteger(input.width) ||
    input.width < 1 ||
    !Number.isSafeInteger(input.height) ||
    input.height < 1
  ) {
    throw new Error("Finishing composition dimensions are invalid.");
  }
  const duration = parsePositiveFrame(input.durationFrames, "durationFrames");
  const layers = [...input.layers].sort(
    (left, right) => left.zIndex - right.zIndex || left.layerId.localeCompare(right.layerId),
  );
  for (const layer of layers) {
    assertIdentifier(layer.layerId);
    const start = parseNonNegativeFrame(layer.startFrame, `${layer.layerId}.startFrame`);
    const layerDuration = parsePositiveFrame(layer.durationFrames, `${layer.layerId}.durationFrames`);
    if (start + layerDuration > duration)
      throw new Error(`Finishing layer ${layer.layerId} exceeds the timeline.`);
  }
  const serializedLayers = JSON.stringify(layers).replaceAll("<", "\\u003c");
  const fps = Number(input.fps.numerator) / Number(input.fps.denominator);
  const sourceCode = `import React from "react";
import {AbsoluteFill, Composition, Img, OffthreadVideo, Sequence} from "remotion";

const layers = ${serializedLayers} as const;

const Finish: React.FC = () => (
  <AbsoluteFill>
    {layers.map((layer) => (
      <Sequence key={layer.layerId} from={Number(layer.startFrame)} durationInFrames={Number(layer.durationFrames)}>
        <AbsoluteFill style={{zIndex: layer.zIndex}}>
          {layer.hasAlpha ? <Img src={layer.artifactPath} /> : <OffthreadVideo src={layer.artifactPath} muted />}
        </AbsoluteFill>
      </Sequence>
    ))}
  </AbsoluteFill>
);

export const ChaiFinishingRoot: React.FC = () => (
  <Composition id=${JSON.stringify(input.compositionId)} component={Finish} width={${input.width.toString()}} height={${input.height.toString()}} fps={${fps.toString()}} durationInFrames={${input.durationFrames}} />
);
`;
  return {
    interfaceVersion: "chai-finishing-compositor.v1",
    compositionId: input.compositionId,
    width: input.width,
    height: input.height,
    fps: input.fps,
    durationFrames: input.durationFrames,
    sourceCode,
    sourceHash: createHash("sha256").update(sourceCode).digest("hex"),
    dependencies: layers.map((layer) => layer.artifactPath),
  };
};

const assertIdentifier = (value: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error("Finishing identity is invalid.");
};

const parseNonNegativeFrame = (value: string, field: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error(`Finishing ${field} is invalid.`);
  return BigInt(value);
};

const parsePositiveFrame = (value: string, field: string): bigint => {
  const frame = parseNonNegativeFrame(value, field);
  if (frame === 0n) throw new Error(`Finishing ${field} must be positive.`);
  return frame;
};
