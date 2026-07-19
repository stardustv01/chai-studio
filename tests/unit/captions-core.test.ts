import { describe, expect, it } from "vitest";
import {
  activeTranscriptPhrase,
  activeTranscriptWord,
  compareTranscriptToScript,
  createCaptionArtifactBundle,
  evaluateCaptionQa,
  executeLanguageCommand,
  exportSrt,
  exportVtt,
  importInternalLanguageDocuments,
  importTimedText,
  phraseNavigationTarget,
  phraseTimelineActionPlan,
  planCaptionLayout,
  searchTranscript,
} from "../../packages/captions/src/index.js";
import { normalizeRational, serializeBigInt } from "../../packages/schema/src/index.js";

const fps = normalizeRational(30_000n, 1_001n);

describe("P17 transcript and caption core", () => {
  it("imports SRT into exact linked word, phrase, and cue authority", () => {
    const imported = fixtureImport("srt", validSrt);
    expect(imported.accepted).toBe(true);
    expect(imported.diagnostics).toEqual([]);
    expect(imported.transcript?.words[0]).toMatchObject({
      text: "Frame-exact",
      startSample: "48000",
      startFrame: "29",
      correctionState: "reviewed",
    });
    expect(imported.transcript?.phrases[0]).toMatchObject({
      captionCueId: "caption-cue-0001",
      startFrame: "29",
      endFrameExclusive: "90",
    });
    expect(imported.captions?.cues[0]).toMatchObject({
      phraseId: "transcript-phrase-0001",
      wordIds: imported.transcript?.phrases[0]?.wordIds,
    });
  });

  it("rejects malformed SRT/VTT without admitting partial authority", () => {
    const malformed = fixtureImport("srt", "1\nnot timing\nHello\n");
    expect(malformed).toMatchObject({ accepted: false, transcript: null, captions: null });
    expect(malformed.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "timed-text.cue-timing.missing",
    );
    const missingHeader = fixtureImport("vtt", "00:00:00.000 --> 00:00:01.000\nHello\n");
    expect(missingHeader.accepted).toBe(false);
    expect(missingHeader.diagnostics[0]?.code).toBe("vtt.header.missing");
    const impossibleLayout = fixtureImport(
      "srt",
      `1\n00:00:00,000 --> 00:00:01,000\n${"unbreakable".repeat(20)}\n`,
    );
    expect(impossibleLayout.accepted).toBe(false);
    expect(impossibleLayout.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "caption.text.layout-invalid",
    );
  });

  it("searches, seeks, filters, and compares at exact phrase frames", () => {
    const transcript = required(fixtureImport("srt", validSrt).transcript);
    const phrase = required(transcript.phrases[0]);
    expect(activeTranscriptPhrase(transcript, "29")?.id).toBe(phrase.id);
    expect(activeTranscriptPhrase(transcript, phrase.endFrameExclusive)?.id).not.toBe(phrase.id);
    expect(searchTranscript({ transcript, query: "audio authority" })[0]?.phrase.id).toBe(
      "transcript-phrase-0002",
    );
    expect(phraseNavigationTarget(phrase)).toEqual({
      seekFrame: phrase.startFrame,
      range: { startFrame: phrase.startFrame, endFrameExclusive: phrase.endFrameExclusive },
      selectedPhraseId: phrase.id,
    });
    expect(phraseTimelineActionPlan(phrase)).toMatchObject({
      seekFrame: phrase.startFrame,
      splitFrame: phrase.startFrame,
      marker: { frame: phrase.startFrame, label: phrase.text },
      range: { startFrame: phrase.startFrame, endFrameExclusive: phrase.endFrameExclusive },
    });
    expect(
      compareTranscriptToScript(transcript, "Frame exact captions preserve audio authority"),
    ).toMatchObject({
      missingFromTranscript: ["preserve"],
      extraInTranscript: ["stay", "linked", "is", "preserved"],
    });
  });

  it("exports deterministic SRT/VTT and creates hash-bound layer artifacts", async () => {
    const imported = fixtureImport("srt", validSrt);
    const transcript = required(imported.transcript);
    const captions = required(imported.captions);
    expect(exportSrt(captions, fps)).toContain("00:00:00,967 --> 00:00:03,003");
    expect(exportVtt(captions, fps)).toMatch(/^WEBVTT\n\ncaption-cue-0001/u);
    const input = {
      projectId: "project-caption-0001",
      revisionId: "revision-caption-0001",
      timelineId: "timeline-caption-0001",
      captions,
      transcript,
      width: 1920,
      height: 1080,
      fps,
      fontFileHashes: { "font-system-sans": "b".repeat(64) },
      glyphHashes: Object.fromEntries(captions.cues.map((cue) => [cue.id, "c".repeat(64)])),
    } as const;
    const first = await createCaptionArtifactBundle(input);
    const second = await createCaptionArtifactBundle(input);
    expect(first).toEqual(second);
    expect(first.layerPlan.identity).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.layerPlan.wordHighlightSampling).toBe("latest-start-then-stable-id");
    expect(first.layerPlan.cues[0]).toMatchObject({
      fontFileHash: "b".repeat(64),
      glyphHash: "c".repeat(64),
      highlightMode: "word",
    });
    expect(first.layerPlan.cues[0]?.wordHighlights[0]).toMatchObject({
      wordId: transcript.words[0]?.id,
      startFrame: transcript.words[0]?.startFrame,
      endFrameExclusive: transcript.words[0]?.endFrameExclusive,
    });
    expect(first.layerPlan.cues[0]?.lineHighlights).toEqual([
      {
        lineIndex: 0,
        startFrame: captions.cues[0]?.startFrame,
        endFrameExclusive: captions.cues[0]?.endFrameExclusive,
      },
    ]);
    expect(first.srt.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("reports line, reading-speed, safe layout, collision, and overlap evidence", () => {
    const captions = required(fixtureImport("srt", validSrt).captions);
    const collision = evaluateCaptionQa({
      captions,
      fps,
      width: 1920,
      height: 1080,
      collisionRegions: [{ id: "lower-third-0001", x: 0, y: 780, width: 1920, height: 300 }],
    });
    expect(collision.map((issue) => issue.code)).toContain("caption.collision");
    const tooFast = {
      ...captions,
      cues: captions.cues.map((cue, index) =>
        index === 0
          ? {
              ...cue,
              endFrameExclusive: (BigInt(cue.startFrame) + 1n).toString() as typeof cue.endFrameExclusive,
            }
          : cue,
      ),
    };
    expect(
      evaluateCaptionQa({ captions: tooFast, fps, width: 1920, height: 1080 }).map((issue) => issue.code),
    ).toEqual(expect.arrayContaining(["caption.duration.short", "caption.reading-speed.exceeded"]));
  });

  it("validates and normalizes internal documents without changing text or timing authority", () => {
    const imported = fixtureImport("srt", validSrt);
    const transcript = required(imported.transcript);
    const captions = required(imported.captions);
    const internal = importInternalLanguageDocuments({
      transcript: {
        ...transcript,
        phrases: [...transcript.phrases].reverse(),
        words: [...transcript.words].reverse(),
      },
      captions: { ...captions, cues: [...captions.cues].reverse() },
    });
    expect(internal).toMatchObject({ accepted: true, diagnostics: [] });
    expect(internal.transcript?.importedFrom).toBe("internal");
    expect(internal.transcript?.phrases.map((phrase) => phrase.text)).toEqual([
      "Frame-exact captions stay linked.",
      "Audio authority is preserved.",
    ]);
    expect(internal.captions?.cues.map((cue) => cue.startFrame)).toEqual(["29", "104"]);

    const malformed = importInternalLanguageDocuments({
      transcript: {
        ...transcript,
        phrases: transcript.phrases.map((phrase, index) =>
          index === 0 ? { ...phrase, speakerId: "speaker-missing" } : phrase,
        ),
      },
      captions,
    });
    expect(malformed.accepted).toBe(false);
    expect(malformed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("transcript.phrase.invalid");
  });

  it("keeps transcript corrections and linked caption text atomic", () => {
    const imported = fixtureImport("srt", validSrt);
    const transcript = required(imported.transcript);
    const captions = required(imported.captions);
    const timeline = {
      schemaVersion: "1.0.0",
      projectId: "project-caption-0001",
      revisionId: "revision-caption-0001",
      timelineId: "timeline-caption-0001",
      fps,
      durationFrames: serializeBigInt(300n),
      tracks: [],
      audioBusIds: [],
      approvalReferenceIds: [],
      transcripts: [transcript],
      captionDocuments: [captions],
    } as const;
    const result = executeLanguageCommand(timeline, {
      kind: "transcript.phrase.update",
      transcriptId: transcript.transcriptId,
      phraseId: "transcript-phrase-0001",
      patch: { text: "Frame-exact captions remain linked.", correctionState: "corrected" },
    });
    expect(result.timeline.transcripts?.[0]?.phrases[0]?.text).toBe("Frame-exact captions remain linked.");
    expect(
      result.timeline.transcripts?.[0]?.words
        .filter((word) => result.timeline.transcripts?.[0]?.phrases[0]?.wordIds.includes(word.id))
        .map((word) => word.text),
    ).toEqual(["Frame-exact", "captions", "remain", "linked."]);
    expect(result.timeline.captionDocuments?.[0]?.cues[0]).toMatchObject({
      text: "Frame-exact captions remain linked.",
      lines: ["Frame-exact captions remain linked."],
    });
    expect(result.affectedEntityIds).toEqual(
      expect.arrayContaining([transcript.transcriptId, captions.captionDocumentId, "caption-cue-0001"]),
    );
    expect(() =>
      executeLanguageCommand(timeline, {
        kind: "caption.style.update",
        captionDocumentId: captions.captionDocumentId,
        styleId: required(captions.styles[0]).id,
        patch: { safeAreaPercent: 99 },
      }),
    ).toThrow(/caption\.style\.invalid/u);
  });

  it("lays out Unicode and RTL captions inside the declared safe zone", () => {
    const captions = required(fixtureImport("srt", validSrt).captions);
    const cue = required(captions.cues[0]);
    const style = required(captions.styles[0]);
    const layout = planCaptionLayout({
      cue: { ...cue, text: "مرحبا بالعالم — नमस्ते दुनिया", lines: ["مرحبا بالعالم — नमस्ते दुनिया"] },
      style: { ...style, maxCharactersPerLine: 64 },
      width: 1080,
      height: 1920,
    });
    expect(layout.lines).toEqual(["مرحبا بالعالم — नमस्ते दुनिया"]);
    expect(layout.box.x).toBe(layout.safeArea.left);
    expect(layout.box.y).toBeGreaterThanOrEqual(layout.safeArea.top);
    expect(layout.box.y + layout.box.height).toBeLessThanOrEqual(layout.safeArea.bottom);
  });

  it("selects one deterministic active word when rounded frame ranges overlap", () => {
    const transcript = required(fixtureImport("srt", validSrt).transcript);
    const phrase = required(transcript.phrases[0]);
    const first = required(transcript.words.find((word) => word.id === phrase.wordIds[0]));
    const second = required(transcript.words.find((word) => word.id === phrase.wordIds[1]));
    const overlapFrame = BigInt(second.startFrame);
    expect(overlapFrame).toBeLessThan(BigInt(first.endFrameExclusive));
    expect(activeTranscriptWord(transcript, phrase.wordIds, overlapFrame.toString())?.id).toBe(second.id);
  });
});

const fixtureImport = (format: "srt" | "vtt", text: string) =>
  importTimedText({
    format,
    text,
    transcriptId: "transcript-main-0001",
    captionDocumentId: "caption-document-main-0001",
    captionTrackId: "caption-track-main-0001",
    sourceAudio: {
      assetId: "asset-voiceover-0001",
      streamIndex: 0,
      contentHash: "a".repeat(64),
      sampleRate: 48_000,
    },
    fps,
    language: "en-US",
  });

const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Fixture value is missing.");
  return value;
};

const validSrt = `1
00:00:01,000 --> 00:00:03,000
Frame-exact captions stay linked.

2
00:00:03,500 --> 00:00:06,000
Audio authority is preserved.
`;
