import type { PreviewFrameRange } from "./master-clock.js";
import type { PreviewLayerKind, PreviewPresentedLayer, PreviewWarning } from "./preview-contract.js";

export type PreviewBlendMode =
  "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "difference";

export interface PreviewLayerTransform {
  readonly positionX: number;
  readonly positionY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotationDegrees: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export interface PreviewCrop {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface PreviewLayerNode {
  readonly id: string;
  readonly adapterId: string;
  readonly kind: PreviewLayerKind;
  readonly timelineRange: PreviewFrameRange;
  readonly zIndex: number;
  readonly sourceOrder: number;
  readonly opacity: number;
  readonly blendMode: PreviewBlendMode;
  readonly transform: PreviewLayerTransform;
  readonly crop: PreviewCrop;
  readonly visible: boolean;
}

export interface PreviewViewportFit {
  readonly mode: "fit" | "fill";
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly bars: "none" | "letterbox" | "pillarbox";
}

export interface PreviewCompositeFrame {
  readonly frame: string;
  readonly layers: readonly Readonly<{
    node: PreviewLayerNode;
    presentation: PreviewPresentedLayer;
  }>[];
  readonly warnings: readonly PreviewWarning[];
  readonly degraded: boolean;
  readonly identity: string;
}

export const defaultPreviewTransform: PreviewLayerTransform = {
  positionX: 0,
  positionY: 0,
  scaleX: 1,
  scaleY: 1,
  rotationDegrees: 0,
  anchorX: 0.5,
  anchorY: 0.5,
};

export const emptyPreviewCrop: PreviewCrop = { top: 0, right: 0, bottom: 0, left: 0 };

export const createPreviewLayerGraph = (nodes: readonly PreviewLayerNode[]): readonly PreviewLayerNode[] => {
  const identifiers = new Set<string>();
  const validated = nodes.map((node) => {
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(node.id)) throw new Error("Preview layer ID is invalid.");
    if (identifiers.has(node.id)) throw new Error(`Preview layer ID ${node.id} is duplicated.`);
    identifiers.add(node.id);
    validateFinite(node.zIndex, `${node.id}.zIndex`);
    if (!Number.isSafeInteger(node.sourceOrder) || node.sourceOrder < 0) {
      throw new Error(`Preview layer ${node.id} source order is invalid.`);
    }
    if (!Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1) {
      throw new Error(`Preview layer ${node.id} opacity must be between zero and one.`);
    }
    const transformValues = [
      ["positionX", node.transform.positionX],
      ["positionY", node.transform.positionY],
      ["scaleX", node.transform.scaleX],
      ["scaleY", node.transform.scaleY],
      ["rotationDegrees", node.transform.rotationDegrees],
      ["anchorX", node.transform.anchorX],
      ["anchorY", node.transform.anchorY],
    ] as const;
    for (const [field, value] of transformValues) validateFinite(value, `${node.id}.${field}`);
    if (node.transform.scaleX === 0 || node.transform.scaleY === 0) {
      throw new Error(`Preview layer ${node.id} scale cannot be zero.`);
    }
    for (const [field, value] of Object.entries(node.crop)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Preview layer ${node.id} crop ${field} must be between zero and one.`);
      }
    }
    if (node.crop.left + node.crop.right >= 1 || node.crop.top + node.crop.bottom >= 1) {
      throw new Error(`Preview layer ${node.id} crop removes the entire layer.`);
    }
    if (BigInt(node.timelineRange.endFrameExclusive) <= BigInt(node.timelineRange.startFrame)) {
      throw new Error(`Preview layer ${node.id} range is empty.`);
    }
    return Object.freeze({ ...node, transform: { ...node.transform }, crop: { ...node.crop } });
  });
  return validated.sort(
    (left, right) =>
      left.zIndex - right.zIndex || left.sourceOrder - right.sourceOrder || left.id.localeCompare(right.id),
  );
};

export const activePreviewLayers = (
  graph: readonly PreviewLayerNode[],
  frameInput: string,
): readonly PreviewLayerNode[] => {
  const frame = BigInt(frameInput);
  return graph.filter(
    (node) =>
      node.visible &&
      frame >= BigInt(node.timelineRange.startFrame) &&
      frame < BigInt(node.timelineRange.endFrameExclusive),
  );
};

export const compositePreviewLayers = (
  frame: string,
  graph: readonly PreviewLayerNode[],
  presentations: readonly PreviewPresentedLayer[],
  additionalWarnings: readonly PreviewWarning[] = [],
): PreviewCompositeFrame => {
  const presentationByLayer = new Map(
    presentations.map((presentation) => [presentation.layerId, presentation]),
  );
  const layers = activePreviewLayers(graph, frame).flatMap((node) => {
    const presentation = presentationByLayer.get(node.id);
    return presentation === undefined ? [] : [{ node, presentation }];
  });
  const warnings = [...layers.flatMap(({ presentation }) => presentation.warnings), ...additionalWarnings];
  const identity = layers
    .map(({ node, presentation }) => `${node.id}@${node.zIndex.toString()}:${presentation.artifactIdentity}`)
    .join("|");
  return {
    frame,
    layers,
    warnings,
    degraded: warnings.some((warning) => warning.severity !== "info"),
    identity,
  };
};

export const calculatePreviewViewportFit = (input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly mode: "fit" | "fill";
}): PreviewViewportFit => {
  const dimensions = [
    ["sourceWidth", input.sourceWidth],
    ["sourceHeight", input.sourceHeight],
    ["viewportWidth", input.viewportWidth],
    ["viewportHeight", input.viewportHeight],
  ] as const;
  for (const [field, value] of dimensions) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Preview viewport ${field} must be positive.`);
  }
  const widthScale = input.viewportWidth / input.sourceWidth;
  const heightScale = input.viewportHeight / input.sourceHeight;
  const scale = input.mode === "fit" ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
  const width = input.sourceWidth * scale;
  const height = input.sourceHeight * scale;
  return {
    mode: input.mode,
    scale,
    offsetX: (input.viewportWidth - width) / 2,
    offsetY: (input.viewportHeight - height) / 2,
    bars:
      input.mode === "fill" || (width === input.viewportWidth && height === input.viewportHeight)
        ? "none"
        : width < input.viewportWidth
          ? "pillarbox"
          : "letterbox",
  };
};

const validateFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`Preview ${field} must be finite.`);
};
