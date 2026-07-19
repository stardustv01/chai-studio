import type {
  BigIntString,
  CaptionDocument,
  CaptionStyleTemplate,
  NormalizedRational,
  TranscriptDocument,
  TranscriptPhrase,
  TranscriptWord,
} from "@chai-studio/schema";
import {
  distributeWordSampleRanges,
  millisecondsToLanguageRange,
  sampleRangeToFrameRange,
} from "./timing.js";
import { wrapCaptionText } from "./layout.js";
import { validateCaptionDocument, validateTranscript } from "./validation.js";

export interface TimedTextImportDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly cueIndex: number | null;
  readonly message: string;
}

export interface TimedTextImportRequest {
  readonly format: "srt" | "vtt";
  readonly text: string;
  readonly transcriptId: string;
  readonly captionDocumentId: string;
  readonly captionTrackId: string;
  readonly sourceAudio: TranscriptDocument["sourceAudio"];
  readonly fps: NormalizedRational;
  readonly language: string;
  readonly direction?: TranscriptDocument["direction"];
  readonly style?: CaptionStyleTemplate;
}

export interface TimedTextImportResult {
  readonly accepted: boolean;
  readonly transcript: TranscriptDocument | null;
  readonly captions: CaptionDocument | null;
  readonly diagnostics: readonly TimedTextImportDiagnostic[];
}

export interface InternalLanguageImportRequest {
  readonly transcript: TranscriptDocument;
  readonly captions: CaptionDocument;
}

interface ParsedCue {
  readonly sourceIndex: number;
  readonly startMilliseconds: bigint;
  readonly endMillisecondsExclusive: bigint;
  readonly text: string;
}

export const defaultCaptionStyle = (id = "caption-style-default"): CaptionStyleTemplate => ({
  id,
  name: "Editorial clean",
  fontAssetId: "font-system-sans",
  fontFamily: "Inter",
  fontSizePx: 56,
  fontWeight: 650,
  lineHeight: 1.18,
  fillColor: "#FFFFFFFF",
  backgroundColor: "#111722D9",
  alignment: "center",
  verticalPositionPercent: 84,
  safeAreaPercent: 8,
  maxLines: 2,
  maxCharactersPerLine: 42,
  maxCharactersPerSecond: 20,
  highlightMode: "word",
});

export const importTimedText = (request: TimedTextImportRequest): TimedTextImportResult => {
  const parsed = parseTimedText(request.format, request.text);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { accepted: false, transcript: null, captions: null, diagnostics: parsed.diagnostics };
  }
  const words: TranscriptWord[] = [];
  const phrases: TranscriptPhrase[] = [];
  const style = request.style ?? defaultCaptionStyle();
  const layoutDiagnostics = parsed.cues.flatMap((cue) => {
    try {
      wrapCaptionText(cue.text, style.maxCharactersPerLine, style.maxLines);
      return [];
    } catch (cause: unknown) {
      return [
        {
          severity: "error" as const,
          code: "caption.text.layout-invalid",
          cueIndex: cue.sourceIndex,
          message: cause instanceof Error ? cause.message : "Caption text layout is invalid.",
        },
      ];
    }
  });
  if (layoutDiagnostics.length > 0) {
    return {
      accepted: false,
      transcript: null,
      captions: null,
      diagnostics: [...parsed.diagnostics, ...layoutDiagnostics],
    };
  }
  const cues = parsed.cues.map((cue, index) => {
    const ordinal = String(index + 1).padStart(4, "0");
    const cueId = `caption-cue-${ordinal}`;
    const phraseId = `transcript-phrase-${ordinal}`;
    const timing = millisecondsToLanguageRange({
      startMilliseconds: cue.startMilliseconds,
      endMillisecondsExclusive: cue.endMillisecondsExclusive,
      sampleRate: request.sourceAudio.sampleRate,
      fps: request.fps,
    });
    const tokens = cue.text.split(/\s+/u).filter((token) => token !== "");
    const sampleRanges = distributeWordSampleRanges(
      timing.startSample,
      timing.endSampleExclusive,
      tokens.length,
    );
    const wordIds = tokens.map((token, wordIndex) => {
      const wordId = `transcript-word-${ordinal}-${String(wordIndex + 1).padStart(3, "0")}`;
      const sampleRange = sampleRanges[wordIndex];
      if (sampleRange === undefined) throw new Error("Word timing distribution failed.");
      const frameRange = sampleRangeToFrameRange({
        ...sampleRange,
        sampleRate: request.sourceAudio.sampleRate,
        fps: request.fps,
      });
      words.push({
        id: wordId,
        text: token,
        ...sampleRange,
        ...frameRange,
        confidence: null,
        correctionState: "reviewed",
        locked: false,
      });
      return wordId;
    });
    phrases.push({
      id: phraseId,
      speakerId: null,
      wordIds,
      text: cue.text,
      startFrame: timing.startFrame,
      endFrameExclusive: timing.endFrameExclusive,
      confidence: null,
      correctionState: "reviewed",
      locked: false,
      captionCueId: cueId,
    });
    return {
      id: cueId,
      trackId: request.captionTrackId,
      transcriptId: request.transcriptId,
      phraseId,
      startFrame: timing.startFrame,
      endFrameExclusive: timing.endFrameExclusive,
      text: cue.text,
      lines: wrapCaptionText(cue.text, style.maxCharactersPerLine, style.maxLines),
      speakerId: null,
      wordIds,
      locked: false,
      styleTemplateId: style.id,
    };
  });
  const transcript: TranscriptDocument = {
    schemaVersion: "1.0.0",
    transcriptId: request.transcriptId,
    sourceAudio: request.sourceAudio,
    language: request.language,
    direction: request.direction ?? "auto",
    importedFrom: request.format,
    speakers: [],
    words,
    phrases,
  };
  const captions: CaptionDocument = {
    schemaVersion: "1.0.0",
    captionDocumentId: request.captionDocumentId,
    transcriptId: request.transcriptId,
    styles: [style],
    cues,
  };
  const diagnostics = [
    ...parsed.diagnostics,
    ...validateTranscript(transcript).map(toImportDiagnostic),
    ...validateCaptionDocument({ captions, transcript }).map(toImportDiagnostic),
  ];
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { accepted: false, transcript: null, captions: null, diagnostics }
    : { accepted: true, transcript, captions, diagnostics };
};

export const importInternalLanguageDocuments = (
  request: InternalLanguageImportRequest,
): TimedTextImportResult => {
  const transcript: TranscriptDocument = {
    ...request.transcript,
    importedFrom: "internal",
    speakers: [...request.transcript.speakers].sort((left, right) => left.id.localeCompare(right.id, "en")),
    words: [...request.transcript.words].sort(compareTimedEntity),
    phrases: [...request.transcript.phrases].sort(compareTimedEntity),
  };
  const captions: CaptionDocument = {
    ...request.captions,
    styles: [...request.captions.styles].sort((left, right) => left.id.localeCompare(right.id, "en")),
    cues: [...request.captions.cues].sort(compareTimedEntity),
  };
  const diagnostics = [
    ...validateTranscript(transcript).map(toImportDiagnostic),
    ...validateCaptionDocument({ captions, transcript }).map(toImportDiagnostic),
  ];
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { accepted: false, transcript: null, captions: null, diagnostics }
    : { accepted: true, transcript, captions, diagnostics };
};

export const exportSrt = (captions: CaptionDocument, fps: NormalizedRational): string =>
  captions.cues
    .map((cue, index) => {
      const start = frameToMilliseconds(BigInt(cue.startFrame), fps, false);
      const end = frameToMilliseconds(BigInt(cue.endFrameExclusive), fps, true);
      return `${String(index + 1)}\n${formatTimestamp(start, ",")} --> ${formatTimestamp(end, ",")}\n${cue.lines.join("\n")}`;
    })
    .join("\n\n")
    .concat("\n");

export const exportVtt = (captions: CaptionDocument, fps: NormalizedRational): string =>
  `WEBVTT\n\n${captions.cues
    .map((cue) => {
      const start = frameToMilliseconds(BigInt(cue.startFrame), fps, false);
      const end = frameToMilliseconds(BigInt(cue.endFrameExclusive), fps, true);
      return `${cue.id}\n${formatTimestamp(start, ".")} --> ${formatTimestamp(end, ".")}\n${cue.lines.join("\n")}`;
    })
    .join("\n\n")}\n`;

const parseTimedText = (
  format: "srt" | "vtt",
  input: string,
): Readonly<{ cues: readonly ParsedCue[]; diagnostics: readonly TimedTextImportDiagnostic[] }> => {
  const normalized = input
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const diagnostics: TimedTextImportDiagnostic[] = [];
  if (format === "vtt" && !normalized.startsWith("WEBVTT")) {
    diagnostics.push({
      severity: "error",
      code: "vtt.header.missing",
      cueIndex: null,
      message: "WEBVTT header is required.",
    });
  }
  const body = format === "vtt" ? normalized.replace(/^WEBVTT[^\n]*\n/u, "") : normalized;
  const blocks = body
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block !== "");
  const cues: ParsedCue[] = [];
  blocks.forEach((block, blockIndex) => {
    if (format === "vtt" && /^(NOTE|STYLE|REGION)(?:\s|$)/u.test(block)) return;
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      diagnostics.push({
        severity: "error",
        code: "timed-text.cue-timing.missing",
        cueIndex: blockIndex,
        message: "Cue has no timing line.",
      });
      return;
    }
    const timing = lines[timingIndex];
    if (timing === undefined) return;
    const [startText, endWithSettings] = timing.split("-->").map((value) => value.trim());
    const endText = endWithSettings?.split(/\s+/u)[0];
    const start = startText === undefined ? null : parseTimestamp(startText);
    const end = endText === undefined ? null : parseTimestamp(endText);
    const textLines = lines.slice(timingIndex + 1).map((line) => stripTimedTextMarkup(line));
    const text = textLines.join(" ").replace(/\s+/gu, " ").trim();
    if (start === null || end === null || end <= start || text === "") {
      diagnostics.push({
        severity: "error",
        code: "timed-text.cue.invalid",
        cueIndex: blockIndex,
        message: "Cue timing must be ordered and text must be non-empty.",
      });
      return;
    }
    cues.push({
      sourceIndex: blockIndex,
      startMilliseconds: start,
      endMillisecondsExclusive: end,
      text,
    });
  });
  if (cues.length === 0)
    diagnostics.push({
      severity: "error",
      code: "timed-text.empty",
      cueIndex: null,
      message: "No valid cues were found.",
    });
  return { cues, diagnostics };
};

const compareTimedEntity = <T extends { readonly id: string; readonly startFrame: BigIntString }>(
  left: T,
  right: T,
): number => {
  const difference = BigInt(left.startFrame) - BigInt(right.startFrame);
  return difference < 0n ? -1 : difference > 0n ? 1 : left.id.localeCompare(right.id, "en");
};

const parseTimestamp = (value: string): bigint | null => {
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{3})$/u.exec(value);
  if (match === null) return null;
  const hours = BigInt(match[1] ?? "0");
  const minutes = BigInt(match[2] ?? "0");
  const seconds = BigInt(match[3] ?? "0");
  const milliseconds = BigInt(match[4] ?? "0");
  if (minutes >= 60n || seconds >= 60n) return null;
  return ((hours * 60n + minutes) * 60n + seconds) * 1_000n + milliseconds;
};

const stripTimedTextMarkup = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();

const frameToMilliseconds = (frame: bigint, fps: NormalizedRational, ceiling: boolean): bigint => {
  const numerator = frame * BigInt(fps.denominator) * 1_000n;
  const denominator = BigInt(fps.numerator);
  return ceiling ? (numerator + denominator - 1n) / denominator : numerator / denominator;
};

const formatTimestamp = (milliseconds: bigint, separator: "," | "."): string => {
  const hours = milliseconds / 3_600_000n;
  const remainder = milliseconds % 3_600_000n;
  const minutes = remainder / 60_000n;
  const seconds = (remainder % 60_000n) / 1_000n;
  const fraction = remainder % 1_000n;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}${separator}${fraction.toString().padStart(3, "0")}`;
};

const toImportDiagnostic = (issue: {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
}): TimedTextImportDiagnostic => ({ ...issue, cueIndex: null });

export const bigintString = (value: string): BigIntString => value as BigIntString;
