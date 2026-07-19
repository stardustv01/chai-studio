import { createHash } from "node:crypto";
import type { SharedCaptionCue, SharedCaptionPlan, SharedCaptionWord } from "./contracts.js";

export const createSharedCaptionPlan = (
  input: Omit<SharedCaptionPlan, "identity" | "cues"> & { readonly cues: readonly SharedCaptionCue[] },
): SharedCaptionPlan => {
  if (!Number.isSafeInteger(input.width) || input.width <= 0)
    throw new Error("Caption width must be positive.");
  if (!Number.isSafeInteger(input.height) || input.height <= 0)
    throw new Error("Caption height must be positive.");
  assertRange(input.timelineRange.startFrame, input.timelineRange.endFrameExclusive, "caption plan");
  const identifiers = new Set<string>();
  const cues = input.cues
    .map((cue) => {
      assertIdentifier(cue.cueId, "cueId");
      if (identifiers.has(cue.cueId)) throw new Error(`Caption cue ${cue.cueId} is duplicated.`);
      identifiers.add(cue.cueId);
      assertRange(cue.range.startFrame, cue.range.endFrameExclusive, `caption cue ${cue.cueId}`);
      if (
        BigInt(cue.range.startFrame) < BigInt(input.timelineRange.startFrame) ||
        BigInt(cue.range.endFrameExclusive) > BigInt(input.timelineRange.endFrameExclusive)
      ) {
        throw new Error(`Caption cue ${cue.cueId} exceeds the plan range.`);
      }
      if (cue.text.trim() === "" || cue.lines.length === 0 || cue.lines.some((line) => line.trim() === "")) {
        throw new Error(`Caption cue ${cue.cueId} has empty text or lines.`);
      }
      for (const field of [cue.styleId, cue.fontFileHash, cue.glyphHash]) {
        if (field.trim() === "")
          throw new Error(`Caption cue ${cue.cueId} lacks deterministic style evidence.`);
      }
      const words = cue.words.map((word) => validateWord(cue, word));
      return Object.freeze({ ...cue, lines: Object.freeze([...cue.lines]), words: Object.freeze(words) });
    })
    .sort(
      (left, right) =>
        compareFrame(left.range.startFrame, right.range.startFrame) || left.cueId.localeCompare(right.cueId),
    );
  const base = {
    ...input,
    cues: Object.freeze(cues),
  };
  return Object.freeze({
    ...base,
    identity: createHash("sha256").update(JSON.stringify(base)).digest("hex"),
  });
};

export const activeSharedCaptionCues = (
  plan: SharedCaptionPlan,
  frameInput: string,
): readonly SharedCaptionCue[] => {
  const frame = BigInt(frameInput);
  return plan.cues.filter(
    (cue) => frame >= BigInt(cue.range.startFrame) && frame < BigInt(cue.range.endFrameExclusive),
  );
};

export const activeSharedCaptionWords = (
  cue: SharedCaptionCue,
  frameInput: string,
): readonly SharedCaptionWord[] => {
  const frame = BigInt(frameInput);
  return cue.words.filter(
    (word) => frame >= BigInt(word.range.startFrame) && frame < BigInt(word.range.endFrameExclusive),
  );
};

const validateWord = (cue: SharedCaptionCue, word: SharedCaptionWord): SharedCaptionWord => {
  assertIdentifier(word.wordId, "wordId");
  assertRange(word.range.startFrame, word.range.endFrameExclusive, `caption word ${word.wordId}`);
  if (
    BigInt(word.range.startFrame) < BigInt(cue.range.startFrame) ||
    BigInt(word.range.endFrameExclusive) > BigInt(cue.range.endFrameExclusive)
  ) {
    throw new Error(`Caption word ${word.wordId} exceeds cue ${cue.cueId}.`);
  }
  if (word.text.trim() === "") throw new Error(`Caption word ${word.wordId} is empty.`);
  return Object.freeze({ ...word });
};

const assertRange = (startInput: string, endInput: string, field: string): void => {
  const start = BigInt(startInput);
  const end = BigInt(endInput);
  if (end <= start) throw new Error(`${field} range must be non-empty and half open.`);
};

const assertIdentifier = (value: string, field: string): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`Caption ${field} is invalid.`);
};

const compareFrame = (left: string, right: string): number => {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
