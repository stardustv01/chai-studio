import type { CaptionDocument, CaptionCueDocument, TranscriptDocument } from "@chai-studio/schema";

export interface LanguageValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly entityId: string;
  readonly message: string;
}

export const validateTranscript = (transcript: TranscriptDocument): readonly LanguageValidationIssue[] => {
  const issues: LanguageValidationIssue[] = [];
  const speakerIds = uniqueIds(
    transcript.speakers.map((speaker) => speaker.id),
    transcript.transcriptId,
    "transcript.speaker-id.duplicate",
    issues,
  );
  const words = new Map(transcript.words.map((word) => [word.id, word]));
  uniqueIds(
    transcript.words.map((word) => word.id),
    transcript.transcriptId,
    "transcript.word-id.duplicate",
    issues,
  );
  uniqueIds(
    transcript.phrases.map((phrase) => phrase.id),
    transcript.transcriptId,
    "transcript.phrase-id.duplicate",
    issues,
  );
  for (const word of transcript.words) {
    if (
      word.text.trim() === "" ||
      BigInt(word.endSampleExclusive) <= BigInt(word.startSample) ||
      BigInt(word.endFrameExclusive) <= BigInt(word.startFrame)
    ) {
      issues.push(error("transcript.word.invalid", word.id, "Word text and timing must be non-empty."));
    }
  }
  for (const phrase of transcript.phrases) {
    if (
      phrase.text.trim() === "" ||
      phrase.wordIds.length === 0 ||
      phrase.wordIds.some((id) => !words.has(id)) ||
      (phrase.speakerId !== null && !speakerIds.has(phrase.speakerId)) ||
      BigInt(phrase.endFrameExclusive) <= BigInt(phrase.startFrame)
    ) {
      issues.push(
        error(
          "transcript.phrase.invalid",
          phrase.id,
          "Phrase text, timing, speaker, and word references must remain valid.",
        ),
      );
    }
  }
  return issues;
};

export const validateCaptionDocument = (input: {
  readonly captions: CaptionDocument;
  readonly transcript: TranscriptDocument | null;
}): readonly LanguageValidationIssue[] => {
  const issues: LanguageValidationIssue[] = [];
  const styleIds = uniqueIds(
    input.captions.styles.map((style) => style.id),
    input.captions.captionDocumentId,
    "caption.style-id.duplicate",
    issues,
  );
  for (const style of input.captions.styles) {
    if (
      style.name.trim() === "" ||
      style.fontFamily.trim() === "" ||
      style.fontSizePx < 8 ||
      style.fontSizePx > 512 ||
      !Number.isInteger(style.fontWeight) ||
      style.fontWeight < 100 ||
      style.fontWeight > 900 ||
      style.lineHeight < 0.8 ||
      style.lineHeight > 3 ||
      !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(style.fillColor) ||
      !/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u.test(style.backgroundColor) ||
      style.verticalPositionPercent < 0 ||
      style.verticalPositionPercent > 100 ||
      style.safeAreaPercent < 0 ||
      style.safeAreaPercent > 40 ||
      !Number.isInteger(style.maxLines) ||
      style.maxLines < 1 ||
      style.maxLines > 6 ||
      !Number.isInteger(style.maxCharactersPerLine) ||
      style.maxCharactersPerLine < 4 ||
      style.maxCharactersPerLine > 200 ||
      style.maxCharactersPerSecond < 1 ||
      style.maxCharactersPerSecond > 100
    ) {
      issues.push(
        error(
          "caption.style.invalid",
          style.id,
          "Caption typography, color, box, safe-area, or readability limits are invalid.",
        ),
      );
    }
  }
  uniqueIds(
    input.captions.cues.map((cue) => cue.id),
    input.captions.captionDocumentId,
    "caption.cue-id.duplicate",
    issues,
  );
  const phraseIds = new Set(input.transcript?.phrases.map((phrase) => phrase.id) ?? []);
  const wordIds = new Set(input.transcript?.words.map((word) => word.id) ?? []);
  for (const cue of input.captions.cues) {
    validateCue(cue, styleIds, phraseIds, wordIds, issues);
  }
  const byTrack = new Map<string, CaptionCueDocument[]>();
  for (const cue of input.captions.cues) {
    const current = byTrack.get(cue.trackId) ?? [];
    current.push(cue);
    byTrack.set(cue.trackId, current);
  }
  for (const cues of byTrack.values()) {
    const sorted = [...cues].sort((left, right) => compareFrames(left.startFrame, right.startFrame));
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        BigInt(previous.endFrameExclusive) > BigInt(current.startFrame)
      ) {
        issues.push(
          error("caption.cue.overlap", current.id, `Caption cue overlaps ${previous.id} on the same track.`),
        );
      }
    }
  }
  return issues;
};

export const assertValidTranscript = (transcript: TranscriptDocument): TranscriptDocument => {
  const issues = validateTranscript(transcript).filter((issue) => issue.severity === "error");
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  return transcript;
};

export const assertValidCaptionDocument = (input: {
  readonly captions: CaptionDocument;
  readonly transcript: TranscriptDocument | null;
}): CaptionDocument => {
  const issues = validateCaptionDocument(input).filter((issue) => issue.severity === "error");
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"));
  return input.captions;
};

const validateCue = (
  cue: CaptionCueDocument,
  styleIds: ReadonlySet<string>,
  phraseIds: ReadonlySet<string>,
  wordIds: ReadonlySet<string>,
  issues: LanguageValidationIssue[],
): void => {
  if (
    cue.text.trim() === "" ||
    cue.lines.length === 0 ||
    cue.lines.some((line) => line.trim() === "") ||
    BigInt(cue.endFrameExclusive) <= BigInt(cue.startFrame) ||
    !styleIds.has(cue.styleTemplateId) ||
    (cue.phraseId !== null && !phraseIds.has(cue.phraseId)) ||
    cue.wordIds.some((id) => !wordIds.has(id))
  ) {
    issues.push(
      error("caption.cue.invalid", cue.id, "Caption cue text, timing, style, or source linkage is invalid."),
    );
  }
};

const uniqueIds = (
  ids: readonly string[],
  entityId: string,
  code: string,
  issues: LanguageValidationIssue[],
): ReadonlySet<string> => {
  const values = new Set(ids);
  if (values.size !== ids.length) issues.push(error(code, entityId, "Stable IDs must be unique."));
  return values;
};

const compareFrames = (left: string, right: string): number => {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

const error = (code: string, entityId: string, message: string): LanguageValidationIssue => ({
  severity: "error",
  code,
  entityId,
  message,
});
