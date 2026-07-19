import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { assertCommandEnvelope, type ProjectCommandEnvelope } from "./command-envelope.js";
import { sha256CanonicalJson, stringifyCanonicalJson } from "./canonical-json.js";
import { acquireProjectMutationLock } from "./project-lock.js";
import {
  commitProjectRevision,
  loadCurrentProjectRevision,
  loadProjectRevision,
  type LoadedProjectRevision,
  type RevisionContentDocuments,
} from "./revision-store.js";
import type {
  AssetRecord,
  AssetsDocument,
  TimelineDocument,
  TransactionDocument,
} from "./project-documents.js";
import type { JsonValue } from "./canonical-json.js";
import { assertProjectDocument, type NamedVersionsDocument } from "./project-documents.js";
import { assertNoAsyncOperationBarriers } from "./operation-barrier.js";

export type CommandExecutionStatus = "validated" | "committed" | "failed";

export interface CommandExecutionReceipt {
  readonly schemaVersion: "1.0.0";
  readonly commandId: string;
  readonly idempotencyId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly correlationId: string;
  readonly commandEnvelopeHash: string;
  readonly status: CommandExecutionStatus;
  readonly replayed: boolean;
  readonly recordedAt: string;
  readonly baseRevisionId: string | null;
  readonly resultingRevisionId: string | null;
  readonly revisionHash: string | null;
  readonly warnings: readonly string[];
  readonly error: {
    readonly code: string;
    readonly category: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
}

export interface ExecuteProjectCommandOptions {
  readonly now?: () => Date;
  readonly revisionId?: string;
  readonly lockTtlMs?: number;
  readonly validateSource?: (
    source: Readonly<{ path: string; content: string; engine: "remotion" | "hyperframes" | "shared" }>,
  ) => Promise<Readonly<{ valid: boolean; message?: string }>>;
  readonly invalidateSourceCaches?: (
    source: Readonly<{ path: string; beforeHash: string; afterHash: string }>,
  ) => Promise<void>;
  readonly invalidateAssetCaches?: (
    asset: Readonly<{ assetId: string; beforeHash: string; afterHash: string }>,
  ) => Promise<void>;
  readonly applyTimelineEdit?: (
    timeline: TimelineDocument,
    operation: JsonValue,
    revisionId: string,
  ) => Readonly<{
    timeline: TimelineDocument;
    label: string;
    diffSummary: string;
    affectedEntityIds: readonly string[];
    warnings?: readonly string[];
  }>;
  readonly applyAudioEdit?: (
    timeline: TimelineDocument,
    operation: JsonValue,
    revisionId: string,
  ) => Readonly<{
    timeline: TimelineDocument;
    label: string;
    diffSummary: string;
    affectedEntityIds: readonly string[];
    warnings?: readonly string[];
  }>;
  readonly applyLanguageEdit?: (
    timeline: TimelineDocument,
    operation: JsonValue,
    revisionId: string,
  ) => Readonly<{
    timeline: TimelineDocument;
    label: string;
    diffSummary: string;
    affectedEntityIds: readonly string[];
    warnings?: readonly string[];
  }>;
  readonly applyAnnotationEdit?: (
    timeline: TimelineDocument,
    operation: unknown,
    revisionId: string,
  ) => Readonly<{
    timeline: TimelineDocument;
    label: string;
    diffSummary: string;
    affectedEntityIds: readonly string[];
    warnings?: readonly string[];
  }>;
  readonly applyReviewEdit?: (
    timeline: TimelineDocument,
    operation: JsonValue,
    revisionId: string,
  ) => Readonly<{
    timeline: TimelineDocument;
    label: string;
    diffSummary: string;
    affectedEntityIds: readonly string[];
    warnings?: readonly string[];
  }>;
}

export const executeProjectCommand = async (
  rootPath: string,
  input: unknown,
  options: ExecuteProjectCommandOptions = {},
): Promise<CommandExecutionReceipt> => {
  const command = assertCommandEnvelope(input);
  if (command.declaredScope === "read" || command.declaredScope === "capture") {
    throw commandError(
      "command.executor.non-mutation",
      `${command.kind} belongs to a non-mutating execution service.`,
      false,
    );
  }
  const root = path.resolve(rootPath);
  const now = options.now ?? (() => new Date());
  const envelopeHash = sha256CanonicalJson(command);
  const receiptPath = commandReceiptPath(root, command);
  const existing = await readReceipt(receiptPath);
  if (existing !== null) return replayReceipt(existing, command, envelopeHash);

  const lock = await acquireProjectMutationLock(root, {
    ownerId: command.actor.id,
    sessionId: command.actor.sessionId,
    ttlMs: options.lockTtlMs ?? 15_000,
    now,
  });
  try {
    const afterLock = await readReceipt(receiptPath);
    if (afterLock !== null) return replayReceipt(afterLock, command, envelopeHash);
    const current = await loadCurrentProjectRevision(root);
    if (current.project.projectId !== command.projectId) {
      return await persistFailure(
        receiptPath,
        command,
        envelopeHash,
        now(),
        commandError("command.project.mismatch", "Command project ID does not own this folder.", false),
      );
    }
    if (command.baseRevisionId !== current.pointer.revisionId) {
      return await persistFailure(
        receiptPath,
        command,
        envelopeHash,
        now(),
        commandError(
          "command.base-revision.stale",
          `Refresh required: current revision is ${current.pointer.revisionId}.`,
          true,
        ),
      );
    }
    if (command.validationOnly) {
      const receipt = baseReceipt(command, envelopeHash, now(), "validated", false, {
        resultingRevisionId: null,
        revisionHash: null,
        warnings: [],
        error: null,
      });
      await writeReceipt(receiptPath, receipt);
      return receipt;
    }

    try {
      const plannedRevisionId = options.revisionId ?? `revision-${randomUUID()}`;
      const mutation = await applyCommand(
        root,
        current,
        command,
        now(),
        plannedRevisionId,
        options.validateSource,
        options.invalidateSourceCaches,
        options.invalidateAssetCaches,
        options.applyTimelineEdit,
        options.applyAudioEdit,
        options.applyLanguageEdit,
        options.applyAnnotationEdit,
        options.applyReviewEdit,
      );
      const result = await commitProjectRevision(root, {
        baseRevisionId: command.baseRevisionId,
        revisionId: plannedRevisionId,
        commandId: command.commandId,
        idempotencyId: command.idempotencyId,
        correlationId: command.correlationId,
        commandEnvelopeHash: envelopeHash,
        actor: command.actor,
        capability: command.capability,
        declaredScope: command.declaredScope,
        authorizationId: command.authorizationId,
        validationOnly: command.validationOnly,
        commandSummary: mutation.commandSummary,
        diffSummary: mutation.diffSummary,
        affectedEntityIds: command.affectedEntityIds,
        warnings: mutation.warnings,
        ...(mutation.sourceEdit === undefined ? {} : { sourceEdit: mutation.sourceEdit }),
        ...(mutation.history === undefined ? {} : { history: mutation.history }),
        ...(mutation.namedVersion === undefined ? {} : { namedVersion: mutation.namedVersion }),
        documents: mutation.documents,
        now: now(),
      });
      const receiptWarnings = [...mutation.warnings];
      if (mutation.materialize !== undefined) {
        try {
          await mutation.materialize();
        } catch (cause) {
          receiptWarnings.push(
            `Authoritative source committed but working-file materialization needs recovery: ${cause instanceof Error ? cause.message : "unknown error"}`,
          );
        }
      }
      const receipt = baseReceipt(command, envelopeHash, now(), "committed", false, {
        resultingRevisionId: result.pointer.revisionId,
        revisionHash: result.revisionHash,
        warnings: receiptWarnings,
        error: null,
      });
      await writeReceipt(receiptPath, receipt);
      return receipt;
    } catch (cause) {
      return await persistFailure(receiptPath, command, envelopeHash, now(), normalizeCommandError(cause));
    }
  } finally {
    await lock.release();
  }
};

interface AppliedCommand {
  readonly documents: RevisionContentDocuments;
  readonly commandSummary: string;
  readonly diffSummary: string;
  readonly warnings: readonly string[];
  readonly sourceEdit?: TransactionDocument["sourceEdit"];
  readonly history?: TransactionDocument["history"];
  readonly namedVersion?: TransactionDocument["namedVersion"];
  readonly materialize?: () => Promise<void>;
}

const applyCommand = async (
  root: string,
  current: LoadedProjectRevision,
  command: ProjectCommandEnvelope,
  timestamp: Date,
  plannedRevisionId: string,
  validateSource: ExecuteProjectCommandOptions["validateSource"],
  invalidateSourceCaches: ExecuteProjectCommandOptions["invalidateSourceCaches"],
  invalidateAssetCaches: ExecuteProjectCommandOptions["invalidateAssetCaches"],
  applyTimelineEdit: ExecuteProjectCommandOptions["applyTimelineEdit"],
  applyAudioEdit: ExecuteProjectCommandOptions["applyAudioEdit"],
  applyLanguageEdit: ExecuteProjectCommandOptions["applyLanguageEdit"],
  applyAnnotationEdit: ExecuteProjectCommandOptions["applyAnnotationEdit"],
  applyReviewEdit: ExecuteProjectCommandOptions["applyReviewEdit"],
): Promise<AppliedCommand> => {
  const documents = currentContent(current);
  switch (command.kind) {
    case "project.rename":
      return {
        documents: { ...documents, project: { ...documents.project, title: command.payload.title } },
        commandSummary: "Rename project",
        diffSummary: `Changed project title from ${JSON.stringify(current.project.title)} to ${JSON.stringify(command.payload.title)}.`,
        warnings: [],
      };
    case "asset.register": {
      if (!command.affectedEntityIds.includes(command.payload.asset.id)) {
        throw commandError(
          "command.affected-entities.incomplete",
          "Registered asset ID must appear in affectedEntityIds.",
          false,
        );
      }
      return {
        documents: {
          ...documents,
          assets: { ...documents.assets, assets: [...documents.assets.assets, command.payload.asset] },
        },
        commandSummary: "Register asset",
        diffSummary: `Registered ${command.payload.asset.path} as ${command.payload.asset.id}.`,
        warnings:
          command.payload.asset.rights === "unknown" ? ["Asset rights are unknown and require review."] : [],
      };
    }
    case "asset.relink": {
      assertAffectedAsset(command.affectedEntityIds, command.payload.assetId);
      const before = requireRegisteredAsset(current, command.payload.assetId);
      if (command.payload.observedContentHash !== before.contentHash) {
        throw commandError(
          "asset.relink.hash-mismatch",
          "Relink selected different bytes; use asset.replace explicitly.",
          false,
        );
      }
      assertAssetPathAvailable(current, command.payload.assetId, command.payload.newPath);
      const after = { ...before, path: command.payload.newPath, validationState: "valid" as const };
      return {
        documents: { ...documents, assets: replaceRegisteredAsset(documents.assets, after) },
        commandSummary: "Relink asset",
        diffSummary: `Relinked ${before.id} from ${before.path} to ${after.path} without changing content identity.`,
        warnings: [],
        materialize: async () => {
          await invalidateAssetCaches?.({
            assetId: before.id,
            beforeHash: before.contentHash,
            afterHash: after.contentHash,
          });
        },
      };
    }
    case "asset.replace": {
      const before = requireRegisteredAsset(current, command.payload.asset.id);
      assertAffectedAsset(command.affectedEntityIds, before.id);
      if (before.contentHash !== command.payload.expectedContentHash) {
        throw commandError(
          "asset.replace.precondition-failed",
          "Registered source changed before replacement could be applied.",
          true,
        );
      }
      assertAssetPathAvailable(current, before.id, command.payload.asset.path);
      const after = command.payload.asset;
      return {
        documents: { ...documents, assets: replaceRegisteredAsset(documents.assets, after) },
        commandSummary: "Replace asset",
        diffSummary: `Replaced source bytes for ${before.id} from ${before.contentHash.slice(0, 12)} to ${after.contentHash.slice(0, 12)} while preserving logical identity.`,
        warnings: after.rights === "unknown" ? ["Replacement asset rights require review."] : [],
        materialize: async () => {
          await invalidateAssetCaches?.({
            assetId: before.id,
            beforeHash: before.contentHash,
            afterHash: after.contentHash,
          });
        },
      };
    }
    case "asset.manifest.upsert": {
      const asset = command.payload.asset;
      const authorityPath = manifestAuthorityPath(command.payload.manifestType);
      assertAffectedAsset(command.affectedEntityIds, asset.id);
      assertManifestAsset(command.payload.manifestType, asset, command.payload.content);
      assertAssetPathAvailable(current, asset.id, asset.path);
      const exists = current.assets.assets.some((candidate) => candidate.id === asset.id);
      return {
        documents: {
          ...documents,
          project: {
            ...documents.project,
            sources: {
              ...documents.project.sources,
              [authorityPath]: {
                engine: "shared",
                contentHash: asset.contentHash,
                content: command.payload.content,
              },
            },
          },
          assets: {
            ...documents.assets,
            assets: exists
              ? documents.assets.assets.map((candidate) => (candidate.id === asset.id ? asset : candidate))
              : [...documents.assets.assets, asset],
          },
        },
        commandSummary: "Update asset manifest",
        diffSummary: `${exists ? "Updated" : "Registered"} ${command.payload.manifestType} manifest ${asset.path} with hash ${asset.contentHash.slice(0, 12)}.`,
        warnings: [],
        materialize: async () => {
          await writeWorkingSource(resolveProjectPath(root, authorityPath), command.payload.content);
          await writeWorkingSource(resolveProjectPath(root, asset.path), command.payload.content);
        },
      };
    }
    case "timeline.replace":
      return {
        documents: { ...documents, timeline: command.payload.timeline },
        commandSummary: "Replace timeline",
        diffSummary: `Replaced timeline ${current.timeline.timelineId} under authorization ${command.authorizationId}.`,
        warnings: [],
      };
    case "timeline.edit": {
      if (applyTimelineEdit === undefined) {
        throw commandError(
          "timeline.edit.executor-unavailable",
          "The timeline command executor is unavailable.",
          true,
        );
      }
      const result = applyTimelineEdit(documents.timeline, command.payload.operation, plannedRevisionId);
      const undeclared = result.affectedEntityIds.filter(
        (entityId) => !command.affectedEntityIds.includes(entityId),
      );
      if (undeclared.length > 0) {
        throw commandError(
          "command.affected-entities.incomplete",
          `Timeline edit omitted affected entity ${undeclared[0] ?? "unknown"}.`,
          false,
        );
      }
      return {
        documents: { ...documents, timeline: result.timeline },
        commandSummary: result.label,
        diffSummary: result.diffSummary,
        warnings: result.warnings ?? [],
      };
    }
    case "audio.edit": {
      if (applyAudioEdit === undefined) {
        throw commandError(
          "audio.edit.executor-unavailable",
          "The audio graph command executor is unavailable.",
          true,
        );
      }
      const result = applyAudioEdit(documents.timeline, command.payload.operation, plannedRevisionId);
      const undeclared = result.affectedEntityIds.filter(
        (entityId) => !command.affectedEntityIds.includes(entityId),
      );
      if (undeclared.length > 0) {
        throw commandError(
          "command.affected-entities.incomplete",
          `Audio edit omitted affected entity ${undeclared[0] ?? "unknown"}.`,
          false,
        );
      }
      return {
        documents: { ...documents, timeline: result.timeline },
        commandSummary: result.label,
        diffSummary: result.diffSummary,
        warnings: result.warnings ?? [],
      };
    }
    case "language.edit": {
      if (applyLanguageEdit === undefined) {
        throw commandError(
          "language.edit.executor-unavailable",
          "The transcript and caption command executor is unavailable.",
          true,
        );
      }
      const result = applyLanguageEdit(documents.timeline, command.payload.operation, plannedRevisionId);
      const undeclared = result.affectedEntityIds.filter(
        (entityId) => !command.affectedEntityIds.includes(entityId),
      );
      if (undeclared.length > 0) {
        throw commandError(
          "command.affected-entities.incomplete",
          `Language edit omitted affected entity ${undeclared[0] ?? "unknown"}.`,
          false,
        );
      }
      return {
        documents: { ...documents, timeline: result.timeline },
        commandSummary: result.label,
        diffSummary: result.diffSummary,
        warnings: result.warnings ?? [],
      };
    }
    case "annotation.edit": {
      if (applyAnnotationEdit === undefined) {
        throw commandError(
          "annotation.edit.executor-unavailable",
          "The annotation command executor is unavailable.",
          true,
        );
      }
      const result = applyAnnotationEdit(documents.timeline, command.payload.operation, plannedRevisionId);
      const undeclared = result.affectedEntityIds.filter(
        (entityId) => !command.affectedEntityIds.includes(entityId),
      );
      if (undeclared.length > 0) {
        throw commandError(
          "command.affected-entities.incomplete",
          `Annotation edit omitted affected entity ${undeclared[0] ?? "unknown"}.`,
          false,
        );
      }
      return {
        documents: { ...documents, timeline: result.timeline },
        commandSummary: result.label,
        diffSummary: result.diffSummary,
        warnings: result.warnings ?? [],
      };
    }
    case "review.edit": {
      if (applyReviewEdit === undefined) {
        throw commandError(
          "review.edit.executor-unavailable",
          "The review command executor is unavailable.",
          true,
        );
      }
      const result = applyReviewEdit(documents.timeline, command.payload.operation, plannedRevisionId);
      const undeclared = result.affectedEntityIds.filter(
        (entityId) => !command.affectedEntityIds.includes(entityId),
      );
      if (undeclared.length > 0) {
        throw commandError(
          "command.affected-entities.incomplete",
          `Review edit omitted affected entity ${undeclared[0] ?? "unknown"}.`,
          false,
        );
      }
      return {
        documents: { ...documents, timeline: result.timeline },
        commandSummary: result.label,
        diffSummary: result.diffSummary,
        warnings: result.warnings ?? [],
      };
    }
    case "lifecycle.transition":
      return {
        documents: {
          ...documents,
          approvalState: {
            ...documents.approvalState,
            state: command.payload.to,
            outputId: command.payload.outputId,
            updatedAt: timestamp.toISOString(),
            history: [
              ...documents.approvalState.history,
              {
                from: documents.approvalState.state,
                to: command.payload.to,
                actorId: command.actor.id,
                at: timestamp.toISOString(),
                evidenceHashes: command.payload.evidenceHashes,
                exceptionIds: command.payload.exceptionIds,
              },
            ],
          },
        },
        commandSummary: "Transition lifecycle",
        diffSummary: `Transitioned output lifecycle from ${documents.approvalState.state ?? "unrendered"} to ${command.payload.to}.`,
        warnings: command.payload.exceptionIds.map((id) => `Approved exception: ${id}`),
      };
    case "source.edit": {
      const engine = sourceEngine(command.payload.path);
      const sourcePath = resolveProjectPath(root, command.payload.path);
      let beforeContent: string;
      try {
        beforeContent = await readFile(sourcePath, "utf8");
      } catch (cause) {
        throw commandError(
          "source.edit.read-failed",
          cause instanceof Error ? cause.message : "Unable to read source file.",
          true,
          cause,
        );
      }
      const beforeHash = hashText(beforeContent);
      const afterHash = hashText(command.payload.content);
      if (beforeHash !== command.payload.expectedHash) {
        const quarantinePath = await quarantineSourceCandidate(
          root,
          command.commandId,
          command.payload.content,
        );
        throw commandError(
          "source.edit.external-change",
          `Working source changed outside Chai Studio; candidate quarantined at ${path.relative(root, quarantinePath)}.`,
          false,
        );
      }
      const validation =
        validateSource === undefined
          ? validateSourceDefault(command.payload.path, command.payload.content)
          : await validateSource({ path: command.payload.path, content: command.payload.content, engine });
      if (!validation.valid) {
        throw commandError(
          "source.edit.validation-failed",
          validation.message ?? "Source validation failed.",
          false,
        );
      }
      const sourceEdit = {
        path: command.payload.path,
        beforeHash,
        afterHash,
        diffHash: hashText(createSourceDiff(command.payload.path, beforeContent, command.payload.content)),
      } as const;
      return {
        documents: {
          ...documents,
          project: {
            ...documents.project,
            sources: {
              ...documents.project.sources,
              [command.payload.path]: { engine, contentHash: afterHash, content: command.payload.content },
            },
          },
        },
        commandSummary: "Edit native source",
        diffSummary: `Updated ${command.payload.path} from ${beforeHash.slice(0, 12)} to ${afterHash.slice(0, 12)}.`,
        warnings: [],
        sourceEdit,
        materialize: async () => {
          const diffPath = path.join(root, "receipts", "source-edits", `${command.commandId}.diff`);
          await writeWorkingSource(
            diffPath,
            createSourceDiff(command.payload.path, beforeContent, command.payload.content),
          );
          await writeWorkingSource(sourcePath, command.payload.content);
          await invalidateSourceCaches?.({ path: command.payload.path, beforeHash, afterHash });
        },
      };
    }
    case "history.undo": {
      await assertNoAsyncOperationBarriers(root);
      const history = current.transaction.history;
      if (command.payload.steps > history.undoStack.length) {
        throw commandError(
          "history.undo.exhausted",
          `Cannot undo ${String(command.payload.steps)} step(s); only ${String(history.undoStack.length)} available.`,
          false,
        );
      }
      const undoStack = [...history.undoStack];
      const redoStack = [...history.redoStack];
      let contentRevisionId = history.contentRevisionId;
      for (let step = 0; step < command.payload.steps; step += 1) {
        const target = undoStack.pop();
        if (target === undefined)
          throw commandError("history.undo.exhausted", "Undo history is empty.", false);
        redoStack.push(contentRevisionId);
        contentRevisionId = target;
      }
      const target = await loadProjectRevision(root, contentRevisionId);
      return historyMutation(
        target,
        "undo",
        contentRevisionId,
        undoStack,
        redoStack,
        command.payload.steps,
        root,
        current,
        invalidateAssetCaches,
      );
    }
    case "history.redo": {
      await assertNoAsyncOperationBarriers(root);
      const history = current.transaction.history;
      if (command.payload.steps > history.redoStack.length) {
        throw commandError(
          "history.redo.exhausted",
          `Cannot redo ${String(command.payload.steps)} step(s); only ${String(history.redoStack.length)} available.`,
          false,
        );
      }
      const undoStack = [...history.undoStack];
      const redoStack = [...history.redoStack];
      let contentRevisionId = history.contentRevisionId;
      for (let step = 0; step < command.payload.steps; step += 1) {
        const target = redoStack.pop();
        if (target === undefined)
          throw commandError("history.redo.exhausted", "Redo history is empty.", false);
        undoStack.push(contentRevisionId);
        contentRevisionId = target;
      }
      const target = await loadProjectRevision(root, contentRevisionId);
      return historyMutation(
        target,
        "redo",
        contentRevisionId,
        undoStack,
        redoStack,
        command.payload.steps,
        root,
        current,
        invalidateAssetCaches,
      );
    }
    case "version.create":
      {
        assertVersionLifecycle(current, command.payload.name, command.payload.outputId);
        const namedVersion = {
          id: `${plannedRevisionId}:version`,
          name: command.payload.name,
          revisionId: plannedRevisionId,
          createdAt: timestamp.toISOString(),
          actorId: command.actor.id,
          outputId: command.payload.outputId,
        } as const;
        return {
          documents,
          commandSummary: "Create named version",
          diffSummary: `Created ${command.payload.name} milestone linked to revision ${plannedRevisionId}.`,
          warnings: [],
          namedVersion,
          materialize: async () => {
            await rebuildNamedVersions(root);
          },
        };
      }
      throw commandError(
        "command.handler.not-ready",
        `${command.kind} is reserved but its phase-specific handler is not active yet.`,
        false,
      );
    case "read.inspect":
    case "capture.create":
      throw commandError(
        "command.executor.non-mutation",
        "Non-mutation command reached mutation engine.",
        false,
      );
  }
};

export const rebuildNamedVersions = async (rootPath: string): Promise<NamedVersionsDocument> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const versions: NamedVersionsDocument["versions"][number][] = [];
  const visited = new Set<string>();
  let revisionId: string | null = current.pointer.revisionId;
  while (revisionId !== null && !visited.has(revisionId)) {
    visited.add(revisionId);
    const revision = await loadProjectRevision(root, revisionId);
    if (revision.transaction.namedVersion !== null) versions.push(revision.transaction.namedVersion);
    revisionId = revision.transaction.parentRevisionId;
  }
  const document: NamedVersionsDocument = {
    schemaVersion: "1.0.0",
    projectId: current.project.projectId,
    versions: versions.reverse(),
  };
  assertProjectDocument("named-versions", document);
  await replaceRootJsonAtomically(root, "named-versions.json", document);
  return document;
};

const assertVersionLifecycle = (
  current: LoadedProjectRevision,
  name: NamedVersionsDocument["versions"][number]["name"],
  outputId: string | null,
): void => {
  if (name === "Draft" || name === "Review") return;
  const requiredState = name === "Delivered" ? "delivered" : "approved";
  if (current.approvalState.state !== requiredState) {
    throw commandError(
      "version.lifecycle.not-ready",
      `${name} requires lifecycle state ${requiredState}.`,
      false,
    );
  }
  if (outputId === null || current.approvalState.outputId !== outputId) {
    throw commandError(
      "version.output.mismatch",
      `${name} must link the currently ${requiredState} output.`,
      false,
    );
  }
};

const historyMutation = (
  target: Pick<LoadedProjectRevision, "project" | "timeline" | "assets" | "settings" | "approvalState">,
  action: "undo" | "redo",
  contentRevisionId: string,
  undoStack: readonly string[],
  redoStack: readonly string[],
  steps: number,
  root: string,
  current: LoadedProjectRevision,
  invalidateAssetCaches: ExecuteProjectCommandOptions["invalidateAssetCaches"],
): AppliedCommand => ({
  documents: currentContent(target),
  commandSummary: action === "undo" ? "Undo project change" : "Redo project change",
  diffSummary: `${action === "undo" ? "Restored" : "Reapplied"} ${String(steps)} revision step(s) from ${contentRevisionId}.`,
  warnings: [],
  history: { action, contentRevisionId, undoStack, redoStack },
  materialize: async () => {
    await reconcileWorkingSources(root);
    const currentById = new Map(current.assets.assets.map((asset) => [asset.id, asset]));
    const targetById = new Map(target.assets.assets.map((asset) => [asset.id, asset]));
    for (const assetId of new Set([...currentById.keys(), ...targetById.keys()])) {
      const beforeHash = currentById.get(assetId)?.contentHash;
      const afterHash = targetById.get(assetId)?.contentHash;
      if (beforeHash !== undefined && afterHash !== undefined && beforeHash !== afterHash) {
        await invalidateAssetCaches?.({ assetId, beforeHash, afterHash });
      }
    }
  },
});

export const reconcileWorkingSources = async (rootPath: string): Promise<readonly string[]> => {
  const root = path.resolve(rootPath);
  const current = await loadCurrentProjectRevision(root);
  const repaired: string[] = [];
  for (const [relativePath, source] of Object.entries(current.project.sources)) {
    sourceEngine(relativePath);
    const sourcePath = resolveProjectPath(root, relativePath);
    let currentHash: string | null = null;
    try {
      currentHash = hashText(await readFile(sourcePath, "utf8"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    if (currentHash !== source.contentHash) {
      await writeWorkingSource(sourcePath, source.content);
      repaired.push(relativePath);
    }
    const mirrorPath = manifestMirrorPath(relativePath);
    if (mirrorPath !== null) {
      const mirrorTarget = resolveProjectPath(root, mirrorPath);
      let mirrorHash: string | null = null;
      try {
        mirrorHash = hashText(await readFile(mirrorTarget, "utf8"));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      if (mirrorHash !== source.contentHash) {
        await writeWorkingSource(mirrorTarget, source.content);
        repaired.push(mirrorPath);
      }
    }
  }
  const activeManifestMirrors = new Set(
    Object.keys(current.project.sources)
      .map(manifestMirrorPath)
      .filter((value): value is string => value !== null),
  );
  for (const relativePath of managedManifestPaths) {
    if (!(relativePath in current.project.sources) && !activeManifestMirrors.has(relativePath)) {
      const target = resolveProjectPath(root, relativePath);
      try {
        await rm(target);
        repaired.push(relativePath);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
  }
  return repaired;
};

const managedManifestPaths = [
  "scenes/shared/project-dependencies/asset-rights.json",
  "scenes/shared/project-dependencies/asset-curation.json",
  "scenes/shared/project-dependencies/font-manifest.json",
  "assets/metadata/asset-rights.json",
  "assets/metadata/asset-curation.json",
  "assets/fonts/font-manifest.json",
] as const;

const manifestAuthorityPath = (manifestType: "rights" | "curation" | "fonts"): string =>
  `scenes/shared/project-dependencies/${
    manifestType === "rights"
      ? "asset-rights.json"
      : manifestType === "curation"
        ? "asset-curation.json"
        : "font-manifest.json"
  }`;

const manifestMirrorPath = (authorityPath: string): string | null => {
  switch (authorityPath) {
    case "scenes/shared/project-dependencies/asset-rights.json":
      return "assets/metadata/asset-rights.json";
    case "scenes/shared/project-dependencies/asset-curation.json":
      return "assets/metadata/asset-curation.json";
    case "scenes/shared/project-dependencies/font-manifest.json":
      return "assets/fonts/font-manifest.json";
    default:
      return null;
  }
};

const assertAffectedAsset = (affectedEntityIds: readonly string[], assetId: string): void => {
  if (!affectedEntityIds.includes(assetId)) {
    throw commandError(
      "command.affected-entities.incomplete",
      `Asset ${assetId} must appear in affectedEntityIds.`,
      false,
    );
  }
};

const requireRegisteredAsset = (current: LoadedProjectRevision, assetId: string): AssetRecord => {
  const asset = current.assets.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) throw commandError("asset.id.unknown", `Unknown asset ID: ${assetId}.`, false);
  return asset;
};

const assertAssetPathAvailable = (
  current: LoadedProjectRevision,
  assetId: string,
  candidatePath: string,
): void => {
  assertCanonicalAssetPath(candidatePath);
  if (current.assets.assets.some((asset) => asset.id !== assetId && asset.path === candidatePath)) {
    throw commandError("asset.path.duplicate", `Asset path is already registered: ${candidatePath}.`, false);
  }
};

const replaceRegisteredAsset = (document: AssetsDocument, asset: AssetRecord): AssetsDocument => ({
  ...document,
  assets: document.assets.map((candidate) => (candidate.id === asset.id ? asset : candidate)),
});

const assertManifestAsset = (
  manifestType: "rights" | "curation" | "fonts",
  asset: AssetRecord,
  content: string,
): void => {
  const expectedPaths = {
    rights: "assets/metadata/asset-rights.json",
    curation: "assets/metadata/asset-curation.json",
    fonts: "assets/fonts/font-manifest.json",
  } as const;
  assertCanonicalAssetPath(asset.path);
  if (
    asset.kind !== "data" ||
    asset.path !== expectedPaths[manifestType] ||
    asset.contentHash !== hashText(content) ||
    asset.durationFrames !== null ||
    asset.fps !== null ||
    asset.hasAudio ||
    asset.hasAlpha ||
    asset.variableFrameRate ||
    asset.validationState !== "valid"
  ) {
    throw commandError(
      "asset.manifest.contract-invalid",
      `${manifestType} manifest asset does not match its canonical path, content hash, or data-asset contract.`,
      false,
    );
  }
  try {
    JSON.parse(content);
  } catch {
    throw commandError("asset.manifest.json-invalid", "Asset manifest content is not valid JSON.", false);
  }
};

const assertCanonicalAssetPath = (relativePath: string): void => {
  if (
    relativePath.includes("\\") ||
    relativePath.startsWith("./") ||
    relativePath.endsWith("/") ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw commandError("asset.path.non-canonical", `Asset path is not canonical: ${relativePath}.`, false);
  }
};

const currentContent = (
  current: Pick<LoadedProjectRevision, "project" | "timeline" | "assets" | "settings" | "approvalState">,
): RevisionContentDocuments => ({
  project: current.project,
  timeline: current.timeline,
  assets: current.assets,
  settings: current.settings,
  approvalState: current.approvalState,
});

const commandReceiptPath = (root: string, command: ProjectCommandEnvelope): string =>
  path.join(root, "receipts", "commands", command.actor.id, `${command.idempotencyId}.json`);

const readReceipt = async (filePath: string): Promise<CommandExecutionReceipt | null> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as CommandExecutionReceipt;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
};

const replayReceipt = (
  receipt: CommandExecutionReceipt,
  command: ProjectCommandEnvelope,
  envelopeHash: string,
): CommandExecutionReceipt => {
  if (receipt.commandId !== command.commandId || receipt.commandEnvelopeHash !== envelopeHash) {
    throw commandError(
      "command.idempotency.reused",
      "Idempotency ID was already used for a different command identity or payload.",
      false,
    );
  }
  return { ...receipt, replayed: true };
};

const persistFailure = async (
  receiptPath: string,
  command: ProjectCommandEnvelope,
  envelopeHash: string,
  recordedAt: Date,
  error: ChaiError,
): Promise<CommandExecutionReceipt> => {
  const receipt = baseReceipt(command, envelopeHash, recordedAt, "failed", false, {
    resultingRevisionId: null,
    revisionHash: null,
    warnings: [],
    error: {
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.details?.retryable === true,
    },
  });
  await writeReceipt(receiptPath, receipt);
  return receipt;
};

const baseReceipt = (
  command: ProjectCommandEnvelope,
  envelopeHash: string,
  recordedAt: Date,
  status: CommandExecutionStatus,
  replayed: boolean,
  outcome: Pick<CommandExecutionReceipt, "resultingRevisionId" | "revisionHash" | "warnings" | "error">,
): CommandExecutionReceipt => ({
  schemaVersion: "1.0.0",
  commandId: command.commandId,
  idempotencyId: command.idempotencyId,
  actorId: command.actor.id,
  sessionId: command.actor.sessionId,
  projectId: command.projectId,
  correlationId: command.correlationId,
  commandEnvelopeHash: envelopeHash,
  status,
  replayed,
  recordedAt: recordedAt.toISOString(),
  baseRevisionId: command.baseRevisionId,
  ...outcome,
});

const writeReceipt = async (filePath: string, receipt: CommandExecutionReceipt): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(stringifyCanonicalJson(receipt), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
    const directory = await open(path.dirname(filePath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
};

const replaceRootJsonAtomically = async (root: string, name: string, value: unknown): Promise<void> => {
  const temporary = path.join(root, `.${name}-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(stringifyCanonicalJson(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path.join(root, name));
    const directory = await open(root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
};

const sourceEngine = (relativePath: string): "remotion" | "hyperframes" | "shared" => {
  if (relativePath.startsWith("scenes/remotion/")) return "remotion";
  if (relativePath.startsWith("scenes/hyperframes/")) return "hyperframes";
  if (relativePath.startsWith("scenes/shared/")) return "shared";
  throw commandError(
    "source.edit.path-outside-scenes",
    "Editable source must be under scenes/remotion, scenes/hyperframes, or scenes/shared.",
    false,
  );
};

const resolveProjectPath = (root: string, relativePath: string): string => {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw commandError("source.edit.path-escape", "Source path escapes the project folder.", false);
  }
  return resolved;
};

const validateSourceDefault = (
  relativePath: string,
  content: string,
): Readonly<{ valid: boolean; message?: string }> => {
  if (content.includes("\0")) return { valid: false, message: "Source contains a NUL byte." };
  if (!/\.(?:[cm]?[jt]sx?|html|css|json)$/i.test(relativePath)) {
    return { valid: false, message: "Source extension is not editable by the baseline validator." };
  }
  if (relativePath.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch {
      return { valid: false, message: "JSON source is not syntactically valid." };
    }
  }
  return { valid: true };
};

const quarantineSourceCandidate = async (
  root: string,
  commandId: string,
  content: string,
): Promise<string> => {
  const directory = path.join(root, ".chai-cache", "quarantine", "source-edits");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${commandId}-${randomUUID()}.candidate.txt`);
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return target;
};

const writeWorkingSource = async (sourcePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(sourcePath), { recursive: true, mode: 0o700 });
  const temporary = `${sourcePath}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, sourcePath);
    const directory = await open(path.dirname(sourcePath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
};

const hashText = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");

const createSourceDiff = (relativePath: string, before: string, after: string): string => {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  return [
    `--- a/${relativePath}`,
    `+++ b/${relativePath}`,
    `@@ -1,${String(beforeLines.length)} +1,${String(afterLines.length)} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
};

const normalizeCommandError = (cause: unknown): ChaiError =>
  cause instanceof ChaiError
    ? cause
    : commandError(
        "command.execution.failed",
        cause instanceof Error ? cause.message : "Unknown command execution failure.",
        true,
        cause,
      );

const commandError = (code: string, message: string, retryable: boolean, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "schema",
    code,
    correlationId: createCorrelationId(),
    stage: "command-execution",
    message,
    repairHint: retryable
      ? "Refresh project state and retry with a new command."
      : "Repair the command before retrying.",
    details: { retryable },
    ...(cause === undefined ? {} : { cause }),
  });
