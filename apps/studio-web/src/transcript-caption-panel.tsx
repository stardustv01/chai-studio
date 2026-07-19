import { useMemo, useState } from "react";
import {
  activeTranscriptPhrase,
  activeTranscriptWord,
  compareTranscriptToScript,
  evaluateCaptionQa,
  searchTranscript,
  type LanguageCommand,
} from "@chai-studio/captions";
import type {
  CaptionDocument,
  NormalizedRational,
  TranscriptDocument,
  TranscriptPhrase,
} from "@chai-studio/schema";
import { Badge, Button } from "@chai-studio/ui-components";

export const TranscriptCaptionPanel = ({
  captionDocuments,
  currentFrame,
  fps,
  onCommand,
  onMarker,
  onSelectRange,
  onSeek,
  onSplit,
  transcripts,
}: {
  readonly captionDocuments: readonly CaptionDocument[];
  readonly currentFrame: string;
  readonly fps: NormalizedRational;
  readonly onCommand: (command: LanguageCommand) => void;
  readonly onMarker: (phrase: TranscriptPhrase) => void;
  readonly onSelectRange: (startFrame: string, endFrameExclusive: string) => void;
  readonly onSeek: (frame: string) => void;
  readonly onSplit: (frame: string) => void;
  readonly transcripts: readonly TranscriptDocument[];
}) => {
  const transcript = transcripts[0] ?? null;
  const captions = captionDocuments[0] ?? null;
  const [query, setQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("all");
  const [minimumConfidence, setMinimumConfidence] = useState<number | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [selectedPhraseId, setSelectedPhraseId] = useState<string | null>(null);
  const active = transcript === null ? null : activeTranscriptPhrase(transcript, currentFrame);
  const phrases = useMemo(
    () =>
      transcript === null
        ? []
        : searchTranscript({
            transcript,
            query,
            ...(speakerFilter === "all" ? {} : { speakerId: speakerFilter }),
            minimumConfidence,
          }).map((match) => match.phrase),
    [minimumConfidence, query, speakerFilter, transcript],
  );
  const selected =
    transcript?.phrases.find((phrase) => phrase.id === selectedPhraseId) ??
    active ??
    transcript?.phrases[0] ??
    null;
  const cue =
    selected === null || captions === null
      ? null
      : (captions.cues.find((candidate) => candidate.phraseId === selected.id) ?? null);
  const style =
    cue === null || captions === null
      ? null
      : (captions.styles.find((candidate) => candidate.id === cue.styleTemplateId) ?? null);
  const qaIssues = useMemo(
    () => (captions === null ? [] : evaluateCaptionQa({ captions, fps, width: 1920, height: 1080 })),
    [captions, fps],
  );
  const activeWordId = useMemo(
    () =>
      transcript === null || cue === null
        ? null
        : (activeTranscriptWord(transcript, cue.wordIds, currentFrame)?.id ?? null),
    [cue, currentFrame, transcript],
  );
  const scriptComparison = useMemo(
    () =>
      compareTranscriptToScript(
        transcript ?? emptyTranscript,
        "Pixels cross the boundary without losing time. One scheduler keeps every engine aligned. Preview and final captions share exact cues. Corrections remain linked to source audio.",
      ),
    [transcript],
  );
  if (transcript === null || captions === null) {
    return (
      <section className="transcript-caption" aria-label="Authoritative transcript and captions">
        <div className="transcript-caption__empty">
          <strong>No linked transcript</strong>
          <span>Import validated SRT, VTT, or an internal transcript to begin.</span>
        </div>
      </section>
    );
  }
  return (
    <section className="transcript-caption" aria-label="Authoritative transcript and captions">
      <header className="transcript-caption__header">
        <div>
          <span className="eyebrow">Language authority</span>
          <strong>Transcript + captions</strong>
          <small>Source audio linked · exact half-open frames</small>
        </div>
        <div className="transcript-caption__truth">
          <Badge tone="ready">Phrase / frame linked</Badge>
          <Badge tone="info">SRT + VTT</Badge>
          <Badge>{style?.highlightMode ?? "none"} highlight</Badge>
        </div>
      </header>

      <div className="transcript-caption__toolbar">
        <label>
          <span className="sr-only">Search transcript</span>
          <input
            type="search"
            aria-label="Search transcript"
            placeholder="Search words or phrases"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </label>
        <label>
          <span className="sr-only">Filter transcript by speaker</span>
          <select
            aria-label="Filter transcript by speaker"
            value={speakerFilter}
            onChange={(event) => {
              setSpeakerFilter(event.currentTarget.value);
            }}
          >
            <option value="all">All speakers</option>
            {transcript.speakers.map((speaker) => (
              <option value={speaker.id} key={speaker.id}>
                {speaker.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter transcript by confidence</span>
          <select
            aria-label="Filter transcript by confidence"
            value={minimumConfidence ?? "all"}
            onChange={(event) => {
              setMinimumConfidence(
                event.currentTarget.value === "all" ? null : Number(event.currentTarget.value),
              );
            }}
          >
            <option value="all">All confidence</option>
            <option value="0.9">90%+</option>
            <option value="0.75">75%+</option>
          </select>
        </label>
        <span>{phrases.length} phrases</span>
        <span>{transcript.language}</span>
        <span>{transcript.direction.toUpperCase()}</span>
      </div>

      <div className="transcript-caption__body">
        <div className="phrase-list" aria-label="Transcript phrases">
          {phrases.map((phrase) => (
            <PhraseRow
              active={active?.id === phrase.id}
              selected={selected?.id === phrase.id}
              phrase={phrase}
              speakerName={
                transcript.speakers.find((speaker) => speaker.id === phrase.speakerId)?.name ?? "Unassigned"
              }
              key={phrase.id}
              onSelect={() => {
                setSelectedPhraseId(phrase.id);
                onSeek(phrase.startFrame);
                onSelectRange(phrase.startFrame, phrase.endFrameExclusive);
                onCommand({
                  kind: "language.range.select",
                  transcriptId: transcript.transcriptId,
                  phraseId: phrase.id,
                });
              }}
            />
          ))}
        </div>

        <aside className="caption-inspector" aria-label="Caption inspector">
          {selected === null ? null : (
            <>
              <div className="caption-inspector__title">
                <div>
                  <span className="eyebrow">Selected phrase</span>
                  <strong>{selected.id}</strong>
                </div>
                <Badge tone={selected.correctionState === "corrected" ? "ready" : "attention"}>
                  {selected.correctionState}
                </Badge>
              </div>
              <label className="caption-text-field">
                <span>Transcript text</span>
                <textarea
                  aria-label="Transcript phrase text"
                  disabled={selected.locked}
                  title={
                    selected.locked ? "Unlock this phrase before editing its transcript text." : undefined
                  }
                  defaultValue={selected.text}
                  key={`${selected.id}:${selected.text}`}
                  onBlur={(event) => {
                    const text = event.currentTarget.value.trim();
                    if (!selected.locked && text !== "" && text !== selected.text) {
                      onCommand({
                        kind: "transcript.phrase.update",
                        transcriptId: transcript.transcriptId,
                        phraseId: selected.id,
                        patch: { text, correctionState: "corrected" },
                      });
                    }
                  }}
                />
              </label>
              <div className="caption-inspector__actions">
                <Button
                  disabled={selected.locked}
                  title={
                    selected.locked ? "Unlock this phrase before changing its correction state." : undefined
                  }
                  onClick={() => {
                    onCommand({
                      kind: "transcript.phrase.update",
                      transcriptId: transcript.transcriptId,
                      phraseId: selected.id,
                      patch: { correctionState: "corrected" },
                    });
                  }}
                >
                  Mark corrected
                </Button>
                <Button
                  onClick={() => {
                    onCommand({
                      kind: "transcript.phrase.update",
                      transcriptId: transcript.transcriptId,
                      phraseId: selected.id,
                      patch: { locked: !selected.locked },
                    });
                  }}
                >
                  {selected.locked ? "Unlock" : "Lock"}
                </Button>
                <Button
                  onClick={() => {
                    onMarker(selected);
                  }}
                >
                  Add marker
                </Button>
                <Button
                  onClick={() => {
                    onSplit(selected.startFrame);
                  }}
                >
                  Split at phrase
                </Button>
                <Button
                  onClick={() => {
                    setComparisonOpen((open) => !open);
                  }}
                >
                  Compare script
                </Button>
              </div>
              {selected.locked ? (
                <p className="caption-lock-note" role="status">
                  Transcript phrase locked · text and correction state are read-only.
                </p>
              ) : null}
              {comparisonOpen ? (
                <div className="script-comparison" aria-live="polite">
                  <strong>Script comparison</strong>
                  <span>{scriptComparison.missingFromTranscript.length} missing</span>
                  <span>{scriptComparison.extraInTranscript.length} extra</span>
                </div>
              ) : null}
              {cue === null || style === null ? (
                <div className="caption-link-missing">No caption cue is linked to this phrase.</div>
              ) : (
                <>
                  <div className="caption-preview" aria-label="Deterministic caption preview">
                    <span
                      style={{
                        backgroundColor: style.backgroundColor,
                        color: style.fillColor,
                        fontFamily: style.fontFamily,
                        fontSize: `${String(Math.max(8, Math.min(16, style.fontSizePx / 4)))}px`,
                        fontWeight: style.fontWeight,
                        lineHeight: style.lineHeight,
                        textAlign: style.alignment,
                      }}
                    >
                      {cue.wordIds.map((wordId, index) => {
                        const word = transcript.words.find((candidate) => candidate.id === wordId);
                        if (word === undefined) return null;
                        return (
                          <span
                            className={
                              activeWordId === word.id ? "caption-word caption-word--active" : "caption-word"
                            }
                            key={word.id}
                          >
                            {index === 0 ? "" : " "}
                            {word.text}
                          </span>
                        );
                      })}
                    </span>
                    <small>
                      {cue.startFrame}–{cue.endFrameExclusive}f · {style.fontFamily} {style.fontSizePx}px
                    </small>
                  </div>
                  <fieldset
                    className="caption-style-grid"
                    disabled={cue.locked}
                    aria-label="Caption style and timing"
                  >
                    <label>
                      Font family
                      <input
                        aria-label="Caption font family"
                        defaultValue={style.fontFamily}
                        key={`${style.id}:family:${style.fontFamily}`}
                        onBlur={(event) => {
                          const fontFamily = event.currentTarget.value.trim();
                          if (fontFamily !== "" && fontFamily !== style.fontFamily) {
                            onCommand({
                              kind: "caption.style.update",
                              captionDocumentId: captions.captionDocumentId,
                              styleId: style.id,
                              patch: { fontFamily },
                            });
                          }
                        }}
                      />
                    </label>
                    <label>
                      Font size
                      <input
                        aria-label="Caption font size"
                        type="number"
                        min="8"
                        max="240"
                        value={style.fontSizePx}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { fontSizePx: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                      <small>px</small>
                    </label>
                    <label>
                      Font weight
                      <input
                        aria-label="Caption font weight"
                        type="number"
                        min="100"
                        max="900"
                        step="50"
                        value={style.fontWeight}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { fontWeight: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Line height
                      <input
                        aria-label="Caption line height"
                        type="number"
                        min="0.8"
                        max="3"
                        step="0.05"
                        value={style.lineHeight}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { lineHeight: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Text color
                      <input
                        aria-label="Caption text color"
                        defaultValue={style.fillColor}
                        key={`${style.id}:fill:${style.fillColor}`}
                        onBlur={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { fillColor: event.currentTarget.value.trim() },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Box color
                      <input
                        aria-label="Caption box color"
                        defaultValue={style.backgroundColor}
                        key={`${style.id}:box:${style.backgroundColor}`}
                        onBlur={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { backgroundColor: event.currentTarget.value.trim() },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Alignment
                      <select
                        aria-label="Caption alignment"
                        value={style.alignment}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { alignment: event.currentTarget.value as typeof style.alignment },
                          });
                        }}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      Vertical position
                      <input
                        aria-label="Caption vertical position"
                        type="number"
                        min="0"
                        max="100"
                        value={style.verticalPositionPercent}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { verticalPositionPercent: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                      <small>%</small>
                    </label>
                    <label>
                      Safe area
                      <input
                        aria-label="Caption safe area"
                        type="number"
                        min="0"
                        max="40"
                        value={style.safeAreaPercent}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { safeAreaPercent: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                      <small>%</small>
                    </label>
                    <label>
                      Max lines
                      <input
                        aria-label="Caption maximum lines"
                        type="number"
                        min="1"
                        max="6"
                        value={style.maxLines}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { maxLines: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Line length
                      <input
                        aria-label="Caption maximum line length"
                        type="number"
                        min="8"
                        max="120"
                        value={style.maxCharactersPerLine}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { maxCharactersPerLine: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                      <small>chars</small>
                    </label>
                    <label>
                      Reading speed
                      <input
                        aria-label="Caption reading speed"
                        type="number"
                        min="5"
                        max="60"
                        value={style.maxCharactersPerSecond}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: { maxCharactersPerSecond: Number(event.currentTarget.value) },
                          });
                        }}
                      />
                      <small>cps</small>
                    </label>
                    <label>
                      Highlight
                      <select
                        aria-label="Caption highlight mode"
                        value={style.highlightMode}
                        onChange={(event) => {
                          onCommand({
                            kind: "caption.style.update",
                            captionDocumentId: captions.captionDocumentId,
                            styleId: style.id,
                            patch: {
                              highlightMode: event.currentTarget.value as typeof style.highlightMode,
                            },
                          });
                        }}
                      >
                        <option value="none">None</option>
                        <option value="word">Word</option>
                        <option value="line">Line</option>
                      </select>
                    </label>
                    <label>
                      Cue in
                      <input
                        aria-label="Caption cue start frame"
                        defaultValue={cue.startFrame}
                        key={`${cue.id}:start:${cue.startFrame}`}
                        onBlur={(event) => {
                          onCommand({
                            kind: "caption.cue.update",
                            captionDocumentId: captions.captionDocumentId,
                            cueId: cue.id,
                            patch: {
                              startFrame: event.currentTarget.value as typeof cue.startFrame,
                            },
                          });
                        }}
                      />
                      <small>f</small>
                    </label>
                    <label>
                      Cue out
                      <input
                        aria-label="Caption cue end frame"
                        defaultValue={cue.endFrameExclusive}
                        key={`${cue.id}:end:${cue.endFrameExclusive}`}
                        onBlur={(event) => {
                          onCommand({
                            kind: "caption.cue.update",
                            captionDocumentId: captions.captionDocumentId,
                            cueId: cue.id,
                            patch: {
                              endFrameExclusive: event.currentTarget.value as typeof cue.endFrameExclusive,
                            },
                          });
                        }}
                      />
                      <small>f</small>
                    </label>
                  </fieldset>
                  <div className="caption-inspector__actions caption-inspector__actions--cue">
                    <Button
                      onClick={() => {
                        onCommand({
                          kind: "caption.cue.update",
                          captionDocumentId: captions.captionDocumentId,
                          cueId: cue.id,
                          patch: { locked: !cue.locked },
                        });
                      }}
                    >
                      {cue.locked ? "Unlock cue" : "Lock cue"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>
      <footer className="transcript-caption__footer">
        <span>{transcript.words.length} timed words</span>
        <span>{captions.cues.length} linked cues</span>
        <span className={qaIssues.length === 0 ? "qa-clear" : "qa-issues"}>
          {qaIssues.length === 0
            ? "Live caption checks clear"
            : `${String(qaIssues.length)} caption warnings`}
        </span>
        {qaIssues[0] === undefined ? null : <span>{qaIssues[0].code}</span>}
        <span className={qaIssues.length === 0 ? "qa-clear" : "qa-issues"}>
          {qaIssues.length === 0
            ? "Caption QA ready for delivery preflight"
            : "Delivery preflight blocked by caption QA"}
        </span>
      </footer>
    </section>
  );
};

const PhraseRow = ({
  active,
  onSelect,
  phrase,
  selected,
  speakerName,
}: {
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly phrase: TranscriptPhrase;
  readonly speakerName: string;
  readonly selected: boolean;
}) => (
  <button
    className={`phrase-row${active ? " phrase-row--active" : ""}${selected ? " phrase-row--selected" : ""}`}
    type="button"
    onClick={onSelect}
  >
    <span className="phrase-row__time">{phrase.startFrame}f</span>
    <span className="phrase-row__text">{phrase.text}</span>
    <span className="phrase-row__speaker">{speakerName}</span>
    <span className="phrase-row__confidence">
      {phrase.confidence === null ? "Reviewed" : `${String(Math.round(phrase.confidence * 100))}%`}
    </span>
    <span className={`phrase-row__state phrase-row__state--${phrase.correctionState}`}>
      {phrase.locked ? "Locked" : phrase.correctionState}
    </span>
  </button>
);

const emptyTranscript: TranscriptDocument = {
  schemaVersion: "1.0.0",
  transcriptId: "transcript-empty",
  sourceAudio: {
    assetId: "asset-empty-audio",
    streamIndex: 0,
    contentHash: "0".repeat(64),
    sampleRate: 48_000,
  },
  language: "en-US",
  direction: "auto",
  importedFrom: "internal",
  speakers: [],
  words: [],
  phrases: [],
};
