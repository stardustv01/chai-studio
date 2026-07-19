import type {
  DeliveryProfileView,
  JsonRecord,
  OutputView,
  PreflightView,
  QaWorkspaceView,
  QueueView,
} from "./delivery-workspace.js";

export const contractDefaultProfile: DeliveryProfileView = {
  schemaVersion: "1.0.0",
  id: "profile-loading-local-authority",
  name: "Loading local profiles",
  kind: "custom",
  purpose: "final",
  outputKind: "still",
  width: null,
  height: null,
  fps: null,
  container: "png",
  videoCodec: "png",
  audioCodec: null,
  audioSampleRate: null,
  colorSpace: "source",
  alpha: "none",
  sourcePolicy: "originals-required",
  strictEnvironment: true,
  outputPathTemplate: "",
  identityHash: "0".repeat(64),
};

export const contractProfiles: readonly DeliveryProfileView[] = [];
export const contractQueue: readonly QueueView[] = [];
export const contractOutputs: readonly OutputView[] = [];
export const contractPreflight: PreflightView = {
  executable: false,
  identityHash: "0".repeat(64),
  findings: [],
};
export const contractQaWorkspace: QaWorkspaceView = {
  outputId: "output-unavailable",
  ruleSetIdentity: "0".repeat(64),
  rules: [],
  latest: null,
  checklist: null,
};
export const contractReceipt: JsonRecord = {};
