import { createHash } from "node:crypto";
import { compareRationals, deserializeRational, parseBigIntString } from "./rational.js";
import {
  validateProjectDocument,
  type ApprovalStateDocument,
  type AssetsDocument,
  type ChaiProjectDocument,
  type ProjectDocumentKind,
  type SettingsDocument,
  type TimelineClip,
  type TimelineDocument,
  type TransactionDocument,
} from "./project-documents.js";

export interface ProjectRevisionSnapshot {
  readonly project: ChaiProjectDocument;
  readonly timeline: TimelineDocument;
  readonly assets: AssetsDocument;
  readonly settings: SettingsDocument;
  readonly transaction: TransactionDocument;
  readonly approvalState: ApprovalStateDocument;
}

export interface SemanticValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly entityId: string;
  readonly path: string;
  readonly message: string;
  readonly repairHint: string;
}

export interface ProjectValidationReport {
  readonly passed: boolean;
  readonly issues: readonly SemanticValidationIssue[];
}

const allowedQaTransitions = new Set([
  "null->rendered_unchecked",
  "rendered_unchecked->rendered_unchecked",
  "qa_failed->rendered_unchecked",
  "qa_warning->rendered_unchecked",
  "qa_passed->rendered_unchecked",
  "approved->rendered_unchecked",
  "delivered->rendered_unchecked",
  "rendered_unchecked->qa_failed",
  "rendered_unchecked->qa_warning",
  "rendered_unchecked->qa_passed",
  "qa_warning->approved",
  "qa_passed->approved",
  "approved->delivered",
]);

export const validateProjectSnapshot = (snapshot: ProjectRevisionSnapshot): ProjectValidationReport => {
  const issues: SemanticValidationIssue[] = [];
  validateStructures(snapshot, issues);
  if (issues.some((issue) => issue.severity === "error")) return report(issues);

  const roots = [
    snapshot.project,
    snapshot.timeline,
    snapshot.assets,
    snapshot.settings,
    snapshot.approvalState,
  ];
  for (const root of roots) {
    if (root.projectId !== snapshot.project.projectId) {
      issues.push(
        issue(
          "error",
          "project.identity.mismatch",
          root.projectId,
          "/projectId",
          "Document project IDs disagree.",
          "Use the owning project's stable ID in every coordinated document.",
        ),
      );
    }
    if (root.revisionId !== snapshot.project.revisionId) {
      issues.push(
        issue(
          "error",
          "revision.identity.mismatch",
          root.projectId,
          "/revisionId",
          "Document revision IDs disagree.",
          "Rewrite the candidate as one coordinated revision; never mix revision files.",
        ),
      );
    }
  }

  if (snapshot.transaction.resultingRevisionId !== snapshot.project.revisionId) {
    issues.push(
      issue(
        "error",
        "transaction.result-revision.mismatch",
        snapshot.transaction.transactionId,
        "/resultingRevisionId",
        "Transaction result does not name the candidate revision.",
        "Set resultingRevisionId to the coordinated revision ID.",
      ),
    );
  }
  if (snapshot.project.activeTimelineId !== snapshot.timeline.timelineId) {
    issues.push(
      issue(
        "error",
        "timeline.active.missing",
        snapshot.project.projectId,
        "/activeTimelineId",
        "The active timeline does not exist in this revision.",
        "Point activeTimelineId at the coordinated timeline document.",
      ),
    );
  }

  validatePositiveNormalizedRate(
    snapshot.project.video.fps,
    snapshot.project.projectId,
    "/video/fps",
    issues,
  );
  validatePositiveNormalizedRate(snapshot.timeline.fps, snapshot.timeline.timelineId, "/fps", issues);
  if (compareRationals(snapshot.project.video.fps, snapshot.timeline.fps) !== 0) {
    issues.push(
      issue(
        "error",
        "timeline.fps.mismatch",
        snapshot.timeline.timelineId,
        "/fps",
        "Project and timeline master rates disagree.",
        "Use one normalized authoritative master rate for the revision.",
      ),
    );
  }

  validateEntityUniqueness(snapshot, issues);
  validateTimeline(snapshot, issues);
  validateAudioGraph(snapshot, issues);
  validateLanguageDocuments(snapshot, issues);
  validateAnnotations(snapshot, issues);
  validateSources(snapshot.project, issues);
  validateApproval(snapshot.approvalState, issues);
  if (Date.parse(snapshot.project.updatedAt) < Date.parse(snapshot.project.createdAt)) {
    issues.push(
      issue(
        "error",
        "project.timestamp.order",
        snapshot.project.projectId,
        "/updatedAt",
        "Project update time precedes creation time.",
        "Preserve monotonic project timestamps.",
      ),
    );
  }
  return report(issues);
};

const validateAudioGraph = (snapshot: ProjectRevisionSnapshot, issues: SemanticValidationIssue[]): void => {
  const graph = snapshot.timeline.audioGraph;
  if (graph === undefined) {
    issues.push(
      issue(
        "warning",
        "audio.graph.missing",
        snapshot.timeline.timelineId,
        "/audioGraph",
        "This legacy timeline has no authoritative audio graph.",
        "Create the P16 audio graph before audio preview or final mix.",
      ),
    );
    return;
  }
  if (
    graph.sampleRate !== snapshot.project.audio.sampleRate ||
    graph.channelLayout !== snapshot.project.audio.channelLayout
  ) {
    issues.push(
      issue(
        "error",
        "audio.graph.project-format-mismatch",
        graph.graphId,
        "/audioGraph",
        "Audio graph sample rate or channel layout disagrees with the project.",
        "Use the project audio format as the graph output format.",
      ),
    );
  }
  const buses = new Map(graph.buses.map((bus) => [bus.id, bus]));
  const sources = new Map(graph.sources.map((source) => [source.id, source]));
  const timelineClipIds = new Set(
    snapshot.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
  );
  const assetById = new Map(snapshot.assets.assets.map((asset) => [asset.id, asset]));
  const master = buses.get(graph.masterBusId);
  if (master?.kind !== "master" || master.parentBusId !== null) {
    issues.push(
      issue(
        "error",
        "audio.graph.master-invalid",
        graph.masterBusId,
        "/audioGraph/masterBusId",
        "The audio graph has no valid root master bus.",
        "Point masterBusId to the single parentless master bus.",
      ),
    );
  }
  for (const source of graph.sources) {
    const asset = assetById.get(source.assetId);
    if (!asset?.hasAudio) {
      issues.push(
        issue(
          "error",
          "audio.source.asset-invalid",
          source.id,
          "/audioGraph/sources",
          "An audio graph source does not reference an audio-bearing registered asset.",
          "Register and inspect the audio asset before adding it to the graph.",
        ),
      );
    }
  }
  for (const clip of graph.clips) {
    if (!timelineClipIds.has(clip.timelineClipId) || !sources.has(clip.sourceId) || !buses.has(clip.busId)) {
      issues.push(
        issue(
          "error",
          "audio.clip.reference-invalid",
          clip.id,
          "/audioGraph/clips",
          "An audio graph clip has a stale timeline, source, or bus reference.",
          "Repair every audio clip reference atomically.",
        ),
      );
    }
  }
};

const validateLanguageDocuments = (
  snapshot: ProjectRevisionSnapshot,
  issues: SemanticValidationIssue[],
): void => {
  const transcripts = snapshot.timeline.transcripts ?? [];
  const captionDocuments = snapshot.timeline.captionDocuments ?? [];
  const transcriptById = new Map(transcripts.map((transcript) => [transcript.transcriptId, transcript]));
  const assets = new Map(snapshot.assets.assets.map((asset) => [asset.id, asset]));
  const tracks = new Map(snapshot.timeline.tracks.map((track) => [track.id, track]));
  const timelineDuration = parseBigIntString(snapshot.timeline.durationFrames);

  for (const transcript of transcripts) {
    const asset = assets.get(transcript.sourceAudio.assetId);
    if (
      asset?.hasAudio !== true ||
      asset.contentHash !== transcript.sourceAudio.contentHash ||
      transcript.sourceAudio.sampleRate !== snapshot.project.audio.sampleRate
    ) {
      issues.push(
        issue(
          "error",
          "transcript.source-audio.invalid",
          transcript.transcriptId,
          "/transcripts/sourceAudio",
          "Transcript source audio is missing or disagrees with the registered project audio identity.",
          "Bind the transcript to an inspected audio asset, exact content hash, stream, and project sample rate.",
        ),
      );
    }
    const speakers = new Set(transcript.speakers.map((speaker) => speaker.id));
    const words = new Map(transcript.words.map((word) => [word.id, word]));
    if (words.size !== transcript.words.length) {
      issues.push(
        issue(
          "error",
          "transcript.word-id.duplicate",
          transcript.transcriptId,
          "/transcripts/words",
          "Transcript word IDs are not unique.",
          "Assign a stable unique ID to every word.",
        ),
      );
    }
    for (const word of transcript.words) {
      const startFrame = parseBigIntString(word.startFrame);
      const endFrame = parseBigIntString(word.endFrameExclusive);
      const startSample = parseBigIntString(word.startSample);
      const endSample = parseBigIntString(word.endSampleExclusive);
      const mappedStart = frameToSample(
        startFrame,
        snapshot.timeline.fps,
        transcript.sourceAudio.sampleRate,
        false,
      );
      const mappedEnd = frameToSample(
        endFrame,
        snapshot.timeline.fps,
        transcript.sourceAudio.sampleRate,
        true,
      );
      if (
        endFrame <= startFrame ||
        endFrame > timelineDuration ||
        endSample <= startSample ||
        startSample < mappedStart ||
        endSample > mappedEnd
      ) {
        issues.push(
          issue(
            "error",
            "transcript.word-timing.invalid",
            word.id,
            "/transcripts/words",
            "Word sample timing is non-empty and must remain inside its exact half-open frame envelope.",
            "Recompute word frame bounds from exact rational sample mapping.",
          ),
        );
      }
    }
    for (const phrase of transcript.phrases) {
      const phraseWords = phrase.wordIds.map((id) => words.get(id));
      if (
        phraseWords.some((word) => word === undefined) ||
        (phrase.speakerId !== null && !speakers.has(phrase.speakerId)) ||
        parseBigIntString(phrase.endFrameExclusive) <= parseBigIntString(phrase.startFrame)
      ) {
        issues.push(
          issue(
            "error",
            "transcript.phrase.reference-invalid",
            phrase.id,
            "/transcripts/phrases",
            "Phrase timing, speaker, or word references are invalid.",
            "Keep phrase references within one transcript and use a non-empty half-open frame range.",
          ),
        );
      }
    }
  }

  for (const captions of captionDocuments) {
    const transcript = captions.transcriptId === null ? undefined : transcriptById.get(captions.transcriptId);
    const styles = new Set(captions.styles.map((style) => style.id));
    const phrases = new Set(transcript?.phrases.map((phrase) => phrase.id) ?? []);
    const words = new Set(transcript?.words.map((word) => word.id) ?? []);
    if (captions.transcriptId !== null && transcript === undefined) {
      issues.push(
        issue(
          "error",
          "caption.transcript.missing",
          captions.captionDocumentId,
          "/captionDocuments/transcriptId",
          "Caption document references an unknown transcript.",
          "Relink the caption document to an authoritative transcript or clear the linkage.",
        ),
      );
    }
    for (const cue of captions.cues) {
      const track = tracks.get(cue.trackId);
      if (
        track?.kind !== "caption" ||
        !styles.has(cue.styleTemplateId) ||
        parseBigIntString(cue.endFrameExclusive) <= parseBigIntString(cue.startFrame) ||
        parseBigIntString(cue.endFrameExclusive) > timelineDuration ||
        (cue.phraseId !== null && !phrases.has(cue.phraseId)) ||
        cue.wordIds.some((wordId) => !words.has(wordId))
      ) {
        issues.push(
          issue(
            "error",
            "caption.cue.reference-invalid",
            cue.id,
            "/captionDocuments/cues",
            "Caption cue has an invalid track, style, timing, phrase, or word reference.",
            "Repair all cue references atomically and keep bounds inside the timeline.",
          ),
        );
      }
    }
  }
};

const validateAnnotations = (snapshot: ProjectRevisionSnapshot, issues: SemanticValidationIssue[]): void => {
  const annotations = snapshot.timeline.annotations ?? [];
  const knownEntityIds = new Set([
    snapshot.project.projectId,
    snapshot.timeline.timelineId,
    ...snapshot.assets.assets.map((asset) => asset.id),
    ...snapshot.timeline.tracks.flatMap((track) => [track.id, ...track.clips.map((clip) => clip.id)]),
  ]);
  const seen = new Set<string>();
  for (const annotation of annotations) {
    const frameRange = annotation.frameRange;
    const invalidFrameRange =
      frameRange !== null &&
      (parseBigIntString(frameRange.startFrame) >= parseBigIntString(frameRange.endFrameExclusive) ||
        parseBigIntString(frameRange.endFrameExclusive) >
          parseBigIntString(snapshot.timeline.durationFrames));
    const invalidEntity = annotation.entityIds.some((id) => !knownEntityIds.has(id));
    const invalidPrivacy =
      annotation.geometry.kind === "blur-privacy" &&
      annotation.privacyBehavior !== "redact-preview-and-export";
    if (
      seen.has(annotation.id) ||
      annotation.projectId !== snapshot.project.projectId ||
      invalidFrameRange ||
      invalidEntity ||
      invalidPrivacy
    ) {
      issues.push(
        issue(
          "error",
          "annotation.authority.invalid",
          annotation.id,
          "/annotations",
          "Annotation identity, revision, entity reference, frame range, or privacy authority is invalid.",
          "Apply annotation changes through annotation.edit against the current revision.",
        ),
      );
    }
    seen.add(annotation.id);
  }
};

const frameToSample = (
  frame: bigint,
  fps: ChaiProjectDocument["video"]["fps"],
  sampleRate: number,
  ceiling: boolean,
): bigint => {
  const numerator = frame * BigInt(sampleRate) * parseBigIntString(fps.denominator);
  const denominator = parseBigIntString(fps.numerator);
  return ceiling ? (numerator + denominator - 1n) / denominator : numerator / denominator;
};

const validateSources = (project: ChaiProjectDocument, issues: SemanticValidationIssue[]): void => {
  for (const [sourcePath, source] of Object.entries(project.sources)) {
    const actualHash = createHash("sha256").update(source.content, "utf8").digest("hex");
    if (actualHash !== source.contentHash) {
      issues.push(
        issue(
          "error",
          "source.content.hash-mismatch",
          sourcePath,
          `/sources/${sourcePath.replaceAll("~", "~0").replaceAll("/", "~1")}/contentHash`,
          "Stored source content does not match its declared hash.",
          "Recompute the SHA-256 hash from the exact UTF-8 source content.",
        ),
      );
    }
    if (!sourcePath.startsWith(`scenes/${source.engine}/`)) {
      issues.push(
        issue(
          "error",
          "source.engine.path-mismatch",
          sourcePath,
          `/sources/${sourcePath.replaceAll("~", "~0").replaceAll("/", "~1")}/engine`,
          "Source engine does not match its canonical scene directory.",
          "Place source under scenes/remotion, scenes/hyperframes, or scenes/shared to match its engine.",
        ),
      );
    }
  }
};

const validateStructures = (snapshot: ProjectRevisionSnapshot, issues: SemanticValidationIssue[]): void => {
  const documents: readonly [ProjectDocumentKind, unknown, string][] = [
    ["chai.project", snapshot.project, snapshot.project.projectId],
    ["timeline", snapshot.timeline, snapshot.timeline.timelineId],
    ["assets", snapshot.assets, snapshot.assets.projectId],
    ["settings", snapshot.settings, snapshot.settings.projectId],
    ["transaction", snapshot.transaction, snapshot.transaction.transactionId],
    ["approval-state", snapshot.approvalState, snapshot.approvalState.projectId],
  ];
  for (const [kind, document, entityId] of documents) {
    const validation = validateProjectDocument(kind, document);
    if (!validation.ok) {
      for (const structural of validation.issues) {
        issues.push(
          issue(
            "error",
            `schema.${kind}.${structural.keyword}`,
            entityId,
            structural.path,
            structural.message,
            "Repair the structural schema violation before semantic validation.",
          ),
        );
      }
    }
  }
};

const validateEntityUniqueness = (
  snapshot: ProjectRevisionSnapshot,
  issues: SemanticValidationIssue[],
): void => {
  const entities = [
    ...snapshot.assets.assets.map((asset) => ({ id: asset.id, path: "/assets" })),
    ...snapshot.timeline.tracks.map((track) => ({ id: track.id, path: "/tracks" })),
    ...snapshot.timeline.tracks.flatMap((track) =>
      track.clips.map((clip) => ({ id: clip.id, path: `/tracks/${track.id}/clips` })),
    ),
  ];
  const seen = new Set<string>();
  for (const entity of entities) {
    if (seen.has(entity.id)) {
      issues.push(
        issue(
          "error",
          "entity.id.duplicate",
          entity.id,
          entity.path,
          "A stable entity ID is reused.",
          "Assign a new stable ID; never disambiguate by array position or display name.",
        ),
      );
    }
    seen.add(entity.id);
  }
  duplicateValues(snapshot.timeline.audioBusIds).forEach((id) =>
    issues.push(
      issue(
        "error",
        "audio.bus.duplicate",
        id,
        "/audioBusIds",
        "An audio bus ID is duplicated.",
        "Keep each audio bus ID unique.",
      ),
    ),
  );
  duplicateValues(snapshot.assets.assets.map((asset) => asset.path)).forEach((assetPath) =>
    issues.push(
      issue(
        "error",
        "asset.path.duplicate",
        assetPath,
        "/assets",
        "Multiple asset records claim the same canonical path.",
        "Use one canonical asset record per project-relative path.",
      ),
    ),
  );
  duplicateValues(snapshot.timeline.tracks.map((track) => track.order)).forEach((order) =>
    issues.push(
      issue(
        "error",
        "track.order.duplicate",
        String(order),
        "/tracks",
        "Track order values collide.",
        "Assign a deterministic unique order to every track.",
      ),
    ),
  );
};

const validateTimeline = (snapshot: ProjectRevisionSnapshot, issues: SemanticValidationIssue[]): void => {
  const timelineDuration = parseBigIntString(snapshot.timeline.durationFrames, "durationFrames");
  const assets = new Map(snapshot.assets.assets.map((asset) => [asset.id, asset]));
  const audioBuses = new Set(snapshot.timeline.audioBusIds);
  const requiredEnginePins = new Set<string>();

  snapshot.timeline.tracks.forEach((track, trackIndex) => {
    const sortedClips = [...track.clips].sort((left, right) =>
      compareBigIntStrings(left.startFrame, right.startFrame),
    );
    sortedClips.forEach((clip, clipIndex) => {
      const path = `/tracks/${String(trackIndex)}/clips/${String(clipIndex)}`;
      validateClip(clip, path, timelineDuration, assets, audioBuses, issues);
      if (clip.engine !== "shared") requiredEnginePins.add(clip.engine);
    });
    if (track.kind !== "audio") {
      for (let index = 1; index < sortedClips.length; index += 1) {
        const previous = sortedClips[index - 1];
        const current = sortedClips[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          clipEnd(previous) > parseBigIntString(current.startFrame)
        ) {
          issues.push(
            issue(
              "error",
              "timeline.clip.overlap",
              current.id,
              `/tracks/${String(trackIndex)}/clips`,
              "Clips overlap on a non-audio track.",
              "Move, trim, or place the clip on another compatible track.",
            ),
          );
        }
      }
    }
  });

  for (const engine of requiredEnginePins) {
    if (snapshot.project.enginePins[engine] === undefined) {
      issues.push(
        issue(
          "error",
          "engine.pin.missing",
          engine,
          "/enginePins",
          `The ${engine} engine is used without a pinned version.`,
          "Record the exact engine/adapter version before accepting the revision.",
        ),
      );
    }
  }
};

const validateClip = (
  clip: TimelineClip,
  path: string,
  timelineDuration: bigint,
  assets: ReadonlyMap<string, AssetsDocument["assets"][number]>,
  audioBuses: ReadonlySet<string>,
  issues: SemanticValidationIssue[],
): void => {
  const start = parseBigIntString(clip.startFrame);
  const duration = parseBigIntString(clip.durationFrames);
  const sourceIn = parseBigIntString(clip.sourceInFrame);
  const sourceDuration = parseBigIntString(clip.sourceDurationFrames);
  if (start + duration > timelineDuration) {
    issues.push(
      issue(
        "error",
        "timeline.clip.out-of-range",
        clip.id,
        path,
        "Clip end exceeds timeline duration.",
        "Extend the timeline or shorten/move the clip.",
      ),
    );
  }
  if (clip.engine === "shared" && clip.assetId === null) {
    issues.push(
      issue(
        "error",
        "timeline.clip.asset-required",
        clip.id,
        `${path}/assetId`,
        "A shared clip has no source asset.",
        "Relink the clip to an asset or remove it.",
      ),
    );
  }
  const asset = clip.assetId === null ? undefined : assets.get(clip.assetId);
  if (clip.assetId !== null && asset === undefined) {
    issues.push(
      issue(
        "error",
        "timeline.clip.asset-missing",
        clip.id,
        `${path}/assetId`,
        "Clip references an unknown asset.",
        "Relink the clip to an existing stable asset ID.",
      ),
    );
  }
  if (asset?.durationFrames !== null && asset?.durationFrames !== undefined) {
    const assetDuration = parseBigIntString(asset.durationFrames);
    if (sourceIn + sourceDuration > assetDuration) {
      issues.push(
        issue(
          "error",
          "timeline.clip.source-out-of-range",
          clip.id,
          `${path}/sourceDurationFrames`,
          "Clip source range exceeds the asset duration.",
          "Reduce source in/duration or relink a longer source.",
        ),
      );
    }
  }
  if (clip.audioBusId !== null && !audioBuses.has(clip.audioBusId)) {
    issues.push(
      issue(
        "error",
        "audio.bus.missing",
        clip.id,
        `${path}/audioBusId`,
        "Clip references an unknown audio bus.",
        "Route the clip to a declared bus or clear the route.",
      ),
    );
  }
  if (clip.capability === "unsupported") {
    issues.push(
      issue(
        "error",
        "capability.unsupported",
        clip.id,
        `${path}/capability`,
        "Clip requires an unsupported capability.",
        "Select a documented fallback, bake path, or remove the unsupported operation.",
      ),
    );
  } else if (clip.capability === "experimental") {
    issues.push(
      issue(
        "warning",
        "capability.experimental",
        clip.id,
        `${path}/capability`,
        "Clip uses an experimental capability.",
        "Keep the visible warning and require profile policy acceptance before delivery.",
      ),
    );
  }
};

const validateApproval = (approval: ApprovalStateDocument, issues: SemanticValidationIssue[]): void => {
  if (approval.state !== null && approval.outputId === null) {
    issues.push(
      issue(
        "error",
        "approval.output.missing",
        approval.projectId,
        "/outputId",
        "A QA lifecycle state has no immutable output identity.",
        "Attach the exact output candidate before recording QA state.",
      ),
    );
  }
  let prior: QaStateOrNull = null;
  approval.history.forEach((transition, index) => {
    if (transition.from !== prior) {
      issues.push(
        issue(
          "error",
          "approval.history.disconnected",
          approval.projectId,
          `/history/${String(index)}/from`,
          "Approval history is not a continuous state chain.",
          "Set from to the preceding transition's to state.",
        ),
      );
    }
    const key = `${String(transition.from)}->${transition.to}`;
    if (!allowedQaTransitions.has(key)) {
      issues.push(
        issue(
          "error",
          "approval.transition.invalid",
          approval.projectId,
          `/history/${String(index)}`,
          `Lifecycle transition ${key} is not allowed.`,
          "Use the frozen QA lifecycle transition table; rendering cannot approve or deliver.",
        ),
      );
    }
    prior = transition.to;
  });
  if (approval.state !== prior) {
    issues.push(
      issue(
        "error",
        "approval.state.history-mismatch",
        approval.projectId,
        "/state",
        "Current approval state does not match transition history.",
        "Set state to the final validated history transition.",
      ),
    );
  }
};

type QaStateOrNull = ApprovalStateDocument["state"];

const validatePositiveNormalizedRate = (
  value: ChaiProjectDocument["video"]["fps"],
  entityId: string,
  path: string,
  issues: SemanticValidationIssue[],
): void => {
  try {
    const normalized = deserializeRational(value);
    if (parseBigIntString(normalized.numerator) <= 0n) throw new Error("Rate must be positive.");
  } catch {
    issues.push(
      issue(
        "error",
        "timing.rate.invalid",
        entityId,
        path,
        "Master rate is not normalized and positive.",
        "Persist a reduced positive rational with a positive denominator.",
      ),
    );
  }
};

const clipEnd = (clip: TimelineClip): bigint =>
  parseBigIntString(clip.startFrame) + parseBigIntString(clip.durationFrames);

const compareBigIntStrings = (left: string, right: string): number => {
  const a = parseBigIntString(left);
  const b = parseBigIntString(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const duplicateValues = <T>(values: readonly T[]): readonly T[] => {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  values.forEach((value) => (seen.has(value) ? duplicates.add(value) : seen.add(value)));
  return [...duplicates];
};

const issue = (
  severity: SemanticValidationIssue["severity"],
  code: string,
  entityId: string,
  path: string,
  message: string,
  repairHint: string,
): SemanticValidationIssue => ({ severity, code, entityId, path, message, repairHint });

const report = (issues: readonly SemanticValidationIssue[]): ProjectValidationReport => ({
  passed: !issues.some((issue) => issue.severity === "error"),
  issues,
});
