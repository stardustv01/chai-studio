import type {
  CaptionCueDocument,
  CaptionDocument,
  CaptionStyleTemplate,
  JsonValue,
  TimelineDocument,
  TranscriptDocument,
  TranscriptPhrase,
} from "@chai-studio/schema";
import { wrapCaptionText } from "./layout.js";
import { distributeWordSampleRanges, sampleRangeToFrameRange } from "./timing.js";
import { assertValidCaptionDocument, assertValidTranscript } from "./validation.js";

export type LanguageCommand =
  | Readonly<{ kind: "language.import.upsert"; transcript: TranscriptDocument; captions: CaptionDocument }>
  | Readonly<{
      kind: "transcript.phrase.update";
      transcriptId: string;
      phraseId: string;
      patch: Partial<Pick<TranscriptPhrase, "text" | "speakerId" | "correctionState" | "locked">>;
    }>
  | Readonly<{
      kind: "caption.cue.update";
      captionDocumentId: string;
      cueId: string;
      patch: Partial<
        Pick<
          CaptionCueDocument,
          "text" | "lines" | "startFrame" | "endFrameExclusive" | "locked" | "styleTemplateId"
        >
      >;
    }>
  | Readonly<{
      kind: "caption.cue.generate";
      captionDocumentId: string;
      transcriptId: string;
      phraseId: string;
      cue: CaptionCueDocument;
    }>
  | Readonly<{
      kind: "caption.style.update";
      captionDocumentId: string;
      styleId: string;
      patch: Partial<Omit<CaptionStyleTemplate, "id">>;
    }>
  | Readonly<{
      kind: "language.marker.from-phrase";
      transcriptId: string;
      phraseId: string;
      markerId: string;
    }>
  | Readonly<{
      kind: "language.range.select";
      transcriptId: string;
      phraseId: string;
    }>;

export interface LanguageCommandResult {
  readonly timeline: TimelineDocument;
  readonly label: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly string[];
  readonly warnings: readonly string[];
}

export const executeLanguageCommand = (
  timeline: TimelineDocument,
  command: LanguageCommand,
  revisionId = timeline.revisionId,
): LanguageCommandResult => {
  switch (command.kind) {
    case "language.import.upsert": {
      const transcript = assertValidTranscript(command.transcript);
      const captions = assertValidCaptionDocument({ captions: command.captions, transcript });
      return result(
        {
          ...timeline,
          revisionId,
          transcripts: upsert(timeline.transcripts ?? [], transcript, "transcriptId"),
          captionDocuments: upsert(timeline.captionDocuments ?? [], captions, "captionDocumentId"),
        },
        "Import transcript and captions",
        [transcript.transcriptId, captions.captionDocumentId, ...captions.cues.map((cue) => cue.id)],
      );
    }
    case "transcript.phrase.update": {
      const transcript = requireTranscript(timeline, command.transcriptId);
      const phrase = requireEntity(transcript.phrases, command.phraseId, "transcript phrase");
      if (phrase.locked && command.patch.locked !== false)
        throw new Error(`Transcript phrase ${phrase.id} is locked.`);
      const updatedTranscript = updatePhraseAuthority(transcript, phrase, command.patch, timeline.fps);
      const updatedPhrase = requireEntity(updatedTranscript.phrases, phrase.id, "transcript phrase");
      const linked = updateLinkedCaptionText(timeline, updatedTranscript, updatedPhrase, command.patch.text);
      const updatedTimeline = replaceTranscript(
        linked === null ? timeline : replaceCaptions(timeline, linked.document, revisionId),
        updatedTranscript,
        revisionId,
      );
      return result(updatedTimeline, `Update transcript phrase ${phrase.id}`, [
        transcript.transcriptId,
        phrase.id,
        ...phrase.wordIds,
        ...updatedPhrase.wordIds,
        ...(linked === null ? [] : [linked.document.captionDocumentId, linked.cueId]),
      ]);
    }
    case "caption.cue.update": {
      const captions = requireCaptionDocument(timeline, command.captionDocumentId);
      const cue = requireEntity(captions.cues, command.cueId, "caption cue");
      if (cue.locked && command.patch.locked !== false) throw new Error(`Caption cue ${cue.id} is locked.`);
      const transcript = transcriptForCaptions(timeline, captions);
      const updated = assertValidCaptionDocument({
        captions: {
          ...captions,
          cues: captions.cues.map((item) => (item.id === cue.id ? { ...item, ...command.patch } : item)),
        },
        transcript,
      });
      return result(replaceCaptions(timeline, updated, revisionId), `Update caption cue ${cue.id}`, [
        captions.captionDocumentId,
        cue.id,
      ]);
    }
    case "caption.cue.generate": {
      const captions = requireCaptionDocument(timeline, command.captionDocumentId);
      const transcript = requireTranscript(timeline, command.transcriptId);
      const phrase = requireEntity(transcript.phrases, command.phraseId, "transcript phrase");
      if (captions.cues.some((cue) => cue.id === command.cue.id))
        throw new Error(`Caption cue ${command.cue.id} already exists.`);
      if (command.cue.phraseId !== phrase.id || command.cue.transcriptId !== transcript.transcriptId) {
        throw new Error("Generated caption cue must preserve its transcript and phrase linkage.");
      }
      const updatedCaptions = assertValidCaptionDocument({
        captions: { ...captions, cues: [...captions.cues, command.cue] },
        transcript,
      });
      const updatedTranscript = assertValidTranscript({
        ...transcript,
        phrases: transcript.phrases.map((item) =>
          item.id === phrase.id ? { ...item, captionCueId: command.cue.id } : item,
        ),
      });
      return result(
        {
          ...replaceTranscript(
            replaceCaptions(timeline, updatedCaptions, revisionId),
            updatedTranscript,
            revisionId,
          ),
          revisionId,
        },
        `Generate caption from phrase ${phrase.id}`,
        [captions.captionDocumentId, transcript.transcriptId, phrase.id, command.cue.id],
      );
    }
    case "caption.style.update": {
      const captions = requireCaptionDocument(timeline, command.captionDocumentId);
      const style = requireEntity(captions.styles, command.styleId, "caption style");
      const transcript = transcriptForCaptions(timeline, captions);
      const updated = assertValidCaptionDocument({
        captions: {
          ...captions,
          styles: captions.styles.map((item) =>
            item.id === style.id ? { ...item, ...command.patch } : item,
          ),
        },
        transcript,
      });
      return result(replaceCaptions(timeline, updated, revisionId), `Update caption style ${style.name}`, [
        captions.captionDocumentId,
        style.id,
        ...captions.cues.filter((cue) => cue.styleTemplateId === style.id).map((cue) => cue.id),
      ]);
    }
    case "language.marker.from-phrase": {
      const transcript = requireTranscript(timeline, command.transcriptId);
      const phrase = requireEntity(transcript.phrases, command.phraseId, "transcript phrase");
      if ((timeline.markers ?? []).some((marker) => marker.id === command.markerId))
        throw new Error(`Marker ${command.markerId} already exists.`);
      return result(
        {
          ...timeline,
          revisionId,
          markers: [
            ...(timeline.markers ?? []),
            {
              id: command.markerId,
              frame: phrase.startFrame,
              duration: (BigInt(phrase.endFrameExclusive) - BigInt(phrase.startFrame)).toString(
                10,
              ) as typeof phrase.startFrame,
              label: phrase.text,
              category: "note",
              issueSeverity: null,
              annotationReferenceIds: [phrase.id],
              ripplePolicy: "anchored-content",
            },
          ],
        },
        `Create marker from phrase ${phrase.id}`,
        [transcript.transcriptId, phrase.id, command.markerId],
      );
    }
    case "language.range.select": {
      const transcript = requireTranscript(timeline, command.transcriptId);
      const phrase = requireEntity(transcript.phrases, command.phraseId, "transcript phrase");
      return result(
        {
          ...timeline,
          revisionId,
          selection: { primaryId: phrase.id, selectedIds: [phrase.id], anchorId: phrase.id },
          inOutRange: { startFrame: phrase.startFrame, endFrame: phrase.endFrameExclusive },
        },
        `Select transcript phrase ${phrase.id}`,
        [transcript.transcriptId, phrase.id],
      );
    }
  }
};

export const executeLanguageDocumentEdit = (
  timeline: TimelineDocument,
  operation: JsonValue,
  revisionId: string,
): LanguageCommandResult => executeLanguageCommand(timeline, parseLanguageCommand(operation), revisionId);

const parseLanguageCommand = (operation: JsonValue): LanguageCommand => {
  if (!isJsonObject(operation)) {
    throw new Error("Language edit operation must be an object.");
  }
  const kind = operation.kind;
  if (
    kind !== "language.import.upsert" &&
    kind !== "transcript.phrase.update" &&
    kind !== "caption.cue.update" &&
    kind !== "caption.cue.generate" &&
    kind !== "caption.style.update" &&
    kind !== "language.marker.from-phrase" &&
    kind !== "language.range.select"
  ) {
    throw new Error(`Unsupported language edit operation: ${typeof kind === "string" ? kind : "missing"}.`);
  }
  return operation as unknown as LanguageCommand;
};

const isJsonObject = (value: JsonValue): value is Readonly<Record<string, JsonValue>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const replaceTranscript = (
  timeline: TimelineDocument,
  transcript: TranscriptDocument,
  revisionId: string,
): TimelineDocument => ({
  ...timeline,
  revisionId,
  transcripts: (timeline.transcripts ?? []).map((item) =>
    item.transcriptId === transcript.transcriptId ? transcript : item,
  ),
});

const replaceCaptions = (
  timeline: TimelineDocument,
  captions: CaptionDocument,
  revisionId: string,
): TimelineDocument => ({
  ...timeline,
  revisionId,
  captionDocuments: (timeline.captionDocuments ?? []).map((item) =>
    item.captionDocumentId === captions.captionDocumentId ? captions : item,
  ),
});

const transcriptForCaptions = (
  timeline: TimelineDocument,
  captions: CaptionDocument,
): TranscriptDocument | null =>
  captions.transcriptId === null ? null : requireTranscript(timeline, captions.transcriptId);

const updateLinkedCaptionText = (
  timeline: TimelineDocument,
  transcript: TranscriptDocument,
  phrase: TranscriptPhrase,
  text: string | undefined,
): Readonly<{ document: CaptionDocument; cueId: string }> | null => {
  if (text === undefined || phrase.captionCueId === null) return null;
  const captions = (timeline.captionDocuments ?? []).find((document) =>
    document.cues.some((cue) => cue.id === phrase.captionCueId),
  );
  if (captions === undefined) {
    throw new Error(`Linked caption cue ${phrase.captionCueId} is missing.`);
  }
  const cue = requireEntity(captions.cues, phrase.captionCueId, "caption cue");
  if (cue.locked) throw new Error(`Linked caption cue ${cue.id} is locked.`);
  const style = requireEntity(captions.styles, cue.styleTemplateId, "caption style");
  const lines = wrapCaptionText(text, style.maxCharactersPerLine, style.maxLines);
  const document = assertValidCaptionDocument({
    captions: {
      ...captions,
      cues: captions.cues.map((item) =>
        item.id === cue.id ? { ...item, text, lines, wordIds: phrase.wordIds } : item,
      ),
    },
    transcript,
  });
  return { document, cueId: cue.id };
};

const updatePhraseAuthority = (
  transcript: TranscriptDocument,
  phrase: TranscriptPhrase,
  patch: Partial<Pick<TranscriptPhrase, "text" | "speakerId" | "correctionState" | "locked">>,
  fps: TimelineDocument["fps"],
): TranscriptDocument => {
  if (patch.text === undefined) {
    return assertValidTranscript({
      ...transcript,
      phrases: transcript.phrases.map((item) => (item.id === phrase.id ? { ...item, ...patch } : item)),
    });
  }
  const tokens = patch.text.trim().split(/\s+/u);
  if (tokens.length === 0) throw new Error("Transcript phrase text cannot be empty.");
  const oldWords = phrase.wordIds.map((wordId) => requireEntity(transcript.words, wordId, "transcript word"));
  if (oldWords.some((word) => word.locked)) {
    throw new Error(`Transcript phrase ${phrase.id} contains locked words.`);
  }
  const firstWord = oldWords[0];
  const lastWord = oldWords.at(-1);
  if (firstWord === undefined || lastWord === undefined) {
    throw new Error(`Transcript phrase ${phrase.id} has no timed words.`);
  }
  const replacementWords =
    tokens.length === oldWords.length
      ? oldWords.map((word, index) => ({
          ...word,
          text: tokens[index] ?? word.text,
          correctionState: "corrected" as const,
        }))
      : distributeWordSampleRanges(firstWord.startSample, lastWord.endSampleExclusive, tokens.length).map(
          (sampleRange, index) => ({
            id: `${phrase.id}-word-edit-${String(index + 1).padStart(3, "0")}`,
            text: tokens[index] ?? "",
            ...sampleRange,
            ...sampleRangeToFrameRange({
              ...sampleRange,
              sampleRate: transcript.sourceAudio.sampleRate,
              fps,
            }),
            confidence: null,
            correctionState: "corrected" as const,
            locked: false,
          }),
        );
  const removedIds = new Set(phrase.wordIds);
  const replacementPhrase: TranscriptPhrase = {
    ...phrase,
    ...patch,
    text: patch.text.trim(),
    wordIds: replacementWords.map((word) => word.id),
    correctionState: patch.correctionState ?? "corrected",
  };
  return assertValidTranscript({
    ...transcript,
    words: [...transcript.words.filter((word) => !removedIds.has(word.id)), ...replacementWords],
    phrases: transcript.phrases.map((item) => (item.id === phrase.id ? replacementPhrase : item)),
  });
};

const requireTranscript = (timeline: TimelineDocument, id: string): TranscriptDocument =>
  requireEntity(timeline.transcripts ?? [], id, "transcript", "transcriptId");

const requireCaptionDocument = (timeline: TimelineDocument, id: string): CaptionDocument =>
  requireEntity(timeline.captionDocuments ?? [], id, "caption document", "captionDocumentId");

const requireEntity = <T extends object, K extends keyof T>(
  values: readonly T[],
  id: string,
  kind: string,
  key: K = "id" as K,
): T => {
  const value = values.find((item) => item[key] === id);
  if (value === undefined) throw new Error(`Unknown ${kind}: ${id}.`);
  return value;
};

const upsert = <T extends object>(values: readonly T[], value: T, key: keyof T): readonly T[] =>
  values.some((item) => item[key] === value[key])
    ? values.map((item) => (item[key] === value[key] ? value : item))
    : [...values, value];

const result = (
  timeline: TimelineDocument,
  label: string,
  affectedEntityIds: readonly string[],
): LanguageCommandResult => ({
  timeline,
  label,
  diffSummary: `${label}; transcript and caption source linkage remains authoritative.`,
  affectedEntityIds: [...new Set(affectedEntityIds)],
  warnings: [],
});
