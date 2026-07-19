import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { commandEnvelopeJsonSchema } from "./generated/command-envelope-schema.js";
import { projectDocumentSchemaBundle } from "./generated/project-document-schemas.js";
import type {
  AnnotationDocument,
  AssetRecord,
  QaState,
  TimelineDocument,
  StructuralValidationIssue,
} from "./project-documents.js";
import type { JsonValue } from "./canonical-json.js";

export type CommandKind =
  | "read.inspect"
  | "capture.create"
  | "project.rename"
  | "timeline.edit"
  | "audio.edit"
  | "language.edit"
  | "annotation.edit"
  | "review.edit"
  | "timeline.replace"
  | "asset.register"
  | "asset.relink"
  | "asset.replace"
  | "asset.manifest.upsert"
  | "source.edit"
  | "history.undo"
  | "history.redo"
  | "version.create"
  | "lifecycle.transition";

export type CommandScope = "read" | "capture" | "mutation" | "source-edit" | "destructive";

interface CommandEnvelopeBase<
  K extends CommandKind,
  P,
  S extends CommandScope,
  B extends string | null,
  A extends string | null,
> {
  readonly schemaVersion: "1.0.0";
  readonly commandId: string;
  readonly idempotencyId: string;
  readonly actor: {
    readonly id: string;
    readonly kind: "user" | "codex" | "system";
    readonly sessionId: string;
  };
  readonly projectId: string;
  readonly correlationId: string;
  readonly issuedAt: string;
  readonly capability: { readonly name: string; readonly version: string };
  readonly payloadVersion: "1.0.0";
  readonly affectedEntityIds: readonly string[];
  readonly declaredScope: S;
  readonly validationOnly: boolean;
  readonly baseRevisionId: B;
  readonly authorizationId: A;
  readonly kind: K;
  readonly payload: P;
}

export type ReadInspectCommand = CommandEnvelopeBase<
  "read.inspect",
  { readonly query: string },
  "read",
  null,
  null
>;
export type CaptureCreateCommand = CommandEnvelopeBase<
  "capture.create",
  { readonly label: string },
  "capture",
  null,
  null
>;
export type ProjectRenameCommand = CommandEnvelopeBase<
  "project.rename",
  { readonly title: string },
  "mutation",
  string,
  null
>;
export type TimelineReplaceCommand = CommandEnvelopeBase<
  "timeline.replace",
  { readonly timeline: TimelineDocument },
  "destructive",
  string,
  string
>;
export type TimelineEditCommand = CommandEnvelopeBase<
  "timeline.edit",
  { readonly operation: JsonValue },
  "mutation",
  string,
  null
>;
export type AudioEditCommand = CommandEnvelopeBase<
  "audio.edit",
  { readonly operation: JsonValue },
  "mutation",
  string,
  null
>;
export type LanguageEditCommand = CommandEnvelopeBase<
  "language.edit",
  { readonly operation: JsonValue },
  "mutation",
  string,
  null
>;
export type AnnotationEditCommand = CommandEnvelopeBase<
  "annotation.edit",
  {
    readonly operation:
      | Readonly<{ kind: "annotation.create"; annotation: AnnotationDocument }>
      | Readonly<{
          kind: "annotation.update";
          annotationId: string;
          changes: Readonly<
            Partial<Omit<AnnotationDocument, "schemaVersion" | "id" | "projectId" | "createdAt">>
          >;
        }>
      | Readonly<{ kind: "annotation.delete"; annotationId: string }>;
  },
  "mutation",
  string,
  null
>;
export type ReviewEditCommand = CommandEnvelopeBase<
  "review.edit",
  { readonly operation: JsonValue },
  "mutation",
  string,
  null
>;
export type AssetRegisterCommand = CommandEnvelopeBase<
  "asset.register",
  { readonly asset: AssetRecord },
  "mutation",
  string,
  null
>;
export type AssetRelinkCommand = CommandEnvelopeBase<
  "asset.relink",
  { readonly assetId: string; readonly newPath: string; readonly observedContentHash: string },
  "mutation",
  string,
  null
>;
export type AssetReplaceCommand = CommandEnvelopeBase<
  "asset.replace",
  { readonly expectedContentHash: string; readonly asset: AssetRecord },
  "mutation",
  string,
  null
>;
export type AssetManifestUpsertCommand = CommandEnvelopeBase<
  "asset.manifest.upsert",
  {
    readonly manifestType: "rights" | "curation" | "fonts";
    readonly asset: AssetRecord;
    readonly content: string;
  },
  "mutation",
  string,
  null
>;
export type SourceEditCommand = CommandEnvelopeBase<
  "source.edit",
  { readonly path: string; readonly expectedHash: string; readonly content: string },
  "source-edit",
  string,
  null
>;
export type HistoryMoveCommand = CommandEnvelopeBase<
  "history.undo" | "history.redo",
  { readonly steps: number },
  "mutation",
  string,
  null
>;
export type VersionCreateCommand = CommandEnvelopeBase<
  "version.create",
  {
    readonly name: "Draft" | "Review" | "Approved" | "Delivery Candidate" | "Delivered";
    readonly outputId: string | null;
  },
  "mutation",
  string,
  null
>;
export type LifecycleTransitionCommand = CommandEnvelopeBase<
  "lifecycle.transition",
  {
    readonly to: QaState;
    readonly outputId: string | null;
    readonly evidenceHashes: readonly string[];
    readonly exceptionIds: readonly string[];
  },
  "mutation",
  string,
  null
>;

export type ProjectCommandEnvelope =
  | ReadInspectCommand
  | CaptureCreateCommand
  | ProjectRenameCommand
  | TimelineEditCommand
  | AudioEditCommand
  | LanguageEditCommand
  | AnnotationEditCommand
  | ReviewEditCommand
  | TimelineReplaceCommand
  | AssetRegisterCommand
  | AssetRelinkCommand
  | AssetReplaceCommand
  | AssetManifestUpsertCommand
  | SourceEditCommand
  | HistoryMoveCommand
  | VersionCreateCommand
  | LifecycleTransitionCommand;

export type CommandEnvelopeValidationResult =
  | { readonly ok: true; readonly value: ProjectCommandEnvelope }
  | { readonly ok: false; readonly issues: readonly StructuralValidationIssue[] };

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
const validator: ValidateFunction = ajv.compile(commandEnvelopeJsonSchema);

export const validateCommandEnvelope = (value: unknown): CommandEnvelopeValidationResult => {
  if (validator(value)) return { ok: true, value: value as ProjectCommandEnvelope };
  return { ok: false, issues: (validator.errors ?? []).map(toIssue) };
};

export const assertCommandEnvelope = (value: unknown): ProjectCommandEnvelope => {
  const result = validateCommandEnvelope(value);
  if (result.ok) return result.value;
  throw new ChaiError({
    category: "schema",
    code: "command.envelope.invalid",
    correlationId: createCorrelationId(),
    stage: "command-ingress",
    message: `Command envelope failed structural validation at ${result.issues[0]?.path ?? "/"}.`,
    repairHint: result.issues[0]?.message ?? "Repair the envelope to match command schema 1.0.0.",
    details: { issues: result.issues },
  });
};

export { commandEnvelopeJsonSchema };

const toIssue = (error: ErrorObject): StructuralValidationIssue => ({
  path: error.instancePath || "/",
  keyword: error.keyword,
  message: error.message ?? "Schema constraint failed.",
  params: error.params,
});
