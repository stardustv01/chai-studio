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
  loadCurrentProjectRevision,
  loadProjectRevision,
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
  readonly delivery: RenderDeliveryRecord | null;
  readonly currentState: QaState;
}

export interface RenderDeliveryRecord {
  readonly schemaVersion: "1.0.0";
  readonly outputId: string;
  readonly sourceRevisionId: string;
  readonly deliveryProfileIdentity: string;
  readonly evidenceHashes: readonly string[];
  readonly lifecycleEventHash: string;
  readonly createdAt: string;
}

interface LifecycleTransactionRecord {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly outputId: string;
  readonly sourceRevisionId: string;
  readonly resultingRevisionId: string;
  readonly event: RenderLifecycleEvent;
  readonly identityHash: string;
}

interface LifecycleTransitionRequest {
  readonly outputId: string;
  readonly to: QaState;
  readonly actor: CommitActor;
  readonly expectedRevisionId: string;
  readonly evidenceHashes: readonly string[];
  readonly exceptionIds: readonly string[];
  readonly report: QaReport | null;
  readonly exceptions: readonly AcceptedExceptionDocument[];
}

interface DeliverRequest {
  readonly outputId: string;
  readonly actor: CommitActor;
  readonly expectedRevisionId: string;
  readonly evidenceHashes: readonly string[];
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
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#outputsAtRoot(lease.rootPath);
    } finally {
      lease.release();
    }
  }

  async #outputsAtRoot(rootPath: string): Promise<readonly RenderOutputRecord[]> {
    const root = path.join(rootPath, "renders");
    let names: string[];
    try {
      names = await readdir(root);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
    const outputs: RenderOutputRecord[] = [];
    for (const name of names.sort()) {
      let output: RenderOutputRecord;
      try {
        output = validateRenderOutput(await readPersistedJson(path.join(root, name, "output.json")), name);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        const recovered = await this.#recoverMissingOutput(rootPath, name);
        if (recovered === null) continue;
        output = recovered;
      }
      const receipt = await this.#receiptAtRoot(rootPath, output.id);
      if (
        receipt.base.projectId !== output.projectId ||
        receipt.base.sourceRevisionId !== output.sourceRevisionId ||
        receipt.base.renderRequestId !== output.renderRequestId ||
        receipt.base.jobId !== output.jobId ||
        receipt.base.identityHash !== output.receiptIdentityHash ||
        receipt.lifecycle[0]?.resultingRevisionId !== output.activationRevisionId ||
        receipt.base.completedAt !== output.createdAt ||
        output.lifecycleState !== "rendered_unchecked" ||
        hashCanonical(receipt.base.deliveryProfile) !== hashCanonical(output.profile) ||
        hashCanonical(receipt.base.renderScope) !== hashCanonical(output.scope) ||
        !sameArtifacts(receipt.base.artifacts, output.artifacts)
      ) {
        throw new Error(`Persisted render output ${name} does not match its immutable receipt.`);
      }
      outputs.push({ ...output, lifecycleState: receipt.currentState });
    }
    return outputs;
  }

  async output(outputId: string): Promise<RenderOutputRecord> {
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#outputAtRoot(lease.rootPath, outputId);
    } finally {
      lease.release();
    }
  }

  async #outputAtRoot(root: string, outputId: string): Promise<RenderOutputRecord> {
    const output = (await this.#outputsAtRoot(root)).find((candidate) => candidate.id === outputId);
    if (output === undefined) throw new Error(`Unknown render output ID: ${outputId}.`);
    const receipt = await this.#receiptAtRoot(root, outputId);
    return { ...output, lifecycleState: receipt.currentState };
  }

  async artifact(outputId: string, index: number): Promise<RenderArtifactPayload> {
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#artifactAtRoot(lease.rootPath, outputId, index);
    } finally {
      lease.release();
    }
  }

  async #artifactAtRoot(root: string, outputId: string, index: number): Promise<RenderArtifactPayload> {
    const output = await this.#outputAtRoot(root, outputId);
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
    const resolvedRoot = path.resolve(root);
    const absolute = path.resolve(resolvedRoot, artifact.relativePath);
    const relative = path.relative(resolvedRoot, absolute);
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
    const expectedRoot = this.#projects.openRootPath();
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
    const lease = this.#projects.acquireOperationLease();
    try {
      if (lease.rootPath !== expectedRoot) {
        throw new Error("Project changed while QA was being prepared.");
      }
      return this.#jobs.enqueue({
        kind: "render.qa",
        correlationId: input.correlationId,
        projectId: output.projectId,
        revisionId: snapshot.pointer.revisionId,
        label: `QA · ${output.id}`,
        task: async ({ signal, report, reportStage }) => {
          try {
            reportStage({ stage: "Validate output artifacts", activeEngine: "shared" });
            const result = await this.#evaluateQa({
              output,
              rootPath: lease.rootPath,
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
                result.state === "qa_failed"
                  ? "failed"
                  : result.state === "qa_warning"
                    ? "warning"
                    : "passed",
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
                lease.rootPath,
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
            await writeJsonAtomic(this.#checklistPath(output.id, lease.rootPath), checklist);
            reportStage({ stage: "Record QA evidence", activeEngine: "shared" });
            const event = await this.#transition({
              outputId: output.id,
              to: authoritativeReport.state,
              actor: input.actor,
              expectedRevisionId: input.expectedRevisionId,
              evidenceHashes: [
                ...result.evidenceHashes,
                qaReport.reportHash,
                authoritativeReport.identityHash,
              ],
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
          } finally {
            lease.release();
          }
        },
      });
    } catch (cause) {
      lease.release();
      throw cause;
    }
  }

  async qaWorkspace(outputId: string): Promise<QaWorkspaceView> {
    const lease = this.#projects.acquireOperationLease();
    try {
      await this.#outputAtRoot(lease.rootPath, outputId);
      const receipt = await this.#receiptAtRoot(lease.rootPath, outputId);
      const reports = receipt.qaReports;
      return {
        outputId,
        rules: centralizedQaRules(),
        ruleSetIdentity: qaRuleSetIdentity(),
        reports,
        latest: reports.at(-1) ?? null,
        checklist: receipt.checklist,
      };
    } finally {
      lease.release();
    }
  }

  async recordChecklistItem(input: {
    readonly outputId: string;
    readonly itemId: string;
    readonly status: "passed" | "failed";
    readonly reviewerId: string;
    readonly evidenceHashes: readonly string[];
  }): Promise<ReviewChecklist> {
    const lease = this.#projects.acquireOperationLease();
    try {
      const output = await this.#outputAtRoot(lease.rootPath, input.outputId);
      const checklist = await this.#readChecklist(output.id, lease.rootPath);
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
      await writeJsonAtomic(this.#checklistPath(output.id, lease.rootPath), updated);
      return updated;
    } finally {
      lease.release();
    }
  }

  async approve(input: {
    readonly outputId: string;
    readonly actor: CommitActor;
    readonly expectedRevisionId: string;
    readonly evidenceHashes: readonly string[];
    readonly exceptionIds: readonly string[];
  }): Promise<RenderLifecycleEvent> {
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#approveAtRoot(lease.rootPath, input);
    } finally {
      lease.release();
    }
  }

  async #approveAtRoot(
    root: string,
    input: {
      readonly outputId: string;
      readonly actor: CommitActor;
      readonly expectedRevisionId: string;
      readonly evidenceHashes: readonly string[];
      readonly exceptionIds: readonly string[];
    },
  ): Promise<RenderLifecycleEvent> {
    const snapshot = await this.#projects.snapshot();
    if (snapshot.approvalState.outputId !== input.outputId) {
      throw new Error("Approval requires the current immutable output identity.");
    }
    if (snapshot.approvalState.state === "qa_warning" && input.exceptionIds.length === 0) {
      throw new Error("Approving qa_warning requires at least one scoped accepted exception.");
    }
    if (snapshot.approvalState.state !== "qa_passed" && snapshot.approvalState.state !== "qa_warning") {
      throw new Error("Approval requires qa_passed or qa_warning state.");
    }
    const latest = (await this.#receiptAtRoot(root, input.outputId)).qaReports.at(-1);
    if (latest === undefined) throw new Error("Approval requires an immutable QA report.");
    const checklist = await this.#readChecklist(input.outputId, root);
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

  async deliver(input: DeliverRequest): Promise<RenderLifecycleEvent> {
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#performDelivery(lease.rootPath, input);
    } finally {
      lease.release();
    }
  }

  async #performDelivery(root: string, input: DeliverRequest): Promise<RenderLifecycleEvent> {
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
      this.#deliveryPath(root, output.id),
      deliveryRecordFor(output.id, output.sourceRevisionId, output.profile.identityHash, event),
    );
    return event;
  }

  async receipt(outputId: string): Promise<RenderReceiptView> {
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#receiptAtRoot(lease.rootPath, outputId);
    } finally {
      lease.release();
    }
  }

  async #receiptAtRoot(root: string, outputId: string): Promise<RenderReceiptView> {
    await this.#recoverLifecycleTransactions(root, outputId);
    const base = validateRenderReceiptBase(
      await readPersistedJson(path.join(root, "receipts", "renders", outputId, "render.json")),
      outputId,
    );
    const lifecycleDirectory = path.join(root, "receipts", "renders", outputId, "lifecycle");
    let names: readonly string[];
    try {
      names = (await readdir(lifecycleDirectory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") names = [];
      else throw cause;
    }
    const unorderedLifecycle = await Promise.all(
      names.map(async (name) =>
        validateLifecycleEvent(await readPersistedJson(path.join(lifecycleDirectory, name)), outputId),
      ),
    );
    const lifecycle = await this.#validateAndOrderLifecycleEvents(root, unorderedLifecycle, base);
    const currentState = lifecycle.at(-1)?.to ?? base.initialLifecycleState;
    let delivery = await this.#readDelivery(root, outputId, base);
    if (currentState === "delivered" && delivery === null) {
      const deliveredEvent = lifecycle.at(-1);
      if (deliveredEvent?.to !== "delivered") {
        throw new Error("Persisted delivery lifecycle is inconsistent.");
      }
      delivery = deliveryRecordFor(
        outputId,
        base.sourceRevisionId,
        base.deliveryProfile.identityHash,
        deliveredEvent,
      );
      await writeJsonAtomic(this.#deliveryPath(root, outputId), delivery);
    }
    if (delivery !== null && currentState !== "delivered") {
      throw new Error("Persisted delivery record exists without a delivered lifecycle state.");
    }
    if (
      delivery !== null &&
      (delivery.lifecycleEventHash !== lifecycle.at(-1)?.eventHash ||
        delivery.createdAt !== lifecycle.at(-1)?.createdAt ||
        hashCanonical(delivery.evidenceHashes) !== hashCanonical(lifecycle.at(-1)?.evidenceHashes))
    ) {
      throw new Error("Persisted delivery record does not match the delivered lifecycle event.");
    }
    const qaReports = bindQaReportsToLifecycle(await this.#qaReports(outputId, root), lifecycle, outputId);
    return {
      base,
      lifecycle,
      qaReports,
      checklist: await this.#readChecklist(outputId, root),
      delivery,
      currentState,
    };
  }

  async #validateAndOrderLifecycleEvents(
    root: string,
    events: readonly RenderLifecycleEvent[],
    base: RenderReceiptBase,
  ): Promise<readonly RenderLifecycleEvent[]> {
    const current = await loadCurrentProjectRevision(root);
    const sourceRevisions = new Set<string>();
    const ancestryOrder = new Map<string, number>();
    let ancestryRevisionId: string | null = current.pointer.revisionId;
    while (ancestryRevisionId !== null && ancestryOrder.size < 10_000) {
      if (ancestryOrder.has(ancestryRevisionId)) {
        throw new Error("Project revision ancestry contains a cycle.");
      }
      ancestryOrder.set(ancestryRevisionId, ancestryOrder.size);
      const revision = await loadProjectRevision(root, ancestryRevisionId);
      ancestryRevisionId = revision.transaction.parentRevisionId;
    }
    if (ancestryOrder.size >= 10_000) {
      throw new Error("Project revision ancestry exceeds recovery bounds.");
    }
    for (const event of events) {
      if (sourceRevisions.has(event.sourceRevisionId)) {
        throw new Error(`Persisted lifecycle chain for ${base.outputId} branches from one revision.`);
      }
      if (!ancestryOrder.has(event.resultingRevisionId)) {
        throw new Error(`Persisted lifecycle event ${event.id} is not reachable from current authority.`);
      }
      const revision = await loadProjectRevision(root, event.resultingRevisionId);
      this.#assertLifecycleEventMatchesRevision(event, revision, base);
      sourceRevisions.add(event.sourceRevisionId);
    }
    const ordered = [...events].sort(
      (left, right) =>
        (ancestryOrder.get(right.resultingRevisionId) ?? -1) -
        (ancestryOrder.get(left.resultingRevisionId) ?? -1),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const prior = ordered[index - 1];
      const event = ordered[index];
      if (
        prior === undefined ||
        event === undefined ||
        !(await revisionIsReachable(root, event.sourceRevisionId, prior.resultingRevisionId))
      ) {
        throw new Error(`Persisted lifecycle chain for ${base.outputId} contains disconnected events.`);
      }
    }
    validateLifecycleChain(ordered, base);
    return ordered;
  }

  #assertLifecycleEventMatchesRevision(
    event: RenderLifecycleEvent,
    revision: Awaited<ReturnType<typeof loadProjectRevision>>,
    base: RenderReceiptBase,
  ): void {
    const history = revision.approvalState.history.at(-1);
    if (
      event.outputId !== base.outputId ||
      revision.project.projectId !== base.projectId ||
      revision.transaction.parentRevisionId !== event.sourceRevisionId ||
      revision.transaction.resultingRevisionId !== event.resultingRevisionId ||
      revision.approvalState.outputId !== event.outputId ||
      revision.approvalState.state !== event.to ||
      !revision.transaction.affectedEntityIds.includes(event.outputId) ||
      hashCanonical(revision.transaction.actor) !== hashCanonical(event.actor) ||
      history?.from !== event.from ||
      history.to !== event.to ||
      history.actorId !== event.actor.id ||
      hashCanonical(history.evidenceHashes) !== hashCanonical(event.evidenceHashes) ||
      hashCanonical(history.exceptionIds) !== hashCanonical(event.exceptionIds)
    ) {
      throw new Error(`Persisted lifecycle event ${event.id} conflicts with immutable revision evidence.`);
    }
  }

  async #recoverMissingOutput(root: string, outputId: string): Promise<RenderOutputRecord | null> {
    try {
      await readFile(path.join(root, "receipts", "renders", outputId, "render.json"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
    await this.#recoverLifecycleTransactions(root, outputId);
    const base = validateRenderReceiptBase(
      await readPersistedJson(path.join(root, "receipts", "renders", outputId, "render.json")),
      outputId,
    );
    const lifecycleDirectory = path.join(root, "receipts", "renders", outputId, "lifecycle");
    let lifecycleNames: readonly string[];
    try {
      lifecycleNames = (await readdir(lifecycleDirectory)).filter((name) => name.endsWith(".json"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") lifecycleNames = [];
      else throw cause;
    }
    if (lifecycleNames.length === 0) {
      const recoveredActivation = await this.#recoverActivationEvent(root, outputId, base);
      if (!recoveredActivation) return null;
    }
    const receipt = await this.#receiptAtRoot(root, outputId);
    const activation = receipt.lifecycle[0];
    if (
      activation?.to !== "rendered_unchecked" ||
      !activation.evidenceHashes.includes(receipt.base.identityHash)
    ) {
      throw new Error(`Cannot recover render output ${outputId} without activation evidence.`);
    }
    const revision = await loadProjectRevision(root, activation.resultingRevisionId);
    if (
      revision.project.projectId !== receipt.base.projectId ||
      revision.transaction.parentRevisionId !== receipt.base.sourceRevisionId ||
      revision.approvalState.outputId !== outputId ||
      revision.approvalState.state !== "rendered_unchecked"
    ) {
      throw new Error(`Cannot recover render output ${outputId} from an unrelated project revision.`);
    }
    const output = validateRenderOutput(
      {
        schemaVersion: "1.0.0",
        id: outputId,
        projectId: receipt.base.projectId,
        sourceRevisionId: receipt.base.sourceRevisionId,
        activationRevisionId: activation.resultingRevisionId,
        renderRequestId: receipt.base.renderRequestId,
        jobId: receipt.base.jobId,
        profile: receipt.base.deliveryProfile,
        scope: receipt.base.renderScope,
        artifacts: receipt.base.artifacts,
        receiptIdentityHash: receipt.base.identityHash,
        lifecycleState: receipt.currentState,
        createdAt: receipt.base.completedAt,
      },
      outputId,
    );
    await writeJsonAtomic(path.join(root, "renders", outputId, "output.json"), output);
    return output;
  }

  async #recoverActivationEvent(root: string, outputId: string, base: RenderReceiptBase): Promise<boolean> {
    const current = await loadCurrentProjectRevision(root);
    let revisionId: string | null = current.pointer.revisionId;
    const visited = new Set<string>();
    while (revisionId !== null && visited.size < 10_000) {
      if (visited.has(revisionId)) throw new Error("Project revision ancestry contains a cycle.");
      visited.add(revisionId);
      const revision = await loadProjectRevision(root, revisionId);
      if (
        revision.transaction.parentRevisionId === base.sourceRevisionId &&
        revision.project.projectId === base.projectId &&
        revision.approvalState.outputId === outputId &&
        revision.approvalState.state === "rendered_unchecked"
      ) {
        const history = revision.approvalState.history.at(-1);
        if (
          history?.to !== "rendered_unchecked" ||
          history.actorId !== revision.transaction.actor.id ||
          !history.evidenceHashes.includes(base.identityHash)
        ) {
          throw new Error(`Committed activation revision for ${outputId} lacks matching evidence.`);
        }
        const eventWithoutHash = {
          schemaVersion: "1.0.0" as const,
          id: `lifecycle-recovered-${revisionId}`,
          outputId,
          from: history.from,
          to: "rendered_unchecked" as const,
          actor: revision.transaction.actor,
          sourceRevisionId: base.sourceRevisionId,
          resultingRevisionId: revisionId,
          evidenceHashes: history.evidenceHashes,
          exceptionIds: history.exceptionIds,
          createdAt: revision.transaction.timestamp,
        };
        const event: RenderLifecycleEvent = {
          ...eventWithoutHash,
          eventHash: hashCanonical(eventWithoutHash),
        };
        await writeJsonAtomic(this.#lifecycleEventPath(root, outputId, event), event);
        return true;
      }
      revisionId = revision.transaction.parentRevisionId;
    }
    if (visited.size >= 10_000) throw new Error("Project revision ancestry exceeds recovery bounds.");
    return false;
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
    const lease = this.#projects.acquireOperationLease();
    try {
      const current = await this.#projects.snapshot();
      if (
        current.project.projectId !== input.projectId ||
        current.pointer.revisionId !== input.revisionId ||
        current.revisionHash !== input.revisionHash
      ) {
        throw new Error("Project changed while the render request was being prepared.");
      }
      this.#requests.set(request.id, request);
      await writeJsonAtomic(this.#requestPath(request.id), request);
      await new RenderRecoveryJournalStore(lease.rootPath, this.#now).begin({
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
        task: async ({ signal, report, reportStage }) => {
          try {
            return await this.#runRender(request, signal, report, reportStage);
          } finally {
            lease.release();
          }
        },
      });
      return { request, job };
    } catch (cause) {
      lease.release();
      throw cause;
    }
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

  async #transition(input: LifecycleTransitionRequest): Promise<RenderLifecycleEvent> {
    const lease = this.#projects.acquireOperationLease();
    try {
      return await this.#performTransition(lease.rootPath, input);
    } finally {
      lease.release();
    }
  }

  async #performTransition(root: string, input: LifecycleTransitionRequest): Promise<RenderLifecycleEvent> {
    validateHashes(input.evidenceHashes);
    await this.#recoverLifecycleTransactions(root, input.outputId);
    const snapshot = await this.#projects.snapshot();
    if (snapshot.pointer.revisionId !== input.expectedRevisionId) {
      throw new Error(
        `Lifecycle revision conflict: expected ${input.expectedRevisionId}, current ${snapshot.pointer.revisionId}.`,
      );
    }
    const resultingRevisionId = `revision-lifecycle-${randomUUID()}`;
    const eventWithoutHash = {
      schemaVersion: "1.0.0" as const,
      id: `lifecycle-${randomUUID()}`,
      outputId: input.outputId,
      from: snapshot.approvalState.state,
      to: input.to,
      actor: input.actor,
      sourceRevisionId: input.expectedRevisionId,
      resultingRevisionId,
      evidenceHashes: input.evidenceHashes,
      exceptionIds: input.exceptionIds,
      createdAt: this.#timestamp(),
    };
    const event: RenderLifecycleEvent = {
      ...eventWithoutHash,
      eventHash: hashCanonical(eventWithoutHash),
    };
    const transactionWithoutHash = {
      schemaVersion: "1.0.0" as const,
      id: `lifecycle-transaction-${randomUUID()}`,
      outputId: input.outputId,
      sourceRevisionId: input.expectedRevisionId,
      resultingRevisionId,
      event,
    };
    const transaction: LifecycleTransactionRecord = {
      ...transactionWithoutHash,
      identityHash: hashCanonical(transactionWithoutHash),
    };
    const transactionPath = this.#lifecycleTransactionPath(root, input.outputId, transaction.id);
    await writeJsonAtomic(transactionPath, transaction);
    let receipt;
    try {
      await this.#checkpoint?.("lifecycle-intent-written");
      receipt = await this.#projects.transitionQaLifecycle({
        outputId: input.outputId,
        to: input.to,
        actor: input.actor,
        expectedRevisionId: input.expectedRevisionId,
        report: input.report,
        exceptions: input.exceptions,
        evidenceHashes: input.evidenceHashes,
        exceptionIds: input.exceptionIds,
        resultingRevisionId,
      });
    } catch (cause) {
      await this.#cleanupUncommittedLifecycleIntent(
        root,
        transactionPath,
        input.expectedRevisionId,
        resultingRevisionId,
      );
      throw cause;
    }
    if (receipt.status !== "committed" || receipt.resultingRevisionId !== resultingRevisionId) {
      await this.#cleanupUncommittedLifecycleIntent(
        root,
        transactionPath,
        input.expectedRevisionId,
        resultingRevisionId,
      );
      throw new Error(receipt.error?.message ?? "Lifecycle transition did not commit.");
    }
    await this.#checkpoint?.("lifecycle-revision-committed");
    await writeJsonAtomic(this.#lifecycleEventPath(root, input.outputId, event), event);
    await rm(transactionPath, { force: true });
    return event;
  }

  async #cleanupUncommittedLifecycleIntent(
    root: string,
    transactionPath: string,
    sourceRevisionId: string,
    resultingRevisionId: string,
  ): Promise<void> {
    const current = await loadCurrentProjectRevision(root);
    const committed = await revisionIsReachable(root, current.pointer.revisionId, resultingRevisionId);
    const sourceReachable = await revisionIsReachable(root, current.pointer.revisionId, sourceRevisionId);
    if (!committed && sourceReachable) await rm(transactionPath, { force: true });
  }

  async #recoverLifecycleTransactions(root: string, outputId: string): Promise<void> {
    const directory = path.join(root, "receipts", "renders", outputId, "transactions");
    let names: readonly string[];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    const current = await loadCurrentProjectRevision(root);
    const base = validateRenderReceiptBase(
      await readPersistedJson(path.join(root, "receipts", "renders", outputId, "render.json")),
      outputId,
    );
    for (const name of names) {
      const target = path.join(directory, name);
      const transaction = validateLifecycleTransaction(await readPersistedJson(target), outputId);
      const reachable = await revisionIsReachable(
        root,
        current.pointer.revisionId,
        transaction.resultingRevisionId,
      );
      if (!reachable) {
        const sourceReachable = await revisionIsReachable(
          root,
          current.pointer.revisionId,
          transaction.sourceRevisionId,
        );
        if (!sourceReachable) {
          throw new Error(`Persisted lifecycle transaction ${transaction.id} is not reachable.`);
        }
        await rm(target, { force: true });
        continue;
      }
      const committed = await loadProjectRevision(root, transaction.resultingRevisionId);
      this.#assertLifecycleEventMatchesRevision(transaction.event, committed, base);
      await writeJsonAtomic(this.#lifecycleEventPath(root, outputId, transaction.event), transaction.event);
      await rm(target, { force: true });
    }
  }

  #lifecycleTransactionPath(root: string, outputId: string, transactionId: string): string {
    return path.join(root, "receipts", "renders", outputId, "transactions", `${transactionId}.json`);
  }

  #lifecycleEventPath(root: string, outputId: string, event: RenderLifecycleEvent): string {
    return path.join(
      root,
      "receipts",
      "renders",
      outputId,
      "lifecycle",
      `${event.createdAt.replace(/[:.]/g, "-")}-${event.id}.json`,
    );
  }

  #deliveryPath(root: string, outputId: string): string {
    return path.join(root, "receipts", "renders", outputId, "delivery.json");
  }

  async #readDelivery(
    root: string,
    outputId: string,
    base: RenderReceiptBase,
  ): Promise<RenderDeliveryRecord | null> {
    try {
      return validateDeliveryRecord(await readPersistedJson(this.#deliveryPath(root, outputId)), base);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  async #qaReports(
    outputId: string,
    root: string = this.#projects.openRootPath(),
  ): Promise<readonly QaReceiptRecord[]> {
    const directory = path.join(root, "receipts", "renders", outputId, "qa");
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
      names.map(async (name) =>
        validateQaReceipt(await readPersistedJson(path.join(directory, name)), outputId),
      ),
    );
  }

  async #readChecklist(
    outputId: string,
    root: string = this.#projects.openRootPath(),
  ): Promise<ReviewChecklist | null> {
    try {
      return validateReviewChecklist(await readPersistedJson(this.#checklistPath(outputId, root)), outputId);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  #checklistPath(outputId: string, root: string = this.#projects.openRootPath()): string {
    return path.join(root, "receipts", "renders", outputId, "qa", "checklist.json");
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
      const request = validatePersistedRequest(
        await readPersistedJson(path.join(directory, name)),
        name.slice(0, -5),
      );
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
      names.map(async (name) =>
        validatePersistedJob(await readPersistedJson(path.join(directory, name)), name.slice(0, -5)),
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
        return end > range.start && start < range.end && (scope.kind !== "clip" || clip.id === scope.clipId);
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
  const receipt = validateRenderReceiptBase(
    await readPersistedJson(path.join(rootPath, "receipts", "renders", output.id, "render.json")),
    output.id,
  );
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

// Runtime records arrive from disk. Their static casts describe the value only after these guards pass.
/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unnecessary-boolean-literal-compare */
const validatePersistedRequest = (value: unknown, expectedId?: string): RenderRequestRecord => {
  const request = requireRecord(value, "Persisted render request") as unknown as RenderRequestRecord;
  const schemaVersion: unknown = (request as unknown as Readonly<Record<string, unknown>>).schemaVersion;
  if (
    schemaVersion !== "1.0.0" ||
    !isStableId(request.id) ||
    (expectedId !== undefined && request.id !== expectedId) ||
    !isStableId(request.jobId) ||
    !isStableId(request.projectId) ||
    !isStableId(request.revisionId) ||
    !isHash(request.revisionHash) ||
    !isTimestamp(request.createdAt) ||
    !isRecord(request.preflight) ||
    !isHash(request.preflight.identityHash) ||
    !Number.isSafeInteger(request.attempt) ||
    request.attempt < 1 ||
    (request.retryOfRequestId !== null && !isStableId(request.retryOfRequestId)) ||
    !isCommitActor(request.actor)
  )
    throw new Error("Persisted render request is invalid.");
  validateDeliveryProfile(request.profile);
  validateRenderScope(request.scope);
  validateRenderName(request.name);
  validatePriority(request.priority);
  return request;
};

const validateRenderOutput = (value: unknown, directoryName: string): RenderOutputRecord => {
  const output = requireRecord(value, "Persisted render output") as unknown as RenderOutputRecord;
  if (
    output.schemaVersion !== "1.0.0" ||
    !isStableId(output.id) ||
    output.id !== directoryName ||
    !isStableId(output.projectId) ||
    !isStableId(output.sourceRevisionId) ||
    !isStableId(output.activationRevisionId) ||
    !isStableId(output.renderRequestId) ||
    !isStableId(output.jobId) ||
    !isHash(output.receiptIdentityHash) ||
    !qaStateValues.includes(output.lifecycleState) ||
    !isTimestamp(output.createdAt) ||
    !Array.isArray(output.artifacts)
  ) {
    throw new Error(`Persisted render output ${directoryName} is invalid.`);
  }
  validateDeliveryProfile(output.profile);
  validateRenderScope(output.scope);
  validateArtifactRecords(output.artifacts);
  return output;
};

const validateRenderReceiptBase = (value: unknown, outputId: string): RenderReceiptBase => {
  const receipt = requireRecord(value, "Persisted render receipt") as unknown as RenderReceiptBase;
  if (
    receipt.schemaVersion !== "1.0.0" ||
    receipt.receiptVersion !== "1.0.0" ||
    receipt.outputId !== outputId ||
    !isStableId(receipt.outputId) ||
    !isStableId(receipt.projectId) ||
    !isStableId(receipt.sourceRevisionId) ||
    !isHash(receipt.sourceRevisionHash) ||
    !isStableId(receipt.renderRequestId) ||
    !isStableId(receipt.jobId) ||
    !isTimestamp(receipt.startedAt) ||
    !isTimestamp(receipt.completedAt) ||
    Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt) ||
    !Array.isArray(receipt.artifacts) ||
    !Array.isArray(receipt.engines) ||
    receipt.engines.length === 0 ||
    receipt.engines.length > 32 ||
    receipt.engines.some(
      (engine) =>
        !isRecord(engine) ||
        !["remotion", "hyperframes", "shared"].includes(String(engine.engine)) ||
        !isBoundedString(engine.version, 128) ||
        !isBoundedString(engine.role, 256),
    ) ||
    !isRecord(receipt.environment) ||
    !["strict", "compatible"].includes(String(receipt.environment.mode)) ||
    !isHash(receipt.environment.strictEnvironmentFingerprint) ||
    !isHash(receipt.environment.compatiblePreviewFingerprint) ||
    !isHash(receipt.environment.strictManifestHash) ||
    !isBoundedString(receipt.environment.browserIdentity, 512) ||
    receipt.environment.status !== "recorded" ||
    !isRecord(receipt.dependencies) ||
    !isHash(receipt.dependencies.manifestHash) ||
    !Number.isSafeInteger(receipt.dependencies.entryCount) ||
    receipt.dependencies.entryCount < 0 ||
    !isHash(receipt.dependencies.lockfileHash) ||
    receipt.dependencies.status !== "recorded" ||
    !isRecord(receipt.security) ||
    !isHash(receipt.security.policyIdentity) ||
    !isStringArray(receipt.security.trustClasses, 8) ||
    receipt.security.trustClasses.some(
      (item) => !["trusted_authored", "imported_untrusted"].includes(item),
    ) ||
    !isStringArray(receipt.security.workerPoolIds, 256) ||
    receipt.security.workerPoolIds.length === 0 ||
    !isStringArray(receipt.security.cacheNamespaces, 256) ||
    receipt.security.cacheNamespaces.length === 0 ||
    !isHash(receipt.security.environmentIdentity) ||
    !isHashArray(receipt.security.approvedNetworkHashes, true) ||
    (receipt.security.isolationEvidenceHash !== null && !isHash(receipt.security.isolationEvidenceHash)) ||
    !isStringArray(receipt.security.violations, 1_024) ||
    receipt.security.violations.length > 0 ||
    !isRecord(receipt.dag) ||
    !isStableId(receipt.dag.id) ||
    !Number.isSafeInteger(receipt.dag.nodeCount) ||
    receipt.dag.nodeCount < 1 ||
    !isStringArray(receipt.dag.rootIds, 1_024) ||
    receipt.dag.rootIds.length === 0 ||
    !isRecord(receipt.dag.range) ||
    !isRecord(receipt.dag.fps) ||
    !isUnsignedIntegerString(receipt.dag.range.startFrame) ||
    !isUnsignedIntegerString(receipt.dag.range.endFrameExclusive) ||
    BigInt(receipt.dag.range.endFrameExclusive) <= BigInt(receipt.dag.range.startFrame) ||
    !isPositiveIntegerString(receipt.dag.fps.numerator) ||
    !isPositiveIntegerString(receipt.dag.fps.denominator) ||
    !isStringArray(receipt.cacheLineage, 10_000) ||
    !isStringArray(receipt.warnings, 10_000) ||
    !isRecord(receipt.preflight) ||
    receipt.preflight.status !== "passed" ||
    !isHash(receipt.preflight.planIdentityHash) ||
    !isStringArray(receipt.preflight.findingCodes, 10_000) ||
    !isStringArray(receipt.preflight.ruleSetVersions, 1_024) ||
    !isRecord(receipt.reproduction) ||
    receipt.reproduction.status !== "recorded" ||
    !isStringArray(receipt.reproduction.commands, 1_024) ||
    receipt.initialLifecycleState !== "rendered_unchecked" ||
    receipt.approval !== null ||
    receipt.delivered !== false ||
    !isHash(receipt.identityHash)
  ) {
    throw new Error(`Persisted render receipt ${outputId} is invalid.`);
  }
  validateDeliveryProfile(receipt.deliveryProfile);
  validateRenderScope(receipt.renderScope);
  validateArtifactRecords(receipt.artifacts);
  validateAudioEvidence(receipt.audio, receipt.artifacts, receipt.deliveryProfile);
  const { identityHash, ...withoutIdentity } = receipt;
  if (identityHash !== hashCanonical(withoutIdentity)) {
    throw new Error(`Persisted render receipt ${outputId} has an invalid identity.`);
  }
  return receipt;
};

const validateLifecycleEvent = (value: unknown, outputId: string): RenderLifecycleEvent => {
  const event = requireRecord(value, "Persisted lifecycle event") as unknown as RenderLifecycleEvent;
  if (
    event.schemaVersion !== "1.0.0" ||
    !isStableId(event.id) ||
    event.outputId !== outputId ||
    (event.from !== null && !qaStateValues.includes(event.from)) ||
    !qaStateValues.includes(event.to) ||
    !isCommitActor(event.actor) ||
    !isStableId(event.sourceRevisionId) ||
    !isStableId(event.resultingRevisionId) ||
    !isHashArray(event.evidenceHashes, false) ||
    !isStringArray(event.exceptionIds, 256) ||
    !isTimestamp(event.createdAt) ||
    !isHash(event.eventHash)
  ) {
    throw new Error(`Persisted lifecycle event for ${outputId} is invalid.`);
  }
  const { eventHash, ...withoutHash } = event;
  if (eventHash !== hashCanonical(withoutHash)) {
    throw new Error(`Persisted lifecycle event ${event.id} has an invalid identity.`);
  }
  return event;
};

const validateLifecycleChain = (events: readonly RenderLifecycleEvent[], base: RenderReceiptBase): void => {
  if (events.length === 0 || events[0]?.to !== "rendered_unchecked") {
    throw new Error(`Persisted lifecycle chain for ${base.outputId} lacks activation evidence.`);
  }
  const allowed = new Set([
    "rendered_unchecked->qa_failed",
    "rendered_unchecked->qa_warning",
    "rendered_unchecked->qa_passed",
    "qa_warning->approved",
    "qa_passed->approved",
    "approved->delivered",
  ]);
  for (const [index, event] of events.entries()) {
    const prior = events[index - 1];
    if (prior === undefined) {
      if (event.sourceRevisionId !== base.sourceRevisionId) {
        throw new Error(`Persisted lifecycle chain for ${base.outputId} has invalid activation source.`);
      }
      continue;
    }
    const expectedFrom = prior.to;
    if (event.from !== expectedFrom || !allowed.has(`${event.from ?? "null"}->${event.to}`)) {
      throw new Error(`Persisted lifecycle chain for ${base.outputId} is discontinuous.`);
    }
  }
};

const bindQaReportsToLifecycle = (
  reports: readonly QaReceiptRecord[],
  lifecycle: readonly RenderLifecycleEvent[],
  outputId: string,
): readonly QaReceiptRecord[] => {
  const bound: QaReceiptRecord[] = [];
  for (const event of lifecycle.filter((candidate) => candidate.to.startsWith("qa_"))) {
    const matches = reports.filter(
      (report) =>
        report.state === event.to &&
        event.evidenceHashes.includes(report.reportHash) &&
        event.evidenceHashes.includes(report.authoritativeReport.identityHash),
    );
    if (matches.length !== 1) {
      throw new Error(`Persisted QA lifecycle event for ${outputId} lacks one authoritative report.`);
    }
    const report = matches[0];
    if (report === undefined) throw new Error(`Persisted QA report binding for ${outputId} failed.`);
    bound.push(report);
  }
  return bound;
};

const validateQaReceipt = (value: unknown, outputId: string): QaReceiptRecord => {
  const report = requireRecord(value, "Persisted QA receipt") as unknown as QaReceiptRecord;
  if (
    report.schemaVersion !== "1.0.0" ||
    !isStableId(report.id) ||
    report.outputId !== outputId ||
    !isStableId(report.sourceRevisionId) ||
    !isTimestamp(report.createdAt) ||
    !["qa_failed", "qa_warning", "qa_passed"].includes(report.state) ||
    !isRecord(report.audio) ||
    !["not-applicable", "passed", "warning", "failed"].includes(String(report.audio.status)) ||
    !isStringArray(report.audio.reasons, 1_024) ||
    !isHashArray(report.artifactEvidenceHashes, true) ||
    !isStringArray(report.exceptionIds, 256) ||
    !isHash(report.reportHash) ||
    !isRecord(report.authoritativeReport)
  ) {
    throw new Error(`Persisted QA receipt for ${outputId} is invalid.`);
  }
  const authoritative = report.authoritativeReport;
  if (
    authoritative.schemaVersion !== "1.0.0" ||
    authoritative.reportVersion !== "1.0.0" ||
    !isStableId(authoritative.id) ||
    !isStableId(authoritative.projectId) ||
    !isStableId(authoritative.revisionId) ||
    authoritative.outputId !== outputId ||
    authoritative.state !== report.state ||
    !isHash(authoritative.ruleSetIdentity) ||
    !isHash(authoritative.identityHash) ||
    !Array.isArray(authoritative.findings) ||
    authoritative.findings.length > 10_000 ||
    authoritative.findings.some((finding) => !isQaFinding(finding)) ||
    !Array.isArray(authoritative.rules) ||
    authoritative.rules.length > 1_024 ||
    authoritative.rules.some(
      (rule) => !isRecord(rule) || !isBoundedString(rule.id, 256) || !isBoundedString(rule.version, 128),
    ) ||
    !isStringArray(authoritative.blockingFindingIds, 1_024) ||
    !isStringArray(authoritative.reviewFindingIds, 1_024) ||
    !isStringArray(authoritative.exceptionIds, 1_024) ||
    !isTimestamp(authoritative.createdAt)
  ) {
    throw new Error(`Persisted authoritative QA report for ${outputId} is invalid.`);
  }
  const { identityHash, ...authoritativeWithoutHash } = authoritative;
  if (identityHash !== hashCanonical(authoritativeWithoutHash)) {
    throw new Error(`Persisted authoritative QA report for ${outputId} has an invalid identity.`);
  }
  const { reportHash, ...withoutHash } = report;
  if (reportHash !== hashCanonical(withoutHash)) {
    throw new Error(`Persisted QA receipt ${report.id} has an invalid identity.`);
  }
  const rebuilt = createQaReport({
    id: authoritative.id,
    projectId: authoritative.projectId,
    revisionId: authoritative.revisionId,
    outputId: authoritative.outputId,
    ruleSetIdentity: authoritative.ruleSetIdentity,
    rules: authoritative.rules,
    findings: authoritative.findings,
    createdAt: authoritative.createdAt,
  });
  if (rebuilt.identityHash !== authoritative.identityHash) {
    throw new Error(`Persisted authoritative QA report for ${outputId} is internally inconsistent.`);
  }
  return report;
};

const validateReviewChecklist = (value: unknown, outputId: string): ReviewChecklist => {
  const checklist = requireRecord(value, "Persisted review checklist") as unknown as ReviewChecklist;
  if (
    checklist.schemaVersion !== "1.0.0" ||
    !isStableId(checklist.id) ||
    checklist.outputId !== outputId ||
    !isStableId(checklist.revisionId) ||
    typeof checklist.complete !== "boolean" ||
    !Array.isArray(checklist.items) ||
    checklist.items.length > 1_024 ||
    !isHash(checklist.identityHash)
  ) {
    throw new Error(`Persisted review checklist for ${outputId} is invalid.`);
  }
  for (const item of checklist.items) {
    if (
      !isRecord(item) ||
      !isStableId(item.id) ||
      item.required !== true ||
      !["pending", "passed", "failed"].includes(String(item.status)) ||
      !isUnsignedIntegerString(item.frame) ||
      !isStringArray(item.entityIds, 256) ||
      typeof item.instruction !== "string" ||
      !isHashArray(item.evidenceHashes, true) ||
      (item.reviewerId !== null && typeof item.reviewerId !== "string") ||
      (item.reviewedAt !== null && !isTimestamp(item.reviewedAt))
    ) {
      throw new Error(`Persisted review checklist item for ${outputId} is invalid.`);
    }
    if (
      (item.status === "pending" &&
        (item.reviewerId !== null || item.reviewedAt !== null || item.evidenceHashes.length !== 0)) ||
      (item.status !== "pending" &&
        (!isBoundedString(item.reviewerId, 256) ||
          !isTimestamp(item.reviewedAt) ||
          item.evidenceHashes.length === 0))
    ) {
      throw new Error(`Persisted review checklist item for ${outputId} has invalid review evidence.`);
    }
  }
  if (
    checklist.complete !==
    checklist.items.every((item: ReviewChecklist["items"][number]) => item.status === "passed")
  ) {
    throw new Error(`Persisted review checklist for ${outputId} has an invalid completion state.`);
  }
  const { identityHash, ...withoutHash } = checklist;
  if (identityHash !== hashCanonical(withoutHash)) {
    throw new Error(`Persisted review checklist for ${outputId} has an invalid identity.`);
  }
  return checklist;
};

const validateDeliveryRecord = (value: unknown, base: RenderReceiptBase): RenderDeliveryRecord => {
  const delivery = requireRecord(value, "Persisted delivery record") as unknown as RenderDeliveryRecord;
  if (
    delivery.schemaVersion !== "1.0.0" ||
    delivery.outputId !== base.outputId ||
    delivery.sourceRevisionId !== base.sourceRevisionId ||
    delivery.deliveryProfileIdentity !== base.deliveryProfile.identityHash ||
    !isHashArray(delivery.evidenceHashes, false) ||
    !isHash(delivery.lifecycleEventHash) ||
    !isTimestamp(delivery.createdAt)
  ) {
    throw new Error(`Persisted delivery record for ${base.outputId} is invalid.`);
  }
  return delivery;
};

const validatePersistedJob = (value: unknown, expectedId: string): StudioJobSnapshot => {
  const job = requireRecord(value, "Persisted Studio job") as unknown as StudioJobSnapshot;
  if (
    job.id !== expectedId ||
    !isStableId(job.id) ||
    !jobKindValues.includes(job.kind) ||
    !jobStatusValues.includes(job.status) ||
    !Number.isFinite(job.progress) ||
    job.progress < 0 ||
    job.progress > 1 ||
    !Number.isSafeInteger(job.priority) ||
    job.priority < -100 ||
    job.priority > 100 ||
    !Number.isSafeInteger(job.queueOrder) ||
    job.queueOrder < 1 ||
    !isBoundedString(job.label, 256) ||
    !isBoundedString(job.stage, 256) ||
    (job.activeEngine !== null && !["remotion", "hyperframes", "shared"].includes(job.activeEngine)) ||
    !Number.isSafeInteger(job.cacheHits) ||
    job.cacheHits < 0 ||
    (job.estimateLabel !== null && !isBoundedString(job.estimateLabel, 256)) ||
    !isBoundedString(job.correlationId, 128) ||
    !isStableId(job.projectId) ||
    !isStableId(job.revisionId) ||
    !isTimestamp(job.createdAt) ||
    !isTimestamp(job.updatedAt) ||
    (job.error !== null && !isBoundedString(job.error, 4_096))
  ) {
    throw new Error(`Persisted Studio job ${expectedId} is invalid.`);
  }
  if (
    (job.status === "completed" && (job.progress !== 1 || job.error !== null || job.result === null)) ||
    (job.status === "failed" && job.error === null) ||
    (job.status === "cancelled" && job.error !== null) ||
    ((job.status === "queued" || job.status === "running") && job.result !== null) ||
    Date.parse(job.updatedAt) < Date.parse(job.createdAt)
  ) {
    throw new Error(`Persisted Studio job ${expectedId} has an inconsistent state.`);
  }
  return job;
};

const validateLifecycleTransaction = (value: unknown, outputId: string): LifecycleTransactionRecord => {
  const transaction = requireRecord(
    value,
    "Persisted lifecycle transaction",
  ) as unknown as LifecycleTransactionRecord;
  if (
    transaction.schemaVersion !== "1.0.0" ||
    !isStableId(transaction.id) ||
    transaction.outputId !== outputId ||
    !isStableId(transaction.sourceRevisionId) ||
    !isStableId(transaction.resultingRevisionId) ||
    !isHash(transaction.identityHash)
  ) {
    throw new Error(`Persisted lifecycle transaction for ${outputId} is invalid.`);
  }
  const event = validateLifecycleEvent(transaction.event, outputId);
  if (
    event.sourceRevisionId !== transaction.sourceRevisionId ||
    event.resultingRevisionId !== transaction.resultingRevisionId
  ) {
    throw new Error(`Persisted lifecycle transaction ${transaction.id} has mismatched event identity.`);
  }
  const { identityHash, ...withoutHash } = transaction;
  if (identityHash !== hashCanonical(withoutHash)) {
    throw new Error(`Persisted lifecycle transaction ${transaction.id} has an invalid identity.`);
  }
  return transaction;
};

const qaStateValues: readonly QaState[] = [
  "rendered_unchecked",
  "qa_failed",
  "qa_warning",
  "qa_passed",
  "approved",
  "delivered",
];

const jobKindValues: readonly StudioJobSnapshot["kind"][] = [
  "asset.inspect",
  "asset.proxy",
  "asset.thumbnail",
  "asset.waveform",
  "render.execute",
  "render.qa",
];

const jobStatusValues: readonly StudioJobSnapshot["status"][] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];

const validateArtifactRecords = (artifacts: readonly RenderArtifactRecord[]): void => {
  if (
    artifacts.length === 0 ||
    artifacts.length > 32 ||
    artifacts.filter((artifact) => artifact.primary).length !== 1
  ) {
    throw new Error("Persisted render artifacts are invalid.");
  }
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    if (
      !isRecord(artifact) ||
      typeof artifact.relativePath !== "string" ||
      artifact.relativePath.length === 0 ||
      artifact.relativePath.length > 1_024 ||
      path.isAbsolute(artifact.relativePath) ||
      artifact.relativePath.split("/").includes("..") ||
      !Number.isSafeInteger(artifact.byteLength) ||
      artifact.byteLength < 0 ||
      !isHash(artifact.contentHash) ||
      typeof artifact.primary !== "boolean" ||
      paths.has(artifact.relativePath)
    ) {
      throw new Error("Persisted render artifact record is invalid.");
    }
    paths.add(artifact.relativePath);
  }
};

const deliveryRecordFor = (
  outputId: string,
  sourceRevisionId: string,
  deliveryProfileIdentity: string,
  event: RenderLifecycleEvent,
): RenderDeliveryRecord => ({
  schemaVersion: "1.0.0",
  outputId,
  sourceRevisionId,
  deliveryProfileIdentity,
  evidenceHashes: event.evidenceHashes,
  lifecycleEventHash: event.eventHash,
  createdAt: event.createdAt,
});

const sameArtifacts = (
  left: readonly RenderArtifactRecord[],
  right: readonly RenderArtifactRecord[],
): boolean => hashCanonical(left) === hashCanonical(right);

const revisionIsReachable = async (
  rootPath: string,
  currentRevisionId: string,
  targetRevisionId: string,
): Promise<boolean> => {
  let revisionId: string | null = currentRevisionId;
  const visited = new Set<string>();
  while (revisionId !== null && visited.size < 10_000) {
    if (revisionId === targetRevisionId) return true;
    if (visited.has(revisionId)) throw new Error("Project revision ancestry contains a cycle.");
    visited.add(revisionId);
    const revision = await loadProjectRevision(rootPath, revisionId);
    revisionId = revision.transaction.parentRevisionId;
  }
  if (visited.size >= 10_000) throw new Error("Project revision ancestry exceeds recovery bounds.");
  return false;
};

const readPersistedJson = async (target: string): Promise<unknown> => {
  const source = await readFile(target, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch (cause) {
    throw new Error(`Persisted JSON ${path.basename(target)} is malformed.`, { cause });
  }
};

const requireRecord = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isStableId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value);

const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isBoundedString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;

const isUnsignedIntegerString = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);

const isPositiveIntegerString = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]*$/.test(value);

const isStringArray = (value: unknown, maximum: number): value is readonly string[] =>
  Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === "string");

const isHashArray = (value: unknown, allowEmpty: boolean): value is readonly string[] =>
  Array.isArray(value) && value.length <= 256 && (allowEmpty || value.length > 0) && value.every(isHash);

const isCommitActor = (value: unknown): value is CommitActor =>
  isRecord(value) &&
  isStableId(value.id) &&
  ["user", "codex", "system"].includes(String(value.kind)) &&
  isStableId(value.sessionId);

const isQaFinding = (value: unknown): value is QaFinding => {
  if (!isRecord(value) || !isRecord(value.location) || !Array.isArray(value.metrics)) return false;
  const location = value.location;
  return (
    value.schemaVersion === "1.0.0" &&
    isStableId(value.id) &&
    isBoundedString(value.ruleId, 256) &&
    isBoundedString(value.ruleVersion, 128) &&
    [
      "schema",
      "media",
      "timeline",
      "capability",
      "font",
      "composition",
      "proxy",
      "alpha",
      "audio",
      "rights",
      "trust",
      "disk",
      "output",
      "environment",
      "visual",
      "caption",
      "sync",
      "lifecycle",
    ].includes(String(value.category)) &&
    ["pre-render", "post-render", "human-review", "lifecycle"].includes(String(value.stage)) &&
    ["info", "warning", "error"].includes(String(value.severity)) &&
    typeof value.blocking === "boolean" &&
    ["passed", "failed", "warning", "not-applicable", "requires-review"].includes(String(value.status)) &&
    isBoundedString(value.title, 1_024) &&
    typeof value.detail === "string" &&
    value.detail.length <= 16_384 &&
    (value.repairHint === null || typeof value.repairHint === "string") &&
    isStringArray(location.entityIds, 1_024) &&
    (location.artifactPath === null || typeof location.artifactPath === "string") &&
    (location.frame === null || isUnsignedIntegerString(location.frame)) &&
    isHashArray(value.evidenceHashes, true) &&
    value.metrics.length <= 1_024 &&
    (value.environmentFingerprint === null || isHash(value.environmentFingerprint)) &&
    (value.exceptionId === null || isStableId(value.exceptionId))
  );
};
/* eslint-enable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-type-conversion, @typescript-eslint/no-unnecessary-boolean-literal-compare */

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
    security.environmentIdentity !== plan.environment.strictEnvironmentFingerprint ||
    JSON.stringify([...security.trustClasses].sort()) !== JSON.stringify(planTrust) ||
    security.workerPoolIds.length === 0 ||
    security.cacheNamespaces.length === 0 ||
    security.violations.length > 0 ||
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
