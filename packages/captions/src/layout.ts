import type { CaptionCueDocument, CaptionStyleTemplate } from "@chai-studio/schema";

export interface CaptionLayoutPlan {
  readonly cueId: string;
  readonly lines: readonly string[];
  readonly box: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly safeArea: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly collisionRegionIds: readonly string[];
}

export interface CaptionCollisionRegion {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const planCaptionLayout = (input: {
  readonly cue: CaptionCueDocument;
  readonly style: CaptionStyleTemplate;
  readonly width: number;
  readonly height: number;
  readonly collisionRegions?: readonly CaptionCollisionRegion[];
}): CaptionLayoutPlan => {
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    throw new Error("Caption layout dimensions must be positive integers.");
  }
  const lines = wrapCaptionText(input.cue.text, input.style.maxCharactersPerLine, input.style.maxLines);
  const insetX = Math.round((input.width * input.style.safeAreaPercent) / 100);
  const insetY = Math.round((input.height * input.style.safeAreaPercent) / 100);
  const lineHeightPx = input.style.fontSizePx * input.style.lineHeight;
  const boxHeight = Math.ceil(lineHeightPx * lines.length + input.style.fontSizePx * 0.65);
  const boxWidth = input.width - insetX * 2;
  const centerY = (input.height * input.style.verticalPositionPercent) / 100;
  const y = clamp(Math.round(centerY - boxHeight / 2), insetY, input.height - insetY - boxHeight);
  const box = { x: insetX, y, width: boxWidth, height: boxHeight };
  return {
    cueId: input.cue.id,
    lines,
    box,
    safeArea: { left: insetX, top: insetY, right: input.width - insetX, bottom: input.height - insetY },
    collisionRegionIds: (input.collisionRegions ?? [])
      .filter((region) => rectanglesOverlap(box, region))
      .map((region) => region.id)
      .sort((left, right) => left.localeCompare(right, "en")),
  };
};

export const wrapCaptionText = (
  text: string,
  maximumCharactersPerLine: number,
  maximumLines: number,
): readonly string[] => {
  if (text.trim() === "") throw new Error("Caption text cannot be empty.");
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (current === undefined || `${current} ${word}`.length > maximumCharactersPerLine) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  if (lines.length > maximumLines || lines.some((line) => line.length > maximumCharactersPerLine)) {
    throw new Error("Caption text exceeds the style line constraints.");
  }
  return lines;
};

const rectanglesOverlap = (
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));
