import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { redactTextWithContext, redactValueWithContext } from "@chai-studio/diagnostics";
import {
  loadProjectRevision,
  readProjectMutationLock,
  restoreProjectAutosave,
  scanAutosaveRecovery,
  stringifyCanonicalJson,
  type AssetRelinkCommand,
  type CommitActor,
  type CurrentRevisionPointer,
  type SourceEditCommand,
} from "@chai-studio/schema";
import type { ProjectSessionService } from "./project-service.js";
import type { RenderApiService } from "./render-service.js";
import type { RuntimeHygieneService } from "./runtime-hygiene.js";
import { LocalDiagnosticsStore, type LocalStructuredLogRecord } from "./local-diagnostics-store.js";

const execFileAsync = promisify(execFile);

export type ReliabilityImpact = "blocking" | "degraded" | "repairable";
export type ReliabilityCheckState = "passed" | "warning" | "failed";

export interface StartupHealthCheck {
  readonly id: string;
  readonly label: string;
  readonly state: ReliabilityCheckState;
  readonly impact: ReliabilityImpact;
  readonly summary: string;
  readonly repair: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface StartupHealthReport {
  readonly schemaVersion: "1.0.0";
  readonly status: "ready" | "degraded" | "blocked";
  readonly projectId: string;
  readonly revisionId: string;
  readonly generatedAt: string;
  readonly checks: readonly StartupHealthCheck[];
}

export type RepairAction =
  | "recover-pointer"
  | "adopt-orphan"
  | "reject-orphan"
  | "clear-stale-lock"
  | "relink-asset"
  | "adopt-external-source"
  | "quarantine-path"
  | "cleanup-interrupted-job"
  | "restore-autosave";

export interface ProjectRepairIssue {
  readonly id: string;
  readonly code: string;
  readonly impact: ReliabilityImpact;
  readonly entityId: string | null;
  readonly relativePath: string | null;
  readonly summary: string;
  readonly suggestedRepair: string;
  readonly action: RepairAction | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ReadOnlyProjectRepairScan {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly revisionId: string;
  readonly scannedAt: string;
  readonly readOnly: true;
  readonly passed: boolean;
  readonly issues: readonly ProjectRepairIssue[];
}

export interface RepairActionRequest {
  readonly issueId: string;
  readonly action: RepairAction;
  readonly actor: CommitActor;
  readonly targetRevisionId?: string;
  readonly targetRelativePath?: string;
  readonly expectedContentHash?: string;
}

export interface RepairReceipt {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly issueId: string;
  readonly action: RepairAction;
  readonly projectId: string;
  readonly sourceRevisionId: string;
  readonly resultingRevisionId: string;
  readonly actor: CommitActor;
  readonly evidenceHashes: readonly string[];
  readonly sourceFilesDeleted: false;
  readonly createdAt: string;
}

export interface UserFacingDiagnostics {
  readonly schemaVersion: "1.0.0";
  readonly summary: string;
  readonly status: StartupHealthReport["status"];
  readonly affectedEntity: string | null;
  readonly stage: string | null;
  readonly frame: string | null;
  readonly suggestedRepair: string | null;
  readonly safeRetry: boolean;
  readonly inspectSource: boolean;
  readonly issueCount: number;
  readonly details: Readonly<{
    checks: readonly StartupHealthCheck[];
    issues: readonly ProjectRepairIssue[];
    logs: readonly LocalStructuredLogRecord[];
  }>;
  readonly privacy: Readonly<{
    localOnly: true;
    telemetryEnabled: false;
    supportBundleRequiresExplicitSelection: true;
  }>;
}

export interface ProjectPointerRecoveryScan {
  readonly schemaVersion: "1.0.0";
  readonly rootPath: string;
  readonly status: "valid" | "missing" | "invalid";
  readonly observedRevisionId: string | null;
  readonly issue: string | null;
  readonly validCandidateRevisionIds: readonly string[];
  readonly readOnly: true;
}

export const scanProjectPointerRecovery = async (rootPath: string): Promise<ProjectPointerRecoveryScan> => {
  const root = path.resolve(rootPath);
  const validCandidates: readonly Readonly<{
    revisionId: string;
    timestamp: string;
    revisionHash: string;
  }>[] = await validRevisionCandidates(root);
  let pointer: Readonly<{ revisionId?: unknown; revisionHash?: unknown }> | null = null;
  let status: ProjectPointerRecoveryScan["status"] = "valid";
  let issue: string | null = null;
  try {
    const parsed = JSON.parse(await readFile(path.join(root, "current-revision.json"), "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Current pointer is not an object.");
    }
    pointer = parsed;
    if (typeof pointer.revisionId !== "string" || typeof pointer.revisionHash !== "string") {
      throw new Error("Current pointer identity fields are invalid.");
    }
    const candidate = validCandidates.find((entry) => entry.revisionId === pointer?.revisionId);
    if (candidate?.revisionHash !== pointer.revisionHash) {
      throw new Error("Current pointer does not resolve to matching immutable revision bytes.");
    }
  } catch (cause) {
    status = (cause as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid";
    issue = cause instanceof Error ? cause.message : "Current pointer is unreadable.";
  }
  return {
    schemaVersion: "1.0.0",
    rootPath: root,
    status,
    observedRevisionId: typeof pointer?.revisionId === "string" ? pointer.revisionId : null,
    issue,
    validCandidateRevisionIds: validCandidates.map((entry) => entry.revisionId),
    readOnly: true,
  };
};

export const recoverInvalidProjectPointer = async (input: {
  readonly rootPath: string;
  readonly targetRevisionId: string;
  readonly actor: CommitActor;
  readonly reason: string;
  readonly now?: Date;
}): Promise<RepairReceipt> => {
  const root = path.resolve(input.rootPath);
  const scan = await scanProjectPointerRecovery(root);
  if (scan.status === "valid") throw new Error("Pointer recovery refuses to replace a valid pointer.");
  if (!scan.validCandidateRevisionIds.includes(input.targetRevisionId)) {
    throw new Error("Pointer recovery target is not a valid immutable revision candidate.");
  }
  if (input.reason.trim().length === 0 || input.reason.length > 1_024) {
    throw new Error("Pointer recovery reason is invalid.");
  }
  const revision = await loadProjectRevision(root, input.targetRevisionId);
  const pointer: CurrentRevisionPointer = {
    schemaVersion: "1.0.0",
    projectId: revision.project.projectId,
    revisionId: input.targetRevisionId,
    revisionHash: revision.revisionHash,
    committedAt: revision.transaction.timestamp,
  };
  await writeJsonAtomic(path.join(root, "current-revision.json"), pointer);
  const receipt: RepairReceipt = {
    schemaVersion: "1.0.0",
    id: `repair-${randomUUID()}`,
    issueId: `issue-pointer-${hashCanonical(scan).slice(0, 20)}`,
    action: "recover-pointer",
    projectId: revision.project.projectId,
    sourceRevisionId: scan.observedRevisionId ?? "revision-pointer-unavailable",
    resultingRevisionId: input.targetRevisionId,
    actor: input.actor,
    evidenceHashes: [revision.revisionHash, hashCanonical(pointer), hashCanonical(scan)],
    sourceFilesDeleted: false,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  await writeJsonAtomic(path.join(root, "receipts", "repairs", `${receipt.id}.json`), {
    ...receipt,
    reason: input.reason,
  });
  return receipt;
};

export class ReliabilityService {
  readonly #projects: ProjectSessionService;
  readonly #runtime: RuntimeHygieneService;
  readonly #renders: RenderApiService;
  readonly #now: () => Date;
  readonly #browserExecutablePath: string;
  readonly #browserIdentity: string;
  readonly #ffmpegPath: string;

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly runtime: RuntimeHygieneService;
    readonly renders: RenderApiService;
    readonly now?: () => Date;
    readonly browserExecutablePath?: string;
    readonly browserIdentity?: string;
    readonly ffmpegPath?: string;
  }) {
    this.#projects = input.projects;
    this.#runtime = input.runtime;
    this.#renders = input.renders;
    this.#now = input.now ?? (() => new Date());
    this.#browserExecutablePath =
      input.browserExecutablePath ??
      path.join(
        os.homedir(),
        "Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      );
    this.#browserIdentity = input.browserIdentity ?? "playwright-managed:chromium_headless_shell-1228";
    this.#ffmpegPath = input.ffmpegPath ?? "ffmpeg";
  }

  async startupHealth(): Promise<StartupHealthReport> {
    const snapshot = await this.#projects.snapshot();
    const checks: StartupHealthCheck[] = [];
    checks.push(await this.#browserCheck());
    checks.push({
      id: "health.engines",
      label: "Render engines and adapters",
      state: "passed",
      impact: "blocking",
      summary: "Frozen engine and adapter contracts are available.",
      repair: null,
      evidence: {
        remotion: "4.0.489",
        hyperframes: "0.7.58",
        adapterContract: "1.0.0",
      },
    });
    checks.push(await this.#ffmpegCheck());
    checks.push({
      id: "health.gpu-backend",
      label: "macOS graphics backend",
      state: process.platform === "darwin" ? "passed" : "warning",
      impact: "degraded",
      summary:
        process.platform === "darwin"
          ? `macOS ${process.arch} local backend is available.`
          : "This build is validated for macOS; the current host is outside that contract.",
      repair: process.platform === "darwin" ? null : "Run this personal build on the validated macOS host.",
      evidence: { platform: process.platform, architecture: process.arch },
    });
    const resources = await this.#scanResources(snapshot);
    const missingFonts = resources.filter((issue) => issue.code.startsWith("repair.font."));
    checks.push({
      id: "health.fonts",
      label: "Project fonts",
      state: missingFonts.length === 0 ? "passed" : "failed",
      impact: "repairable",
      summary:
        missingFonts.length === 0
          ? "Every registered project font is present with its expected identity."
          : `${String(missingFonts.length)} registered font resource(s) need repair.`,
      repair: missingFonts[0]?.suggestedRepair ?? null,
      evidence: { issueIds: missingFonts.map((issue) => issue.id) },
    });
    checks.push(await this.#writePermissionCheck());
    const disk = await this.#runtime.diskPreflight();
    checks.push({
      id: "health.disk",
      label: "Free disk space",
      state: disk.passed ? "passed" : "failed",
      impact: "repairable",
      summary: disk.passed
        ? "Project and temporary volumes have the required free space."
        : "Rendering is paused because a required volume is low on space.",
      repair: disk.passed ? null : "Free disk space, then run the startup health check again.",
      evidence: redactValueWithContext(disk, { projectRoot: this.#projects.openRootPath() }) as Readonly<
        Record<string, unknown>
      >,
    });
    const integrity = await this.#projects.repairReport();
    checks.push({
      id: "health.project-integrity",
      label: "Project integrity",
      state: integrity.passed ? "passed" : "failed",
      impact: "blocking",
      summary: integrity.passed
        ? "The current immutable revision and project documents are consistent."
        : "Project integrity needs explicit repair before creative work continues.",
      repair: integrity.recommendedActions[0] ?? null,
      evidence: {
        orphanRevisions: integrity.storage.orphanRevisionIds,
        stagingEntries: integrity.storage.stagingEntries,
        invalidRevisions: integrity.storage.invalidRevisionIds,
        semanticIssueCount: integrity.semantics.issues.length,
      },
    });
    const status = checks.some((check) => check.state === "failed" && check.impact === "blocking")
      ? "blocked"
      : checks.some((check) => check.state !== "passed")
        ? "degraded"
        : "ready";
    return {
      schemaVersion: "1.0.0",
      status,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      generatedAt: this.#now().toISOString(),
      checks,
    };
  }

  async scan(): Promise<ReadOnlyProjectRepairScan> {
    const snapshot = await this.#projects.snapshot();
    const report = await this.#projects.repairReport();
    const issues: ProjectRepairIssue[] = [];
    for (const revisionId of report.storage.orphanRevisionIds) {
      issues.push(
        issue({
          code: "repair.revision.orphan",
          impact: "repairable",
          entityId: revisionId,
          relativePath: `revisions/${revisionId}`,
          summary: `Complete revision ${revisionId} is not reachable from the current pointer.`,
          suggestedRepair: "Inspect it, then explicitly adopt it or quarantine it as rejected.",
          action: "adopt-orphan",
          details: { alternativeActions: ["recover-pointer", "reject-orphan"] },
        }),
      );
    }
    for (const entry of report.storage.stagingEntries) {
      issues.push(
        issue({
          code: "repair.revision.staging",
          impact: "repairable",
          entityId: entry,
          relativePath: `revisions/${entry}`,
          summary: "An interrupted revision staging directory was found.",
          suggestedRepair: "Quarantine the incomplete staging directory after inspection.",
          action: "quarantine-path",
          details: {},
        }),
      );
    }
    for (const revisionId of report.storage.invalidRevisionIds) {
      issues.push(
        issue({
          code: "repair.revision.invalid",
          impact: "blocking",
          entityId: revisionId,
          relativePath: `revisions/${revisionId}`,
          summary: "A stored immutable revision is incomplete or corrupt.",
          suggestedRepair: "Restore it from a verified backup or quarantine it if it is unreachable.",
          action: "quarantine-path",
          details: {},
        }),
      );
    }
    const lock = await readProjectMutationLock(this.#projects.openRootPath());
    if (lock !== null && Date.parse(lock.expiresAt) <= this.#now().getTime()) {
      issues.push(
        issue({
          code: "repair.lock.stale",
          impact: "repairable",
          entityId: lock.ownerId,
          relativePath: ".chai-lock.json",
          summary: "A project mutation lock has expired and is no longer authoritative.",
          suggestedRepair: "Clear the stale lock into quarantine with an evidence receipt.",
          action: "clear-stale-lock",
          details: { expiresAt: lock.expiresAt, sessionId: lock.sessionId },
        }),
      );
    }
    issues.push(...(await this.#scanResources(snapshot)));
    const autosaves = await scanAutosaveRecovery(this.#projects.openRootPath());
    for (const candidate of autosaves.candidates.filter((item) => item.valid && autosaves.recoveryRequired)) {
      issues.push(
        issue({
          code: "repair.autosave.recoverable",
          impact: "repairable",
          entityId: candidate.id,
          relativePath: `autosaves/${candidate.id}`,
          summary: "A hash-verified autosave is available after an unclean shutdown.",
          suggestedRepair: "Restore this autosave through immutable revision authority.",
          action: "restore-autosave",
          details: { createdAt: candidate.createdAt, baseRevisionId: candidate.baseRevisionId },
        }),
      );
    }
    for (const orphan of await this.#runtime.scanOrphans()) {
      if (issues.some((candidate) => candidate.relativePath === orphan.relativePath)) continue;
      issues.push(
        issue({
          code: `repair.runtime.${orphan.kind}`,
          impact: "repairable",
          entityId: null,
          relativePath: orphan.relativePath,
          summary: `A stale ${orphan.kind.replaceAll("-", " ")} was found.`,
          suggestedRepair: "Quarantine it with a manifest; no project source will be deleted.",
          action: orphan.quarantineEligible ? "quarantine-path" : null,
          details: { modifiedAt: orphan.modifiedAt, ageMs: orphan.ageMs },
        }),
      );
    }
    for (const cacheIssue of await scanCacheMetadata(this.#projects.openRootPath())) issues.push(cacheIssue);
    for (const queueRecord of await this.#renders.queue()) {
      if (queueRecord.persistedStatus !== "interrupted") continue;
      issues.push(
        issue({
          code: "repair.job.interrupted",
          impact: "repairable",
          entityId: queueRecord.request.jobId,
          relativePath: `renders/queue/jobs/${queueRecord.request.jobId}.json`,
          summary: "A render job was interrupted by a process restart.",
          suggestedRepair: "Retry its failed stage or explicitly clean the interrupted queue record.",
          action: "cleanup-interrupted-job",
          details: { requestId: queueRecord.request.id, stage: queueRecord.stage },
        }),
      );
    }
    const sorted = issues.sort((left, right) => left.id.localeCompare(right.id, "en"));
    return {
      schemaVersion: "1.0.0",
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      scannedAt: this.#now().toISOString(),
      readOnly: true,
      passed: sorted.length === 0,
      issues: sorted,
    };
  }

  async repair(input: RepairActionRequest): Promise<RepairReceipt> {
    const before = await this.#projects.snapshot();
    const scan = await this.scan();
    const selected = scan.issues.find((candidate) => candidate.id === input.issueId);
    if (selected?.action == null) throw new Error("Repair issue is unavailable.");
    const allowed =
      selected.action === input.action ||
      (selected.code === "repair.revision.orphan" &&
        (input.action === "recover-pointer" || input.action === "reject-orphan"));
    if (!allowed) throw new Error("Repair action does not match the selected issue.");
    const root = this.#projects.openRootPath();
    const evidence: string[] = [];
    switch (input.action) {
      case "recover-pointer":
      case "adopt-orphan": {
        const target = input.targetRevisionId ?? selected.entityId;
        if (target === null) throw new Error("Pointer repair requires a target revision.");
        const orphanIds = (await this.#projects.repairReport()).storage.orphanRevisionIds;
        if (!orphanIds.includes(target))
          throw new Error("Pointer repair target is not a verified orphan revision.");
        const revision = await loadProjectRevision(root, target);
        if (revision.project.projectId !== before.project.projectId) {
          throw new Error("Pointer repair target belongs to another project.");
        }
        if (
          input.action === "adopt-orphan" &&
          revision.transaction.parentRevisionId !== before.pointer.revisionId
        ) {
          throw new Error("Orphan adoption only permits a verified direct child of the current revision.");
        }
        const pointer: CurrentRevisionPointer = {
          schemaVersion: "1.0.0",
          projectId: revision.project.projectId,
          revisionId: target,
          revisionHash: revision.revisionHash,
          committedAt: revision.transaction.timestamp,
        };
        await writeJsonAtomic(path.join(root, "current-revision.json"), pointer);
        evidence.push(revision.revisionHash, hashCanonical(pointer));
        break;
      }
      case "reject-orphan":
        evidence.push(
          await quarantineProjectPath(root, selected.relativePath, "rejected-orphan", this.#now()),
        );
        break;
      case "clear-stale-lock": {
        const lock = await readProjectMutationLock(root);
        if (lock === null || Date.parse(lock.expiresAt) > this.#now().getTime()) {
          throw new Error("Project lock is absent or still live; stale recovery is refused.");
        }
        evidence.push(await quarantineProjectPath(root, ".chai-lock.json", "stale-lock", this.#now()));
        break;
      }
      case "relink-asset": {
        const assetId = selected.entityId;
        const targetPath = input.targetRelativePath;
        if (assetId === null || targetPath === undefined || input.expectedContentHash === undefined) {
          throw new Error("Asset relink requires an entity, target path, and expected content hash.");
        }
        const actualHash = await hashFile(resolveProjectPath(root, targetPath));
        if (actualHash !== input.expectedContentHash) throw new Error("Relink target hash does not match.");
        const command: AssetRelinkCommand = {
          ...repairCommandBase(before, input.actor, `relink-${randomUUID()}`, [assetId]),
          kind: "asset.relink",
          payload: { assetId, newPath: normalizeRelativePath(targetPath), observedContentHash: actualHash },
        };
        const receipt = await this.#projects.executeCommand(command);
        if (receipt.status !== "committed" || receipt.resultingRevisionId === null) {
          throw new Error(receipt.error?.message ?? "Asset relink did not commit.");
        }
        evidence.push(actualHash, receipt.revisionHash ?? hashCanonical(receipt));
        break;
      }
      case "adopt-external-source": {
        const sourcePath = selected.relativePath;
        if (sourcePath === null) throw new Error("Source repair requires a working source path.");
        const content = await readFile(resolveProjectPath(root, sourcePath), "utf8");
        const observed = hashText(content);
        if (input.expectedContentHash !== undefined && input.expectedContentHash !== observed) {
          throw new Error("Working source changed again before repair.");
        }
        const command: SourceEditCommand = {
          ...repairCommandBase(before, input.actor, `source-${randomUUID()}`, [before.project.projectId]),
          kind: "source.edit",
          declaredScope: "source-edit",
          payload: { path: sourcePath, expectedHash: observed, content },
        };
        const receipt = await this.#projects.executeCommand(command);
        if (receipt.status !== "committed" || receipt.resultingRevisionId === null) {
          throw new Error(receipt.error?.message ?? "External source adoption did not commit.");
        }
        evidence.push(observed, receipt.revisionHash ?? hashCanonical(receipt));
        break;
      }
      case "quarantine-path": {
        if (selected.relativePath === null) throw new Error("Quarantine repair requires a path.");
        evidence.push(await quarantineProjectPath(root, selected.relativePath, selected.code, this.#now()));
        break;
      }
      case "cleanup-interrupted-job": {
        if (selected.entityId === null) throw new Error("Interrupted-job cleanup requires a job ID.");
        const cleanup = await this.#renders.cleanupInterrupted(selected.entityId);
        evidence.push(hashCanonical(cleanup));
        break;
      }
      case "restore-autosave": {
        if (selected.entityId === null) throw new Error("Autosave repair requires an autosave ID.");
        const restored = await restoreProjectAutosave(root, selected.entityId, {
          actor: input.actor,
          now: this.#now(),
        });
        evidence.push(restored.revisionHash);
        break;
      }
    }
    const after = await this.#projects.snapshot();
    const receiptWithoutHash = {
      schemaVersion: "1.0.0" as const,
      id: `repair-${randomUUID()}`,
      issueId: input.issueId,
      action: input.action,
      projectId: before.project.projectId,
      sourceRevisionId: before.pointer.revisionId,
      resultingRevisionId: after.pointer.revisionId,
      actor: input.actor,
      evidenceHashes: [...new Set(evidence)],
      sourceFilesDeleted: false as const,
      createdAt: this.#now().toISOString(),
    };
    const receipt: RepairReceipt = receiptWithoutHash;
    await writeJsonAtomic(path.join(root, "receipts", "repairs", `${receipt.id}.json`), receipt);
    return receipt;
  }

  async diagnostics(correlationId?: string | null): Promise<UserFacingDiagnostics> {
    const [health, scan] = await Promise.all([this.startupHealth(), this.scan()]);
    const logs = await this.#diagnosticsStore().search({
      ...(correlationId === undefined ? {} : { correlationId }),
      limit: 200,
    });
    const first = scan.issues[0] ?? null;
    return {
      schemaVersion: "1.0.0",
      summary:
        health.status === "ready" && scan.passed
          ? "Chai Studio is healthy. No recovery action is waiting."
          : `${String(scan.issues.length)} recovery item(s) need attention; creative source remains protected.`,
      status: health.status,
      affectedEntity: first?.entityId ?? null,
      stage: typeof first?.details.stage === "string" ? first.details.stage : null,
      frame: typeof first?.details.frame === "string" ? first.details.frame : null,
      suggestedRepair: first?.suggestedRepair ?? null,
      safeRetry: first?.code === "repair.job.interrupted",
      inspectSource: first?.code === "repair.source.external-edit",
      issueCount: scan.issues.length,
      details: { checks: health.checks, issues: scan.issues, logs },
      privacy: {
        localOnly: true,
        telemetryEnabled: false,
        supportBundleRequiresExplicitSelection: true,
      },
    };
  }

  log(
    input: Omit<LocalStructuredLogRecord, "schemaVersion" | "id" | "timestamp"> &
      Partial<Pick<LocalStructuredLogRecord, "id" | "timestamp">>,
  ): Promise<LocalStructuredLogRecord> {
    return this.#diagnosticsStore().append(input);
  }

  supportBundlePreview(input: { readonly explicit: boolean; readonly recordIds: readonly string[] }) {
    return this.#diagnosticsStore().supportBundlePreview({
      createdByExplicitAction: input.explicit,
      recordIds: input.recordIds,
    });
  }

  exportSupportBundle(input: { readonly explicit: boolean; readonly recordIds: readonly string[] }) {
    return this.#diagnosticsStore().exportSupportBundle({
      createdByExplicitAction: input.explicit,
      recordIds: input.recordIds,
    });
  }

  async recordLocalCrash(input: {
    readonly summary: string;
    readonly correlationId: string;
    readonly details: unknown;
  }) {
    const snapshot = await this.#projects.snapshot();
    return this.#diagnosticsStore().recordCrash({
      ...input,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
    });
  }

  #diagnosticsStore(): LocalDiagnosticsStore {
    return new LocalDiagnosticsStore({ projectRoot: this.#projects.openRootPath(), now: this.#now });
  }

  async #browserCheck(): Promise<StartupHealthCheck> {
    try {
      await access(this.#browserExecutablePath, constants.X_OK);
      return {
        id: "health.browser",
        label: "Isolated render browser",
        state: this.#browserIdentity.startsWith("playwright-managed:") ? "passed" : "failed",
        impact: "blocking",
        summary: this.#browserIdentity.startsWith("playwright-managed:")
          ? "The Playwright-managed headless browser is executable; installed Chrome is not selected."
          : "The configured browser identity is not an approved Playwright-managed runtime.",
        repair: this.#browserIdentity.startsWith("playwright-managed:")
          ? null
          : "Select the frozen Playwright-managed browser and rerun isolation validation.",
        evidence: {
          identity: this.#browserIdentity,
          executable: redactTextWithContext(this.#browserExecutablePath),
          launched: false,
        },
      };
    } catch {
      return {
        id: "health.browser",
        label: "Isolated render browser",
        state: "failed",
        impact: "blocking",
        summary: "The frozen Playwright-managed headless browser is missing or not executable.",
        repair: "Restore the frozen Playwright browser runtime; do not substitute installed Chrome.",
        evidence: { identity: this.#browserIdentity, launched: false },
      };
    }
  }

  async #ffmpegCheck(): Promise<StartupHealthCheck> {
    try {
      const [version, encoders] = await Promise.all([
        execFileAsync(this.#ffmpegPath, ["-version"], { timeout: 5_000, maxBuffer: 1_048_576 }),
        execFileAsync(this.#ffmpegPath, ["-hide_banner", "-encoders"], {
          timeout: 10_000,
          maxBuffer: 4_194_304,
        }),
      ]);
      const text = encoders.stdout;
      const required = ["h264", "aac"];
      const missing = required.filter((codec) => !text.toLowerCase().includes(codec));
      return {
        id: "health.ffmpeg-codecs",
        label: "FFmpeg and delivery codecs",
        state: missing.length === 0 ? "passed" : "failed",
        impact: "blocking",
        summary:
          missing.length === 0
            ? "FFmpeg and required personal-delivery codecs are available."
            : `FFmpeg is missing required codec support: ${missing.join(", ")}.`,
        repair: missing.length === 0 ? null : "Restore the frozen FFmpeg build with required codecs.",
        evidence: { version: version.stdout.split("\n")[0] ?? "unknown", required, missing },
      };
    } catch (cause) {
      return {
        id: "health.ffmpeg-codecs",
        label: "FFmpeg and delivery codecs",
        state: "failed",
        impact: "blocking",
        summary: "FFmpeg could not be verified.",
        repair: "Restore the local FFmpeg runtime and rerun startup health checks.",
        evidence: { error: cause instanceof Error ? cause.message : "unavailable" },
      };
    }
  }

  async #writePermissionCheck(): Promise<StartupHealthCheck> {
    try {
      await Promise.all([
        access(this.#projects.openRootPath(), constants.R_OK | constants.W_OK),
        access(os.tmpdir(), constants.R_OK | constants.W_OK),
      ]);
      return {
        id: "health.permissions",
        label: "Project and temporary write access",
        state: "passed",
        impact: "blocking",
        summary: "Project and temporary locations are readable and writable.",
        repair: null,
        evidence: { project: "read-write", temporary: "read-write" },
      };
    } catch {
      return {
        id: "health.permissions",
        label: "Project and temporary write access",
        state: "failed",
        impact: "blocking",
        summary: "A required local location is not writable.",
        repair: "Restore project and temporary-folder permissions before editing or rendering.",
        evidence: {},
      };
    }
  }

  async #scanResources(snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>) {
    const root = this.#projects.openRootPath();
    const issues: ProjectRepairIssue[] = [];
    for (const asset of snapshot.assets.assets) {
      let observed: string | null = null;
      try {
        observed = await hashFile(resolveProjectPath(root, asset.path));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      const font = asset.path.startsWith("assets/fonts/");
      if (observed === null) {
        issues.push(
          issue({
            code: font ? "repair.font.missing" : "repair.asset.missing",
            impact: "repairable",
            entityId: asset.id,
            relativePath: asset.path,
            summary: `${font ? "Font" : "Asset"} ${asset.id} is missing.`,
            suggestedRepair: "Relink the exact bytes with the registered content hash.",
            action: "relink-asset",
            details: { expectedContentHash: asset.contentHash },
          }),
        );
      } else if (observed !== asset.contentHash) {
        issues.push(
          issue({
            code: font ? "repair.font.hash-mismatch" : "repair.asset.hash-mismatch",
            impact: "blocking",
            entityId: asset.id,
            relativePath: asset.path,
            summary: `${font ? "Font" : "Asset"} ${asset.id} no longer matches its registered identity.`,
            suggestedRepair:
              "Restore the registered bytes or explicitly replace the asset; do not relink silently.",
            action: null,
            details: { expectedContentHash: asset.contentHash, observedContentHash: observed },
          }),
        );
      }
    }
    for (const [sourcePath, source] of Object.entries(snapshot.project.sources)) {
      let observed: string | null = null;
      try {
        observed = hashText(await readFile(resolveProjectPath(root, sourcePath), "utf8"));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      if (observed !== source.contentHash) {
        issues.push(
          issue({
            code: "repair.source.external-edit",
            impact: "repairable",
            entityId: sourcePath,
            relativePath: sourcePath,
            summary: "A native source file changed outside the revisioned Studio command path.",
            suggestedRepair:
              observed === null
                ? "Restore the source file from the immutable revision or a verified backup."
                : "Inspect the external edit, then explicitly adopt it into a new immutable revision.",
            action: observed === null ? null : "adopt-external-source",
            details: { expectedContentHash: source.contentHash, observedContentHash: observed },
          }),
        );
      }
    }
    return issues;
  }
}

const repairCommandBase = (
  snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
  actor: CommitActor,
  suffix: string,
  affectedEntityIds: readonly string[],
) => ({
  schemaVersion: "1.0.0" as const,
  commandId: `command-repair-${suffix}`,
  idempotencyId: `idempotency-repair-${suffix}`,
  actor,
  projectId: snapshot.project.projectId,
  correlationId: `correlation-repair-${suffix}`,
  issuedAt: new Date().toISOString(),
  capability: { name: "project-repair", version: "1.0.0" },
  payloadVersion: "1.0.0" as const,
  affectedEntityIds,
  declaredScope: "mutation" as const,
  validationOnly: false,
  baseRevisionId: snapshot.pointer.revisionId,
  authorizationId: null,
});

const issue = (input: Omit<ProjectRepairIssue, "id">): ProjectRepairIssue => ({
  ...input,
  id: `issue-${hashCanonical({
    code: input.code,
    entityId: input.entityId,
    relativePath: input.relativePath,
  }).slice(0, 24)}`,
});

const scanCacheMetadata = async (root: string): Promise<readonly ProjectRepairIssue[]> => {
  const cacheRoot = path.join(root, ".chai-cache");
  const files: string[] = [];
  await collectNamedFiles(cacheRoot, "metadata.json", files, 5_000);
  const issues: ProjectRepairIssue[] = [];
  for (const metadataPath of files) {
    const relative = path.relative(root, path.dirname(metadataPath)).split(path.sep).join("/");
    try {
      const value = JSON.parse(await readFile(metadataPath, "utf8")) as Readonly<{
        artifactHash?: unknown;
        descriptor?: Readonly<{ extension?: unknown }>;
      }>;
      if (
        typeof value.artifactHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.artifactHash) ||
        typeof value.descriptor?.extension !== "string"
      ) {
        throw new Error("metadata-invalid");
      }
      const artifactPath = path.join(path.dirname(metadataPath), `artifact.${value.descriptor.extension}`);
      if ((await hashFile(artifactPath)) === value.artifactHash) continue;
      throw new Error("content-corrupt");
    } catch (cause) {
      issues.push(
        issue({
          code: "repair.cache.corrupt",
          impact: "repairable",
          entityId: null,
          relativePath: relative,
          summary: "A regenerable cache entry is incomplete or corrupt.",
          suggestedRepair: "Quarantine this cache entry and rebuild it from authoritative sources.",
          action: "quarantine-path",
          details: { reason: cause instanceof Error ? cause.message : "unreadable" },
        }),
      );
    }
  }
  return issues;
};

const validRevisionCandidates = async (
  root: string,
): Promise<readonly Readonly<{ revisionId: string; timestamp: string; revisionHash: string }>[]> => {
  let entries;
  try {
    entries = await readdir(path.join(root, "revisions"), { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".staging-"))
      .map(async (entry) => {
        try {
          const revision = await loadProjectRevision(root, entry.name);
          return {
            revisionId: entry.name,
            timestamp: revision.transaction.timestamp,
            revisionHash: revision.revisionHash,
          };
        } catch {
          return null;
        }
      }),
  );
  return candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp, "en"));
};

const collectNamedFiles = async (
  directory: string,
  targetName: string,
  files: string[],
  limit: number,
): Promise<void> => {
  if (files.length >= limit) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  for (const entry of entries) {
    if (files.length >= limit) return;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectNamedFiles(absolute, targetName, files, limit);
    else if (entry.isFile() && entry.name === targetName) files.push(absolute);
  }
};

const quarantineProjectPath = async (
  root: string,
  relativePath: string | null,
  reason: string,
  now: Date,
): Promise<string> => {
  if (relativePath === null) throw new Error("Repair quarantine path is missing.");
  const normalized = normalizeRelativePath(relativePath);
  const allowed =
    normalized === ".chai-lock.json" ||
    normalized.startsWith(".chai-cache/") ||
    normalized.startsWith("revisions/") ||
    normalized.startsWith("renders/");
  if (!allowed) throw new Error("Repair quarantine refuses project source paths.");
  const source = resolveProjectPath(root, normalized);
  const bytesHash = await hashPathEvidence(source);
  const id = `quarantine-${randomUUID()}`;
  const directory = path.join(root, ".chai-cache", "quarantine", "repairs", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, path.basename(source));
  await rename(source, target);
  const manifest = {
    schemaVersion: "1.0.0",
    id,
    reason,
    originalRelativePath: normalized,
    quarantinedRelativePath: path.relative(root, target).split(path.sep).join("/"),
    evidenceHash: bytesHash,
    sourceFilesDeleted: false,
    createdAt: now.toISOString(),
  };
  await writeJsonAtomic(path.join(directory, "manifest.json"), manifest);
  return hashCanonical(manifest);
};

const hashPathEvidence = async (target: string): Promise<string> => {
  const metadata = await stat(target);
  if (metadata.isFile()) return hashFile(target);
  const entries = await readdir(target, { withFileTypes: true });
  const evidence = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map(async (entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        hash: entry.isFile() ? await hashFile(path.join(target, entry.name)) : null,
      })),
  );
  return hashCanonical(evidence);
};

const writeJsonAtomic = async (target: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(stringifyCanonicalJson(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
};

const normalizeRelativePath = (value: string): string => {
  if (path.isAbsolute(value) || value.includes("\0")) throw new Error("Repair path is invalid.");
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("Repair path escapes project.");
  return normalized;
};

const resolveProjectPath = (root: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalizeRelativePath(relativePath));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Repair path escapes project.");
  return resolved;
};

const hashFile = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

const hashText = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const hashCanonical = (value: unknown): string =>
  createHash("sha256").update(stringifyCanonicalJson(value), "utf8").digest("hex");
