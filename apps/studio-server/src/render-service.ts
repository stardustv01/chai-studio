import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { OfflineAudioMixArtifact } from "@chai-studio/audio/offline";
import { redactTextWithContext } from "@chai-studio/diagnostics";
import { inspectMediaFile, type MediaInspectionV1 } from "@chai-studio/media";
import {
  centralizedQaRules,
  createReviewChecklist,
  createQaReport,
  createPreRenderQaReport,
  emptyQaLocation,
  evaluateAudioMeasurements,
  evaluateStructuralOutput,
  qaRuleSetIdentity,
  recordReviewChecklistItem,
  type QaFinding,
  type QaReport,
  type ReviewChecklist,
} from "@chai-studio/qa";
import {
  hashCanonicalRenderValue,
  builtInDeliveryProfiles,
  createDeliveryProfile,
  preflightDeliveryRequest,
  validateDeliveryProfile,
  validateRenderDag,
  validateRenderScope,
  RenderRecoveryJournalStore,
  type DeliveryPreflightResult,
  type DeliveryProfile,
  type DeliveryProfileSeed,
  type RenderPlan,
  type RenderScope,
  type ReliabilityFaultPoint,
  type RenderResumeContext,
} from "@chai-studio/render";
import {
  createExecutableSecurityPolicy,
  createTrustClassification,
  promoteTrustClassification,
  securityIdentity,
  type ExecutableTrustClass,
  type TrustClassificationRecord,
  type TrustPromotionReview,
} from "@chai-studio/security";
import {
  beginAsyncOperation,
  completeAsyncOperation,
  stringifyCanonicalJson,
  type AcceptedExceptionDocument,
  type CommitActor,
  type JsonValue,
  type QaState,
} from "@chai-studio/schema";
import type { StudioJobRegistry, StudioJobSnapshot } from "./job-registry.js";
import type { ProjectSessionService } from "./project-service.js";

export type RenderProfileRequest = DeliveryProfile;

export interface QaDeliveryPreflightResult extends DeliveryPreflightResult {
  readonly qaReport: QaReport;
  readonly security: SecurityPreflightSummary;
}

export interface SecurityPreflightSummary {
  readonly schemaVersion: "1.0.0";
  readonly policyIdentities: readonly string[];
  readonly trustRecords: readonly TrustClassificationRecord[];
  readonly trustClasses: readonly ExecutableTrustClass[];
  readonly importedExecutionEnabled: boolean;
  readonly isolationEvidenceHash: string | null;
}

export interface RenderRequestRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly jobId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionHash: string;
  readonly actor: CommitActor;
  readonly profile: RenderProfileRequest;
  readonly scope: RenderScope;
  readonly preflight: QaDeliveryPreflightResult;
  readonly name: string;
  readonly priority: number;
  readonly attempt: number;
  readonly retryOfRequestId: string | null;
  readonly createdAt: string;
}

export interface RenderExecutorResult {
  readonly primaryRelativePath: string;
  readonly additionalRelativePaths: readonly string[];
  readonly engines: readonly {
    readonly engine: "remotion" | "hyperframes" | "shared";
    readonly version: string;
    readonly role: string;
  }[];
  readonly cacheLineage: readonly string[];
  readonly warnings: readonly string[];
  readonly reproductionCommands: readonly string[];
  readonly audio: RenderAudioEvidence;
  readonly plan: RenderPlan;
  readonly security: RenderSecurityEvidence;
}

export interface RenderSecurityEvidence {
  readonly schemaVersion: "1.0.0";
  readonly policyIdentity: string;
  readonly trustClasses: readonly ExecutableTrustClass[];
  readonly workerPoolIds: readonly string[];
  readonly cacheNamespaces: readonly string[];
  readonly environmentIdentity: string;
  readonly approvedNetworkHashes: readonly string[];
  readonly isolationEvidenceHash: string | null;
  readonly violations: readonly string[];
}

export interface RenderMeasuredAudioEvidence {
  readonly status: "measured";
  readonly measurementVersion: "chai-audio-measurements-v1";
  readonly artifactHash: string;
  readonly graphIdentity: string;
  readonly sampleRate: 44_100 | 48_000 | 96_000;
  readonly channelLayout: "mono" | "stereo" | "5.1" | "7.1";
  readonly channels: number;
  readonly durationSamples: string;
  readonly integratedLufs: number | null;
  readonly samplePeakDbfs: number | null;
  readonly truePeakDbtp: number | null;
  readonly clippedSampleCount: number;
  readonly silentSampleCount: number;
  readonly channelPeaksDbfs: readonly (number | null)[];
}

export interface RenderNoAudioEvidence {
  readonly status: "not-applicable";
  readonly measurementVersion: null;
  readonly reason: "delivery-profile-declares-no-audio";
}

export type RenderAudioEvidence = RenderMeasuredAudioEvidence | RenderNoAudioEvidence;

export const renderAudioEvidenceFromMixArtifact = (
  artifact: OfflineAudioMixArtifact,
  channelLayout: RenderMeasuredAudioEvidence["channelLayout"],
): RenderMeasuredAudioEvidence => {
  if (![44_100, 48_000, 96_000].includes(artifact.sampleRate)) {
    throw new Error("Offline audio artifact uses an unsupported project sample rate.");
  }
  const expectedChannels =
    channelLayout === "mono" ? 1 : channelLayout === "stereo" ? 2 : channelLayout === "5.1" ? 6 : 8;
  if (artifact.channels !== expectedChannels || artifact.measurements.channels !== expectedChannels) {
    throw new Error("Offline audio artifact channels do not match the project output layout.");
  }
  return {
    status: "measured",
    measurementVersion: "chai-audio-measurements-v1",
    artifactHash: artifact.artifactHash,
    graphIdentity: artifact.graphIdentity,
    sampleRate: artifact.sampleRate as RenderMeasuredAudioEvidence["sampleRate"],
    channelLayout,
    channels: artifact.measurements.channels,
    durationSamples: artifact.measurements.durationSamples.toString(10),
    integratedLufs: artifact.measurements.integratedLufs,
    samplePeakDbfs: artifact.measurements.peakDbfs,
    truePeakDbtp: artifact.measurements.truePeakDbtp,
    clippedSampleCount: artifact.measurements.clippedSampleCount,
    silentSampleCount: artifact.measurements.silentSampleCount,
    channelPeaksDbfs: artifact.measurements.channelPeaksDbfs,
  };
};

export type RenderExecutor = (input: {
  readonly request: RenderRequestRecord;
  readonly outputId: string;
  readonly outputDirectory: string;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
  readonly resume: RenderResumeContext | null;
}) => Promise<RenderExecutorResult>;

export interface RenderArtifactRecord {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly primary: boolean;
}

export interface RenderOutputRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly projectId: string;
  readonly sourceRevisionId: string;
  readonly activationRevisionId: string;
  readonly renderRequestId: string;
  readonly jobId: string;
  readonly profile: RenderProfileRequest;
  readonly scope: RenderScope;
  readonly artifacts: readonly RenderArtifactRecord[];
  readonly receiptIdentityHash: string;
  readonly lifecycleState: QaState;
  readonly createdAt: string;
}

export interface RenderArtifactPayload {
  readonly outputId: string;
  readonly index: number;
  readonly artifact: RenderArtifactRecord;
  readonly mediaType: "image/png" | "image/jpeg";
  readonly fileName: string;
  readonly bytes: Buffer;
}

export interface RenderReceiptBase {
  readonly schemaVersion: "1.0.0";
  readonly receiptVersion: "1.0.0";
  readonly identityHash: string;
  readonly outputId: string;
  readonly projectId: string;
  readonly sourceRevisionId: string;
  readonly sourceRevisionHash: string;
  readonly renderRequestId: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly deliveryProfile: RenderProfileRequest;
  readonly renderScope: RenderScope;
  readonly engines: RenderExecutorResult["engines"];
  readonly environment: Readonly<{
    mode: "strict" | "compatible";
    strictEnvironmentFingerprint: string;
    compatiblePreviewFingerprint: string;
    strictManifestHash: string;
    browserIdentity: string;
    status: "recorded";
  }>;
  readonly dependencies: Readonly<{
    manifestHash: string;
    entryCount: number;
    lockfileHash: string;
    status: "recorded";
  }>;
  readonly security: RenderSecurityEvidence;
  readonly dag: Readonly<{
    id: string;
    nodeCount: number;
    rootIds: readonly string[];
    range: Readonly<{ startFrame: string; endFrameExclusive: string }>;
    fps: Readonly<{ numerator: string; denominator: string }>;
  }>;
  readonly cacheLineage: readonly string[];
  readonly artifacts: readonly RenderArtifactRecord[];
  readonly audio: RenderAudioEvidence;
  readonly captions: Readonly<{ status: "not-evaluated" }>;
  readonly preflight: Readonly<{
    status: "passed";
    planIdentityHash: string;
    findingCodes: readonly string[];
    ruleSetVersions: readonly string[];
  }>;
  readonly initialLifecycleState: "rendered_unchecked";
  readonly warnings: readonly string[];
  readonly reproduction: Readonly<{
    status: "recorded";
    commands: readonly string[];
  }>;
  readonly approval: null;
  readonly delivered: false;
}

export interface RenderLifecycleEvent {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly outputId: string;
  readonly from: QaState | null;
  readonly to: QaState;
  readonly actor: CommitActor;
  readonly sourceRevisionId: string;
  readonly resultingRevisionId: string;
  readonly evidenceHashes: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly createdAt: string;
  readonly eventHash: string;
}

export interface RenderReceiptView {
  readonly base: RenderReceiptBase;
  readonly lifecycle: readonly RenderLifecycleEvent[];
  readonly qaReports: readonly QaReceiptRecord[];
  readonly checklist: ReviewChecklist | null;
  readonly currentState: QaState;
}

export interface QaReceiptRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly outputId: string;
  readonly sourceRevisionId: string;
  readonly createdAt: string;
  readonly state: "qa_failed" | "qa_warning" | "qa_passed";
  readonly audio: Awaited<ReturnType<QaEvaluator>>["audio"];
  readonly primaryArtifactProbe: RenderArtifactProbeEvidence | null;
  readonly artifactEvidenceHashes: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly authoritativeReport: QaReport;
  readonly reportHash: string;
}

export interface RenderArtifactProbeEvidence {
  readonly schemaVersion: "1.0.0";
  readonly status: "probed" | "failed";
  readonly artifactPath: string;
  readonly artifactHash: string;
  readonly inspection: MediaInspectionV1 | null;
  readonly failureCode: "ffprobe-failed" | null;
  readonly identityHash: string;
}

export interface QaWorkspaceView {
  readonly outputId: string;
  readonly rules: ReturnType<typeof centralizedQaRules>;
  readonly ruleSetIdentity: string;
  readonly reports: readonly QaReceiptRecord[];
  readonly latest: QaReceiptRecord | null;
  readonly checklist: ReviewChecklist | null;
}

export interface RenderQueueRecord {
  readonly schemaVersion: "1.0.0";
  readonly request: RenderRequestRecord;
  readonly job: StudioJobSnapshot | null;
  readonly persistedStatus: StudioJobSnapshot["status"] | "interrupted";
  readonly stage: string;
  readonly activeEngine: StudioJobSnapshot["activeEngine"];
  readonly progress: number;
  readonly cacheHits: number;
  readonly estimateLabel: string | null;
  readonly qaState: QaState | "not-started";
  readonly controls: Readonly<{
    cancel: boolean;
    pause: false;
    resume: false;
    retryFailedStage: boolean;
    duplicate: true;
    reprioritize: boolean;
    clear: boolean;
  }>;
  readonly pauseUnavailableReason: string;
}

export type QaEvaluator = (input: {
  readonly output: RenderOutputRecord;
  readonly rootPath: string;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
}) => Promise<
  Readonly<{
    state: "qa_failed" | "qa_warning" | "qa_passed";
    evidenceHashes: readonly string[];
    exceptionIds: readonly string[];
    audio: Readonly<{
      status: "not-applicable" | "passed" | "warning" | "failed";
      measurementVersion: RenderAudioEvidence["measurementVersion"];
      reasons: readonly string[];
      measurements: RenderAudioEvidence;
    }>;
    primaryArtifactProbe?: RenderArtifactProbeEvidence | null;
    findings?: readonly QaFinding[];
  }>
>;

export class RenderApiService {
  readonly #projects: ProjectSessionService;
  readonly #jobs: StudioJobRegistry;
  readonly #now: () => Date;
  readonly #executeRender: RenderExecutor;
  readonly #compositorMode: "none" | "full" | "local-full";
  readonly #evaluateQa: QaEvaluator;
  readonly #isolationEvidenceHash: string | null;
  readonly #checkpoint: ((point: ReliabilityFaultPoint) => void | Promise<void>) | undefined;
  readonly #requests = new Map<string, RenderRequestRecord>();
  #persistence: Promise<void> = Promise.resolve();

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly jobs: StudioJobRegistry;
    readonly now?: () => Date;
    readonly executeRender?: RenderExecutor;
    readonly compositorMode?: "full" | "local-full";
    readonly evaluateQa?: QaEvaluator;
    readonly isolationEvidenceHash?: string | null;
    readonly checkpoint?: (point: ReliabilityFaultPoint) => void | Promise<void>;
  }) {
    this.#projects = input.projects;
    this.#jobs = input.jobs;
    this.#now = input.now ?? (() => new Date());
    this.#executeRender = input.executeRender ?? unavailableRenderExecutor;
    this.#compositorMode = input.executeRender === undefined ? "none" : (input.compositorMode ?? "full");
    this.#evaluateQa = input.evaluateQa ?? verifyOutputQa;
    this.#isolationEvidenceHash = input.isolationEvidenceHash ?? null;
    this.#checkpoint = input.checkpoint;
    if (this.#isolationEvidenceHash !== null && !/^[a-f0-9]{64}$/.test(this.#isolationEvidenceHash)) {
      throw new Error("Imported isolation evidence identity is invalid.");
    }
    this.#jobs.subscribe((job) => {
      if (job.kind === "render.execute" || job.kind === "render.qa") this.#persistJobProjection(job);
    });
  }

  async profiles(): Promise<readonly DeliveryProfile[]> {
    const builtIn = builtInDeliveryProfiles();
    const directory = path.join(this.#projects.openRootPath(), "profiles", "delivery");
    let names: readonly string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return builtIn;
      throw cause;
    }
    const custom = await Promise.all(
      names.map(async (name) => {
        const value = JSON.parse(await readFile(path.join(directory, name), "utf8")) as DeliveryProfile;
        validateDeliveryProfile(value);
        if (value.kind !== "custom") throw new Error("Stored custom delivery profile must use custom kind.");
        return value;
      }),
    );
    return [...builtIn, ...custom.filter((profile) => !builtIn.some((item) => item.id === profile.id))];
  }

  async saveCustomProfile(seed: DeliveryProfileSeed): Promise<DeliveryProfile> {
    if (seed.kind !== "custom") throw new Error("Custom delivery profiles must use custom kind.");
    if (builtInDeliveryProfiles().some((profile) => profile.id === seed.id)) {
      throw new Error("Custom delivery profile cannot replace a built-in profile.");
    }
    const profile = createDeliveryProfile(seed);
    validateDeliveryProfile(profile);
    await writeJsonAtomic(
      path.join(this.#projects.openRootPath(), "profiles", "delivery", `${profile.id}.json`),
      profile,
    );
    return profile;
  }

  async securityWorkspace(): Promise<
    Readonly<{
      schemaVersion: "1.0.0";
      records: readonly TrustClassificationRecord[];
      importedExecutionEnabled: boolean;
      isolationEvidenceHash: string | null;
    }>
  > {
    const snapshot = await this.#projects.snapshot();
    return {
      schemaVersion: "1.0.0",
      records: await this.#trustRecords(),
      importedExecutionEnabled:
        snapshot.settings.allowImportedExecutableContent && this.#isolationEvidenceHash !== null,
      isolationEvidenceHash: this.#isolationEvidenceHash,
    };
  }

  async classifyComposition(input: {
    readonly compositionId: string;
    readonly sourceHash: string;
    readonly trustClass: ExecutableTrustClass;
    readonly classifiedBy: string;
  }): Promise<TrustClassificationRecord> {
    const snapshot = await this.#projects.snapshot();
    const asset = snapshot.assets.assets.find(
      (candidate) => candidate.id === input.compositionId && candidate.kind === "composition",
    );
    if (asset?.contentHash !== input.sourceHash) {
      throw new Error("Trust classification must match an exact current composition asset hash.");
    }
    const record = createTrustClassification({ ...input, classifiedAt: this.#now() });
    await writeJsonAtomic(this.#trustRecordPath(record.compositionId), record);
    return record;
  }

  async promoteComposition(review: TrustPromotionReview): Promise<TrustClassificationRecord> {
    const current = (await this.#trustRecords()).find(
      (record) => record.compositionId === review.compositionId,
    );
    if (current === undefined) throw new Error("Composition trust classification does not exist.");
    const promoted = promoteTrustClassification(current, review);
    await writeJsonAtomic(this.#trustRecordPath(promoted.compositionId), promoted);
    return promoted;
  }

  async preflight(input: {
    readonly profile: RenderProfileRequest;
    readonly scope: RenderScope;
    readonly expectedRevisionId: string;
  }): Promise<QaDeliveryPreflightResult> {
    const snapshot = await this.#projects.snapshot();
    if (snapshot.pointer.revisionId !== input.expectedRevisionId) {
      throw new Error(
        `Render revision conflict: expected ${input.expectedRevisionId}, current ${snapshot.pointer.revisionId}.`,
      );
    }
    const scopedClips = clipsForRenderScope(snapshot.timeline, input.scope);
    const scopedAssetIds = new Set(
      scopedClips.flatMap((clip) => (clip.assetId === null ? [] : [clip.assetId])),
    );
    const scopedAssets = snapshot.assets.assets.filter((asset) => scopedAssetIds.has(asset.id));
    const delivery = preflightDeliveryRequest({
      profile: input.profile,
      scope: input.scope,
      timelineDurationFrames: snapshot.timeline.durationFrames,
      hasMissingDependencies: scopedAssets.some((asset) => asset.validationState !== "valid"),
      hasUnsupportedCapabilities: scopedClips.some((clip) => clip.capability === "unsupported"),
      hasUnclearedRights: scopedAssets.some((asset) => asset.rights === "unknown"),
      originalsAvailable: scopedAssets.every((asset) => asset.validationState === "valid"),
      diskBytesAvailable: null,
      estimatedOutputBytes: null,
    });
    const security = await this.#securityPreflight(snapshot, scopedAssetIds);
    const compositorFindings: DeliveryPreflightResult["findings"] =
      this.#compositorMode === "local-full"
        ? fullCompositorFindings(
            input.profile,
            input.scope,
            snapshot.timeline,
            scopedClips,
            scopedAssets,
            security.summary,
          )
        : this.#compositorMode === "full"
          ? []
          : [
              {
                code: "render.compositor.unavailable",
                severity: "error",
                blocking: true,
                title: "Authoritative timeline compositor is unavailable",
                detail:
                  "This build cannot render immutable timeline media. The former synthetic slate executor is not a production renderer.",
                repair:
                  "Install a build with the timeline-driven shared, Remotion, HyperFrames, caption, bridge, and AudioGraph compositor.",
              },
            ];
    const findings = [...delivery.findings, ...security.findings, ...compositorFindings];
    const base = {
      schemaVersion: "1.0.0" as const,
      profile: delivery.profile,
      scope: delivery.scope,
      executable: !findings.some((finding) => finding.blocking),
      findings,
    };
    return {
      ...base,
      identityHash: hashCanonicalRenderValue({ ...base, security: security.summary } as never),
      security: security.summary,
      qaReport: createPreRenderQaReport({
        id: `qa-preflight-${snapshot.pointer.revisionId}-${input.profile.id}`,
        projectId: snapshot.project.projectId,
        revisionId: snapshot.pointer.revisionId,
        createdAt: this.#timestamp(),
        findings,
        evidenceHashes: [snapshot.revisionHash],
        environmentFingerprint: null,
      }),
    };
  }

  async #securityPreflight(
    snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
    scopedAssetIds: ReadonlySet<string>,
  ): Promise<{
    readonly summary: SecurityPreflightSummary;
    readonly findings: DeliveryPreflightResult["findings"];
  }> {
    const records = await this.#trustRecords();
    const compositions = snapshot.assets.assets.filter(
      (asset) => asset.kind === "composition" && scopedAssetIds.has(asset.id),
    );
    const findings: DeliveryPreflightResult["findings"][number][] = [];
    const selected: TrustClassificationRecord[] = [];
    const policies = [];
    const importedExecutionEnabled =
      snapshot.settings.allowImportedExecutableContent && this.#isolationEvidenceHash !== null;
    for (const composition of compositions) {
      const record = records.find(
        (candidate) =>
          candidate.compositionId === composition.id && candidate.sourceHash === composition.contentHash,
      );
      if (record === undefined) {
        findings.push({
          code: "security.trust.unclassified",
          severity: "error",
          blocking: true,
          title: "Executable composition is unclassified",
          detail: `Composition ${composition.id} has no trust record for its exact source hash.`,
          repair: "Classify the exact composition source before preview or render.",
        });
        continue;
      }
      selected.push(record);
      if (record.trustClass === "imported_untrusted" && !importedExecutionEnabled) {
        findings.push({
          code: "security.imported-execution.disabled",
          severity: "error",
          blocking: true,
          title: "Imported executable containment is unavailable",
          detail: "The project opt-in and current macOS adversarial isolation evidence are both required.",
          repair: "Keep imported execution disabled or rerun and accept the current containment gate.",
        });
        continue;
      }
      policies.push(this.#projectSecurityPolicy(snapshot, record.trustClass, importedExecutionEnabled));
    }
    if (policies.length === 0) {
      policies.push(this.#projectSecurityPolicy(snapshot, "trusted_authored", importedExecutionEnabled));
    }
    if (snapshot.settings.networkAllowlist.length > 0) {
      findings.push({
        code: "security.network.hash-required",
        severity: "error",
        blocking: true,
        title: "Domain entries are not immutable resource approvals",
        detail: "Final rendering requires exact HTTPS resource URLs paired with verified SHA-256 hashes.",
        repair: "Freeze each resource locally or approve its exact URL and content hash.",
      });
    }
    return {
      summary: {
        schemaVersion: "1.0.0",
        policyIdentities: [...new Set(policies.map((policy) => policy.policyIdentity))].sort(),
        trustRecords: selected,
        trustClasses: [...new Set(policies.map((policy) => policy.trustClass))].sort(),
        importedExecutionEnabled,
        isolationEvidenceHash: this.#isolationEvidenceHash,
      },
      findings,
    };
  }

  #projectSecurityPolicy(
    snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
    trustClass: ExecutableTrustClass,
    importedExecutionEnabled: boolean,
  ) {
    const root = this.#projects.openRootPath();
    return createExecutableSecurityPolicy({
      projectId: snapshot.project.projectId,
      trustClass,
      importedExecutionEnabled,
      rootPolicies: [
        { id: "project-source", path: root, mode: "read-only" },
        { id: "render-output", path: path.join(root, "renders"), mode: "output-only" },
        { id: "security-cache", path: path.join(root, ".chai", "cache"), mode: "read-write" },
        { id: "security-temp", path: path.join(root, ".chai", "tmp"), mode: "temporary" },
      ],
      approvedNetworkResources: [],
      environmentAllowlist: [],
    });
  }

  async #trustRecords(): Promise<readonly TrustClassificationRecord[]> {
    const directory = path.join(this.#projects.openRootPath(), "security", "trust");
    let names: readonly string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    return Promise.all(
      names.map(async (name) => {
        const record = JSON.parse(
          await readFile(path.join(directory, name), "utf8"),
        ) as TrustClassificationRecord;
        const { identityHash, ...withoutIdentity } = record;
        if (identityHash !== securityIdentity(withoutIdentity)) {
          throw new Error(`Trust classification ${name} has an invalid identity.`);
        }
        return record;
      }),
    );
  }

  #trustRecordPath(compositionId: string): string {
    if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(compositionId)) {
      throw new Error("Composition trust record id is invalid.");
    }
    return path.join(this.#projects.openRootPath(), "security", "trust", `${compositionId}.json`);
  }

  async enqueue(input: {
    readonly profile: RenderProfileRequest;
    readonly scope: RenderScope;
    readonly name: string;
    readonly priority: number;
    readonly actor: CommitActor;
    readonly expectedRevisionId: string;
    readonly correlationId: string;
  }): Promise<Readonly<{ request: RenderRequestRecord; job: StudioJobSnapshot }>> {
    const snapshot = await this.#projects.snapshot();
    if (snapshot.pointer.revisionId !== input.expectedRevisionId) {
      throw new Error(
        `Render revision conflict: expected ${input.expectedRevisionId}, current ${snapshot.pointer.revisionId}.`,
      );
    }
    const preflight = await this.preflight({
      profile: input.profile,
      scope: input.scope,
      expectedRevisionId: input.expectedRevisionId,
    });
    if (!preflight.executable) throw new Error("Render preflight contains blocking findings.");
    return this.#enqueueRecord({
      profile: input.profile,
      scope: input.scope,
      preflight,
      name: validateRenderName(input.name),
      priority: validatePriority(input.priority),
      actor: input.actor,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      revisionHash: snapshot.revisionHash,
      correlationId: input.correlationId,
      attempt: 1,
      retryOfRequestId: null,
    });
  }

  async retry(
    jobId: string,
    correlationId: string,
  ): Promise<Readonly<{ request: RenderRequestRecord; job: StudioJobSnapshot }>> {
    const prior = await this.#requestForJob(jobId);
    let retryable: boolean;
    try {
      const priorJob = this.#jobs.get(jobId);
      retryable =
        priorJob.kind === "render.execute" &&
        (priorJob.status === "failed" || priorJob.status === "cancelled");
    } catch {
      const stored = (await this.#readPersistedJobProjections()).get(jobId);
      retryable =
        stored === undefined ||
        stored.status === "running" ||
        stored.status === "queued" ||
        stored.status === "failed" ||
        stored.status === "cancelled";
    }
    if (!retryable)
      throw new Error("Only failed, cancelled, or restart-interrupted render jobs can be retried.");
    const snapshot = await this.#projects.snapshot();
    if (snapshot.pointer.revisionId !== prior.revisionId) {
      throw new Error("Render retry requires the original source revision to remain current.");
    }
    return this.#enqueueRecord({
      profile: prior.profile,
      scope: prior.scope,
      preflight: prior.preflight,
      name: prior.name,
      priority: prior.priority,
      actor: prior.actor,
      projectId: prior.projectId,
      revisionId: prior.revisionId,
      revisionHash: prior.revisionHash,
      correlationId,
      attempt: prior.attempt + 1,
      retryOfRequestId: prior.id,
    });
  }

  cancel(jobId: string): StudioJobSnapshot {
    const job = this.#jobs.get(jobId);
    if (job.kind !== "render.execute" && job.kind !== "render.qa") {
      throw new Error("Job is not owned by render services.");
    }
    return this.#jobs.cancel(jobId);
  }

  async requests(): Promise<readonly RenderRequestRecord[]> {
    await this.#loadPersistedRequests();
    return [...this.#requests.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt, "en"),
    );
  }

  async queue(): Promise<readonly RenderQueueRecord[]> {
    const requests = await this.requests();
    const liveJobs = new Map(this.#jobs.list().map((job) => [job.id, job]));
    const persisted = await this.#readPersistedJobProjections();
    return Promise.all(
      requests.map(async (request) => {
        const job = liveJobs.get(request.jobId) ?? null;
        const stored = persisted.get(request.jobId);
        const status =
          job?.status ??
          (stored?.status === "completed" || stored?.status === "failed" || stored?.status === "cancelled"
            ? stored.status
            : "interrupted");
        const output = (await this.outputs()).find((candidate) => candidate.renderRequestId === request.id);
        return {
          schemaVersion: "1.0.0" as const,
          request,
          job,
          persistedStatus: status,
          stage:
            job?.stage ?? stored?.stage ?? (status === "interrupted" ? "Interrupted by restart" : "Stored"),
          activeEngine: job?.activeEngine ?? stored?.activeEngine ?? null,
          progress: job?.progress ?? stored?.progress ?? 0,
          cacheHits: job?.cacheHits ?? stored?.cacheHits ?? 0,
          estimateLabel: job?.estimateLabel ?? stored?.estimateLabel ?? null,
          qaState: output?.lifecycleState ?? "not-started",
          controls: {
            cancel: status === "queued" || status === "running",
            pause: false as const,
            resume: false as const,
            retryFailedStage: status === "failed" || status === "cancelled" || status === "interrupted",
            duplicate: true as const,
            reprioritize: status === "queued",
            clear: status === "completed" || status === "cancelled",
          },
          pauseUnavailableReason:
            "The current render worker has no proven cooperative checkpoint; pausing is disabled instead of pretending the process is paused.",
        };
      }),
    );
  }

  reprioritize(jobId: string, priority: number): StudioJobSnapshot {
    return this.#jobs.reprioritize(jobId, priority);
  }

  async duplicate(
    jobId: string,
    correlationId: string,
  ): Promise<Readonly<{ request: RenderRequestRecord; job: StudioJobSnapshot }>> {
    const prior = await this.#requestForJob(jobId);
    const snapshot = await this.#projects.snapshot();
    const preflight = await this.preflight({
      profile: prior.profile,
      scope: prior.scope,
      expectedRevisionId: snapshot.pointer.revisionId,
    });
    if (!preflight.executable) throw new Error("Duplicated render preflight contains blocking findings.");
    return this.#enqueueRecord({
      profile: prior.profile,
      scope: prior.scope,
      preflight,
      name: `${prior.name} copy`,
      priority: prior.priority,
      actor: prior.actor,
      projectId: snapshot.project.projectId,
      revisionId: snapshot.pointer.revisionId,
      revisionHash: snapshot.revisionHash,
      correlationId,
      attempt: 1,
      retryOfRequestId: null,
    });
  }

  async clearCompleted(): Promise<Readonly<{ removed: number }>> {
    await this.#loadPersistedRequests();
    const persisted = await this.#readPersistedJobProjections();
    const live = new Map(this.#jobs.list().map((job) => [job.id, job]));
    const removable = [...this.#requests.values()].filter((request) => {
      const status = live.get(request.jobId)?.status ?? persisted.get(request.jobId)?.status;
      return status === "completed" || status === "cancelled";
    });
    this.#jobs.clearCompleted();
    await Promise.all(
      removable.flatMap((request) => [
        rm(this.#requestPath(request.id), { force: true }),
        rm(this.#jobProjectionPath(request.jobId), { force: true }),
      ]),
    );
    for (const request of removable) this.#requests.delete(request.id);
    return { removed: removable.length };
  }

  async cleanupInterrupted(jobId: string): Promise<
    Readonly<{
      jobId: string;
      requestId: string;
      queueMetadataRemoved: true;
      recoveryJournalRetained: true;
      sourceFilesDeleted: false;
    }>
  > {
    const record = (await this.queue()).find((candidate) => candidate.request.jobId === jobId);
    if (record?.persistedStatus !== "interrupted") {
      throw new Error("Only an interrupted render job can be cleaned with recovery retention.");
    }
    await Promise.all([
      rm(this.#requestPath(record.request.id), { force: true }),
      rm(this.#jobProjectionPath(record.request.jobId), { force: true }),
    ]);
    this.#requests.delete(record.request.id);
    return {
      jobId,
      requestId: record.request.id,
      queueMetadataRemoved: true,
      recoveryJournalRetained: true,
      sourceFilesDeleted: false,
    };
  }

  async outputs(): Promise<readonly RenderOutputRecord[]> {
    const root = path.join(this.#projects.openRootPath(), "renders");
    let names: string[];
    try {
      names = await readdir(root);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    const outputs: RenderOutputRecord[] = [];
    for (const name of names.sort()) {
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(root, name, "output.json"), "utf8"));
        const output = parsed as RenderOutputRecord;
        const receipt = await this.receipt(output.id);
        outputs.push({ ...output, lifecycleState: receipt.currentState });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
    }
    return outputs;
  }

  async output(outputId: string): Promise<RenderOutputRecord> {
    const output = (await this.outputs()).find((candidate) => candidate.id === outputId);
    if (output === undefined) throw new Error(`Unknown render output ID: ${outputId}.`);
    const receipt = await this.receipt(outputId);
    return { ...output, lifecycleState: receipt.currentState };
  }

  async artifact(outputId: string, index: number): Promise<RenderArtifactPayload> {
    const output = await this.output(outputId);
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("Render artifact index is invalid.");
    const artifact = output.artifacts[index];
    if (artifact === undefined) throw new Error("Render artifact index is not present on this output.");
    const mediaType =
      output.profile.outputKind === "still" && output.profile.container === "png"
        ? "image/png"
        : output.profile.outputKind === "still" && output.profile.container === "jpeg"
          ? "image/jpeg"
          : null;
    if (mediaType === null) {
      throw new Error(
        "Inline artifact viewing currently supports immutable PNG and JPEG still outputs only.",
      );
    }
    const root = path.resolve(this.#projects.openRootPath());
    const absolute = path.resolve(root, artifact.relativePath);
    const relative = path.relative(root, absolute);
    if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Render artifact path escapes the open project.");
    }
    const metadata = await stat(absolute);
    if (!metadata.isFile() || metadata.size !== artifact.byteLength) {
      throw new Error("Render artifact bytes no longer match the immutable output receipt.");
    }
    const bytes = await readFile(absolute);
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash) {
      throw new Error("Render artifact hash no longer matches the immutable output receipt.");
    }
    return {
      outputId,
      index,
      artifact,
      mediaType,
      fileName: path.basename(artifact.relativePath),
      bytes,
    };
  }

  async enqueueQa(input: {
    readonly outputId: string;
    readonly actor: CommitActor;
    readonly expectedRevisionId: string;
    readonly correlationId: string;
  }): Promise<StudioJobSnapshot> {
    const output = await this.output(input.outputId);
    const snapshot = await this.#projects.snapshot();
    if (snapshot.pointer.revisionId !== input.expectedRevisionId) {
      throw new Error(
        `QA revision conflict: expected ${input.expectedRevisionId}, current ${snapshot.pointer.revisionId}.`,
      );
    }
    if (
      snapshot.approvalState.outputId !== output.id ||
      snapshot.approvalState.state !== "rendered_unchecked"
    ) {
      throw new Error("QA requires the current rendered_unchecked output identity.");
    }
    return this.#jobs.enqueue({
      kind: "render.qa",
      correlationId: input.correlationId,
      projectId: output.projectId,
      revisionId: snapshot.pointer.revisionId,
      label: `QA · ${output.id}`,
      task: async ({ signal, report, reportStage }) => {
        reportStage({ stage: "Validate output artifacts", activeEngine: "shared" });
        const result = await this.#evaluateQa({
          output,
          rootPath: this.#projects.openRootPath(),
          signal,
          report,
        });
        const qaCreatedAt = this.#timestamp();
        const measuredAudio =
          result.audio.measurements.status === "measured" ? result.audio.measurements : null;
        const fallbackFinding: QaFinding = {
          schemaVersion: "1.0.0",
          id: `qa-finding-${randomUUID()}`,
          ruleId: measuredAudio === null ? "qa.post.structure" : "qa.post.audio",
          ruleVersion: "1.0.0",
          category: measuredAudio === null ? "output" : "audio",
          stage: "post-render",
          severity:
            result.state === "qa_failed" ? "error" : result.state === "qa_warning" ? "warning" : "info",
          blocking: true,
          status:
            result.state === "qa_failed" ? "failed" : result.state === "qa_warning" ? "warning" : "passed",
          title:
            measuredAudio === null
              ? "Authoritative output verification"
              : "Authoritative output and audio verification",
          detail:
            result.audio.reasons.length === 0
              ? measuredAudio === null
                ? "Artifact identity passes; this delivery profile contains no audio."
                : "Artifact identity and authoritative audio measurements pass."
              : result.audio.reasons.join(" "),
          repairHint:
            result.state === "qa_failed"
              ? "Repair the authoritative mix or changed artifact and render again."
              : null,
          location: emptyQaLocation(),
          evidenceHashes: result.evidenceHashes,
          metrics:
            measuredAudio === null
              ? []
              : [
                  {
                    name: "integratedLufs",
                    value: measuredAudio.integratedLufs,
                    unit: "LUFS",
                    comparator: "informational",
                    threshold: null,
                  },
                  {
                    name: "truePeakDbtp",
                    value: measuredAudio.truePeakDbtp,
                    unit: "dBTP",
                    comparator: "lte",
                    threshold: 0,
                  },
                  {
                    name: "clippedSamples",
                    value: measuredAudio.clippedSampleCount,
                    unit: "samples",
                    comparator: "eq",
                    threshold: 0,
                  },
                ],
          environmentFingerprint: null,
          exceptionId: null,
        };
        const findings = result.findings ?? [fallbackFinding];
        const authoritativeReport = createQaReport({
          id: `qa-report-${randomUUID()}`,
          projectId: output.projectId,
          revisionId: output.sourceRevisionId,
          outputId: output.id,
          ruleSetIdentity: qaRuleSetIdentity(),
          rules: centralizedQaRules().map(({ id, version }) => ({ id, version })),
          findings,
          createdAt: qaCreatedAt,
        });
        const qaReportWithoutHash = {
          schemaVersion: "1.0.0" as const,
          id: `qa-report-${randomUUID()}`,
          outputId: output.id,
          sourceRevisionId: output.sourceRevisionId,
          createdAt: qaCreatedAt,
          state: authoritativeReport.state,
          audio: result.audio,
          primaryArtifactProbe: result.primaryArtifactProbe ?? null,
          artifactEvidenceHashes: result.evidenceHashes,
          exceptionIds: result.exceptionIds,
          authoritativeReport,
        };
        const qaReport: QaReceiptRecord = {
          ...qaReportWithoutHash,
          reportHash: hashCanonical(qaReportWithoutHash),
        };
        await writeJsonAtomic(
          path.join(
            this.#projects.openRootPath(),
            "receipts",
            "renders",
            output.id,
            "qa",
            `${qaCreatedAt.replace(/[:.]/g, "-")}-${qaReport.id}.json`,
          ),
          qaReport,
        );
        const checklist = createOutputReviewChecklist(
          output,
          snapshot.timeline.durationFrames,
          output.profile.alpha !== "none",
        );
        await writeJsonAtomic(this.#checklistPath(output.id), checklist);
        reportStage({ stage: "Record QA evidence", activeEngine: "shared" });
        const event = await this.#transition({
          outputId: output.id,
          to: authoritativeReport.state,
          actor: input.actor,
          expectedRevisionId: input.expectedRevisionId,
          evidenceHashes: [...result.evidenceHashes, qaReport.reportHash, authoritativeReport.identityHash],
          exceptionIds: result.exceptionIds,
          report: authoritativeReport,
          exceptions: snapshot.timeline.reviewState?.exceptions ?? [],
        });
        return {
          result: { ...result, state: authoritativeReport.state },
          report: qaReport,
          checklist,
          event,
        };
      },
    });
  }

  async qaWorkspace(outputId: string): Promise<QaWorkspaceView> {
    await this.output(outputId);
    const reports = await this.#qaReports(outputId);
    return {
      outputId,
      rules: centralizedQaRules(),
      ruleSetIdentity: qaRuleSetIdentity(),
      reports,
      latest: reports.at(-1) ?? null,
      checklist: await this.#readChecklist(outputId),
    };
  }

  async recordChecklistItem(input: {
    readonly outputId: string;
    readonly itemId: string;
    readonly status: "passed" | "failed";
    readonly reviewerId: string;
    readonly evidenceHashes: readonly string[];
  }): Promise<ReviewChecklist> {
    const output = await this.output(input.outputId);
    const checklist = await this.#readChecklist(output.id);
    if (checklist === null) throw new Error("Run QA before recording visual review evidence.");
    if (checklist.outputId !== output.id || checklist.revisionId !== output.sourceRevisionId) {
      throw new Error("Visual review checklist does not match the immutable output identity.");
    }
    const updated = recordReviewChecklistItem(checklist, {
      itemId: input.itemId,
      status: input.status,
      reviewerId: input.reviewerId,
      evidenceHashes: input.evidenceHashes,
      reviewedAt: this.#timestamp(),
    });
    await writeJsonAtomic(this.#checklistPath(output.id), updated);
    return updated;
  }

  async approve(input: {
    readonly outputId: string;
    readonly actor: CommitActor;
    readonly expectedRevisionId: string;
    readonly evidenceHashes: readonly string[];
    readonly exceptionIds: readonly string[];
  }): Promise<RenderLifecycleEvent> {
    const snapshot = await this.#projects.snapshot();
    if (snapshot.approvalState.state === "qa_warning" && input.exceptionIds.length === 0) {
      throw new Error("Approving qa_warning requires at least one scoped accepted exception.");
    }
    if (snapshot.approvalState.state !== "qa_passed" && snapshot.approvalState.state !== "qa_warning") {
      throw new Error("Approval requires qa_passed or qa_warning state.");
    }
    const latest = (await this.#qaReports(input.outputId)).at(-1);
    if (latest === undefined) throw new Error("Approval requires an immutable QA report.");
    const checklist = await this.#readChecklist(input.outputId);
    if (checklist?.complete !== true) {
      throw new Error(
        "Approval requires every generated visual review checklist item to pass with evidence.",
      );
    }
    const exceptions = snapshot.timeline.reviewState?.exceptions ?? [];
    return this.#transition({
      ...input,
      to: "approved",
      evidenceHashes: [
        ...new Set([
          ...input.evidenceHashes,
          latest.reportHash,
          latest.authoritativeReport.identityHash,
          checklist.identityHash,
        ]),
      ],
      report: latest.authoritativeReport,
      exceptions,
    });
  }

  async deliver(input: {
    readonly outputId: string;
    readonly actor: CommitActor;
    readonly expectedRevisionId: string;
    readonly evidenceHashes: readonly string[];
  }): Promise<RenderLifecycleEvent> {
    const output = await this.output(input.outputId);
    const snapshot = await this.#projects.snapshot();
    if (snapshot.approvalState.state !== "approved" || snapshot.approvalState.outputId !== output.id) {
      throw new Error("Delivery requires the exact immutable approved output.");
    }
    const receipt = await this.receipt(output.id);
    const latest = receipt.qaReports.at(-1);
    if (
      latest === undefined ||
      receipt.checklist?.complete !== true ||
      receipt.lifecycle.at(-1)?.to !== "approved"
    ) {
      throw new Error("Delivery requires a complete matching render, QA, checklist, and approval receipt.");
    }
    const deliveryEvidence = [
      ...new Set([
        ...input.evidenceHashes,
        receipt.base.identityHash,
        latest.reportHash,
        latest.authoritativeReport.identityHash,
        receipt.checklist.identityHash,
        receipt.lifecycle.at(-1)?.eventHash ?? "",
      ]),
    ].filter((hash) => hash.length > 0);
    const event = await this.#transition({
      ...input,
      to: "delivered",
      evidenceHashes: deliveryEvidence,
      exceptionIds: latest.authoritativeReport.exceptionIds,
      report: latest.authoritativeReport,
      exceptions: snapshot.timeline.reviewState?.exceptions ?? [],
    });
    await writeJsonAtomic(
      path.join(this.#projects.openRootPath(), "receipts", "renders", output.id, "delivery.json"),
      {
        schemaVersion: "1.0.0",
        outputId: output.id,
        sourceRevisionId: output.sourceRevisionId,
        deliveryProfileIdentity: output.profile.identityHash,
        evidenceHashes: deliveryEvidence,
        lifecycleEventHash: event.eventHash,
        createdAt: event.createdAt,
      },
    );
    return event;
  }

  async receipt(outputId: string): Promise<RenderReceiptView> {
    const root = this.#projects.openRootPath();
    const base = JSON.parse(
      await readFile(path.join(root, "receipts", "renders", outputId, "render.json"), "utf8"),
    ) as RenderReceiptBase;
    const lifecycleDirectory = path.join(root, "receipts", "renders", outputId, "lifecycle");
    let names: readonly string[];
    try {
      names = (await readdir(lifecycleDirectory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") names = [];
      else throw cause;
    }
    const lifecycle = await Promise.all(
      names.map(
        async (name) =>
          JSON.parse(await readFile(path.join(lifecycleDirectory, name), "utf8")) as RenderLifecycleEvent,
      ),
    );
    return {
      base,
      lifecycle,
      qaReports: await this.#qaReports(outputId),
      checklist: await this.#readChecklist(outputId),
      currentState: lifecycle.at(-1)?.to ?? base.initialLifecycleState,
    };
  }

  async #enqueueRecord(input: {
    readonly profile: RenderProfileRequest;
    readonly scope: RenderScope;
    readonly preflight: QaDeliveryPreflightResult;
    readonly name: string;
    readonly priority: number;
    readonly actor: CommitActor;
    readonly projectId: string;
    readonly revisionId: string;
    readonly revisionHash: string;
    readonly correlationId: string;
    readonly attempt: number;
    readonly retryOfRequestId: string | null;
  }): Promise<Readonly<{ request: RenderRequestRecord; job: StudioJobSnapshot }>> {
    const requestId = `render-request-${randomUUID()}`;
    const jobId = `job-${randomUUID()}`;
    const request: RenderRequestRecord = {
      schemaVersion: "1.0.0",
      id: requestId,
      jobId,
      projectId: input.projectId,
      revisionId: input.revisionId,
      revisionHash: input.revisionHash,
      actor: input.actor,
      profile: input.profile,
      scope: input.scope,
      preflight: input.preflight,
      name: input.name,
      priority: input.priority,
      attempt: input.attempt,
      retryOfRequestId: input.retryOfRequestId,
      createdAt: this.#timestamp(),
    };
    this.#requests.set(request.id, request);
    await writeJsonAtomic(this.#requestPath(request.id), request);
    await new RenderRecoveryJournalStore(this.#projects.openRootPath(), this.#now).begin({
      requestId: request.id,
      retryOfRequestId: request.retryOfRequestId,
      projectId: request.projectId,
      revisionId: request.revisionId,
    });
    const job = this.#jobs.enqueue({
      id: jobId,
      kind: "render.execute",
      correlationId: input.correlationId,
      projectId: input.projectId,
      revisionId: input.revisionId,
      priority: input.priority,
      label: input.name,
      task: ({ signal, report, reportStage }) => this.#runRender(request, signal, report, reportStage),
    });
    return { request, job };
  }

  async #runRender(
    request: RenderRequestRecord,
    signal: AbortSignal,
    report: (progress: number) => void,
    reportStage: (input: {
      readonly stage: string;
      readonly activeEngine?: StudioJobSnapshot["activeEngine"];
      readonly cacheHits?: number;
      readonly estimateLabel?: string | null;
    }) => void,
  ): Promise<RenderOutputRecord> {
    reportStage({ stage: "Validate immutable revision", activeEngine: "shared" });
    const snapshot = await this.#projects.snapshot();
    if (
      snapshot.pointer.revisionId !== request.revisionId ||
      snapshot.revisionHash !== request.revisionHash
    ) {
      throw new Error("Render source revision changed before execution.");
    }
    const operationId = `operation-${request.jobId.slice(4)}`;
    await beginAsyncOperation(this.#projects.openRootPath(), {
      kind: "render",
      actorId: request.actor.id,
      operationId,
      now: this.#now(),
    });
    const outputId = `output-${randomUUID()}`;
    const outputDirectory = path.join(this.#projects.openRootPath(), "renders", outputId);
    const startedAt = this.#timestamp();
    const recoveryStore = new RenderRecoveryJournalStore(this.#projects.openRootPath(), this.#now);
    let recovery =
      (await recoveryStore.read(request.id)) ??
      (await recoveryStore.begin({
        requestId: request.id,
        retryOfRequestId: request.retryOfRequestId,
        projectId: request.projectId,
        revisionId: request.revisionId,
      }));
    try {
      recovery = await recoveryStore.advance(recovery, {
        stage: "operation-started",
        status: "running",
        outputId,
      });
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      report(0.05);
      reportStage({ stage: "Execute render DAG", activeEngine: null, estimateLabel: "Estimating" });
      const resume =
        request.retryOfRequestId === null
          ? null
          : await recoveryStore.resumeContext(request.retryOfRequestId);
      const result = await this.#executeRender({
        request,
        outputId,
        outputDirectory,
        signal,
        report,
        resume,
      });
      if (signal.aborted) throw new Error("Render was cancelled.");
      await this.#checkpoint?.("render-stage");
      recovery = await recoveryStore.advance(recovery, { stage: "render-stage-complete" });
      reportStage({
        stage: "Validate artifacts and plan",
        activeEngine: "shared",
        cacheHits: result.cacheLineage.length,
      });
      validateExecutorPlan(result.plan, request);
      validateSecurityEvidence(result.security, result.plan);
      const artifacts = await validateArtifacts(
        this.#projects.openRootPath(),
        outputDirectory,
        result.primaryRelativePath,
        result.additionalRelativePaths,
      );
      recovery = await recoveryStore.advance(recovery, {
        stage: "artifacts-validated",
        validatedArtifacts: artifacts,
      });
      report(0.9);
      reportStage({
        stage: "Publish receipt",
        activeEngine: "shared",
        cacheHits: result.cacheLineage.length,
        estimateLabel: null,
      });
      const receipt = await this.#writeBaseReceipt({
        request,
        outputId,
        startedAt,
        completedAt: this.#timestamp(),
        result,
        artifacts,
      });
      await this.#checkpoint?.("receipt-write");
      recovery = await recoveryStore.advance(recovery, { stage: "receipt-published" });
      await this.#checkpoint?.("approval-transition");
      const event = await this.#transition({
        outputId,
        to: "rendered_unchecked",
        actor: request.actor,
        expectedRevisionId: request.revisionId,
        evidenceHashes: [receipt.identityHash],
        exceptionIds: [],
        report: null,
        exceptions: [],
      });
      recovery = await recoveryStore.advance(recovery, { stage: "approval-transitioned" });
      const output: RenderOutputRecord = {
        schemaVersion: "1.0.0",
        id: outputId,
        projectId: request.projectId,
        sourceRevisionId: request.revisionId,
        activationRevisionId: event.resultingRevisionId,
        renderRequestId: request.id,
        jobId: request.jobId,
        profile: request.profile,
        scope: request.scope,
        artifacts,
        receiptIdentityHash: receipt.identityHash,
        lifecycleState: "rendered_unchecked",
        createdAt: receipt.completedAt,
      };
      await writeJsonAtomic(path.join(outputDirectory, "output.json"), output);
      recovery = await recoveryStore.advance(recovery, {
        stage: "output-published",
        status: "completed",
      });
      reportStage({
        stage: "Rendered · QA not run",
        activeEngine: null,
        cacheHits: result.cacheLineage.length,
      });
      return output;
    } catch (cause) {
      const cancelled = signal.aborted || (cause instanceof DOMException && cause.name === "AbortError");
      let partialOutputRetained = false;
      try {
        partialOutputRetained = (await stat(outputDirectory)).isDirectory();
      } catch (statCause) {
        if ((statCause as NodeJS.ErrnoException).code !== "ENOENT") throw statCause;
      }
      await recoveryStore.fail(recovery, {
        cancelled,
        error: redactTextWithContext(
          cause instanceof Error ? cause.message : "Render failed with an unknown cause.",
          { projectRoot: this.#projects.openRootPath() },
        ),
        partialOutputRetained,
      });
      throw cause;
    } finally {
      await completeAsyncOperation(this.#projects.openRootPath(), operationId);
    }
  }

  async #writeBaseReceipt(input: {
    readonly request: RenderRequestRecord;
    readonly outputId: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly result: RenderExecutorResult;
    readonly artifacts: readonly RenderArtifactRecord[];
  }): Promise<RenderReceiptBase> {
    validateAudioEvidence(input.result.audio, input.artifacts, input.request.profile);
    const redactionContext = { projectRoot: this.#projects.openRootPath() };
    const redactedSecurity: RenderSecurityEvidence = {
      ...input.result.security,
      violations: input.result.security.violations.map((value) =>
        redactTextWithContext(value, redactionContext),
      ),
    };
    const withoutHash = {
      schemaVersion: "1.0.0" as const,
      receiptVersion: "1.0.0" as const,
      outputId: input.outputId,
      projectId: input.request.projectId,
      sourceRevisionId: input.request.revisionId,
      sourceRevisionHash: input.request.revisionHash,
      renderRequestId: input.request.id,
      jobId: input.request.jobId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      deliveryProfile: input.request.profile,
      renderScope: input.request.scope,
      engines: input.result.engines,
      environment: {
        mode: input.request.profile.strictEnvironment ? ("strict" as const) : ("compatible" as const),
        strictEnvironmentFingerprint: input.result.plan.environment.strictEnvironmentFingerprint,
        compatiblePreviewFingerprint: input.result.plan.environment.compatiblePreviewFingerprint,
        strictManifestHash: hashCanonicalRenderValue(
          input.result.plan.environment.strictManifest as unknown as JsonValue,
        ),
        browserIdentity: input.result.plan.environment.strictManifest.browserIdentity,
        status: "recorded" as const,
      },
      dependencies: {
        manifestHash: input.result.plan.dependencyManifest.identityHash,
        entryCount: input.result.plan.dependencyManifest.entries.length,
        lockfileHash: input.result.plan.environment.strictManifest.lockfileHash,
        status: "recorded" as const,
      },
      security: redactedSecurity,
      dag: {
        id: input.result.plan.dag.id,
        nodeCount: input.result.plan.dag.nodes.length,
        rootIds: input.result.plan.dag.roots,
        range: input.result.plan.dag.range,
        fps: input.result.plan.dag.fps,
      },
      cacheLineage: input.result.cacheLineage,
      artifacts: input.artifacts,
      audio: input.result.audio,
      captions: { status: "not-evaluated" as const },
      preflight: {
        status: "passed" as const,
        planIdentityHash: input.result.plan.identityHash,
        findingCodes: [
          ...input.request.preflight.findings.map((finding) => finding.code),
          ...input.result.plan.findings.map((finding) => finding.code),
        ],
        ruleSetVersions: [
          "chai-delivery-preflight-v1",
          `chai-qa-rules-${input.request.preflight.qaReport.ruleSetIdentity}`,
          "chai-render-plan-v1",
        ],
      },
      initialLifecycleState: "rendered_unchecked" as const,
      warnings: input.result.warnings.map((value) => redactTextWithContext(value, redactionContext)),
      reproduction: {
        status: "recorded" as const,
        commands: input.result.reproductionCommands.map((value) =>
          redactTextWithContext(value, redactionContext),
        ),
      },
      approval: null,
      delivered: false as const,
    };
    const receipt: RenderReceiptBase = {
      ...withoutHash,
      identityHash: hashCanonical(withoutHash),
    };
    await writeJsonAtomic(
      path.join(this.#projects.openRootPath(), "receipts", "renders", input.outputId, "render.json"),
      receipt,
    );
    return receipt;
  }

  async #transition(input: {
    readonly outputId: string;
    readonly to: QaState;
    readonly actor: CommitActor;
    readonly expectedRevisionId: string;
    readonly evidenceHashes: readonly string[];
    readonly exceptionIds: readonly string[];
    readonly report: QaReport | null;
    readonly exceptions: readonly AcceptedExceptionDocument[];
  }): Promise<RenderLifecycleEvent> {
    validateHashes(input.evidenceHashes);
    const snapshot = await this.#projects.snapshot();
    if (snapshot.pointer.revisionId !== input.expectedRevisionId) {
      throw new Error(
        `Lifecycle revision conflict: expected ${input.expectedRevisionId}, current ${snapshot.pointer.revisionId}.`,
      );
    }
    const receipt = await this.#projects.transitionQaLifecycle({
      outputId: input.outputId,
      to: input.to,
      actor: input.actor,
      expectedRevisionId: input.expectedRevisionId,
      report: input.report,
      exceptions: input.exceptions,
      evidenceHashes: input.evidenceHashes,
      exceptionIds: input.exceptionIds,
    });
    if (receipt.status !== "committed" || receipt.resultingRevisionId === null) {
      throw new Error(receipt.error?.message ?? "Lifecycle transition did not commit.");
    }
    const eventWithoutHash = {
      schemaVersion: "1.0.0" as const,
      id: `lifecycle-${randomUUID()}`,
      outputId: input.outputId,
      from: snapshot.approvalState.state,
      to: input.to,
      actor: input.actor,
      sourceRevisionId: input.expectedRevisionId,
      resultingRevisionId: receipt.resultingRevisionId,
      evidenceHashes: input.evidenceHashes,
      exceptionIds: input.exceptionIds,
      createdAt: this.#timestamp(),
    };
    const event: RenderLifecycleEvent = { ...eventWithoutHash, eventHash: hashCanonical(eventWithoutHash) };
    await writeJsonAtomic(
      path.join(
        this.#projects.openRootPath(),
        "receipts",
        "renders",
        input.outputId,
        "lifecycle",
        `${event.createdAt.replace(/[:.]/g, "-")}-${event.id}.json`,
      ),
      event,
    );
    return event;
  }

  async #qaReports(outputId: string): Promise<readonly QaReceiptRecord[]> {
    const directory = path.join(this.#projects.openRootPath(), "receipts", "renders", outputId, "qa");
    let names: readonly string[];
    try {
      names = (await readdir(directory))
        .filter((name) => name.endsWith(".json") && name !== "checklist.json")
        .sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    return Promise.all(
      names.map(
        async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as QaReceiptRecord,
      ),
    );
  }

  async #readChecklist(outputId: string): Promise<ReviewChecklist | null> {
    try {
      return JSON.parse(await readFile(this.#checklistPath(outputId), "utf8")) as ReviewChecklist;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  #checklistPath(outputId: string): string {
    return path.join(this.#projects.openRootPath(), "receipts", "renders", outputId, "qa", "checklist.json");
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }

  #requestPath(requestId: string): string {
    return path.join(this.#projects.openRootPath(), "renders", "queue", "requests", `${requestId}.json`);
  }

  #jobProjectionPath(jobId: string): string {
    return path.join(this.#projects.openRootPath(), "renders", "queue", "jobs", `${jobId}.json`);
  }

  async #loadPersistedRequests(): Promise<void> {
    const directory = path.join(this.#projects.openRootPath(), "renders", "queue", "requests");
    let names: readonly string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    for (const name of names) {
      const request = JSON.parse(await readFile(path.join(directory, name), "utf8")) as RenderRequestRecord;
      validatePersistedRequest(request);
      this.#requests.set(request.id, request);
    }
  }

  async #requestForJob(jobId: string): Promise<RenderRequestRecord> {
    await this.#loadPersistedRequests();
    const request = [...this.#requests.values()].find((candidate) => candidate.jobId === jobId);
    if (request === undefined) throw new Error(`Unknown render request for job: ${jobId}.`);
    return request;
  }

  #persistJobProjection(job: StudioJobSnapshot): void {
    let target: string;
    try {
      target = this.#jobProjectionPath(job.id);
    } catch {
      return;
    }
    this.#persistence = this.#persistence.then(() => writeJsonAtomic(target, job)).catch(() => undefined);
  }

  async #readPersistedJobProjections(): Promise<Map<string, StudioJobSnapshot>> {
    await this.#persistence;
    const directory = path.join(this.#projects.openRootPath(), "renders", "queue", "jobs");
    let names: readonly string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw cause;
    }
    const records = await Promise.all(
      names.map(
        async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as StudioJobSnapshot,
      ),
    );
    return new Map(records.map((record) => [record.id, record]));
  }
}

type ProjectRevisionSnapshot = Awaited<ReturnType<ProjectSessionService["snapshot"]>>;
type RenderTimeline = ProjectRevisionSnapshot["timeline"];
type RenderTimelineClip = RenderTimeline["tracks"][number]["clips"][number];
type RenderAsset = ProjectRevisionSnapshot["assets"]["assets"][number];

const clipsForRenderScope = (timeline: RenderTimeline, scope: RenderScope): readonly RenderTimelineClip[] => {
  const range =
    scope.kind === "full-timeline"
      ? { start: 0n, end: BigInt(timeline.durationFrames) }
      : scope.kind === "frame"
        ? { start: BigInt(scope.frame), end: BigInt(scope.frame) + 1n }
        : { start: BigInt(scope.startFrame), end: BigInt(scope.endFrameExclusive) };
  return timeline.tracks
    .filter((track) => !track.hidden && !track.muted)
    .flatMap((track) =>
      track.clips.filter((clip) => {
        const start = BigInt(clip.startFrame);
        const end = start + BigInt(clip.durationFrames);
        return end > range.start && start < range.end;
      }),
    );
};

const fullCompositorFindings = (
  profile: RenderProfileRequest,
  scope: RenderScope,
  timeline: RenderTimeline,
  clips: readonly RenderTimelineClip[],
  assets: readonly RenderAsset[],
  security: SecurityPreflightSummary,
): DeliveryPreflightResult["findings"] => {
  const findings: DeliveryPreflightResult["findings"][number][] = [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const visualClips = clips.filter((clip) => {
    const asset = clip.assetId === null ? undefined : assetById.get(clip.assetId);
    return asset?.kind === "video" || asset?.kind === "image" || asset?.kind === "composition";
  });
  const activeCaptionCount = (timeline.captionDocuments ?? [])
    .flatMap((document) => document.cues)
    .filter((cue) =>
      rangeIntersects(scope, timeline.durationFrames, cue.startFrame, cue.endFrameExclusive),
    ).length;
  if (profile.outputKind !== "audio" && visualClips.length === 0 && activeCaptionCount === 0) {
    findings.push({
      code: "render.compositor.range-empty",
      severity: "error",
      blocking: true,
      title: "No exact visual source exists in this render range",
      detail:
        "The selected range contains no shared image, video, native composition, or active caption cue.",
      repair: "Place a validated visual source in the range or choose a range containing visible content.",
    });
  }
  const nativeClips = clips.filter((clip) => clip.engine !== "shared");
  const nativeSpeedClips = nativeClips.filter((clip) => {
    const speed = clip.properties?.["time.speed"]?.value;
    return speed !== undefined && speed !== 1;
  });
  if (nativeSpeedClips.length > 0) {
    findings.push({
      code: "render.compositor.native-time-remap-unavailable",
      severity: "error",
      blocking: true,
      title: "Native time remapping requires an exact prepared source map",
      detail: `${String(nativeSpeedClips.length)} native clip(s) use a speed other than 1×.`,
      repair: "Bake the time-remapped native layer or restore 1× speed before rendering.",
    });
  }
  const importedNative = nativeClips.filter((clip) =>
    security.trustRecords.some(
      (record) => record.compositionId === clip.assetId && record.trustClass === "imported_untrusted",
    ),
  );
  if (importedNative.length > 0) {
    findings.push({
      code: "render.compositor.imported-worker-unavailable",
      severity: "error",
      blocking: true,
      title: "Imported native execution is not connected to an isolated worker",
      detail: `${String(importedNative.length)} native clip(s) require a bound imported-content worker selection.`,
      repair: "Promote reviewed source to trusted-authored or connect the isolated imported-content worker.",
    });
  }
  const unsupportedPropertyPaths = clips
    .filter((clip) => clip.engine === "shared")
    .flatMap((clip) =>
      Object.keys(clip.properties ?? {})
        .filter(
          (propertyPath) =>
            !sharedCompositorPropertyPaths.has(propertyPath) &&
            !(clip.engine === "remotion" && propertyPath.startsWith("native.remotion.")) &&
            !(clip.engine === "hyperframes" && propertyPath.startsWith("native.hyperframes.")),
        )
        .map((propertyPath) => `${clip.id}:${propertyPath}`),
    );
  const unsupportedKeyframes = (timeline.keyframes ?? []).filter(
    (keyframe) =>
      clips.some((clip) => clip.id === keyframe.ownerEntityId) &&
      (!sharedCompositorPropertyPaths.has(keyframe.propertyPath) ||
        keyframe.authority !== "shared" ||
        keyframe.preserveNativeAnimation ||
        keyframe.interpolation === "spring" ||
        keyframe.interpolation === "native"),
  );
  if (unsupportedPropertyPaths.length > 0 || unsupportedKeyframes.length > 0) {
    findings.push({
      code: "render.compositor.property-unavailable",
      severity: "error",
      blocking: true,
      title: "The range contains property state the exact evaluator does not support",
      detail: `${String(unsupportedPropertyPaths.length)} property path(s) and ${String(unsupportedKeyframes.length)} keyframe(s) require an unavailable evaluator.`,
      repair: "Bake or remove unsupported effects/native animation before rendering this range.",
    });
  }
  const wantsAudio = profile.outputKind === "audio" || profile.audioCodec !== null;
  const audibleTimelineAssets = clips.filter((clip) => {
    const asset = clip.assetId === null ? undefined : assetById.get(clip.assetId);
    return clip.engine === "shared" && asset?.validationState === "valid" && asset.hasAudio;
  });
  const activeGraphClips = (timeline.audioGraph?.clips ?? []).filter((clip) =>
    rangeIntersects(scope, timeline.durationFrames, clip.startFrame, clip.endFrameExclusive),
  );
  if (wantsAudio && audibleTimelineAssets.length === 0 && activeGraphClips.length === 0) {
    findings.push({
      code: "render.compositor.audio-source-missing",
      severity: "error",
      blocking: true,
      title: "The delivery profile requests audio but the range has no audible source",
      detail:
        "No validated shared audio stream or active immutable AudioGraph clip intersects the render range.",
      repair: "Place an audible source in the range or use a delivery profile that declares no audio.",
    });
  }
  const supportedVideoCodecs = new Set([
    "h264",
    "h265",
    "vp8",
    "vp9",
    "prores-4444",
    "prores-422-hq",
    "png",
    "mjpeg",
  ]);
  const supportedAudioCodecs = new Set(["aac", "pcm-s24le", "flac"]);
  if (profile.videoCodec !== null && !supportedVideoCodecs.has(profile.videoCodec)) {
    findings.push({
      code: "render.compositor.video-codec-unavailable",
      severity: "error",
      blocking: true,
      title: "The selected video codec is not connected to the local encoder",
      detail: `Codec ${profile.videoCodec} has no exact local encoding contract.`,
      repair: "Choose a built-in delivery profile or add and validate the codec mapping.",
    });
  }
  if (profile.audioCodec !== null && !supportedAudioCodecs.has(profile.audioCodec)) {
    findings.push({
      code: "render.compositor.audio-codec-unavailable",
      severity: "error",
      blocking: true,
      title: "The selected audio codec is not connected to the local encoder",
      detail: `Codec ${profile.audioCodec} has no exact local encoding contract.`,
      repair: "Choose a built-in delivery profile or add and validate the codec mapping.",
    });
  }
  return findings;
};

const sharedCompositorPropertyPaths = new Set([
  "transform.position",
  "transform.scale",
  "transform.rotation",
  "transform.anchor",
  "transform.opacity",
  "transform.crop",
  "composite.blendMode",
  "time.speed",
  "audio.volume",
  "audio.fadeIn",
  "audio.fadeOut",
]);

const rangeIntersects = (
  scope: RenderScope,
  timelineDurationFrames: string,
  startFrame: string,
  endFrameExclusive: string,
): boolean => {
  const range =
    scope.kind === "full-timeline"
      ? { start: 0n, end: BigInt(timelineDurationFrames) }
      : scope.kind === "frame"
        ? { start: BigInt(scope.frame), end: BigInt(scope.frame) + 1n }
        : { start: BigInt(scope.startFrame), end: BigInt(scope.endFrameExclusive) };
  return BigInt(endFrameExclusive) > range.start && BigInt(startFrame) < range.end;
};

const unavailableRenderExecutor: RenderExecutor = () =>
  Promise.reject(new Error("Render worker is not connected; execution remains a P07 API placeholder."));

const createOutputReviewChecklist = (
  output: RenderOutputRecord,
  timelineDurationFrames: string,
  hasAlpha: boolean,
): ReviewChecklist => {
  const range =
    output.scope.kind === "frame"
      ? { start: BigInt(output.scope.frame), end: BigInt(output.scope.frame) + 1n }
      : output.scope.kind === "full-timeline"
        ? { start: 0n, end: BigInt(timelineDurationFrames) }
        : { start: BigInt(output.scope.startFrame), end: BigInt(output.scope.endFrameExclusive) };
  const duration = range.end - range.start;
  const last = duration > 0n ? range.end - 1n : range.start;
  const midpoint = duration > 1n ? range.start + duration / 2n : range.start;
  const quarter = duration > 3n ? range.start + duration / 4n : midpoint;
  const threeQuarter = duration > 3n ? range.start + (duration * 3n) / 4n : midpoint;
  if (output.profile.outputKind === "still") {
    return createReviewChecklist({
      id: `review-checklist-${output.id}`,
      outputId: output.id,
      revisionId: output.sourceRevisionId,
      checkpoints: [
        {
          category: "first-frame",
          frame: range.start.toString(10),
          entityIds: [output.id],
          instruction:
            "Confirm the rendered still is intentional, nonblank, complete, and dimensionally correct.",
        },
        {
          category: "color",
          frame: range.start.toString(10),
          entityIds: [output.id],
          instruction: "Confirm the rendered still uses the requested color and compositing contract.",
        },
        {
          category: "alpha",
          frame: range.start.toString(10),
          entityIds: [output.id],
          instruction: hasAlpha
            ? "Inspect the rendered still's straight-alpha edges against the review checkerboard."
            : "Confirm the opaque rendered still has no unintended transparency or matte edge.",
        },
      ],
    });
  }
  const checkpoints = [
    [
      "first-frame",
      range.start,
      "Confirm the first output frame is intentional, nonblank, and color-correct.",
    ],
    ["last-frame", last, "Confirm the final output frame is intentional, nonblank, and complete."],
    ["boundary", quarter, "Inspect the native/shared boundary and adjacent continuity."],
    ["phrase-anchor", quarter, "Confirm the voice phrase and intended visual anchor coincide."],
    ["transition-midpoint", midpoint, "Inspect transition geometry and midpoint continuity."],
    ["caption", midpoint, "Confirm caption readability, collision safety, and phrase timing."],
    ["shader", threeQuarter, "Inspect shader output for deterministic fidelity and edge artifacts."],
    ["continuity", threeQuarter, "Confirm motion, source, and cross-engine continuity."],
    ["color", midpoint, "Confirm expected color, transfer, and compositing appearance."],
    [
      "alpha",
      midpoint,
      hasAlpha
        ? "Inspect straight-alpha edges against the review checkerboard."
        : "Confirm the opaque delivery has no unintended transparency or matte edge.",
    ],
  ] as const;
  return createReviewChecklist({
    id: `review-checklist-${output.id}`,
    outputId: output.id,
    revisionId: output.sourceRevisionId,
    checkpoints: checkpoints.map(([category, frame, instruction]) => ({
      category,
      frame: frame.toString(10),
      entityIds: [output.id],
      instruction,
    })),
  });
};

export const verifyOutputQa: QaEvaluator = async ({ output, rootPath, signal, report }) => {
  report(0.1);
  const evidence: string[] = [];
  const receipt = JSON.parse(
    await readFile(path.join(rootPath, "receipts", "renders", output.id, "render.json"), "utf8"),
  ) as RenderReceiptBase;
  const observedHashes = new Map<string, Readonly<{ hash: string; readable: boolean }>>();
  for (const artifact of output.artifacts) {
    if (signal.aborted) throw new DOMException("Render QA cancelled.", "AbortError");
    const absolute = path.join(rootPath, artifact.relativePath);
    try {
      const observed = await hashFile(absolute);
      observedHashes.set(artifact.relativePath, { hash: observed, readable: true });
      evidence.push(observed);
    } catch {
      observedHashes.set(artifact.relativePath, { hash: artifact.contentHash, readable: false });
      evidence.push(artifact.contentHash);
    }
  }
  const primary = output.artifacts.find((artifact) => artifact.primary);
  if (primary === undefined) throw new Error("Render output has no primary artifact.");
  const observedPrimary = observedHashes.get(primary.relativePath);
  if (observedPrimary === undefined) throw new Error("Primary render artifact was not evaluated.");
  const expectedDurationFrames = (
    BigInt(receipt.dag.range.endFrameExclusive) - BigInt(receipt.dag.range.startFrame)
  ).toString(10);
  const primaryArtifactProbe = await probePrimaryArtifact({
    absolutePath: path.join(rootPath, primary.relativePath),
    relativePath: primary.relativePath,
    contentHash: observedPrimary.hash,
    readable: observedPrimary.readable,
    signal,
  });
  evidence.push(primaryArtifactProbe.identityHash);
  const inspection = primaryArtifactProbe.inspection;
  const primaryVideo = inspection?.videoStreams[0] ?? null;
  const primaryAudio = inspection?.audioStreams[0] ?? null;
  const expectedAudio = output.profile.audioCodec !== null;
  const measuredAudio = receipt.audio.status === "measured" ? receipt.audio : null;
  const measuredAudioArtifactPresent =
    measuredAudio !== null &&
    output.artifacts.some((artifact) => artifact.contentHash === measuredAudio.artifactHash);
  const observedFrameCount = observedOutputFrameCount(output, inspection, receipt.dag.fps);
  const scopeLocation = outputScopeLocation(output, receipt.dag.range);
  const structural = evaluateStructuralOutput({
    artifactPath: primary.relativePath,
    probeEvidenceHash: primaryArtifactProbe.identityHash,
    probeVersion: inspection?.probeVersion ?? "ffprobe unavailable",
    readable: observedPrimary.readable && primaryArtifactProbe.status === "probed",
    contentHash: observedPrimary.hash,
    expectedContentHash: primary.contentHash,
    durationFrames: observedFrameCount ?? "unavailable",
    expectedDurationFrames,
    width: primaryVideo?.width ?? null,
    height: primaryVideo?.height ?? null,
    expectedWidth: output.profile.width,
    expectedHeight: output.profile.height,
    fps: output.profile.outputKind === "video" ? observedVideoFps(primaryVideo) : null,
    expectedFps: output.profile.fps,
    container: observedContainer(output.profile.container, inspection?.containerNames ?? []),
    expectedContainer: output.profile.container,
    videoCodec: observedVideoCodec(output.profile.videoCodec, primaryVideo),
    expectedVideoCodec: output.profile.videoCodec,
    audioCodec: observedAudioCodec(output.profile.audioCodec, primaryAudio?.codec ?? null),
    expectedAudioCodec: output.profile.audioCodec,
    audioPresent: inspection?.hasAudio ?? false,
    expectedAudio,
    sampleRate: primaryAudio?.sampleRate ?? null,
    expectedSampleRate: expectedAudio ? output.profile.audioSampleRate : null,
    channels: primaryAudio?.channels ?? null,
    expectedChannels: expectedAudio ? (measuredAudio?.channels ?? null) : null,
    frameCount: output.profile.outputKind === "audio" ? null : observedFrameCount,
    frame: scopeLocation.frame,
    frameRange: scopeLocation.frameRange,
  });
  if (!expectedAudio) {
    const state = structural.blocking && structural.status === "failed" ? "qa_failed" : "qa_passed";
    report(0.9);
    return {
      state,
      evidenceHashes: [...new Set(evidence)],
      exceptionIds: [],
      primaryArtifactProbe,
      findings: [structural],
      audio: {
        status: "not-applicable",
        measurementVersion: null,
        reasons: [],
        measurements: receipt.audio,
      },
    };
  }
  if (measuredAudio === null) {
    throw new Error("The delivery profile requires audio but the immutable receipt has no audio evidence.");
  }
  const reasons: string[] = [];
  if (!measuredAudioArtifactPresent) {
    reasons.push("The measured authoritative audio artifact is not present in render outputs.");
  }
  if (measuredAudio.clippedSampleCount > 0 || (measuredAudio.truePeakDbtp ?? -Infinity) > 0) {
    reasons.push("The authoritative mix contains clipped samples or a true peak above 0 dBTP.");
  }
  const totalSamples = BigInt(measuredAudio.durationSamples) * BigInt(measuredAudio.channels);
  if (measuredAudio.integratedLufs === null || BigInt(measuredAudio.silentSampleCount) === totalSamples) {
    reasons.push("The authoritative mix is silent or has no measurable integrated loudness.");
  }
  const expectedDurationSamples = framesToSamples(
    expectedDurationFrames,
    receipt.dag.fps,
    measuredAudio.sampleRate,
  );
  const audioFinding = evaluateAudioMeasurements({
    artifactHash: measuredAudio.artifactHash,
    durationSamples: measuredAudio.durationSamples,
    expectedDurationSamples,
    integratedLufs: measuredAudio.integratedLufs,
    targetLufs: output.profile.purpose === "final" ? -16 : -18,
    loudnessToleranceLufs: 4,
    truePeakDbtp: measuredAudio.truePeakDbtp,
    maximumTruePeakDbtp: 0,
    clippedSampleCount: measuredAudio.clippedSampleCount,
    silentSampleCount: measuredAudio.silentSampleCount,
    totalSampleCount: totalSamples.toString(10),
    channels: measuredAudio.channels,
    expectedChannels: measuredAudio.channels,
    syncDeltaSamples: "0",
    maximumSyncDeltaSamples: "1",
  });
  const findings = [structural, audioFinding];
  const state = findings.some((finding) => finding.blocking && finding.status === "failed")
    ? "qa_failed"
    : findings.some((finding) => finding.status === "warning" || finding.status === "requires-review")
      ? "qa_warning"
      : "qa_passed";
  const audioStatus: "passed" | "warning" | "failed" =
    audioFinding.status === "failed" ? "failed" : audioFinding.status === "warning" ? "warning" : "passed";
  report(0.9);
  return {
    state,
    evidenceHashes: [...new Set(evidence)],
    exceptionIds: [],
    primaryArtifactProbe,
    findings,
    audio: {
      status: audioStatus,
      measurementVersion: measuredAudio.measurementVersion,
      reasons,
      measurements: measuredAudio,
    },
  };
};

const probePrimaryArtifact = async (input: {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly readable: boolean;
  readonly signal: AbortSignal;
}): Promise<RenderArtifactProbeEvidence> => {
  input.signal.throwIfAborted();
  if (!input.readable) return failedArtifactProbe(input.relativePath, input.contentHash);
  try {
    const inspection = await inspectMediaFile({
      filePath: input.absolutePath,
      contentHash: input.contentHash,
    });
    input.signal.throwIfAborted();
    const withoutIdentity = {
      schemaVersion: "1.0.0" as const,
      status: "probed" as const,
      artifactPath: input.relativePath,
      artifactHash: input.contentHash,
      inspection,
      failureCode: null,
    };
    return { ...withoutIdentity, identityHash: hashCanonical(withoutIdentity) };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    input.signal.throwIfAborted();
    return failedArtifactProbe(input.relativePath, input.contentHash);
  }
};

const failedArtifactProbe = (relativePath: string, contentHash: string): RenderArtifactProbeEvidence => {
  const withoutIdentity = {
    schemaVersion: "1.0.0" as const,
    status: "failed" as const,
    artifactPath: relativePath,
    artifactHash: contentHash,
    inspection: null,
    failureCode: "ffprobe-failed" as const,
  };
  return { ...withoutIdentity, identityHash: hashCanonical(withoutIdentity) };
};

const observedOutputFrameCount = (
  output: RenderOutputRecord,
  inspection: MediaInspectionV1 | null,
  renderFps: Readonly<{ numerator: string; denominator: string }>,
): string | null => {
  if (inspection === null) return null;
  if (output.profile.outputKind === "still") {
    return inspection.videoStreams.length === 1 && inspection.audioStreams.length === 0 ? "1" : null;
  }
  const video = inspection.videoStreams[0];
  if (video !== undefined) {
    if (video.frameCount !== null) return video.frameCount;
    const duration = video.durationSeconds ?? inspection.durationSeconds;
    const fps = observedVideoFps(video);
    return duration === null || fps === null ? null : exactFrameCount(duration, fps);
  }
  const audio = inspection.audioStreams[0];
  const duration = audio?.durationSeconds ?? inspection.durationSeconds;
  return duration === null ? null : exactFrameCount(duration, renderFps);
};

const exactFrameCount = (
  duration: Readonly<{ numerator: string; denominator: string }>,
  fps: Readonly<{ numerator: string; denominator: string }>,
): string | null => {
  const numerator = BigInt(duration.numerator) * BigInt(fps.numerator);
  const denominator = BigInt(duration.denominator) * BigInt(fps.denominator);
  return numerator % denominator === 0n ? (numerator / denominator).toString(10) : null;
};

const observedVideoFps = (
  stream: MediaInspectionV1["videoStreams"][number] | null,
): Readonly<{ numerator: string; denominator: string }> | null =>
  stream?.averageFrameRate ?? stream?.realFrameRate ?? null;

const observedContainer = (expected: DeliveryProfile["container"], names: readonly string[]): string => {
  const accepted: Readonly<Record<DeliveryProfile["container"], readonly string[]>> = {
    mp4: ["mp4"],
    mov: ["mov"],
    webm: ["webm"],
    png: ["png", "png_pipe"],
    jpeg: ["jpeg", "jpeg_pipe", "image2"],
    wav: ["wav"],
    flac: ["flac"],
  };
  return names.some((name) => accepted[expected].includes(name)) ? expected : names.join(",") || "unknown";
};

const observedVideoCodec = (
  expected: string | null,
  stream: MediaInspectionV1["videoStreams"][number] | null,
): string | null => {
  if (stream === null) return null;
  if (expected === stream.codec) return expected;
  if (expected === "h265" && stream.codec === "hevc") return expected;
  if (expected === "prores-4444" && stream.codec === "prores" && /4444/i.test(stream.profile ?? "")) {
    return expected;
  }
  if (expected === "prores-422-hq" && stream.codec === "prores" && /hq/i.test(stream.profile ?? "")) {
    return expected;
  }
  return stream.profile === null ? stream.codec : `${stream.codec}:${stream.profile}`;
};

const observedAudioCodec = (expected: string | null, actual: string | null): string | null => {
  if (actual === null) return null;
  if (expected !== null && expected.replaceAll("-", "_") === actual.replaceAll("-", "_")) return expected;
  return actual;
};

const outputScopeLocation = (
  output: RenderOutputRecord,
  range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
): Readonly<{
  frame: string | null;
  frameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
}> =>
  output.scope.kind === "frame"
    ? { frame: output.scope.frame, frameRange: null }
    : { frame: null, frameRange: range };

const framesToSamples = (
  durationFrames: string,
  fps: Readonly<{ numerator: string; denominator: string }>,
  sampleRate: number,
): string => {
  const numerator = BigInt(durationFrames) * BigInt(sampleRate) * BigInt(fps.denominator);
  const denominator = BigInt(fps.numerator);
  return ((numerator + denominator / 2n) / denominator).toString(10);
};

const validateRenderName = (value: string): string => {
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || normalized.length > 128) throw new Error("Render name is invalid.");
  return normalized;
};

const validatePriority = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < -100 || value > 100) {
    throw new Error("Render priority must be an integer from -100 through 100.");
  }
  return value;
};

const validatePersistedRequest = (request: RenderRequestRecord): void => {
  const schemaVersion: unknown = (request as unknown as Readonly<Record<string, unknown>>).schemaVersion;
  if (
    schemaVersion !== "1.0.0" ||
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(request.id) ||
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(request.jobId) ||
    request.preflight.identityHash.length !== 64
  )
    throw new Error("Persisted render request is invalid.");
  validateDeliveryProfile(request.profile);
  validateRenderScope(request.scope);
  validateRenderName(request.name);
  validatePriority(request.priority);
};

const validateExecutorPlan = (plan: RenderPlan, request: RenderRequestRecord): void => {
  validateRenderDag(plan.dag);
  if (
    !plan.executable ||
    plan.dag.projectId !== request.projectId ||
    plan.dag.revisionId !== request.revisionId ||
    plan.findings.some((finding) => finding.blocking || finding.severity === "error")
  ) {
    throw new Error("Render executor plan is blocked or does not match the immutable request.");
  }
  const { identityHash, ...withoutHash } = plan;
  if (identityHash !== hashCanonicalRenderValue(withoutHash as unknown as JsonValue)) {
    throw new Error("Render executor plan identity is invalid.");
  }
  if (
    !/^[a-f0-9]{64}$/.test(plan.dependencyManifest.identityHash) ||
    !/^[a-f0-9]{64}$/.test(plan.environment.strictEnvironmentFingerprint) ||
    !/^[a-f0-9]{64}$/.test(plan.environment.compatiblePreviewFingerprint)
  ) {
    throw new Error("Render executor plan evidence identity is invalid.");
  }
};

const validateSecurityEvidence = (security: RenderSecurityEvidence, plan: RenderPlan): void => {
  const planTrust = [
    ...new Set(
      plan.dag.nodes.map((node) =>
        node.trustClass === "trusted-authored"
          ? ("trusted_authored" as const)
          : ("imported_untrusted" as const),
      ),
    ),
  ].sort();
  if (
    !/^[a-f0-9]{64}$/.test(security.policyIdentity) ||
    !/^[a-f0-9]{64}$/.test(security.environmentIdentity) ||
    JSON.stringify([...security.trustClasses].sort()) !== JSON.stringify(planTrust) ||
    security.workerPoolIds.length === 0 ||
    security.cacheNamespaces.length === 0 ||
    security.approvedNetworkHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) ||
    (security.trustClasses.includes("imported_untrusted") &&
      (security.isolationEvidenceHash === null || !/^[a-f0-9]{64}$/.test(security.isolationEvidenceHash)))
  ) {
    throw new Error("Render security evidence is invalid or does not match the render DAG trust policy.");
  }
};

const validateAudioEvidence = (
  audio: RenderAudioEvidence,
  artifacts: readonly RenderArtifactRecord[],
  profile: RenderProfileRequest,
): void => {
  if (profile.audioCodec === null) {
    if (audio.status !== "not-applicable") {
      throw new Error("A no-audio delivery profile must not publish measured audio evidence.");
    }
    return;
  }
  if (audio.status !== "measured") {
    throw new Error("An audio delivery profile requires measured audio evidence.");
  }
  const expectedChannels =
    audio.channelLayout === "mono"
      ? 1
      : audio.channelLayout === "stereo"
        ? 2
        : audio.channelLayout === "5.1"
          ? 6
          : 8;
  const nullableMeasurements = [
    audio.integratedLufs,
    audio.samplePeakDbfs,
    audio.truePeakDbtp,
    ...audio.channelPeaksDbfs,
  ];
  if (
    !/^[a-f0-9]{64}$/.test(audio.artifactHash) ||
    !/^[a-f0-9]{64}$/.test(audio.graphIdentity) ||
    !artifacts.some((artifact) => artifact.contentHash === audio.artifactHash) ||
    audio.channels !== expectedChannels ||
    audio.channelPeaksDbfs.length !== audio.channels ||
    !/^[1-9][0-9]*$/.test(audio.durationSamples) ||
    !Number.isSafeInteger(audio.clippedSampleCount) ||
    audio.clippedSampleCount < 0 ||
    !Number.isSafeInteger(audio.silentSampleCount) ||
    audio.silentSampleCount < 0 ||
    nullableMeasurements.some((value) => value !== null && !Number.isFinite(value))
  ) {
    throw new Error("Render audio measurements are invalid or do not match an output artifact.");
  }
  const maximumCount = BigInt(audio.durationSamples) * BigInt(audio.channels);
  if (BigInt(audio.clippedSampleCount) > maximumCount || BigInt(audio.silentSampleCount) > maximumCount) {
    throw new Error("Render audio sample counts exceed the measured artifact duration.");
  }
};

const validateArtifacts = (
  rootPath: string,
  outputDirectory: string,
  primary: string,
  additional: readonly string[],
): Promise<readonly RenderArtifactRecord[]> => {
  const relativePaths = [primary, ...additional];
  if (new Set(relativePaths).size !== relativePaths.length || relativePaths.length > 32) {
    throw new Error("Render artifacts must be unique and bounded.");
  }
  return Promise.all(
    relativePaths.map(async (relativePath, index) => {
      if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
        throw new Error("Render artifact path must remain relative to its output directory.");
      }
      const absolute = path.resolve(outputDirectory, relativePath);
      if (!absolute.startsWith(`${path.resolve(outputDirectory)}${path.sep}`)) {
        throw new Error("Render artifact path escapes its output directory.");
      }
      const metadata = await stat(absolute);
      if (!metadata.isFile()) throw new Error("Render artifact is not a regular file.");
      return {
        relativePath: path.relative(rootPath, absolute).split(path.sep).join("/"),
        byteLength: metadata.size,
        contentHash: await hashFile(absolute),
        primary: index === 0,
      };
    }),
  );
};

const validateHashes = (hashes: readonly string[]): void => {
  if (hashes.length === 0 || hashes.length > 256 || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Lifecycle evidence hashes are invalid or missing.");
  }
};

const hashFile = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

const hashCanonical = (value: unknown): string =>
  createHash("sha256").update(stringifyCanonicalJson(value), "utf8").digest("hex");

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
  await rename(temporary, target);
};
