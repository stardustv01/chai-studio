import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import type { NormalizedRational } from "@chai-studio/schema";

export type PreviewMode = "interactive" | "fidelity";
export type CaptureKind =
  | "current-frame"
  | "isolated-selection"
  | "before-effects"
  | "alpha"
  | "comparison-a"
  | "comparison-b"
  | "range"
  | "contact-sheet";

export interface BridgeEntityContext {
  readonly id: string;
  readonly kind: "project" | "timeline" | "track" | "clip" | "asset";
  readonly summary: Readonly<Record<string, unknown>>;
}

export interface SelectionContextManifest {
  readonly schemaVersion: "1.0.0";
  readonly contextId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly generatedAt: string;
  readonly selectionStateVersion: number;
  readonly selectedIds: readonly string[];
  readonly primaryId: string | null;
  readonly anchorId: string | null;
  readonly masterFrame: string;
  readonly sourceFrames: Readonly<Record<string, string>>;
  readonly timecode: string;
  readonly fps: NormalizedRational;
  readonly engine: "remotion" | "hyperframes" | "shared" | "mixed" | "none";
  readonly sourcePaths: readonly string[];
  readonly props: Readonly<Record<string, unknown>>;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly effects: readonly Readonly<Record<string, unknown>>[];
  readonly transitions: readonly Readonly<Record<string, unknown>>[];
  readonly nearbyClips: readonly BridgeEntityContext[];
  readonly entities: readonly BridgeEntityContext[];
  readonly preview: Readonly<{
    sessionId: string;
    stateVersion: number;
    mode: PreviewMode;
    quality: "draft" | "balanced" | "full";
    synchronized: boolean;
  }>;
  readonly captureIds: readonly string[];
  readonly annotationIds: readonly string[];
}

export interface CaptureManifest {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly contextId: string;
  readonly kind: CaptureKind;
  readonly frames: readonly string[];
  readonly frameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
  readonly mode: PreviewMode;
  readonly renderer: "preview-compositor" | "final-compositor";
  readonly parityEligible: boolean;
  readonly isolatedEntityIds: readonly string[];
  readonly effectsApplied: boolean;
  readonly alpha: boolean;
  readonly comparisonSide: "a" | "b" | null;
  readonly outputPaths: readonly string[];
  readonly outputHashes: readonly string[];
  readonly mimeType: "image/png" | "application/json";
  readonly createdAt: string;
  readonly completedAt: string;
}

export const selectionContextJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://chai.studio/schema/selection-context.v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "contextId",
    "projectId",
    "revisionId",
    "timelineId",
    "generatedAt",
    "selectionStateVersion",
    "selectedIds",
    "primaryId",
    "anchorId",
    "masterFrame",
    "sourceFrames",
    "timecode",
    "fps",
    "engine",
    "sourcePaths",
    "props",
    "variables",
    "effects",
    "transitions",
    "nearbyClips",
    "entities",
    "preview",
    "captureIds",
    "annotationIds",
  ],
  properties: {
    schemaVersion: { const: "1.0.0" },
    contextId: { type: "string" },
    projectId: { type: "string" },
    revisionId: { type: "string" },
    timelineId: { type: "string" },
    generatedAt: { type: "string", format: "date-time" },
    selectionStateVersion: { type: "integer", minimum: 1 },
    selectedIds: { type: "array", items: { type: "string" }, uniqueItems: true, maxItems: 256 },
    primaryId: { type: ["string", "null"] },
    anchorId: { type: ["string", "null"] },
    masterFrame: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
    sourceFrames: {
      type: "object",
      additionalProperties: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
    },
    timecode: { type: "string", pattern: "^[0-9]{2,}:[0-9]{2}:[0-9]{2}:[0-9]{2}$" },
    fps: { type: "object" },
    engine: { enum: ["remotion", "hyperframes", "shared", "mixed", "none"] },
    sourcePaths: { type: "array", items: { type: "string" }, uniqueItems: true },
    props: { type: "object" },
    variables: { type: "object" },
    effects: { type: "array", items: { type: "object" } },
    transitions: { type: "array", items: { type: "object" } },
    nearbyClips: { type: "array", items: { type: "object" } },
    entities: { type: "array", items: { type: "object" } },
    preview: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "stateVersion", "mode", "quality", "synchronized"],
      properties: {
        sessionId: { type: "string" },
        stateVersion: { type: "integer", minimum: 1 },
        mode: { enum: ["interactive", "fidelity"] },
        quality: { enum: ["draft", "balanced", "full"] },
        synchronized: { type: "boolean" },
      },
    },
    captureIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    annotationIds: { type: "array", items: { type: "string" }, uniqueItems: true },
  },
} as const;

export const captureManifestJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://chai.studio/schema/capture-manifest.v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "id",
    "jobId",
    "projectId",
    "revisionId",
    "timelineId",
    "contextId",
    "kind",
    "frames",
    "frameRange",
    "mode",
    "renderer",
    "parityEligible",
    "isolatedEntityIds",
    "effectsApplied",
    "alpha",
    "comparisonSide",
    "outputPaths",
    "outputHashes",
    "mimeType",
    "createdAt",
    "completedAt",
  ],
  properties: {
    schemaVersion: { const: "1.0.0" },
    id: { type: "string" },
    jobId: { type: "string" },
    projectId: { type: "string" },
    revisionId: { type: "string" },
    timelineId: { type: "string" },
    contextId: { type: "string" },
    kind: {
      enum: [
        "current-frame",
        "isolated-selection",
        "before-effects",
        "alpha",
        "comparison-a",
        "comparison-b",
        "range",
        "contact-sheet",
      ],
    },
    frames: { type: "array", minItems: 1, items: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" } },
    frameRange: { type: ["object", "null"] },
    mode: { enum: ["interactive", "fidelity"] },
    renderer: { enum: ["preview-compositor", "final-compositor"] },
    parityEligible: { type: "boolean" },
    isolatedEntityIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    effectsApplied: { type: "boolean" },
    alpha: { type: "boolean" },
    comparisonSide: { enum: ["a", "b", null] },
    outputPaths: { type: "array", minItems: 1, items: { type: "string" } },
    outputHashes: { type: "array", minItems: 1, items: { type: "string", pattern: "^[a-f0-9]{64}$" } },
    mimeType: { enum: ["image/png", "application/json"] },
    createdAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time" },
  },
} as const;

export const assertFreshContext = (
  context: SelectionContextManifest,
  expected: Readonly<{ projectId: string; revisionId: string }>,
): void => {
  if (context.projectId !== expected.projectId) {
    throw new Error("Bridge context belongs to a different project; refresh selection context.");
  }
  if (context.revisionId !== expected.revisionId) {
    throw new Error(
      `Bridge context is stale at ${context.revisionId}; current revision is ${expected.revisionId}.`,
    );
  }
};

export const assertSelectionContextManifest = (value: SelectionContextManifest): void => {
  assertVersionAndIds(value.schemaVersion, [
    value.contextId,
    value.projectId,
    value.revisionId,
    value.timelineId,
  ]);
  assertFrame(value.masterFrame, "masterFrame");
  if (!Number.isSafeInteger(value.selectionStateVersion) || value.selectionStateVersion < 1) {
    throw new Error("Selection context state version is invalid.");
  }
  if (new Set(value.selectedIds).size !== value.selectedIds.length || value.selectedIds.length > 256) {
    throw new Error("Selection context IDs must be unique and bounded.");
  }
  if (value.primaryId !== null && !value.selectedIds.includes(value.primaryId)) {
    throw new Error("Selection context primary ID is not selected.");
  }
  if (value.anchorId !== null && !value.selectedIds.includes(value.anchorId)) {
    throw new Error("Selection context anchor ID is not selected.");
  }
  if (!/^\d{2,}:\d{2}:\d{2}:\d{2}$/.test(value.timecode)) throw new Error("Context timecode is invalid.");
};

export const assertCaptureManifest = (value: CaptureManifest): void => {
  assertVersionAndIds(value.schemaVersion, [
    value.id,
    value.jobId,
    value.projectId,
    value.revisionId,
    value.timelineId,
  ]);
  if (value.frames.length === 0) throw new Error("Capture manifest contains no frames.");
  value.frames.forEach((frame) => {
    assertFrame(frame, "capture frame");
  });
  if (value.outputPaths.length !== value.outputHashes.length || value.outputPaths.length === 0) {
    throw new Error("Capture output paths and hashes must form a non-empty pairwise ledger.");
  }
  if (value.mode === "fidelity" && (value.renderer !== "final-compositor" || !value.parityEligible)) {
    throw new Error("Fidelity capture must come from the final compositor and be parity eligible.");
  }
  if (value.mode === "interactive" && value.parityEligible) {
    throw new Error("Interactive capture cannot claim final-render parity.");
  }
  for (const hash of value.outputHashes) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Capture output hash is invalid.");
  }
};

export const writeLatestContext = async (
  projectRoot: string,
  value: SelectionContextManifest,
): Promise<string> => {
  assertSelectionContextManifest(value);
  const target = path.join(projectRoot, ".chai-context", "latest-context.json");
  await writeJsonAtomic(target, value);
  return target;
};

export const writeCaptureManifest = async (projectRoot: string, value: CaptureManifest): Promise<string> => {
  assertCaptureManifest(value);
  const target = path.join(projectRoot, "captures", `${value.id}.json`);
  await writeJsonAtomic(target, value);
  return target;
};

export const sha256Bytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const assertVersionAndIds = (version: string, ids: readonly string[]): void => {
  if (version !== "1.0.0") throw new Error("Unsupported bridge manifest schema version.");
  if (ids.some((id) => !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(id))) {
    throw new Error("Bridge manifest contains an invalid stable ID.");
  }
};

const assertFrame = (frame: string, field: string): void => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(frame)) throw new Error(`${field} is invalid.`);
};

const writeJsonAtomic = async (target: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
};
