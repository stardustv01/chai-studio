import type {
  DeliveryProfileView,
  JsonRecord,
  OutputView,
  PreflightView,
  QaWorkspaceView,
  QueueView,
} from "./delivery-workspace.js";

const baseProfile = (
  input: Partial<DeliveryProfileView> & Pick<DeliveryProfileView, "id" | "name" | "kind">,
): DeliveryProfileView => ({
  schemaVersion: "1.0.0",
  purpose: "final",
  outputKind: "video",
  width: 1920,
  height: 1080,
  fps: { numerator: "30000", denominator: "1001" },
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  audioSampleRate: 48_000,
  colorSpace: "rec709",
  alpha: "none",
  sourcePolicy: "originals-required",
  strictEnvironment: true,
  outputPathTemplate: "deliveries/{project}-{revision}.mp4",
  identityHash: "sample-not-authoritative",
  ...input,
});

export const contractProfiles: readonly DeliveryProfileView[] = [
  baseProfile({ id: "sample-youtube-1080", name: "YouTube 1080p", kind: "youtube-1080p" }),
  baseProfile({
    id: "sample-youtube-4k",
    name: "YouTube 4K",
    kind: "youtube-4k",
    width: 3840,
    height: 2160,
    videoCodec: "h265",
  }),
  baseProfile({
    id: "sample-review",
    name: "Review proxy",
    kind: "review-proxy",
    purpose: "preview",
    width: 1280,
    height: 720,
    sourcePolicy: "proxies-allowed",
    strictEnvironment: false,
  }),
  baseProfile({ id: "sample-shorts", name: "Shorts 9:16", kind: "shorts", width: 1080, height: 1920 }),
  baseProfile({
    id: "sample-overlay",
    name: "Transparent overlay",
    kind: "transparent-overlay",
    container: "mov",
    videoCodec: "prores-4444",
    audioCodec: null,
    audioSampleRate: null,
    alpha: "straight",
  }),
  baseProfile({
    id: "sample-master",
    name: "Master mezzanine",
    kind: "master-mezzanine",
    width: 3840,
    height: 2160,
    container: "mov",
    videoCodec: "prores-422-hq",
    audioCodec: "pcm-s24le",
  }),
];

const firstProfile = contractProfiles[0];
if (firstProfile === undefined) throw new Error("Delivery fixture requires one profile.");
export const contractDefaultProfile = firstProfile;

export const contractQueue: readonly QueueView[] = [
  {
    schemaVersion: "1.0.0",
    request: {
      id: "sample-request",
      jobId: "sample-job-active",
      revisionId: "revision-000428",
      name: "Launch Film · YouTube 1080p",
      priority: 0,
      attempt: 1,
      profile: contractDefaultProfile,
      scope: { kind: "full-timeline" },
    },
    job: null,
    persistedStatus: "running",
    stage: "Master encode",
    activeEngine: "shared",
    progress: 0.73,
    cacheHits: 8,
    estimateLabel: "about 2 min",
    qaState: "not-started",
    controls: { cancel: false, retryFailedStage: false, duplicate: false, reprioritize: false },
    pauseUnavailableReason: "Fixture projection is read-only.",
  },
];

export const contractOutputs: readonly OutputView[] = [
  {
    id: "sample-output",
    sourceRevisionId: "revision-000427",
    lifecycleState: "qa_warning",
    createdAt: "2026-07-16T08:15:00.000Z",
    receiptIdentityHash: "79a4c02f".padEnd(64, "0"),
    profile: contractDefaultProfile,
    artifacts: [
      {
        relativePath: "renders/sample/launch-film-r427.mp4",
        byteLength: 191_260_262,
        contentHash: "419bc12e".padEnd(64, "0"),
        primary: true,
      },
    ],
  },
];

export const contractPreflight: PreflightView = {
  executable: true,
  identityHash: "sample-preflight",
  findings: [
    {
      code: "delivery.preflight.ready",
      severity: "info",
      blocking: false,
      title: "Sample checks passed",
      detail:
        "Project schema, dependencies, original-source guard, audio graph, rights, and disk margin are represented in this explicit UI fixture.",
      repair: null,
    },
  ],
  qaReport: {
    ruleSetIdentity: "a42f27c1".padEnd(64, "0"),
    state: "qa_passed",
    findings: [],
  },
};

export const contractQaWorkspace: QaWorkspaceView = {
  outputId: "sample-output",
  ruleSetIdentity: "a42f27c1".padEnd(64, "0"),
  rules: Array.from({ length: 22 }, (_, index) => ({ id: `sample-qa-rule-${String(index + 1)}` })),
  latest: {
    reportHash: "6cb2ad91".padEnd(64, "0"),
    authoritativeReport: {
      state: "qa_warning",
      findings: [
        {
          id: "sample-qa-structure",
          ruleId: "qa.post.structure",
          category: "output",
          severity: "info",
          status: "passed",
          title: "Output structure matches requested profile",
          detail:
            "Duration, dimensions, rational FPS, codecs, audio layout, frame count, and output hash match.",
          repairHint: null,
          location: { frame: null, frameRange: null, entityIds: ["sample-output"] },
          metrics: [{ name: "frameCount", value: "4281", unit: "frames", threshold: "4281" }],
        },
        {
          id: "sample-qa-audio",
          ruleId: "qa.post.audio",
          category: "audio",
          severity: "warning",
          status: "warning",
          title: "Authoritative audio measurements",
          detail:
            "Structure and sync pass; integrated loudness is 0.4 LU outside this profile’s reviewed target band.",
          repairHint: "Review the loudness decision or repair the authoritative mix before approval.",
          location: { frame: "0", frameRange: null, entityIds: ["audio-program"] },
          metrics: [{ name: "integratedLufs", value: -19.4, unit: "LUFS", threshold: [-19, -15] }],
        },
      ],
    },
  },
  checklist: {
    id: "sample-review-checklist",
    outputId: "sample-output",
    complete: false,
    identityHash: "f922bca1".padEnd(64, "0"),
    items: [
      ["first-frame", "0", "Confirm the opening frame is intentional and nonblank."],
      ["last-frame", "4280", "Confirm the final frame is complete and nonblank."],
      ["boundary", "1198", "Inspect the Remotion to shared boundary and continuity."],
      ["phrase-anchor", "1384", "Confirm the voice phrase lands on the intended visual anchor."],
      ["transition-midpoint", "2140", "Inspect transition geometry at the exact midpoint."],
      ["caption", "2411", "Confirm caption readability, safe zone, and phrase timing."],
      ["shader", "3174", "Inspect shader fidelity and edge artifacts."],
      ["continuity", "3210", "Confirm motion and cross-engine continuity."],
      ["color", "2140", "Confirm expected Rec.709 appearance."],
      ["alpha", "3328", "Confirm no unintended matte or transparency edge."],
    ].map(([category, frame, instruction], index) => ({
      id: `sample-check-${String(index + 1).padStart(2, "0")}`,
      category: category ?? "continuity",
      frame: frame ?? "0",
      instruction: instruction ?? "Review exact frame.",
      status: index < 8 ? ("passed" as const) : ("pending" as const),
      evidenceHashes: index < 8 ? ["9".repeat(64)] : [],
    })),
  },
};

export const contractReceipt: JsonRecord = {
  status: "sample-only",
  initialLifecycleState: "rendered_unchecked",
  currentState: "qa_warning",
  qaRuleSetIdentity: "a42f27c1".padEnd(64, "0"),
  visualChecklist: { passed: 8, required: 10, complete: false },
  delivered: false,
  warning: "Authenticated server receipts replace this explicit UI fixture.",
};
