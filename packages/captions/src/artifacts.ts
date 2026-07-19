import type {
  CaptionDocument,
  CaptionStyleTemplate,
  NormalizedRational,
  TranscriptDocument,
} from "@chai-studio/schema";
import { exportSrt, exportVtt } from "./import.js";
import { planCaptionLayout, type CaptionCollisionRegion } from "./layout.js";
import { evaluateCaptionQa } from "./qa.js";

export interface CaptionLayerArtifact {
  readonly artifactKind: "caption-layer-plan";
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly captionDocumentId: string;
  readonly transcriptId: string | null;
  readonly width: number;
  readonly height: number;
  readonly fps: NormalizedRational;
  readonly colorContract: "rec709-straight-alpha";
  readonly wordHighlightSampling: "latest-start-then-stable-id";
  readonly cues: readonly Readonly<{
    cueId: string;
    phraseId: string | null;
    startFrame: string;
    endFrameExclusive: string;
    text: string;
    lines: readonly string[];
    speakerId: string | null;
    locked: boolean;
    style: CaptionStyleTemplate;
    layout: ReturnType<typeof planCaptionLayout>;
    fontFileHash: string;
    glyphHash: string;
    wordIds: readonly string[];
    highlightMode: CaptionStyleTemplate["highlightMode"];
    wordHighlights: readonly Readonly<{
      wordId: string;
      startFrame: string;
      endFrameExclusive: string;
    }>[];
    lineHighlights: readonly Readonly<{
      lineIndex: number;
      startFrame: string;
      endFrameExclusive: string;
    }>[];
  }>[];
  readonly qaAnchors: readonly Readonly<{
    cueId: string;
    startFrame: string;
    endFrameExclusive: string;
    codes: readonly string[];
  }>[];
  readonly identity: string;
}

export interface CaptionArtifactBundle {
  readonly layerPlan: CaptionLayerArtifact;
  readonly srt: Readonly<{ text: string; contentHash: string }>;
  readonly vtt: Readonly<{ text: string; contentHash: string }>;
}

export const createCaptionArtifactBundle = async (input: {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly captions: CaptionDocument;
  readonly transcript: TranscriptDocument | null;
  readonly width: number;
  readonly height: number;
  readonly fps: NormalizedRational;
  readonly fontFileHashes: Readonly<Record<string, string>>;
  readonly glyphHashes: Readonly<Record<string, string>>;
  readonly collisionRegions?: readonly CaptionCollisionRegion[];
}): Promise<CaptionArtifactBundle> => {
  const styles = new Map(input.captions.styles.map((style) => [style.id, style]));
  const words = new Map(input.transcript?.words.map((word) => [word.id, word]) ?? []);
  const qaIssues = evaluateCaptionQa({
    captions: input.captions,
    fps: input.fps,
    width: input.width,
    height: input.height,
    ...(input.collisionRegions === undefined ? {} : { collisionRegions: input.collisionRegions }),
  });
  const cues = input.captions.cues.map((cue) => {
    const style = styles.get(cue.styleTemplateId);
    if (style === undefined) throw new Error(`Unknown caption style: ${cue.styleTemplateId}.`);
    const fontFileHash = input.fontFileHashes[style.fontAssetId];
    const glyphHash = input.glyphHashes[cue.id];
    if (fontFileHash === undefined || glyphHash === undefined) {
      throw new Error(`Caption cue ${cue.id} lacks font or glyph dependency evidence.`);
    }
    const wordHighlights = cue.wordIds.map((wordId) => {
      const word = words.get(wordId);
      if (word === undefined) {
        throw new Error(`Caption cue ${cue.id} lacks timing evidence for word ${wordId}.`);
      }
      return {
        wordId,
        startFrame: word.startFrame,
        endFrameExclusive: word.endFrameExclusive,
      };
    });
    return {
      cueId: cue.id,
      phraseId: cue.phraseId,
      startFrame: cue.startFrame,
      endFrameExclusive: cue.endFrameExclusive,
      text: cue.text,
      lines: cue.lines,
      speakerId: cue.speakerId,
      locked: cue.locked,
      style,
      layout: planCaptionLayout({
        cue,
        style,
        width: input.width,
        height: input.height,
        ...(input.collisionRegions === undefined ? {} : { collisionRegions: input.collisionRegions }),
      }),
      fontFileHash,
      glyphHash,
      wordIds: cue.wordIds,
      highlightMode: style.highlightMode,
      wordHighlights,
      lineHighlights: distributeLineHighlights(cue.startFrame, cue.endFrameExclusive, cue.lines.length),
    };
  });
  const base = {
    artifactKind: "caption-layer-plan" as const,
    projectId: input.projectId,
    revisionId: input.revisionId,
    timelineId: input.timelineId,
    captionDocumentId: input.captions.captionDocumentId,
    transcriptId: input.transcript?.transcriptId ?? null,
    width: input.width,
    height: input.height,
    fps: input.fps,
    colorContract: "rec709-straight-alpha" as const,
    wordHighlightSampling: "latest-start-then-stable-id" as const,
    cues,
    qaAnchors: cues.map((cue) => ({
      cueId: cue.cueId,
      startFrame: cue.startFrame,
      endFrameExclusive: cue.endFrameExclusive,
      codes: qaIssues
        .filter((issue) => issue.cueId === cue.cueId)
        .map((issue) => issue.code)
        .sort(),
    })),
  };
  const layerPlan: CaptionLayerArtifact = { ...base, identity: await sha256(stableJson(base)) };
  const srtText = exportSrt(input.captions, input.fps);
  const vttText = exportVtt(input.captions, input.fps);
  return {
    layerPlan,
    srt: { text: srtText, contentHash: await sha256(srtText) },
    vtt: { text: vttText, contentHash: await sha256(vttText) },
  };
};

const distributeLineHighlights = (
  startFrame: string,
  endFrameExclusive: string,
  lineCount: number,
): readonly Readonly<{
  lineIndex: number;
  startFrame: string;
  endFrameExclusive: string;
}>[] => {
  if (!Number.isSafeInteger(lineCount) || lineCount <= 0) return [];
  const start = BigInt(startFrame);
  const duration = BigInt(endFrameExclusive) - start;
  return Array.from({ length: lineCount }, (_, lineIndex) => ({
    lineIndex,
    startFrame: (start + (duration * BigInt(lineIndex)) / BigInt(lineCount)).toString(10),
    endFrameExclusive: (start + (duration * BigInt(lineIndex + 1)) / BigInt(lineCount)).toString(10),
  }));
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
};
