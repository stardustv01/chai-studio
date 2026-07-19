export type PreviewColorSpace = "rec709" | "display-p3" | "rec2020";
export type PreviewTransferFunction = "srgb" | "rec709" | "linear";
export type PreviewAlphaMode = "straight" | "premultiplied";

export interface PreviewPixelContract {
  readonly contractId: string;
  readonly colorSpace: PreviewColorSpace;
  readonly transferFunction: PreviewTransferFunction;
  readonly alphaMode: PreviewAlphaMode;
  readonly bitDepth: 8;
  readonly pixelFormat: "rgba";
}

export interface PreviewPixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly contract: PreviewPixelContract;
}

export interface NormalizedPreviewPixelBuffer extends PreviewPixelBuffer {
  readonly contract: PreviewPixelContract & { readonly alphaMode: "straight" };
}

export const strictPreviewPixelContract: PreviewPixelContract = {
  contractId: "chai-preview-rgba8-rec709-straight-v1",
  colorSpace: "rec709",
  transferFunction: "rec709",
  alphaMode: "straight",
  bitDepth: 8,
  pixelFormat: "rgba",
};

export const normalizePreviewPixelBuffer = (
  input: PreviewPixelBuffer,
  target: PreviewPixelContract = strictPreviewPixelContract,
): NormalizedPreviewPixelBuffer => {
  assertPixelBuffer(input);
  if (
    input.contract.colorSpace !== target.colorSpace ||
    input.contract.transferFunction !== target.transferFunction ||
    target.alphaMode !== "straight"
  ) {
    throw new Error("Preview pixel normalization requires an explicit color converter for this contract.");
  }
  const pixels = new Uint8Array(input.pixels);
  if (input.contract.alphaMode === "premultiplied") {
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3] ?? 0;
      if (alpha === 0) {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
      } else {
        pixels[offset] = unpremultiply(pixels[offset] ?? 0, alpha);
        pixels[offset + 1] = unpremultiply(pixels[offset + 1] ?? 0, alpha);
        pixels[offset + 2] = unpremultiply(pixels[offset + 2] ?? 0, alpha);
      }
    }
  }
  return {
    width: input.width,
    height: input.height,
    pixels,
    contract: { ...target, alphaMode: "straight" },
  };
};

export const compareNormalizedPreviewPixels = (
  left: NormalizedPreviewPixelBuffer,
  right: NormalizedPreviewPixelBuffer,
): Readonly<{ equal: boolean; differingBytes: number; maximumChannelDelta: number }> => {
  assertPixelBuffer(left);
  assertPixelBuffer(right);
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.contract.contractId !== right.contract.contractId
  ) {
    return {
      equal: false,
      differingBytes: Math.max(left.pixels.length, right.pixels.length),
      maximumChannelDelta: 255,
    };
  }
  let differingBytes = 0;
  let maximumChannelDelta = 0;
  for (let index = 0; index < left.pixels.length; index += 1) {
    const delta = Math.abs((left.pixels[index] ?? 0) - (right.pixels[index] ?? 0));
    if (delta > 0) differingBytes += 1;
    if (delta > maximumChannelDelta) maximumChannelDelta = delta;
  }
  return { equal: differingBytes === 0, differingBytes, maximumChannelDelta };
};

export const deterministicPreviewPixelHash = (input: NormalizedPreviewPixelBuffer): string => {
  assertPixelBuffer(input);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const identity = new TextEncoder().encode(
    `${input.contract.contractId}:${input.width.toString()}x${input.height.toString()}:`,
  );
  for (const value of [...identity, ...input.pixels]) {
    hash ^= BigInt(value);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
};

const assertPixelBuffer = (input: PreviewPixelBuffer): void => {
  if (
    !Number.isSafeInteger(input.width) ||
    input.width < 1 ||
    !Number.isSafeInteger(input.height) ||
    input.height < 1
  ) {
    throw new Error("Preview pixel dimensions are invalid.");
  }
  if (input.pixels.length !== input.width * input.height * 4) {
    throw new Error("Preview pixel buffer length does not match RGBA dimensions.");
  }
};

const unpremultiply = (channel: number, alpha: number): number =>
  Math.min(255, Math.round((channel * 255) / alpha));
