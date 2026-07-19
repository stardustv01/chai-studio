import type { QaState } from "@chai-studio/qa";

export interface BridgeOwnership {
  readonly conversationSurface: "codex-only";
  readonly cannotInfer: readonly QaState[];
}

export const bridgePackageBoundary: BridgeOwnership = {
  conversationSurface: "codex-only",
  cannotInfer: ["approved", "delivered"],
};

export * from "./annotations.js";
export * from "./attachment.js";
export * from "./authorization.js";
export * from "./capture-jobs.js";
export * from "./client.js";
export * from "./discovery.js";
export * from "./manifests.js";
export * from "./redaction.js";
