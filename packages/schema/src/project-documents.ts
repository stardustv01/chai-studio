import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { projectDocumentSchemaBundle } from "./generated/project-document-schemas.js";
import type { BigIntString, NormalizedRational } from "./rational.js";

export const projectDocumentKinds = [
  "chai.project",
  "timeline",
  "assets",
  "settings",
  "transaction",
  "current-revision",
  "autosave-metadata",
  "named-versions",
  "approval-state",
] as const;

export type ProjectDocumentKind = (typeof projectDocumentKinds)[number];
export type SchemaVersion = "1.0.0";
export type QaState =
  "rendered_unchecked" | "qa_failed" | "qa_warning" | "qa_passed" | "approved" | "delivered";

interface RevisionDocumentRoot {
  readonly schemaVersion: SchemaVersion;
  readonly projectId: string;
  readonly revisionId: string;
}

export interface ChaiProjectDocument extends RevisionDocumentRoot {
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly video: {
    readonly width: number;
    readonly height: number;
    readonly fps: NormalizedRational;
    readonly colorSpace: "rec709" | "display-p3" | "rec2020";
  };
  readonly audio: {
    readonly sampleRate: 44_100 | 48_000 | 96_000;
    readonly channelLayout: "mono" | "stereo" | "5.1" | "7.1";
  };
  readonly activeTimelineId: string;
  readonly deliveryProfileId: string | null;
  readonly enginePins: Readonly<Record<string, string>>;
  readonly capabilityFlags: Readonly<Record<string, boolean>>;
  readonly rightsNotes: readonly string[];
  readonly sources: Readonly<
    Record<
      string,
      {
        readonly engine: "remotion" | "hyperframes" | "shared";
        readonly contentHash: string;
        readonly content: string;
      }
    >
  >;
}

export interface TimelineClip {
  readonly id: string;
  readonly assetId: string | null;
  readonly engine: "shared" | "remotion" | "hyperframes";
  readonly startFrame: BigIntString;
  readonly durationFrames: BigIntString;
  readonly sourceInFrame: BigIntString;
  readonly sourceDurationFrames: BigIntString;
  readonly capability:
    "native" | "unified" | "bake_required" | "fallback_available" | "unsupported" | "experimental";
  readonly audioBusId: string | null;
  readonly name?: string;
  readonly linkGroupId?: string | null;
  readonly selectionGroupId?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly properties?: Readonly<Record<string, TimelinePropertyDocument>>;
}

export type TimelinePropertyValue = number | string | boolean | readonly number[];

export interface TimelinePropertyDocument {
  readonly value: TimelinePropertyValue;
  readonly defaultValue: TimelinePropertyValue;
  readonly unit:
    | "px"
    | "percent"
    | "degrees"
    | "frames"
    | "ratio"
    | "decibels"
    | "color"
    | "text"
    | "enum"
    | "file"
    | "boolean"
    | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly step: number | null;
  readonly ownership: "shared" | "engine-native";
  readonly keyframeable: boolean;
  readonly capability:
    "native" | "unified" | "bake_required" | "fallback_available" | "unsupported" | "experimental";
  readonly safeToEdit: boolean;
  readonly nativeAnimation: boolean;
  readonly supportsSharedConversion: boolean;
}

export interface TimelineTrack {
  readonly id: string;
  readonly kind: "video" | "audio" | "caption" | "data";
  readonly name: string;
  readonly order: number;
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly clips: readonly TimelineClip[];
}

export interface TimelineMarker {
  readonly id: string;
  readonly frame: BigIntString;
  readonly duration: BigIntString;
  readonly label: string;
  readonly category: "note" | "issue" | "chapter" | "approval" | "guide";
  readonly issueSeverity: "info" | "warning" | "error" | null;
  readonly annotationReferenceIds: readonly string[];
  readonly ripplePolicy: "anchored-time" | "anchored-content";
}

export interface TimelineKeyframe {
  readonly id: string;
  readonly ownerEntityId: string;
  readonly propertyPath: string;
  readonly frame: BigIntString;
  readonly value: TimelinePropertyValue;
  readonly interpolation:
    "hold" | "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | "bezier" | "spring" | "native";
  readonly inTangent: readonly [number, number] | null;
  readonly outTangent: readonly [number, number] | null;
  readonly authority: "shared" | "engine-native";
  readonly preserveNativeAnimation: boolean;
}

export interface TimelineAutomationLane {
  readonly id: string;
  readonly ownerEntityId: string;
  readonly propertyPath: string;
  readonly keyframeIds: readonly string[];
  readonly authority: "shared" | "engine-native";
}

export type AudioBusKind = "voiceover" | "music" | "sfx" | "ambience" | "aux" | "master";
export type AudioChannelLayout = "mono" | "stereo" | "5.1" | "7.1";

export interface AudioGraphSource {
  readonly id: string;
  readonly assetId: string;
  readonly streamIndex: number;
  readonly contentHash: string;
  readonly originalPath: string;
  readonly proxyPath: string | null;
  readonly sourceSampleRate: number;
  readonly sourceChannels: number;
  readonly previewPolicy: "proxy-preferred" | "original-only";
}

export interface AudioGraphBus {
  readonly id: string;
  readonly name: string;
  readonly kind: AudioBusKind;
  readonly parentBusId: string | null;
  readonly gainDb: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly automationLaneIds: readonly string[];
}

export interface AudioGraphClip {
  readonly id: string;
  readonly timelineClipId: string;
  readonly sourceId: string;
  readonly busId: string;
  readonly startFrame: BigIntString;
  readonly endFrameExclusive: BigIntString;
  readonly sourceStartSample: BigIntString;
  readonly sourceEndSampleExclusive: BigIntString;
  readonly gainDb: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly fadeInFrames: BigIntString;
  readonly fadeOutFrames: BigIntString;
  readonly fadeCurve: "linear" | "equal-power";
  readonly automationLaneIds: readonly string[];
  readonly channelMapId: string;
  readonly syncAnchorIds: readonly string[];
  readonly processingReferenceIds: readonly string[];
}

export interface AudioAutomationKeyframe {
  readonly id: string;
  readonly frame: BigIntString;
  readonly value: number;
  readonly interpolation: "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface AudioAutomationLane {
  readonly id: string;
  readonly targetKind: "clip" | "bus";
  readonly targetId: string;
  readonly property: "gainDb" | "pan";
  readonly keyframes: readonly AudioAutomationKeyframe[];
}

export interface AudioCrossfade {
  readonly id: string;
  readonly fromClipId: string;
  readonly toClipId: string;
  readonly startFrame: BigIntString;
  readonly endFrameExclusive: BigIntString;
  readonly curve: "linear" | "equal-power";
}

export interface AudioDuckingRule {
  readonly id: string;
  readonly triggerBusId: string;
  readonly targetBusId: string;
  readonly thresholdDb: number;
  readonly reductionDb: number;
  readonly attackFrames: BigIntString;
  readonly releaseFrames: BigIntString;
  readonly generatedAutomationLaneId: string | null;
}

export interface AudioChannelMap {
  readonly id: string;
  readonly inputChannels: number;
  readonly outputChannels: number;
  readonly matrix: readonly (readonly number[])[];
}

export interface AudioSyncAnchor {
  readonly id: string;
  readonly label: string;
  readonly frame: BigIntString;
  readonly sourceSample: BigIntString;
  readonly toleranceSamples: BigIntString;
}

export interface AudioProcessingReference {
  readonly id: string;
  readonly kind: "normalize" | "noise-reduction";
  readonly sourceId: string;
  readonly generatedAssetId: string;
  readonly inputContentHash: string;
  readonly settingsHash: string;
  readonly outputContentHash: string;
  readonly status: "planned" | "ready" | "failed";
}

export interface AudioGraphDocument {
  readonly schemaVersion: "1.0.0";
  readonly graphId: string;
  readonly sampleRate: 44_100 | 48_000 | 96_000;
  readonly channelLayout: AudioChannelLayout;
  readonly masterBusId: string;
  readonly sources: readonly AudioGraphSource[];
  readonly buses: readonly AudioGraphBus[];
  readonly clips: readonly AudioGraphClip[];
  readonly automationLanes: readonly AudioAutomationLane[];
  readonly crossfades: readonly AudioCrossfade[];
  readonly duckingRules: readonly AudioDuckingRule[];
  readonly channelMaps: readonly AudioChannelMap[];
  readonly syncAnchors: readonly AudioSyncAnchor[];
  readonly processingReferences: readonly AudioProcessingReference[];
}

export type TranscriptCorrectionState = "machine" | "reviewed" | "corrected";

export interface TranscriptSourceAudio {
  readonly assetId: string;
  readonly streamIndex: number;
  readonly contentHash: string;
  readonly sampleRate: 44_100 | 48_000 | 96_000;
}

export interface TranscriptSpeaker {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface TranscriptWord {
  readonly id: string;
  readonly text: string;
  readonly startSample: BigIntString;
  readonly endSampleExclusive: BigIntString;
  readonly startFrame: BigIntString;
  readonly endFrameExclusive: BigIntString;
  readonly confidence: number | null;
  readonly correctionState: TranscriptCorrectionState;
  readonly locked: boolean;
}

export interface TranscriptPhrase {
  readonly id: string;
  readonly speakerId: string | null;
  readonly wordIds: readonly string[];
  readonly text: string;
  readonly startFrame: BigIntString;
  readonly endFrameExclusive: BigIntString;
  readonly confidence: number | null;
  readonly correctionState: TranscriptCorrectionState;
  readonly locked: boolean;
  readonly captionCueId: string | null;
}

export interface TranscriptDocument {
  readonly schemaVersion: "1.0.0";
  readonly transcriptId: string;
  readonly sourceAudio: TranscriptSourceAudio;
  readonly language: string;
  readonly direction: "ltr" | "rtl" | "auto";
  readonly importedFrom: "internal" | "srt" | "vtt" | "transcription";
  readonly speakers: readonly TranscriptSpeaker[];
  readonly words: readonly TranscriptWord[];
  readonly phrases: readonly TranscriptPhrase[];
}

export interface CaptionStyleTemplate {
  readonly id: string;
  readonly name: string;
  readonly fontAssetId: string;
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly fontWeight: number;
  readonly lineHeight: number;
  readonly fillColor: string;
  readonly backgroundColor: string;
  readonly alignment: "left" | "center" | "right";
  readonly verticalPositionPercent: number;
  readonly safeAreaPercent: number;
  readonly maxLines: number;
  readonly maxCharactersPerLine: number;
  readonly maxCharactersPerSecond: number;
  readonly highlightMode: "none" | "word" | "line";
}

export interface CaptionCueDocument {
  readonly id: string;
  readonly trackId: string;
  readonly transcriptId: string | null;
  readonly phraseId: string | null;
  readonly startFrame: BigIntString;
  readonly endFrameExclusive: BigIntString;
  readonly text: string;
  readonly lines: readonly string[];
  readonly speakerId: string | null;
  readonly wordIds: readonly string[];
  readonly locked: boolean;
  readonly styleTemplateId: string;
}

export interface CaptionDocument {
  readonly schemaVersion: "1.0.0";
  readonly captionDocumentId: string;
  readonly transcriptId: string | null;
  readonly styles: readonly CaptionStyleTemplate[];
  readonly cues: readonly CaptionCueDocument[];
}

export type AnnotationGeometry =
  | Readonly<{ kind: "point" | "text"; point: Readonly<{ x: number; y: number }> }>
  | Readonly<{
      kind: "rectangle" | "blur-privacy";
      rectangle: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>
  | Readonly<{
      kind: "arrow";
      start: Readonly<{ x: number; y: number }>;
      end: Readonly<{ x: number; y: number }>;
    }>
  | Readonly<{
      kind: "freehand";
      points: readonly Readonly<{ x: number; y: number }>[];
    }>;

export interface AnnotationDocument {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly entityIds: readonly string[];
  readonly captureId: string | null;
  readonly frameRange: Readonly<{
    startFrame: BigIntString;
    endFrameExclusive: BigIntString;
  }> | null;
  readonly coordinateSpace: "source-normalized";
  readonly geometry: AnnotationGeometry;
  readonly category: "note" | "issue" | "privacy" | "approval" | "guide";
  readonly color: string;
  readonly body: string;
  readonly author: Readonly<{
    id: string;
    kind: "user" | "codex" | "system";
    sessionId: string;
  }>;
  readonly order: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly privacyBehavior: "none" | "redact-preview-and-export";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewActor {
  readonly id: string;
  readonly kind: "user" | "codex" | "system";
  readonly sessionId: string;
}

export interface ReviewIssueTransition {
  readonly from:
    "open" | "acknowledged" | "fixed-unverified" | "resolved" | "accepted-exception" | "rejected";
  readonly to: "open" | "acknowledged" | "fixed-unverified" | "resolved" | "accepted-exception" | "rejected";
  readonly actor: ReviewActor;
  readonly revisionId: string;
  readonly evidenceHashes: readonly string[];
  readonly comment: string;
  readonly at: string;
}

export interface ReviewIssueDocument {
  readonly id: string;
  readonly bundleId: string;
  readonly title: string;
  readonly body: string;
  readonly category: "visual" | "audio" | "caption" | "sync" | "rights" | "delivery" | "other";
  readonly severity: "info" | "warning" | "error";
  readonly status: ReviewIssueTransition["to"];
  readonly entityIds: readonly string[];
  readonly frameRange: Readonly<{ startFrame: BigIntString; endFrameExclusive: BigIntString }> | null;
  readonly annotationIds: readonly string[];
  readonly transitions: readonly ReviewIssueTransition[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewBundleDocument {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly targetRevisionId: string;
  readonly title: string;
  readonly origin: "selection" | "marker" | "phrase" | "capture" | "range" | "delivery-candidate";
  readonly selectedEntityIds: readonly string[];
  readonly markerIds: readonly string[];
  readonly phraseIds: readonly string[];
  readonly frames: readonly BigIntString[];
  readonly ranges: readonly Readonly<{ startFrame: BigIntString; endFrameExclusive: BigIntString }>[];
  readonly captureIds: readonly string[];
  readonly annotationIds: readonly string[];
  readonly issueIds: readonly string[];
  readonly author: ReviewActor;
  readonly status: "draft" | "requested" | "in-review" | "changes-requested" | "decision-recorded" | "closed";
  readonly requestedDecision: "feedback" | "approve-candidate" | "accept-exception";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewComparisonDocument {
  readonly id: string;
  readonly leftRevisionId: string;
  readonly rightRevisionId: string;
  readonly timelineId: string;
  readonly frameRange: Readonly<{ startFrame: BigIntString; endFrameExclusive: BigIntString }>;
  readonly mode: "side-by-side" | "wipe" | "difference" | "onion-skin";
  readonly linkedNavigation: true;
  readonly split: number;
  readonly captureIds: readonly string[];
  readonly createdAt: string;
}

export interface ReviewRequestDocument {
  readonly id: string;
  readonly bundleId: string;
  readonly requestedBy: ReviewActor;
  readonly requestedDecision: ReviewBundleDocument["requestedDecision"];
  readonly targetRevisionId: string;
  readonly requiredQaState: QaState | null;
  readonly status: "open" | "acted" | "withdrawn";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewActionDocument {
  readonly id: string;
  readonly requestId: string;
  readonly actor: ReviewActor;
  readonly decision: "commented" | "changes-requested" | "recommended-approval" | "recommended-rejection";
  readonly comment: string;
  readonly evidenceHashes: readonly string[];
  readonly revisionId: string;
  readonly lifecycleEffect: "none";
  readonly qaTransitionId: null;
  readonly createdAt: string;
}

export interface AcceptedExceptionDocument {
  readonly id: string;
  readonly issueId: string;
  readonly scope: Readonly<{
    kind: "entity" | "frame-range" | "qa-code" | "output";
    entityIds: readonly string[];
    frameRange: Readonly<{ startFrame: BigIntString; endFrameExclusive: BigIntString }> | null;
    qaCodes: readonly string[];
    outputId: string | null;
  }>;
  readonly reason: string;
  readonly evidenceHashes: readonly string[];
  readonly approver: ReviewActor;
  readonly acceptedAt: string;
  readonly expiresAt: string | null;
  readonly reviewAt: string;
  readonly active: boolean;
}

export interface AlternateTakeDocument {
  readonly id: string;
  readonly stackId: string;
  readonly label: string;
  readonly revisionId: string;
  readonly clipIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
}

export interface ReviewStateDocument {
  readonly schemaVersion: "1.0.0";
  readonly bundles: readonly ReviewBundleDocument[];
  readonly issues: readonly ReviewIssueDocument[];
  readonly comparisons: readonly ReviewComparisonDocument[];
  readonly requests: readonly ReviewRequestDocument[];
  readonly actions: readonly ReviewActionDocument[];
  readonly exceptions: readonly AcceptedExceptionDocument[];
  readonly alternateTakes: readonly AlternateTakeDocument[];
}

export interface TimelineDocument extends RevisionDocumentRoot {
  readonly timelineId: string;
  readonly fps: NormalizedRational;
  readonly durationFrames: BigIntString;
  readonly tracks: readonly TimelineTrack[];
  readonly audioBusIds: readonly string[];
  readonly approvalReferenceIds: readonly string[];
  readonly selection?: {
    readonly primaryId: string | null;
    readonly selectedIds: readonly string[];
    readonly anchorId: string | null;
  };
  readonly inOutRange?: {
    readonly startFrame: BigIntString;
    readonly endFrame: BigIntString;
  } | null;
  readonly markers?: readonly TimelineMarker[];
  readonly keyframes?: readonly TimelineKeyframe[];
  readonly automation?: readonly TimelineAutomationLane[];
  readonly professionalMetadata?: Readonly<Record<string, string>>;
  readonly audioGraph?: AudioGraphDocument;
  readonly transcripts?: readonly TranscriptDocument[];
  readonly captionDocuments?: readonly CaptionDocument[];
  readonly annotations?: readonly AnnotationDocument[];
  readonly reviewState?: ReviewStateDocument;
}

export interface AssetRecord {
  readonly id: string;
  readonly path: string;
  readonly contentHash: string;
  readonly kind: "video" | "audio" | "image" | "caption" | "composition" | "data";
  readonly durationFrames: BigIntString | null;
  readonly fps: NormalizedRational | null;
  readonly hasAudio: boolean;
  readonly hasAlpha: boolean;
  readonly variableFrameRate: boolean;
  readonly rights: "owned" | "licensed" | "public-domain" | "unknown";
  readonly validationState: "pending" | "valid" | "missing" | "corrupt" | "unsupported";
}

export interface AssetsDocument extends RevisionDocumentRoot {
  readonly assets: readonly AssetRecord[];
}

export interface SettingsDocument extends RevisionDocumentRoot {
  readonly autosaveIntervalMs: number;
  readonly autosaveRetention: number;
  readonly outputDirectory: string;
  readonly allowImportedExecutableContent: boolean;
  readonly networkAllowlist: readonly string[];
}

export interface TransactionDocument {
  readonly schemaVersion: SchemaVersion;
  readonly transactionId: string;
  readonly commandId: string;
  readonly idempotencyId: string;
  readonly correlationId: string;
  readonly commandEnvelopeHash: string;
  readonly actor: {
    readonly id: string;
    readonly kind: "user" | "codex" | "system";
    readonly sessionId: string;
  };
  readonly capability: { readonly name: string; readonly version: string };
  readonly declaredScope: "mutation" | "source-edit" | "destructive";
  readonly authorizationId: string | null;
  readonly validationOnly: boolean;
  readonly result: "committed";
  readonly history: {
    readonly action: "commit" | "undo" | "redo";
    readonly contentRevisionId: string;
    readonly undoStack: readonly string[];
    readonly redoStack: readonly string[];
  };
  readonly namedVersion: NamedVersionsDocument["versions"][number] | null;
  readonly timestamp: string;
  readonly parentRevisionId: string | null;
  readonly resultingRevisionId: string;
  readonly beforeHashes: Readonly<Record<string, string>>;
  readonly afterHashes: Readonly<Record<string, string>>;
  readonly affectedEntityIds: readonly string[];
  readonly commandSummary: string;
  readonly diffSummary: string;
  readonly warnings: readonly string[];
  readonly sourceEdit: {
    readonly path: string;
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly diffHash: string;
  } | null;
}

export interface CurrentRevisionPointer {
  readonly schemaVersion: SchemaVersion;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionHash: string;
  readonly committedAt: string;
}

export interface AutosaveMetadataDocument {
  readonly schemaVersion: SchemaVersion;
  readonly projectId: string;
  readonly cleanShutdown: boolean;
  readonly lastOpenedRevisionId: string;
  readonly entries: readonly {
    readonly id: string;
    readonly revisionId: string;
    readonly createdAt: string;
    readonly reason: "debounced" | "pre-risk" | "crash-recovery";
    readonly valid: boolean;
    readonly contentHash: string;
  }[];
}

export interface NamedVersionsDocument {
  readonly schemaVersion: SchemaVersion;
  readonly projectId: string;
  readonly versions: readonly {
    readonly id: string;
    readonly name: "Draft" | "Review" | "Approved" | "Delivery Candidate" | "Delivered";
    readonly revisionId: string;
    readonly createdAt: string;
    readonly actorId: string;
    readonly outputId: string | null;
  }[];
}

export interface ApprovalStateDocument extends RevisionDocumentRoot {
  readonly state: QaState | null;
  readonly outputId: string | null;
  readonly updatedAt: string;
  readonly history: readonly {
    readonly from: QaState | null;
    readonly to: QaState;
    readonly actorId: string;
    readonly at: string;
    readonly evidenceHashes: readonly string[];
    readonly exceptionIds: readonly string[];
  }[];
}

export interface ProjectDocumentByKind {
  readonly "chai.project": ChaiProjectDocument;
  readonly timeline: TimelineDocument;
  readonly assets: AssetsDocument;
  readonly settings: SettingsDocument;
  readonly transaction: TransactionDocument;
  readonly "current-revision": CurrentRevisionPointer;
  readonly "autosave-metadata": AutosaveMetadataDocument;
  readonly "named-versions": NamedVersionsDocument;
  readonly "approval-state": ApprovalStateDocument;
}

export interface StructuralValidationIssue {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type DocumentValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly StructuralValidationIssue[] };

const definitionByKind: Readonly<Record<ProjectDocumentKind, string>> = {
  "chai.project": "project",
  timeline: "timeline",
  assets: "assets",
  settings: "settings",
  transaction: "transaction",
  "current-revision": "currentRevisionPointer",
  "autosave-metadata": "autosaveMetadata",
  "named-versions": "namedVersions",
  "approval-state": "approvalState",
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value)),
});
ajv.addFormat("hostname", {
  type: "string",
  validate: (value: string) =>
    value.length <= 253 &&
    value.split(".").every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)),
});
ajv.addSchema(projectDocumentSchemaBundle);

const validators = Object.fromEntries(
  projectDocumentKinds.map((kind) => [
    kind,
    ajv.compile({ $ref: `${projectDocumentSchemaBundle.$id}#/$defs/${definitionByKind[kind]}` }),
  ]),
) as Record<ProjectDocumentKind, ValidateFunction>;

export const validateProjectDocument = <K extends ProjectDocumentKind>(
  kind: K,
  value: unknown,
): DocumentValidationResult<ProjectDocumentByKind[K]> => {
  const validator = validators[kind];
  if (validator(value)) return { ok: true, value: value as ProjectDocumentByKind[K] };
  return { ok: false, issues: (validator.errors ?? []).map(toIssue) };
};

export const assertProjectDocument = <K extends ProjectDocumentKind>(
  kind: K,
  value: unknown,
): ProjectDocumentByKind[K] => {
  const result = validateProjectDocument(kind, value);
  if (result.ok) return result.value;
  throw new ChaiError({
    category: "schema",
    code: "schema.document.invalid",
    correlationId: createCorrelationId(),
    stage: "structural-validation",
    message: `The ${kind} document failed structural validation at ${result.issues[0]?.path ?? "/"}.`,
    entityId: kind,
    repairHint: result.issues[0]?.message ?? "Repair the document to match schema version 1.0.0.",
    details: { issues: result.issues },
  });
};

export const getProjectDocumentJsonSchema = (
  kind: ProjectDocumentKind,
): Readonly<Record<string, unknown>> => ({
  $schema: projectDocumentSchemaBundle.$schema,
  $ref: `${projectDocumentSchemaBundle.$id}#/$defs/${definitionByKind[kind]}`,
});

export { projectDocumentSchemaBundle };

const toIssue = (error: ErrorObject): StructuralValidationIssue => ({
  path: error.instancePath || "/",
  keyword: error.keyword,
  message: error.message ?? "Schema constraint failed.",
  params: error.params,
});
