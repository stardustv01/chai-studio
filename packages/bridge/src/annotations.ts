import type { AnnotationDocument, TimelineDocument } from "@chai-studio/schema";

export type AnnotationOperation =
  | Readonly<{ kind: "annotation.create"; annotation: AnnotationDocument }>
  | Readonly<{
      kind: "annotation.update";
      annotationId: string;
      changes: Readonly<
        Partial<Omit<AnnotationDocument, "schemaVersion" | "id" | "projectId" | "createdAt">>
      >;
    }>
  | Readonly<{ kind: "annotation.delete"; annotationId: string }>;

export interface AnnotationEditResult {
  readonly timeline: TimelineDocument;
  readonly label: string;
  readonly diffSummary: string;
  readonly affectedEntityIds: readonly string[];
  readonly warnings: readonly string[];
}

export const executeAnnotationDocumentEdit = (
  timeline: TimelineDocument,
  operationValue: unknown,
  revisionId: string,
): AnnotationEditResult => {
  const operation = assertAnnotationOperation(operationValue);
  const annotations = [...(timeline.annotations ?? [])];
  if (operation.kind === "annotation.create") {
    if (annotations.some((item) => item.id === operation.annotation.id)) {
      throw new Error(`Annotation ${operation.annotation.id} already exists.`);
    }
    const annotation = { ...operation.annotation, revisionId };
    assertAnnotation(annotation, timeline);
    return result(
      { ...timeline, revisionId, annotations: [...annotations, annotation] },
      "Create annotation",
      `Created ${annotation.category} annotation ${annotation.id}.`,
      [annotation.id, ...annotation.entityIds],
    );
  }
  const index = annotations.findIndex((item) => item.id === operation.annotationId);
  if (index < 0) throw new Error(`Unknown annotation ID: ${operation.annotationId}.`);
  const before = annotations[index];
  if (before === undefined) throw new Error(`Unknown annotation ID: ${operation.annotationId}.`);
  if (before.locked && operation.kind !== "annotation.update")
    throw new Error("Locked annotation cannot be deleted.");
  if (operation.kind === "annotation.delete") {
    annotations.splice(index, 1);
    return result(
      { ...timeline, revisionId, annotations },
      "Delete annotation",
      `Deleted annotation ${before.id}.`,
      [before.id, ...before.entityIds],
    );
  }
  if (before.locked && operation.changes.locked !== false) {
    throw new Error("Unlock the annotation before editing it.");
  }
  const after = { ...before, ...operation.changes, revisionId };
  assertAnnotation(after, timeline);
  annotations[index] = after;
  return result(
    { ...timeline, revisionId, annotations },
    "Update annotation",
    `Updated annotation ${after.id}.`,
    [after.id, ...new Set([...before.entityIds, ...after.entityIds])],
  );
};

export const assertAnnotation = (annotation: AnnotationDocument, timeline: TimelineDocument): void => {
  if (annotation.projectId !== timeline.projectId) throw new Error("Annotation project identity mismatch.");
  if (
    annotation.entityIds.length > 64 ||
    new Set(annotation.entityIds).size !== annotation.entityIds.length
  ) {
    throw new Error("Annotation entity IDs must be unique and bounded.");
  }
  if (annotation.frameRange !== null) {
    const start = BigInt(annotation.frameRange.startFrame);
    const end = BigInt(annotation.frameRange.endFrameExclusive);
    if (start >= end || end > BigInt(timeline.durationFrames)) {
      throw new Error("Annotation frame range is outside the timeline.");
    }
  }
  const points = geometryPoints(annotation);
  if (
    points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)
  ) {
    throw new Error("Annotation coordinates must be normalized to source space.");
  }
  if (
    annotation.geometry.kind === "blur-privacy" &&
    annotation.privacyBehavior !== "redact-preview-and-export"
  ) {
    throw new Error("Privacy blur annotations must redact preview and export.");
  }
  if (!/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(annotation.color)) {
    throw new Error("Annotation color must be a six- or eight-digit hex color.");
  }
};

const assertAnnotationOperation = (value: unknown): AnnotationOperation => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Annotation operation must be an object.");
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind === "annotation.create" && typeof record.annotation === "object" && record.annotation !== null) {
    return record as unknown as AnnotationOperation;
  }
  if (
    (kind === "annotation.update" || kind === "annotation.delete") &&
    typeof record.annotationId === "string"
  ) {
    if (kind === "annotation.update" && (typeof record.changes !== "object" || record.changes === null)) {
      throw new Error("Annotation update changes are missing.");
    }
    return record as unknown as AnnotationOperation;
  }
  throw new Error("Unsupported annotation operation.");
};

const geometryPoints = (annotation: AnnotationDocument): readonly Readonly<{ x: number; y: number }>[] => {
  const geometry = annotation.geometry;
  if (geometry.kind === "point" || geometry.kind === "text") return [geometry.point];
  if (geometry.kind === "arrow") return [geometry.start, geometry.end];
  if (geometry.kind === "freehand") return geometry.points;
  if (!("rectangle" in geometry)) throw new Error("Annotation geometry is invalid.");
  return [
    { x: geometry.rectangle.x, y: geometry.rectangle.y },
    {
      x: geometry.rectangle.x + geometry.rectangle.width,
      y: geometry.rectangle.y + geometry.rectangle.height,
    },
  ];
};

const result = (
  timeline: TimelineDocument,
  label: string,
  diffSummary: string,
  affectedEntityIds: readonly string[],
): AnnotationEditResult => ({ timeline, label, diffSummary, affectedEntityIds, warnings: [] });
