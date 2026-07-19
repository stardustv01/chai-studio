import type { TranscriptDocument, TranscriptPhrase, TranscriptWord } from "@chai-studio/schema";

export interface TranscriptSearchMatch {
  readonly phrase: TranscriptPhrase;
  readonly matchStart: number;
  readonly matchEnd: number;
}

export const activeTranscriptPhrase = (
  transcript: TranscriptDocument,
  frameInput: string,
): TranscriptPhrase | null => {
  const frame = BigInt(frameInput);
  return (
    transcript.phrases.find(
      (phrase) => frame >= BigInt(phrase.startFrame) && frame < BigInt(phrase.endFrameExclusive),
    ) ?? null
  );
};

export const activeTranscriptWord = (
  transcript: TranscriptDocument,
  wordIds: readonly string[],
  frameInput: string,
): TranscriptWord | null => {
  const frame = BigInt(frameInput);
  const allowed = new Set(wordIds);
  return (
    transcript.words
      .filter(
        (word) =>
          allowed.has(word.id) && frame >= BigInt(word.startFrame) && frame < BigInt(word.endFrameExclusive),
      )
      .sort(
        (left, right) =>
          compareFrames(right.startFrame, left.startFrame) || left.id.localeCompare(right.id, "en"),
      )[0] ?? null
  );
};

export const searchTranscript = (input: {
  readonly transcript: TranscriptDocument;
  readonly query: string;
  readonly speakerId?: string | null;
  readonly minimumConfidence?: number | null;
}): readonly TranscriptSearchMatch[] => {
  const query = input.query.trim().toLocaleLowerCase(input.transcript.language);
  return input.transcript.phrases.flatMap((phrase) => {
    if (input.speakerId !== undefined && phrase.speakerId !== input.speakerId) return [];
    if (
      input.minimumConfidence !== undefined &&
      input.minimumConfidence !== null &&
      (phrase.confidence ?? 0) < input.minimumConfidence
    ) {
      return [];
    }
    const normalized = phrase.text.toLocaleLowerCase(input.transcript.language);
    const matchStart = query === "" ? 0 : normalized.indexOf(query);
    return matchStart < 0
      ? []
      : [{ phrase, matchStart, matchEnd: matchStart + query.length } satisfies TranscriptSearchMatch];
  });
};

export const adjacentTranscriptPhrase = (
  transcript: TranscriptDocument,
  phraseId: string,
  direction: "previous" | "next",
): TranscriptPhrase | null => {
  const ordered = [...transcript.phrases].sort(
    (left, right) =>
      compareFrames(left.startFrame, right.startFrame) || left.id.localeCompare(right.id, "en"),
  );
  const index = ordered.findIndex((phrase) => phrase.id === phraseId);
  if (index < 0) return null;
  return ordered[index + (direction === "previous" ? -1 : 1)] ?? null;
};

export const phraseNavigationTarget = (phrase: TranscriptPhrase) => ({
  seekFrame: phrase.startFrame,
  range: { startFrame: phrase.startFrame, endFrameExclusive: phrase.endFrameExclusive },
  selectedPhraseId: phrase.id,
});

export const phraseTimelineActionPlan = (phrase: TranscriptPhrase) => ({
  seekFrame: phrase.startFrame,
  splitFrame: phrase.startFrame,
  marker: {
    frame: phrase.startFrame,
    duration: (BigInt(phrase.endFrameExclusive) - BigInt(phrase.startFrame)).toString(10),
    label: phrase.text,
    annotationReferenceIds: [phrase.id] as const,
  },
  range: { startFrame: phrase.startFrame, endFrameExclusive: phrase.endFrameExclusive },
});

export const compareTranscriptToScript = (
  transcript: TranscriptDocument,
  script: string,
): Readonly<{
  transcriptTokens: number;
  scriptTokens: number;
  missingFromTranscript: readonly string[];
  extraInTranscript: readonly string[];
}> => {
  const transcriptTokens = tokenize(transcript.phrases.map((phrase) => phrase.text).join(" "));
  const scriptTokens = tokenize(script);
  const transcriptCounts = counts(transcriptTokens);
  const scriptCounts = counts(scriptTokens);
  return {
    transcriptTokens: transcriptTokens.length,
    scriptTokens: scriptTokens.length,
    missingFromTranscript: subtractCounts(scriptCounts, transcriptCounts),
    extraInTranscript: subtractCounts(transcriptCounts, scriptCounts),
  };
};

const tokenize = (value: string): readonly string[] =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}']+/gu) ?? [];

const counts = (tokens: readonly string[]): ReadonlyMap<string, number> => {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
};

const subtractCounts = (
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): readonly string[] =>
  [...left.entries()].flatMap(([token, count]) =>
    Array.from({ length: Math.max(0, count - (right.get(token) ?? 0)) }, () => token),
  );

const compareFrames = (left: string, right: string): number => {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
