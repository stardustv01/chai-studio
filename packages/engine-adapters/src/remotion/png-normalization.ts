import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export interface NormalizedPngPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly normalizedPixelHash: string;
}

export const normalizeRemotionPng = (png: Uint8Array): NormalizedPngPixels => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < signature.length || !signature.every((byte, index) => png[index] === byte)) {
    throw new Error("Remotion still is not a valid PNG signature.");
  }
  let offset = signature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const length = readUInt32(png, offset);
    const type = new TextDecoder().decode(png.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("Remotion PNG chunk exceeds the file boundary.");
    const data = png.slice(dataStart, dataEnd);
    if (type === "IHDR") {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") break;
    offset = dataEnd + 4;
  }
  if (width < 1 || height < 1 || bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error("Remotion PNG normalization requires non-interlaced 8-bit RGB or RGBA output.");
  }
  const packed = Buffer.concat(compressed.map((chunk) => Buffer.from(chunk)));
  const inflated = inflateSync(packed);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  if (inflated.length !== height * (stride + 1)) throw new Error("Remotion PNG scanline length is invalid.");
  const decoded = new Uint8Array(width * height * channels);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (stride + 1);
    const filter = inflated[sourceOffset] ?? 0;
    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[sourceOffset + 1 + column] ?? 0;
      const left = column >= channels ? (decoded[row * stride + column - channels] ?? 0) : 0;
      const above = row > 0 ? (decoded[(row - 1) * stride + column] ?? 0) : 0;
      const upperLeft =
        row > 0 && column >= channels ? (decoded[(row - 1) * stride + column - channels] ?? 0) : 0;
      decoded[row * stride + column] = reconstructPngByte(filter, raw, left, above, upperLeft);
    }
  }
  const rgba =
    channels === 4
      ? decoded
      : Uint8Array.from({ length: width * height * 4 }, (_, index) =>
          (index + 1) % 4 === 0 ? 255 : (decoded[index - Math.floor(index / 4)] ?? 0),
        );
  const identity = Buffer.concat([
    Buffer.from("chai-remotion-rgba8-straight-v1\0"),
    uint32Buffer(width),
    uint32Buffer(height),
    Buffer.from(rgba),
  ]);
  return {
    width,
    height,
    rgba,
    normalizedPixelHash: createHash("sha256").update(identity).digest("hex"),
  };
};

const reconstructPngByte = (
  filter: number,
  raw: number,
  left: number,
  above: number,
  upperLeft: number,
): number => {
  switch (filter) {
    case 0:
      return raw;
    case 1:
      return (raw + left) & 0xff;
    case 2:
      return (raw + above) & 0xff;
    case 3:
      return (raw + Math.floor((left + above) / 2)) & 0xff;
    case 4:
      return (raw + paeth(left, above, upperLeft)) & 0xff;
    default:
      throw new Error(`Remotion PNG uses unsupported filter ${String(filter)}.`);
  }
};

const paeth = (left: number, above: number, upperLeft: number): number => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
};

const readUInt32 = (value: Uint8Array, offset: number): number =>
  (((value[offset] ?? 0) << 24) |
    ((value[offset + 1] ?? 0) << 16) |
    ((value[offset + 2] ?? 0) << 8) |
    (value[offset + 3] ?? 0)) >>>
  0;

const uint32Buffer = (value: number): Buffer => {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
