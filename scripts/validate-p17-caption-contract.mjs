import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  [
    "P17.01",
    "packages/schema/src/project-documents.ts",
    [
      "TranscriptSourceAudio",
      "TranscriptSpeaker",
      "TranscriptWord",
      "TranscriptPhrase",
      "TranscriptDocument",
      "confidence",
      "correctionState",
      "locked",
      "startSample",
      "endSampleExclusive",
    ],
  ],
  [
    "P17.01",
    "packages/captions/src/timing.ts",
    ["millisecondsToLanguageRange", "distributeWordSampleRanges", "sampleRangeToFrameRange"],
  ],
  [
    "P17.02",
    "packages/captions/src/import.ts",
    [
      "importTimedText",
      "importInternalLanguageDocuments",
      "parseTimedText",
      "caption.text.layout-invalid",
      "exportSrt",
      "exportVtt",
    ],
  ],
  [
    "P17.03",
    "packages/captions/src/navigation.ts",
    [
      "searchTranscript",
      "activeTranscriptPhrase",
      "activeTranscriptWord",
      "adjacentTranscriptPhrase",
      "phraseNavigationTarget",
      "compareTranscriptToScript",
      "speakerId",
      "minimumConfidence",
    ],
  ],
  [
    "P17.04",
    "packages/captions/src/commands.ts",
    [
      "language.marker.from-phrase",
      "language.range.select",
      "caption.cue.generate",
      "transcript.phrase.update",
      "updatePhraseAuthority",
      "updateLinkedCaptionText",
    ],
  ],
  [
    "P17.04",
    "tests/integration/transcript-timeline-actions.test.ts",
    ["phraseTimelineActionPlan", "clips.split", "range.set", "marker.add", "inverse"],
  ],
  [
    "P17.05",
    "packages/schema/src/project-documents.ts",
    [
      "CaptionStyleTemplate",
      "CaptionCueDocument",
      "CaptionDocument",
      "styleTemplateId",
      "wordIds",
      "captionDocuments",
    ],
  ],
  [
    "P17.06",
    "apps/studio-web/src/transcript-caption-panel.tsx",
    [
      "Caption inspector",
      "Caption font family",
      "Caption box color",
      "Caption alignment",
      "Caption safe area",
      "Caption maximum lines",
      "Caption maximum line length",
      "Caption reading speed",
      "Caption highlight mode",
      "Caption cue start frame",
      "Caption cue end frame",
    ],
  ],
  [
    "P17.07",
    "packages/captions/src/qa.ts",
    [
      "caption.duration.short",
      "caption.reading-speed.exceeded",
      "caption.line-limit.exceeded",
      "caption.collision",
      "caption.overlap",
    ],
  ],
  [
    "P17.07",
    "packages/captions/src/layout.ts",
    ["safeArea", "collisionRegionIds", "wrapCaptionText", "rectanglesOverlap"],
  ],
  [
    "P17.08",
    "packages/captions/src/artifacts.ts",
    [
      "caption-layer-plan",
      "wordHighlightSampling",
      "latest-start-then-stable-id",
      "wordHighlights",
      "lineHighlights",
      "fontFileHash",
      "glyphHash",
      "qaAnchors",
      "contentHash",
    ],
  ],
  [
    "P17.09",
    "apps/studio-web/src/workspace-content.tsx",
    [
      "source-transcript",
      "TranscriptCaptionPanel",
      "splitTimelineAtPhrase",
      "range.set",
      "marker.add",
      "seek-frame",
    ],
  ],
  [
    "P17.09",
    "apps/studio-web/src/use-studio-runtime.ts",
    ["language-local", "dispatchLanguageCommand", "language.edit", "captionDocuments", "transcripts"],
  ],
  [
    "P17.10",
    "tests/e2e/transcript-caption.spec.ts",
    [
      "Filter transcript by speaker",
      "Filter transcript by confidence",
      "timeline remains frame 470",
      "Deterministic caption preview",
      "Split at phrase",
    ],
  ],
];

const results = [];
for (const [task, file, symbols] of checks) {
  let content = "";
  let exists = true;
  try {
    content = await readFile(path.join(root, file), "utf8");
  } catch {
    exists = false;
  }
  const missingSymbols = symbols.filter((symbol) => !content.includes(symbol));
  results.push({ task, file, passed: exists && missingSymbols.length === 0, exists, missingSymbols });
}

for (const file of [
  "tests/unit/captions-core.test.ts",
  "tests/property/caption-timing.property.test.ts",
  "tests/integration/language-document-command.test.ts",
  "tests/integration/transcript-timeline-actions.test.ts",
  "tests/e2e/transcript-caption.spec.ts",
]) {
  let exists = true;
  try {
    await access(path.join(root, file));
  } catch {
    exists = false;
  }
  results.push({ task: "P17.10", file, passed: exists, exists, missingSymbols: [] });
}

const visualDirectory = path.join(root, "tests/e2e/studio-visual.spec.ts-snapshots");
let visualFiles;
try {
  visualFiles = (await readdir(visualDirectory)).filter((file) => file.endsWith("-darwin.png")).sort();
} catch {
  visualFiles = [];
}
const requiredVisual = "p17-transcript-caption-system-darwin.png";
results.push({
  task: "P17.10",
  file: path.relative(root, visualDirectory),
  passed: visualFiles.includes(requiredVisual),
  exists: visualFiles.length > 0,
  missingSymbols: visualFiles.includes(requiredVisual) ? [] : [requiredVisual],
  p17VisualCount: visualFiles.includes(requiredVisual) ? 1 : 0,
});

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ passed, taskCount: 10, checks: results }, null, 2));
if (!passed) process.exitCode = 1;
