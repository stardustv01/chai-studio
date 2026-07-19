import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge, Button, ProgressBar, TextField } from "@chai-studio/ui-components";
import { StudioApiClient, StudioApiError } from "./api-client.js";
import { ChaiIcon } from "./chai-icon.js";
import type { StudioSnapshot } from "./types.js";
import {
  contractDefaultProfile,
  contractOutputs,
  contractPreflight,
  contractProfiles,
  contractQaWorkspace,
  contractQueue,
  contractReceipt,
} from "./delivery-seed.js";

export type JsonRecord = Readonly<Record<string, unknown>>;

export interface DeliveryProfileView extends JsonRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly purpose: "preview" | "final";
  readonly outputKind: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: Readonly<{ numerator: string; denominator: string }> | null;
  readonly container: string;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly audioSampleRate: number | null;
  readonly colorSpace: string;
  readonly alpha: string;
  readonly sourcePolicy: string;
  readonly strictEnvironment: boolean;
  readonly identityHash: string;
}

export interface QueueView extends JsonRecord {
  readonly request: Readonly<{
    id: string;
    jobId: string;
    revisionId: string;
    name: string;
    priority: number;
    attempt: number;
    profile: DeliveryProfileView;
    scope: JsonRecord;
  }>;
  readonly job: JsonRecord | null;
  readonly persistedStatus: string;
  readonly stage: string;
  readonly activeEngine: string | null;
  readonly progress: number;
  readonly cacheHits: number;
  readonly estimateLabel: string | null;
  readonly qaState: string;
  readonly controls: Readonly<Record<string, boolean>>;
  readonly pauseUnavailableReason: string;
}

export interface OutputView extends JsonRecord {
  readonly id: string;
  readonly sourceRevisionId: string;
  readonly lifecycleState: string;
  readonly createdAt: string;
  readonly receiptIdentityHash: string;
  readonly profile: DeliveryProfileView;
  readonly artifacts: readonly Readonly<{
    relativePath: string;
    byteLength: number;
    contentHash: string;
    primary: boolean;
  }>[];
}

interface ArtifactViewerState {
  readonly outputId: string;
  readonly artifactPath: string;
  readonly objectUrl: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly expectedWidth: number | null;
  readonly expectedHeight: number | null;
  readonly measuredWidth: number | null;
  readonly measuredHeight: number | null;
}

interface ArtifactComparisonState {
  readonly current: ArtifactViewerState;
  readonly reference: ArtifactViewerState;
}

export interface PreflightView extends JsonRecord {
  readonly executable: boolean;
  readonly identityHash: string;
  readonly findings: readonly Readonly<{
    code: string;
    severity: "info" | "warning" | "error";
    blocking: boolean;
    title: string;
    detail: string;
    repair: string | null;
  }>[];
  readonly qaReport?: Readonly<{
    ruleSetIdentity: string;
    state: "qa_failed" | "qa_warning" | "qa_passed";
    findings: readonly QaFindingView[];
  }>;
}

export interface QaFindingView {
  readonly id: string;
  readonly ruleId: string;
  readonly category: string;
  readonly severity: "info" | "warning" | "error";
  readonly status: "passed" | "failed" | "warning" | "not-applicable" | "requires-review";
  readonly title: string;
  readonly detail: string;
  readonly repairHint: string | null;
  readonly location: Readonly<{
    frame: string | null;
    frameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
    entityIds: readonly string[];
  }>;
  readonly metrics: readonly Readonly<{
    name: string;
    value: number | string | boolean | null;
    unit: string | null;
    threshold: number | string | boolean | readonly [number, number] | null;
  }>[];
}

export interface ReviewChecklistView {
  readonly id: string;
  readonly outputId: string;
  readonly complete: boolean;
  readonly identityHash: string;
  readonly items: readonly Readonly<{
    id: string;
    category: string;
    frame: string;
    instruction: string;
    status: "pending" | "passed" | "failed";
    evidenceHashes: readonly string[];
  }>[];
}

export interface QaWorkspaceView extends JsonRecord {
  readonly outputId: string;
  readonly ruleSetIdentity: string;
  readonly rules: readonly JsonRecord[];
  readonly latest: Readonly<{
    reportHash: string;
    authoritativeReport: Readonly<{
      state: "qa_failed" | "qa_warning" | "qa_passed";
      findings: readonly QaFindingView[];
    }>;
  }> | null;
  readonly checklist: ReviewChecklistView | null;
}

interface DeliveryContextValue {
  readonly source: "server" | "ui-fixture";
  readonly loading: boolean;
  readonly busy: boolean;
  readonly profiles: readonly DeliveryProfileView[];
  readonly selectedProfile: DeliveryProfileView;
  readonly queue: readonly QueueView[];
  readonly selectedJob: QueueView | null;
  readonly outputs: readonly OutputView[];
  readonly selectedOutput: OutputView | null;
  readonly preflight: PreflightView | null;
  readonly receipt: JsonRecord | null;
  readonly qaWorkspace: QaWorkspaceView | null;
  readonly diagnostic: string | null;
  readonly selectProfile: (id: string) => void;
  readonly selectJob: (id: string) => void;
  readonly selectOutput: (id: string) => void;
  readonly loadArtifact: (
    outputId: string,
    index: number,
    signal?: AbortSignal,
  ) => ReturnType<StudioApiClient["renderArtifact"]>;
  readonly refresh: () => Promise<void>;
  readonly check: (scope: JsonRecord) => Promise<void>;
  readonly enqueue: (scope: JsonRecord) => Promise<void>;
  readonly control: (action: "cancel" | "retry" | "duplicate" | "reprioritize" | "clear") => Promise<void>;
  readonly saveCustom: (input: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly videoCodec: string;
  }) => Promise<void>;
  readonly runQa: () => Promise<void>;
  readonly recordChecklist: (itemId: string, status: "passed" | "failed") => Promise<void>;
  readonly approve: () => Promise<void>;
  readonly deliver: () => Promise<void>;
}

const DeliveryContext = createContext<DeliveryContextValue | null>(null);

export const DeliveryWorkspaceProvider = ({
  children,
  snapshot,
}: {
  readonly children: ReactNode;
  readonly snapshot: StudioSnapshot;
}) => {
  const client = useMemo(
    () =>
      new StudioApiClient({
        sessionToken: window.__CHAI_STUDIO_SESSION__?.token ?? null,
        baseUrl: window.__CHAI_STUDIO_SESSION__?.serverOrigin ?? "",
      }),
    [],
  );
  const source = client.sessionToken === null ? "ui-fixture" : "server";
  const [profiles, setProfiles] = useState<readonly DeliveryProfileView[]>(
    source === "server" ? [] : contractProfiles,
  );
  const [selectedProfileId, setSelectedProfileId] = useState(
    source === "server" ? "" : contractDefaultProfile.id,
  );
  const [queue, setQueue] = useState<readonly QueueView[]>(source === "server" ? [] : contractQueue);
  const [outputs, setOutputs] = useState<readonly OutputView[]>(source === "server" ? [] : contractOutputs);
  const [selectedJobId, setSelectedJobId] = useState(
    source === "server" ? "" : (contractQueue[0]?.request.jobId ?? ""),
  );
  const [selectedOutputId, setSelectedOutputId] = useState(
    source === "server" ? "" : (contractOutputs[0]?.id ?? ""),
  );
  const [preflight, setPreflight] = useState<PreflightView | null>(
    source === "server" ? null : contractPreflight,
  );
  const [receipt, setReceipt] = useState<JsonRecord | null>(source === "server" ? null : contractReceipt);
  const [qaWorkspace, setQaWorkspace] = useState<QaWorkspaceView | null>(
    source === "server" ? null : contractQaWorkspace,
  );
  const knownOutputIds = useRef<ReadonlySet<string> | null>(null);
  const [evidenceEpoch, setEvidenceEpoch] = useState(0);
  const [loading, setLoading] = useState(source === "server");
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (client.sessionToken === null) return;
    try {
      const [nextProfiles, nextQueue, nextOutputs] = await Promise.all([
        client.request<readonly DeliveryProfileView[]>("/api/v1/renders/profiles", { method: "GET" }),
        client.request<readonly QueueView[]>("/api/v1/renders/queue", { method: "GET" }),
        client.request<readonly OutputView[]>("/api/v1/renders/outputs", { method: "GET" }),
      ]);
      setProfiles(nextProfiles);
      setQueue(nextQueue);
      const orderedOutputs = [...nextOutputs].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt, "en"),
      );
      const previousOutputIds = knownOutputIds.current;
      knownOutputIds.current = new Set(orderedOutputs.map((output) => output.id));
      const newlyCompletedOutput =
        previousOutputIds === null
          ? null
          : orderedOutputs.find((output) => !previousOutputIds.has(output.id));
      setOutputs(orderedOutputs);
      setSelectedProfileId((current) =>
        nextProfiles.some((profile) => profile.id === current) ? current : (nextProfiles[0]?.id ?? ""),
      );
      setSelectedJobId((current) =>
        nextQueue.some((item) => item.request.jobId === current)
          ? current
          : (nextQueue[0]?.request.jobId ?? ""),
      );
      setSelectedOutputId((current) =>
        newlyCompletedOutput !== null && newlyCompletedOutput !== undefined
          ? newlyCompletedOutput.id
          : orderedOutputs.some((output) => output.id === current)
            ? current
            : (orderedOutputs[0]?.id ?? ""),
      );
      setDiagnostic(null);
    } catch (cause) {
      setDiagnostic(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    if (source !== "server") return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, source]);

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? contractDefaultProfile;
  const selectedJob = queue.find((item) => item.request.jobId === selectedJobId) ?? queue[0] ?? null;
  const selectedOutput = outputs.find((output) => output.id === selectedOutputId) ?? outputs[0] ?? null;
  const selectedOutputIdentity = selectedOutput?.id ?? null;
  const selectedOutputLifecycle = selectedOutput?.lifecycleState ?? null;

  useEffect(() => {
    if (client.sessionToken === null || selectedOutputIdentity === null) return;
    const controller = new AbortController();
    setReceipt(null);
    setQaWorkspace(null);
    void Promise.all([
      client.request<JsonRecord>(`/api/v1/renders/outputs/${selectedOutputIdentity}/receipt`, {
        method: "GET",
        signal: controller.signal,
      }),
      client.request<QaWorkspaceView>(`/api/v1/renders/outputs/${selectedOutputIdentity}/qa`, {
        method: "GET",
        signal: controller.signal,
      }),
    ])
      .then(([nextReceipt, nextQa]) => {
        if (controller.signal.aborted || nextQa.outputId !== selectedOutputIdentity) return;
        setReceipt(nextReceipt);
        setQaWorkspace(nextQa);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setDiagnostic(messageFor(cause));
      });
    return () => {
      controller.abort();
    };
  }, [client, evidenceEpoch, selectedOutputIdentity, selectedOutputLifecycle]);

  const selectOutput = useCallback((id: string): void => {
    setSelectedOutputId(id);
    setReceipt(null);
    setQaWorkspace(null);
  }, []);

  const loadArtifact = useCallback(
    (outputId: string, index: number, signal?: AbortSignal) => client.renderArtifact(outputId, index, signal),
    [client],
  );

  const perform = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      if (client.sessionToken === null) {
        setDiagnostic(
          "UI fixture is read-only. Launch the authenticated macOS app to create or control renders.",
        );
        return;
      }
      setBusy(true);
      try {
        await work();
        setDiagnostic(null);
        await refresh();
        setEvidenceEpoch((value) => value + 1);
      } catch (cause) {
        setDiagnostic(messageFor(cause));
      } finally {
        setBusy(false);
      }
    },
    [client, refresh],
  );

  const check = useCallback(
    (scope: JsonRecord) =>
      perform(async () => {
        if (snapshot.project === null) throw new Error("Open a project before render preflight.");
        const revisionId = await authoritativeRevisionId(client, snapshot.project.revisionId);
        const result = await client.request<PreflightView>("/api/v1/renders/preflight", {
          method: "POST",
          body: JSON.stringify({
            profile: selectedProfile,
            scope,
            expectedRevisionId: revisionId,
          }),
        });
        setPreflight(result);
      }),
    [client, perform, selectedProfile, snapshot.project],
  );

  const enqueue = useCallback(
    (scope: JsonRecord) =>
      perform(async () => {
        if (snapshot.project === null) throw new Error("Open a project before rendering.");
        const revisionId = await authoritativeRevisionId(client, snapshot.project.revisionId);
        const checked = await client.request<PreflightView>("/api/v1/renders/preflight", {
          method: "POST",
          body: JSON.stringify({
            profile: selectedProfile,
            scope,
            expectedRevisionId: revisionId,
          }),
        });
        setPreflight(checked);
        if (!checked.executable)
          throw new Error("Preflight found a blocking issue. Repair it before rendering.");
        await client.request("/api/v1/renders", {
          method: "POST",
          body: JSON.stringify({
            profile: selectedProfile,
            scope,
            name: `${snapshot.project.title} · ${selectedProfile.name}`,
            priority: 0,
            actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
            expectedRevisionId: revisionId,
          }),
        });
      }),
    [client, perform, selectedProfile, snapshot.project],
  );

  const control = useCallback(
    (action: "cancel" | "retry" | "duplicate" | "reprioritize" | "clear") =>
      perform(async () => {
        if (action === "clear") {
          await client.request("/api/v1/renders/queue/clear-completed", { method: "POST", body: "{}" });
          return;
        }
        if (selectedJob === null) throw new Error("Select a render job first.");
        const endpoint = action === "retry" ? "retry" : action;
        await client.request(`/api/v1/renders/jobs/${selectedJob.request.jobId}/${endpoint}`, {
          method: "POST",
          body: JSON.stringify(
            action === "reprioritize" ? { priority: selectedJob.request.priority + 1 } : {},
          ),
        });
      }),
    [client, perform, selectedJob],
  );

  const saveCustom = useCallback(
    (input: {
      readonly name: string;
      readonly width: number;
      readonly height: number;
      readonly videoCodec: string;
    }) =>
      perform(async () => {
        const nonce = globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12);
        const {
          schemaVersion: _schemaVersion,
          identityHash: _identityHash,
          ...selectedSeed
        } = selectedProfile;
        void _schemaVersion;
        void _identityHash;
        const created = await client.request<DeliveryProfileView>("/api/v1/renders/profiles", {
          method: "POST",
          body: JSON.stringify({
            profile: {
              ...selectedSeed,
              id: `profile-custom-${nonce}`,
              name: input.name,
              kind: "custom",
              width: input.width,
              height: input.height,
              videoCodec: input.videoCodec,
              outputPathTemplate: `deliveries/{project}-{revision}-custom-${nonce}.${selectedProfile.container}`,
            },
          }),
        });
        setSelectedProfileId(created.id);
      }),
    [client, perform, selectedProfile],
  );

  const runQa = useCallback(
    () =>
      perform(async () => {
        if (selectedOutput === null || snapshot.project === null)
          throw new Error("Select an output before QA.");
        const revisionId = await authoritativeRevisionId(client, snapshot.project.revisionId);
        await client.request(`/api/v1/renders/outputs/${selectedOutput.id}/qa`, {
          method: "POST",
          body: JSON.stringify({
            actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
            expectedRevisionId: revisionId,
          }),
        });
      }),
    [client, perform, selectedOutput, snapshot.project],
  );

  const recordChecklist = useCallback(
    (itemId: string, status: "passed" | "failed") =>
      perform(async () => {
        if (selectedOutput === null) throw new Error("Select an output before visual review.");
        const evidenceHash = selectedOutput.artifacts[0]?.contentHash;
        if (evidenceHash === undefined)
          throw new Error("Selected output has no immutable artifact evidence.");
        await client.request(`/api/v1/renders/outputs/${selectedOutput.id}/qa/checklist/${itemId}`, {
          method: "POST",
          body: JSON.stringify({
            status,
            reviewerId: "actor-studio-user",
            evidenceHashes: [evidenceHash],
          }),
        });
      }),
    [client, perform, selectedOutput],
  );

  const approve = useCallback(
    () =>
      perform(async () => {
        if (selectedOutput === null || snapshot.project === null)
          throw new Error("Select an output before approval.");
        const revisionId = await authoritativeRevisionId(client, snapshot.project.revisionId);
        await client.request(`/api/v1/renders/outputs/${selectedOutput.id}/approve`, {
          method: "POST",
          body: JSON.stringify({
            actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
            expectedRevisionId: revisionId,
            evidenceHashes: [selectedOutput.receiptIdentityHash],
            exceptionIds: [],
          }),
        });
      }),
    [client, perform, selectedOutput, snapshot.project],
  );

  const deliver = useCallback(
    () =>
      perform(async () => {
        if (selectedOutput === null || snapshot.project === null)
          throw new Error("Select an approved output first.");
        const revisionId = await authoritativeRevisionId(client, snapshot.project.revisionId);
        await client.request(`/api/v1/renders/outputs/${selectedOutput.id}/deliver`, {
          method: "POST",
          body: JSON.stringify({
            actor: { id: "actor-studio-user", kind: "user", sessionId: "session-studio-desktop" },
            expectedRevisionId: revisionId,
            evidenceHashes: [selectedOutput.receiptIdentityHash],
          }),
        });
      }),
    [client, perform, selectedOutput, snapshot.project],
  );

  const value: DeliveryContextValue = {
    source,
    loading,
    busy,
    profiles,
    selectedProfile,
    queue,
    selectedJob,
    outputs,
    selectedOutput,
    preflight,
    receipt,
    qaWorkspace,
    diagnostic,
    selectProfile: setSelectedProfileId,
    selectJob: setSelectedJobId,
    selectOutput,
    loadArtifact,
    refresh,
    check,
    enqueue,
    control,
    saveCustom,
    runQa,
    recordChecklist,
    approve,
    deliver,
  };
  return <DeliveryContext.Provider value={value}>{children}</DeliveryContext.Provider>;
};

const useDelivery = (): DeliveryContextValue => {
  const value = useContext(DeliveryContext);
  if (value === null) throw new Error("Delivery workspace provider is missing.");
  return value;
};

export const DeliveryProfilesPanel = () => {
  const delivery = useDelivery();
  const [query, setQuery] = useState("");
  const [customName, setCustomName] = useState("Custom delivery");
  const [customWidth, setCustomWidth] = useState("1920");
  const [customHeight, setCustomHeight] = useState("1080");
  const [customCodec, setCustomCodec] = useState("h264");
  const visible = delivery.profiles.filter((profile) =>
    `${profile.name} ${profile.kind}`.toLocaleLowerCase("en").includes(query.toLocaleLowerCase("en")),
  );
  const customWidthValue = Number(customWidth);
  const customHeightValue = Number(customHeight);
  const customProfileErrors = [
    ...(customName.trim().length === 0 ? ["Profile name is required."] : []),
    ...(customName.trim().length > 120 ? ["Profile name must be 120 characters or fewer."] : []),
    ...(!Number.isSafeInteger(customWidthValue) || customWidthValue <= 0 || customWidthValue > 16_384
      ? ["Width must be a positive whole number no greater than 16384."]
      : []),
    ...(!Number.isSafeInteger(customHeightValue) || customHeightValue <= 0 || customHeightValue > 16_384
      ? ["Height must be a positive whole number no greater than 16384."]
      : []),
    ...(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(customCodec.trim())
      ? ["Video codec must be a non-empty codec identifier."]
      : []),
  ];
  return (
    <div className="panel-content delivery-profiles" aria-label="Delivery profiles">
      <div className="panel-titlebar">
        <strong>Delivery profiles</strong>
        <Badge tone={delivery.source === "server" ? "ready" : "neutral"}>
          {delivery.source === "server" ? "Project" : "Sample"}
        </Badge>
      </div>
      <TextField
        label="Find profile"
        placeholder="Search profiles"
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
      />
      <div className="delivery-profile-list">
        {visible.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className={profile.id === delivery.selectedProfile.id ? "active" : ""}
            onClick={() => {
              delivery.selectProfile(profile.id);
            }}
          >
            <span>
              <strong>{profile.name}</strong>
              <small>
                {profile.outputKind} · {profile.purpose}
              </small>
            </span>
            <b>{dimensions(profile)}</b>
          </button>
        ))}
      </div>
      <div className="panel-callout">
        <span>Selected profile</span>
        <strong>
          {dimensions(delivery.selectedProfile)} · {fps(delivery.selectedProfile)}
        </strong>
        <small>
          {delivery.selectedProfile.videoCodec ?? "No video"} ·{" "}
          {delivery.selectedProfile.audioCodec ?? "No audio"} ·{" "}
          {delivery.selectedProfile.sourcePolicy.replaceAll("-", " ")}
        </small>
      </div>
      <details className="custom-profile-editor">
        <summary>Create custom profile</summary>
        <TextField
          label="Profile name"
          value={customName}
          onChange={(event) => {
            setCustomName(event.currentTarget.value);
          }}
        />
        <div className="custom-profile-grid">
          <TextField
            label="Width"
            inputMode="numeric"
            value={customWidth}
            onChange={(event) => {
              setCustomWidth(event.currentTarget.value);
            }}
          />
          <TextField
            label="Height"
            inputMode="numeric"
            value={customHeight}
            onChange={(event) => {
              setCustomHeight(event.currentTarget.value);
            }}
          />
        </div>
        <TextField
          label="Video codec"
          value={customCodec}
          onChange={(event) => {
            setCustomCodec(event.currentTarget.value);
          }}
        />
        {customProfileErrors.length === 0 ? null : (
          <div className="custom-profile-validation" role="alert">
            {customProfileErrors.map((error) => (
              <span key={error}>{error}</span>
            ))}
          </div>
        )}
        <Button
          disabled={delivery.busy || customProfileErrors.length > 0}
          onClick={() =>
            void delivery.saveCustom({
              name: customName.trim(),
              width: customWidthValue,
              height: customHeightValue,
              videoCodec: customCodec.trim(),
            })
          }
        >
          Save project profile
        </Button>
      </details>
    </div>
  );
};

export const DeliveryQueueCenter = ({ snapshot }: { readonly snapshot: StudioSnapshot }) => {
  const delivery = useDelivery();
  const selectedRange = rangeScope(snapshot);
  const [viewer, setViewer] = useState<ArtifactViewerState | null>(null);
  const [comparison, setComparison] = useState<ArtifactComparisonState | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [openingOutputId, setOpeningOutputId] = useState<string | null>(null);
  const viewerDialogRef = useRef<HTMLDialogElement>(null);
  const comparisonDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = viewerDialogRef.current;
    if (viewer === null || dialog === null) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [viewer]);

  useEffect(
    () => () => {
      if (viewer !== null) URL.revokeObjectURL(viewer.objectUrl);
    },
    [viewer],
  );

  useEffect(() => {
    const dialog = comparisonDialogRef.current;
    if (comparison === null || dialog === null) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [comparison]);

  useEffect(
    () => () => {
      if (comparison === null) return;
      URL.revokeObjectURL(comparison.current.objectUrl);
      URL.revokeObjectURL(comparison.reference.objectUrl);
    },
    [comparison],
  );

  const loadVerifiedArtifact = useCallback(
    async (output: OutputView): Promise<ArtifactViewerState> => {
      const index = output.artifacts.findIndex((artifact) => artifact.primary);
      const artifact = output.artifacts[index];
      if (index < 0 || artifact === undefined) throw new Error("This output has no primary artifact.");
      const payload = await delivery.loadArtifact(output.id, index);
      const observedHash = await sha256Blob(payload.blob);
      if (payload.contentHash !== artifact.contentHash || observedHash !== artifact.contentHash) {
        throw new Error("The viewed bytes do not match this output's immutable SHA-256 receipt.");
      }
      return {
        outputId: output.id,
        artifactPath: artifact.relativePath,
        objectUrl: URL.createObjectURL(payload.blob),
        contentHash: observedHash,
        byteLength: payload.blob.size,
        expectedWidth: output.profile.width,
        expectedHeight: output.profile.height,
        measuredWidth: null,
        measuredHeight: null,
      };
    },
    [delivery],
  );

  const openArtifact = useCallback(
    async (output: OutputView): Promise<void> => {
      setOpeningOutputId(output.id);
      setViewerError(null);
      try {
        setViewer(await loadVerifiedArtifact(output));
      } catch (cause) {
        setViewerError(messageFor(cause));
      } finally {
        setOpeningOutputId(null);
      }
    },
    [loadVerifiedArtifact],
  );

  const comparisonReference = useCallback(
    (output: OutputView): OutputView | null =>
      delivery.outputs.find(
        (candidate) =>
          candidate.id !== output.id &&
          candidate.profile.outputKind === "still" &&
          (candidate.profile.container === "png" || candidate.profile.container === "jpeg") &&
          candidate.profile.width === output.profile.width &&
          candidate.profile.height === output.profile.height,
      ) ?? null,
    [delivery.outputs],
  );

  const openComparison = useCallback(
    async (output: OutputView): Promise<void> => {
      const reference = comparisonReference(output);
      if (reference === null) {
        setViewerError("A compatible second immutable still output is required for comparison.");
        return;
      }
      setOpeningOutputId(output.id);
      setViewerError(null);
      let current: ArtifactViewerState | null = null;
      try {
        current = await loadVerifiedArtifact(output);
        const referenceArtifact = await loadVerifiedArtifact(reference);
        setComparison({ current, reference: referenceArtifact });
      } catch (cause) {
        if (current !== null) URL.revokeObjectURL(current.objectUrl);
        setViewerError(messageFor(cause));
      } finally {
        setOpeningOutputId(null);
      }
    },
    [comparisonReference, loadVerifiedArtifact],
  );

  const closeViewer = useCallback(() => {
    setViewer(null);
  }, []);
  const closeComparison = useCallback(() => {
    setComparison(null);
  }, []);
  return (
    <div className="delivery-center" aria-label="Authoritative render queue">
      <div className="delivery-header">
        <div>
          <strong>Render queue</strong>
          <Badge tone="working">
            {delivery.queue.filter((item) => item.persistedStatus === "running").length} active
          </Badge>
          <Badge>{delivery.queue.filter((item) => item.persistedStatus === "queued").length} queued</Badge>
        </div>
        <div>
          <Button disabled={delivery.busy} onClick={() => void delivery.enqueue(selectedRange)}>
            <ChaiIcon name="render-range" size={16} /> Render range
          </Button>
          <Button
            disabled={delivery.busy}
            onClick={() => void delivery.enqueue({ kind: "frame", frame: snapshot.preview.masterFrame })}
          >
            <ChaiIcon name="render-frame" size={16} /> Render frame
          </Button>
          <Button
            variant="primary"
            disabled={delivery.busy}
            onClick={() => void delivery.enqueue({ kind: "full-timeline" })}
          >
            <ChaiIcon name="render-timeline" size={16} /> Render timeline
          </Button>
          <Button
            disabled={delivery.busy}
            onClick={() =>
              void delivery.enqueue({
                kind: "named-version",
                versionName: `Revision ${String(snapshot.project?.revisionNumber ?? 0)}`,
                startFrame: "0",
                endFrameExclusive: snapshot.preview.durationFrames,
              })
            }
          >
            <ChaiIcon name="named-version" size={16} /> Named version
          </Button>
        </div>
      </div>
      {delivery.source === "ui-fixture" ? (
        <div className="delivery-authority-note">
          Sample projection · controls are read-only until the authenticated macOS app is running.
        </div>
      ) : null}
      {delivery.diagnostic !== null ? (
        <div className="delivery-diagnostic" role="alert">
          <strong>Render action needs attention</strong>
          <span>{delivery.diagnostic}</span>
          <small>
            {delivery.selectedJob === null
              ? "No render job is selected."
              : `${delivery.selectedJob.request.jobId} · ${delivery.selectedJob.stage} · ${delivery.selectedJob.activeEngine ?? "no active worker"}`}
          </small>
        </div>
      ) : null}
      {viewerError === null ? null : (
        <div className="delivery-diagnostic" role="alert">
          <strong>Artifact viewer needs attention</strong>
          <span>{viewerError}</span>
        </div>
      )}
      <div className="queue-table">
        <div className="queue-head">
          <span>Job / revision</span>
          <span>Profile</span>
          <span>Stage / engine</span>
          <span>Status / QA</span>
        </div>
        {delivery.queue.length === 0 ? (
          <div className="queue-empty">
            No render jobs yet. Preflight a profile, then render a timeline or exact range.
          </div>
        ) : (
          delivery.queue.map((item) => (
            <button
              key={item.request.jobId}
              type="button"
              className={
                item.request.jobId === delivery.selectedJob?.request.jobId
                  ? "queue-row queue-row--active"
                  : "queue-row"
              }
              onClick={() => {
                delivery.selectJob(item.request.jobId);
              }}
            >
              <span>
                <i />
                <strong>{item.request.name}</strong>
                <small>
                  {item.request.revisionId} · attempt {item.request.attempt}
                </small>
              </span>
              <span>
                {item.request.profile.name}
                <small>{scopeLabel(item.request.scope)}</small>
              </span>
              <span>
                {item.stage}
                <small>
                  {item.activeEngine ?? "No active engine"} · {item.cacheHits} cache hits
                </small>
              </span>
              <strong>
                {statusLabel(item)}
                <small>QA {item.qaState.replaceAll("_", " ")}</small>
              </strong>
            </button>
          ))
        )}
      </div>
      {delivery.selectedJob !== null ? (
        <ActiveRenderCard item={delivery.selectedJob} control={delivery.control} busy={delivery.busy} />
      ) : null}
      <div className="recent-output">
        <div className="recent-output__title">
          <h3>Outputs</h3>
          <Button variant="ghost" onClick={() => void delivery.control("clear")}>
            Clear completed jobs
          </Button>
        </div>
        <div className="output-grid">
          {delivery.outputs.length === 0 ? (
            <div className="queue-empty">No validated artifacts have been published.</div>
          ) : (
            delivery.outputs.map((output) => (
              <div
                key={output.id}
                className={output.id === delivery.selectedOutput?.id ? "output-card active" : "output-card"}
              >
                <button
                  type="button"
                  className="output-card__select"
                  aria-label={`Select output ${output.id}`}
                  aria-pressed={output.id === delivery.selectedOutput?.id}
                  onClick={() => {
                    delivery.selectOutput(output.id);
                  }}
                >
                  <span>
                    <strong>
                      {output.artifacts.find((artifact) => artifact.primary)?.relativePath ?? output.id}
                    </strong>
                    <small>
                      {dimensions(output.profile)} ·{" "}
                      {formatBytes(output.artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0))}
                    </small>
                  </span>
                  <Badge
                    tone={
                      output.lifecycleState === "approved" || output.lifecycleState === "delivered"
                        ? "ready"
                        : "attention"
                    }
                  >
                    {output.lifecycleState.replaceAll("_", " ")}
                  </Badge>
                  <small>sha256 {output.artifacts[0]?.contentHash.slice(0, 12) ?? "unavailable"}…</small>
                </button>
                <div className="output-actions">
                  <Button
                    disabled={
                      delivery.source !== "server" ||
                      openingOutputId !== null ||
                      output.profile.outputKind !== "still" ||
                      (output.profile.container !== "png" && output.profile.container !== "jpeg")
                    }
                    title={
                      output.profile.outputKind === "still"
                        ? "Open the hash-verified immutable still inside Studio."
                        : "Inline viewing is not implemented for this output format."
                    }
                    aria-haspopup="dialog"
                    onClick={() => void openArtifact(output)}
                  >
                    {openingOutputId === output.id ? "Opening…" : "Open"}
                  </Button>
                  <Button disabled title="Reveal requires the native macOS shell bridge.">
                    Reveal
                  </Button>
                  <Button
                    disabled={
                      delivery.source !== "server" ||
                      openingOutputId !== null ||
                      comparisonReference(output) === null
                    }
                    title={
                      comparisonReference(output) === null
                        ? "Create a second still output with matching dimensions to compare artifacts."
                        : `Compare with ${comparisonReference(output)?.id ?? "the reference output"}.`
                    }
                    aria-haspopup="dialog"
                    onClick={() => void openComparison(output)}
                  >
                    Compare
                  </Button>
                  <Button
                    onClick={() => {
                      delivery.selectOutput(output.id);
                    }}
                  >
                    <ChaiIcon name="receipt" size={16} /> Receipt
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {viewer === null ? null : (
        <dialog
          ref={viewerDialogRef}
          className="artifact-viewer"
          aria-labelledby="artifact-viewer-title"
          onCancel={(event) => {
            event.preventDefault();
            closeViewer();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeViewer();
          }}
        >
          <div className="artifact-viewer__surface">
            <header>
              <div>
                <Badge tone="ready">SHA-256 verified</Badge>
                <h3 id="artifact-viewer-title">Immutable render artifact</h3>
                <small>{viewer.outputId}</small>
              </div>
              <Button autoFocus aria-label="Close artifact viewer" onClick={closeViewer}>
                Close
              </Button>
            </header>
            <div className="artifact-viewer__canvas">
              <img
                src={viewer.objectUrl}
                alt={`Rendered artifact ${viewer.artifactPath}`}
                data-testid="artifact-viewer-image"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  setViewer((current) =>
                    current?.objectUrl !== viewer.objectUrl
                      ? current
                      : { ...current, measuredWidth: naturalWidth, measuredHeight: naturalHeight },
                  );
                }}
              />
            </div>
            <dl className="artifact-viewer__evidence">
              <div>
                <dt>Artifact</dt>
                <dd>{viewer.artifactPath}</dd>
              </div>
              <div>
                <dt>Measured</dt>
                <dd>
                  {viewer.measuredWidth === null || viewer.measuredHeight === null
                    ? "Reading image dimensions…"
                    : `${viewer.measuredWidth.toString(10)} × ${viewer.measuredHeight.toString(10)}`}
                </dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>
                  {viewer.expectedWidth === null || viewer.expectedHeight === null
                    ? "Not declared"
                    : `${viewer.expectedWidth.toString(10)} × ${viewer.expectedHeight.toString(10)}`}
                </dd>
              </div>
              <div>
                <dt>Bytes</dt>
                <dd>{formatBytes(viewer.byteLength)}</dd>
              </div>
              <div className="artifact-viewer__hash">
                <dt>SHA-256</dt>
                <dd>{viewer.contentHash}</dd>
              </div>
            </dl>
          </div>
        </dialog>
      )}
      {comparison === null ? null : (
        <dialog
          ref={comparisonDialogRef}
          className="artifact-viewer artifact-comparison"
          aria-labelledby="artifact-comparison-title"
          onCancel={(event) => {
            event.preventDefault();
            closeComparison();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeComparison();
          }}
        >
          <div className="artifact-viewer__surface">
            <header>
              <div>
                <Badge tone="ready">Both hashes verified</Badge>
                <h3 id="artifact-comparison-title">Immutable output comparison</h3>
                <small>Side-by-side source artifacts · no simulated difference result</small>
              </div>
              <Button autoFocus aria-label="Close output comparison" onClick={closeComparison}>
                Close
              </Button>
            </header>
            <div className="artifact-comparison__canvas">
              {(
                [
                  ["Current", comparison.current],
                  ["Reference", comparison.reference],
                ] as const
              ).map(([label, artifact]) => (
                <figure key={artifact.outputId}>
                  <figcaption>
                    <strong>{label}</strong>
                    <span>{artifact.outputId}</span>
                  </figcaption>
                  <img
                    src={artifact.objectUrl}
                    alt={`${label} rendered artifact ${artifact.artifactPath}`}
                    data-testid={`comparison-${label.toLocaleLowerCase("en")}-image`}
                  />
                  <small>{artifact.contentHash}</small>
                </figure>
              ))}
            </div>
            <div className="artifact-comparison__note">
              <strong>Identity comparison only</strong>
              <span>
                These are the two immutable output files. Pixel-difference analysis remains unavailable until
                a deterministic difference evaluator is installed.
              </span>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
};

const ActiveRenderCard = ({
  item,
  control,
  busy,
}: {
  readonly item: QueueView;
  readonly control: DeliveryContextValue["control"];
  readonly busy: boolean;
}) => (
  <div className="render-card">
    <div className="render-card__title">
      <div>
        <strong>{item.request.name}</strong>
        <small>
          {item.request.jobId} · priority {item.request.priority}
        </small>
      </div>
      <b>{Math.round(item.progress * 100)}%</b>
    </div>
    <ProgressBar
      label={`${item.stage}${item.estimateLabel === null ? "" : ` · ${item.estimateLabel}`}`}
      value={Math.round(item.progress * 100)}
      tone={item.persistedStatus === "failed" ? "danger" : "info"}
    />
    <div className="render-controls">
      <Button disabled={!item.controls.cancel || busy} onClick={() => void control("cancel")}>
        Cancel
      </Button>
      <Button disabled={!item.controls.retryFailedStage || busy} onClick={() => void control("retry")}>
        Retry failed stage
      </Button>
      <Button disabled={busy} onClick={() => void control("duplicate")}>
        <ChaiIcon name="duplicate" size={16} /> Duplicate
      </Button>
      <Button disabled={!item.controls.reprioritize || busy} onClick={() => void control("reprioritize")}>
        Raise priority
      </Button>
      <Button disabled title={item.pauseUnavailableReason}>
        Pause unavailable
      </Button>
    </div>
    <div className="render-metrics">
      <Metric label="Source revision" value={item.request.revisionId} />
      <Metric label="Scope" value={scopeLabel(item.request.scope)} />
      <Metric label="Active engine" value={item.activeEngine ?? "None"} />
      <Metric label="QA" value={item.qaState.replaceAll("_", " ")} />
    </div>
  </div>
);

export const DeliveryReceiptPanel = ({ snapshot }: { readonly snapshot: StudioSnapshot }) => {
  const delivery = useDelivery();
  const output = delivery.selectedOutput;
  const latest = delivery.qaWorkspace?.latest?.authoritativeReport ?? null;
  const checklist = delivery.qaWorkspace?.checklist ?? null;
  const checklistPassed = checklist?.items.filter((item) => item.status === "passed").length ?? 0;
  return (
    <div className="panel-content delivery-receipt" aria-label="QA and render receipt">
      <div className="panel-titlebar">
        <strong>QA & receipt</strong>
        <Badge tone={output?.lifecycleState === "approved" ? "ready" : "attention"}>
          {output?.lifecycleState.replaceAll("_", " ") ?? "No output"}
        </Badge>
      </div>
      <section>
        <h3>Preflight</h3>
        {delivery.preflight === null ? (
          <p>No preflight recorded.</p>
        ) : (
          delivery.preflight.findings.map((finding) => (
            <div className={`preflight-row ${finding.severity}`} key={finding.code}>
              <span>
                <ChaiIcon name={finding.blocking ? "status-danger" : "status-ready"} size={14} />
              </span>
              <div>
                <strong>{finding.title}</strong>
                <small>{finding.detail}</small>
                {finding.repair === null ? null : <em>{finding.repair}</em>}
              </div>
            </div>
          ))
        )}
        <Button onClick={() => void delivery.check({ kind: "full-timeline" })} disabled={delivery.busy}>
          <ChaiIcon name="preflight" size={16} /> Run timeline preflight
        </Button>
        {delivery.preflight?.qaReport === undefined ? null : (
          <small className="qa-rule-identity">
            Central QA rules · {delivery.preflight.qaReport.ruleSetIdentity.slice(0, 12)}… ·{" "}
            {delivery.qaWorkspace?.rules.length ?? delivery.preflight.qaReport.findings.length} checks
          </small>
        )}
      </section>
      <section className="qa-machine-section">
        <div className="qa-section-title">
          <h3>Machine QA</h3>
          <Badge tone={latest?.state === "qa_passed" ? "ready" : latest === null ? "neutral" : "attention"}>
            {latest?.state.replaceAll("_", " ") ?? "Not run"}
          </Badge>
        </div>
        {latest === null ? (
          <p>
            Run QA on the immutable output to record structural, audio, visual, caption, and sync evidence.
          </p>
        ) : (
          <div className="qa-finding-list">
            {latest.findings.map((finding) => (
              <article className={`qa-finding qa-finding--${finding.status}`} key={finding.id}>
                <span>
                  <ChaiIcon
                    name={
                      finding.status === "passed"
                        ? "status-ready"
                        : finding.status === "failed"
                          ? "status-danger"
                          : "status-info"
                    }
                    size={14}
                  />
                </span>
                <div>
                  <strong>{finding.title}</strong>
                  <small>{finding.detail}</small>
                  {finding.location.frame === null ? null : <em>Frame {finding.location.frame}</em>}
                  {finding.repairHint === null ? null : <em>{finding.repairHint}</em>}
                </div>
              </article>
            ))}
          </div>
        )}
        <Button
          disabled={
            delivery.busy || delivery.source !== "server" || output?.lifecycleState !== "rendered_unchecked"
          }
          onClick={() => void delivery.runQa()}
        >
          <ChaiIcon name="qa-scan" size={16} /> Run output QA
        </Button>
      </section>
      <section className="qa-checklist-section">
        <div className="qa-section-title">
          <h3>Required visual review</h3>
          <Badge tone={checklist?.complete === true ? "ready" : "attention"}>
            {checklist === null
              ? "Not generated"
              : `${String(checklistPassed)}/${String(checklist.items.length)}`}
          </Badge>
        </div>
        {checklist === null ? (
          <p>
            The exact boundary, phrase, midpoint, caption, alpha, shader, continuity, color, and endpoint
            frames appear after QA.
          </p>
        ) : (
          <div className="qa-checklist">
            {checklist.items.map((item) => (
              <article key={item.id} className={`qa-check qa-check--${item.status}`}>
                <div>
                  <span>{item.category.replaceAll("-", " ")}</span>
                  <strong>Frame {item.frame}</strong>
                  <small>{item.instruction}</small>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    disabled={delivery.busy || delivery.source !== "server" || item.status === "passed"}
                    onClick={() => void delivery.recordChecklist(item.id, "passed")}
                  >
                    <ChaiIcon name="status-ready" size={14} /> Pass
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={delivery.busy || delivery.source !== "server"}
                    onClick={() => void delivery.recordChecklist(item.id, "failed")}
                  >
                    <ChaiIcon name="status-danger" size={14} /> Flag
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="qa-lifecycle-actions">
          <Button
            disabled={
              delivery.busy ||
              delivery.source !== "server" ||
              checklist?.complete !== true ||
              (output?.lifecycleState !== "qa_passed" && output?.lifecycleState !== "qa_warning")
            }
            onClick={() => void delivery.approve()}
          >
            <ChaiIcon name="approve" size={14} /> Approve exact output
          </Button>
          <Button
            variant="primary"
            disabled={delivery.busy || delivery.source !== "server" || output?.lifecycleState !== "approved"}
            onClick={() => void delivery.deliver()}
          >
            <ChaiIcon name="deliver-output" size={16} /> Record delivery
          </Button>
        </div>
      </section>
      <section>
        <h3>Output identity</h3>
        {output === null ? (
          <p>No output selected.</p>
        ) : (
          <div className="property-grid">
            <Metric label="Output ID" value={output.id} />
            <Metric label="Dimensions" value={dimensions(output.profile)} />
            <Metric label="FPS" value={fps(output.profile)} />
            <Metric label="Source revision" value={output.sourceRevisionId} />
            <Metric label="Lifecycle" value={output.lifecycleState.replaceAll("_", " ")} />
            <Metric label="Receipt" value={`${output.receiptIdentityHash.slice(0, 12)}…`} />
            <Metric label="Created" value={new Date(output.createdAt).toLocaleString()} />
          </div>
        )}
      </section>
      <section>
        <h3>Receipt · human / JSON</h3>
        <details>
          <summary>Show immutable receipt JSON</summary>
          <pre className="manifest">
            {delivery.receipt === null ? "Receipt unavailable" : JSON.stringify(delivery.receipt, null, 2)}
          </pre>
        </details>
      </section>
      <div className="warning-note">
        <strong>
          {snapshot.render.approval === "approved" ? "Approved output" : "Delivery remains locked"}
        </strong>
        <br />
        Encoding success is never called delivery. QA evidence and explicit approval remain separate lifecycle
        steps.
      </div>
    </div>
  );
};

const Metric = ({ label, value }: { readonly label: string; readonly value: string }) => (
  <div className="property">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);
const dimensions = (profile: DeliveryProfileView): string =>
  profile.width === null
    ? "Audio only"
    : `${String(profile.width)}×${profile.height === null ? "?" : String(profile.height)}`;
const fps = (profile: DeliveryProfileView): string =>
  profile.fps === null ? "No frame rate" : `${profile.fps.numerator}/${profile.fps.denominator}`;
const formatBytes = (value: number): string =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : value >= 1024 ** 2
      ? `${(value / 1024 ** 2).toFixed(1)} MB`
      : `${value.toLocaleString()} B`;
const scopeLabel = (scope: JsonRecord): string =>
  typeof scope.kind === "string" ? scope.kind.replaceAll("-", " ") : "unknown scope";
const statusLabel = (item: QueueView): string =>
  item.persistedStatus === "running"
    ? `${String(Math.round(item.progress * 100))}%`
    : item.persistedStatus.replaceAll("_", " ");
const sha256Blob = async (blob: Blob): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
};
const messageFor = (cause: unknown): string =>
  cause instanceof StudioApiError
    ? `${cause.message} ${cause.diagnostic.repairHint ?? ""} Correlation ${cause.diagnostic.correlationId}.`.trim()
    : cause instanceof Error
      ? cause.message
      : "The render request failed unexpectedly.";
const authoritativeRevisionId = async (
  client: StudioApiClient,
  fallbackRevisionId: string,
): Promise<string> => {
  const snapshot = await client.projectSnapshot();
  const pointer = snapshot.pointer;
  return typeof pointer === "object" &&
    pointer !== null &&
    "revisionId" in pointer &&
    typeof pointer.revisionId === "string"
    ? pointer.revisionId
    : fallbackRevisionId;
};
const rangeScope = (snapshot: StudioSnapshot): JsonRecord => {
  if (snapshot.preview.inOutRange !== null) return { kind: "in-out", ...snapshot.preview.inOutRange };
  const clips = snapshot.timeline.selection.selectedIds.flatMap((id) => {
    const clip = snapshot.timeline.clips[id];
    return clip === undefined ? [] : [clip];
  });
  const firstClip = clips[0];
  if (firstClip !== undefined)
    return {
      kind: "selected-range",
      startFrame: clips
        .reduce((value, clip) => (clip.range.start < value ? clip.range.start : value), firstClip.range.start)
        .toString(),
      endFrameExclusive: clips
        .reduce((value, clip) => (clip.range.end > value ? clip.range.end : value), firstClip.range.end)
        .toString(),
    };
  return { kind: "frame", frame: snapshot.preview.masterFrame };
};
